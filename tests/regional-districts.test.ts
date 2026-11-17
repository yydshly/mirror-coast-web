import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { generateWorld } from '../src/world/generate';
import { addHarborQuarter } from '../src/world/harbor-quarter';
import { addRegionalTerrain, regionalHeightAt } from '../src/world/region-terrain';
import { addRegionalDistricts, type RegionalDistrictResult } from '../src/world/region-districts';
import { REGION_BASE_VERSION, REGION_ROADS } from '../src/world/region-layout';
import { RegionArt } from '../src/rendering/region-art';
import { VoxelWalker } from '../src/input/walk';
import { analyzeStructure, createStructureInput } from '../src/destruction/structure';
import type { BuildingRegistry } from '../src/destruction/buildings';
import { WORLD_SEED, type VoxelWorld } from '../src/world/voxel';

let world: VoxelWorld, buildings: BuildingRegistry, summary: RegionalDistrictResult;
let original: Map<string, Uint8Array>, originalRecords: string[];
let baselineChecksum: string;
let art: RegionArt;
beforeAll(async () => {
  const generated = generateWorld(); world = generated.world; buildings = generated.buildings;
  addHarborQuarter(world, buildings);
  original = new Map([...world.chunks].map(([key, chunk]) => [key, chunk.voxels.slice()]));
  originalRecords = buildings.all.map(record => record.id);
  addRegionalTerrain(world); summary = addRegionalDistricts(world, buildings);
  baselineChecksum = await regionalBaselineChecksum(world);
  art = new RegionArt(new Scene(), world);
});
afterAll(() => art.dispose());

async function regionalBaselineChecksum(generated: VoxelWorld): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(`${JSON.stringify(generated.bounds)}\0`)];
  // Hash each address as well as its complete voxel array: moving unchanged
  // chunks must change the baseline, while map insertion order must not.
  for (const key of [...generated.chunks.keys()].sort()) {
    parts.push(encoder.encode(`${key}\0`), generated.chunks.get(key)!.voxels);
  }
  const input = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { input.set(part, offset); offset += part.byteLength; }
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function roofAt(x: number, z: number): number {
  for (let y = 94; y > 0; y--) if (world.getVoxel(x, y, z)) return y;
  return 0;
}

describe('regional architecture and actual travel', () => {
  it('preserves the frozen key-addressed regional baseline for existing saves', () => {
    expect(WORLD_SEED).toBe(48271);
    expect(REGION_BASE_VERSION).toBe('lighthouse-bay-region-v1');
    // Changes to this base require an explicit save migration/version decision;
    // existing saved edits must not silently target regenerated terrain.
    expect(baselineChecksum).toBe('4c04379fe1feab3a931fd6e2f78ef14d13d3c9d5d2cf744365f31ff798dc8d0c');
  });

  it('keeps every old-core cell, including air, and all original building IDs intact', () => {
    for (const [key, values] of original) expect(world.chunks.get(key)!.voxels, key).toEqual(values);
    expect(buildings.all.slice(0, originalRecords.length).map(record => record.id)).toEqual(originalRecords);
    expect(summary.buildingCount).toBe(35);
    expect(summary.treeCount).toBeGreaterThan(150);
    expect(summary.buildingIds.every(id => buildings.get(id))).toBe(true);
    expect(buildings.all.filter(record => record.id.startsWith('region-west-house-'))).toHaveLength(7);
    expect(buildings.all.filter(record => record.id.startsWith('region-hill-home-'))).toHaveLength(11);
  });

  it('has sawtooth, curved and gable industrial roof profiles and a visibly receding apartment', () => {
    const saw = Array.from({ length: 28 }, (_, i) => roofAt(350, 38 + i));
    expect(saw.filter((value, i) => i && saw[i - 1] - value >= 3).length).toBeGreaterThanOrEqual(2);
    const barrel = Array.from({ length: 46 }, (_, i) => roofAt(418 + i, 50));
    expect(barrel[22]).toBeGreaterThan(barrel[0] + 4);
    expect(Math.abs(barrel[1] - barrel[44])).toBeLessThanOrEqual(1);
    const workshop = Array.from({ length: 18 }, (_, i) => roofAt(370, 95 + i));
    expect(Math.max(...workshop)).toBeGreaterThan(workshop[0] + 2);
    const apartment = buildings.get('region-terraced-apartments')!;
    const floor = apartment.foundationY + 3;
    const widthAt = (y: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let z = -134; z < -104; z++) for (let x = 288; x < 332; x++) if (world.getVoxel(x, y, z)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      return hi - lo + 1;
    };
    expect(widthAt(floor + 5)).toBeGreaterThan(widthAt(floor + 13));
    expect(widthAt(floor + 13)).toBeGreaterThan(widthAt(floor + 23));
    expect(apartment.bounds.maxY).toBeLessThan(70);
  });

  it('starts every registered new structure fully connected instead of pre-detached roof pieces', () => {
    const unstable: string[] = [];
    for (const id of summary.buildingIds) {
      const result = analyzeStructure(createStructureInput(world, buildings.get(id)!, 'regional-baseline'));
      if (result.edits.length) unstable.push(`${id}:${result.edits.length}`);
    }
    expect(unstable).toEqual([]);
  });

  it('keeps all eight regional road centre-lines clear for bodies and vehicles', () => {
    const blocked: string[] = [];
    for (const road of REGION_ROADS) for (let segment = 1; segment < road.points.length; segment++) {
      const a = road.points[segment - 1], b = road.points[segment], length = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
      for (let n = 0; n <= length; n++) {
        const t = n / length, x = Math.round(a.x + (b.x - a.x) * t), z = Math.round(a.z + (b.z - a.z) * t);
        const y = regionalHeightAt(x, z) + 1;
        for (let dy = 0; dy < 3; dy++) if (world.getVoxel(x, y + dy, z)) blocked.push(`${road.id}:${x},${y + dy},${z}`);
      }
    }
    expect(blocked).toEqual([]);
    art.update(1 / 60, new Vector3(350, 18, 125), 1);
    expect(art.obstacles.length).toBeGreaterThan(10);
  });

  it('lets an actual character walk from the port road through the open factory entrance', () => {
    const walker = new VoxelWalker(world, { x: 359, y: 16, z: 79 });
    walker.setObstacleProvider(() => art.obstacles);
    for (let frame = 0; frame < 60 * 7; frame++) walker.update(1 / 60, { x: 0, z: -1 });
    expect(walker.position.z).toBeLessThan(62);
    expect(walker.position.z).toBeGreaterThan(54);
    expect(walker.position.y).toBeCloseTo(16, 4);
    expect(walker.canOccupy(walker.position)).toBe(true);
    expect(walker.recoveredLastStep).toBe(false);
  });
});
