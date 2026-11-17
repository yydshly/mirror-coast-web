import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BuildingRegistry, decodeWorldIndex, worldIndex } from '../src/destruction/buildings';
import { analyzeStructure, createStructureInput } from '../src/destruction/structure';
import { WorldPersistence } from '../src/persistence/storage';
import { createMeshInput, meshChunk, type MeshResult } from '../src/world/mesher';
import { Material } from '../src/world/palette';
import { VoxelWorld, type WorldBounds } from '../src/world/voxel';

const bounds: WorldBounds = { minX: -256, maxX: 768, minZ: -384, maxZ: 384 };
const saves: WorldPersistence[] = [];
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { saves.splice(0).forEach(save => save.dispose()); vi.unstubAllGlobals(); });

function persistence(region = true): WorldPersistence {
  const save = new WorldPersistence({ worldVersion: 'mirror-coast-v1', seed: 48271, ...(region ? { bounds } : {}) });
  saves.push(save); return save;
}

function triangleArea(mesh: MeshResult): number {
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3, b = mesh.indices[i + 1] * 3, c = mesh.indices[i + 2] * 3;
    const ux = mesh.positions[b] - mesh.positions[a], uy = mesh.positions[b + 1] - mesh.positions[a + 1], uz = mesh.positions[b + 2] - mesh.positions[a + 2];
    const vx = mesh.positions[c] - mesh.positions[a], vy = mesh.positions[c + 1] - mesh.positions[a + 1], vz = mesh.positions[c + 2] - mesh.positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    expect(nx * mesh.normals[a] + ny * mesh.normals[a + 1] + nz * mesh.normals[a + 2]).toBeGreaterThan(0);
    area += Math.hypot(nx, ny, nz) / 2;
  }
  return area;
}

describe('expanded authoritative world', () => {
  it('keeps the old 256 m default and expands without hiding or changing existing cells', () => {
    const world = new VoxelWorld();
    world.setVoxel(40, 17, 80, Material.Brick);
    expect(world.setVoxel(-1, 17, 80, Material.Rock)).toBe(false);
    expect(world.setVoxel(256, 17, 80, Material.Rock)).toBe(false);
    world.expandBounds(bounds);
    expect(world.bounds).toEqual(bounds);
    expect(world.setVoxel(-256, 17, -384, Material.Rock)).toBe(true);
    expect(world.setVoxel(767, 17, 383, Material.Grass)).toBe(true);
    expect(world.getVoxel(40, 17, 80)).toBe(Material.Brick);
    expect(world.contains(768, 17, 0)).toBe(false);
    expect(world.contains(0, 96, 0)).toBe(false);
    world.expandBounds({ minX: 0, maxX: 64, minZ: 0, maxZ: 64 });
    expect(world.bounds).toEqual(bounds);
    expect(world.getVoxel(-256, 17, -384)).toBe(Material.Rock);
    expect(() => world.expandBounds({ minX: 4, maxX: 4, minZ: 0, maxZ: 8 })).toThrow();
  });

  it('matches every optimized halo byte against authoritative reads across negative, partial and missing chunks', () => {
    const world = new VoxelWorld({ minX: -35, maxX: 7, minZ: -37, maxZ: 8 });
    for (let y = 0; y < 37; y++) for (let z = -37; z < 8; z++) for (let x = -35; x < 7; x++) {
      if ((x * 3 + y * 5 + z * 7) % 9 === 0) world.setVoxel(x, y, z, Material.Rock);
    }
    for (const key of ['-1,0,-1', '-2,0,-2', '0,1,0']) {
      const input = createMeshInput(world, key)!;
      expect(input).not.toBeNull();
      const differences: number[] = [];
      for (let y = 0; y < 34; y++) for (let z = 0; z < 34; z++) for (let x = 0; x < 34; x++) {
        const index = x + 34 * (z + 34 * y);
        const expected = world.getVoxel(input.cx * 32 + x - 1, input.cy * 32 + y - 1, input.cz * 32 + z - 1);
        if (input.halo[index] !== expected) differences.push(index);
      }
      expect(differences).toEqual([]);
    }
  });

  it('raycasts and destroys negative and distant coordinates using the expanded bounds', () => {
    const world = new VoxelWorld(bounds);
    world.setVoxel(-33, 17, -1, Material.Brick);
    world.setVoxel(300, 17, -1, Material.Blue);
    expect(world.raycast({ x: -50, y: 17.5, z: -.5 }, { x: 1, y: 0, z: 0 })).toEqual({ x: -33, y: 17, z: -1, distance: 17, normal: { x: -1, y: 0, z: 0 } });
    expect(world.raycast({ x: 900, y: 17.5, z: -.5 }, { x: -1, y: 0, z: 0 }, 700)).toEqual({ x: 300, y: 17, z: -1, distance: 599, normal: { x: 1, y: 0, z: 0 } });
    const removed = world.removeSphere({ x: -32.5, y: 17.5, z: -.5 }, 1.1);
    expect(removed.edits).toEqual([{ x: -33, y: 17, z: -1, material: 0 }]);
    expect(world.getVoxel(300, 17, -1)).toBe(Material.Blue);
  });

  it('keeps negative and positive building ownership separate and analyzes negative-coordinate support', () => {
    const world = new VoxelWorld(bounds), buildings = new BuildingRegistry();
    const add = (id: string, x0: number, z0: number) => {
      const cells: number[] = [];
      for(let y=0;y<15;y++)for(let z=z0;z<z0+4;z++)for(let x=x0;x<x0+4;x++)world.setVoxel(x,y,z,Material.Rock);
      for (let y = 15; y <= 22; y++) for (let z = z0; z < z0 + 4; z++) for (let x = x0; x < x0 + 4; x++) {
        world.setVoxel(x, y, z, Material.Brick); cells.push(worldIndex(x, y, z));
      }
      return buildings.add(id, id, 15, cells);
    };
    const negative = add('negative', -34, -4); add('positive', 300, 260);
    expect(buildings.findAt(-33, 20, -2)?.id).toBe('negative');
    expect(buildings.findAt(301, 20, 261)?.id).toBe('positive');
    expect(decodeWorldIndex(worldIndex(-256, 95, -384))).toEqual({ x: -256, y: 95, z: -384 });
    const edits = [];
    for (let z = -4; z < 0; z++) for (let x = -34; x < -30; x++) edits.push({ x, y: 17, z, material: 0 });
    world.applyEdits(edits);
    const result = analyzeStructure(createStructureInput(world, negative, 'negative-hit'));
    expect(result.edits).toHaveLength(4 * 4 * 5);
    expect(result.edits.every(p => p.x < 0 && p.z < 0 && p.y > 17)).toBe(true);
    expect(result.fragments.reduce((sum, part) => sum + part.voxels.length, 0)).toBe(result.edits.length);
    expect(world.getVoxel(301, 20, 261)).toBe(Material.Brick);
  });
});

