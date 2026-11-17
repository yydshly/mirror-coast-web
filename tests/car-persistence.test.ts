import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldPersistence, type PlayerState, type SavedWorld } from '../src/persistence/storage';
import type { CarState } from '../src/vehicles/coastal-car';

const options = { worldVersion: 'mirror-coast-v1', seed: 48271 };
const bounds = { minX: -256, maxX: 768, minZ: -384, maxZ: 384 };
const legacyEdit = { x: 31, y: 20, z: 32, material: 0 };
const instances: WorldPersistence[] = [];

function create(regional = false): WorldPersistence {
  const persistence = new WorldPersistence({ ...options, ...(regional ? { bounds } : {}) });
  instances.push(persistence);
  return persistence;
}

function car(): CarState {
  return { position: { x: 248, y: 16.85, z: 164 }, heading: -Math.PI / 2, speed: 12.5 };
}

function player(withCar = true): PlayerState {
  return {
    position: { x: 248, y: 18.3, z: 164 }, rotation: { x: -.1, y: -Math.PI / 2, z: 0 },
    mode: 'walk', view: 'third', weather: 'rain', ...(withCar ? { car: car() } : {}),
  };
}

function save(state = player()): SavedWorld {
  return {
    format: 'mirror-coast-save', schemaVersion: 1, ...options,
    updatedAt: '2026-11-12T07:00:00.000Z', edits: [{ ...legacyEdit }],
    player: state, timeOfDay: 21.5,
  };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  instances.splice(0).forEach(instance => instance.dispose());
  vi.unstubAllGlobals();
});

