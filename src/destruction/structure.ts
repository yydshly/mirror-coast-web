import { chunkKey, WORLD_HEIGHT, type VoxelEdit, type VoxelWorld } from '../world/voxel';
import { captureFoundationFootings,decodeWorldIndex, worldIndex, WORLD_INDEX_OFFSET, WORLD_INDEX_STRIDE, type BuildingRecord } from './buildings';
import { MAX_ACTIVE_FRAGMENTS, type FragmentVoxel, type RubbleFragment } from './types';

export type ChunkRevision = { key: string; revision: number };
export type StructureInput = {
  buildingId: string;
  eventId: string;
  foundationY: number;
  indices: Uint32Array;
  materials: Uint8Array;
  baselineLayers: Uint32Array;
  revisions: ChunkRevision[];
  supportRoots?:Uint32Array;
  foundationRatio?:number;
};

export type StructureResult = {
  buildingId: string;
  eventId: string;
  edits: VoxelEdit[];
  fragments: RubbleFragment[];
  checkedVoxels: number;
  detachedComponents: number;
  reason: 'stable' | 'disconnected' | 'insufficient-support' | 'unanchored-foundation';
  revisions: ChunkRevision[];
};

/** Model rule, not structural engineering: under 22% of a damaged low layer cannot carry a whole building. */
export const MIN_SUPPORT_RATIO = 0.22;

export function createStructureInput(world: VoxelWorld, building: BuildingRecord, eventId: string): StructureInput {
  const indices = building.indices.slice();
  const materials = new Uint8Array(indices.length);
  const baselineLayers = new Uint32Array(WORLD_HEIGHT);
  const revisions = new Map<string, number>();
  for (let i = 0; i < indices.length; i++) {
    const { x, y, z } = decodeWorldIndex(indices[i]);
    materials[i] = world.getVoxel(x, y, z);
    baselineLayers[y]++;
    const key = chunkKey(x >> 5, y >> 5, z >> 5);
    revisions.set(key, world.chunks.get(key)?.revision ?? 0);
  }
  const footings=building.footings??captureFoundationFootings(world,building),roots:number[]=[];
  for(const footing of footings){
    if(footing.supports.every(index=>{const p=decodeWorldIndex(index);return !!world.getVoxel(p.x,p.y,p.z);}))roots.push(footing.root);
    for(const index of footing.supports){const p=decodeWorldIndex(index),key=chunkKey(p.x>>5,p.y>>5,p.z>>5);revisions.set(key,world.chunks.get(key)?.revision??0);}
  }
  const foundationRatio=footings.length?roots.length/footings.length:0;
  return { buildingId: building.id, eventId, foundationY: building.foundationY, indices, materials, baselineLayers, supportRoots:new Uint32Array(foundationRatio<MIN_SUPPORT_RATIO?[]:roots),foundationRatio,revisions: [...revisions].map(([key, revision]) => ({ key, revision })) };
}

export function isStructureResultCurrent(world: VoxelWorld, result: Pick<StructureResult, 'revisions'>): boolean {
  return result.revisions.every(({ key, revision }) => (world.chunks.get(key)?.revision ?? 0) === revision);
}

function neighbors(index: number): number[] {
  const { x, y, z } = decodeWorldIndex(index);
  const out: number[] = [];
  if (x > -WORLD_INDEX_OFFSET) out.push(index - 1);
  if (x < WORLD_INDEX_STRIDE - WORLD_INDEX_OFFSET - 1) out.push(index + 1);
  if (z > -WORLD_INDEX_OFFSET) out.push(index - WORLD_INDEX_STRIDE);
  if (z < WORLD_INDEX_STRIDE - WORLD_INDEX_OFFSET - 1) out.push(index + WORLD_INDEX_STRIDE);
  if (y > 0) out.push(index - WORLD_INDEX_STRIDE * WORLD_INDEX_STRIDE);
  if (y < WORLD_HEIGHT - 1) out.push(index + WORLD_INDEX_STRIDE * WORLD_INDEX_STRIDE);
  return out;
}

