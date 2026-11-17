import { beforeAll, describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generate';
import { addHarborQuarter } from '../src/world/harbor-quarter';
import { addRegionalTerrain, regionalHeightAt } from '../src/world/region-terrain';
import { addRegionalDistricts } from '../src/world/region-districts';
import { REGION_PLACES, REGION_ROADS } from '../src/world/region-layout';
import { VoxelWalker } from '../src/input/walk';
import { buildSurfaceGrid, refreshSurfaceGrid, surfaceGridHeight } from '../src/world/surface-grid';
import { buildRainRoofMap, rainSurfaceAt } from '../src/rendering/rain';
import { Material } from '../src/world/palette';
import { VoxelWorld } from '../src/world/voxel';
import {Scene} from 'three';
import {WalkTransitions} from '../src/rendering/walk-transitions';

type Point = { x: number; z: number };
const connections = [
  { name: 'old east avenue into the industrial port', start: { x: 246, z: 164 }, points: [{ x: 256, z: 164 }, { x: 300, z: 164 }, { x: 320, z: 164 }], axis: 'x' as const, final: 319 },
  { name: 'old north road into the hill neighborhood', start: { x: 130, z: 8 }, points: [{ x: 130, z: 0 }, { x: 130, z: -40 }, { x: 130, z: -55 }], axis: 'z' as const, final: -54 },
  { name: 'old west coast into the cape road', start: { x: 8, z: 164 }, points: REGION_ROADS.find(road => road.id === 'west-coast')!.points.slice(0, 2).map(p => ({ x: p.x, z: p.z })).concat([{ x: -50, z: 155.14 }]), axis: 'x' as const, final: -49 },
];

let region: VoxelWorld;
let transitions:WalkTransitions;
beforeAll(() => {
  const base = generateWorld(); addHarborQuarter(base.world, base.buildings);
  addRegionalTerrain(base.world); addRegionalDistricts(base.world, base.buildings);
  region = base.world;
  transitions=new WalkTransitions(new Scene(),region);
});

/** Every movement here is an actual motor step; no seam is crossed by teleport. */
function follow(walker: VoxelWalker, points: readonly Point[]): { recovered: boolean; samples: number; progress: number[] } {
  let recovered = false, samples = 0;
  const progress: number[] = [];
  for (const target of points) {
    const initialDistance = Math.hypot(target.x - walker.position.x, target.z - walker.position.z);
    let frames = 0;
    while (Math.hypot(target.x - walker.position.x, target.z - walker.position.z) > .30 && frames++ < 60 * 45) {
      const dx = target.x - walker.position.x, dz = target.z - walker.position.z, distance = Math.hypot(dx, dz);
      walker.update(1 / 60, { x: dx / distance, z: dz / distance });
      recovered ||= walker.recoveredLastStep;
      expect(walker.canOccupy(walker.position)).toBe(true);
      expect(walker.position.y).toBeGreaterThan(12.1);
      if (frames % 60 === 0) {
        const remaining = Math.hypot(target.x - walker.position.x, target.z - walker.position.z);
        progress.push(initialDistance - remaining); samples++;
      }
    }
    expect(frames, `stuck before waypoint ${JSON.stringify(target)} at ${JSON.stringify(walker.position)}`).toBeLessThan(60 * 45);
    expect(Math.hypot(target.x - walker.position.x, target.z - walker.position.z)).toBeLessThanOrEqual(.31);
  }
  return { recovered, samples, progress };
}

describe('actual regional walking connections', () => {
  it('grades a road corner in visible 20cm steps while leaving an ordinary coastal ledge unassisted',()=>{
    const levels=[.1,.3,.5,.7,.9].map(t=>transitions.heightAt(136+t,-104.9));
    expect(levels.every(y=>y!==null)).toBe(true);
    for(let i=1;i<levels.length;i++)expect(Math.abs(levels[i]!-levels[i-1]!)).toBeLessThanOrEqual(.201);
    expect(transitions.heightAt(647.5,150.5)).toBeNull();
  });

  it('removes route treads and their support queries as soon as the real ground is destroyed',()=>{
    const x=136,z=-104,y=regionalHeightAt(x,z),material=region.getVoxel(x,y,z);
    expect(transitions.heightAt(x+.5,z+.5)).not.toBeNull();
    region.setVoxel(x,y,z,0);transitions.sync([`${x>>5},${y>>5},${z>>5}`]);
    expect(transitions.heightAt(x+.5,z+.5)).toBeNull();
    expect(transitions.nearby({x,y:y+1,z}).some(b=>b.minX>=x&&b.maxX<=x+1&&b.minZ>=z&&b.maxZ<=z+1)).toBe(false);
    region.setVoxel(x,y,z,material);transitions.sync([`${x>>5},${y>>5},${z>>5}`]);
  });
  it.each(connections)('walks continuously from $name', connection => {
    const top = regionalHeightAt(connection.start.x, connection.start.z);
    const walker = new VoxelWalker(region, { ...connection.start, y: top + 1 });
    walker.setObstacleProvider(()=>transitions.nearby(walker.position));
    const result = follow(walker, connection.points);
    expect(result.recovered).toBe(false);
    expect(result.samples).toBeGreaterThan(12);
    expect(Math.max(...result.progress)).toBeGreaterThan(15);
    if (connection.final > 0) expect(walker.position[connection.axis]).toBeGreaterThan(connection.final);
    else expect(walker.position[connection.axis]).toBeLessThan(connection.final);
    expect(walker.canOccupy(walker.position)).toBe(true);
    expect(walker.grounded).toBe(true);
  });

  it.each(REGION_ROADS.filter(road => ['hill-road', 'east-coast', 'west-coast'].includes(road.id)))('walks the complete $name after buildings, entrance paths and trees are added', road => {
    const start = road.points[0];
    const walker = new VoxelWalker(region, { x: start.x, y: regionalHeightAt(start.x, start.z) + 1, z: start.z });
    walker.setObstacleProvider(()=>transitions.nearby(walker.position));
    const result = follow(walker, road.points.slice(1));
    expect(result.recovered).toBe(false);
    expect(result.samples).toBeGreaterThan(40);
    expect(Math.max(...result.progress)).toBeGreaterThan(15);
    expect(walker.grounded).toBe(true);
    const end = road.points.at(-1)!;
    expect(Math.hypot(end.x - walker.position.x, end.z - walker.position.z)).toBeLessThanOrEqual(.31);
  },15000);

  it('gives the summit lookout a clear terrain sightline over its forward ridge toward the city', () => {
    const place = REGION_PLACES.find(place => place.id === 'ridge-lookout')!;
    const eyeHeight = regionalHeightAt(place.position.x, place.position.z) + 2.68;
    expect(eyeHeight).toBeCloseTo(place.position.y, 2);
    expect(regionalHeightAt(place.position.x, place.position.z)).toBe(77);
    for (let distance = 1; distance <= 150; distance += .5) {
      const t = distance / (place.lookAt.z - place.position.z);
      const x = place.position.x + (place.lookAt.x - place.position.x) * t;
      const z = place.position.z + distance;
      const sightHeight = eyeHeight + (place.lookAt.y - eyeHeight) * t;
      expect(sightHeight - regionalHeightAt(x, z) - 1, `ridge blocks the city at distance ${distance}m`).toBeGreaterThan(.4);
    }
  });
});

const surfaceBounds = { minX: -64, maxX: 320, minZ: -64, maxZ: 288 };
function surfaceFixture(): VoxelWorld {
  const world = new VoxelWorld(surfaceBounds);
  world.applyEdits([
    { x: -33, y: 4, z: -1, material: Material.Rock }, { x: -33, y: 11, z: -1, material: Material.Roof },
    { x: -1, y: 7, z: 0, material: Material.Wood }, { x: -1, y: 17, z: 0, material: Material.Window },
    { x: 0, y: 5, z: 0, material: Material.Rock }, { x: 0, y: 70, z: 0, material: Material.Trim },
    { x: 32, y: 31, z: -1, material: Material.Grass },
    { x: 255, y: 15, z: 100, material: Material.Road }, { x: 256, y: 22, z: 100, material: Material.Rock },
    { x: 319, y: 0, z: 287, material: Material.Sand },
  ]);
  return world;
}

describe('expanded surface and rain queries', () => {
  it('finds the highest real solid at negative chunks, the old zero seam and the original 256 boundary', () => {
    const grid = buildSurfaceGrid(surfaceFixture());
    expect(grid.bounds).toEqual(surfaceBounds); expect(grid.width).toBe(384); expect(grid.depth).toBe(352);
    expect(surfaceGridHeight(grid, -32.3, -.3)).toBe(12);
    expect(surfaceGridHeight(grid, -.2, .5)).toBe(18);
    expect(surfaceGridHeight(grid, .2, .5)).toBe(71);
    expect(surfaceGridHeight(grid, 32, -1)).toBe(32);
    expect(surfaceGridHeight(grid, 255.9, 100)).toBe(16);
    expect(surfaceGridHeight(grid, 256, 100)).toBe(23);
    expect(surfaceGridHeight(grid, 319, 287)).toBe(1);
    expect(surfaceGridHeight(grid, 320, 287)).toBe(0);
    expect(surfaceGridHeight(grid, -65, 0)).toBe(0);
  });

  it('updates removed roofs and newly allocated upper chunks only through dirty-column refresh', () => {
    const world = surfaceFixture(), grid = buildSurfaceGrid(world);
    const dirty = world.applyEdits([
      { x: -33, y: 11, z: -1, material: 0 }, { x: -1, y: 17, z: 0, material: 0 },
      { x: 256, y: 70, z: 101, material: Material.Roof }, { x: 0, y: 70, z: 0, material: 0 },
    ]);
    expect(surfaceGridHeight(grid, -33, -1)).toBe(12);
    refreshSurfaceGrid(world, grid, dirty);
    expect(surfaceGridHeight(grid, -33, -1)).toBe(5);
    expect(surfaceGridHeight(grid, -1, 0)).toBe(8);
    expect(surfaceGridHeight(grid, 0, 0)).toBe(6);
    expect(surfaceGridHeight(grid, 256, 101)).toBe(71);
    expect(surfaceGridHeight(grid, 255, 100)).toBe(16);
    expect(grid.data).toEqual(buildSurfaceGrid(world).data);
  });

  it('samples expanded rain roofs in the same world coordinates and falls back to sea level outside the region', () => {
    const world = surfaceFixture(), roof = buildRainRoofMap(world);
    expect(roof.length).toBe(384 * 352);
    expect(rainSurfaceAt(roof, -.2, .4, surfaceBounds)).toBe(18);
    expect(rainSurfaceAt(roof, .2, .4, surfaceBounds)).toBe(71);
    expect(rainSurfaceAt(roof, 256, 100, surfaceBounds)).toBe(23);
    expect(rainSurfaceAt(roof, 319, 287, surfaceBounds)).toBe(12);
    expect(rainSurfaceAt(roof, -65, -1, surfaceBounds)).toBe(12);
    expect(rainSurfaceAt(roof, 320, 100, surfaceBounds)).toBe(12);
  });
});
