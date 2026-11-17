import { Material } from './palette';
import { CHUNK_SIZE, chunkKey, type Chunk, type VoxelWorld } from './voxel';
import { REGION_BOUNDS, REGION_PLACES, REGION_ROADS, sampleRegionalRoad } from './region-layout';

export { regionalRoadAt, sampleRegionalRoad } from './region-layout';

const WIDTH = REGION_BOUNDS.maxX - REGION_BOUNDS.minX;
const DEPTH = REGION_BOUNDS.maxZ - REGION_BOUNDS.minZ;
const SEA_LEVEL = 12;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (a: number, b: number, value: number): number => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The protected original map includes its air, seabed, pier and old harbor. */
export const isOriginalCityColumn = (x: number, z: number): boolean => x >= 0 && x < 256 && z >= 0 && z < 256;

function oldHeight(x: number, z: number): number {
  const shore = 179 + Math.round(4 * Math.sin(x * .036) + 3 * Math.sin(x * .079));
  const d = shore - z;
  return d >= 6 ? 15 : d >= 0 ? 12 + Math.floor(d / 2) : Math.max(3, 10 + Math.floor(d * .14));
}

function rectangleWeight(x: number, z: number, x0: number, x1: number, z0: number, z1: number, feather: number): number {
  return smooth(x0 - feather, x0, x) * (1 - smooth(x1, x1 + feather, x)) * smooth(z0 - feather, z0, z) * (1 - smooth(z1, z1 + feather, z));
}

function coastAt(x: number): number {
  return 180 + Math.sin(x * .009) * 17 + Math.sin(x * .021 + .7) * 10;
}

function naturalHeight(x: number, z: number): number {
  const shore = coastAt(x), d = shore - z;
  let height: number;
  if (d < 0) height = Math.max(3, 10 + d * .115);
  else {
    const north = smooth(0, 255, -z);
    const ridge = 36 * Math.exp(-(((x - 305) / 188) ** 2) - ((z + 257) / 108) ** 2);
    const rolling = north * (5.5 * Math.sin(x * .018 + z * .004) + 3.7 * Math.sin(z * .026 - x * .006));
    const westRise = (1 - smooth(-60, 0, x)) * smooth(8, 100, d) * (10 + 4 * Math.sin(x * .025 + z * .012));
    height = 15 + north * 31 + ridge + rolling + westRise;
    // Tidal shelves, then grass-capped bluffs, connect land to a real sloping seabed.
    height = mix(12, height, smooth(0, 7, d));
    const beachWeight = smooth(525, 590, x) * (1 - smooth(55, 105, d));
    height = mix(height, 12 + Math.min(8, d * .10), beachWeight);
    const port = rectangleWeight(x, z, 280, 540, 22, 177, 22);
    height = mix(height, 15, port);
    const residential = rectangleWeight(x, z, 64, 208, -122, -42, 14);
    const terrace = (z < -88 ? 25 : 21) + (x > 140 ? 1 : 0);
    height = mix(height, terrace, residential);
  }
  // Broad coves eat into the north and east shores. Interleaved narrow headlands
  // make the silhouette independent of the rectangular voxel storage bounds.
  const edgeDistance = Math.min(x - REGION_BOUNDS.minX, REGION_BOUNDS.maxX - 1 - x, z - REGION_BOUNDS.minZ, REGION_BOUNDS.maxZ - 1 - z);
  const northInset = 18 + 76 * Math.exp(-(((x - 35) / 87) ** 2)) + 110 * Math.exp(-(((x - 500) / 105) ** 2))
    + 15 * (.5 + .5 * Math.sin(x * .037)) + 12 * (.5 + .5 * Math.sin(x * .011 + .7));
  const eastInset = 18 + 95 * Math.exp(-(((z + 135) / 82) ** 2)) + 50 * Math.exp(-(((z + 285) / 60) ** 2))
    + 18 * (.5 + .5 * Math.sin(z * .039 + .9));
  const erodedDistance = Math.min(edgeDistance, REGION_BOUNDS.maxX - 1 - x - eastInset, z - REGION_BOUNDS.minZ - northInset);
  let coastWeight = smooth(0, 64, edgeDistance);
  if (erodedDistance < 64) {
    // Existing roads keep their entire graded 25m envelope. Outside it the
    // headland widens gently, so a protected road never becomes a thin sea wall.
    const road = sampleRegionalRoad(x + .5, z + .5, 80);
    let erosion = road ? smooth(25, 80, road.distance) : 1;
    for (const place of REGION_PLACES) erosion = Math.min(erosion, smooth(40, 75, Math.hypot(x - place.position.x, z - place.position.z)));
    coastWeight = mix(coastWeight, Math.min(coastWeight, smooth(0, 48, erodedDistance)), erosion);
  }
  height = mix(3, height, coastWeight);
  // Exact old-city edge heights win near the protected square. Even steep outer
  // hills begin gently at the seam, rather than burying streets under a new cliff.
  const nearestX = clamp(x, 0, 255), nearestZ = clamp(z, 0, 255);
  const coreDistance = Math.hypot(x - nearestX, z - nearestZ);
  if (coreDistance < 48) height = mix(oldHeight(nearestX, nearestZ), height, smooth(0, 48, coreDistance));
  // The lookout is the summit of a real graded road. Shave only the few metres
  // of its forward ridge that would otherwise hide the city below the skyline.
  const viewDistance = z + 310;
  if (viewDistance > 18 && viewDistance < 150) {
    const viewCenterX = 220 - viewDistance * .125, viewHalfWidth = 14 + viewDistance * .25;
    const clearing = (1 - smooth(viewHalfWidth, viewHalfWidth + 15, Math.abs(x - viewCenterX)))
      * smooth(18, 34, viewDistance) * (1 - smooth(132, 150, viewDistance));
    const viewSlope = 77.48 - viewDistance * .1542;
    height = mix(height, Math.min(height, Math.max(height - 4, viewSlope)), clearing);
  }
  return clamp(height, 3, 82);
}

