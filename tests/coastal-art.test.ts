import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generate';
import { Material } from '../src/world/palette';
import { restyleLegacyLamps } from '../src/rendering/coastal-art';

describe('coastal lamp runtime style conversion', () => {
  it('removes the known oversized fixtures without cutting the deck, buildings or light-house', () => {
    const { world } = generateWorld();
    const deck = world.getVoxel(102, 14, 215);
    const building = world.getVoxel(150, 20, 180);
    const lighthouse = world.getVoxel(217, 47, 204);
    const lamps = restyleLegacyLamps(world);
    expect(lamps).toHaveLength(28);
    expect(world.getVoxel(113, 20, 215)).toBe(0);
    expect(world.getVoxel(112, 20, 214)).toBe(0);
    expect(world.getVoxel(102, 14, 215)).toBe(deck);
    expect(world.getVoxel(150, 20, 180)).toBe(building);
    expect(world.getVoxel(217, 47, 204)).toBe(lighthouse);
    expect(lighthouse).toBe(Material.Lamp);
  });

  it('does not replace a fixture that the saved player edits already damaged', () => {
    const { world } = generateWorld();
    world.applyEdits([{ x: 113, y: 17, z: 215, material: 0 }]);
    const lamps = restyleLegacyLamps(world);
    expect(lamps.some(lamp => lamp.x === 113 && lamp.z === 215)).toBe(false);
    expect(lamps).toHaveLength(27);
    expect(world.getVoxel(113, 17, 215)).toBe(0);
  });
});
