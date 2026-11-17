import { beforeAll, describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generate';
import { addHarborQuarter } from '../src/world/harbor-quarter';
import { addRegionalTerrain, isOriginalCityColumn, regionalHeightAt, regionalSurfaceAt } from '../src/world/region-terrain';
import { REGION_BOUNDS, REGION_PLACES, REGION_ROADS, sampleRegionalRoad, sampleRoadPoint } from '../src/world/region-layout';
import { Material } from '../src/world/palette';
import type { VoxelWorld } from '../src/world/voxel';

let world: VoxelWorld;
let originalChunks: Map<string, Uint8Array>;
let elapsedMs: number;
beforeAll(() => {
  const original = generateWorld(); addHarborQuarter(original.world, original.buildings);
  world = original.world;
  originalChunks = new Map([...world.chunks].map(([key, chunk]) => [key, chunk.voxels.slice()]));
  const start = performance.now(); addRegionalTerrain(world); elapsedMs = performance.now() - start;
});

describe('continuous regional terrain', () => {
  it('expands to real negative and positive coordinates without changing any old-city voxel or air', () => {
    expect(world.bounds).toEqual(REGION_BOUNDS);
    for (const [key, voxels] of originalChunks) expect(world.chunks.get(key)?.voxels).toEqual(voxels);
    const coreChunks = [...world.chunks.values()].filter(c => c.cx >= 0 && c.cx < 8 && c.cz >= 0 && c.cz < 8);
    expect(coreChunks).toHaveLength(originalChunks.size);
    expect(world.getVoxel(-150, regionalHeightAt(-150, 90), 90)).not.toBe(0);
    expect(world.getVoxel(650, regionalHeightAt(650, 145), 145)).not.toBe(0);
    expect(world.chunks.size).toBeGreaterThan(900);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it('meets every old mainland seam at its original ground height instead of adding a cliff', () => {
    for (let x = 0; x < 256; x++) expect(regionalHeightAt(x, -1)).toBe(15);
    for (let z = 0; z < 168; z++) {
      expect(regionalHeightAt(-1, z)).toBe(15);
      expect(regionalHeightAt(256, z)).toBe(15);
    }
  });

  it.each(REGION_ROADS)('keeps $name continuously paved, above water, and at one-metre maximum adjacent grade', road => {
    let previous: number | undefined;
    const total = road.points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - road.points[i].x, point.z - road.points[i].z), 0);
    for (let distance = 0; distance <= total; distance += .75) {
      const point = sampleRoadPoint(road.id, distance)!;
      const x = Math.floor(point.x), z = Math.floor(point.z), top = regionalHeightAt(x, z);
      expect(top).toBeGreaterThanOrEqual(13);
      if (previous !== undefined) expect(Math.abs(top - previous)).toBeLessThanOrEqual(1);
      const surface = world.getVoxel(x, top, z);
      expect([Material.Road, Material.Stripe, Material.Concrete]).toContain(surface);
      previous = top;
    }
  });

  it('ends all map borders underwater, with distinct beach, port, cape and northern ridge elevations', () => {
    for (let x = REGION_BOUNDS.minX; x < REGION_BOUNDS.maxX; x++) {
      expect(regionalHeightAt(x, REGION_BOUNDS.minZ)).toBeLessThanOrEqual(10);
      expect(regionalHeightAt(x, REGION_BOUNDS.maxZ - 1)).toBeLessThanOrEqual(10);
    }
    for (let z = REGION_BOUNDS.minZ; z < REGION_BOUNDS.maxZ; z++) {
      expect(regionalHeightAt(REGION_BOUNDS.minX, z)).toBeLessThanOrEqual(10);
      expect(regionalHeightAt(REGION_BOUNDS.maxX - 1, z)).toBeLessThanOrEqual(10);
    }
    expect(regionalHeightAt(390, 50)).toBe(15);
    expect(regionalHeightAt(310, -250)).toBeGreaterThan(70);
    expect(regionalHeightAt(-180, 90)).toBeGreaterThanOrEqual(31);
    expect(regionalSurfaceAt(635, 175)).toBe(Material.Sand);
    expect(regionalHeightAt(635, 175)).toBeLessThan(16);
  });

  it('forms deep northern and eastern coves instead of a coast parallel to the rectangular bounds', () => {
    const northShore: number[] = [], eastShore: number[] = [];
    for (let x = 0; x <= 600; x += 40) {
      for (let z = REGION_BOUNDS.minZ; z < -160; z++) {
        if (regionalHeightAt(x, z) >= 13) { northShore.push(z); break; }
      }
    }
    for (let z = -270; z <= 60; z += 30) {
      for (let x = REGION_BOUNDS.maxX - 1; x > 550; x--) {
        if (regionalHeightAt(x, z) >= 13) { eastShore.push(x); break; }
      }
    }
    expect(northShore).toHaveLength(16); expect(eastShore).toHaveLength(12);
    expect(Math.max(...northShore) - Math.min(...northShore)).toBeGreaterThan(100);
    expect(Math.max(...eastShore) - Math.min(...eastShore)).toBeGreaterThan(80);
  });

  it('provides precise nearest-road projection and non-core landmark destinations', () => {
    const sample = sampleRegionalRoad(356, 110, 50)!;
    expect(sample.roadId).toBe('east-port'); expect(sample.x).toBe(356); expect(sample.z).toBe(125);
    expect(sample.height).toBe(15); expect(sample.distance).toBe(15);
    for (const place of REGION_PLACES) {
      expect(isOriginalCityColumn(place.position.x, place.position.z)).toBe(false);
      expect(regionalHeightAt(place.position.x, place.position.z)).toBeGreaterThanOrEqual(13);
    }
  });

  it('allows real terrain destruction outside the old square and reconstructs the same surface from edits', () => {
    const x = -180, z = 90, y = regionalHeightAt(x, z);
    const original = world.getVoxel(x, y, z);
    const changed = world.removeSphere({ x: x + .5, y: y + .5, z: z + .5 }, 1.1);
    expect(changed.edits.length).toBeGreaterThan(0);
    expect(world.getVoxel(x, y, z)).toBe(0);
    expect(changed.dirtyKeys.some(key => key.startsWith('-'))).toBe(true);
    // Restore this shared fixture; saved edits are the same ordinary voxel tuples.
    const restore = changed.edits.map(edit => ({ ...edit, material: edit.y === regionalHeightAt(edit.x, edit.z) ? regionalSurfaceAt(edit.x, edit.z) : Material.Dirt }));
    world.applyEdits(restore);
    expect(world.getVoxel(x, y, z)).toBe(original);
  });
});
