import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldPersistence, type SavedWorld } from '../src/persistence/storage';
import type { HelicopterState } from '../src/vehicles/types';
import { COAST_ROUTE } from '../src/route/coast-route';

const options = { worldVersion: 'mirror-coast-v1', seed: 48271 };
const instances: WorldPersistence[] = [];

function create(): WorldPersistence {
  const persistence = new WorldPersistence(options);
  instances.push(persistence);
  return persistence;
}

function vehicle(overrides: Partial<HelicopterState> = {}): HelicopterState {
  return {
    position: { x: 108, y: 36.75, z: 218 },
    rotation: { x: 0, y: Math.sin(.35), z: 0, w: Math.cos(.35) },
    linearVelocity: { x: 1.25, y: .125, z: -8.5 },
    engineOn: true, routeIndex: 2,
    ...overrides,
  };
}

function save(state?: HelicopterState): SavedWorld {
  return {
    format: 'mirror-coast-save', schemaVersion: 1, ...options,
    updatedAt: '2026-11-12T05:00:00.000Z',
    edits: Array.from({ length: 536 }, (_, index) => ({ x: index % 256, y: 20, z: Math.floor(index / 256), material: 0 })),
    ...(state ? { vehicle: state } : {}),
  };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  instances.splice(0).forEach(instance => instance.dispose());
  vi.unstubAllGlobals();
});