describe('coastal car persistence', () => {
  it('round-trips an overturned player car and displaced traffic without sharing mutable motion objects',async()=>{
    const p=player(),motion={rotation:{x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2},linearVelocity:{x:2,y:0,z:0},angularVelocity:{x:.2,y:0,z:0}};
    p.car!.rigidBody=structuredClone(motion);p.traffic=[{id:18,position:{x:80,y:16.8,z:145},...structuredClone(motion)}];
    const expected=structuredClone(p),persistence=create();persistence.setPlayer(p,16.8);
    p.car!.rigidBody!.rotation.z=0;p.traffic[0].position.x=600;await persistence.flush();
    const restored=await create().load();expect(restored!.player).toEqual(expected);
    restored!.player!.traffic![0].rotation.x=1;expect((JSON.parse(await persistence.exportSave()) as SavedWorld).player).toEqual(expected);
  });
  it.each([
    {id:24,position:{x:80,y:16,z:145},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}},
    {id:0,position:{x:80,y:16,z:145},rotation:{x:0,y:0,z:0,w:0},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}},
  ])('rejects invalid collision body saves atomically',async(invalid)=>{
    const persistence=create(),p=player();persistence.setPlayer(p,16.8);await persistence.flush();
    const imported=save({...p,traffic:[invalid]});await expect(persistence.importSave(JSON.stringify(imported))).rejects.toThrow();
    expect((await create().load())!.player).toEqual(p);
  });
  it('loads and exports a schema-1 city without requiring or inventing a car', async () => {
    const original = player(false);
    const persistence = create();
    await persistence.importSave(JSON.stringify(save(original)));
    const restored = await create().load();
    expect(restored?.player).toEqual(original);
    expect(restored?.player).not.toHaveProperty('car');
    expect(restored?.edits).toEqual([legacyEdit]);
    const exported = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(exported.schemaVersion).toBe(1);
    expect(exported.player).toEqual(original);
    expect(exported.player).not.toHaveProperty('car');
  });

  it('isolates a supplied car pose from subsequent caller mutations before and after saving', async () => {
    const persistence = create();
    const input = player();
    const expected = player();
    persistence.setPlayer(input, 21.5);
    input.car!.position.x = 600;
    input.car!.heading = 0;
    input.car!.speed = -5;
    input.position.z = 300;
    await persistence.flush();
    input.car!.position.y = 100;
    expect((await create().load())?.player).toEqual(expected);
    expect((JSON.parse(await persistence.exportSave()) as SavedWorld).player).toEqual(expected);
  });

  it('returns independent nested car snapshots from import and load', async () => {
    const persistence = create();
    const imported = await persistence.importSave(JSON.stringify(save()));
    imported.player!.car!.position.x = 700;
    imported.player!.car!.speed = 49;
    imported.player!.rotation.y = 0;
    expect((JSON.parse(await persistence.exportSave()) as SavedWorld).player).toEqual(player());

    const reader = create();
    const restored = await reader.load();
    restored!.player!.car!.position.z = -200;
    restored!.player!.car!.heading = 42;
    // A real later save must not commit mutations made to the returned snapshot.
    reader.record([{ x: 32, y: 20, z: 32, material: 0 }]);
    await reader.flush();
    const reloaded = await create().load();
    expect(reloaded?.player).toEqual(player());
    expect(reloaded?.edits).toHaveLength(2);
  });

  it.each([
    ['non-finite position', { ...car(), position: { x: Number.NaN, y: 16.85, z: 164 } }],
    ['infinite position', { ...car(), position: { x: 248, y: Number.POSITIVE_INFINITY, z: 164 } }],
    ['excessive position', { ...car(), position: { x: 4097, y: 16.85, z: 164 } }],
    ['missing coordinate', { ...car(), position: { x: 248, y: 16.85 } }],
    ['non-finite heading', { ...car(), heading: Number.NaN }],
    ['excessive heading', { ...car(), heading: 101 }],
    ['infinite speed', { ...car(), speed: Number.NEGATIVE_INFINITY }],
    ['excessive speed', { ...car(), speed: 51 }],
    ['text speed', { ...car(), speed: '12.5' }],
    ['null car', null],
  ])('rejects %s without replacing the committed city, car or clock', async (_label, invalidCar) => {
    const persistence = create();
    await persistence.importSave(JSON.stringify(save()));
    const invalid = { ...player(), car: invalidCar } as unknown as PlayerState;
    expect(() => persistence.setPlayer(invalid, 12)).toThrow();
    const incoming = { ...save(invalid), timeOfDay: 12, edits: [{ x: 90, y: 20, z: 90, material: 0 }] };
    // JSON represents NaN/Infinity as null; imported null must also be rejected.
    await expect(persistence.importSave(JSON.stringify(incoming))).rejects.toThrow();
    const restored = await create().load();
    expect(restored?.player).toEqual(player());
    expect(restored?.timeOfDay).toBe(21.5);
    expect(restored?.edits).toEqual([legacyEdit]);
  });

  it('keeps the old city while persisting the car and destruction beyond the original 256-metre extent', async () => {
    await create().importSave(JSON.stringify(save(player(false))));
    const regional = create(true);
    expect((await regional.load())?.edits).toEqual([legacyEdit]);
    const outerEdits = [
      { x: 420, y: 18, z: 164, material: 0 },
      { x: -180, y: 28, z: -220, material: 0 },
    ];
    const parked = player();
    parked.position = { x: 420, y: 18.3, z: 164 };
    parked.car = { position: { x: 420, y: 16.85, z: 164 }, heading: -.8, speed: 0 };
    regional.record(outerEdits);
    regional.setPlayer(parked, 22.25);
    await regional.flush();
    const restored = await create(true).load();
    expect(restored?.edits).toEqual([legacyEdit, ...outerEdits]);
    expect(restored?.player).toEqual(parked);
    expect(restored?.timeOfDay).toBe(22.25);

    const exported = await regional.exportSave();
    expect((await create(true).importSave(exported)).edits).toEqual(restored?.edits);
    expect(() => create().record(outerEdits)).toThrow();
  });

  it('retains the latest nested car state received while an older pose is being saved', async () => {
    const persistence = create();
    persistence.setPlayer(player(), 21);
    const flushing = persistence.flush();
    await Promise.resolve();
    const latest = player();
    latest.car = { position: { x: 253, y: 16.85, z: 164 }, heading: -1.4, speed: 8 };
    persistence.setPlayer(latest, 21.1);
    latest.car.position.x = 650;
    await flushing;
    const restored = await create().load();
    expect(restored?.player?.car).toEqual({ position: { x: 253, y: 16.85, z: 164 }, heading: -1.4, speed: 8 });
    expect(restored?.timeOfDay).toBe(21.1);
  });
});
