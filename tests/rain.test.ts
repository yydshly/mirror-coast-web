import { describe, expect, it } from 'vitest';
import { buildRainRoofMap, rainSurfaceAt } from '../src/rendering/rain';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';

describe('rain real-voxel surface clipping', () => {
  it('uses the highest roof per column and the sea outside or below exposed terrain', () => {
    const world = new VoxelWorld();
    world.applyEdits([
      { x: 20, y: 15, z: 220, material: Material.Wood },
      { x: 20, y: 29, z: 220, material: Material.Roof },
      { x: 21, y: 14, z: 220, material: Material.Wood },
      { x: 22, y: 3, z: 220, material: Material.Sand },
    ]);
    const roofs = buildRainRoofMap(world);
    expect(rainSurfaceAt(roofs, 20.5, 220.5)).toBe(30);
    expect(rainSurfaceAt(roofs, 21.5, 220.5)).toBe(15);
    expect(rainSurfaceAt(roofs, 22.5, 220.5)).toBe(12);
    expect(rainSurfaceAt(roofs, -1, 220)).toBe(12);
  });

  it('responds to a destroyed roof and handles boundaries between vertically stacked chunks', () => {
    const world = new VoxelWorld();
    world.applyEdits([
      { x: 31, y: 15, z: 32, material: Material.Concrete },
      { x: 31, y: 32, z: 32, material: Material.Roof },
    ]);
    expect(rainSurfaceAt(buildRainRoofMap(world), 31.2, 32.2)).toBe(33);
    world.applyEdits([{ x: 31, y: 32, z: 32, material: 0 }]);
    expect(rainSurfaceAt(buildRainRoofMap(world), 31.2, 32.2)).toBe(16);
  });
});
