import { describe, expect, it, vi } from 'vitest';
import { BuildingRegistry, decodeWorldIndex, worldIndex } from '../src/destruction/buildings';
import { generateCollapseLab, LAB_SHOTS, LAB_TEST_BUILDING_ID } from '../src/destruction/lab';
import { analyzeStructure, createStructureInput,isStructureResultCurrent, type StructureInput, type StructureResult } from '../src/destruction/structure';
import { StructureQueue } from '../src/destruction/structure-queue';
import { MAX_ACTIVE_FRAGMENTS } from '../src/destruction/types';
import { generateWorld } from '../src/world/generate';
import { Material } from '../src/world/palette';
import { VoxelWorld } from '../src/world/voxel';

function registerBox(world: VoxelWorld, registry: BuildingRegistry, min: [number, number, number], max: [number, number, number], id = 'test-building') {
  const positions: number[] = [];
  for(let y=0;y<min[1];y++)for(let z=min[2];z<=max[2];z++)for(let x=min[0];x<=max[0];x++)world.setVoxel(x,y,z,Material.Rock);
  for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
    positions.push(worldIndex(x, y, z)); world.setVoxel(x, y, z, Material.Brick);
  }
  const building=registry.add(id, 'Test', min[1], positions);registry.captureFoundations(world);return building;
}

function removeLayer(world: VoxelWorld, y: number, minX: number, maxX: number, minZ: number, maxZ: number, except?: [number, number]) {
  const edits = [];
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    if (except?.[0] === x && except[1] === z) continue;
    edits.push({ x, y, z, material: 0 });
  }
  return world.applyEdits(edits);
}

