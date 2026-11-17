import type {DecorationPart} from '../destruction/decorations';
import {
  BoxGeometry, CanvasTexture, DoubleSide, Euler, Group, InstancedMesh, Matrix4,
  Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Scene, SRGBColorSpace,
  Vector3, type Material,
} from 'three';
import { orientedCollisionBounds, type SceneObstacle } from '../input/scene-collisions';
import { REGION_ROADS } from '../world/region-layout';
import { regionalHeightAt } from '../world/region-terrain';
import { Material as VoxelMaterial } from '../world/palette';
import type { VoxelWorld } from '../world/voxel';
import {findFurnitureFooting,furnitureFootContacts} from '../world/furniture-footing';
import {surfaceFinish} from './surface-finish';
import type {SeatTarget} from '../input/ground-actions';
import {EXPLORATION_SITES} from '../world/exploration-sites';
import {staticDetailGroups} from './static-detail-groups';

type Cell = { x: number; y: number; z: number };
type Detail = { matrix: Matrix4; anchors: Cell[]; chunks: Set<string> };
type Batch = { material: MeshStandardMaterial; details: Detail[]; mesh?: InstancedMesh };
type SupportedObstacle = { bounds: SceneObstacle; anchors: Cell[] };
const inCore = (x: number, z: number) => x >= 0 && x < 256 && z >= 0 && z < 256;
const chunkFor = (p: Cell) => `${p.x >> 5},${p.y >> 5},${p.z >> 5}`;

/** Sparse road-scale details. Terrain and architecture are authoritative voxels. */
export class RegionArt {
  readonly obstacles: SceneObstacle[] = [];
  readonly seats:SeatTarget[]=[];
  readonly benchFootings:Array<{x:number;y:number;z:number;yaw:number;anchors:Cell[]}>=[];
  private readonly root = new Group();
  private readonly unit = new BoxGeometry(1, 1, 1);
  private readonly batches = new Map<MeshStandardMaterial, Batch>();
  private readonly drawBatches:Batch[]=[];
  private readonly materials = new Set<Material>();
  private readonly textures = new Set<CanvasTexture>();
  private readonly planes: PlaneGeometry[] = [];
  private readonly labels: Array<{ mesh: Mesh; anchors: Cell[] }> = [];
  private readonly obstacleDetails: SupportedObstacle[] = [];
  private readonly lit: MeshStandardMaterial[] = [];
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private readonly iron = this.material('#667779', .55, .4);
  private readonly dark = this.material('#273b42', .7, .2);
  private readonly timber = surfaceFinish(this.material('#806746', .83),'wood');
  private initialized=false;
  private readonly white = this.material('#d4d7c4', .75);

  constructor(scene: Scene, private world: VoxelWorld) {
    this.root.name = 'regional-roads-and-wayfinding'; scene.add(this.root);
    this.guardRails(); this.routeSigns(); this.lookoutDetails();
    for (const source of this.batches.values()) for(const details of staticDetailGroups(source.details,d=>d.matrix)) {
      const batch:Batch={material:source.material,details};
      const mesh = new InstancedMesh(this.unit, batch.material, batch.details.length);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate=false;
      batch.details.forEach((detail, i) => mesh.setMatrixAt(i, detail.matrix));
      mesh.computeBoundingSphere(); batch.mesh = mesh; this.root.add(mesh);this.drawBatches.push(batch);
    }
    this.sync(world.chunks.keys());
  }

  update(_dt: number, _focus?: Vector3, night = 0,detailDistance=320): void {
    if(_focus)for(const b of this.drawBatches){const sphere=b.mesh?.boundingSphere;if(b.mesh&&sphere)b.mesh.visible=Math.hypot(sphere.center.x-_focus.x,sphere.center.z-_focus.z)<detailDistance+sphere.radius;}
    for (const material of this.lit) material.emissiveIntensity = .025 + night * .4;
  }

  sync(dirtyKeys: Iterable<string>): void {
    const dirty = new Set(dirtyKeys);
    const supported = (anchors: Cell[]) => anchors.every(p => this.world.getVoxel(p.x, p.y, p.z) !== 0);
    for (const batch of this.drawBatches) {
      let changed = false;
      batch.details.forEach((detail, i) => {
        if (this.initialized&&![...detail.chunks].some(key => dirty.has(key))) return;
        batch.mesh?.setMatrixAt(i, supported(detail.anchors) ? detail.matrix : this.zero); changed = true;
      });
      if (changed && batch.mesh) batch.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const label of this.labels) if (!this.initialized||label.anchors.some(p => dirty.has(chunkFor(p)))) label.mesh.visible = supported(label.anchors);
    this.obstacles.length = 0;
    this.obstacles.push(...this.obstacleDetails.filter(entry => supported(entry.anchors)).map(entry => entry.bounds));
    this.initialized=true;
  }

