import { palette, Material } from './palette';
import { CHUNK_SIZE, WORLD_HEIGHT, VoxelWorld, type Chunk } from './voxel';

export interface MeshInput {
  key: string;
  revision: number;
  cx: number;
  cy: number;
  cz: number;
  /** Owned copy of 32³ chunk plus a one-voxel halo on every side. */
  halo: Uint8Array;
}
export interface MeshResult {
  key: string;
  revision: number;
  cx: number;
  cy: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  glow: Float32Array;
  surfaceId:Float32Array;
  indices: Uint32Array;
}

const PAD = CHUNK_SIZE + 2;
const index = (x: number, y: number, z: number) => x + PAD * (z + PAD * y);
const faces = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] },
  { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]] },
].map(face => {
  const axes = [0, 1, 2].filter(axis => face.normal[axis] === 0);
  return { ...face, axis: face.normal.findIndex(value => value !== 0), u: axes[0], v: axes[1],
    delta: face.normal[0] + face.normal[2] * PAD + face.normal[1] * PAD * PAD };
});
const haloStrides = [1, PAD * PAD, PAD];

export function createMeshInput(world: VoxelWorld, key: string): MeshInput | null {
  const chunk = world.chunks.get(key);
  if (!chunk) return null;
  const halo = new Uint8Array(PAD ** 3);
  const ox = chunk.cx * CHUNK_SIZE - 1;
  const oy = chunk.cy * CHUNK_SIZE - 1;
  const oz = chunk.cz * CHUNK_SIZE - 1;
  // 27 map lookups plus row copies replace 39,304 per-voxel string/map lookups.
  const neighbors: Array<Chunk | undefined> = new Array(27);
  for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    neighbors[dx + 1 + 3 * (dz + 1 + 3 * (dy + 1))] = world.chunks.get(`${chunk.cx + dx},${chunk.cy + dy},${chunk.cz + dz}`);
  }
  const bounds = world.bounds;
  for (let y = 0; y < PAD; y++) {
    const wy = oy + y;
    if (wy < 0 || wy >= WORLD_HEIGHT) continue;
    const dy = (wy >> 5) - chunk.cy;
    for (let z = 0; z < PAD; z++) {
      const wz = oz + z;
      if (wz < bounds.minZ || wz >= bounds.maxZ) continue;
      const dz = (wz >> 5) - chunk.cz;
      for (let x = 0; x < PAD;) {
        const wx = ox + x, cx = wx >> 5;
        const count = Math.min(PAD - x, CHUNK_SIZE - (wx & 31));
        const start = Math.max(0, bounds.minX - wx);
        const end = Math.min(count, bounds.maxX - wx);
        const neighbor = neighbors[cx - chunk.cx + 1 + 3 * (dz + 1 + 3 * (dy + 1))];
        if (neighbor && start < end) {
          const source = ((wx + start) & 31) + CHUNK_SIZE * ((wz & 31) + CHUNK_SIZE * (wy & 31));
          halo.set(neighbor.voxels.subarray(source, source + end - start), index(x + start, y, z));
        }
        x += count;
      }
    }
  }
  return { key, revision: chunk.revision, cx: chunk.cx, cy: chunk.cy, cz: chunk.cz, halo };
}

export function meshChunk(input: MeshInput): MeshResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const glow: number[] = [];
  const surfaceId:number[]=[];
  const indices: number[] = [];
  const masks = faces.map(() => new Map<number, Uint8Array>());
  const emit = (face: typeof faces[number], material: number, x: number, y: number, z: number, ao: number, width = 1, height = 1, flatTerrain = false) => {
    const appearance = palette[material] ?? palette[Material.Rock];
    const first = positions.length / 3;
    const scale = [1, 1, 1]; scale[face.u] = width; scale[face.v] = height;
    const grain = flatTerrain ? 1 : 1 + (((x + input.cx * 32) * 13 + (y + input.cy * 32) * 19 + (z + input.cz * 32) * 7) % 11 - 5) * .002;
    for (let i = 0; i < 4; i++) {
      const corner = face.corners[i];
      positions.push(x + corner[0] * scale[0], y + corner[1] * scale[1], z + corner[2] * scale[2]);
      normals.push(...face.normal);
      const shade = (.72 + ((ao >> (i * 2)) & 3) / 3 * .28) * grain;
      colors.push(appearance.color[0] * shade, appearance.color[1] * shade, appearance.color[2] * shade);
      glow.push(appearance.glow);
      surfaceId.push(material);
    }
    indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
  };
  for (let y = 0; y < CHUNK_SIZE; y++) for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) {
    const center = index(x + 1, y + 1, z + 1);
    const material = input.halo[center];
    if (material === 0) continue;
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f], outside = center + face.delta;
      if (input.halo[outside] !== 0) continue;
      let ao = 0;
      for (let i = 0; i < 4; i++) {
        const corner = face.corners[i];
        const du = (corner[face.u] === 0 ? -1 : 1) * haloStrides[face.u];
        const dv = (corner[face.v] === 0 ? -1 : 1) * haloStrides[face.v];
        const a = input.halo[outside + du] !== 0 ? 1 : 0;
        const b = input.halo[outside + dv] !== 0 ? 1 : 0;
        const c = input.halo[outside + du + dv] !== 0 ? 1 : 0;
        ao |= (a && b ? 0 : 3 - a - b - c) << (i * 2);
      }
      // Only terrain with constant contact shading is merged. Window rhythms,
      // building trim and nonuniform concave AO retain their original metre faces.
      if (material >= Material.Rock && material <= Material.Sand && ao === (ao & 3) * 85) {
        const cell = [x, y, z], slice = cell[face.axis];
        let mask = masks[f].get(slice);
        if (!mask) { mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE); masks[f].set(slice, mask); }
        mask[cell[face.u] + CHUNK_SIZE * cell[face.v]] = material * 4 + (ao & 3) + 1;
      } else emit(face, material, x, y, z, ao);
    }
  }
  for (let f = 0; f < faces.length; f++) for (const [slice, mask] of masks[f]) {
    const face = faces[f];
    for (let v = 0; v < CHUNK_SIZE; v++) for (let u = 0; u < CHUNK_SIZE;) {
      const key = mask[u + CHUNK_SIZE * v];
      if (!key) { u++; continue; }
      let width = 1, height = 1;
      while (u + width < CHUNK_SIZE && mask[u + width + CHUNK_SIZE * v] === key) width++;
      rows: while (v + height < CHUNK_SIZE) {
        for (let i = 0; i < width; i++) if (mask[u + i + CHUNK_SIZE * (v + height)] !== key) break rows;
        height++;
      }
      for (let row = 0; row < height; row++) mask.fill(0, u + CHUNK_SIZE * (v + row), u + width + CHUNK_SIZE * (v + row));
      const cell = [0, 0, 0]; cell[face.axis] = slice; cell[face.u] = u; cell[face.v] = v;
      const material = Math.floor((key - 1) / 4), occlusion = (key - 1) & 3;
      emit(face, material, cell[0], cell[1], cell[2], occlusion * 85, width, height, true);
      u += width;
    }
  }
  return {
    key: input.key, revision: input.revision, cx: input.cx, cy: input.cy, cz: input.cz,
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    colors: new Float32Array(colors), glow: new Float32Array(glow), surfaceId:new Float32Array(surfaceId),indices: new Uint32Array(indices),
  };
}
