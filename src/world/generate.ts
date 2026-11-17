import { Material } from './palette';
import { VoxelWorld, WORLD_HEIGHT, WORLD_SEED, WORLD_SIZE } from './voxel';
import { BuildingRegistry, worldIndex } from '../destruction/buildings';

export const SEA_LEVEL = 12;

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shorelineAt(x: number): number {
  return 179 + Math.round(4 * Math.sin(x * 0.036) + 3 * Math.sin(x * 0.079));
}

export function generateWorld(seed = WORLD_SEED): {
  world: VoxelWorld;
  spawn: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  buildingCount: number;
  buildings: BuildingRegistry;
} {
  const world = new VoxelWorld();
  const buildings = new BuildingRegistry();
  let buildingPositions: number[] | undefined;
  const random = randomSource(seed);
  const put = (x: number, y: number, z: number, material: number) => {
    world.setVoxel(x, y, z, material, false);
    if (buildingPositions && x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < WORLD_SIZE) {
      buildingPositions.push(worldIndex(x, y, z));
    }
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(WORLD_HEIGHT - 1, y1); y++) {
      for (let z = Math.max(0, z0); z <= Math.min(WORLD_SIZE - 1, z1); z++) {
        for (let x = Math.max(0, x0); x <= Math.min(WORLD_SIZE - 1, x1); x++) put(x, y, z, material);
      }
    }
  };

  // Solid terrain, including a gently sloped, visible seabed. Water is a separate renderer mesh.
  for (let z = 0; z < WORLD_SIZE; z++) for (let x = 0; x < WORLD_SIZE; x++) {
    const shore = shorelineAt(x);
    const distanceToSea = shore - z;
    const top = distanceToSea >= 6 ? 15 : distanceToSea >= 0 ?
      12 + Math.floor(distanceToSea / 2) : Math.max(3, 10 + Math.floor(distanceToSea * 0.14));
    for (let y = 0; y <= top; y++) {
      const material = y === top ? (distanceToSea < 8 ? Material.Sand : Material.Grass) :
        y < top - 3 ? Material.Rock : distanceToSea < 8 ? Material.Sand : Material.Dirt;
      put(x, y, z, material);
    }
  }

  const verticalRoads = [38, 84, 130, 176, 222];
  const horizontalRoads = [35, 80, 125, 164];
  for (const x of verticalRoads) {
    box(x - 6, 15, 0, x + 6, 15, 169, Material.Concrete);
    box(x - 4, 15, 0, x + 4, 15, 169, Material.Road);
    for (let z = 2; z < 167; z += 9) box(x, 15, z, x, 15, z + 3, Material.Stripe);
  }
  for (const z of horizontalRoads) {
    box(0, 15, z - 6, 255, 15, z + 6, Material.Concrete);
    box(0, 15, z - 4, 255, 15, z + 4, Material.Road);
    for (let x = 3; x < 252; x += 9) box(x, 15, z, x + 3, 15, z, Material.Stripe);
  }
  // Waterfront promenade and a low seawall leave the shoreline legible from above.
  box(0, 15, 170, 255, 15, 173, Material.Concrete);
  for (let x = 0; x < WORLD_SIZE; x++) {
    if (shorelineAt(x) >= 176) put(x, 15, 174, Material.Trim);
  }
  for (const x of verticalRoads) for (const z of horizontalRoads) {
    box(x - 4, 15, z - 4, x + 4, 15, z + 4, Material.Road);
    for (let stripe = -3; stripe <= 3; stripe += 2) {
      box(x + stripe, 15, z - 6, x + stripe, 15, z - 5, Material.Trim);
      box(x + stripe, 15, z + 5, x + stripe, 15, z + 6, Material.Trim);
    }
  }

  let buildingCount = 0;
  const wallColors = [Material.Cream, Material.Brick, Material.Blue, Material.Mint];
  function building(x0: number, z0: number, width: number, depth: number, height: number): void {
    buildingPositions = [];
    const ground = 16;
    const top = ground + height - 1;
    const wall = wallColors[Math.floor(random() * wallColors.length)];
    const roof = random() > 0.48 ? Material.Terracotta : Material.Roof;
    const x1 = x0 + width - 1;
    const z1 = z0 + depth - 1;
    // These are solid voxel volumes, not extruded facade meshes.
    box(x0, ground, z0, x1, top, z1, wall);
    for (let y = ground; y <= top; y++) {
      const floorOffset = (y - ground) % 4;
      const floorBand = floorOffset === 3;
      for (let x = x0; x <= x1; x++) {
        const window = (x - x0) % 4 >= 1 && (x - x0) % 4 <= 2 && floorOffset >= 1 && floorOffset <= 2;
        for (const z of [z0, z1]) {
          if (floorBand) put(x, y, z, Material.Trim);
          else if (window) put(x, y, z, random() > 0.26 ? Material.Window : Material.DarkWindow);
        }
      }
      for (let z = z0 + 1; z < z1; z++) {
        const window = (z - z0) % 4 >= 1 && (z - z0) % 4 <= 2 && floorOffset >= 1 && floorOffset <= 2;
        for (const x of [x0, x1]) {
          if (floorBand) put(x, y, z, Material.Trim);
          else if (window) put(x, y, z, random() > 0.26 ? Material.Window : Material.DarkWindow);
        }
      }
    }
    box(x0 - 1, top + 1, z0 - 1, x1 + 1, top + 1, z1 + 1, Material.Trim);
    box(x0, top + 2, z0, x1, top + 2, z1, roof);
    if (width > 10 && depth > 10) {
      box(x0 + 3, top + 3, z0 + 3, Math.min(x1 - 2, x0 + 6), top + 5, Math.min(z1 - 2, z0 + 6), Material.Concrete);
    }
    const doorway = Math.floor((x0 + x1) / 2);
    box(doorway, ground, z1, doorway + 1, ground + 2, z1, Material.DarkWindow);
    buildings.add(`city-building-${String(buildingCount + 1).padStart(3, '0')}`, z0 > 170 ? '码头仓库' : `街区建筑 ${buildingCount + 1}`, ground, buildingPositions);
    buildingPositions = undefined;
    buildingCount++;
  }

  const lotsX = [[8, 27], [49, 73], [95, 119], [141, 165], [187, 211], [234, 248]];
  const lotsZ = [[7, 24], [47, 68], [92, 113], [137, 153]];
  for (let row = 0; row < lotsZ.length; row++) for (let column = 0; column < lotsX.length; column++) {
    // A small park at the northwestern corner breaks the street grid.
    if (row === 0 && column === 0) continue;
    const [left, right] = lotsX[column];
    const [front, back] = lotsZ[row];
    const depth = back - front - Math.floor(random() * 3);
    const skyline = row === 1 || row === 2;
    const maxFloors = skyline && column >= 1 && column <= 4 ? 10 : row === 3 ? 5 : 7;
    const height = (3 + Math.floor(random() * (maxFloors - 2))) * 4;
    if (skyline && column >= 1 && column <= 4) {
      building(left, front, 10, depth, height);
      building(left + 14, front + 1, right - left - 13, depth - 1, Math.max(12, height - 4 + Math.floor(random() * 3) * 4));
    } else building(left, front, right - left + 1, depth, height);
  }

  function tree(x: number, z: number, height = 6): void {
    box(x, 16, z, x, 16 + height, z, Material.Wood);
    for (let y = 18 + height - 3; y <= 18 + height; y++) {
      const radius = y === 18 + height ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dz) <= radius + 1) put(x + dx, y, z + dz, Material.Leaves);
      }
    }
  }
  for (const [x, z] of [[12, 12], [23, 12], [12, 23], [24, 23]]) tree(x, z, 6);
  for (let x = 12; x < 252; x += 18) {
    if (verticalRoads.every(road => Math.abs(road - x) > 7)) tree(x, 157, 5);
  }
  function lamp(x: number, z: number, base = 16): void {
    box(x, base, z, x, base + 5, z, Material.Roof);
    box(x - 1, base + 5, z - 1, x + 1, base + 5, z + 1, Material.Roof);
    put(x, base + 6, z, Material.Lamp);
  }
  for (let x = 10; x < 251; x += 20) lamp(x, 172);
  for (const x of [44, 124, 216]) for (const z of [44, 89, 134]) lamp(x, z);

  // Timber pier, piles and a modest harbor warehouse.
  box(102, 13, 173, 113, 14, 216, Material.Wood);
  box(95, 14, 204, 123, 14, 215, Material.Wood);
  for (const x of [103, 112]) for (const z of [184, 196, 210]) box(x, 5, z, x, 12, z, Material.Wood);
  for (const x of [102, 113]) for (const z of [184, 200, 215]) lamp(x, z, 15);
  // Dockside storage is another solid, destructible voxel building.
  box(143, 14, 174, 163, 15, 190, Material.Concrete);
  building(145, 175, 17, 13, 12);

  // Walkway and striped lighthouse make a clear coastal landmark.
  box(214, 13, 173, 219, 14, 208, Material.Concrete);
  const lighthouseX = 217;
  const lighthouseZ = 204;
  buildingPositions = [];
  for (let y = 10; y <= 44; y++) {
    const radius = y < 17 ? 6 : y < 39 ? 4 : y < 43 ? 5 : 6;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      let material: number = y >= 39 && y <= 42 ? Material.Window :
        y >= 17 && Math.floor((y - 17) / 5) % 2 === 1 ? Material.Red : Material.Trim;
      if (y === 38 || y === 43 || y === 44) material = Material.Roof;
      put(lighthouseX + dx, y, lighthouseZ + dz, material);
    }
  }
  box(lighthouseX - 1, 45, lighthouseZ - 1, lighthouseX + 1, 46, lighthouseZ + 1, Material.Red);
  put(lighthouseX, 47, lighthouseZ, Material.Lamp);
  buildings.add('city-lighthouse', '海湾灯塔', 10, buildingPositions);
  buildingPositions = undefined;
  buildingCount++;

  // Generation is one immutable base version; later edits increment revisions per batch.
  for (const chunk of world.chunks.values()) chunk.revision = 1;
  return {
    world,
    spawn: { x: 235, y: 72, z: 247 },
    lookAt: { x: 120, y: 25, z: 111 },
    buildingCount,
    buildings,
  };
}
