export const CHUNK_SIZE = 32;
export const WORLD_SIZE = 256;
export const WORLD_HEIGHT = 96;
export const WORLD_SEED = 48271;
export const WORLD_VERSION = 'mirror-coast-v1';

/** Horizontal bounds are half-open. The immutable original city keeps its 256 m default. */
export type WorldBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
export const DEFAULT_WORLD_BOUNDS: WorldBounds = Object.freeze({ minX: 0, maxX: WORLD_SIZE, minZ: 0, maxZ: WORLD_SIZE });

export function validateWorldBounds(bounds: WorldBounds): WorldBounds {
  const { minX, maxX, minZ, maxZ } = bounds;
  if (![minX, maxX, minZ, maxZ].every(value => Number.isInteger(value) && Math.abs(value) <= 1_000_000) || minX >= maxX || minZ >= maxZ) {
    throw new RangeError('World bounds must be finite integer half-open ranges.');
  }
  return Object.freeze({ minX, maxX, minZ, maxZ });
}

export type VoxelEdit = { x: number; y: number; z: number; material: number };
export type Vector3Like = { x: number; y: number; z: number };
export interface Chunk {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint8Array;
  revision: number;
}
export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  normal: Vector3Like;
  distance: number;
}

export const chunkKey = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
export const voxelIndex = (x: number, y: number, z: number) => x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
export const inBounds = (x: number, y: number, z: number) =>
  Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
  x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < WORLD_SIZE;

export class VoxelWorld {
  readonly chunks = new Map<string, Chunk>();
  private currentBounds: WorldBounds;

  constructor(bounds: WorldBounds = DEFAULT_WORLD_BOUNDS) { this.currentBounds = validateWorldBounds(bounds); }

  get bounds(): WorldBounds { return this.currentBounds; }

  /** Expansion never hides existing chunks or changes the canonical city cells. */
  expandBounds(bounds: WorldBounds): void {
    const valid = validateWorldBounds(bounds);
    this.currentBounds = validateWorldBounds({
      minX: Math.min(this.bounds.minX, valid.minX), maxX: Math.max(this.bounds.maxX, valid.maxX),
      minZ: Math.min(this.bounds.minZ, valid.minZ), maxZ: Math.max(this.bounds.maxZ, valid.maxZ),
    });
  }

  contains(x: number, y: number, z: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
      x >= this.bounds.minX && x < this.bounds.maxX && y >= 0 && y < WORLD_HEIGHT && z >= this.bounds.minZ && z < this.bounds.maxZ;
  }

  getVoxel(x: number, y: number, z: number): number {
    if (!this.contains(x, y, z)) return 0;
    const chunk = this.chunks.get(chunkKey(x >> 5, y >> 5, z >> 5));
    return chunk?.voxels[voxelIndex(x & 31, y & 31, z & 31)] ?? 0;
  }

