import { afterEach, describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Quaternion, Scene, Vector3 } from 'three';
import { collectNearbyObstacles, orientedBoxBounds, type SceneObstacle } from '../src/input/scene-collisions';
import { VoxelWalker } from '../src/input/walk';
import { CoastalArt } from '../src/rendering/coastal-art';
import { StreetArt } from '../src/rendering/street-art';
import { CollapsePhysics } from '../src/destruction/physics';
import { BuildingRegistry } from '../src/destruction/buildings';
import type { RubbleFragment } from '../src/destruction/types';
import { generateWorld } from '../src/world/generate';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';
import { addHarborQuarter } from '../src/world/harbor-quarter';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()));

function street(): VoxelWorld {
  const world = new VoxelWorld();
  for (let z = 4; z < 48; z++) for (let x = 4; x < 48; x++) world.setVoxel(x, 15, z, Material.Concrete);
  return world;
}

async function physics(): Promise<CollapsePhysics> {
  const material = new MeshStandardMaterial(); cleanup.push(() => material.dispose());
  const result = await CollapsePhysics.create(new Scene(), material, { onStateChange: () => {} });
  cleanup.push(() => result.dispose()); return result;
}

function fragment(rotation = { x: 0, y: 0, z: 0, w: 1 }): RubbleFragment {
  return { id: 'walk-rubble', buildingId: 'walk-test', size: { x: 4, y: 2, z: 1 },
    voxels: [[0, 0, 0, Material.Brick], [3, 1, 0, Material.Brick]], position: { x: 20, y: 19, z: 20 }, rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, state: 'settled' };
}

