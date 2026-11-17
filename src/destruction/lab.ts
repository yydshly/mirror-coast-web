import { Material } from '../world/palette';
import { VoxelWorld, WORLD_HEIGHT, WORLD_SEED, WORLD_SIZE } from '../world/voxel';
import { BuildingRegistry, worldIndex } from './buildings';
import type { Vec3 } from './types';

export const LAB_WORLD_VERSION = 'mirror-coast-collapse-lab-v1';
export const LAB_TEST_BUILDING_ID = 'collapse-lab-two-wings';
export const LAB_SPAWN: Vec3 = { x: 131, y: 28, z: 166 };
export const LAB_LOOK_AT: Vec3 = { x: 110, y: 25, z: 137 };
/** Real radius-3.2 blasts: first two disconnect the left wing; last two test the right. */
export const LAB_SHOTS: Vec3[] = [
  { x: 105.5, y: 19.5, z: 140.5 }, { x: 105.5, y: 19.5, z: 133.5 },
  { x: 113.5, y: 19.5, z: 140.5 }, { x: 113.5, y: 19.5, z: 133.5 },
];

/** The lab has its own world key. The existing city and its saves are never regenerated. */
export function generateCollapseLab(_seed = WORLD_SEED): {
  world: VoxelWorld; buildings: BuildingRegistry; spawn: Vec3; lookAt: Vec3; buildingCount: number;
} {
  const world = new VoxelWorld();
  const buildings = new BuildingRegistry();
  const positions: number[] = [];
  let capture = false;
  const put = (x: number, y: number, z: number, material: number) => {
    world.setVoxel(x, y, z, material, false);
    if (capture) positions.push(worldIndex(x, y, z));
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(WORLD_HEIGHT - 1, y1); y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, material);
  };
  for (let z = 0; z < WORLD_SIZE; z++) for (let x = 0; x < WORLD_SIZE; x++) {
    const edge = 182 + Math.round(Math.sin(x * .04) * 4);
    const top = z < edge - 5 ? 15 : z < edge ? 12 + Math.floor((edge - z) / 2) : Math.max(3, 10 - Math.floor((z - edge) * .2));
    for (let y = 0; y <= top; y++) put(x, y, z, y === top ? (z > edge - 7 ? Material.Sand : Material.Grass) : Material.Rock);
  }
  box(91, 15, 121, 133, 15, 154, Material.Concrete);
  box(0, 15, 159, 255, 15, 166, Material.Road);
  for (let x = 3; x < 254; x += 9) box(x, 15, 162, x + 3, 15, 162, Material.Stripe);
  box(90, 15, 174, 135, 15, 177, Material.Concrete);
  // Painted ground boundaries give the two independent load paths a readable footprint.
  box(101, 15, 129, 120, 15, 129, Material.Stripe);
  box(101, 15, 147, 120, 15, 147, Material.Stripe);
  capture = true;
  for (const left of [104, 112]) {
    const wall = left === 104 ? Material.Brick : Material.Cream;
    for (const z of [133, 140]) box(left + 1, 16, z, left + 2, 23, z + 1, Material.Concrete);
    box(left, 24, 132, left + 5, 25, 143, Material.Trim);
    for (let y = 26; y <= 32; y++) for (let z = 132; z <= 143; z++) for (let x = left; x <= left + 5; x++) {
      if (x !== left && x !== left + 5 && z !== 132 && z !== 143) continue;
      const window = y >= 28 && y <= 30 && ((z === 132 || z === 143) ? x > left && x < left + 5 : z % 4 < 2);
      put(x, y, z, window ? Material.Window : wall);
    }
    box(left, 33, 132, left + 5, 33, 143, Material.Trim);
    box(left, 34, 132, left + 5, 34, 143, Material.Roof);
  }
  capture = false;
  buildings.add(LAB_TEST_BUILDING_ID, '双翼支撑试验楼', 16, positions);
  // Unregistered surroundings are terrain/props and never mistaken for load-bearing building voxels.
  for (const x of [92, 129]) {
    box(x, 16, 150, x, 21, 150, Material.Roof);
    put(x, 22, 150, Material.Lamp);
  }
  for (const chunk of world.chunks.values()) chunk.revision = 1;
  return { world, buildings, spawn: { ...LAB_SPAWN }, lookAt: { ...LAB_LOOK_AT }, buildingCount: 1 };
}
