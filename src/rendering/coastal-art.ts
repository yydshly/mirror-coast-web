import type {DecorationPart} from '../destruction/decorations';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry,
  DoubleSide, Euler, Group, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry,
  Scene, SRGBColorSpace, Vector3, type Material as ThreeMaterial,
} from 'three';
import { HELIPAD } from '../route/coast-route';
import { Material } from '../world/palette';
import type { VoxelWorld } from '../world/voxel';
import type { BuildingRegistry, BuildingRecord } from '../destruction/buildings';
import { orientedCollisionBounds, type SceneObstacle } from '../input/scene-collisions';
import {findFurnitureFooting,furnitureFootContacts} from '../world/furniture-footing';
import type {SeatTarget} from '../input/ground-actions';
import {surfaceFinish} from './surface-finish';
import {surfacePatches} from './surface-patches';
import {MooredSailboats} from './moored-boats';
import {staticDetailGroups} from './static-detail-groups';

type Cell = { x: number; y: number; z: number };
type Detail = { matrix: Matrix4; anchors: Cell[]; chunks: Set<string>;surfaceOnly?:boolean };
type Batch = { material: MeshStandardMaterial; details: Detail[]; mesh?: InstancedMesh };
type SupportedGroup = { group: Group; anchors: Cell[]; chunks: Set<string> };
const chunkFor = (p: Cell): string => `${p.x >> 5},${p.y >> 5},${p.z >> 5}`;

export type CoastalLamp = { x: number; z: number; base: number };

/** Runtime style migration only; the canonical generator and user edit log stay intact. */
export function restyleLegacyLamps(world: VoxelWorld): CoastalLamp[] {
  const positions: CoastalLamp[] = [];
  for (let x = 10; x <= 250; x += 20) positions.push({ x, z: 172, base: 16 });
  for (const x of [44, 124, 216]) for (const z of [44, 89, 134]) positions.push({ x, z, base: 16 });
  for (const x of [102, 113]) for (const z of [184, 200, 215]) positions.push({ x, z, base: 15 });
  const replacements: CoastalLamp[] = [];
  const edits: Array<Cell & { material: number }> = [];
  for (const lamp of positions) {
    const expected = new Map<string, Cell & { material: number }>();
    const cell = (x: number, y: number, z: number, material: number) => expected.set(`${x},${y},${z}`, { x, y, z, material });
    for (let y = lamp.base; y <= lamp.base + 5; y++) cell(lamp.x, y, lamp.z, Material.Roof);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) cell(lamp.x + dx, lamp.base + 5, lamp.z + dz, Material.Roof);
    cell(lamp.x, lamp.base + 6, lamp.z, Material.Lamp);
    const full = [...expected.values()].every(p => world.getVoxel(p.x, p.y, p.z) === p.material);
    if (full && world.getVoxel(lamp.x, lamp.base - 1, lamp.z) !== 0) replacements.push(lamp);
    // Partial player damage is respected: remove only original lamp materials,
    // but do not resurrect a replacement fixture when any original cell is gone.
    for (const p of expected.values()) if (world.getVoxel(p.x, p.y, p.z) === p.material) edits.push({ x: p.x, y: p.y, z: p.z, material: 0 });
  }
  world.applyEdits(edits);
  return replacements;
}

/** Human-scale additions are regenerated from the base; support edits hide them. */
export class CoastalArt {
  readonly obstacles: SceneObstacle[] = [];
  readonly benchFootings:Array<{x:number;y:number;z:number;anchors:Cell[]}>=[];
  readonly seats:SeatTarget[]=[];
  private initialized=false;
  private readonly obstacleDetails: Array<{ bounds: SceneObstacle; anchors: Cell[] }> = [];
  private root = new Group();
  private box = new BoxGeometry(1, 1, 1);
  private batches = new Map<MeshStandardMaterial, Batch>();
  private drawBatches:Batch[]=[];
  private supported: SupportedGroup[] = [];
  readonly mooredBoats:MooredSailboats;
  private geometries = new Set<BufferGeometry>();
  private materials = new Set<ThreeMaterial>();
  private textures = new Set<CanvasTexture>();
  private elapsed = 0;
  private zero = new Matrix4().makeScale(0, 0, 0);
  private cream = this.material('#d8d4c3', .72);
  private iron = this.material('#293d43', .6, .25);
  private wood = surfaceFinish(this.material('#775239', .92),'wood');
  private white = this.material('#eee9d4', .8);
  private green = this.material('#456f5a', .88);

