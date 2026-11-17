import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldPersistence, type PlayerState, type SavedWorld } from '../src/persistence/storage';

const options = { worldVersion: 'mirror-coast-v1', seed: 48271 };
const instances: WorldPersistence[] = [];
const legacyEdit = { x: 31, y: 20, z: 32, material: 0 };

function create(): WorldPersistence {
  const persistence = new WorldPersistence(options);
  instances.push(persistence);
  return persistence;
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    position: { x: 108, y: 17.68, z: 171 }, rotation: { x: -.03, y: .4, z: 0 },
    mode: 'walk', weather: 'rain', ...overrides,
  };
}

function save(state?: PlayerState): SavedWorld {
  return {
    format: 'mirror-coast-save', schemaVersion: 1, ...options,
    updatedAt: '2026-11-12T07:00:00.000Z', edits: [legacyEdit],
    ...(state ? { player: state } : {}), timeOfDay: 21.5,
  };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  instances.splice(0).forEach(instance => instance.dispose());
  vi.unstubAllGlobals();
});

describe('ground exploration and weather persistence', () => {
  it('loads original schema-1 player data without adding required mode or weather fields', async () => {
    const original: PlayerState = { position: { x: 235, y: 72, z: 247 }, rotation: { x: -.3, y: .7, z: 0 } };
    const persistence = create();
    await persistence.importSave(JSON.stringify(save(original)));
    const restored = await create().load();
    expect(restored?.player).toEqual(original);
    expect(restored?.player?.mode).toBeUndefined();
    expect(restored?.player?.weather).toBeUndefined();
    expect(restored?.edits).toEqual([legacyEdit]);
    const exported = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(exported.player).toEqual(original);
    expect(exported.schemaVersion).toBe(1);
  });

  it('round-trips walking in rain, flying in clear weather, camera pose, time and existing edits', async () => {
    const persistence = create();
    await persistence.importSave(JSON.stringify(save()));
    persistence.setPlayer(player(), 21.75);
    await persistence.flush();
    const first = await create().load();
    expect(first?.player).toEqual(player());
    expect(first?.timeOfDay).toBe(21.75);
    const next = player({ mode: 'fly', weather: 'clear', position: { x: 180, y: 50, z: 220 } });
    persistence.setPlayer(next, 17.2);
    next.position.x = -100;
    await persistence.flush();
    const restored = await create().load();
    expect(restored?.player).toEqual(player({ mode: 'fly', weather: 'clear', position: { x: 180, y: 50, z: 220 } }));
    expect(restored?.timeOfDay).toBe(17.2);
    expect(restored?.edits).toEqual([legacyEdit]);
  });

  it.each([
    ['mode', 'helicopter'], ['mode', null], ['weather', 'snow'], ['weather', null], ['view', 'orbit'], ['view', null],
  ])('rejects invalid %s=%s without replacing the committed city or player state', async (field, value) => {
    const persistence = create();
    await persistence.importSave(JSON.stringify(save(player())));
    const invalid = { ...player({ position: { x: 20, y: 18, z: 230 } }), [field]: value };
    expect(() => persistence.setPlayer(invalid as PlayerState, 12)).toThrow();
    await expect(persistence.importSave(JSON.stringify(save(invalid as PlayerState)))).rejects.toThrow();
    const restored = await create().load();
    expect(restored?.player).toEqual(player());
    expect(restored?.timeOfDay).toBe(21.5);
    expect(restored?.edits).toEqual([legacyEdit]);
  });

  it('keeps the body eye position and third-person preference when the render camera is behind the body', async () => {
    const persistence = create();
    const bodyPose = player({ view: 'third', position: { x: 124.5, y: 17.68, z: 110 } });
    persistence.setPlayer(bodyPose, 19.4);
    await persistence.flush();
    expect((await create().load())?.player).toEqual(bodyPose);
    persistence.setPlayer({ ...bodyPose, view: 'first' }, 19.4);
    expect(JSON.parse(await persistence.exportSave()).player).toEqual({ ...bodyPose, view: 'first' });
  });

  it('retains the latest walking/rain state recorded while an older player write is pending', async () => {
    const persistence = create();
    persistence.record([legacyEdit]);
    persistence.setPlayer(player({ mode: 'fly', weather: 'clear' }), 17.2);
    const flushing = persistence.flush();
    await Promise.resolve();
    const tail = player({ position: { x: 40, y: 16.68, z: 232 } });
    persistence.setPlayer(tail, 22);
    await flushing;
    const restored = await create().load();
    expect(restored?.player).toEqual(tail);
    expect(restored?.timeOfDay).toBe(22);
    expect(restored?.edits).toEqual([legacyEdit]);
  });

  it('retains a newer mode and weather update while an existing save is hydrating', async () => {
    await create().importSave(JSON.stringify(save(player({ mode: 'fly', weather: 'clear' }))));
    const persistence = create();
    const loading = persistence.load();
    await Promise.resolve();
    const tail = player({ position: { x: 130, y: 17.68, z: 170 }, rotation: { x: 0, y: -1.1, z: 0 } });
    persistence.setPlayer(tail, 22.25);
    expect((await loading)?.player).toEqual(tail);
    const restored = await create().load();
    expect(restored?.player).toEqual(tail);
    expect(restored?.timeOfDay).toBe(22.25);
    expect(restored?.edits).toEqual([legacyEdit]);
  });

  it('retains a new walking/rain update received while a clear-weather import is committing', async () => {
    const persistence = create();
    persistence.setPlayer(player(), 21);
    await persistence.flush();
    const imported = player({ mode: 'fly', weather: 'clear', position: { x: 235, y: 72, z: 247 } });
    const importing = persistence.importSave(JSON.stringify(save(imported)));
    await Promise.resolve();
    const tail = player({ position: { x: 37, y: 16.68, z: 232 } });
    persistence.setPlayer(tail, 23);
    expect((await importing).player).toEqual(tail);
    const restored = await create().load();
    expect(restored?.player).toEqual(tail);
    expect(restored?.timeOfDay).toBe(23);
    expect(restored?.edits).toEqual([legacyEdit]);
  });
});
