import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { generateWorld } from '../src/world/generate';
import { addHarborQuarter } from '../src/world/harbor-quarter';
import { WORLD_SEED, WORLD_VERSION, type VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';
import { VoxelWalker } from '../src/input/walk';
import {Scene} from 'three';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import { WorldPersistence } from '../src/persistence/storage';

const instances: WorldPersistence[] = [];
it('walks back from the lower harbor connector onto the helipad approach without jumping',()=>{
 const base=generateWorld();addHarborQuarter(base.world,base.buildings);const steps=new WalkTransitions(new Scene(),base.world),m=new VoxelWalker(base.world,{x:100,y:15,z:205});m.setObstacleProvider(()=>steps.nearby(m.position));
 for(const target of [{x:108,z:202},{x:100,z:205}]){let arrived=false;for(let i=0;i<1200;i++){const dx=target.x-m.position.x,dz=target.z-m.position.z,d=Math.hypot(dx,dz);if(d<.4){arrived=true;break;}m.update(1/60,{x:dx/d,z:dz/d});expect(m.recoveredLastStep).toBe(false);}expect(arrived,JSON.stringify({target,position:m.position})).toBe(true);}steps.dispose();
});
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  instances.splice(0).forEach(instance => instance.dispose());
  vi.unstubAllGlobals();
});

function createSave(): WorldPersistence {
  const save = new WorldPersistence({ worldVersion: WORLD_VERSION, seed: WORLD_SEED });
  instances.push(save);
  return save;
}

function harbor() {
  const generated = generateWorld();
  addHarborQuarter(generated.world, generated.buildings);
  return generated;
}

function checksum(world: VoxelWorld): number {
  let hash = 2166136261;
  // Sorted keys make comparisons independent of chunk insertion order.
  for (const key of [...world.chunks.keys()].sort()) for (const value of world.chunks.get(key)!.voxels) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}

describe('additive, walkable harbor quarter', () => {
  it('keeps every previously occupied city voxel and every original building record unchanged', () => {
    const generated = generateWorld();
    const original = new Map([...generated.world.chunks].map(([key, chunk]) => [key, chunk.voxels.slice()]));
    const originalBuildings = generated.buildings.all.map(building => ({ ...building, indices: building.indices.slice() }));
    addHarborQuarter(generated.world, generated.buildings);
    const changed: string[] = [];
    let added = 0;
    for (const [key, chunk] of generated.world.chunks) {
      const previous = original.get(key);
      for (let index = 0; index < chunk.voxels.length; index++) {
        if (previous?.[index] && previous[index] !== chunk.voxels[index]) changed.push(`${key}:${index}`);
        if (!previous?.[index] && chunk.voxels[index]) added++;
      }
    }
    expect(changed).toEqual([]);
    expect(added).toBeGreaterThan(4000);
    expect(generated.buildings.all.slice(0, originalBuildings.length)).toEqual(originalBuildings);
    const houses = generated.buildings.all.filter(building => building.id.startsWith('harbor-'));
    expect(houses).toHaveLength(6);
    expect(new Set(houses.map(house => house.bounds.maxY)).size).toBeGreaterThan(2);
    // Existing harbor edits rely on an immutable additive base, just like the old city.
    expect(checksum(generated.world)).toBe(586347664);
  });

  it.each([0, 1, 2, 3, 4, 5])('lets a human-height walker enter hollow harbor house %i through its actual open doorway', index => {
    const { world, buildings } = harbor();
    const row = Math.floor(index / 3), column = index % 3;
    const x = [12, 31, 50][column] + 5;
    const front = row ? 237 : 227;
    const direction = row ? 1 : -1;
    const startZ = front - direction * 3.5;
    for (let y = 16; y <= 18; y++) {
      expect(world.getVoxel(x - 1, y, front)).toBe(0);
      expect(world.getVoxel(x, y, front)).toBe(0);
    }
    expect(world.getVoxel(x, 15, front)).toBe(Material.Wood);
    expect(world.getVoxel(x, 17, front + direction * 2)).toBe(0);
    expect(buildings.get(`harbor-${index + 1}`)).toBeDefined();
    const walker = new VoxelWalker(world, { x, y: 15, z: startZ });
    const transitions=new WalkTransitions(new Scene(),world);
    walker.setObstacleProvider(()=>transitions.nearby(walker.position));
    for (let frame = 0; frame < 100; frame++) walker.update(1 / 60, { x: 0, z: direction });
    expect((walker.position.z - front) * direction).toBeGreaterThan(1);
    expect((walker.position.z - front) * direction).toBeLessThan(4);
    expect(walker.position.y).toBeCloseTo(16, 4);
    expect(walker.grounded).toBe(true);
    expect(walker.canOccupy(walker.position)).toBe(true);
    transitions.dispose();
  });

  it('physically connects the harbor deck to the original pier without falling or hitting an invisible gap', () => {
    const { world } = harbor();
    for (let x = 60; x <= 113; x++) expect(world.getVoxel(x, 14, 214)).toBe(Material.Wood);
    const walker = new VoxelWalker(world, { x: 108.5, y: 15, z: 214.5 });
    let recovered = false;
    for (let frame = 0; frame < 60 * 15; frame++) {
      walker.update(1 / 60, { x: -1, z: 0 });
      recovered ||= walker.recoveredLastStep;
    }
    expect(walker.position.x).toBeLessThan(63);
    expect(walker.position.x).toBeGreaterThan(58);
    expect(walker.position.y).toBeCloseTo(15, 4);
    expect(walker.grounded).toBe(true);
    expect(recovered).toBe(false);
  });

  it('restores destroyed harbor decking and an old-city edit together under the same original save key', async () => {
    const first = harbor();
    const legacyEdit = { x: 84, y: 15, z: 125, material: 0 };
    expect(first.world.getVoxel(legacyEdit.x, legacyEdit.y, legacyEdit.z)).not.toBe(0);
    first.world.applyEdits([legacyEdit]);
    const damage = first.world.removeSphere({ x: 45.5, y: 14.5, z: 232.5 }, 1.1);
    expect(damage.edits).not.toHaveLength(0);
    expect(first.world.getVoxel(45, 14, 232)).toBe(0);
    const persistence = createSave();
    persistence.record([legacyEdit, ...damage.edits]);
    persistence.setPlayer({ position: { x: 45, y: 16.68, z: 234 }, rotation: { x: 0, y: 0, z: 0 }, mode: 'walk', weather: 'rain' }, 21.5);
    await persistence.flush();
    const saved = await createSave().load();
    expect(saved?.worldVersion).toBe(WORLD_VERSION);
    expect(saved?.edits).toHaveLength(1 + damage.edits.length);
    const restored = harbor();
    restored.world.applyEdits(saved!.edits);
    expect(restored.world.getVoxel(45, 14, 232)).toBe(0);
    expect(restored.world.getVoxel(legacyEdit.x, legacyEdit.y, legacyEdit.z)).toBe(0);
    expect(checksum(restored.world)).toBe(checksum(first.world));
  });
});