describe('persistent helicopter state', () => {
  it('round-trips active and paused return flights and rejects an unknown flight mode',async()=>{
    for(const tourStatus of ['active','paused'] as const){const original=vehicle({flightMode:'return',tourStatus});const p=create();await p.importSave(JSON.stringify(save(original)));expect((await create().load())?.vehicle).toEqual(original);}
    expect(()=>create().setVehicle(vehicle({flightMode:'teleport' as 'return'}))).toThrow('飞行模式');
  });
  it.each(['idle','active','paused','complete']as const)('preserves the optional %s tour state without changing existing world edits',async tourStatus=>{
    const persistence=create(),original=save(vehicle({tourStatus}));await persistence.importSave(JSON.stringify(original));
    const restored=await create().load();expect(restored?.vehicle?.tourStatus).toBe(tourStatus);expect(restored?.edits).toEqual(original.edits);
  });
  it('rejects an unknown tour state',async()=>{
    expect(()=>create().setVehicle(vehicle({tourStatus:'unexpected' as 'active'}))).toThrow('游览状态');
  });
  it('keeps the original schema-1 world and its 536 edits without requiring vehicle data', async () => {
    const original = save();
    await create().importSave(JSON.stringify(original));
    const restored = await create().load();
    expect(restored?.schemaVersion).toBe(1);
    expect(restored?.vehicle).toBeUndefined();
    expect(restored?.edits).toEqual(original.edits);
  });

  it('round-trips pose, velocity, engine and navigation progress exactly', async () => {
    const persistence = create();
    await persistence.importSave(JSON.stringify(save()));
    persistence.setVehicle(vehicle());
    await persistence.flush();
    const restored = await create().load();
    expect(restored?.vehicle).toEqual(vehicle());
    expect(restored?.edits).toHaveLength(536);
    expect(JSON.parse(await persistence.exportSave()).vehicle).toEqual(vehicle());
  });

  it('does not retain mutable vehicle object references', async () => {
    const persistence = create();
    const state = vehicle();
    persistence.setVehicle(state);
    state.position.y = -100;
    state.rotation.w = 0;
    state.linearVelocity.z = 99;
    const exported = JSON.parse(await persistence.exportSave()) as SavedWorld;
    expect(exported.vehicle).toEqual(vehicle());
    exported.vehicle!.position.x = 0;
    expect((JSON.parse(await persistence.exportSave()) as SavedWorld).vehicle).toEqual(vehicle());
  });

  it('preserves settled rubble while adding and updating the helicopter', async () => {
    const persistence = create();
    const original: SavedWorld = {
      ...save(),
      rubble: [{
        id: 'original-rubble', buildingId: 'building-01', size: { x: 1, y: 1, z: 1 },
        voxels: [[0, 0, 0, 8]], position: { x: 31.5, y: 16.5, z: 32.5 },
        rotation: { x: 0, y: 0, z: 0, w: 1 }, state: 'settled',
      }],
    };
    await persistence.importSave(JSON.stringify(original));
    persistence.setVehicle(vehicle());
    await persistence.flush();
    const restored = await create().load();
    expect(restored?.vehicle).toEqual(vehicle());
    expect(restored?.edits).toEqual(original.edits);
    expect(restored?.rubble).toEqual(original.rubble);
  });

  it.each([
    ['nonfinite position', { position: { x: NaN, y: 20, z: 30 } }],
    ['distant position', { position: { x: 4097, y: 20, z: 30 } }],
    ['zero quaternion', { rotation: { x: 0, y: 0, z: 0, w: 0 } }],
    ['invalid velocity', { linearVelocity: { x: 201, y: 0, z: 0 } }],
    ['invalid engine', { engineOn: 'yes' }],
    ['invalid route', { routeIndex: COAST_ROUTE.length + 1 }],
    ['fractional route', { routeIndex: 1.5 }],
  ])('rejects %s without overwriting the saved vehicle or original edits', async (_description, overrides) => {
    const persistence = create();
    await persistence.importSave(JSON.stringify(save(vehicle())));
    const invalid = { ...vehicle(), ...overrides };
    expect(() => persistence.setVehicle(invalid as HelicopterState)).toThrow();
    await expect(persistence.importSave(JSON.stringify({ ...save(), vehicle: invalid }))).rejects.toThrow();
    const restored = await create().load();
    expect(restored?.vehicle).toEqual(vehicle());
    expect(restored?.edits).toHaveLength(536);
  });

  it('retains a newer vehicle update recorded during a pending write', async () => {
    const persistence = create();
    persistence.setVehicle(vehicle());
    const flushing = persistence.flush();
    await Promise.resolve();
    const next = vehicle({ position: { x: 155, y: 51, z: 217 }, routeIndex: 3 });
    persistence.setVehicle(next);
    await flushing;
    expect((await create().load())?.vehicle).toEqual(next);
  });

  it('retains uncommitted vehicle state while hydrating an existing world', async () => {
    await create().importSave(JSON.stringify(save(vehicle())));
    const persistence = create();
    const next = vehicle({ position: { x: 160, y: 70, z: 220 }, routeIndex: 4 });
    persistence.setVehicle(next);
    const restored = await persistence.load();
    expect(restored?.vehicle).toEqual(next);
    expect(restored?.edits).toHaveLength(536);
    expect((await create().load())?.vehicle).toEqual(next);
  });

  it('retains newer vehicle state recorded while import is committing', async () => {
    const persistence = create();
    persistence.setVehicle(vehicle());
    await persistence.flush();
    const imported = vehicle({ position: { x: 44, y: 40, z: 202 }, routeIndex: 1 });
    const tail = vehicle({ position: { x: 77, y: 45, z: 203 }, routeIndex: 2 });
    const importing = persistence.importSave(JSON.stringify(save(imported)));
    await Promise.resolve();
    persistence.setVehicle(tail);
    await importing;
    expect((await create().load())?.vehicle).toEqual(tail);
  });

  it('clears the current vehicle but retains a new vehicle update received during clear', async () => {
    const persistence = create();
    persistence.setVehicle(vehicle());
    await persistence.flush();
    await persistence.clear();
    expect(await create().load()).toBeNull();
    persistence.setVehicle(vehicle());
    await persistence.flush();
    const clearing = persistence.clear();
    await Promise.resolve();
    const next = vehicle({ position: { x: 108, y: 16.6, z: 209 }, engineOn: false, routeIndex: COAST_ROUTE.length });
    persistence.setVehicle(next);
    await clearing;
    expect((await create().load())?.vehicle).toEqual(next);
  });

  it('replaces an old vehicle with the absence of vehicle in an explicitly imported original save', async () => {
    const persistence = create();
    persistence.setVehicle(vehicle());
    await persistence.flush();
    await persistence.importSave(JSON.stringify(save()));
    expect((await create().load())?.vehicle).toBeUndefined();
    expect((await create().load())?.edits).toHaveLength(536);
  });
});
