import {
  BoxGeometry, BufferGeometry, Color, DoubleSide, Euler, Float32BufferAttribute, FrontSide,
  Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Scene, Vector3,
} from 'three';
import { EXPLORATION_SITES } from '../world/exploration-sites';
import { Material as VoxelMaterial } from '../world/palette';
import { sampleRegionalRoad } from '../world/region-layout';
import { regionalHeightAt } from '../world/region-terrain';
import type { Vector3Like, VoxelWorld } from '../world/voxel';
import {ChunkDependents} from '../world/chunk-dependents';

type Cell = { x: number; y: number; z: number };
type Detail = { matrix: Matrix4; anchors: readonly Cell[]; ground: number; x: number; z: number; color: string; supported: boolean };
type Batch = { mesh: InstancedMesh; details: Detail[]; material: MeshStandardMaterial };
const zones = [
  { x: -85, z: -227, radius: 52, density: .55 },
  { x: -184, z: 118, radius: 37, density: .43 },
  { x: 649, z: 161, radius: 65, density: .40 },
  { x: 133, z: -85, radius: 40, density: .30 },
  { x: 113, z: 186, radius: 30, density: .35 },
  { x: 151, z: 151, radius: 23, density: .43 },
  { x: 76, z: 124, radius: 22, density: .25 },
] as const;

const hash = (x: number, z: number, channel = 0): number => {
  const n = Math.sin(x * 127.1 + z * 311.7 + channel * 79.7) * 43758.5453123;
  return n - Math.floor(n);
};