export function analyzeStructure(input: StructureInput): StructureResult {
  const occupied = new Map<number, number>();
  const currentLayers = new Uint32Array(WORLD_HEIGHT);
  for (let i = 0; i < input.indices.length; i++) {
    if (!input.materials[i]) continue;
    occupied.set(input.indices[i], input.materials[i]);
    currentLayers[decodeWorldIndex(input.indices[i]).y]++;
  }

  // The area heuristic is restricted to the lowest six metres. Native floor/roof
  // changes above that band cannot make a sound building spontaneously collapse.
  let weakLayer = Infinity;
  for (let y = input.foundationY; y <= Math.min(WORLD_HEIGHT - 1, input.foundationY + 6); y++) {
    if (input.baselineLayers[y] >= 4 && currentLayers[y] > 0 && currentLayers[y] / input.baselineLayers[y] < MIN_SUPPORT_RATIO) {
      weakLayer = y; break;
    }
  }
  const supported = new Set<number>();
  const queue: number[] = [];
  const roots=input.supportRoots?new Set(input.supportRoots):null;
  for (const index of occupied.keys()) {
    if (roots?roots.has(index):decodeWorldIndex(index).y === input.foundationY) { supported.add(index); queue.push(index); }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const next of neighbors(queue[cursor])) {
      if (!occupied.has(next) || supported.has(next) || decodeWorldIndex(next).y > weakLayer) continue;
      supported.add(next); queue.push(next);
    }
  }

  const detached = new Map<number, number>();
  for (const [index, material] of occupied) if (!supported.has(index)) detached.set(index, material);
  const unvisited = new Set(detached.keys());
  let detachedComponents = 0;
  while (unvisited.size) {
    detachedComponents++;
    const component = [unvisited.values().next().value!];
    unvisited.delete(component[0]);
    for (let cursor = 0; cursor < component.length; cursor++) for (const next of neighbors(component[cursor])) {
      if (unvisited.delete(next)) component.push(next);
    }
  }

  const edits: VoxelEdit[] = [];
  for (const index of detached.keys()) edits.push({ ...decodeWorldIndex(index), material: 0 });
  return {
    buildingId: input.buildingId, eventId: input.eventId, edits,
    fragments: makeFragments(detached, input.buildingId, input.eventId,input.buildingId.startsWith('tree-')),
    checkedVoxels: occupied.size, detachedComponents,
    reason: detached.size === 0 ? 'stable' : input.foundationRatio!==undefined&&input.foundationRatio<MIN_SUPPORT_RATIO?'unanchored-foundation':weakLayer < Infinity ? 'insufficient-support' : 'disconnected',
    revisions: input.revisions,
  };
}

/** Adaptive disjoint spatial bins keep complete voxel volume while bounding rigid-body count. */
export function makeFragments(detached: Map<number, number>, buildingId: string, eventId: string,coherent=false): RubbleFragment[] {
  if (!detached.size) return [];
  let size = coherent?256:4;
  let bins: Map<string, Array<[number, number]>>;
  do {
    bins = new Map();
    for (const entry of detached) {
      const cell = decodeWorldIndex(entry[0]);
      const key = coherent?'tree':`${Math.floor(cell.x / size)},${Math.floor(cell.y / size)},${Math.floor(cell.z / size)}`;
      let values = bins.get(key);
      if (!values) { values = []; bins.set(key, values); }
      values.push(entry);
    }
    if (bins.size > MAX_ACTIVE_FRAGMENTS) size *= 2;
  } while (bins.size > MAX_ACTIVE_FRAGMENTS);

  return [...bins.values()].map((entries, index) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [position] of entries) {
      const cell = decodeWorldIndex(position);
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y);
      minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z);
    }
    const dimensions = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };
    const voxels: FragmentVoxel[] = entries.map(([position, material]) => {
      const cell = decodeWorldIndex(position);
      return [cell.x - minX, cell.y - minY, cell.z - minZ, material];
    });
    return {
      id: `${eventId}:${buildingId}:${index}`, buildingId, size: dimensions, voxels,
      position: { x: minX + dimensions.x / 2, y: minY + dimensions.y / 2, z: minZ + dimensions.z / 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, state: 'falling',
      // Gentle deterministic separation makes the model rule visible without
      // turning the detached building into a physically explosive projectile.
      linearVelocity: { x: (index % 3 - 1) * 0.35, y: 0, z: (Math.floor(index / 3) % 3 - 1) * 0.35 },
      angularVelocity: coherent?{x:.38,y:.03,z:.24}:{ x: ((index % 2) * 2 - 1) * .12, y: 0, z: ((index % 3) - 1) * .08 },
    };
  });
}

export function structureWorldIndex(x: number, y: number, z: number): number { return worldIndex(x, y, z); }