  decorationParts():DecorationPart[]{this.root.updateMatrixWorld(true);return [...[...this.batches.values()].flatMap(b=>b.details.map(d=>({geometry:this.unit,material:b.material,matrix:d.matrix,anchors:d.anchors}))),...this.labels.map(d=>({geometry:d.mesh.geometry,material:d.mesh.material,matrix:d.mesh.matrixWorld.clone(),anchors:d.anchors,binding:'sign'}))];}

  dispose(): void {
    this.root.removeFromParent(); this.unit.dispose();
    for(const batch of this.drawBatches)batch.mesh?.dispose();
    this.planes.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose()); this.textures.forEach(texture => texture.dispose());
  }

  private material(color: string, roughness: number, metalness = 0): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness, metalness }); this.materials.add(material); return material;
  }

  private box(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: MeshStandardMaterial, anchors: Cell[], yaw = 0, solid = false, pitch = 0): void {
    let batch = this.batches.get(material);
    if (!batch) { batch = { material, details: [] }; this.batches.set(material, batch); }
    const rotation = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
    batch.details.push({ matrix: new Matrix4().compose(new Vector3(x, y, z), rotation, new Vector3(sx, sy, sz)), anchors, chunks: new Set(anchors.map(chunkFor)) });
    if (solid) this.obstacleDetails.push({ bounds: {...orientedCollisionBounds({ x, y, z }, rotation, { x: sx / 2, y: sy / 2, z: sz / 2 }),standable:false}, anchors });
  }

  private guardRails(): void {
    for (const route of REGION_ROADS) for (let segment = 1; segment < route.points.length; segment++) {
      const a = route.points[segment - 1], b = route.points[segment];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
      const slope = (b.y - a.y) / length;
      for (let distance = 5; distance < length - 3; distance += 10) for (const side of [-1, 1]) {
        const edge = route.halfWidth + route.shoulder + .8;
        const x = a.x + dx * distance - dz * edge * side, z = a.z + dz * distance + dx * edge * side;
        if (inCore(x, z)) continue;
        const ground = regionalHeightAt(x, z), outer = regionalHeightAt(x - dz * side * 7, z + dx * side * 7);
        if (ground < 13 || ground - outer < 3) continue;
        const anchor = { x: Math.floor(x), y: ground, z: Math.floor(z) };
        // Driveways cut a real gate through roadside protection.
        if (this.world.getVoxel(anchor.x, ground, anchor.z) === VoxelMaterial.Concrete) continue;
        const anchors = [-4, 0, 4].map(offset => {
          const px = Math.floor(x + dx * offset), pz = Math.floor(z + dz * offset);
          return { x: px, y: regionalHeightAt(px, pz), z: pz };
        });
        if (anchors.some(p => this.world.getVoxel(p.x, p.y, p.z) === VoxelMaterial.Concrete)) continue;
        const yaw = Math.atan2(dx, dz), y = ground + 1;
        const pitch = -Math.atan(slope), railLength = 9.5 * Math.sqrt(1 + slope * slope);
        this.box(x, y + .53, z, .10, 1.06, .10, this.iron, anchors);
        this.box(x, y + 1.03, z, .10, .12, railLength, this.iron, anchors, yaw, false, pitch);
        this.box(x, y + .53, z, .07, .07, railLength, this.dark, anchors, yaw, false, pitch);
        // Short collision sections avoid a long rotated AABB intruding into the road.
        const rotation = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
        for (let section = 0; section < 10; section++) {
          const along = (section - 4.5) * .95;
          this.obstacleDetails.push({ bounds: {...orientedCollisionBounds({ x: x + dx * along, y: y + .55 + slope * along, z: z + dz * along }, rotation, { x: .08, y: .55, z: .475 }),standable:false,vaultable:true}, anchors });
        }
      }
    }
  }

  private sign(x: number, z: number, yaw: number, title: string, subtitle: string): void {
    if (inCore(x, z)) return;
    const floor = regionalHeightAt(x, z), anchor = [{ x: Math.floor(x), y: floor, z: Math.floor(z) }];
    if (floor < 12) return;
    const ground = floor + 1;
    this.box(x, ground + 1.6, z, .09, 3.2, .09, this.iron, anchor, yaw, true);
    this.box(x, ground + 2.62, z, 4.9, 1.5, .12, this.dark, anchor, yaw,true);
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256;
    const context = canvas.getContext('2d'); if (!context) return;
    context.fillStyle = '#253c3e'; context.fillRect(0, 0, 768, 256);
    context.strokeStyle = '#d6d8bd'; context.lineWidth = 6; context.strokeRect(13, 13, 742, 230);
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#eee6c9';
    context.font = '600 60px "Microsoft YaHei",sans-serif'; context.fillText(title, 384, 91, 688);
    context.font = '34px "Segoe UI",sans-serif'; context.fillText(subtitle, 384, 178, 688);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; this.textures.add(texture);
    const material = new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#b2bda6', emissiveIntensity: .025, roughness: .8, side: DoubleSide });
    this.materials.add(material); this.lit.push(material);
    const geometry = new PlaneGeometry(4.74, 1.39); this.planes.push(geometry);
    const mesh = new Mesh(geometry, material); mesh.position.set(x + Math.sin(yaw) * .067, ground + 2.62, z + Math.cos(yaw) * .067); mesh.rotation.y = yaw;
    this.root.add(mesh); this.labels.push({ mesh, anchors: anchor });
  }

  private routeSigns(): void {
    this.sign(270, 134, -Math.PI / 2, '东 港 / EAST PORT →', 'WAREHOUSES  130 m   ·   SOUTH BAY  390 m');
    this.sign(139, -32, 0, '山麓住宅 / 北岭 ↑', 'HILLSIDE  80 m   ·   RIDGE LOOKOUT  420 m');
    this.sign(-52, 143, Math.PI / 2, '白墙海街 / 西岸海岬', 'COAST ROAD  ·  CAPE  170 m');
    this.sign(54, -69, 0, '山麓社区 / HILLSIDE', 'LOCAL STREETS  ·  SLOW');
    this.sign(638, 147, -Math.PI / 2, '南 湾 沙 滩', 'SOUTH BAY BEACH  ·  COAST WALK');
    this.sign(211, -302, 0, '北 岭 观 景 台', 'RIDGE LOOKOUT  ·  LIGHTHOUSE BAY BELOW');
    this.sign(-102, -223, .3, '松 林 山 道', 'FOREST ROAD  ·  KEEP TO THE TRAIL');
  }

  private bench(x: number, z: number, yaw: number): void {
    const legs=furnitureFootContacts([{x:-.69,z:0},{x:.69,z:0}],.035,.215),contacts=[...legs,...furnitureFootContacts([-.4,0,.4].map(x=>({x,z:-.95})),.15,.15)];
    const awayFromSteps=(x:number,z:number)=>!EXPLORATION_SITES.some(site=>site.route.some((b,i)=>{if(!i)return false;const a=site.route[i-1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<3.2;}));
    const placement=findFurnitureFooting(this.world,x,z,yaw,contacts,regionalHeightAt(x,z)+1,8,false,awayFromSteps);
    const footing=placement?findFurnitureFooting(this.world,placement.x,placement.z,yaw,legs,placement.y):null;
    if(!footing)return;
    x=footing.x;z=footing.z;const y=footing.y,anchors=footing.anchors;
    this.benchFootings.push({...footing,yaw});
    this.seats.push({id:`regional-bench-${x}-${z}`,halfWidth:.925,halfDepth:.25,position:{x:x-Math.sin(yaw)*.14,y:y+.51,z:z-Math.cos(yaw)*.14},floorY:y,yaw,available:()=>anchors.every(p=>!!this.world.getVoxel(p.x,p.y,p.z))&&this.obstacles.some(o=>o.minX<=x&&o.maxX>=x&&Math.abs(o.maxY-y-.51)<.01)});
    const transform = (dx: number, dz: number) => ({ x: x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, z: z - Math.sin(yaw) * dx + Math.cos(yaw) * dz });
    const back = transform(0, .21);
    this.box(x, y + .46, z, 1.85, .1, .5, this.timber, anchors, yaw);
    this.box(back.x, y + .83, back.z, 1.85, .62, .08, this.timber, anchors, yaw);
    for (const side of [-.69, .69]) { const leg = transform(side, 0); this.box(leg.x, y + .23, leg.z, .07, .46, .43, this.dark, anchors, yaw); }
    const rotation={x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)};
    const solid=(px:number,py:number,pz:number,sx:number,sy:number,sz:number,standable=true)=>this.obstacleDetails.push({bounds:{...orientedCollisionBounds({x:px,y:py,z:pz},rotation,{x:sx/2,y:sy/2,z:sz/2}),standable},anchors});
    solid(x,y+.46,z,1.85,.1,.5);
    solid(back.x,y+.83,back.z,1.85,.62,.08,false);
    for(const side of [-.69,.69]){const leg=transform(side,0);solid(leg.x,y+.23,leg.z,.07,.46,.43,false);}
  }

  private lookoutDetails(): void {
    this.bench(221, -302, Math.PI);
    this.bench(226, -307, Math.PI * .7);
    this.bench(-176, 99, .3);
    this.bench(650, 151, 0);
    // Discrete kilometre posts keep the long coast road legible without HUD clutter.
    for (const [x, z] of [[302, 155], [384, 155], [564, 165], [620, 151], [-112, 135], [165, -139], [193, -225]]) {
      const floor = regionalHeightAt(x, z); if (floor < 12 || inCore(x, z)) continue;
      const anchors = [{ x, y: floor, z }];
      this.box(x + .5, floor + 1.56, z + .5, .17, 1.12, .17, this.white, anchors,0,true);
      this.box(x + .5, floor + 1.99, z + .5, .19, .25, .19, this.dark, anchors,0,true);
    }
  }
}
