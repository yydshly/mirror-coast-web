import { BuildingRegistry, worldIndex } from '../destruction/buildings';
import { Material as M } from './palette';
import type { VoxelWorld } from './voxel';

/** An additive district: no cell in the original generated city is overwritten. */
export function addHarborQuarter(world: VoxelWorld, buildings: BuildingRegistry): void {
  let owned: number[] | undefined;
  const put = (x: number, y: number, z: number, material: number) => {
    if (world.getVoxel(x, y, z)) return;
    world.setVoxel(x, y, z, material, false);
    owned?.push(worldIndex(x, y, z));
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, m);
  };
  // A timber settlement on piles, connected to the existing pier by a broad jetty.
  box(8, 14, 211, 65, 14, 250, M.Wood);
  box(60, 14, 212, 103, 14, 216, M.Wood);
  for (let x = 10; x <= 64; x += 9) for (const z of [213, 231, 248]) box(x, 5, z, x, 13, z, M.Wood);
  for (let x = 68; x <= 100; x += 8) for (const z of [212, 216]) box(x, 5, z, x, 13, z, M.Wood);
  const styles = [
    { wall: M.Cream, roof: M.Terracotta, height: 5 },
    { wall: M.Blue, roof: M.Roof, height: 7 },
    { wall: M.Brick, roof: M.Roof, height: 4 },
    { wall: M.Mint, roof: M.Terracotta, height: 5 },
    { wall: M.Wood, roof: M.Roof, height: 4 },
    { wall: M.Cream, roof: M.Terracotta, height: 6 },
  ];
  const names = ['海盐面包房', '潮汐旅舍', '渔具铺', '港口食堂', '修船工坊', '海边小屋'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const i = row * 3 + col, style = styles[i];
    const x0 = [12, 31, 50][col], x1 = [25, 44, 62][col];
    const z0 = row ? 237 : 218, z1 = row ? 247 : 227;
    const front = row ? z0 : z1, back = row ? z1 : z0;
    const door = x0 + 4, top = 15 + style.height;
    owned = [];
    box(x0, 15, z0, x1, 15, z1, M.Wood);
    for (let y = 16; y <= top; y++) {
      for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) {
        // Real, open doors and hollow interiors are walkable and destructible.
        if (z === front && x >= door && x <= door + 1 && y <= 18) continue;
        const window = y >= 17 && y <= 18 && ((x - x0) % 6 === 2 || (x - x0) % 6 === 3);
        put(x, y, z, window ? M.Window : style.wall);
      }
      for (let z = z0 + 1; z < z1; z++) for (const x of [x0, x1]) {
        const window = y >= 17 && y <= 18 && z >= z0 + 3 && z <= z0 + 5;
        put(x, y, z, window ? M.DarkWindow : style.wall);
      }
    }
    // Different ridge heights and gable ends break the original flat-roof rhythm.
    for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      const lift = Math.floor(Math.min(z - z0 + 1, z1 + 1 - z) / 2);
      put(x, top + 1 + lift, z, style.roof);
      if ((x === x0 || x === x1) && z >= z0 && z <= z1) for (let y = top + 1; y < top + 1 + lift; y++) put(x, y, z, style.wall);
    }
    box(x1 - 2, top + 2, back, x1 - 1, top + 5, back + (row ? 0 : 1), M.Brick);
    // A warm rear shelf/counter gives the open doorway depth instead of a dark void.
    box(x0 + 2, 16, row ? z1 - 2 : z0 + 2, x1 - 2, 16, row ? z1 - 2 : z0 + 2, M.Wood);
    put(x1 - 2, 18, row ? z1 - 1 : z0 + 1, M.Lamp);
    buildings.add(`harbor-${i + 1}`, names[i], 15, owned);
    owned = undefined;
  }
  for (const chunk of world.chunks.values()) chunk.revision = Math.max(1, chunk.revision);
}
