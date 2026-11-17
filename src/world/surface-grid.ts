import { CHUNK_SIZE, chunkKey, WORLD_HEIGHT, type VoxelWorld, type WorldBounds } from './voxel';

export type SurfaceGrid = { bounds: WorldBounds; width: number; depth: number; data: Uint8Array };

/** One exact highest-solid height per column, shared by rain and exposure queries. */
export function buildSurfaceGrid(world: VoxelWorld): SurfaceGrid {
  const bounds = { ...world.bounds };
  const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
  const grid: SurfaceGrid = { bounds, width, depth, data: new Uint8Array(width * depth) };
  for (const chunk of [...world.chunks.values()].sort((a,b) => b.cy - a.cy)) {
    const ox = chunk.cx * CHUNK_SIZE, oy = chunk.cy * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
      const ix = ox + x - bounds.minX, iz = oz + z - bounds.minZ;
      if (ix < 0 || ix >= width || iz < 0 || iz >= depth) continue;
      const index = ix + iz * width;
      if (grid.data[index] >= oy + CHUNK_SIZE) continue;
      for (let y = CHUNK_SIZE - 1; y >= 0; y--) if (chunk.voxels[x + CHUNK_SIZE * (z + CHUNK_SIZE * y)]) {
        grid.data[index] = Math.max(grid.data[index], oy + y + 1); break;
      }
    }
  }
  return grid;
}

export function surfaceGridHeight(grid: SurfaceGrid, x: number, z: number): number {
  const ix = Math.floor(x) - grid.bounds.minX, iz = Math.floor(z) - grid.bounds.minZ;
  return ix >= 0 && ix < grid.width && iz >= 0 && iz < grid.depth ? grid.data[ix + iz * grid.width] : 0;
}

/** Editing one block column must not rescan the entire kilometre of terrain. */
export function refreshSurfaceGrid(world: VoxelWorld, grid: SurfaceGrid, dirtyKeys: Iterable<string>): void {
  const columns = new Set<string>();
  for (const key of dirtyKeys) { const [cx,,cz] = key.split(',').map(Number); columns.add(`${cx},${cz}`); }
  for (const key of columns) {
    const [cx,cz] = key.split(',').map(Number), ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const chunks = Array.from({ length: Math.ceil(WORLD_HEIGHT / CHUNK_SIZE) }, (_,cy) => world.chunks.get(chunkKey(cx,cy,cz)));
    for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
      const ix = ox + x - grid.bounds.minX, iz = oz + z - grid.bounds.minZ;
      if (ix < 0 || ix >= grid.width || iz < 0 || iz >= grid.depth) continue;
      let height = 0;
      for (let cy = chunks.length - 1; cy >= 0 && !height; cy--) {
        const chunk = chunks[cy]; if (!chunk) continue;
        for (let y = CHUNK_SIZE - 1; y >= 0; y--) if (chunk.voxels[x + CHUNK_SIZE * (z + CHUNK_SIZE * y)]) { height = cy * CHUNK_SIZE + y + 1; break; }
      }
      grid.data[ix + iz * grid.width] = height;
    }
  }
}