  constructor(private scene: Scene, private world: VoxelWorld, buildings: BuildingRegistry, options: { facades?: boolean; headlands?: boolean } = {}) {
    this.root.name = 'coastal-human-scale-details';
    scene.add(this.root);
    this.addFineLamps(restyleLegacyLamps(world));
    this.addPromenade();
    this.addDock();
    // District-wide facades are supplied by StreetArt; keep the pier and coast here.
    if (options.facades !== false) buildings.all.filter(b => b.bounds.minZ > 130 && b.bounds.minZ < 150 && b.bounds.maxX > 45 && b.bounds.minX < 170).slice(0, 3).forEach((building, i) => this.addFacade(building, i));
    this.mooredBoats=new MooredSailboats(this.root,world);
    if (options.headlands !== false) this.addHeadlands();
    for (const source of this.batches.values()) for(const details of staticDetailGroups(source.details,d=>d.matrix)) {
      const batch:Batch={material:source.material,details};
      if (!batch.details.length) continue;
      const mesh = new InstancedMesh(this.box, batch.material, batch.details.length);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate=false;
      batch.details.forEach((detail, index) => mesh.setMatrixAt(index, detail.matrix));
      batch.mesh = mesh;
      mesh.computeBoundingSphere();this.drawBatches.push(batch);
      this.root.add(mesh);
    }
    this.sync(world.chunks.keys());
  }

  update(dt: number, _focus?: Vector3,detailDistance=320): void {
    if(_focus)for(const b of this.drawBatches){const sphere=b.mesh?.boundingSphere;if(b.mesh&&sphere)b.mesh.visible=Math.hypot(sphere.center.x-_focus.x,sphere.center.z-_focus.z)<detailDistance+sphere.radius;}
    this.elapsed += dt;
    this.mooredBoats.update(dt);
  }

  sync(dirtyKeys: Iterable<string>): void {
    const dirty = new Set(dirtyKeys);
    const intersects = (chunks: Set<string>) => !this.initialized||[...chunks].some(key => dirty.has(key));
    const supported = (anchors: Cell[]) => anchors.every(p => this.world.getVoxel(p.x, p.y, p.z) !== 0);
    for (const batch of this.drawBatches) {
      let changed = false;
      batch.details.forEach((detail, index) => {
        if (!intersects(detail.chunks)) return;
        batch.mesh?.setMatrixAt(index, supported(detail.anchors) ? detail.matrix : this.zero);
        changed = true;
      });
      if (changed && batch.mesh) batch.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const entry of this.supported) if (intersects(entry.chunks)) entry.group.visible = supported(entry.anchors);
    this.obstacles.length = 0;
    this.mooredBoats.sync();
    this.obstacles.push(...this.obstacleDetails.filter(entry => supported(entry.anchors)).map(entry => entry.bounds),...this.mooredBoats.obstacles);
    this.initialized=true;
  }

  decorationParts():DecorationPart[]{return [...this.batches.values()].flatMap(b=>b.details.filter(d=>!d.surfaceOnly).map(d=>({geometry:this.box,material:b.material,matrix:d.matrix,anchors:d.anchors})));}
  get boatDiagnostics(){return this.mooredBoats.diagnostics;}
  dispose(): void {
    this.scene.remove(this.root);
    this.mooredBoats.dispose();
    for(const batch of this.drawBatches)batch.mesh?.dispose();
    this.box.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }

  private material(hex: string, roughness: number, metalness = 0): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color: hex, roughness, metalness });
    this.materials.add(material); return material;
  }

  private addBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: MeshStandardMaterial, anchors: Cell[], yaw = 0,surfaceOnly=false): void {
    let batch = this.batches.get(material);
    if (!batch) { batch = { material, details: [] }; this.batches.set(material, batch); }
    batch.details.push({
      matrix: new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(0, yaw, 0)), new Vector3(sx, sy, sz)),
      anchors, chunks: new Set(anchors.map(chunkFor)),surfaceOnly,
    });
  }

  private attach(group: Group, anchors: Cell[]): void {
    this.root.add(group);
    this.supported.push({ group, anchors, chunks: new Set(anchors.map(chunkFor)) });
  }

  private obstacle(x: number, y: number, z: number, sx: number, sy: number, sz: number, anchors: Cell[], yaw = 0,standable=true,vaultable=false): void {
    this.obstacleDetails.push({ bounds: {...orientedCollisionBounds({ x, y, z }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, { x: sx / 2, y: sy / 2, z: sz / 2 }),standable,vaultable}, anchors });
  }

  private addPromenade(): void {
    for (let x = 2; x < 253; x += 5) {
      const anchors = [{ x, y: 15, z: 173 }, { x: Math.min(255, x + 4), y: 15, z: 173 }];
      for(const p of surfacePatches(x+2.5,170.15,5,.2))this.addBox(p.x,16.035,p.z,p.width,.07,p.depth,this.cream,[{x:p.anchorX,y:15,z:p.anchorZ}],0,true);
      // Leave real gates aligned with the pier and lighthouse causeway.
      if ((x >= 102 && x < 112) || (x >= 212 && x < 222)) continue;
      this.addBox(x, 16.53, 173.8, .065, 1.06, .065, this.iron, anchors);
      this.addBox(x + 2.5, 17.04, 173.8, 5, .065, .065, this.iron, anchors);
      this.addBox(x + 2.5, 16.5, 173.8, 5, .045, .045, this.iron, anchors);
      this.obstacle(x + 2.5, 16.55, 173.8, 5.1, 1.1, .12, anchors,0,false,true);
    }
    for (const x of [21, 61, 93, 136, 183, 243]) {
      const footing=findFurnitureFooting(this.world,x,171.7,0,furnitureFootContacts([{x:-.7,z:0},{x:.7,z:0}],.04,.215),16);
      if(footing){
        const {y,anchors}=footing;this.benchFootings.push(footing);
        this.seats.push({id:`coast-bench-${x}`,position:{x,y:y+.53,z:171.82},floorY:y,yaw:Math.PI,available:()=>anchors.every(p=>this.world.getVoxel(p.x,p.y,p.z)!==0)&&this.obstacles.some(o=>o.minX<=x&&o.maxX>=x&&Math.abs(o.maxY-y-.53)<.01)});
        for(let slat=0;slat<4;slat++)this.addBox(x,y+.47,171.7+(slat-1.5)*.12,1.85,.12,.10,this.wood,anchors);
        for(let slat=0;slat<3;slat++)this.addBox(x,y+.65+slat*.17,171.47,1.85,.13,.08,this.wood,anchors);
        this.obstacle(x,y+.47,171.7,1.85,.12,.48,anchors);
        this.obstacle(x,y+.84,171.47,1.85,.55,.08,anchors,0,false);
        for(const side of [-.7,.7]){
          this.addBox(x+side,y+.22,171.7,.08,.44,.43,this.iron,anchors);
          this.obstacle(x+side,y+.22,171.7,.08,.44,.43,anchors,0,false);
        }
      }
      const planter=findFurnitureFooting(this.world,x+2.5,171.6,0,furnitureFootContacts([{x:0,z:0}],.36,.36),16);
      if(!planter)continue;
      const {y,anchors}=planter;
      this.addBox(x+2.5,y+.38,171.6,.72,.76,.72,this.cream,anchors);
      this.addBox(x+2.5,y+.9,171.6,.84,.38,.84,this.green,anchors);
      this.addBox(x+2.68,y+1.14,171.5,.45,.18,.45,this.green,anchors);
      this.obstacle(x+2.5,y+.62,171.6,1,1.24,1,anchors);
    }
  }

  private addFineLamps(lamps: CoastalLamp[]): void {
    const glow = this.material('#d8c8a3', .55);
    glow.emissive.set('#e3b66a'); glow.emissiveIntensity = .5;
    for (const { x, z, base } of lamps) {
      const anchors = [{ x, y: base - 1, z }];
      this.addBox(x + .5, base + .045, z + .5, .25, .09, .25, this.iron, anchors);
      this.addBox(x + .5, base + 1.7, z + .5, .095, 3.4, .095, this.iron, anchors);
      this.addBox(x + .5, base + 3.39, z + .67, .085, .085, .4, this.iron, anchors);
      this.addBox(x + .5, base + 3.39, z + .86, .46, .12, .3, this.iron, anchors);
      this.addBox(x + .5, base + 3.322, z + .86, .34, .022, .22, glow, anchors);
      this.obstacle(x + .5, base + 1.72, z + .5, .14, 3.44, .14, anchors);
      this.obstacle(x+.5,base+3.39,z+.67,.085,.085,.4,anchors,0,false);
      this.obstacle(x+.5,base+3.39,z+.86,.46,.12,.3,anchors,0,false);
    }
  }

  private addDock(): void {
    const anchor = [{ x: 108, y: 14, z: 209 }];
    const pad = new Group();
    pad.position.copy(HELIPAD.position);
    const discGeometry = new CylinderGeometry(HELIPAD.radius, HELIPAD.radius, .018, 64);
    this.geometries.add(discGeometry);
    pad.add(new Mesh(discGeometry, this.material('#46534e', .98)));
    const ringGeometry = new RingGeometry(4.42, 4.56, 64);
    this.geometries.add(ringGeometry);
    const ring = new Mesh(ringGeometry, this.white);
    ring.rotation.x = -Math.PI / 2; ring.position.y = .014; pad.add(ring);
    for (const offset of [-.85, .85]) {
      const bar = new Mesh(this.box, this.white); bar.scale.set(.32, .018, 2.65); bar.position.set(offset, .014, 0); pad.add(bar);
    }
    const cross = new Mesh(this.box, this.white); cross.scale.set(2.02, .018, .32); cross.position.y = .014; pad.add(cross);
    this.attach(pad, anchor);
    for (let z = 175; z < 204; z += .85) this.addBox(108, 15.013, z, 11.8, .015, .035, this.iron, [{ x: 108, y: 14, z: Math.floor(z) }]);
    for (const x of [102.18, 113.82]) for (let z = 176; z < 202; z += 4) {
      const anchors = [{ x: Math.floor(x), y: 14, z }];
      this.addBox(x, 15.52, z, .06, 1.04, .06, this.cream, anchors);
      this.addBox(x, 16.02, z + 1.9, .06, .06, 3.8, this.cream, anchors);
      this.obstacle(x, 15.54, z + 1.9, .12, 1.08, 3.95, anchors);
    }
    for (const x of [97, 120]) for (const z of [206, 213]) {
      const group = new Group();
      const geometry = new CylinderGeometry(.12, .15, .45, 8); this.geometries.add(geometry);
      const bollard = new Mesh(geometry, this.iron); bollard.position.set(x, 15.22, z); group.add(bollard);
      this.attach(group, [{ x, y: 14, z }]);
      this.obstacle(x, 15.225, z, .32, .45, .32, [{ x, y: 14, z }]);
    }
  }

  private addFacade(building: BuildingRecord, style: number): void {
    const bounds = building.bounds;
    const left = bounds.minX + 1, right = bounds.maxX - 1, front = bounds.maxZ - 1;
    const frame = style === 1 ? this.iron : this.cream;
    const doorway = Math.floor((left + right) / 2);
    for (let y = 17; y < bounds.maxY - 3; y += 4) for (let x = left + 1; x + 1 < right; x += 4) {
      if (y < 19 && Math.abs(x - doorway) < 2) continue;
      const material = this.world.getVoxel(x, y, front);
      if (material !== Material.Window && material !== Material.DarkWindow) continue;
      const anchors = [{ x, y, z: front }, { x: x + 1, y: y + 1, z: front }];
      for (const offset of [-1.03, 1.03]) this.addBox(x + 1 + offset, y + 1, front + 1.08, .085, 2.16, .15, frame, anchors);
      for (const offset of [-1.03, 1.03]) this.addBox(x + 1, y + 1 + offset, front + 1.08, 2.16, .085, .15, frame, anchors);
      this.addBox(x + 1, y + 1, front + 1.11, .055, 2.0, .16, frame, anchors);
      this.addBox(x + 1, y - .04, front + 1.18, 2.32, .14, .43, this.cream, anchors);
    }
    const anchors = [{ x: doorway, y: 17, z: front }, { x: doorway + 1, y: 17, z: front }];
    this.addBox(doorway + 1, 19.02, front + 1.12, 2.4, .16, .28, frame, anchors);
    for (const offset of [-1.12, 1.12]) this.addBox(doorway + 1 + offset, 17.5, front + 1.12, .16, 3.0, .28, frame, anchors);
    const canopy = style === 1 ? this.material('#a95f45', .9) : this.green;
    this.addBox(doorway + 1, 19.4, front + 1.75, 5.2, .18, 1.5, canopy, anchors);
    this.addBox(doorway + 1, 19.15, front + 2.42, 5.2, .5, .1, canopy, anchors);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = style === 1 ? '#713f32' : '#28483e'; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#ece1c6'; ctx.font = '600 42px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(['HARBOR HOUSE', 'COASTAL MARKET', 'PIER & CO.'][style], 256, 49);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; this.textures.add(texture);
    const material = new MeshStandardMaterial({ map: texture, roughness: .85 }); this.materials.add(material);
    const geometry = new PlaneGeometry(5.1, .96); this.geometries.add(geometry);
    const sign = new Mesh(geometry, material); sign.position.set(doorway + 1, 20.32, front + 1.035);
    const group = new Group(); group.add(sign); this.attach(group, anchors);
  }

  private addHeadlands(): void {
    for (const [z, amplitude, color] of [[-390, 95, '#617969'], [-690, 155, '#778b8e']] as const) {
      const positions: number[] = [];
      for (let segment = 0; segment < 48; segment++) {
        const x0 = -900 + segment * 45, x1 = x0 + 45;
        const height = (x: number) => 10 + amplitude * (.35 + .28 * Math.sin(x * .008) + .18 * Math.cos(x * .021));
        positions.push(x0, 8, z, x1, 8, z, x0, height(x0), z - 50, x1, 8, z, x1, height(x1), z - 50, x0, height(x0), z - 50);
      }
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); geometry.computeVertexNormals(); this.geometries.add(geometry);
      const material = this.material(color, 1); material.side = DoubleSide;
      this.root.add(new Mesh(geometry, material));
    }
  }
}