function distanceToSegment(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

/** Small, non-solid ground cover. It never writes a voxel or changes walking support. */
export class GroundDetail {
  private readonly root = new Group();
  private readonly box = new BoxGeometry(1, 1, 1);
  private readonly blade = new BufferGeometry();
  private readonly batches: Batch[] = [];
  private readonly wind = { value: 0 };
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private readonly work = new Matrix4();
  private readonly fadeScale = new Vector3();
  private readonly color = new Color();
  private readonly lastFocus = new Vector3(Infinity, Infinity, Infinity);
  private timer = 1;
  private dirty = true;
  private readonly dependents=new ChunkDependents<Detail>();

  constructor(scene: Scene, private readonly world: VoxelWorld) {
    this.root.name = 'coastal-ground-cover';
    scene.add(this.root);
    // A narrow bent blade keeps the grass readable without alpha textures.
    this.blade.setAttribute('position', new Float32BufferAttribute([-.10, 0, 0, .10, 0, 0, .035, .58, .02, .02, 1, .12], 3));
    this.blade.setIndex([0, 1, 2, 0, 2, 3]);
    this.blade.computeVertexNormals();
    const grass: Detail[] = [], stems: Detail[] = [], seeds: Detail[] = [], stones: Detail[] = [], wood: Detail[] = [];
    const seen = new Set<string>();
    const rotation = new Quaternion(), euler = new Euler(), position = new Vector3(), scale = new Vector3();
    const add = (list: Detail[], anchors: readonly Cell[], ground: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, yaw: number, tilt = 0) => {
      list.push({ anchors, ground, x, z, color, supported: true, matrix: new Matrix4().compose(position.set(x, y, z), rotation.setFromEuler(euler.set(tilt, yaw, 0)), scale.set(sx, sy, sz)) });
    };
    for (const zone of zones) for (let iz = Math.floor((zone.z - zone.radius) / 2.6); iz <= (zone.z + zone.radius) / 2.6; iz++) {
      for (let ix = Math.floor((zone.x - zone.radius) / 2.6); ix <= (zone.x + zone.radius) / 2.6; ix++) {
        const key = `${ix},${iz}`;
        if (seen.has(key)) continue;
        const x = ix * 2.6 + hash(ix, iz, 1) * 1.7, z = iz * 2.6 + hash(ix, iz, 2) * 1.7;
        if (Math.hypot(x - zone.x, z - zone.z) > zone.radius || hash(ix, iz) > zone.density) continue;
        seen.add(key);
        const cell = { x: Math.floor(x), y: regionalHeightAt(x, z), z: Math.floor(z) }, ground = world.getVoxel(cell.x, cell.y, cell.z);
        if (cell.y < 13 || (ground !== VoxelMaterial.Grass && ground !== VoxelMaterial.Sand)) continue;
        if (world.getVoxel(cell.x, cell.y + 1, cell.z) || world.getVoxel(cell.x, cell.y + 2, cell.z)) continue;
        const anchors = [cell, ...[-.36, .36].flatMap(dx => [-.36, .36].map(dz => ({ x: Math.floor(x + dx), y: cell.y, z: Math.floor(z + dz) })))];
        if (anchors.some(c => world.getVoxel(c.x, c.y, c.z) !== ground || world.getVoxel(c.x, c.y + 1, c.z))) continue;
        // Leave actual roads, wooden paths and their immediate viewing edges clear.
        const road = sampleRegionalRoad(x, z, 9);
        if (road && road.distance < road.halfWidth + road.shoulder + 1.3) continue;
        if (EXPLORATION_SITES.some(site => site.route.some((b, i) => i > 0 && distanceToSegment(x, z, site.route[i - 1], b) < 2.25))) continue;
        const sandy = ground === VoxelMaterial.Sand, r = hash(ix, iz, 3), yaw = r * Math.PI * 2, y = cell.y + 1;
        if (sandy && r < .17) {
          add(wood, anchors, ground, x, y + .075, z, .13, .13, .5 + r * 2, '#94816a', yaw, .045);
        } else if (r < .13) {
          add(stones, anchors, ground, x, y + .09, z, .30 + r, .18, .32, sandy ? '#a7a79a' : '#7e8981', yaw, .08);
        } else {
          const color = sandy ? (r < .55 ? '#9b9d68' : '#a6a47a') : (r < .55 ? '#72865a' : '#8b9565');
          for (let i = 0; i < 5; i++) {
            const angle = yaw + i * 2.4, spread = .10 + hash(ix + i, iz, 5) * .17;
            const gx = x + Math.cos(angle) * spread, gz = z + Math.sin(angle) * spread;
            const height = (sandy ? .32 : .23) + hash(ix, iz + i, 6) * (sandy ? .40 : .30);
            add(grass, anchors, ground, gx, y + .01, gz, .8, height, .8, color, angle, .12);
          }
          if (sandy && r > .73) {
            const height = .68 + hash(ix, iz, 9) * .25;
            add(stems, anchors, ground, x, y + height / 2, z, .025, height, .025, '#969163', yaw, .07);
            add(seeds, anchors, ground, x, y + height, z, .06, .13, .06, '#797052', yaw, .07);
          }
        }
      }
    }
    this.makeBatch('grass', grass, this.blade, true);
    this.makeBatch('dune-stems', stems, this.box);
    this.makeBatch('dune-seeds', seeds, this.box);
    this.makeBatch('small-stones', stones, this.box);
    this.makeBatch('driftwood', wood, this.box);
    this.sync([]);
  }

  get diagnostics(): { instances: number; visible: number; batches: number } {
    return { instances: this.batches.reduce((n, b) => n + b.details.length, 0), visible: this.batches.reduce((n, b) => n + b.mesh.count, 0), batches: this.batches.length };
  }

  update(dt: number, focus: Vector3Like): void {
    this.wind.value += Math.min(.1, Math.max(0, dt));
    this.timer += dt;
    if (!this.dirty && this.timer < .22) return;
    if (!this.dirty && this.lastFocus.distanceTo(focus) < 1.5) return;
    this.timer = 0; this.dirty = false; this.lastFocus.set(focus.x, focus.y, focus.z);
    for (const batch of this.batches) {
      let cursor = 0;
      for (const detail of batch.details) {
        const distance = Math.hypot(detail.x - focus.x, detail.z - focus.z, detail.anchors[0].y - focus.y);
        if (!detail.supported || distance > 105) continue;
        const fade = Math.min(1, Math.max(0, (105 - distance) / 25));
        batch.mesh.setMatrixAt(cursor, fade < 1 ? this.work.copy(detail.matrix).scale(this.fadeScale.setScalar(fade)) : detail.matrix);
        batch.mesh.setColorAt(cursor, this.color.set(detail.color));
        cursor++;
      }
      batch.mesh.count = cursor;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
  }

  sync(dirtyKeys: Iterable<string>): void {
    const keys=Array.from(dirtyKeys),details=keys.length?this.dependents.affected(keys):this.batches.flatMap(b=>b.details);
    for(const detail of details){
      const supported=detail.anchors.every(c => this.world.getVoxel(c.x, c.y, c.z) === detail.ground && !this.world.getVoxel(c.x, c.y + 1, c.z));
      if(supported!==detail.supported){detail.supported=supported;this.dirty=true;}
    }
  }

  dispose(): void {
    this.root.removeFromParent(); this.box.dispose(); this.blade.dispose();
    for (const batch of this.batches) { batch.mesh.dispose(); batch.material.dispose(); }
  }

  private makeBatch(name: string, details: Detail[], geometry: BufferGeometry, windy = false): void {
    if (!details.length) return;
    for(const detail of details)this.dependents.add(detail,detail.anchors.flatMap(c=>[c,{...c,y:c.y+1}]));
    const material = new MeshStandardMaterial({ color: '#ffffff', roughness: .98, side: windy ? DoubleSide : FrontSide });
    if (windy) {
      material.onBeforeCompile = shader => {
        shader.uniforms.uGroundWind = this.wind;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGroundWind;');
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(uGroundWind*1.5 + instanceMatrix[3].x*.23 + instanceMatrix[3].z*.17) * .22 * transformed.y * transformed.y;');
      };
      material.customProgramCacheKey = () => 'coast-ground-wind-v1';
    }
    const mesh = new InstancedMesh(geometry, material, details.length);
    mesh.name = `ground-detail-${name}`; mesh.frustumCulled = false; mesh.receiveShadow = true;
    details.forEach((_, i) => mesh.setMatrixAt(i, this.zero)); mesh.count = 0;
    this.root.add(mesh); this.batches.push({ mesh, material, details });
  }
}