describe('terrain face merging', () => {
  it('reduces a metre-authoritative 32 m terrain slab to six quads without changing surface area or winding', () => {
    const world = new VoxelWorld();
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) world.setVoxel(x, 16, z, Material.Grass);
    const mesh = meshChunk(createMeshInput(world, '0,0,0')!);
    expect(mesh.indices.length).toBe(6 * 6);
    expect(triangleArea(mesh)).toBe(32 * 32 * 2 + 32 * 4);
    expect(world.getVoxel(16, 16, 16)).toBe(Material.Grass);
    world.applyEdits([{ x: 16, y: 16, z: 16, material: 0 }]);
    const damaged = meshChunk(createMeshInput(world, '0,0,0')!);
    expect(triangleArea(damaged)).toBe(32 * 32 * 2 + 32 * 4 + 2);
    expect(world.getVoxel(16, 16, 16)).toBe(0);
  });

  it('keeps glass/trim rhythms as original metre faces and does not merge different terrain materials', () => {
    const world = new VoxelWorld();
    world.setVoxel(4, 4, 4, Material.Window); world.setVoxel(5, 4, 4, Material.Window);
    expect(meshChunk(createMeshInput(world, '0,0,0')!).indices.length).toBe(10 * 6);
    const terrain = new VoxelWorld();
    terrain.setVoxel(4, 4, 4, Material.Grass); terrain.setVoxel(5, 4, 4, Material.Sand);
    expect(meshChunk(createMeshInput(terrain, '0,0,0')!).indices.length).toBe(10 * 6);
  });

  it('culls shared terrain surfaces across the zero-coordinate chunk seam', () => {
    const world = new VoxelWorld(bounds);
    world.setVoxel(-1, 17, 0, Material.Rock); world.setVoxel(0, 17, 0, Material.Rock);
    const left = meshChunk(createMeshInput(world, '-1,0,0')!), right = meshChunk(createMeshInput(world, '0,0,0')!);
    expect(left.indices.length).toBe(5 * 6); expect(right.indices.length).toBe(5 * 6);
    expect(triangleArea(left) + triangleArea(right)).toBe(10);
  });
});

describe('regional save coordinates', () => {
  it('loads original data under the same key and round-trips old, negative and outer-region destruction together', async () => {
    const old = persistence(false);
    old.record([{ x: 80, y: 15, z: 120, material: 0 }]); await old.flush();
    const region = persistence();
    expect((await region.load())?.edits).toEqual([{ x: 80, y: 15, z: 120, material: 0 }]);
    region.record([{ x: -80, y: 25, z: -120, material: 0 }, { x: 700, y: 14, z: 300, material: 0 }]);
    await region.flush();
    const saved = await persistence().load();
    expect(saved?.schemaVersion).toBe(1); expect(saved?.worldVersion).toBe('mirror-coast-v1');
    expect(saved?.edits).toHaveLength(3);
    const imported = persistence(); await imported.importSave(await region.exportSave());
    expect((await imported.load())?.edits).toEqual(saved?.edits);
  });

  it('rejects coordinates outside the configured extent without altering the saved regional edits', async () => {
    const region = persistence();
    region.record([{ x: -80, y: 25, z: -120, material: 0 }]); await region.flush();
    for (const edit of [{ x: -257, y: 25, z: 0, material: 0 }, { x: 768, y: 25, z: 0, material: 0 }, { x: 0, y: 25, z: 384, material: 0 }]) {
      expect(() => region.record([edit])).toThrow();
    }
    expect((await persistence().load())?.edits).toEqual([{ x: -80, y: 25, z: -120, material: 0 }]);
    expect(() => persistence(false).record([{ x: -80, y: 25, z: -120, material: 0 }])).toThrow();
  });
});
