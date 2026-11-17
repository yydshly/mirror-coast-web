import { describe, expect, it } from 'vitest';
import { VoxelWalker, WALK_EYE_HEIGHT, type WalkObstacle } from '../src/input/walk';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';

function street(): VoxelWorld {
  const world = new VoxelWorld();
  for (let z = 4; z <= 48; z++) for (let x = 4; x <= 48; x++) world.setVoxel(x, 15, z, Material.Concrete);
  return world;
}

function simulate(walker: VoxelWalker, seconds: number, input = { x: 0, z: 0, jump: false }) {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) walker.update(1 / 60, input);
}

describe('voxel ground exploration', () => {
  it('blocks a normal-height table instead of automatically stepping onto it, while allowing a deliberate jump', () => {
    const walker = new VoxelWalker(street(), { x: 16.5, y: 16, z: 20.5 });
    walker.setObstacleProvider(() => [{ minX: 20, minY: 16, minZ: 19, maxX: 24.2, maxY: 16.75, maxZ: 21.6 }]);
    simulate(walker, 3, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeLessThan(19.72);
    expect(walker.position.y).toBeCloseTo(16, 4);
    simulate(walker, .9, { x: 1, z: 0, jump: true });
    expect(walker.position.x).toBeGreaterThan(20.5);
    expect(walker.position.y).toBeCloseTo(16.75, 3);
  });
  it('stops against a parked-car obstacle and supports a character placed on its roof', () => {
    const world = street();
    const car: WalkObstacle = { minX: 20, minY: 16, minZ: 19, maxX: 24.2, maxY: 17.65, maxZ: 21.6 };
    const walker = new VoxelWalker(world, { x: 16.5, y: 16, z: 20.5 });
    walker.setObstacleProvider(() => [car]);
    simulate(walker, 3, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeGreaterThan(19.5);
    expect(walker.position.x).toBeLessThan(19.72);
    expect(walker.position.y).toBeCloseTo(16, 4);
    walker.teleportEye({ x: 22, y: car.maxY + WALK_EYE_HEIGHT, z: 20.5 });
    simulate(walker, .5);
    expect(walker.position.y).toBeCloseTo(car.maxY, 4);
    expect(walker.grounded).toBe(true);
    expect(walker.canOccupy(walker.position)).toBe(true);
  });

  it('immediately removes prop collision when the live obstacle provider hides the prop', () => {
    const world = street();
    let obstacles: readonly WalkObstacle[] = [{ minX: 20, minY: 16, minZ: 19, maxX: 24.2, maxY: 18, maxZ: 21.6 }];
    const walker = new VoxelWalker(world, { x: 16.5, y: 16, z: 20.5 });
    walker.setObstacleProvider(() => obstacles);
    simulate(walker, 3, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeLessThan(20);
    obstacles = [];
    simulate(walker, 2, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeGreaterThan(25);
    expect(walker.position.y).toBeCloseTo(16, 4);
    expect(walker.grounded).toBe(true);
  });

  it('stands at human eye height and stops against a building wall', () => {
    const world = street();
    for (let y = 16; y <= 24; y++) for (let z = 12; z <= 28; z++) world.setVoxel(20, y, z, Material.Brick);
    const walker = new VoxelWalker(world, { x: 16.5, y: 16, z: 20.5 });
    simulate(walker, 3, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeGreaterThan(19.5);
    expect(walker.position.x).toBeLessThan(19.72);
    expect(walker.position.y).toBeCloseTo(16, 4);
    expect(walker.eyePosition.y).toBeCloseTo(16 + WALK_EYE_HEIGHT, 4);
    expect(walker.grounded).toBe(true);
    expect(walker.canOccupy(walker.position)).toBe(true);
  });

  it('cannot walk directly up a one-metre ledge', () => {
    const world = street();
    for (let x = 20; x <= 24; x++) for (let z = 12; z <= 28; z++) world.setVoxel(x, 16, z, Material.Concrete);
    for (let y = 16; y <= 18; y++) for (let z = 12; z <= 28; z++) world.setVoxel(25, y, z, Material.Brick);
    const walker = new VoxelWalker(world, { x: 17.5, y: 16, z: 20.5 });
    simulate(walker, 4, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeGreaterThan(19.5);
    expect(walker.position.x).toBeLessThan(19.72);
    expect(walker.position.y).toBeCloseTo(16, 4);
    expect(walker.grounded).toBe(true);
  });

  it('walks over a 20cm step but stops at an unassisted 50cm step',()=>{
    const walker=new VoxelWalker(street(),{x:17,y:16,z:20.5});
    walker.setObstacleProvider(()=>[
      {minX:20,maxX:23,minY:16,maxY:16.2,minZ:19,maxZ:22},
      {minX:23,maxX:26,minY:16,maxY:16.7,minZ:19,maxZ:22},
    ]);
    simulate(walker,5,{x:1,z:0,jump:false});
    expect(walker.position.x).toBeGreaterThan(22.5);expect(walker.position.x).toBeLessThan(22.72);
    expect(walker.position.y).toBeCloseTo(16.2,4);
  });

  it('does not chain one-metre terrain ledges into automatic mountain climbing',()=>{
    const world=street();
    for(let x=20;x<=32;x++)for(let z=18;z<=23;z++)for(let y=16;y<=16+x-20;y++)world.setVoxel(x,y,z,Material.Grass);
    const walker=new VoxelWalker(world,{x:17,y:16,z:20.5});
    simulate(walker,10,{x:1,z:0,jump:false});
    expect(walker.position.x).toBeLessThan(19.72);expect(walker.position.y).toBeCloseTo(16,4);
    expect(walker.recoveredLastStep).toBe(false);
  });

  it('falls onto lower real ground immediately after the supporting voxels are removed', () => {
    const world = street();
    for (let z = 29; z <= 33; z++) for (let x = 29; x <= 33; x++) world.setVoxel(x, 12, z, Material.Rock);
    const walker = new VoxelWalker(world, { x: 31.5, y: 16, z: 31.5 });
    world.applyEdits(Array.from({ length: 25 }, (_, index) => ({ x: 29 + index % 5, y: 15, z: 29 + Math.floor(index / 5), material: 0 })));
    walker.update(1 / 60, { x: 0, z: 0 });
    expect(walker.grounded).toBe(false);
    expect(walker.position.y).toBeLessThan(16);
    simulate(walker, 2);
    expect(walker.position.y).toBeCloseTo(13, 4);
    expect(walker.grounded).toBe(true);
  });

  it('allows walking through a freshly destroyed wall without waiting for worker meshes', () => {
    const world = street();
    for (let y = 16; y <= 24; y++) for (let z = 12; z <= 28; z++) world.setVoxel(20, y, z, Material.Brick);
    const walker = new VoxelWalker(world, { x: 17.5, y: 16, z: 20.5 });
    simulate(walker, 2, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeLessThan(20);
    const edits = [];
    for (let y = 16; y <= 19; y++) for (let z = 19; z <= 22; z++) edits.push({ x: 20, y, z, material: 0 });
    world.applyEdits(edits);
    simulate(walker, 2, { x: 1, z: 0, jump: false });
    expect(walker.position.x).toBeGreaterThan(24);
    expect(walker.position.y).toBeCloseTo(16, 4);
  });

  it('jumps with gravity, hits low ceilings, and does not repeatedly jump while the key is held', () => {
    const world = street();
    for (let z = 29; z <= 33; z++) for (let x = 29; x <= 33; x++) world.setVoxel(x, 19, z, Material.Trim);
    const walker = new VoxelWalker(world, { x: 31.5, y: 16, z: 31.5 });
    let high = walker.position.y;
    for (let frame = 0; frame < 180; frame++) {
      walker.update(1 / 60, { x: 0, z: 0, jump: true });
      high = Math.max(high, walker.position.y);
    }
    expect(high).toBeGreaterThan(16.9);
    expect(high + 1.8).toBeLessThanOrEqual(19.001);
    expect(walker.position.y).toBeCloseTo(16, 4);
    expect(walker.grounded).toBe(true);
  });

  it('finds a clear spawn near an obstructed eye-height position', () => {
    const world = street();
    for (let y = 16; y <= 30; y++) for (let z = 18; z <= 22; z++) for (let x = 18; x <= 22; x++) world.setVoxel(x, y, z, Material.Brick);
    const walker = new VoxelWalker(world, { x: 10.5, y: 16, z: 10.5 });
    walker.teleportEye({ x: 20.5, y: 17.68, z: 20.5 });
    expect(walker.canOccupy(walker.position)).toBe(true);
    expect(walker.grounded).toBe(true);
    expect(walker.position.y).toBe(16);
    expect(walker.position.distanceTo({ x: 20.5, y: 16, z: 20.5 })).toBeLessThan(6);
  });

  it('recovers from open water to the last dry footing and stays within world bounds', () => {
    const world = street();
    const walker = new VoxelWalker(world, { x: 46.5, y: 16, z: 20.5 });
    let recovered = false;
    for (let frame = 0; frame < 180; frame++) {
      walker.update(1 / 60, { x: 1, z: 0 });
      recovered ||= walker.recoveredLastStep;
    }
    expect(recovered).toBe(true);
    expect(walker.position.y).toBeGreaterThan(12);
    expect(walker.position.x).toBeLessThan(53);
    walker.teleportEye({ x: -20, y: 17.68, z: 20.5 });
    expect(walker.position.x).toBeGreaterThanOrEqual(.29);
    expect(walker.position.x).toBeLessThan(256);
    expect(walker.canOccupy(walker.position)).toBe(true);
  });
});
