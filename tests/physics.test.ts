import { afterEach, describe, expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial, Quaternion, Scene } from 'three';
import { CollapsePhysics } from '../src/destruction/physics';
import { createFragmentGeometry } from '../src/destruction/fragment-geometry';
import type { RubbleFragment } from '../src/destruction/types';
import { MAX_ACTIVE_FRAGMENTS } from '../src/destruction/types';
import { createMeshInput, meshChunk } from '../src/world/mesher';
import { Material } from '../src/world/palette';
import { VoxelWorld } from '../src/world/voxel';
import { generateCollapseLab, LAB_SHOTS, LAB_TEST_BUILDING_ID } from '../src/destruction/lab';
import { analyzeStructure, createStructureInput } from '../src/destruction/structure';

const managers: CollapsePhysics[] = [];
const materials: MeshStandardMaterial[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); materials.splice(0).forEach(material => material.dispose()); });

function fragment(id = 'fragment-1'): RubbleFragment {
  return {
    id, buildingId: 'test-building', size: { x: 1, y: 1, z: 1 },
    voxels: [[0, 0, 0, Material.Brick]], position: { x: 8.5, y: 8, z: 8.5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, state: 'falling',
  };
}

async function manager(scene = new Scene(), onStateChange = (_fragments: RubbleFragment[]) => {}, onImpact = (_position: { x: number; y: number; z: number }, _strength: number) => {}) {
  const material = new MeshStandardMaterial({ vertexColors: true });
  materials.push(material);
  const physics = await CollapsePhysics.create(scene, material, { onStateChange, onImpact });
  managers.push(physics);
  return physics;
}

function ground(): VoxelWorld {
  const world = new VoxelWorld();
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) world.setVoxel(x, 0, z, Material.Rock);
  return world;
}

function sync(physics: CollapsePhysics, world: VoxelWorld): void { physics.syncChunk(meshChunk(createMeshInput(world, '0,0,0')!)); }
function simulate(physics: CollapsePhysics, seconds: number): void { for (let frame = 0; frame < seconds * 60; frame++) physics.update(1 / 60); }

it('prepares newly streamed static terrain once while never advancing saved falling fragments',async()=>{
  const physics=await manager(),world=ground();sync(physics,world);
  expect(physics.prepareStaticTerrain()).toBe(true);expect(physics.prepareStaticTerrain()).toBe(false);
  const saved=fragment();physics.restore([saved]);world.setVoxel(1,1,1,Material.Rock);sync(physics,world);
  expect(physics.prepareStaticTerrain()).toBe(false);expect(physics.snapshot()[0].position).toEqual(saved.position);
  simulate(physics,.1);expect(physics.snapshot()[0].position.y).toBeLessThan(saved.position.y);expect(physics.prepareStaticTerrain()).toBe(false);
});

describe('fragment rendering', () => {
  it('removes internal faces and centres the geometry while preserving material glow', () => {
    const geometry = createFragmentGeometry({ size: { x: 2, y: 1, z: 1 }, voxels: [[0, 0, 0, Material.Brick], [1, 0, 0, Material.Window]] });
    expect(geometry.getIndex()!.count).toBe(60);
    expect(geometry.boundingBox!.min.x).toBe(-1);
    expect(geometry.boundingBox!.max.x).toBe(1);
    expect(geometry.getAttribute('glow').array).toContain(1);
    expect(geometry.getAttribute('glow').array).toContain(0);
    geometry.dispose();
  });
});