type Fields = { heights: Uint8Array; surfaces: Uint8Array };
let cached: Fields | undefined;

function indexAt(x: number, z: number): number {
  return x - REGION_BOUNDS.minX + (z - REGION_BOUNDS.minZ) * WIDTH;
}

function fields(): Fields {
  if (cached) return cached;
  const heights = new Uint8Array(WIDTH * DEPTH), surfaces = new Uint8Array(WIDTH * DEPTH);
  const nearestDistance = new Float32Array(WIDTH * DEPTH); nearestDistance.fill(Infinity);
  const roadHeight = new Float32Array(WIDTH * DEPTH), roadAlong = new Float32Array(WIDTH * DEPTH);
  const roadNumber = new Int8Array(WIDTH * DEPTH); roadNumber.fill(-1);

  // Only rasterize a short band around each segment. Most terrain never executes
  // a nearest-polyline search, which keeps the million-column generator cheap.
  REGION_ROADS.forEach((route, routeIndex) => {
    let prefix = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz, length = Math.sqrt(lengthSquared);
      const band = 25;
      const minX = Math.max(REGION_BOUNDS.minX, Math.floor(Math.min(a.x, b.x) - band));
      const maxX = Math.min(REGION_BOUNDS.maxX - 1, Math.ceil(Math.max(a.x, b.x) + band));
      const minZ = Math.max(REGION_BOUNDS.minZ, Math.floor(Math.min(a.z, b.z) - band));
      const maxZ = Math.min(REGION_BOUNDS.maxZ - 1, Math.ceil(Math.max(a.z, b.z) + band));
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        const t = clamp(((x + .5 - a.x) * dx + (z + .5 - a.z) * dz) / lengthSquared, 0, 1);
        const distance = Math.hypot(x + .5 - a.x - dx * t, z + .5 - a.z - dz * t), index = indexAt(x, z);
        if (distance > band || distance >= nearestDistance[index]) continue;
        nearestDistance[index] = distance; roadHeight[index] = a.y + (b.y - a.y) * t;
        roadAlong[index] = prefix + length * t; roadNumber[index] = routeIndex;
      }
      prefix += length;
    }
  });

  for (let z = REGION_BOUNDS.minZ; z < REGION_BOUNDS.maxZ; z++) for (let x = REGION_BOUNDS.minX; x < REGION_BOUNDS.maxX; x++) {
    const index = indexAt(x, z);
    if (isOriginalCityColumn(x, z)) { heights[index] = oldHeight(x, z); surfaces[index] = Material.Grass; continue; }
    let height = naturalHeight(x, z);
    const roadIndex = roadNumber[index];
    let surface: number;
    if (roadIndex >= 0) {
      const route = REGION_ROADS[roadIndex], distance = nearestDistance[index], paved = route.halfWidth + route.shoulder;
      height = mix(height, roadHeight[index], 1 - smooth(paved, 25, distance));
      if (distance <= route.halfWidth) surface = distance < .48 && roadAlong[index] % 12 < 5 ? Material.Stripe : Material.Road;
      else if (distance <= paved) surface = Material.Concrete;
      else surface = surfaceFor(x, z, height);
    } else surface = surfaceFor(x, z, height);
    heights[index] = Math.round(clamp(height, 3, 82)); surfaces[index] = surface;
  }
  cached = { heights, surfaces };
  return cached;
}

