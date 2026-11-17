import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldPersistence, type SavedWorld } from '../src/persistence/storage';
import { MAX_ACTIVE_FRAGMENTS, MAX_SAVED_FRAGMENTS, MAX_SAVED_FRAGMENT_VOXELS, type RubbleFragment } from '../src/destruction/types';

const options = { worldVersion: 'mirror-coast-v1', seed: 48271 };
const instances: WorldPersistence[] = [];
const edit = { x: 31, y: 20, z: 32, material: 0 };

function create(): WorldPersistence {
  const instance = new WorldPersistence(options);
  instances.push(instance);
  return instance;
}

function fragment(id = 'building-01:collapse-01:0'): RubbleFragment {
  return {
    id, buildingId: 'building-01', size: { x: 2, y: 1, z: 1 },
    voxels: [[0, 0, 0, 7], [1, 0, 0, 8]],
    position: { x: 31, y: 30.5, z: 32.5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, state: 'falling',
    linearVelocity: { x: 0.1, y: -3.7, z: 0.2 },
    angularVelocity: { x: 0, y: 0.4, z: 0.1 },
  };
}

function save(rubble?: RubbleFragment[], edits = [edit]): SavedWorld {
  return {
    format: 'mirror-coast-save', schemaVersion: 1, ...options,
    updatedAt: '2026-11-12T05:00:00.000Z', edits,
    ...(rubble ? { rubble } : {}),
  };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  instances.splice(0).forEach(instance => instance.dispose());
  vi.unstubAllGlobals();
});