describe('real Rapier collapse physics', () => {
  it('falls, collides with the accepted voxel surface, emits impact and settles persistently', async () => {
    const updates: RubbleFragment[][] = [];
    const impacts: number[] = [];
    const physics = await manager(new Scene(), fragments => updates.push(fragments), (_position, strength) => impacts.push(strength));
    sync(physics, ground());
    physics.addFragments([fragment()]);
    simulate(physics, 7);
    const saved = physics.snapshot()[0];
    expect(saved.position.y).toBeCloseTo(1.5, 1);
    expect(saved.state, JSON.stringify(saved)).toBe('settled');
    expect(physics.activeCount).toBe(0);
    expect(physics.settledCount).toBe(1);
    expect(impacts.length).toBeGreaterThan(0);
    expect(updates.flat().some(value => value.state === 'settled')).toBe(true);
    simulate(physics, 30);
    expect(physics.totalCount).toBe(1);
    expect(physics.snapshot()[0].position).toEqual(saved.position);
  });

  it('replaces collider geometry after excavation so a fragment falls through the new opening', async () => {
    const physics = await manager();
    const world = ground();
    sync(physics, world);
    const edits = [];
    for (let z = 6; z <= 10; z++) for (let x = 6; x <= 10; x++) edits.push({ x, y: 0, z, material: 0 });
    world.applyEdits(edits);
    sync(physics, world);
    physics.addFragments([fragment()]);
    simulate(physics, 2);
    expect(physics.snapshot()[0].position.y).toBeLessThan(-1);
    // Late, old geometry cannot fill the opening back in.
    const old = ground();
    old.chunks.get('0,0,0')!.revision = world.chunks.get('0,0,0')!.revision - 1;
    sync(physics, old);
    const second = fragment('fragment-2'); second.position.y = 5;
    physics.addFragments([second]);
    simulate(physics, 1.5);
    expect(physics.snapshot().find(value => value.id === second.id)!.position.y).toBeLessThan(0);
  });

  it('settles the lab left wing after two real support blasts, preserves the right, and restores the rubble poses', async () => {
    const generated = generateCollapseLab();
    generated.world.removeSphere(LAB_SHOTS[0], 3.2);
    generated.world.removeSphere(LAB_SHOTS[1], 3.2);
    const result = analyzeStructure(createStructureInput(generated.world, generated.buildings.get(LAB_TEST_BUILDING_ID)!, 'physics-lab'));
    expect(result.fragments.length).toBeGreaterThan(1);
    generated.world.applyEdits(result.edits);
    const scene = new Scene();
    const physics = await manager(scene);
    for (const chunk of generated.world.chunks.values()) {
      if (chunk.cx >= 3 && chunk.cx <= 4 && chunk.cz >= 3 && chunk.cz <= 4) {
        physics.syncChunk(meshChunk(createMeshInput(generated.world, chunk.key)!));
      }
    }
    physics.addFragments(result.fragments);
    simulate(physics, 18);
    const diagnostics = physics.snapshot().map(piece => ({ id: piece.id, state: piece.state, y: piece.position.y, velocity: piece.linearVelocity, angular: piece.angularVelocity }));
    expect(physics.activeCount, JSON.stringify(diagnostics)).toBe(0);
    expect(physics.settledCount).toBe(result.fragments.length);
    expect(generated.world.getVoxel(112, 26, 132)).toBe(Material.Cream);
    const saved = physics.snapshot();
    const restored = await manager();
    restored.restore(saved);
    expect(restored.activeCount).toBe(0);
    const states = restored.snapshot();
    saved.forEach((piece, index) => {
      expect(states[index].position).toEqual(piece.position);
      expect(states[index].rotation.x).toBeCloseTo(piece.rotation.x, 6);
      expect(states[index].rotation.y).toBeCloseTo(piece.rotation.y, 6);
      expect(states[index].rotation.z).toBeCloseTo(piece.rotation.z, 6);
      expect(states[index].rotation.w).toBeCloseTo(piece.rotation.w, 6);
    });
  });

  it('removes an empty chunk collider instead of retaining an invisible floor', async () => {
    const physics = await manager();
    const world = ground();
    sync(physics, world);
    const empty = meshChunk(createMeshInput(world, '0,0,0')!);
    empty.revision++;
    empty.positions = new Float32Array(); empty.indices = new Uint32Array();
    physics.syncChunk(empty);
    physics.addFragments([fragment()]);
    simulate(physics, 2);
    expect(physics.snapshot()[0].position.y).toBeLessThan(0);
  });

  it('restores settled poses and in-flight velocities, and replaces duplicate IDs without leaking meshes', async () => {
    const scene = new Scene();
    const physics = await manager(scene);
    const saved = fragment();
    saved.state = 'settled';
    saved.position = { x: 6.25, y: 3.75, z: 8.125 };
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, .65);
    saved.rotation = { x: q.x, y: q.y, z: q.z, w: q.w };
    physics.restore([saved]);
    const pose = physics.snapshot()[0];
    simulate(physics, 5);
    expect(physics.snapshot()[0]).toEqual(pose);
    physics.restore([pose]);
    expect(scene.children).toHaveLength(1);
    expect(physics.snapshot()[0].position).toEqual(pose.position);
    expect(physics.snapshot()[0].rotation.y).toBeCloseTo(pose.rotation.y, 6);
    const moving = fragment('moving');
    moving.linearVelocity = { x: 2, y: -3, z: 1 };
    moving.angularVelocity = { x: .2, y: .4, z: .1 };
    physics.addFragments([moving]);
    expect(physics.snapshot().find(value => value.id === 'moving')!.linearVelocity).toEqual(moving.linearVelocity);
    physics.addFragments([moving]);
    expect(scene.children).toHaveLength(2);
    expect(physics.totalCount).toBe(2);
  });

  it('rejects an over-budget batch atomically and leaves airborne pieces active', async () => {
    const scene = new Scene();
    const physics = await manager(scene);
    expect(() => physics.addFragments(Array.from({ length: MAX_ACTIVE_FRAGMENTS + 1 }, (_, index) => fragment(`over-${index}`)))).toThrow(/不能超过/);
    expect(physics.totalCount).toBe(0);
    expect(scene.children).toHaveLength(0);
    const pieces = Array.from({ length: MAX_ACTIVE_FRAGMENTS }, (_, index) => {
      const value = fragment(`piece-${index}`);
      value.position = { x: index * 3, y: 90, z: 90 };
      return value;
    });
    physics.addFragments(pieces);
    simulate(physics, .5);
    expect(physics.activeCount).toBe(MAX_ACTIVE_FRAGMENTS);
    expect(() => physics.addFragments([fragment('extra')])).toThrow(/不能超过/);
    expect(physics.totalCount).toBe(MAX_ACTIVE_FRAGMENTS);
  });

  it('disposes bodies and owned geometry, while leaving the shared material intact', async () => {
    const scene = new Scene();
    const physics = await manager(scene);
    physics.addFragments([fragment()]);
    const mesh = scene.children[0] as Mesh;
    let geometryDisposed = false;
    let materialDisposed = false;
    mesh.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
    (mesh.material as MeshStandardMaterial).addEventListener('dispose', () => { materialDisposed = true; });
    physics.dispose(); physics.dispose(); physics.update(1);
    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(physics.snapshot()).toEqual([]);
    expect(physics.activeCount).toBe(0);
  });
});
