import { BuildingRegistry, worldIndex } from '../destruction/buildings';
import { Material as M } from './palette';
import { sampleRegionalRoad } from './region-layout';
import { regionalHeightAt } from './region-terrain';
import type { VoxelWorld } from './voxel';

type Rect = { x: number; z: number; w: number; d: number };
type Face = 'north' | 'south' | 'west' | 'east';
type HouseKind = 'gable' | 'courtyard' | 'arcade';
export type RegionalDistrictResult = { buildingIds: string[]; buildingCount: number; treeCount: number };

const core = (x: number, z: number) => x >= 0 && x < 256 && z >= 0 && z < 256;
const hash = (x: number, z: number) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ 48271;
  n = Math.imul(n ^ (n >>> 13), 1274126177); return (n ^ (n >>> 16)) >>> 0;
};

/** New massing is outside the immutable old city. Buildings remain real voxels. */
export function addRegionalDistricts(world: VoxelWorld, buildings: BuildingRegistry): RegionalDistrictResult {
  const ids: string[] = [];
  const reserved: Rect[] = [];
  let owned: Set<number> | undefined;
  let treeCount = 0;
  const put = (x: number, y: number, z: number, m: number) => {
    if (core(x, z) || y < 0 || y > 94) return;
    world.setVoxel(x, y, z, m, false);
    if (m && owned) owned.add(worldIndex(x, y, z));
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, m);
  };
  const register = (id: string, name: string, foundation: number) => {
    if (owned?.size) { buildings.add(id, name, foundation, owned); ids.push(id); }
    owned = undefined;
  };
  const overlaps = (a: Rect, b: Rect, margin = 3) => a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.z < b.z + b.d + margin && a.z + a.d + margin > b.z;
  const lotClear = (r: Rect) => {
    if (reserved.some(previous => overlaps(r, previous))) return false;
    let lo = Infinity, hi = -Infinity;
    for (let z = r.z - 1; z <= r.z + r.d; z += 2) for (let x = r.x - 1; x <= r.x + r.w; x += 2) {
      if (core(x, z)) return false;
      const road = sampleRegionalRoad(x, z, 10);
      if (road && road.distance < road.halfWidth + road.shoulder + 1) return false;
      const h = regionalHeightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return lo >= 13 && hi < 66 && hi - lo <= 10;
  };
  const chooseLot = (r: Rect): Rect | null => {
    for (const [dx, dz] of [[0, 0], [0, 8], [0, -8], [8, 0], [-8, 0], [8, 8], [-8, -8], [0, 16], [0, -16]]) {
      const candidate = { ...r, x: r.x + dx, z: r.z + dz };
      if (lotClear(candidate)) { reserved.push(candidate); return candidate; }
    }
    return null;
  };
  const foundation = (r: Rect, mask: (x: number, z: number) => boolean = () => true) => {
    let floor = -Infinity, bottom = Infinity;
    for (let z = 0; z < r.d; z++) for (let x = 0; x < r.w; x++) if (mask(x, z)) {
      const h = regionalHeightAt(r.x + x, r.z + z); floor = Math.max(floor, h); bottom = Math.min(bottom, h);
    }
    owned = new Set();
    for (let z = 0; z < r.d; z++) for (let x = 0; x < r.w; x++) if (mask(x, z)) {
      for (let y = bottom; y <= floor; y++) put(r.x + x, y, r.z + z, y === floor ? M.Concrete : M.Rock);
    }
    return { floor, bottom };
  };
  const doorFace = (r: Rect): Face => {
    const road = sampleRegionalRoad(r.x + r.w / 2, r.z + r.d / 2, 160);
    if (!road) return 'south';
    const dx = road.x - r.x - r.w / 2, dz = road.z - r.z - r.d / 2;
    return Math.abs(dx) > Math.abs(dz) ? dx < 0 ? 'west' : 'east' : dz < 0 ? 'north' : 'south';
  };
  const connectEntrance = (start: { x: number; z: number }, floor: number, width = 3) => {
    const road = sampleRegionalRoad(start.x, start.z, 160); if (!road) return;
    const distance = Math.hypot(road.x - start.x, road.z - start.z);
    const steps = Math.max(1, Math.ceil(distance));
    const half = Math.floor(width / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = Math.round(start.x + (road.x - start.x) * t), z = Math.round(start.z + (road.z - start.z) * t);
      const surface = Math.round(floor + (road.height - floor) * t);
      for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) {
        const px = x + dx, pz = z + dz;
        if (core(px, pz)) continue;
        const mainRoad = sampleRegionalRoad(px, pz, 7);
        if (mainRoad && mainRoad.distance <= mainRoad.halfWidth + mainRoad.shoulder) continue;
        if (reserved.some(r => px >= r.x && px < r.x + r.w && pz >= r.z && pz < r.z + r.d)) continue;
        // A narrow graded approach supports walking/vehicles without a floating ribbon.
        const natural = regionalHeightAt(px, pz);
        for (let y = Math.min(natural, surface); y < surface; y++) if (!buildings.findAt(px, y, pz)) put(px, y, pz, M.Rock);
        if (!buildings.findAt(px, surface, pz)) put(px, surface, pz, M.Concrete);
        for (let y = surface + 1; y <= Math.max(surface + 2, natural); y++) if (!buildings.findAt(px, y, pz)) put(px, y, pz, M.Air);
      }
    }
  };

  const house = (id: string, name: string, initial: Rect, height: number, style: number, kind: HouseKind = 'gable'): boolean => {
    const r = chooseLot(initial); if (!r) return false;
    const mask = (x: number, z: number) => x >= 0 && z >= 0 && x < r.w && z < r.d && (kind !== 'courtyard' || x < Math.ceil(r.w * .46) || z < Math.ceil(r.d * .43));
    const { floor, bottom } = foundation(r, mask), face = doorFace(r);
    const wall = [M.Cream, M.Wood, M.Mint, M.Brick, M.Cream, M.Blue][style % 6];
    const roof = style % 3 === 1 ? M.Roof : M.Terracotta;
    const alongSize = face === 'north' || face === 'south' ? r.w : r.d;
    const door = Math.max(2, Math.floor(alongSize * (kind === 'courtyard' && (face === 'south' || face === 'east') ? .22 : .47)));
    const boundary = (x: number, z: number) => mask(x, z) && (!mask(x - 1, z) || !mask(x + 1, z) || !mask(x, z - 1) || !mask(x, z + 1));
    const atFront = (x: number, z: number) => face === 'north' ? z === 0 : face === 'south' ? z === r.d - 1 : face === 'west' ? x === 0 : x === r.w - 1;
    for (let y = floor + 1; y <= floor + height; y++) for (let z = 0; z < r.d; z++) for (let x = 0; x < r.w; x++) {
      if (!boundary(x, z)) continue;
      const u = face === 'north' || face === 'south' ? x : z;
      if (atFront(x, z) && u >= door && u <= door + 1 && y <= floor + 3) continue;
      const along = x === 0 || x === r.w - 1 ? z : x;
      const level = (y - floor) % 4;
      const window = level >= 2 && level <= 3 && along % 5 >= 1 && along % 5 <= 2;
      const frame = atFront(x, z) && ((u === door - 1 || u === door + 2) && y <= floor + 3 || y === floor + 4 && u >= door - 1 && u <= door + 2);
      const material = frame ? M.Trim : window ? (hash(r.x + x, r.z + z + y) % 5 ? M.Window : M.DarkWindow) : y === floor + 1 && style % 2 === 0 ? M.Brick : wall;
      put(r.x + x, y, r.z + z, material);
    }
    const roofAlongX = style % 2 === 0;
    for (let z = -1; z <= r.d; z++) for (let x = -1; x <= r.w; x++) {
      if (!mask(x, z) && !mask(x - 1, z) && !mask(x + 1, z) && !mask(x, z - 1) && !mask(x, z + 1)) continue;
      const axis = roofAlongX ? x : z, span = roofAlongX ? r.w : r.d;
      const lift = Math.max(0, Math.min(4, Math.floor(Math.min(axis + 1, span - axis) / 2)));
      const top = floor + height + 1 + lift;
      put(r.x + x, top, r.z + z, roof);
      if (boundary(x, z)) for (let y = floor + height + 1; y < top; y++) put(r.x + x, y, r.z + z, wall);
    }
    // A chimney, a short side wing, and open arcades alter the silhouettes.
    if (style % 3 === 0) box(r.x + r.w - 4, floor + height + 2, r.z + 2, r.x + r.w - 3, floor + height + 6, r.z + 3, M.Brick);
    if (kind === 'arcade') {
      const z = face === 'north' ? r.z - 3 : r.z + r.d + 2;
      if ((face === 'north' || face === 'south') && !sampleRegionalRoad(r.x + r.w / 2, z, 8)) {
        box(r.x, floor, Math.min(z, r.z), r.x + r.w - 1, floor, Math.max(z, r.z + r.d - 1), M.Concrete);
        box(r.x - 1, floor + 4, z, r.x + r.w, floor + 4, z, roof);
        for (let x = r.x + 1; x < r.x + r.w; x += 5) box(x, floor + 1, z, x, floor + 3, z, M.Trim);
      }
    }
    const entry = face === 'north' ? { x: r.x + door + 1, z: r.z - 1 } : face === 'south' ? { x: r.x + door + 1, z: r.z + r.d } : face === 'west' ? { x: r.x - 1, z: r.z + door + 1 } : { x: r.x + r.w, z: r.z + door + 1 };
    register(id, name, bottom); connectEntrance(entry, floor);
    return true;
  };

  const warehouse = (id: string, name: string, r: Rect, kind: 'saw' | 'barrel' | 'workshop') => {
    if (!lotClear(r)) return;
    reserved.push(r); const { floor, bottom } = foundation(r);
    const height = kind === 'barrel' ? 9 : kind === 'saw' ? 10 : 7;
    const top = floor + height, door = Math.floor(r.w * .44);
    for (let y = floor + 1; y <= top; y++) for (let z = 0; z < r.d; z++) for (let x = 0; x < r.w; x++) {
      const boundary = x === 0 || x === r.w - 1 || z === 0 || z === r.d - 1;
      if (!boundary) continue;
      if (z === r.d - 1 && x >= door && x < door + 6 && y <= floor + 5) continue;
      const rib = x % 8 === 0 || z % 8 === 0;
      const clerestory = y >= top - 2 && y < top && ((x > 1 && x < r.w - 2) || (z > 1 && z < r.d - 2));
      put(r.x + x, y, r.z + z, clerestory ? M.DarkWindow : y <= floor + 2 ? M.Brick : rib ? M.Roof : kind === 'workshop' ? M.Blue : M.Cream);
    }
    for (let z = -1; z <= r.d; z++) for (let x = -1; x <= r.w; x++) {
      let rise: number;
      if (kind === 'saw') rise = Math.floor(((z + 1) % 9) * .55);
      else if (kind === 'barrel') { const t = (x + .5) / r.w * 2 - 1; rise = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * 6); }
      else rise = Math.min(4, Math.floor(Math.min(z + 1, r.d - z) / 2));
      const roofY = top + 1 + rise;
      put(r.x + x, roofY, r.z + z, kind === 'workshop' ? M.Terracotta : M.Roof);
      if (x === 0 || x === r.w - 1 || z === 0 || z === r.d - 1) {
        for (let y = top + 1; y < roofY; y++) put(r.x + x, y, r.z + z, kind === 'barrel' && z % (r.d - 1) === 0 ? M.DarkWindow : M.Cream);
      }
      if (kind === 'saw' && (z + 1) % 9 === 8) for (let y = top + 1; y < roofY; y++) put(r.x + x, y, r.z + z, M.Window);
    }
    // Loading canopy is kept high enough to walk beneath.
    box(r.x + door - 2, floor + 5, r.z + r.d, r.x + door + 7, floor + 5, r.z + r.d + 3, M.Roof);
    register(id, name, bottom);
    connectEntrance({ x: r.x + door + 3, z: r.z + r.d + 1 }, floor, 5);
  };

  warehouse('region-port-sawtooth', '东港锯齿厂房', { x: 330, z: 38, w: 60, d: 28 }, 'saw');
  warehouse('region-port-vault', '东港拱顶货仓', { x: 418, z: 38, w: 46, d: 28 }, 'barrel');
  warehouse('region-port-workshop', '蓝墙修造车间', { x: 342, z: 95, w: 68, d: 18 }, 'workshop');

  // A working waterfront extends into the sea, rather than a disconnected room.
  box(425, 7, 182, 534, 14, 220, M.Concrete);
  box(425, 14, 176, 534, 14, 183, M.Concrete);
  for (const x of [430, 455, 480, 505, 530]) for (const z of [185, 214]) box(x, 3, z, x + 1, 13, z + 1, M.Rock);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    const x = 480 + col * 14, z = 29 + row * 11, y0 = 16;
    owned = new Set();
    const height = row === 1 && col % 2 === 0 ? 6 : 3;
    const color = [M.Red, M.Blue, M.Mint, M.Cream][(row + col) % 4];
    box(x, y0, z, x + 10, y0 + height - 1, z + 3, color);
    for (let q = 0; q <= 10; q += 2) box(x + q, y0 + height, z, x + q, y0 + height, z + 3, M.Roof);
    for (const end of [x, x + 10]) box(end, y0, z + 1, end, y0 + height - 1, z + 1, M.Roof);
    register(`region-port-container-${row}-${col}`, '东港货柜堆场', y0);
  }
  owned = new Set();
  box(491, 14, 199, 520, 14, 211, M.Roof);
  for (const x of [492, 517]) for (const z of [200, 209]) box(x, 15, z, x + 1, 43, z + 1, M.Stripe);
  box(486, 43, 199, 530, 45, 211, M.Stripe);
  for (const z of [199, 211]) box(487, 46, z, 529, 46, z, M.Roof);
  box(506, 37, 200, 510, 42, 203, M.DarkWindow);
  box(528, 26, 204, 528, 43, 204, M.Roof);
  box(526, 25, 203, 530, 25, 205, M.Roof);
  for (const x of [488, 528]) put(x, 46, 205, M.Lamp);
  register('region-port-gantry', '东港门式吊机', 14);

  const homes: Array<[number, number, number, number, number, HouseKind]> = [
    [78, -96, 14, 11, 5, 'gable'], [99, -96, 12, 11, 7, 'gable'],
    [79, -76, 13, 11, 4, 'courtyard'], [99, -76, 13, 11, 6, 'gable'],
    [148, -96, 14, 12, 6, 'gable'], [171, -96, 12, 11, 5, 'courtyard'],
    [148, -76, 13, 11, 7, 'gable'], [171, -76, 12, 11, 4, 'gable'],
    [214, -118, 17, 13, 8, 'courtyard'], [239, -110, 15, 12, 5, 'gable'], [203, -94, 19, 17, 7, 'courtyard'],
  ];
  homes.forEach(([x, z, w, d, h, kind], i) => house(`region-hill-home-${i + 1}`, `山麓住宅 ${i + 1}`, { x, z, w, d }, h, i, kind));

  const westLots: Array<[number, number, number, number, number, HouseKind]> = [
    [-90, 113, 13, 11, 8, 'gable'], [-115, 98, 16, 12, 5, 'arcade'],
    [-151, 93, 15, 13, 9, 'courtyard'], [-176, 69, 12, 11, 6, 'gable'],
    [-199, 95, 16, 12, 5, 'arcade'], [-133, 48, 15, 14, 10, 'courtyard'],
    [-89, 65, 12, 12, 7, 'gable'], [-44, 116, 13, 11, 6, 'gable'],
    [-200, 21, 14, 12, 5, 'gable'], [-45, 70, 15, 12, 8, 'courtyard'],
  ];
  let west = 0;
  for (const [x, z, w, d, h, kind] of westLots) {
    if (west >= 7) break;
    if (house(`region-west-house-${west + 1}`, ['海岬旅舍', '白墙海街咖啡', '海风院落', '坡巷民居', '西岸会馆', '白墙书局', '海街公寓'][west], { x, z, w, d }, h, west + 2, kind)) west++;
  }

  // A receding three-tier apartment is a new skyline, not another striped box.
  const apartment = chooseLot({ x: 288, z: -134, w: 44, d: 30 });
  if (apartment) {
    // Sink the lower storey into the hill rather than lifting a ten-metre flat
    // concrete block above its downhill edge. The upper terraces follow the slope.
    let bottom = Infinity;
    for (let z = apartment.z; z < apartment.z + apartment.d; z++) for (let x = apartment.x; x < apartment.x + apartment.w; x++) bottom = Math.min(bottom, regionalHeightAt(x, z));
    const floor = bottom + 3;
    owned = new Set();
    for (let z = apartment.z; z < apartment.z + apartment.d; z++) for (let x = apartment.x; x < apartment.x + apartment.w; x++) {
      for (let y = Math.min(bottom, regionalHeightAt(x, z)); y <= floor; y++) put(x, y, z, y === floor ? M.Concrete : M.Rock);
      for (let y = floor + 1; y <= regionalHeightAt(x, z) + 1; y++) put(x, y, z, M.Air);
    }
    const tiers = [[0, 0, 44, 30, 1, 8], [6, 4, 36, 24, 9, 16], [17, 8, 23, 18, 17, 26]];
    for (const [ox, oz, w, d, lower, upper] of tiers) {
      for (let y = floor + lower; y <= floor + upper; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
        if (y !== floor + lower && x > 0 && x < w - 1 && z > 0 && z < d - 1) continue;
        if (ox === 0 && x === 0 && z >= 11 && z <= 14 && y <= floor + 3) continue;
        const glazing = y > floor + lower && y % 4 !== (floor + lower) % 4 && (x % 5 !== 0 || z % 5 !== 0);
        put(apartment.x + ox + x, y, apartment.z + oz + z, glazing ? M.DarkWindow : M.Trim);
      }
      box(apartment.x + ox - 1, floor + upper + 1, apartment.z + oz - 1, apartment.x + ox + w, floor + upper + 1, apartment.z + oz + d, M.Roof);
      // Terraces are open, edged in low parapets rather than filled as extra mass.
      for (let x = apartment.x + ox; x < apartment.x + ox + w; x++) for (const z of [apartment.z + oz, apartment.z + oz + d - 1]) put(x, floor + upper + 2, z, M.Trim);
      if (ox > 0) for (let z = apartment.z + oz + 2; z < apartment.z + oz + d - 2; z += 5) put(apartment.x + ox - 3, floor + lower, z, M.Leaves);
    }
    register('region-terraced-apartments', '山海退台公寓', bottom);
    connectEntrance({ x: apartment.x - 1, z: apartment.z + 13 }, floor, 5);
  }

  const tree = (x: number, z: number, conifer: boolean) => {
    const floor = regionalHeightAt(x, z);
    if (core(x, z) || floor < 15 || floor > 75 || sampleRegionalRoad(x, z, 13) || reserved.some(r => x > r.x - 6 && x < r.x + r.w + 6 && z > r.z - 6 && z < r.z + r.d + 6)) return;
    const surface = world.getVoxel(x, floor, z);
    if (!surface || world.getVoxel(x, floor + 1, z) || surface === M.Concrete || surface === M.Road || surface === M.Stripe || surface === M.Wood) return;
    const h = (conifer ? 7 : 5) + hash(x, z) % 4;
    for (let y = floor + 1; y <= floor + h; y++) put(x, y, z, M.Wood);
    if (conifer) {
      for (let y = floor + 3; y <= floor + h + 2; y++) {
        const radius = Math.max(0, Math.min(3, Math.floor((floor + h + 3 - y) / 2)));
        for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= radius + 1 && (dx || dz)) put(x + dx, y, z + dz, (y + hash(x, z)) % 4 === 0 ? M.Grass : M.Leaves);
        }
      }
      put(x, floor + h + 2, z, M.Leaves);
    } else {
      for (const [dx, dy, dz, radius] of [[-1, 0, 0, 2], [1, 1, 1, 2], [0, 2, -1, 2], [0, 3, 0, 1]]) {
        for (let az = -radius; az <= radius; az++) for (let ax = -radius; ax <= radius; ax++) for (let ay = -1; ay <= 1; ay++) {
          if (Math.abs(ax) + Math.abs(az) + Math.abs(ay) > radius + 1) continue;
          put(x + dx + ax, floor + h + dy + ay, z + dz + az, hash(x + ax, z + az) % 6 === 0 ? M.Grass : M.Leaves);
        }
      }
    }
    treeCount++;
  };
  for (let z = -326; z < -150; z += 20) for (let x = -125; x < 520; x += 22) {
    if (hash(x, z) % 4 === 0) continue;
    tree(x + hash(x, z) % 7, z + hash(z, x) % 7, true);
  }
  // Uneven woodland groups make the approach roads pass through recognisable
  // forest bands instead of spacing every tree like another city grid.
  for (const [cx, cz] of [[-70, -185], [-15, -120], [340, -160], [440, -220], [90, -190]]) {
    for (let dz = -24; dz <= 24; dz += 9) for (let dx = -24; dx <= 24; dx += 9) {
      if (dx * dx + dz * dz > 28 * 28 || hash(cx + dx, cz + dz) % 5 === 0) continue;
      tree(cx + dx + hash(cx + dx, cz + dz) % 3, cz + dz + hash(cz + dz, cx + dx) % 3, true);
    }
  }
  for (let z = -135; z <= 125; z += 23) for (let x = -210; x < 340; x += 25) {
    if (hash(x, z) % 3) continue;
    tree(x + hash(x, z) % 8, z + hash(z, x) % 6, false);
  }
  for (const chunk of world.chunks.values()) chunk.revision = Math.max(1, chunk.revision);
  return { buildingIds: ids, buildingCount: ids.length, treeCount };
}