describe('persistent collapsed buildings', () => {
  it('loads an original schema-1 archive without introducing or deleting edits', async () => {
    const original = save();
    await create().importSave(JSON.stringify(original));
    const persistence = create();
    const restored = await persistence.load();
    expect(restored?.schemaVersion).toBe(1);
    expect(restored?.edits).toEqual(original.edits);
    expect(restored?.rubble ?? []).toEqual([]);
    expect(persistence.rubbleCount).toBe(0);
  });

  it('commits source-voxel removal and falling debris in the same world snapshot', async () => {
    const persistence = create();
    persistence.recordWorldChange({ edits: [edit], upsertFragments: [fragment()] });
    await persistence.flush();
    const restored = await create().load();
    expect(restored?.edits).toEqual([edit]);
    expect(restored?.rubble).toEqual([fragment()]);
  });

  it('round-trips falling velocities and settled poses exactly without accumulating duplicate IDs', async () => {
    const persistence = create();
    const body = fragment();
    persistence.recordWorldChange({ edits: [edit], upsertFragments: [body] });
    await persistence.flush();
    expect((await create().load())?.rubble?.[0]).toEqual(body);

    const settled: RubbleFragment = {
      ...body, state: 'settled', position: { x: 34.125, y: 16.375, z: 32.25 },
      rotation: { x: 0, y: Math.sin(.35), z: 0, w: Math.cos(.35) },
      linearVelocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 },
    };
    persistence.recordFragments([settled]);
    await persistence.flush();
    expect(persistence.rubbleCount).toBe(1);
    const backup = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(backup.rubble).toEqual([settled]);
    expect((await create().load())?.rubble).toEqual([settled]);
  });

  it('isolates stored geometry and poses from mutable physics snapshots', async () => {
    const persistence = create();
    const body = fragment();
    persistence.recordFragments([body]);
    body.position.y = -100;
    body.voxels[0][3] = 99;
    const restored = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(restored.rubble?.[0]).toEqual(fragment());
    restored.rubble![0].position.y = -200;
    expect((JSON.parse(await persistence.exportSave()) as SavedWorld).rubble?.[0].position.y).toBe(30.5);
  });

  it('rejects a mixed invalid change without partially removing voxels or creating debris', async () => {
    const persistence = create();
    const body = fragment();
    persistence.recordFragments([body]);
    expect(() => persistence.recordWorldChange({
      edits: [edit], upsertFragments: [{ ...fragment('invalid'), voxels: [[2, 0, 0, 7]] }],
      removeFragmentIds: [body.id],
    })).toThrow();
    const stored = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(stored.edits).toEqual([]);
    expect(stored.rubble).toEqual([body]);
  });

  it.each([
    ['zero quaternion', { rotation: { x: 0, y: 0, z: 0, w: 0 } }],
    ['invalid material', { voxels: [[0, 0, 0, 0]] }],
    ['duplicate cells', { voxels: [[0, 0, 0, 7], [0, 0, 0, 8]] }],
    ['invalid state', { state: 'vanished' }],
    ['invalid dimension', { size: { x: 0, y: 1, z: 1 } }],
    ['nonfinite velocity', { linearVelocity: { x: 0, y: 'NaN', z: 0 } }],
    ['oversized identifier', { id: 'x'.repeat(129) }],
  ])('preserves the existing archive when importing %s', async (_name, invalid) => {
    const persistence = create();
    persistence.recordWorldChange({ edits: [edit], upsertFragments: [fragment()] });
    await persistence.flush();
    const input = save([{ ...fragment(), ...invalid } as RubbleFragment], []);
    await expect(persistence.importSave(JSON.stringify(input))).rejects.toThrow();
    const restored = await create().load();
    expect(restored?.edits).toEqual([edit]);
    expect(restored?.rubble).toEqual([fragment()]);
  });

  it('rejects fragment-count overflow atomically and accepts replacing existing IDs at capacity', async () => {
    const persistence = create();
    const full = Array.from({ length: MAX_SAVED_FRAGMENTS }, (_, index) => ({ ...fragment(`body-${index}`), state: 'settled' as const }));
    persistence.recordFragments(full);
    expect(() => persistence.recordWorldChange({ edits: [edit], upsertFragments: [fragment('extra')] })).toThrow('数量');
    expect(persistence.editCount).toBe(0);
    expect(persistence.rubbleCount).toBe(MAX_SAVED_FRAGMENTS);
    persistence.recordFragments([{ ...full[0], state: 'settled' }]);
    await persistence.flush();
    expect((await create().load())?.rubble?.find(body => body.id === full[0].id)?.state).toBe('settled');
  });

  it('rejects active-body overflow on record and import before changing the previous world', async () => {
    const persistence = create();
    persistence.record([edit]);
    await persistence.flush();
    const falling = Array.from({ length: MAX_ACTIVE_FRAGMENTS + 1 }, (_, index) => fragment(`falling-${index}`));
    expect(() => persistence.recordWorldChange({ edits: [{ ...edit, x: 40 }], upsertFragments: falling })).toThrow('活动');
    await expect(persistence.importSave(JSON.stringify(save(falling, [])))).rejects.toThrow('活动');
    const restored = await create().load();
    expect(restored?.edits).toEqual([edit]);
    expect(restored?.rubble ?? []).toEqual([]);
  });

  it('rejects total debris-voxel overflow before applying any source edits', () => {
    const persistence = create();
    const large = fragment('large');
    large.size = { x: 64, y: 64, z: 64 };
    large.voxels = Array.from({ length: Math.floor(MAX_SAVED_FRAGMENT_VOXELS / 2) + 1 }, (_, index) => [
      index % 64, Math.floor(index / 4096), Math.floor(index / 64) % 64, 7,
    ]);
    expect(() => persistence.recordWorldChange({
      edits: [edit], upsertFragments: [large, { ...large, id: 'large-2' }],
    })).toThrow('体素数量');
    expect(persistence.editCount).toBe(0);
    expect(persistence.rubbleCount).toBe(0);
  });

  it('persists the latest pose that arrives while an earlier commit is pending', async () => {
    const persistence = create();
    persistence.recordWorldChange({ edits: [edit], upsertFragments: [fragment()] });
    const committing = persistence.flush();
    await Promise.resolve();
    const landed: RubbleFragment = { ...fragment(), state: 'settled', position: { x: 31, y: 16, z: 32.5 } };
    persistence.recordFragments([landed]);
    await committing;
    expect((await create().load())?.rubble).toEqual([landed]);
  });

  it('keeps newly created fragments and deletion tombstones during an import', async () => {
    const persistence = create();
    const existing = fragment('to-remove');
    persistence.recordFragments([existing]);
    await persistence.flush();
    const imported = fragment('imported');
    const incoming = save([existing, imported], []);
    const importing = persistence.importSave(JSON.stringify(incoming));
    await Promise.resolve();
    const newlyFalling = fragment('newly-falling');
    persistence.recordWorldChange({ edits: [edit], upsertFragments: [newlyFalling], removeFragmentIds: [existing.id] });
    await importing;
    const restored = await create().load();
    expect(restored?.edits).toEqual([edit]);
    expect(restored?.rubble).toEqual([imported, newlyFalling]);
  });

  it('keeps a local unsaved fragment when loading an older archive', async () => {
    const original = create();
    original.recordFragments([fragment('older')]);
    await original.flush();
    const current = create();
    current.recordFragments([fragment('newer')]);
    const restored = await current.load();
    expect(restored?.rubble?.map(body => body.id)).toEqual(['older', 'newer']);
    expect((await create().load())?.rubble?.map(body => body.id)).toEqual(['older', 'newer']);
  });

  it('retains fragments created while an explicit clear is pending', async () => {
    const persistence = create();
    persistence.recordFragments([fragment('old')]);
    await persistence.flush();
    const clearing = persistence.clear();
    await Promise.resolve();
    const fresh = fragment('new');
    persistence.recordFragments([fresh]);
    await clearing;
    expect((await create().load())?.rubble).toEqual([fresh]);
  });

  it('exports debris even when the browser database is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const persistence = create();
    await expect(persistence.load()).rejects.toThrow();
    persistence.recordWorldChange({ edits: [edit], upsertFragments: [fragment()] });
    const backup = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(backup.edits).toEqual([edit]);
    expect(backup.rubble).toEqual([fragment()]);
  });
});