  /** Fast generation path. Interactive edits should use applyEdits for neighbor invalidation. */
  setVoxel(x: number, y: number, z: number, material: number, trackRevision = true): boolean {
    if (!this.contains(x, y, z)) return false;
    if (!Number.isInteger(material) || material < 0 || material > 255) {
      throw new RangeError('Voxel material must be an integer from 0 to 255.');
    }
    const cx = x >> 5;
    const cy = y >> 5;
    const cz = z >> 5;
    const key = chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      if (material === 0) return false;
      chunk = { key, cx, cy, cz, voxels: new Uint8Array(CHUNK_SIZE ** 3), revision: 0 };
      this.chunks.set(key, chunk);
    }
    const index = voxelIndex(x & 31, y & 31, z & 31);
    if (chunk.voxels[index] === material) return false;
    chunk.voxels[index] = material;
    if (trackRevision) chunk.revision++;
    return true;
  }

  applyEdits(edits: readonly VoxelEdit[]): string[] {
    const dirty = new Set<string>();
    for (const edit of edits) {
      const { x, y, z, material } = edit;
      if (!this.setVoxel(x, y, z, material, false)) continue;
      const cx = x >> 5;
      const cy = y >> 5;
      const cz = z >> 5;
      dirty.add(chunkKey(cx, cy, cz));
      const addNeighbor = (nx: number, ny: number, nz: number) => {
        const key = chunkKey(nx, ny, nz);
        if (this.chunks.has(key)) dirty.add(key);
      };
      if ((x & 31) === 0) addNeighbor(cx - 1, cy, cz);
      if ((x & 31) === 31) addNeighbor(cx + 1, cy, cz);
      if ((y & 31) === 0) addNeighbor(cx, cy - 1, cz);
      if ((y & 31) === 31) addNeighbor(cx, cy + 1, cz);
      if ((z & 31) === 0) addNeighbor(cx, cy, cz - 1);
      if ((z & 31) === 31) addNeighbor(cx, cy, cz + 1);
    }
    for (const key of dirty) this.chunks.get(key)!.revision++;
    return [...dirty];
  }

  removeSphere(center: Vector3Like, radius: number): { edits: VoxelEdit[]; dirtyKeys: string[] } {
    if (!Number.isFinite(radius) || radius <= 0 || ![center.x, center.y, center.z].every(Number.isFinite)) {
      return { edits: [], dirtyKeys: [] };
    }
    const edits: VoxelEdit[] = [];
    const minX = Math.max(this.bounds.minX, Math.floor(center.x - radius));
    const maxX = Math.min(this.bounds.maxX - 1, Math.floor(center.x + radius));
    const minY = Math.max(0, Math.floor(center.y - radius));
    const maxY = Math.min(WORLD_HEIGHT - 1, Math.floor(center.y + radius));
    const minZ = Math.max(this.bounds.minZ, Math.floor(center.z - radius));
    const maxZ = Math.min(this.bounds.maxZ - 1, Math.floor(center.z + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if ((x + 0.5 - center.x) ** 2 + (y + 0.5 - center.y) ** 2 +
              (z + 0.5 - center.z) ** 2 <= radius ** 2 && this.getVoxel(x, y, z) !== 0) {
            edits.push({ x, y, z, material: 0 });
          }
        }
      }
    }
    return { edits, dirtyKeys: this.applyEdits(edits) };
  }

  /** Amanatides–Woo grid traversal. Distances assume a normalized direction. */
  raycast(origin: Vector3Like, direction: Vector3Like, maxDistance = 180): VoxelHit | null {
    if (maxDistance < 0 || ![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].every(Number.isFinite)) return null;
    const o = [origin.x, origin.y, origin.z];
    const d = [direction.x, direction.y, direction.z];
    if (d.every(value => value === 0)) return null;
    const lower = [this.bounds.minX, 0, this.bounds.minZ];
    const upper = [this.bounds.maxX, WORLD_HEIGHT, this.bounds.maxZ];
    let enter = 0;
    let leave = maxDistance;
    let normal: Vector3Like = { x: 0, y: 0, z: 0 };
    for (let axis = 0; axis < 3; axis++) {
      if (d[axis] === 0) {
        if (o[axis] < lower[axis] || o[axis] >= upper[axis]) return null;
        continue;
      }
      const a = (lower[axis] - o[axis]) / d[axis];
      const b = (upper[axis] - o[axis]) / d[axis];
      const near = Math.min(a, b);
      if (near > enter) {
        enter = near;
        normal = { x: 0, y: 0, z: 0 };
        if (axis === 0) normal.x = -Math.sign(d[axis]);
        if (axis === 1) normal.y = -Math.sign(d[axis]);
        if (axis === 2) normal.z = -Math.sign(d[axis]);
      }
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return null;
    }
    const epsilon = 1e-7;
    const cell = o.map((value, axis) => Math.floor(value + d[axis] * (enter + epsilon)));
    const step = d.map(value => Math.sign(value));
    const delta = d.map(value => value === 0 ? Infinity : Math.abs(1 / value));
    const next = d.map((value, axis) => value === 0 ? Infinity :
      ((cell[axis] + (step[axis] > 0 ? 1 : 0)) - o[axis]) / value);
    let distance = enter;
    while (distance <= leave && this.contains(cell[0], cell[1], cell[2])) {
      if (this.getVoxel(cell[0], cell[1], cell[2]) !== 0) {
        return { x: cell[0], y: cell[1], z: cell[2], normal, distance };
      }
      const axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
      distance = next[axis];
      cell[axis] += step[axis];
      next[axis] += delta[axis];
      normal = { x: 0, y: 0, z: 0 };
      if (axis === 0) normal.x = -step[axis];
      if (axis === 1) normal.y = -step[axis];
      if (axis === 2) normal.z = -step[axis];
    }
    return null;
  }
}