function surfaceFor(x: number, z: number, height: number): number {
  if (height < SEA_LEVEL + 1 || (x > 535 && z > 80 && height < 23) || (coastAt(x) - z < 17 && height < 24)) return Material.Sand;
  if (height > 64 && Math.sin(x * .033 - z * .015) > -.35) return Material.Rock;
  return Material.Grass;
}

/** Immutable base terrain height, not the highest building or later player edit. */
export function regionalHeightAt(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix < REGION_BOUNDS.minX || ix >= REGION_BOUNDS.maxX || iz < REGION_BOUNDS.minZ || iz >= REGION_BOUNDS.maxZ) return 3;
  return fields().heights[indexAt(ix, iz)];
}

export function regionalSurfaceAt(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix < REGION_BOUNDS.minX || ix >= REGION_BOUNDS.maxX || iz < REGION_BOUNDS.minZ || iz >= REGION_BOUNDS.maxZ) return Material.Sand;
  return fields().surfaces[indexAt(ix, iz)];
}

export type RegionalTerrainSummary = { bounds: typeof REGION_BOUNDS; columnCount: number; chunksAdded: number; highestPoint: number };

/** Fill authoritative chunk volumes. Old-city chunks are never touched, even air. */
export function addRegionalTerrain(world: VoxelWorld): RegionalTerrainSummary {
  world.expandBounds(REGION_BOUNDS);
  const { heights, surfaces } = fields();
  let chunksAdded = 0, highestPoint = 0;
  for (let cz = REGION_BOUNDS.minZ >> 5; cz < REGION_BOUNDS.maxZ >> 5; cz++) {
    for (let cx = REGION_BOUNDS.minX >> 5; cx < REGION_BOUNDS.maxX >> 5; cx++) {
      if (cx >= 0 && cx < 8 && cz >= 0 && cz < 8) continue;
      const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
      let low = 95, high = 0;
      for (let lz = 0; lz < 32; lz++) for (let lx = 0; lx < 32; lx++) {
        const top = heights[indexAt(ox + lx, oz + lz)]; low = Math.min(low, top); high = Math.max(high, top);
      }
      highestPoint = Math.max(highestPoint, high);
      for (let cy = 0; cy <= high >> 5; cy++) {
        const key = chunkKey(cx, cy, cz), oy = cy * CHUNK_SIZE;
        const chunk: Chunk = { key, cx, cy, cz, voxels: new Uint8Array(CHUNK_SIZE ** 3), revision: 1 };
        // Whole rock layers are a contiguous fill; only the variable surface cap
        // needs per-column writes. Typical flat ground touches only four layers.
        const rockLayers = clamp(low - 3 - oy, 0, 32);
        chunk.voxels.fill(Material.Rock, 0, rockLayers * 1024);
        for (let lz = 0; lz < 32; lz++) for (let lx = 0; lx < 32; lx++) {
          const index = indexAt(ox + lx, oz + lz), top = heights[index], surface = surfaces[index];
          const cap = surface === Material.Sand ? Material.Sand : surface === Material.Rock ? Material.Rock : Material.Dirt;
          for (let y = Math.max(oy + rockLayers, 0); y <= Math.min(top, oy + 31); y++) {
            chunk.voxels[lx + 32 * (lz + 32 * (y - oy))] = y === top ? surface : y < top - 3 ? Material.Rock : cap;
          }
        }
        world.chunks.set(key, chunk); chunksAdded++;
      }
    }
  }
  return { bounds: REGION_BOUNDS, columnCount: WIDTH * DEPTH - 256 * 256, chunksAdded, highestPoint };
}