class ControlledWorker {
  static latest: ControlledWorker;
  onmessage: ((event: MessageEvent<StructureResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  jobs: StructureInput[] = [];
  terminated = false;
  constructor() { ControlledWorker.latest = this; }
  postMessage(input: StructureInput) { this.jobs.push(input); }
  terminate() { this.terminated = true; }
  deliver(input: StructureInput) { this.onmessage?.({ data: analyzeStructure(input) } as MessageEvent<StructureResult>); }
}

describe('building ownership and structural collapse', () => {
  it('grounds a raised structure through a real lateral pier and reacts when that connection is cut',()=>{
    const world=new VoxelWorld(),registry=new BuildingRegistry(),indices:number[]=[];
    for(let y=10;y<=14;y++){world.setVoxel(20,y,20,Material.Brick);indices.push(worldIndex(20,y,20));}
    for(let x=21;x<=28;x++)world.setVoxel(x,12,20,Material.Concrete);
    for(let y=0;y<12;y++)world.setVoxel(28,y,20,Material.Rock);
    const building=registry.add('raised-pier','Raised pier',10,indices);registry.captureFoundations(world);
    expect(analyzeStructure(createStructureInput(world,building,'connected')).edits).toHaveLength(0);
    const edits=[{x:24,y:12,z:20,material:0}];world.applyEdits(edits);
    expect(registry.affectedBy(edits)).toContain(building);
    expect(analyzeStructure(createStructureInput(world,building,'cut')).edits).toHaveLength(5);
  });
  it('tracks excavation below a building, detaches its foundation too and never repairs the hole',()=>{
    const world=new VoxelWorld(),registry=new BuildingRegistry(),building=registerBox(world,registry,[29,32,29],[34,37,34]);
    const edits=[];for(let z=29;z<=34;z++)for(let x=29;x<=34;x++)edits.push({x,y:30,z,material:0});
    const old=createStructureInput(world,building,'before-excavation');world.applyEdits(edits);
    expect(registry.affectedBy(edits)).toEqual([building]);expect(isStructureResultCurrent(world,old)).toBe(false);
    const result=analyzeStructure(createStructureInput(world,building,'excavation'));
    expect(result.reason).toBe('unanchored-foundation');expect(result.edits).toHaveLength(building.indices.length);
    expect(result.edits.some(e=>e.y===32)).toBe(true);expect(world.getVoxel(30,30,30)).toBe(0);
  });
  it('keeps a mostly supported slab but rejects one ground needle carrying the whole footprint',()=>{
    const world=new VoxelWorld(),registry=new BuildingRegistry(),building=registerBox(world,registry,[20,16,20],[27,23,27]);
    world.setVoxel(20,15,20,0);expect(analyzeStructure(createStructureInput(world,building,'small-hole')).edits).toHaveLength(0);
    removeLayer(world,15,20,27,20,27,[23,23]);
    const result=analyzeStructure(createStructureInput(world,building,'needle-ground'));
    expect(result.reason).toBe('unanchored-foundation');expect(result.edits).toHaveLength(building.indices.length);
  });
  it('preserves the original city geometry byte-for-byte while registering only buildings', () => {
    const generated = generateWorld(48271);
    let checksum = 2166136261;
    for (const chunk of generated.world.chunks.values()) for (const material of chunk.voxels) checksum = Math.imul(checksum ^ material, 16777619);
    expect(checksum >>> 0).toBe(3038127054);
    expect(generated.world.chunks.size).toBe(105);
    expect(generated.buildings.all).toHaveLength(33);
    expect(generated.buildings.findAt(55, 19, 53)?.id).toMatch(/^city-building-/);
    expect(generated.buildings.findAt(217, 40, 204)?.id).toBe('city-lighthouse');
    expect(generated.buildings.findAt(12, 16, 12)).toBeUndefined();
    expect(generated.buildings.findAt(84, 15, 125)).toBeUndefined();
    expect(generated.buildings.affectedBy([{ x: 55, y: 19, z: 53 }, { x: 55, y: 20, z: 53 }])).toHaveLength(1);
  });

  it('keeps an intact building supported and keeps the analysis read-only', () => {
    const world = new VoxelWorld(); const registry = new BuildingRegistry();
    const building = registerBox(world, registry, [29, 16, 29], [35, 25, 35]);
    const revision = world.chunks.get('0,0,0')!.revision;
    const result = analyzeStructure(createStructureInput(world, building, 'intact'));
    expect(result.edits).toHaveLength(0); expect(result.fragments).toHaveLength(0);
    expect(result.reason).toBe('stable');
    expect(world.chunks.get('0,0,0')!.revision).toBe(revision);
    expect(world.getVoxel(32, 20, 32)).toBe(Material.Brick);
  });

  it('finds detached material across chunk boundaries without deleting the foundation', () => {
    const world = new VoxelWorld(); const registry = new BuildingRegistry();
    const building = registerBox(world, registry, [29, 16, 29], [35, 25, 35]);
    removeLayer(world, 18, 29, 35, 29, 35);
    const result = analyzeStructure(createStructureInput(world, building, 'cross-chunk'));
    expect(result.reason).toBe('disconnected'); expect(result.edits).toHaveLength(7 * 7 * 7);
    expect(result.edits.every(edit => edit.y > 18)).toBe(true);
    expect(result.revisions).toHaveLength(4);
    expect(result.edits.some(edit => edit.x === 31)).toBe(true);
    expect(result.edits.some(edit => edit.x === 32)).toBe(true);
    expect(world.getVoxel(32, 20, 32)).toBe(Material.Brick);
  });

  it('does not allow a single remaining needle to support a large intact upper volume', () => {
    const world = new VoxelWorld(); const registry = new BuildingRegistry();
    const building = registerBox(world, registry, [20, 16, 20], [27, 28, 27]);
    removeLayer(world, 18, 20, 27, 20, 27, [23, 23]);
    const result = analyzeStructure(createStructureInput(world, building, 'needle'));
    expect(result.reason).toBe('insufficient-support');
    expect(result.edits).toHaveLength(8 * 8 * 10);
    expect(result.edits.every(edit => edit.y > 18)).toBe(true);
  });

  it('lets two real blasts detach the lab left wing while its right wing remains supported', () => {
    const generated = generateCollapseLab(); const building = generated.buildings.get(LAB_TEST_BUILDING_ID)!;
    expect(analyzeStructure(createStructureInput(generated.world, building, 'initial')).fragments).toHaveLength(0);
    generated.world.removeSphere(LAB_SHOTS[0], 3.2);
    expect(analyzeStructure(createStructureInput(generated.world, building, 'first-shot')).edits).toHaveLength(0);
    generated.world.removeSphere(LAB_SHOTS[1], 3.2);
    const result = analyzeStructure(createStructureInput(generated.world, building, 'second-shot'));
    expect(result.edits.length).toBeGreaterThan(400);
    expect(result.edits.every(edit => edit.x < 110)).toBe(true);
    generated.world.applyEdits(result.edits);
    expect(generated.world.getVoxel(112, 26, 132)).toBe(Material.Cream);
    expect(analyzeStructure(createStructureInput(generated.world, building, 'after-detachment')).edits).toHaveLength(0);
  });

  it('clusters every detached voxel within the body budget, with non-overlapping initial bounds and unique IDs', () => {
    const world = new VoxelWorld(); const registry = new BuildingRegistry();
    const building = registerBox(world, registry, [30, 16, 30], [55, 42, 55]);
    removeLayer(world, 18, 30, 55, 30, 55);
    const first = analyzeStructure(createStructureInput(world, building, 'event-a'));
    const second = analyzeStructure(createStructureInput(world, building, 'event-b'));
    expect(first.fragments.length).toBeLessThanOrEqual(MAX_ACTIVE_FRAGMENTS);
    expect(first.fragments.reduce((sum, fragment) => sum + fragment.voxels.length, 0)).toBe(first.edits.length);
    const positions = new Set<number>();
    for (const fragment of first.fragments) {
      const min = { x: fragment.position.x - fragment.size.x / 2, y: fragment.position.y - fragment.size.y / 2, z: fragment.position.z - fragment.size.z / 2 };
      for (const [x, y, z, material] of fragment.voxels) {
        expect(material).toBe(Material.Brick);
        positions.add(worldIndex(min.x + x, min.y + y, min.z + z));
      }
    }
    expect(positions.size).toBe(first.edits.length);
    expect(first.edits.every(edit => positions.has(worldIndex(edit.x, edit.y, edit.z)))).toBe(true);
    expect(first.fragments.some(fragment => second.fragments.some(other => other.id === fragment.id))).toBe(false);
    for (let i = 0; i < first.fragments.length; i++) for (let j = i + 1; j < first.fragments.length; j++) {
      const a = first.fragments[i], b = first.fragments[j];
      const overlaps = ['x', 'y', 'z'].every(axisName => {
        const axis = axisName as 'x' | 'y' | 'z';
        return Math.abs(a.position[axis] - b.position[axis]) < (a.size[axis] + b.size[axis]) / 2;
      });
      expect(overlaps).toBe(false);
    }
  });

  it('rejects stale structure results and waits for physics admission before applying a worker reply', () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const world = new VoxelWorld(); const registry = new BuildingRegistry();
    const building = registerBox(world, registry, [29, 16, 29], [35, 25, 35]);
    const results: StructureResult[] = [];
    const queue = new StructureQueue(world, registry, result => results.push(result));
    try {
      queue.enqueue([building.id]); queue.update(true);
      const worker = ControlledWorker.latest;
      expect(worker.jobs).toHaveLength(1);
      removeLayer(world, 18, 29, 35, 29, 35);
      worker.deliver(worker.jobs[0]);
      queue.update(false); expect(results).toHaveLength(0);
      queue.update(true); expect(results).toHaveLength(0);
      queue.update(true); expect(worker.jobs).toHaveLength(2);
      worker.deliver(worker.jobs[1]); queue.update(false);
      expect(results).toHaveLength(0); expect(queue.pending).toBe(1);
      queue.update(true);
      expect(results).toHaveLength(1); expect(results[0].edits.length).toBeGreaterThan(0);
      expect(queue.pending).toBe(0);
    } finally { queue.dispose(); vi.unstubAllGlobals(); }
  });

  it('decodes world indices without losing cross-chunk coordinate precision', () => {
    expect(decodeWorldIndex(worldIndex(255, 95, 254))).toEqual({ x: 255, y: 95, z: 254 });
  });
});
