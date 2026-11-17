/** Metres in the same coordinate system as the original city. Max bounds exclude their edge. */
export const REGION_BOUNDS = { minX: -256, maxX: 768, minZ: -384, maxZ: 384 } as const;
export const REGION_BASE_VERSION = 'lighthouse-bay-region-v1';

export type RegionPoint = { x: number; y: number; z: number };
export type RegionRoad = {
  id: string;
  name: string;
  points: readonly RegionPoint[];
  halfWidth: number;
  shoulder: number;
};

const point = (x: number, y: number, z: number): RegionPoint => ({ x, y, z });
const road = (id: string, name: string, points: RegionPoint[]): RegionRoad => ({ id, name, points, halfWidth: 4.5, shoulder: 2 });

export const REGION_ROADS: readonly RegionRoad[] = [
  road('east-port', '东港大道', [point(255, 15, 125), point(300, 15, 125), point(390, 15, 125), point(470, 15, 145), point(540, 15, 145), point(610, 14, 125), point(680, 13, 105)]),
  road('east-coast', '南湾海岸路', [point(255, 15, 164), point(300, 15, 164), point(390, 15, 164), point(470, 15, 174), point(530, 15, 174), point(575, 14, 155), point(620, 13, 145), point(685, 13, 132)]),
  road('port-loop', '港区联络路', [point(255, 15, 80), point(330, 15, 80), point(470, 15, 80), point(520, 15, 125), point(520, 15, 145)]),
  road('hill-road', '山麓观景公路', [point(130, 15, 0), point(130, 19, -40), point(130, 24, -100), point(220, 30, -145), point(290, 38, -210), point(180, 46, -230), point(150, 55, -290), point(220, 77, -310)]),
  road('residential-loop', '山麓社区环路', [point(130, 20, -52), point(65, 21, -52), point(65, 25, -112), point(130, 25, -112), point(195, 27, -112), point(195, 22, -52), point(130, 20, -52)]),
  road('west-coast', '西岸海岬公路', [point(0, 15, 164), point(-30, 16, 162), point(-65, 18, 150), point(-100, 22, 135), point(-135, 26, 115), point(-180, 32, 90)]),
  road('west-village', '白墙海街', [point(-65, 18, 150), point(-65, 22, 100), point(-105, 24, 87), point(-145, 27, 75), point(-190, 30, 48)]),
  road('forest-road', '松林山道', [point(38, 15, 0), point(20, 18, -50), point(-60, 27, -90), point(-110, 34, -150), point(-90, 48, -245)]),
] as const;

export const REGION_DISTRICTS = [
  { id: 'old-city', name: '灯塔湾旧城', kind: 'city', minX: 0, maxX: 256, minZ: 0, maxZ: 174 },
  { id: 'west-village', name: '西岸白墙社区', kind: 'coastal-village', minX: -210, maxX: -30, minZ: 20, maxZ: 150 },
  { id: 'hill-neighborhood', name: '山麓台地住宅', kind: 'residential', minX: 55, maxX: 245, minZ: -145, maxZ: -35 },
  { id: 'east-port', name: '东港工业区', kind: 'industrial', minX: 280, maxX: 550, minZ: 20, maxZ: 190 },
  { id: 'south-bay', name: '南湾沙滩', kind: 'beach', minX: 550, maxX: 740, minZ: 75, maxZ: 230 },
  { id: 'northern-ridge', name: '北岭与松林', kind: 'hills', minX: -150, maxX: 600, minZ: -335, maxZ: -160 },
] as const;

/** Height is a road/plaza target. Use regionalHeightAt(x,z)+2.68 for the actual eye spawn. */
export const REGION_PLACES = [
  { id: 'east-port', name: '东港货运码头', position: point(356, 17.68, 125), lookAt: point(405, 23, 94) },
  { id: 'hill-neighborhood', name: '山麓台地住宅', position: point(130, 26.68, -98), lookAt: point(173, 29, -81) },
  { id: 'west-village', name: '西岸白墙海街', position: point(-82, 25.68, 95), lookAt: point(-137, 30, 73) },
  { id: 'west-cape', name: '西岸海岬', position: point(-180, 34.68, 90), lookAt: point(-155, 19, 190) },
  { id: 'south-bay', name: '南湾沙滩', position: point(650, 15.68, 139), lookAt: point(675, 13, 205) },
  { id: 'ridge-lookout', name: '北岭观景台', position: point(220, 79.68, -310), lookAt: point(170, 18, 90) },
  { id: 'forest-road', name: '松林山道', position: point(-90, 50.68, -245), lookAt: point(-50, 49, -200) },
] as const;

export const REGION_LAYOUT = { bounds: REGION_BOUNDS, roads: REGION_ROADS, districts: REGION_DISTRICTS, places: REGION_PLACES };

export type RegionRoadSample = { roadId: string; x: number; z: number; distance: number; across:number; height: number; along: number; halfWidth: number; shoulder: number };

/** Exact polyline projection, useful for route following and building setbacks. */
export function sampleRegionalRoad(x: number, z: number, maxDistance = 32): RegionRoadSample | null {
  let best: RegionRoadSample | null = null;
  for (const route of REGION_ROADS) {
    let prefix = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz;
      const length = Math.sqrt(lengthSquared);
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared));
      const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { roadId: route.id, x: a.x + dx * t, z: a.z + dz * t, distance,across:((x-a.x)*dz-(z-a.z)*dx)/length, height: a.y + (b.y - a.y) * t, along: prefix + length * t, halfWidth: route.halfWidth, shoulder: route.shoulder };
      }
      prefix += length;
    }
  }
  return best;
}

export function regionalRoadAt(x: number, z: number): RegionRoadSample | null {
  const result = sampleRegionalRoad(x, z, 7);
  return result && result.distance <= result.halfWidth + result.shoulder ? result : null;
}

export function sampleRoadPoint(roadId: string, distance: number): RegionPoint | null {
  const route = REGION_ROADS.find(item => item.id === roadId);
  if (!route) return null;
  let remaining = Math.max(0, distance);
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= length) {
      const t = remaining / length;
      return point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
    remaining -= length;
  }
  return { ...route.points[route.points.length - 1] };
}
