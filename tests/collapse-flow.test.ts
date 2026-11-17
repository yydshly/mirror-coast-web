import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { MeshStandardMaterial, Scene } from 'three';
import { generateCollapseLab, LAB_SHOTS, LAB_TEST_BUILDING_ID, LAB_WORLD_VERSION } from '../src/destruction/lab';
import { CollapsePhysics } from '../src/destruction/physics';
import { analyzeStructure, createStructureInput } from '../src/destruction/structure';
import { MAX_ACTIVE_FRAGMENTS } from '../src/destruction/types';
import { WorldPersistence, type SavedWorld } from '../src/persistence/storage';
import { createMeshInput, meshChunk } from '../src/world/mesher';
import { WORLD_SEED, type VoxelWorld } from '../src/world/voxel';

const managers: CollapsePhysics[] = [];
const stores: WorldPersistence[] = [];
const materials: MeshStandardMaterial[] = [];

afterEach(() => {
  managers.splice(0).forEach(manager => manager.dispose());
  stores.splice(0).forEach(store => store.dispose());
  materials.splice(0).forEach(material => material.dispose());
  vi.unstubAllGlobals();
});

function persistence(worldVersion = LAB_WORLD_VERSION): WorldPersistence {
  const store = new WorldPersistence({ worldVersion, seed: WORLD_SEED });
  stores.push(store);
  return store;
}

async function physics(store?: WorldPersistence): Promise<CollapsePhysics> {
  const material = new MeshStandardMaterial({ vertexColors: true });
  materials.push(material);
  const manager = await CollapsePhysics.create(new Scene(), material, {
    onStateChange: fragments => store?.recordFragments(fragments),
  });
  managers.push(manager);
  return manager;
}

function sync(manager: CollapsePhysics, world: VoxelWorld, keys: Iterable<string>): void {
  for (const key of keys) {
    const input = createMeshInput(world, key);
    if (input) manager.syncChunk(meshChunk(input));
  }
}

function hash(world: VoxelWorld): number {
  let value = 2166136261;
  for (const key of [...world.chunks.keys()].sort()) {
    for (const byte of world.chunks.get(key)!.voxels) value = Math.imul(value ^ byte, 16777619);
  }
  return value >>> 0;
}

it('blasts a real lab building ten times, settles debris, saves and restores the complete world while preserving the old city', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());

  // The previous city archive is schema 1 with no rubble member. It shares the
  // database but has its own key; none of the lab operations may rewrite it.
  const oldCity = persistence('mirror-coast-v1');
  const legacy: SavedWorld = {
    format: 'mirror-coast-save', schemaVersion: 1,
    worldVersion: 'mirror-coast-v1', seed: WORLD_SEED,
    updatedAt: '2026-11-12T05:00:00.000Z',
    edits: Array.from({ length: 536 }, (_, index) => ({
      x: index % 256, y: 20, z: Math.floor(index / 256), material: 0,
    })),
  };
  await oldCity.importSave(JSON.stringify(legacy));

  const store = persistence();
  expect(await store.load()).toBeNull();
  const { world, buildings } = generateCollapseLab();
  const manager = await physics(store);
  sync(manager, world, world.chunks.keys());
  const building = buildings.get(LAB_TEST_BUILDING_ID)!;
  let peakActive = 0;
  let collapseEvents = 0;
  let firstWingFell = false;

  for (let shot = 0; shot < 10; shot++) {
    const point = LAB_SHOTS[shot % LAB_SHOTS.length];
    const blast = world.removeSphere(point, 3.2);
    store.record(blast.edits);
    sync(manager, world, blast.dirtyKeys);

    const result = analyzeStructure(createStructureInput(world, building, `flow-shot-${shot}`));
    expect(manager.activeCount).toBe(0);
    if (result.edits.length) {
      collapseEvents++;
      store.recordWorldChange({ edits: result.edits, upsertFragments: result.fragments });
      const dirty = world.applyEdits(result.edits);
      // The render-mesh revision and collision revision are accepted together,
      // before releasing the dynamic pieces into the freshly opened space.
      sync(manager, world, dirty);
      manager.addFragments(result.fragments);
      peakActive = Math.max(peakActive, manager.activeCount);
      expect(manager.activeCount).toBeLessThanOrEqual(MAX_ACTIVE_FRAGMENTS);
    }

    for (let frame = 0; frame < 60 * 30 && manager.activeCount; frame++) {
      manager.update(1 / 60);
      peakActive = Math.max(peakActive, manager.activeCount);
      expect(manager.activeCount).toBeLessThanOrEqual(MAX_ACTIVE_FRAGMENTS);
    }
    expect(manager.activeCount, `shot ${shot}: ${JSON.stringify(manager.snapshot().filter(body => body.state === 'falling').map(body => ({ id: body.id, position: body.position, velocity: body.linearVelocity })))}`).toBe(0);
    expect(manager.snapshot().every(body => body.state === 'settled')).toBe(true);
    expect(store.rubbleCount).toBe(manager.totalCount);

    // By the second real blast the left wing has fallen, while the other wing
    // is still an intact static structure. Later blasts exercise repeated use.
    if (shot === 1) {
      firstWingFell = manager.totalCount > 0;
      expect(firstWingFell).toBe(true);
      expect(world.getVoxel(104, 24, 132)).toBe(0);
      expect(world.getVoxel(112, 24, 132)).not.toBe(0);
    }
  }

  expect(firstWingFell).toBe(true);
  expect(collapseEvents).toBeGreaterThanOrEqual(2);
  expect(peakActive).toBeGreaterThan(0);
  store.recordFragments(manager.snapshot());
  await store.flush();
  const expectedHash = hash(world);
  const expectedRubble = manager.snapshot();

  const loaded = await persistence().load();
  expect(loaded?.rubble).toEqual(expectedRubble);
  const restored = generateCollapseLab();
  restored.world.applyEdits(loaded!.edits);
  expect(hash(restored.world)).toBe(expectedHash);
  const restoredPhysics = await physics();
  sync(restoredPhysics, restored.world, restored.world.chunks.keys());
  restoredPhysics.restore(loaded!.rubble ?? []);
  expect(restoredPhysics.activeCount).toBe(0);
  expect(restoredPhysics.snapshot()).toEqual(expectedRubble);
  restoredPhysics.update(1 / 60);
  expect(restoredPhysics.snapshot()).toEqual(expectedRubble);

  const cityAfter = await persistence('mirror-coast-v1').load();
  expect(cityAfter?.edits).toEqual(legacy.edits);
  expect(cityAfter?.rubble ?? []).toEqual([]);
}, 30_000);
