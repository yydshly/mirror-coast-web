import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldPersistence, type SavedWorld } from '../src/persistence/storage';

const instances: WorldPersistence[] = [];
const options = { worldVersion: 'mirror-coast-v1', seed: 48271 };
const edit = { x: 31, y: 20, z: 32, material: 0 };

function create(onStatus?: (status: string, message?: string) => void): WorldPersistence {
  const persistence = new WorldPersistence({ ...options, onStatus });
  instances.push(persistence);
  return persistence;
}

async function rawStoredSave(replacement?: unknown): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mirror-coast-mvp', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('worlds', replacement === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('worlds');
      const key = `${options.worldVersion}:${options.seed}`;
      const request = replacement === undefined ? store.get(key) : store.put(replacement, key);
      let value: unknown;
      request.onsuccess = () => { value = request.result as unknown; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  for (const persistence of instances.splice(0)) persistence.dispose();
  vi.unstubAllGlobals();
});

describe('persistent voxel changes', () => {
  it('starts an independent journey with a pristine world and keeps the original save and other scenes intact',async()=>{
    const original=create();await original.load();original.record([edit]);original.setPlayer({position:{x:40,y:22,z:60},rotation:{x:0,y:1,z:0},mode:'walk'},19);await original.flush();
    const before=JSON.parse(await original.exportSave());
    const fresh=new WorldPersistence({...options,slot:'trip-test'});instances.push(fresh);expect(await fresh.load()).toBeNull();
    fresh.record([{...edit,material:4}]);await fresh.flush();
    expect((await create().load())?.edits).toEqual(before.edits);expect((await create().load())?.player).toEqual(before.player);
    expect(await fresh.listJourneys()).toEqual([null,'trip-test']);
    const reopened=new WorldPersistence({...options,slot:'trip-test'});instances.push(reopened);expect((await reopened.load())?.edits[0].material).toBe(4);
    await fresh.clear();expect((await create().load())?.edits).toEqual(before.edits);
    const otherScene=new WorldPersistence({...options,worldVersion:'collapse-lab-v1',slot:'trip-other'});instances.push(otherScene);otherScene.record([edit]);await otherScene.flush();expect(await original.listJourneys()).toEqual([null]);
    expect(()=>new WorldPersistence({...options,slot:'../old'})).toThrow();
  });
  it('merges repeated coordinates and restores committed data in a new instance', async () => {
    const first = create();
    expect(await first.load()).toBeNull();
    first.record([edit]);
    first.record([{ ...edit, material: 3 }, { x: 32, y: 20, z: 32, material: 0 }]);
    await first.flush();
    expect(first.editCount).toBe(2);

    const restored = await create().load();
    expect(restored?.edits).toEqual([{ ...edit, material: 3 }, { x: 32, y: 20, z: 32, material: 0 }]);
  });

  it('only announces saved after the IndexedDB write has committed', async () => {
    const statuses: string[] = [];
    const persistence = create((status) => statuses.push(status));
    persistence.record([edit]);
    expect(statuses).toEqual(['saving']);
    const flushing = persistence.flush();
    expect(statuses).not.toContain('saved');
    await flushing;
    expect(statuses.at(-1)).toBe('saved');
    expect((await create().load())?.edits).toEqual([edit]);
  });

  it('does not lose edits recorded during a pending commit', async () => {
    const persistence = create();
    persistence.record([edit]);
    const firstFlush = persistence.flush();
    await Promise.resolve();
    persistence.record([{ x: 33, y: 21, z: 33, material: 0 }]);
    await firstFlush;
    expect((await create().load())?.edits).toHaveLength(2);
  });

  it('exports and imports player state and world time', async () => {
    const persistence = create();
    persistence.record([edit]);
    persistence.setPlayer({ position: { x: 120, y: 60, z: 220 }, rotation: { x: -0.3, y: 1.4, z: 0 } }, 18.5);
    const exported = await persistence.exportSave();
    await persistence.clear();
    expect(await create().load()).toBeNull();
    const imported = await persistence.importSave(exported);
    expect(imported.player?.position.y).toBe(60);
    expect(imported.timeOfDay).toBe(18.5);
    expect((await create().load())?.edits).toEqual([edit]);
  });

  it.each([
    ['malformed JSON', '{broken'],
    ['out of bounds', JSON.stringify({ format: 'mirror-coast-save', schemaVersion: 1, ...options, updatedAt: new Date().toISOString(), edits: [{ ...edit, x: 256 }] })],
    ['incompatible version', JSON.stringify({ format: 'mirror-coast-save', schemaVersion: 1, ...options, worldVersion: 'other-version', updatedAt: new Date().toISOString(), edits: [] })],
    ['incompatible seed', JSON.stringify({ format: 'mirror-coast-save', schemaVersion: 1, ...options, seed: 22, updatedAt: new Date().toISOString(), edits: [] })],
    ['invalid camera', JSON.stringify({ format: 'mirror-coast-save', schemaVersion: 1, ...options, updatedAt: new Date().toISOString(), edits: [], player: { position: { x: 'bad', y: 3, z: 4 }, rotation: { x: 0, y: 0, z: 0 } } })],
  ])('preserves existing edits when importing %s', async (_name, json) => {
    const persistence = create();
    persistence.record([edit]);
    await persistence.flush();
    await expect(persistence.importSave(json)).rejects.toThrow();
    expect(persistence.editCount).toBe(1);
    expect((await create().load())?.edits).toEqual([edit]);
  });

  it('rejects an invalid edit batch without partially recording it', () => {
    const persistence = create();
    expect(() => persistence.record([edit, { ...edit, y: -1 }])).toThrow();
    expect(persistence.editCount).toBe(0);
  });

  it('honors the last edit in a batch even when it restores an earlier value', async () => {
    const persistence = create();
    persistence.record([{ ...edit, material: 7 }]);
    persistence.record([edit, { ...edit, material: 7 }]);
    await persistence.flush();
    expect((await create().load())?.edits).toEqual([{ ...edit, material: 7 }]);
  });

  it('uses separate database keys for different worlds', async () => {
    const first = create();
    first.record([edit]);
    await first.flush();
    const other = new WorldPersistence({ worldVersion: 'mirror-coast-v2', seed: options.seed });
    instances.push(other);
    expect(await other.load()).toBeNull();
    expect((await create().load())?.edits).toEqual([edit]);
  });

  it('keeps the final material for duplicate coordinates in imported files', async () => {
    const persistence = create();
    const save: SavedWorld = {
      format: 'mirror-coast-save', schemaVersion: 1, ...options,
      updatedAt: new Date().toISOString(), edits: [edit, { ...edit, material: 7 }],
    };
    const imported = await persistence.importSave(JSON.stringify(save));
    expect(imported.edits).toEqual([{ ...edit, material: 7 }]);
  });

  it('keeps new edits made while an imported save is being committed', async () => {
    const persistence = create();
    persistence.record([edit]);
    await persistence.flush();
    const importedEdit = { x: 60, y: 30, z: 70, material: 0 };
    const tailEdit = { x: 61, y: 30, z: 70, material: 0 };
    const save: SavedWorld = {
      format: 'mirror-coast-save', schemaVersion: 1, ...options,
      updatedAt: new Date().toISOString(), edits: [importedEdit],
    };
    const importing = persistence.importSave(JSON.stringify(save));
    await Promise.resolve();
    persistence.record([tailEdit]);
    await importing;
    expect((await create().load())?.edits).toEqual([importedEdit, tailEdit]);
  });

  it('retains an uncommitted edit when hydrating an existing save', async () => {
    const original = create();
    original.record([edit]);
    await original.flush();
    const next = create();
    const pendingEdit = { x: 42, y: 23, z: 35, material: 0 };
    next.record([pendingEdit]);
    expect((await next.load())?.edits).toEqual([edit, pendingEdit]);
    expect((await create().load())?.edits).toEqual([edit, pendingEdit]);
  });

  it.each(['damaged format', 'incompatible world'])('blocks subsequent writes after loading %s', async (kind) => {
    const original = create();
    original.record([edit]);
    await original.flush();
    const originalSave = await rawStoredSave() as SavedWorld;
    const damaged = kind === 'damaged format'
      ? { ...originalSave, schemaVersion: 99 }
      : { ...originalSave, worldVersion: 'future-world' };
    await rawStoredSave(damaged);

    const statuses: string[] = [];
    const current = create((status) => statuses.push(status));
    await expect(current.load()).rejects.toThrow();
    const newEdit = { x: 80, y: 24, z: 83, material: 0 };
    current.record([newEdit]);
    current.setPlayer({ position: { x: 200, y: 60, z: 220 }, rotation: { x: 0, y: 0, z: 0 } }, 17);
    await expect(current.flush()).rejects.toThrow('暂停自动保存');
    expect(await rawStoredSave()).toEqual(damaged);

    const backup = JSON.parse(await current.exportSave()) as SavedWorld;
    expect(backup.edits).toEqual([newEdit]);
    expect(statuses.at(-1)).toBe('error');
    expect(await rawStoredSave()).toEqual(damaged);
  });

  it('allows explicit successful import to recover from a blocked read', async () => {
    const original = create();
    original.record([edit]);
    const goodSave = await original.exportSave();
    await rawStoredSave({ malformed: true });
    const current = create();
    await expect(current.load()).rejects.toThrow();
    await current.importSave(goodSave);
    const nextEdit = { x: 81, y: 22, z: 84, material: 0 };
    current.record([nextEdit]);
    await current.flush();
    expect((await create().load())?.edits).toEqual([edit, nextEdit]);
  });

  it('allows explicit successful clearing to recover from a blocked read', async () => {
    const original = create();
    original.record([edit]);
    await original.flush();
    await rawStoredSave({ malformed: true });
    const current = create();
    await expect(current.load()).rejects.toThrow();
    await current.clear();
    const nextEdit = { x: 82, y: 25, z: 85, material: 0 };
    current.record([nextEdit]);
    await current.flush();
    expect((await create().load())?.edits).toEqual([nextEdit]);
  });

  it('exports the in-memory world even when IndexedDB is unavailable and keeps error status', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const statuses: Array<{ status: string; message?: string }> = [];
    const current = create((status, message) => statuses.push({ status, message }));
    await expect(current.load()).rejects.toThrow('IndexedDB');
    current.record([edit]);
    current.setPlayer({ position: { x: 200, y: 60, z: 220 }, rotation: { x: 0, y: 0, z: 0 } }, 17);
    const backup = JSON.parse(await current.exportSave()) as SavedWorld;
    expect(backup.edits).toEqual([edit]);
    expect(backup.timeOfDay).toBe(17);
    expect(statuses.at(-1)?.status).toBe('error');
    expect(statuses.at(-1)?.message).toContain('导出当前内存');
  });
});