describe('visible scene collision providers', () => {
  it.each([108, 216])('keeps the real waterfront entrance at x=%i passable after enabling railing collision', x => {
    const { world, buildings } = generateWorld();
    const art = new CoastalArt(new Scene(), world, buildings, { facades: false }); cleanup.push(() => art.dispose());
    const walker = new VoxelWalker(world, { x: x + .5, y: 16, z: 171 });
    walker.setObstacleProvider(() => art.obstacles);
    for (let frame = 0; frame < 240; frame++) walker.update(1 / 60, { x: 0, z: 1 });
    expect(walker.position.z).toBeGreaterThan(181);
    expect(walker.position.y).toBeCloseTo(15, 4);
    expect(walker.canOccupy(walker.position)).toBe(true);
  });
  it('treats the actual harbor counter as furniture and releases an individually destroyed section', () => {
    const { world, buildings } = generateWorld(); addHarborQuarter(world, buildings);
    const art = new StreetArt(new Scene(), world, buildings); cleanup.push(() => art.dispose());
    const walker = new VoxelWalker(world, { x: 17.3, y: 16, z: 225.8 });
    let nearby=collectNearbyObstacles(walker.position,[art.obstacles],10,6);
    walker.setObstacleProvider(() => nearby);
    for (let frame = 0; frame < 240; frame++) walker.update(1 / 60, { x: 0, z: -1 });
    expect(walker.position.z).toBeGreaterThan(221.28);
    expect(walker.position.z).toBeLessThan(221.4);
    expect(walker.position.y).toBeCloseTo(16, 4);
    const stopped = walker.position.clone();
    for (let frame = 0; frame < 120; frame++) walker.update(1 / 60, { x: 0, z: -1 });
    expect(walker.position.distanceTo(stopped)).toBeLessThan(.002);
    art.sync(world.applyEdits([{ x: 17, y: 16, z: 220, material: 0 }]));
    nearby=collectNearbyObstacles(walker.position,[art.obstacles],10,6);
    for (let frame = 0; frame < 90; frame++) walker.update(1 / 60, { x: 0, z: -1 });
    // The real tray still bridges this opening on its two remaining end
    // supports. It must stay solid until those actual supports are removed.
    expect(walker.position.z).toBeLessThan(stopped.z-.05);
    expect(walker.position.z).toBeGreaterThan(221.15);
    art.sync(world.applyEdits([16,18].map(x=>({x,y:16,z:220,material:0}))));
    nearby=collectNearbyObstacles(walker.position,[art.obstacles],10,6);
    for(let frame=0;frame<90;frame++)walker.update(1/60,{x:0,z:-1});
    expect(walker.position.z).toBeLessThan(220);
  });
  it('encloses every transformed corner of rotated rubble and excludes distant unrelated bounds', () => {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), .81);
    const center = { x: 30, y: 17, z: 30 }, half = { x: 3, y: 1.2, z: .5 };
    const bounds = orientedBoxBounds(center, rotation, half);
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = new Vector3(x * half.x, y * half.y, z * half.z).applyQuaternion(rotation).add(new Vector3().copy(center));
      expect(corner.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6); expect(corner.x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
      expect(corner.y).toBeGreaterThanOrEqual(bounds.minY - 1e-6); expect(corner.y).toBeLessThanOrEqual(bounds.maxY + 1e-6);
      expect(corner.z).toBeGreaterThanOrEqual(bounds.minZ - 1e-6); expect(corner.z).toBeLessThanOrEqual(bounds.maxZ + 1e-6);
    }
    const far = { minX: 150, maxX: 152, minY: 0, maxY: 5, minZ: 150, maxZ: 152 };
    expect(collectNearbyObstacles(center, [[far], [bounds]], 8)).toEqual([bounds]);
  });

  it('blocks a walker at the rendered coastal railing and releases the same panel after its support is destroyed', () => {
    const { world, buildings } = generateWorld();
    const art = new CoastalArt(new Scene(), world, buildings, { facades: false }); cleanup.push(() => art.dispose());
    const walker = new VoxelWalker(world, { x: 74.5, y: 16, z: 171 });
    walker.setObstacleProvider(() => art.obstacles);
    for (let frame = 0; frame < 180; frame++) walker.update(1 / 60, { x: 0, z: 1 });
    expect(walker.position.z).toBeLessThan(173.5);
    expect(walker.position.z).toBeGreaterThan(173);
    const dirty = world.applyEdits([{ x: 72, y: 15, z: 173, material: 0 }]); art.sync(dirty);
    for (let frame = 0; frame < 60; frame++) walker.update(1 / 60, { x: 0, z: 1 });
    expect(walker.position.z).toBeGreaterThan(175);
  });

  it('exposes current rotated rubble, tracks actual falling motion, and removes replaced rubble collision', async () => {
    const simulation = await physics();
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    simulation.restore([fragment(q)]);
    expect(simulation.walkObstacles).toHaveLength(2); // Only the two rendered cells block movement.
    const bounds = simulation.walkObstacles[0];
    expect(bounds.maxX - bounds.minX).toBeCloseTo(2 / Math.sqrt(2), 5);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(2 / Math.sqrt(2), 5);
    const falling = fragment(); falling.state = 'falling'; falling.position.y = 27;
    simulation.restore([falling]); const originalY = simulation.walkObstacles[0].minY;
    for (let frame = 0; frame < 45; frame++) simulation.update(1 / 60);
    expect(simulation.walkObstacles[0].minY).toBeLessThan(originalY - 1);
    simulation.restore([]); expect(simulation.walkObstacles).toEqual([]);
  });

  it('tracks vehicle hull and tail bounds when the shared body moves and disposes', async () => {
    const simulation = await physics();
    const vehicle = simulation.createVehicle({ x: 28, y: 18, z: 24 }, () => {});
    expect(simulation.walkObstacles).toHaveLength(7);
    expect(simulation.walkObstacles.some(b => b.maxZ > 28)).toBe(true);
    vehicle.body.setTranslation({ x: 38, y: 18, z: 24 }, true);
    // Restoring a paused aircraft must move its walking bounds without a step.
    expect(simulation.walkObstacles.every(b => b.minX > 30)).toBe(true);
    vehicle.setActive(true); simulation.update(1 / 60);
    expect(simulation.walkObstacles.every(b => b.minX > 30)).toBe(true);
    vehicle.dispose(); expect(simulation.walkObstacles).toEqual([]);
  });

  it('publishes moving pedestrians and keeps their next steps outside the player body', () => {
    const { world } = generateWorld();
    const art = new StreetArt(new Scene(), world, new BuildingRegistry()); cleanup.push(() => art.dispose());
    expect(art.pedestrianObstacles.length).toBeGreaterThan(8);
    const first = art.pedestrianObstacles[0], initial = (first.minX + first.maxX) / 2;
    art.setPlayerPosition({ x: initial + 1.1, y: 16, z: 169.5 });
    for (let frame = 0; frame < 180; frame++) {
      art.update(1 / 60, new Vector3(initial, 18, 169.5), 1, 1);
      const person = art.pedestrianObstacles[0];
      expect(Math.abs((person.minX + person.maxX) / 2 - initial - 1.1)).toBeGreaterThanOrEqual(.83);
    }
    expect((art.pedestrianObstacles[0].minX + art.pedestrianObstacles[0].maxX) / 2).not.toBe(initial);
  });

  it('recovers sideways onto real supported ground when a dynamic solid invades the character body', () => {
    const walker = new VoxelWalker(street(), { x: 20, y: 16, z: 20 });
    let bounds: readonly SceneObstacle[] = [];
    walker.setObstacleProvider(() => bounds);
    bounds = [{ minX: 19, minY: 16, minZ: 19, maxX: 21, maxY: 20, maxZ: 21 }];
    walker.update(1 / 60, { x: 0, z: 0 });
    expect(walker.recoveredLastStep).toBe(true); expect(walker.canOccupy(walker.position)).toBe(true);
    expect(walker.position.y).toBeCloseTo(16, 5); expect(walker.grounded).toBe(true);
    expect(Math.hypot(walker.position.x - 20, walker.position.z - 20)).toBeGreaterThan(1);
  });

  it('keeps a safe overhead solid without moving the character, then escapes if it descends into the head', () => {
    const walker = new VoxelWalker(street(), { x: 20, y: 16, z: 20 });
    const overhead = { minX: 19, minY: 18.1, minZ: 19, maxX: 21, maxY: 20, maxZ: 21 };
    walker.setObstacleProvider(() => [overhead]); walker.update(1 / 60, { x: 0, z: 0 });
    expect(walker.recoveredLastStep).toBe(false);
    overhead.minY = 17.3; walker.update(1 / 60, { x: 0, z: 0 });
    expect(walker.recoveredLastStep).toBe(true); expect(walker.canOccupy(walker.position)).toBe(true);
    expect(walker.position.y).toBeCloseTo(16, 5);
  });
});
