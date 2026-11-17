import type {DecorationPart} from '../destruction/decorations';
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture,
  Color, CylinderGeometry, DodecahedronGeometry, DoubleSide, Euler, Group, InstancedMesh, LineBasicMaterial,
  LatheGeometry,LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  PlaneGeometry, PointLight, Quaternion, RingGeometry, Scene, Shape, ShapeGeometry,
  SphereGeometry,SRGBColorSpace, TorusGeometry, Vector2,Vector3, type Material as ThreeMaterial,
} from 'three';
import type { BuildingRecord, BuildingRegistry } from '../destruction/buildings';
import { Material } from '../world/palette';
import type { VoxelWorld, Vector3Like } from '../world/voxel';
import { orientedBoxBounds,orientedCollisionBounds,partCollisionBounds,type SceneObstacle } from '../input/scene-collisions';
import {findFurnitureFooting,furnitureFootContacts} from '../world/furniture-footing';
import {surfaceFinish} from './surface-finish';
import {carTyreGeometry,carCabinGeometry,carWindscreenGeometry} from '../vehicles/urban-car-geometry';
import {contactShadowMaterial} from '../vehicles/contact-shadow';
import {windowGlaze} from './window-glaze';
import type {TrafficBodyState} from '../destruction/physics';
import type {SeatTarget} from '../input/ground-actions';
import {surfacePatches} from './surface-patches';
import {createTrafficBody,createTrafficInterior,createTrafficSteeringWheel,TRAFFIC_CABIN_RIG} from '../vehicles/traffic-interior';
import {ChunkDependents} from '../world/chunk-dependents';

type Cell = { x: number; y: number; z: number };
type Supported = { anchors: Cell[] };
type Detail = Supported & { transform: Matrix4;physical?:boolean;surfaceOnly?:boolean };
type Batch = { material: MeshStandardMaterial; details: Detail[]; mesh?: InstancedMesh;geometry?:BufferGeometry };
type Attached = Supported & { group: Group };
type AnchoredObstacle={bounds:StreetObstacleBounds;anchors:Cell[]};
type Face = { origin: Vector3; yaw: number; width: number; cell: (u: number, y: number) => Cell };
type Pedestrian = { a: Vector3; b: Vector3; progress: number; direction: number; speed: number; phase: number; color: string; skin: string };
export type StreetLightSource = { position: Vector3; color: Color; anchors: Cell[] };
export type StreetObstacleBounds = SceneObstacle;
const glassVoxel = (m: number) => m === Material.Window || m === Material.DarkWindow;

/** Regenerated architectural dressings. Voxels remain the editable source of truth. */
export class StreetArt {
  readonly lightSources: StreetLightSource[] = [];
  readonly seats:SeatTarget[]=[];
  readonly furnitureFootings:Array<{kind:'bench'|'table'|'chair';x:number;y:number;z:number;anchors:Cell[]}>=[];
  readonly obstacles: StreetObstacleBounds[] = [];
  readonly propFootings:Array<{kind:'car'|'bicycle'|'bin';x:number;y:number;z:number;anchors:Cell[]}>=[];
  private initialized=false;
  private readonly detailUpdates=new ChunkDependents<{batch:Batch;detail:Detail;index:number}>();
  private readonly attachedUpdates=new ChunkDependents<Attached>();
  private readonly obstacleUpdates=new ChunkDependents<AnchoredObstacle>();
  private readonly obstaclePresence=new WeakMap<AnchoredObstacle,boolean>();
  private readonly obstacleEntries=new WeakMap<StreetObstacleBounds,AnchoredObstacle>();
  readonly pedestrianObstacles: StreetObstacleBounds[] = [];
  private playerPosition: Vector3 | null = null;
  private playerAvoidanceRadius = .84;
  private readonly root = new Group();
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private readonly batches = new Map<MeshStandardMaterial, Batch>();
  private readonly shapedBatches:Batch[]=[];
  private readonly drawBatches:Batch[]=[];
  private readonly tyreGeometry=carTyreGeometry();
  private readonly hubGeometry=carTyreGeometry(.17,.235);
  private readonly cabinGeometry=carCabinGeometry(true);
  private readonly windscreenGeometry=carWindscreenGeometry();
  private readonly vehiclePane=new PlaneGeometry(1,1);
  private readonly vehicleSidePane=new PlaneGeometry(1,1).rotateY(Math.PI/2);
  private readonly parkedBody=createTrafficBody('sedan');
  private readonly parkedInterior=createTrafficInterior('sedan');
  private readonly parkedWheel=createTrafficSteeringWheel();
  private readonly binGeometry=new CylinderGeometry(.31,.28,.76,12);
  private readonly binLidGeometry=new CylinderGeometry(.35,.35,.10,12);
  private readonly bagGeometry=new DodecahedronGeometry(.5,0);
  private readonly tankHoop=new TorusGeometry(1.16,.027,6,24).rotateX(Math.PI/2);
  private readonly legCylinder=new CylinderGeometry(.5,.5,1,8);
  private readonly cupGeometry=new LatheGeometry([[0,0],[.039,0],[.054,.025],[.058,.13],[.049,.13],[.044,.025],[0,.025]].map(([x,y])=>new Vector2(x,y)),14);
  private readonly cupHandle=new TorusGeometry(.035,.010,6,12);
  private readonly saucerGeometry=new CylinderGeometry(.095,.095,.012,16);
  private readonly coffeeGeometry=new CylinderGeometry(.043,.043,.004,12);
  private readonly displayCylinder=new CylinderGeometry(.5,.5,1,12);
  private readonly displayPot=new CylinderGeometry(.075,.052,.16,10);
  private readonly displayLeaf=new DodecahedronGeometry(.5,0);
  private readonly displayLoaf=new SphereGeometry(.5,12,7);
  private readonly displayBowl=new LatheGeometry([[0,0],[.06,0],[.1,.12],[.085,.125],[.05,.02],[0,.02]].map(([x,y])=>new Vector2(x,y)),12);
  private readonly contactPlane=new PlaneGeometry(1,1).rotateX(-Math.PI/2);
  private readonly contactMaterial=contactShadowMaterial();
  private readonly attached: Attached[] = [];
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<ThreeMaterial>();
  private readonly textures = new Set<CanvasTexture>();
  private readonly glowMaterials: Array<{ material: MeshStandardMaterial; intensity: number }> = [];
  private readonly pools: Array<{ mesh: Mesh; material: MeshBasicMaterial; strength: number }> = [];
  private readonly puddles: Mesh[] = [];
  private readonly lightSlots: PointLight[] = [];
  private readonly parkedCars: AnchoredObstacle[] = [];
  private parkingSequence=18;
  private clearedTraffic=new Set<number>();
  private physicalParked:Array<{id:number;origin:Vector3;half:Vector3;bounds:StreetObstacleBounds;parts:Array<{batch:Batch;detail:Detail;index:number}>;active:boolean}>=[];
  get vehicleObstacles(){return this.physicalParked.map(p=>p.bounds);}
  syncTraffic(states:readonly TrafficBodyState[]):void{
    for(const car of this.physicalParked){if(this.clearedTraffic.has(car.id))continue;const state=states.find(s=>s.id===car.id);if(!state)continue;car.active=true;
      const transform=new Matrix4().compose(new Vector3().copy(state.position),new Quaternion().copy(state.rotation),new Vector3(1,1,1)).multiply(new Matrix4().makeTranslation(-car.origin.x,-car.origin.y,-car.origin.z));
      for(const p of car.parts){p.detail.physical=true;if(p.batch.mesh){p.batch.mesh.setMatrixAt(p.index,p.batch.material===this.contactMaterial?this.zero:new Matrix4().multiplyMatrices(transform,p.detail.transform));p.batch.mesh.instanceMatrix.needsUpdate=true;}}
      orientedCollisionBounds(state.position,state.rotation,car.half,car.bounds);
    }
  }
  clearTraffic(ids:ReadonlySet<number>):number[]{
    const removed:number[]=[];
    for(const car of this.physicalParked){
      if(!ids.has(car.id)||this.clearedTraffic.has(car.id))continue;
      this.clearedTraffic.add(car.id);removed.push(car.id);car.active=false;
      for(const p of car.parts){p.detail.physical=true;p.batch.mesh?.setMatrixAt(p.index,this.zero);if(p.batch.mesh)p.batch.mesh.instanceMatrix.needsUpdate=true;}
      car.bounds.minY=0;car.bounds.maxY=-1;
    }
    return removed;
  }
  private readonly people: Pedestrian[] = [];
  private pedMeshes: Record<string, InstancedMesh> = {};
  private elapsed = 0;
  private readonly dummyMatrix = new Matrix4();
  private readonly dummyQuaternion = new Quaternion();
  private readonly dummyEuler = new Euler();
  private readonly dummyPosition = new Vector3();
  private readonly dummyScale = new Vector3();
  private readonly iron = this.material('#283c42', .65, .22);
  private readonly cream = this.material('#bcb8a6', .82);
  private readonly timber = surfaceFinish(this.material('#6b4732', .89),'wood');
  private readonly brass = this.material('#9d8251', .55, .45);
  private readonly terracotta = this.material('#9c5842', .87);
  private readonly slate = this.material('#4d645f', .83);
  private readonly rubber = this.material('#202829', .93);
  private readonly coffee=this.material('#49372a',.35);
  private readonly petals=['#c4bca5','#b68d8b','#be9a5f'].map(c=>this.material(c,.96));
  private readonly displayGreen=this.material('#63846b',.95);
  private readonly paneNight={value:0};
  private readonly awningColours=['#a96c53','#526d69','#b4a687'].map(c=>surfaceFinish(this.material(c,.92),'fabric'));
  private readonly warmGlass = this.glowing('#b9a079', '#ffc183', 1.25, .25);
  private readonly dimGlass = this.glowing('#55737a', '#82b3b4', .36, .22);
  private readonly litTrim = this.glowing('#dfd5b4', '#ffd5a0', 1.8, .65);
  private readonly redLamp = this.glowing('#8f2e28', '#ff523d', 1.6, .25);
  private readonly ivoryLamp = this.glowing('#c9bca2', '#ffe8b1', 1.8, .25);
  private readonly vehicleGlass=this.material('#9cb8bb',.17,.02);
  private readonly vehicleControls=this.material('#293c40',.8);
  private readonly vehicleInteriorMaterials:MeshStandardMaterial[]=[];

  constructor(scene: Scene, private world: VoxelWorld, buildings: BuildingRegistry,private options:{people?:boolean;parkedStates?:readonly TrafficBodyState[]}={}) {
    this.root.name = 'street-life-and-architectural-character';
    [this.tyreGeometry,this.hubGeometry,this.cabinGeometry,this.windscreenGeometry,this.binGeometry,this.binLidGeometry,this.bagGeometry].forEach(g=>this.geometries.add(g));
    [this.vehiclePane,this.vehicleSidePane,this.parkedBody,this.parkedWheel,...this.parkedInterior.map(p=>p.geometry)].forEach(g=>this.geometries.add(g));
    this.vehicleGlass.transparent=true;this.vehicleGlass.opacity=.20;this.vehicleGlass.depthWrite=false;this.vehicleGlass.side=DoubleSide;this.vehicleGlass.forceSinglePass=true;
    this.vehicleInteriorMaterials=this.parkedInterior.map(p=>{const m=this.material('#ffffff',p.roughness);m.vertexColors=true;m.name=p.name;if(p.name.endsWith('seats'))surfaceFinish(m,'fabric');return m;});
    this.geometries.add(this.contactPlane);this.geometries.add(this.tankHoop);this.materials.add(this.contactMaterial);
    [this.legCylinder,this.cupGeometry,this.cupHandle,this.saucerGeometry,this.coffeeGeometry,this.displayCylinder,this.displayPot,this.displayLeaf,this.displayLoaf,this.displayBowl].forEach(g=>this.geometries.add(g));
    const loaf=this.displayLoaf.getAttribute('position');for(let i=0;i<loaf.count;i++)loaf.setY(i,(Math.max(-.32,loaf.getY(i))+.32)/.82-.5);this.displayLoaf.computeVertexNormals();
    windowGlaze(this.warmGlass,this.paneNight);windowGlaze(this.dimGlass,this.paneNight);
    this.bagGeometry.computeBoundingBox();const bagSize=this.bagGeometry.boundingBox!.getSize(new Vector3());this.bagGeometry.scale(1/bagSize.x,1/bagSize.y,1/bagSize.z);
    surfaceFinish(this.cream,'stone');surfaceFinish(this.iron,'paint');surfaceFinish(this.rubber,'rubber');
    scene.add(this.root);
    buildings.all.filter(b => !b.id.startsWith('tree-') && !b.id.startsWith('explore-') && b.id !== 'city-lighthouse' && !b.id.startsWith('harbor-') && !b.id.startsWith('region-')).forEach((b, i) => this.building(b, i));
    this.streetFurniture();
    this.parkDetails();
    this.harborDetails();
    this.harborInteriors();
    if(options.people!==false)this.buildPeople();
    this.finishBatches();
    for(const batch of this.drawBatches)batch.details.forEach((detail,index)=>this.detailUpdates.add({batch,detail,index},detail.anchors));
    for(const detail of this.attached)this.attachedUpdates.add(detail,detail.anchors);
    for(const obstacle of this.parkedCars){this.obstacleUpdates.add(obstacle,obstacle.anchors);this.obstacleEntries.set(obstacle.bounds,obstacle);}
    for (let i = 0; i < 4; i++) {
      const light = new PointLight('#ffd3a0', 0, 13, 2);
      light.castShadow = false;
      this.root.add(light); this.lightSlots.push(light);
    }
    this.sync(world.chunks.keys());
    this.update(0, new Vector3(108, 18, 169), 0, 0);
  }

  update(dt: number, focus: Vector3, night: number, wetness: number,detailDistance=320): void {
    for(const b of this.drawBatches){const sphere=b.mesh?.boundingSphere;if(b.mesh?.frustumCulled&&sphere)b.mesh.visible=Math.hypot(sphere.center.x-focus.x,sphere.center.z-focus.z)<detailDistance+sphere.radius;}
    this.elapsed += Math.min(dt, .1);
    this.paneNight.value=night;
    for (const { material, intensity } of this.glowMaterials) material.emissiveIntensity = .025 + night * intensity;
    for (const pool of this.pools) pool.material.opacity = night * pool.strength * (.65 + wetness * .35);
    for (const puddle of this.puddles) puddle.visible = wetness > .1;
    const nearest = this.lightSources.filter(light => this.supported(light.anchors))
      .sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus)).slice(0, this.lightSlots.length);
    this.lightSlots.forEach((slot, index) => {
      const light = nearest[index];
      slot.intensity = light && light.position.distanceToSquared(focus) < 1600 ? night * 34 : 0;
      if (light) { slot.position.copy(light.position); slot.color.copy(light.color); }
    });
    if(this.options.people!==false)this.updatePeople(Math.min(dt, .05), wetness);
  }

  setPlayerPosition(position: Vector3Like | null, radius = .84): void {
    if (!position) { this.playerPosition = null; return; }
    this.playerPosition ??= new Vector3(); this.playerPosition.copy(position);
    this.playerAvoidanceRadius = radius;
  }

  sync(dirtyKeys: Iterable<string>): void {
    const dirty = new Set(dirtyKeys);
    const updates=this.initialized?this.detailUpdates.affected(dirty):this.drawBatches.flatMap(batch=>batch.details.map((detail,index)=>({batch,detail,index}))),changed=new Set<Batch>();
    const support=new Map<Cell[],boolean>();
    for(const {batch,detail,index}of updates){
      if(detail.physical)continue;
      if(!support.has(detail.anchors))support.set(detail.anchors,this.supported(detail.anchors));
      batch.mesh?.setMatrixAt(index,support.get(detail.anchors)?detail.transform:this.zero);changed.add(batch);
    }
    for(const batch of changed)if(batch.mesh)batch.mesh.instanceMatrix.needsUpdate=true;
    for (const detail of this.initialized?this.attachedUpdates.affected(dirty):this.attached) detail.group.visible = this.supported(detail.anchors);
    let obstaclesChanged=!this.initialized;
    // Physical cars can become active after their original ground is removed.
    const obstaclesToCheck=this.initialized?this.obstacleUpdates.affected(dirty):this.parkedCars;
    for(const car of obstaclesToCheck){const present=car.bounds.trafficId!==undefined&&this.clearedTraffic.has(car.bounds.trafficId)?false:this.supported(car.anchors)||this.physicalParked.some(p=>p.bounds===car.bounds&&p.active);if(this.obstaclePresence.get(car)!==present){obstaclesChanged=true;this.obstaclePresence.set(car,present);}}
    for(const car of this.physicalParked)if(car.active){const entry=this.obstacleEntries.get(car.bounds);if(entry&&!this.obstaclePresence.get(entry)){this.obstaclePresence.set(entry,true);obstaclesChanged=true;}}
    if(obstaclesChanged){this.obstacles.length=0;this.obstacles.push(...this.parkedCars.filter(car=>this.obstaclePresence.get(car)).map(car=>car.bounds));}
    this.initialized=true;
  }

  decorationParts():DecorationPart[]{
    const cars=new Set(this.physicalParked.flatMap(c=>c.parts.map(p=>p.detail)));
    const parts:DecorationPart[]=[...this.batches.values(),...this.shapedBatches].flatMap(b=>b.material===this.contactMaterial?[]:b.details.filter(d=>!cars.has(d)&&!d.surfaceOnly).map(d=>({geometry:b.geometry??this.unitBox,material:b.material,matrix:d.transform,anchors:d.anchors})));
    this.root.updateMatrixWorld(true);
    for(const item of this.attached)item.group.traverse(object=>{if(!(object instanceof Mesh))return;const materials=Array.isArray(object.material)?object.material:[object.material];if(materials.some(m=>m.transparent&&!m.depthWrite))return;parts.push({geometry:object.geometry,material:object.material,matrix:object.matrixWorld.clone(),anchors:item.anchors,binding:'attached'});});
    return parts;
  }

  dispose(): void {
    this.root.removeFromParent(); this.unitBox.dispose();
    for(const batch of this.drawBatches)batch.mesh?.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const slot of this.lightSlots) slot.dispose();
  }

  private supported(anchors: Cell[]): boolean { return anchors.every(p => this.world.getVoxel(p.x, p.y, p.z) !== 0); }

  private material(color: string, roughness = .8, metalness = 0): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness, metalness });
    this.materials.add(material); return material;
  }

  private glowing(color: string, emission: string, intensity: number, roughness: number): MeshStandardMaterial {
    const material = this.material(color, roughness, .08);
    material.emissive.set(emission);
    this.glowMaterials.push({ material, intensity }); return material;
  }

  private box(position: Vector3, size: Vector3, material: MeshStandardMaterial, anchors: Cell[], yaw = 0,geometry=this.unitBox as BufferGeometry,pitch=0,surfaceOnly=false): void {
    let batch = geometry===this.unitBox?this.batches.get(material):this.shapedBatches.find(b=>b.material===material&&b.geometry===geometry);
    if (!batch) { batch = { material, details: [],geometry }; if(geometry===this.unitBox)this.batches.set(material,batch);else this.shapedBatches.push(batch); }
    const transform = new Matrix4().compose(position, new Quaternion().setFromEuler(new Euler(pitch,yaw,0,'YXZ')), size);
    batch.details.push({ transform, anchors,surfaceOnly });
  }

  private groundMark(x:number,z:number,sx:number,sz:number):void{
    for(const p of surfacePatches(x,z,sx,sz))this.box(new Vector3(p.x,16.02,p.z),new Vector3(p.width,.035,p.depth),this.cream,[{x:p.anchorX,y:15,z:p.anchorZ}],0,this.unitBox,0,true);
  }

  private cube(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: MeshStandardMaterial, anchors: Cell[], yaw = 0): void {
    this.box(new Vector3(x, y, z), new Vector3(sx, sy, sz), material, anchors, yaw);
  }

  private obstacle(x: number, y: number, z: number, sx: number, sy: number, sz: number, anchors: Cell[], yaw = 0): void {
    this.parkedCars.push({ anchors, bounds: orientedCollisionBounds({ x, y, z }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, { x: sx / 2, y: sy / 2, z: sz / 2 }) });
  }

  private attach(group: Group, anchors: Cell[]): void {
    this.root.add(group); this.attached.push({ group, anchors });
  }

  private finishBatches(): void {
    const moving=new Map(this.physicalParked.flatMap(car=>car.parts.map(part=>[part.detail,part] as const)));
    const draw=(source:Batch,details:Detail[],stationary:boolean)=>{
      const batch:Batch={material:source.material,geometry:source.geometry,details};
      const mesh = new InstancedMesh(batch.geometry??this.unitBox, batch.material, batch.details.length);
      mesh.matrixAutoUpdate=false;
      // Thin emissive glazing should not self-shadow against its backing voxel.
      mesh.castShadow = mesh.receiveShadow = batch.material !== this.warmGlass && batch.material !== this.dimGlass;
      if(batch.material===this.vehicleGlass){mesh.castShadow=false;mesh.renderOrder=2;}
      if(batch.geometry?.name.startsWith('traffic-')){mesh.name=`parked-${batch.geometry.name}`;if(batch.geometry.name.endsWith('seats')||batch.geometry.name.endsWith('trim'))mesh.castShadow=false;}
      if(batch.material.userData.contactShadow){mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=1;}
      mesh.frustumCulled = stationary;
      batch.details.forEach((detail, index) => {
        mesh.setMatrixAt(index, detail.transform);
        const part=moving.get(detail);if(part){part.batch=batch;part.index=index;}
      });
      if(stationary)mesh.computeBoundingSphere();
      batch.mesh = mesh; this.root.add(mesh);this.drawBatches.push(batch);
    };
    for (const source of [...this.batches.values(),...this.shapedBatches]) {
      const fixed=source.details.filter(detail=>!moving.has(detail)),cars=source.details.filter(detail=>moving.has(detail));
      // Cars retain their own stable instance slots: a crashed parked car may
      // travel beyond its initial sector and must never vanish with that sector.
      if(cars.length)draw(source,cars,false);
      if(!fixed.length)continue;
      if(fixed.length<128){draw(source,fixed,true);continue;}
      // Preserve the same geometry and materials. Only visibility submission
      // changes; colliders, support anchors and destruction keep original data.
      const sectors=new Map<string,Detail[]>();
      for(const detail of fixed){const e=detail.transform.elements,key=`${Math.floor(e[12]/64)},${Math.floor(e[14]/64)}`,bucket=sectors.get(key);if(bucket)bucket.push(detail);else sectors.set(key,[detail]);}
      for(const details of sectors.values())draw(source,details,true);
    }
  }

  private faces(building: BuildingRecord): Face[] {
    const b = building.bounds;
    const x0 = b.minX + 1, x1 = b.maxX - 1, z0 = b.minZ + 1, z1 = b.maxZ - 1;
    return [
      { origin: new Vector3(x0, 0, z1 + 1.035), yaw: 0, width: x1 - x0 + 1, cell: (u, y) => ({ x: x0 + u, y, z: z1 }) },
      { origin: new Vector3(x1 + 1, 0, z0 - .035), yaw: Math.PI, width: x1 - x0 + 1, cell: (u, y) => ({ x: x1 - u, y, z: z0 }) },
      { origin: new Vector3(x1 + 1.035, 0, z1 + 1), yaw: Math.PI / 2, width: z1 - z0 + 1, cell: (u, y) => ({ x: x1, y, z: z1 - u }) },
      { origin: new Vector3(x0 - .035, 0, z0), yaw: -Math.PI / 2, width: z1 - z0 + 1, cell: (u, y) => ({ x: x0, y, z: z0 + u }) },
    ];
  }

  private facePoint(face: Face, u: number, y: number, depth: number): Vector3 {
    return new Vector3(u, y, depth).applyAxisAngle(new Vector3(0, 1, 0), face.yaw).add(face.origin);
  }

  private solidPart(position:Vector3,size:Vector3,material:MeshStandardMaterial,anchors:Cell[],yaw=0,geometry:BufferGeometry=this.unitBox,pitch=0,standable=false):void{
    this.box(position,size,material,anchors,yaw,geometry,pitch);
    const matrix=new Matrix4().compose(position,new Quaternion().setFromEuler(new Euler(pitch,yaw,0,'YXZ')),size);
    this.parkedCars.push({anchors,bounds:partCollisionBounds(geometry,matrix,standable)});
  }
  private solidCube(x:number,y:number,z:number,sx:number,sy:number,sz:number,material:MeshStandardMaterial,anchors:Cell[],standable=false):void{this.solidPart(new Vector3(x,y,z),new Vector3(sx,sy,sz),material,anchors,0,this.unitBox,0,standable);}
  private faceBox(face: Face, u: number, y: number, depth: number, sx: number, sy: number, sz: number, material: MeshStandardMaterial, anchors: Cell[],pitch=0): void {
    this.solidPart(this.facePoint(face, u, y, depth), new Vector3(sx, sy, sz), material, anchors, face.yaw,this.unitBox,pitch);
  }

  private building(building: BuildingRecord, index: number): void {
    const base = building.foundationY;
    const style = index % 5;
    const frames = style === 0 || style === 3 ? this.iron : style === 1 ? this.timber : this.cream;
    const faces = this.faces(building);
    for (let side = 0; side < faces.length; side++) {
      const face = faces[side];
      for (let y = base + 1; y <= building.bounds.maxY - 2; y += 4) {
        for (let u = 0; u + 1 < face.width; u++) {
          const a = face.cell(u, y), b = face.cell(u + 1, y + 1);
          if (!glassVoxel(this.world.getVoxel(a.x, a.y, a.z)) || !glassVoxel(this.world.getVoxel(b.x, b.y, b.z))) continue;
          const anchors = [a, b], center = u + 1;
          if(side===0&&y===base+1&&Math.abs(center-face.width/2)<2.1){u++;continue;}
          for (const offset of [-1.02, 1.02]) {
            this.faceBox(face, center + offset, y + 1, .075, .065, 2.13, .13, frames, anchors);
            this.faceBox(face, center, y + 1 + offset, .075, 2.13, .065, .13, frames, anchors);
          }
          this.faceBox(face, center, y + 1, .075, .05, 2, .14, frames, anchors);
          if (style !== 2) this.faceBox(face, center, y + 1, .083, 1.86, .045, .14, frames, anchors);
          const lit = ((Math.floor(u / 4) + Math.floor(y / 4) * 3 + index) % 5) < 3;
          if (lit) this.faceBox(face, center, y + 1, .08, 1.89, 1.88, .025, style === 3 ? this.dimGlass : this.warmGlass, anchors);
          this.faceBox(face, center, y - .07, .18, 2.3, .13, .45, frames, anchors);
          if (style === 1 || style === 4) {
            for (const direction of [-1, 1]) {
              this.faceBox(face, center + direction * 1.37, y + 1, .12, .48, 2.04, .1, style === 1 ? this.slate : this.terracotta, anchors);
              for (let stripe = 0; stripe < 6; stripe++) this.faceBox(face, center + direction * 1.37, y + .24 + stripe * .3, .19, .44, .035, .08, frames, anchors);
            }
          }
          if (side === (index % 3) && style === 2 && y > base + 1 && (Math.floor(y / 4) + u) % 3 === 0) this.balcony(face, center, y, anchors);
          if (side === 0 && y === base + 1 && face.width > 12&&Math.abs(center-face.width/2)>2.1) this.windowDisplay(face, center, y, index, anchors);
          u += 1;
        }
      }
    }
    if (building.bounds.minZ > 170) this.warehouse(building, faces[1]);
    else this.shop(building, faces[0], index);
    // The central north/south street has active shop fronts on both sides.
    if (building.bounds.minZ > 40 && building.bounds.minZ < 120) {
      if (building.bounds.maxX >= 119 && building.bounds.maxX <= 122) this.shop(building, faces[2], index + 3);
      if (building.bounds.minX >= 139 && building.bounds.minX <= 142) this.shop(building, faces[3], index + 5);
    }
    if (index % 3 === 0) this.fireEscape(building, faces[3]);
    this.rooftop(building, index);
  }

  private balcony(face: Face, u: number, y: number, anchors: Cell[]): void {
    this.faceBox(face, u, y - .12, .48, 2.5, .14, .95, this.cream, anchors);
    this.faceBox(face, u, y + .83, .96, 2.5, .045, .045, this.iron, anchors);
    for (let post = -1.2; post <= 1.21; post += .4) this.faceBox(face, u + post, y + .35, .96, .035, .98, .035, this.iron, anchors);
    for (const side of [-1.2, 1.2]) this.faceBox(face, u + side, y + .83, .5, .045, .045, .95, this.iron, anchors);
    this.faceBox(face, u + .77, y + .08, .65, .42, .23, .32, this.terracotta, anchors);
    this.faceBox(face, u + .77, y + .28, .65, .48, .25, .36, this.slate, anchors);
  }

  private windowDisplay(face: Face, u: number, y: number, index: number, anchors: Cell[]): void {
    this.faceBox(face, u, y + .22, .15, 1.9, .09, .25, this.timber, anchors);
    this.faceBox(face, u, y + .93, .15, 1.9, .075, .25, this.timber, anchors);
    const shape=(x:number,h:number,depth:number,sx:number,sy:number,sz:number,m:MeshStandardMaterial,g:BufferGeometry,pitch=0)=>this.solidPart(this.facePoint(face,u+x,y+h,depth),new Vector3(sx,sy,sz),m,anchors,face.yaw,g,pitch);
    const baySeed=Math.abs(Math.round(u*13+face.origin.x*7+face.origin.z*11)),displayCount=index%8===4?2+baySeed%2:3;
    for(let item=0;item<displayCount;item++){
      const x=(item-(displayCount-1)/2)*(displayCount===2?.88:.59),type=index%8;
      if(type===4){
        shape(x,.35,.2,1,1,1,item%2?this.slate:this.terracotta,this.displayPot);
        if((item+baySeed)%3===0){
          for(let leaf=0;leaf<4;leaf++)shape(x+(leaf%2?-.06:.05),.49+leaf*.04,.2,.19,.17,.14,this.displayGreen,this.displayLeaf);
          continue;
        }
        for(let stem=0;stem<3;stem++){
          const dx=(stem-1)*.045,height=.27+((item+stem+baySeed)%4)*.045;
          shape(x+dx,.40+height/2,.2,.012,height,.012,this.displayGreen,this.displayCylinder);
          shape(x+dx,.40+height,.2,.14,.10,.14,this.petals[(item+stem)%3],this.displayLeaf);
          shape(x+dx-.035,.52,.21,.10,.07,.05,this.displayGreen,this.displayLeaf);
        }
      }else if(type===0){
        shape(x,.27,.2,1.4,1.4,1.4,this.cream,this.cupGeometry);
        shape(x+.098,.37,.2,1.4,1.4,1.4,this.cream,this.cupHandle);
        shape(x-.19,.43,.16,.12,.32,.12,this.slate,this.displayCylinder);
        this.faceBox(face,u+x-.19,y+.43,.228,.075,.11,.008,this.cream,anchors);
      }else if(type===2){
        shape(x,.43,.2,.16,.32,.16,item%2?this.slate:this.terracotta,this.displayCylinder);
        shape(x,.60,.2,.17,.035,.17,this.brass,this.displayCylinder);
        this.faceBox(face,u+x,y+.43,.285,.10,.13,.012,this.cream,anchors);
      }else if(type===3){
        shape(x,.27,.2,1.25,1.25,1.25,this.cream,this.displayBowl);
        shape(x,.43,.2,1.25,1.25,1.25,this.cream,this.displayBowl);
      }else if(type===5){
        this.faceBox(face,u+x,y+.405,.2,.38,.27,.17,this.timber,anchors);
        this.faceBox(face,u+x-.035,y+.41,.293,.23,.17,.012,this.rubber,anchors);
        for(let grille=0;grille<5;grille++)this.faceBox(face,u+x-.12+grille*.04,y+.41,.303,.012,.15,.012,this.iron,anchors);
        shape(x+.135,.40,.303,.045,.015,.045,this.brass,this.displayCylinder,Math.PI/2);
      }else if(type===6){
        shape(x,.375,.2,.39,.21,.25,this.terracotta,this.displayLoaf);
        this.faceBox(face,u+x,y+.48,.2,.17,.004,.014,this.cream,anchors);
      }else{
        for(let book=0;book<3;book++){
          const height=.25+((book+item+baySeed)%3)*.07;
          this.faceBox(face,u+x+(book-1)*.12,y+.27+height/2,.2,.10,height,.15,[this.cream,this.slate,this.terracotta][(book+item)%3],anchors);
          this.faceBox(face,u+x+(book-1)*.12,y+.30,.282,.064,.012,.009,this.brass,anchors);
        }
      }
    }
  }

  private shop(building: BuildingRecord, face: Face, index: number): void {
    const base = building.foundationY;
    const u = Math.floor(face.width / 2) + .5;
    const anchors = [face.cell(Math.floor(u - 1), base + 1), face.cell(Math.min(face.width - 1, Math.floor(u + 1)), base + 2)];
    const width = Math.min(7.4, face.width - 1.3);
    const canopy = this.awningColours[index%3];
    // Separate shop bays and retractable rain covers give the same voxel masses different identities.
    this.faceBox(face,u,base+3.35,.8,width,.055,1.55,canopy,anchors,.20);
    this.faceBox(face,u,base+3.03,1.53,width,.28,.055,canopy,anchors);
    for(const side of [-1,1])this.faceBox(face,u+side*width*.43,base+3.05,.72,.04,.045,1.40,this.iron,anchors,-.25);
    if(index%2===0)for(let stripe=-width/2+.25;stripe<width/2;stripe+=.7){
      this.faceBox(face,u+stripe,base+3.383,.8,.24,.012,1.55,this.cream,anchors,.20);
      this.faceBox(face,u+stripe,base+3.03,1.562,.24,.28,.012,this.cream,anchors);
    }
    for (const side of [-1.15, 1.15]) this.faceBox(face, u + side, base + 1.46, .1, .1, 2.9, .19, this.iron, anchors);
    this.faceBox(face, u, base + 2.94, .1, 2.4, .1, .2, this.iron, anchors);
    this.faceBox(face, u + .64, base + 1.32, .18, .04, .45, .075, this.brass, anchors);
    const brands = [
      ['NAMI COFFEE', '海岸咖啡  /  OPEN LATE'], ['SALT & PAPER', '灯塔书店  /  BOOKS & PRINT'],
      ['BAY PROVISIONS', '海湾杂货  /  EST. 1984'], ['夜 航 食 堂', 'NIGHT FERRY  /  KITCHEN'],
      ['SEASIDE FLORIST', '花与海  /  FRESH DAILY'], ['RADIO REPAIR', '海港电器  /  REPAIR WORKS'],
      ['THE CORNER BAKERY', '街角烘焙  /  BREAD & BUTTER'], ['BLUE HOUR HOTEL', '蓝调旅馆  /  ROOMS UPSTAIRS'],
    ];
    const brand = brands[index % brands.length];
    this.sign(face, u, base + 4.23, .13, width, .96, brand[0], brand[1], index % 3, anchors);
    if (index % 4 === 0) {
      this.faceBox(face,u-width/2-.45,base+5.10,.47,.065,.065,.95,this.iron,anchors);
      this.faceBox(face,u-width/2-.45,base+5.02,.85,.045,.24,.045,this.brass,anchors);
      this.faceBox(face, u - width / 2 - .45, base + 3.9, .85, .7, 2.2, .12, this.iron, anchors);
      const signFace = { ...face, origin: this.facePoint(face, u - width / 2 - .45, 0, .93), yaw: face.yaw, width: 1 };
      this.sign(signFace, 0, base + 3.9, .01, .62, 1.96, '夜', 'OPEN', 1, anchors);
    }
    const lampPoint = this.facePoint(face, u + width / 2 - .3, base + 2.9, .95);
    this.solidPart(lampPoint, new Vector3(.32, .14, .28), this.ivoryLamp, anchors, face.yaw);
    const source = this.facePoint(face, u, base + 2.5, 1.9);
    this.lightSources.push({ position: source, color: new Color(index % 3 === 1 ? '#b9e5de' : '#ffd1a0'), anchors });
    const ground = this.facePoint(face, u, base + .026, 2.65);
    const floorCell = { x: Math.floor(ground.x), y: base - 1, z: Math.floor(ground.z) };
    this.lightPool(ground, 3.2, 3.7, index % 3 === 1 ? '#84b9ba' : '#e2a65f', .30, [floorCell]);
  }

  private sign(face: Face, u: number, y: number, depth: number, width: number, height: number, label: string, secondary: string, style: number, anchors: Cell[]): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 160;
    const context = canvas.getContext('2d'); if (!context) return;
    context.fillStyle = ['#31483f', '#4a302a', '#173c4d'][style]; context.fillRect(0, 0, 768, 160);
    context.strokeStyle = '#bea676'; context.lineWidth = 3; context.strokeRect(9, 9, 750, 142);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = '#efe0bc'; context.font = `600 ${label.length > 17 ? 42 : 53}px Georgia, "Microsoft YaHei", serif`;
    context.fillText(label, 384, 62, 724);
    context.fillStyle = '#c9b58f'; context.font = '23px "Microsoft YaHei", sans-serif'; context.fillText(secondary, 384, 119, 710);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; this.textures.add(texture);
    const material = new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: .02, roughness: .63 });
    this.materials.add(material); this.glowMaterials.push({ material, intensity: .9 });
    const geometry = new PlaneGeometry(width, height); this.geometries.add(geometry);
    const mesh = new Mesh(geometry, material); mesh.position.copy(this.facePoint(face, u, y, depth)); mesh.rotation.y = face.yaw;
    const group = new Group(); group.add(mesh); this.attach(group, anchors);
  }

  private warehouse(building: BuildingRecord, face: Face): void {
    const base = building.foundationY, u = face.width / 2;
    const anchors = [face.cell(Math.floor(u), base + 1)];
    for (let stripe = 0; stripe < 12; stripe++) this.faceBox(face, u - 2.5 + stripe * .46, base + 1.5, .1, .4, 2.85, .12, this.slate, anchors);
    this.sign(face, u, base + 4.15, .15, 8.5, 1.05, 'FERRY WORKS  /  04', '海湾仓储   ·   SERVICE ENTRANCE', 2, anchors);
    this.lightSources.push({ position: this.facePoint(face, u, base + 3.0, 1.6), color: new Color('#ffd0a1'), anchors });
  }

  private fireEscape(building: BuildingRecord, face: Face): void {
    const u = face.width - 2.0;
    for (let y = building.foundationY + 4; y < building.bounds.maxY - 5; y += 4) {
      const anchors = [face.cell(Math.floor(u), y)];
      this.faceBox(face, u, y, .55, 2.4, .10, 1.15, this.iron, anchors);
      this.faceBox(face, u, y + 1.0, 1.1, 2.4, .045, .045, this.iron, anchors);
      for (const side of [-1.15, 1.15]) this.faceBox(face, u + side, y + .55, 1.1, .045, 1.15, .045, this.iron, anchors);
      for (let rung = 0; rung < 10; rung++) this.faceBox(face, u + .6, y - 3.7 + rung * .4, .8, .62, .04, .07, this.iron, anchors);
      for (const side of [.25, .95]) this.faceBox(face, u + side, y - 1.9, .8, .04, 3.8, .07, this.iron, anchors);
    }
  }

  private rooftop(building: BuildingRecord, index: number): void {
    const b = building.bounds, x = b.minX + 3, z = b.minZ + 3;
    let top = b.maxY;
    while (top > building.foundationY && !this.world.getVoxel(x, top, z)) top--;
    const anchor = [{ x, y: top, z }];
    if (index % 4 === 0) {
      for (const dx of [-.85, .85]) for (const dz of [-.65, .65]) this.cube(x + dx, top + 1.7, z + dz, .08, 1.4, .08, this.iron, anchor);
      const geometry = new CylinderGeometry(1.15, 1.15, 1.8, 12); this.geometries.add(geometry);
      const tank = new Mesh(geometry, this.timber); tank.position.set(x, top + 3.1, z); tank.castShadow = true;
      const group = new Group(); group.add(tank); this.attach(group, anchor);
      for(const band of [2.45,3.65])this.box(new Vector3(x,top+band,z),new Vector3(1,1,1),this.iron,anchor,0,this.tankHoop);
    } else if (index % 4 === 1) {
      this.cube(x, top + 1.55, z, .7, 1.1, .8, this.terracotta, anchor);
      this.cube(x, top + 2.1, z, .95, .12, 1.05, this.cream, anchor);
      this.cube(x + 2.4, top + 2.4, z + 1.1, .045, 2.8, .045, this.iron, anchor);
      for (let bar = 0; bar < 4; bar++) this.cube(x + 2.4, top + 3.2 - bar * .26, z + 1.1, 1.6 - bar * .22, .035, .035, this.iron, anchor);
    }
    if (index % 2 === 0) for (let panel = 0; panel < 3; panel++) this.cube(b.maxX - 3, building.foundationY + 7 + panel * 5, b.maxZ + .22, .9, .6, .45, this.cream, [{ x: b.maxX - 3, y: building.foundationY + 7 + panel * 5, z: b.maxZ - 1 }]);
  }

  private streetFurniture(): void {
    // The ground markings sit just above the authoritative pavement and disappear with it.
    for (const x of [38, 84, 130, 176, 222]) {
      for (const side of [-5.05, 5.05]) for (let z = 3; z < 168; z += 8) {
        this.groundMark(x+side,z,.16,7.7);
      }
    }
    for (const z of [35, 80, 125, 164]) {
      for (const side of [-5.05, 5.05]) for (let x = 3; x < 254; x += 8) this.groundMark(x,z+side,7.7,.16);
    }
    for (const x of [38, 84, 130, 176, 222]) for (const z of [80, 125, 164]) for (const side of [-1, 1]) {
      for (let stripe = -3; stripe <= 3; stripe++) this.groundMark(x+stripe*1.1,z+side*5.5,.58,1.55);
    }
    for (const [x, z] of [[103, 169], [117, 169], [124, 109], [134, 95], [78, 147], [90, 58], [205, 169], [21, 29]]) {
      const footing=findFurnitureFooting(this.world,x,z,0,furnitureFootContacts([{x:0,z:0}],.29,.425),16,0,true);
      if(!footing)continue;const anchor=footing.anchors,y=footing.y;
      this.cube(x,y+.004,z,.58,.008,.85,this.iron,anchor);
      for(let bar=0;bar<6;bar++)this.cube(x,y+.009,z-.34+bar*.135,.48,.004,.025,this.rubber,anchor);
    }
    for (const [x, z, yaw] of [[120.6, 144, 0], [92, 149, 0], [120.7, 101, 0], [74, 62, 0], [24.4, 29.4, Math.PI / 2]]) this.bicycle(x, z, yaw);
    for (const [originX, originZ] of [[118.5, 148], [96.3, 149], [120.5, 106], [73.5, 62], [209, 172.3], [165.4, 172.3]]) {
      const footing=findFurnitureFooting(this.world,originX,originZ,0,furnitureFootContacts([{x:0,z:0}],.31,.31),16,2);
      if(!footing)continue;const anchor=footing.anchors,{x,y,z}=footing;this.propFootings.push({kind:'bin',...footing});
      this.box(new Vector3(x,y+.38,z),new Vector3(1,1,1),this.slate,anchor,0,this.binGeometry);
      this.box(new Vector3(x,y+.81,z),new Vector3(1,1,1),this.iron,anchor,0,this.binLidGeometry);
      this.cube(x,y+.62,z-.314,.2,.12,.025,this.rubber,anchor);
      this.obstacle(x,y+.43,z,.7,.86,.7,anchor);
      for(const [dx,dz,sx,sy,sz] of [[.7,.24,.43,.46,.47],[.9,-.15,.34,.34,.4]]){
        const bag=findFurnitureFooting(this.world,x+dx,z+dz,0,furnitureFootContacts([{x:0,z:0}],sx*.3,sz*.3),y);
        if(!bag)continue;
        this.box(new Vector3(bag.x,bag.y+sy/2,bag.z),new Vector3(sx,sy,sz),this.rubber,bag.anchors,0,this.bagGeometry);
        this.cube(bag.x,bag.y+sy+.012,bag.z,.065,.045,.055,this.rubber,bag.anchors);
        this.obstacle(bag.x,bag.y+sy/2,bag.z,sx,sy,sz,bag.anchors);
      }
    }
    for (const [x, z, yaw, paint] of [[80.8, 145, 0, '#476a64'], [133.1, 104, 0, '#c3b79c'], [41.2, 59, 0, '#a96740'], [179.2, 100, 0, '#4b657b'], [70, 155.6, Math.PI / 2, '#9c3c35'], [205, 172.4, Math.PI / 2, '#d4cbb5']] as const) this.car(x, z, yaw, paint);
    for (const [x, z] of [[103, 167.6], [116.7, 162.1], [124.6, 101], [132.1, 112], [88.4, 149], [171.5, 142], [20, 30], [196, 169]]) this.puddle(x, z, 1.0 + (x % 3) * .28, .55 + (z % 3) * .14);
    for (const [x, z] of [[110.5, 171], [90.5, 171], [130.5, 171], [124.5, 89.5], [124.5, 134.5], [44.5, 44.5], [216.5, 134.5]]) {
      const anchor = [{ x: Math.floor(x), y: 15, z: Math.floor(z) }];
      this.lightSources.push({ position: new Vector3(x, 19.0, z), color: new Color('#ffd49a'), anchors: anchor });
      this.lightPool(new Vector3(x, 16.028, z), 4.3, 4.3, '#cfaa69', .20, anchor);
    }
    this.parkBench(17.8, 29.3);
  }

  private parkDetails(): void {
    const poolAnchor = [{ x: 17, y: 15, z: 17 }, { x: 19, y: 15, z: 17 }, { x: 17, y: 15, z: 19 }];
    const stone = this.material('#aaa78f', .72);
    const flowers = this.material('#bd8a78', .9);
    // Thin laid stones lead to and around a small, identifiable garden landmark.
    for (let z = 6.5; z < 30; z += 2.6) {
      if (z > 14.5 && z < 20.5) continue;
      this.cube(17.5 + Math.sin(z) * .15, 16.006, z, 1.35, .012, 1.82, stone, [{ x: 17, y: 15, z: Math.floor(z) }], Math.sin(z) * .06);
    }
    for (let x = 6.5; x < 30; x += 2.6) {
      if (x > 14.5 && x < 20.5) continue;
      this.cube(x, 16.006, 17.5 + Math.cos(x) * .15, 1.82, .012, 1.35, stone, [{ x: Math.floor(x), y: 15, z: 17 }], Math.cos(x) * .06);
    }
    for (let i = 0; i < 10; i++) {
      const angle = i / 10 * Math.PI * 2, x = 17.5 + Math.sin(angle) * 3.05, z = 17.5 + Math.cos(angle) * 3.05;
      this.cube(x, 16.006, z, 1.35, .012, 1.6, stone, [{ x: Math.floor(x), y: 15, z: Math.floor(z) }], angle);
    }
    const basinGeometry = new CylinderGeometry(1.9, 1.82, .55, 24); this.geometries.add(basinGeometry);
    const basin = new Mesh(basinGeometry, stone); basin.position.set(17.5, 16.275, 17.5); basin.castShadow = basin.receiveShadow = true;
    const pool = new Group(); pool.add(basin);
    const waterGeometry = new RingGeometry(0, 1.48, 32); this.geometries.add(waterGeometry);
    const waterMaterial = new MeshPhysicalMaterial({ color: '#496d6b', roughness: .09, metalness: .18, clearcoat: 1, clearcoatRoughness: .04 }); this.materials.add(waterMaterial);
    const water = new Mesh(waterGeometry, waterMaterial); water.rotation.x = -Math.PI / 2; water.position.set(17.5, 16.565, 17.5); pool.add(water);
    this.attach(pool, poolAnchor);
    this.cube(17.5, 16.81, 17.5, .31, .51, .31, stone, poolAnchor);
    this.cube(17.5, 17.11, 17.5, .64, .12, .64, stone, poolAnchor);
    this.cube(17.5, 17.035, 17.84, .07, .065, .16, this.brass, poolAnchor);
    this.parkedCars.push({ anchors: poolAnchor, bounds: { minX: 15.6, minY: 16, minZ: 15.6, maxX: 19.4, maxY: 17.17, maxZ: 19.4 } });
    const bench = (x: number, z: number, yaw: number) => {
      const footing=findFurnitureFooting(this.world,x,z,yaw,furnitureFootContacts([{x:-.78,z:0},{x:.78,z:0}],.038,.24),16,2);
      if(!footing)return;
      x=footing.x;z=footing.z;const anchors=footing.anchors,baseY=footing.y;
      this.furnitureFootings.push({kind:'bench',...footing});
      this.seats.push({id:`park-bench-${x}-${z}`,position:{x:x+Math.sin(yaw)*.12,y:baseY+.53,z:z+Math.cos(yaw)*.12},floorY:baseY,yaw:yaw+Math.PI,available:()=>anchors.every(p=>this.world.getVoxel(p.x,p.y,p.z)!==0)&&this.obstacles.some(o=>o.minX<=x&&o.maxX>=x&&o.minZ<=z&&o.maxZ>=z&&Math.abs(o.maxY-baseY-.53)<.01)});
      const part = (u: number, y: number, w: number, sx: number, sy: number, sz: number, material: MeshStandardMaterial) => this.box(new Vector3(u, y, w).applyAxisAngle(new Vector3(0, 1, 0), yaw).add(new Vector3(x, baseY, z)), new Vector3(sx, sy, sz), material, anchors, yaw);
      part(0, .48, 0, 2.15, .1, .55, this.timber);
      for (const side of [-.78, .78]) part(side, .24, 0, .075, .48, .48, this.iron);
      for (const y of [.74, .91, 1.08]) part(0, y, -.31, 2.15, .115, .065, this.timber);
      const rotation={x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)};
      const solid=(u:number,y:number,w:number,sx:number,sy:number,sz:number,standable=true)=>{
        const p=new Vector3(u,y,w).applyAxisAngle(new Vector3(0,1,0),yaw).add(new Vector3(x,baseY,z));
        this.parkedCars.push({anchors,bounds:{...orientedCollisionBounds(p,rotation,{x:sx/2,y:sy/2,z:sz/2}),standable}});
      };
      solid(0,.48,0,2.15,.1,.55);
      for(const side of [-.78,.78])solid(side,.24,0,.075,.48,.48,false);
      for(const y of [.74,.91,1.08])solid(0,y,-.31,2.15,.115,.065,false);
    };
    bench(8.0, 17.7, Math.PI / 2);
    bench(18.4, 7.1, 0);
    for (const [x, z] of [[6.2, 7.2], [28.8, 8.1], [6.2, 27.2], [28.2, 27.3]]) {
      const anchor = [{ x: Math.floor(x), y: 15, z: Math.floor(z) }];
      this.cube(x, 16.13, z, 1.35, .26, 1.25, stone, anchor);
      this.cube(x, 16.48, z, 1.21, .47, 1.12, this.slate, anchor);
      for (const [dx, dz] of [[-.28, -.15], [.23, -.21], [.08, .25]]) this.cube(x + dx, 16.8, z + dz, .31, .20, .31, flowers, anchor);
      this.parkedCars.push({ anchors: anchor, bounds: { minX: x - .68, minY: 16, minZ: z - .63, maxX: x + .68, maxY: 16.87, maxZ: z + .63 } });
    }
    const signAnchor = [{ x: 25, y: 15, z: 28 }];
    this.cube(25.5, 16.82, 28.4, .075, 1.64, .075, this.iron, signAnchor);
    this.obstacle(25.5, 16.82, 28.4, .12, 1.64, .12, signAnchor);
    const signFace: Face = { origin: new Vector3(25.5, 0, 28.47), yaw: 0, width: 2, cell: () => signAnchor[0] };
    this.sign(signFace, 0, 17.47, .01, 2.7, .78, '海 风 公 园', 'SEA BREEZE GARDEN', 0, signAnchor);
    const lampAnchor = [{ x: 26, y: 15, z: 20 }];
    this.cube(26.5, 17.55, 20.5, .075, 3.1, .075, this.iron, lampAnchor);
    this.solidCube(26.5, 19.13, 20.5, .36, .14, .36, this.iron, lampAnchor);
    this.cube(26.5, 19.04, 20.5, .27, .05, .27, this.ivoryLamp, lampAnchor);
    this.obstacle(26.5, 17.55, 20.5, .12, 3.1, .12, lampAnchor);
    this.lightSources.push({ position: new Vector3(26.5, 18.9, 20.5), color: new Color('#ffdbaf'), anchors: lampAnchor });
  }

  private bicycle(x: number, z: number, yaw: number): void {
    const footing=findFurnitureFooting(this.world,x,z,yaw,furnitureFootContacts([{x:0,z:-.65},{x:0,z:.65}],.025,.08),16,2);
    if(!footing)return;x=footing.x;z=footing.z;const {y,anchors}=footing;this.propFootings.push({kind:'bicycle',...footing});
    const group = new Group(); group.position.set(x, y-.02, z); group.rotation.y = yaw;
    const wheel = new RingGeometry(.28, .34, 20); this.geometries.add(wheel);
    for (const end of [-.65, .65]) {
      const mesh = new Mesh(wheel, this.rubber); mesh.rotation.y = Math.PI / 2; mesh.position.set(0, .36, end); mesh.material.side = DoubleSide; group.add(mesh);
    }
    const rodGeometry = new CylinderGeometry(.024, .024, 1, 5); this.geometries.add(rodGeometry);
    const rod = (a: Vector3, b: Vector3) => {
      const mesh = new Mesh(rodGeometry, this.terracotta), delta = b.clone().sub(a);
      mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.scale.y = delta.length(); mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()); group.add(mesh);
    };
    const bottom = new Vector3(0, .4, 0), saddle = new Vector3(0, .88, -.23), head = new Vector3(0, .92, .5);
    for (const [a, b] of [[bottom, saddle], [saddle, head], [head, bottom], [bottom, new Vector3(0, .36, -.65)], [saddle, new Vector3(0, .36, -.65)], [head, new Vector3(0, .36, .65)]]) rod(a, b);
    rod(new Vector3(-.25, 1.04, .51), new Vector3(.25, 1.04, .51));
    const seat = new Mesh(this.unitBox, this.rubber); seat.scale.set(.25, .065, .28); seat.position.set(0, .95, -.23); group.add(seat);
    this.attach(group, anchors);
    this.obstacle(x, y+.54, z, .58, 1.08, 2.08, anchors, yaw);
  }

  private car(x: number, z: number, yaw: number, paint: string): void {
    const id=this.parkingSequence++,previous=new Map([...this.batches.values(),...this.shapedBatches].map(b=>[b,b.details.length]));
    const footing=findFurnitureFooting(this.world,x,z,yaw,furnitureFootContacts([-.87,.87].flatMap(x=>[-1.3,1.3].map(z=>({x,z}))),.11,.08),16,0,true)??(this.options.parkedStates?.some(s=>s.id===id)?{x,z,y:16,anchors:[]}:null);
    if(!footing)return;const anchor=footing.anchors,baseY=footing.y,material=surfaceFinish(this.material(paint,.34,.22),'paint');this.propFootings.push({kind:'car',...footing});
    const halfX = Math.abs(Math.cos(yaw)) * .99 + Math.abs(Math.sin(yaw)) * 2.16;
    const halfZ = Math.abs(Math.sin(yaw)) * .99 + Math.abs(Math.cos(yaw)) * 2.16;
    // Saved parked-car rotations are relative to this original world-axis frame.
    // Keep that frame, while sharing its exact dimensions with Rapier.
    const half={x:halfX,y:.675,z:halfZ};
    const bounds={...orientedCollisionBounds({x,y:baseY+.675,z},{x:0,y:0,z:0,w:1},half),trafficId:id,trafficKind:'sedan' as const,trafficHalfSize:half};
    this.parkedCars.push({ anchors: anchor, bounds });
    const part = (u: number, y: number, w: number, sx: number, sy: number, sz: number, mat: MeshStandardMaterial,geometry=this.unitBox as BufferGeometry,pitch=0) => this.box(new Vector3(u, y, w).applyAxisAngle(new Vector3(0, 1, 0), yaw).add(new Vector3(x, baseY, z)), new Vector3(sx, sy, sz), mat, anchor, yaw,geometry,pitch);
    part(0,.012,0,2.05,1,3.9,this.contactMaterial,this.contactPlane);
    // Match the moving sedan's interior; retain the existing parked-car height
    // and collision/save frame by compressing the body vertically by six percent.
    const ys=.94,rig=TRAFFIC_CABIN_RIG.sedan;
    part(0,0,0,1,ys,1,material,this.parkedBody);
    part(0,1.04*ys,.10,1.75*.88,.64*ys,4.05*.50,material,this.cabinGeometry);
    part(0,1.04*ys,.10,1.75*.88,.64*ys,4.05*.50,this.vehicleGlass,this.windscreenGeometry);
    part(0,1.07*ys,4.05*.208,1.75*.77,.28*ys,1,this.vehicleGlass,this.vehiclePane);
    this.parkedInterior.forEach((p,i)=>part(0,0,0,1,ys,1,this.vehicleInteriorMaterials[i],p.geometry));
    part(rig.x,rig.wheelY*ys,rig.wheelZ,rig.wheelRadius/.17,rig.wheelRadius/.17*ys,rig.wheelRadius/.17,this.vehicleControls,this.parkedWheel,rig.wheelPitch);
    for (const side of [-1, 1]) {
      part(side*1.75*.445,1.09*ys,.09,4.05*.22,.29*ys,1,this.vehicleGlass,this.vehicleSidePane);
      part(side*.93,.95*ys,-.71,.13,.15,.20,this.vehicleControls);
      part(side*.86,.92*ys,-.70,.10,.035,.035,this.vehicleControls);
      for (const end of [-1.3, 1.3]){part(side*.87,.31,end,1,1,1,this.rubber,this.tyreGeometry);part(side*.87,.31,end,1,1,1,this.brass,this.hubGeometry);}
      part(side * .59, .58, -2.043, .45, .16, .035, this.ivoryLamp);
      part(side * .59, .58, 2.043, .35, .17, .035, this.redLamp);
    }
    part(0, .26, 2.06, 1.65, .12, .13, this.iron);
    part(0, .4, 2.096, .42, .13, .018, this.cream);
    const parts:Array<{batch:Batch;detail:Detail;index:number}>=[];
    for(const batch of [...this.batches.values(),...this.shapedBatches])for(let index=previous.get(batch)??0;index<batch.details.length;index++)parts.push({batch,index,detail:batch.details[index]});
    this.physicalParked.push({id,origin:new Vector3(x,baseY+.675,z),half:new Vector3(halfX,.675,halfZ),bounds,parts,active:false});
  }

  private parkBench(x: number, z: number): void {
    const footing=findFurnitureFooting(this.world,x,z,0,furnitureFootContacts([{x:-.76,z:0},{x:.76,z:0}],.045,.27),16);
    if(!footing)return;const anchor=footing.anchors,y=footing.y;this.furnitureFootings.push({kind:'bench',...footing});
    this.seats.push({id:`street-bench-${x}-${z}`,position:{x,y:y+.515,z:z+.12},floorY:y,yaw:Math.PI,available:()=>anchor.every(p=>this.world.getVoxel(p.x,p.y,p.z)!==0)&&this.obstacles.some(o=>o.minX<=x&&o.maxX>=x&&o.minZ<=z&&o.maxZ>=z&&Math.abs(o.maxY-y-.515)<.01)});
    for(let slat=0;slat<4;slat++)this.cube(x,y+.48,z+(slat-1.5)*.13,2,.07,.10,this.timber,anchor);
    this.obstacle(x,y+.48,z,2,.07,.49,anchor);
    for(let slat=0;slat<3;slat++){
      this.cube(x,y+.74+slat*.14,z-.31,2,.10,.07,this.timber,anchor);
      this.parkedCars.push({anchors:anchor,bounds:{...orientedBoxBounds({x,y:y+.74+slat*.14,z:z-.31},{x:0,y:0,z:0,w:1},{x:1,y:.05,z:.035}),standable:false}});
    }
    for(const side of [-.76,.76]){
      this.cube(x+side,y+.24,z,.09,.48,.54,this.iron,anchor);
      this.parkedCars.push({anchors:anchor,bounds:{minX:x+side-.045,maxX:x+side+.045,minY:y,maxY:y+.48,minZ:z-.27,maxZ:z+.27,standable:false}});
    }
  }

  private lightPool(position: Vector3, sx: number, sz: number, color: string, strength: number, anchors: Cell[]): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d'); if (!context) return;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,.8)'); gradient.addColorStop(.34, 'rgba(255,255,255,.4)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas); this.textures.add(texture);
    const material = new MeshBasicMaterial({ map: texture, color, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false });
    this.materials.add(material);
    const geometry = new PlaneGeometry(sx * 2, sz * 2); this.geometries.add(geometry);
    const mesh = new Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2; mesh.position.copy(position); mesh.renderOrder = 4;
    const group = new Group(); group.add(mesh); this.attach(group, anchors); this.pools.push({ mesh, material, strength });
  }

  private puddle(x: number, z: number, rx: number, rz: number, ground = 16): void {
    const shape = new Shape();
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2, uneven = .84 + .14 * Math.sin(i * 4.73 + x);
      points.push([Math.cos(angle) * rx * uneven, Math.sin(angle) * rz * uneven]);
    }
    shape.moveTo(...points[0]); points.slice(1).forEach(p => shape.lineTo(...p)); shape.closePath();
    const geometry = new ShapeGeometry(shape); this.geometries.add(geometry);
    const material = new MeshPhysicalMaterial({ color: '#3b5b61', roughness: .075, metalness: .32, clearcoat: 1, clearcoatRoughness: .035, transparent: true, opacity: .62, depthWrite: false });
    this.materials.add(material);
    const mesh = new Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, ground + .036, z); mesh.receiveShadow = true; mesh.renderOrder = 2;
    const anchors=surfacePatches(x,z,rx*2,rz*2).map(p=>({x:p.anchorX,y:ground-1,z:p.anchorZ}));
    const group = new Group(); group.add(mesh); this.attach(group, anchors); this.puddles.push(mesh);
  }

  private harborDetails(): void {
    // Optional new harbor platform: all elements require its timber support.
    for (const x of [13, 32, 51]) for (const [wall, outside] of [[227, 228.14], [237, 236.86]]) {
      const anchor = [{ x, y: 18, z: wall }];
      this.solidCube(x + .5, 18.3, outside, .22, .42, .2, this.iron, anchor);
      this.cube(x + .5, 18.3, outside + (wall === 227 ? .115 : -.115), .15, .29, .025, this.litTrim, anchor);
      this.lightSources.push({ position: new Vector3(x + .5, 18.3, outside), color: new Color('#ffd3a4'), anchors: anchor });
    }
    const harborBrands = [
      ['SEA SALT BAKERY', '海盐面包房'], ['TIDE INN', '潮汐旅舍'], ['NET & LINE', '渔具铺'],
      ['港 口 食 堂', 'HARBOR CANTEEN'], ['HULL & HAMMER', '修船工坊'], ['海 边 小 屋', 'A ROOM BY THE SEA'],
    ];
    for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
      const x0 = [12, 31, 50][column], x1 = [25, 44, 62][column], z = row ? 237 : 227;
      const face: Face = row ? {
        origin: new Vector3(x1 + 1, 0, z - .08), yaw: Math.PI, width: x1 - x0 + 1,
        cell: (u, y) => ({ x: x1 - u, y, z }),
      } : {
        origin: new Vector3(x0, 0, z + 1.08), yaw: 0, width: x1 - x0 + 1,
        cell: (u, y) => ({ x: x0 + u, y, z }),
      };
      const brand = harborBrands[row * 3 + column], anchor = [{ x: x0 + 4, y: 20, z }];
      this.sign(face, face.width / 2, 20.6, .04, Math.min(7, face.width - 2), .82, brand[0], brand[1], column % 3, anchor);
      const doorway = row ? face.width - 5 : 5;
      for (const side of [-1.12, 1.12]) this.faceBox(face, doorway + side, 17.5, .10, .12, 3.05, .18, this.cream, anchor);
      this.faceBox(face, doorway, 19.1, .10, 2.35, .15, .18, this.cream, anchor);
    }
    for (let z = 211.6; z < 250; z += .72) this.cube(36.5, 15.014, z, 57.5, .016, .022, this.iron, [{ x: 36, y: 14, z: Math.floor(z) }]);
    for (let x = 65.7; x < 102; x += .72) this.cube(x, 15.014, 214.5, .022, .016, 4.8, this.iron, [{ x: Math.floor(x), y: 14, z: 214 }]);
    for (const [x, z] of [[13, 229], [26, 226], [44, 237], [59, 228], [8, 222], [52, 245]]) {
      const anchor = [{ x, y: 14, z }];
      for (let stack = 0; stack < 2; stack++) {
        this.cube(x, 15.32 + stack * .66, z, .9, .63, .8, this.timber, anchor);
        for (const side of [-.36, .36]) this.cube(x + side, 15.32 + stack * .66, z + .41, .075, .63, .045, this.cream, anchor);
        this.cube(x, 15.32 + stack * .66, z + .415, .9, .075, .045, this.cream, anchor);
      }
      this.obstacle(x, 15.66, z, 1.0, 1.32, .93, anchor);
    }
    for (const x of [19, 38, 57]) {
      const anchors = [{ x, y: 14, z: 234 }];
      this.cube(x, 16.2, 234.7, .075, 2.4, .075, this.timber, anchors);
      this.cube(x + 2.8, 16.2, 234.7, .075, 2.4, .075, this.timber, anchors);
      const positions: number[] = [];
      for (let stripe = 0; stripe <= 7; stripe++) {
        const d = stripe * .4; positions.push(x + d, 15.1, 234.7, x + d, 16.9, 234.7);
        if (stripe < 5) positions.push(x, 15.1 + d, 234.7, x + 2.8, 15.1 + d, 234.7);
      }
      const geometry = new BufferGeometry(); geometry.setFromPoints(Array.from({ length: positions.length / 3 }, (_, i) => new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))); this.geometries.add(geometry);
      const material = new LineBasicMaterial({ color: '#827965', transparent: true, opacity: .7 }); this.materials.add(material);
      const group = new Group(); group.add(new LineSegments(geometry, material)); this.attach(group, anchors);
      this.obstacle(x + 1.4, 16.2, 234.7, 2.95, 2.4, .12, anchors);
    }
    for (const x of [9, 63]) {
      const geometry = new TorusGeometry(.34, .1, 6, 16); this.geometries.add(geometry);
      const group = new Group(), ring = new Mesh(geometry, this.terracotta); ring.position.set(x, 16.0, 230.0); group.add(ring);
      this.attach(group, [{ x, y: 14, z: 230 }]);
    }
    this.puddle(36, 231, 1.2, .4, 15);
    this.lightSources.push({ position: new Vector3(18.5, 18.1, 229.0), color: new Color('#ffd3a4'), anchors: [{ x: 18, y: 14, z: 229 }] });
    this.lightSources.push({ position: new Vector3(37.5, 18.1, 236.0), color: new Color('#ffd3a4'), anchors: [{ x: 37, y: 14, z: 236 }] });
    this.lightPool(new Vector3(18.5, 15.026, 229.5), 3.3, 2.2, '#e3a669', .26, [{ x: 18, y: 14, z: 229 }]);
    this.lightPool(new Vector3(37.5, 15.027, 235), 3.3, 2.2, '#e3a669', .26, [{ x: 37, y: 14, z: 235 }]);
  }

  private interiorBoard(x: number, y: number, z: number, yaw: number, width: number, height: number, title: string, lines: string[], anchors: Cell[]): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 512;
    const context = canvas.getContext('2d'); if (!context) return;
    context.fillStyle = '#27382f'; context.fillRect(0, 0, 768, 512);
    context.strokeStyle = '#947452'; context.lineWidth = 20; context.strokeRect(10, 10, 748, 492);
    context.strokeStyle = '#baa77f'; context.lineWidth = 2; context.beginPath(); context.moveTo(55, 131); context.lineTo(713, 131); context.stroke();
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#e9debd';
    context.font = '600 47px Georgia, "Microsoft YaHei", serif'; context.fillText(title, 384, 79, 662);
    context.font = '30px "Microsoft YaHei", sans-serif';
    lines.forEach((line, i) => context.fillText(line, 384, 194 + i * 72, 656));
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; this.textures.add(texture);
    const material = new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffdfb0', emissiveIntensity: 0, roughness: .93 });
    this.materials.add(material); this.glowMaterials.push({ material, intensity: .36 });
    const geometry = new PlaneGeometry(width, height); this.geometries.add(geometry);
    const mesh = new Mesh(geometry, material); mesh.position.set(x, y, z); mesh.rotation.y = yaw;
    const group = new Group(); group.add(mesh); this.attach(group, anchors);
  }

  private interiorTable(x: number, z: number, long = false): void {
    const tableFooting=findFurnitureFooting(this.world,x,z,0,furnitureFootContacts([-.38,.38].flatMap(x=>[-.29,.29].map(z=>({x,z}))),.033,.033),16);
    const anchor=tableFooting?.anchors??[];
    const tableBase=tableFooting?.y??16;
    if(tableFooting)this.furnitureFootings.push({kind:'table',...tableFooting});
    if(tableFooting){
      this.solidCube(x, tableBase+.77, z, long ? 1.4 : 1.02, .10, .86, this.timber, anchor,true);
      for(const dx of [-.38,.38])for(const dz of [-.29,.29])this.solidPart(new Vector3(x+dx,tableBase+.36,z+dz),new Vector3(.065,.72,.065),this.iron,anchor,0,this.legCylinder);
    }
    for (const side of [-1, 1]) {
      const chairFooting=findFurnitureFooting(this.world,x+side*(long?1.26:1.12),z,0,furnitureFootContacts([-.17,.17].flatMap(x=>[-.18,.18].map(z=>({x,z}))),.0275,.0275),16);
      if(!chairFooting)continue;
      const chairX=chairFooting.x,chairZ=chairFooting.z,chairAnchors=chairFooting.anchors,baseY=chairFooting.y;
      // Space the actual chair for the torso and backpack, not an invisible
      // collision exemption. Dining entries use either side of the seat.
      this.seats.push({id:`dining-chair-${x}-${z}-${side<0?'left':'right'}`,kind:'chair',halfWidth:.24,halfDepth:.24,position:{x:chairX-side*.145,y:baseY+.495,z:chairZ},floorY:baseY,yaw:side*Math.PI/2,available:()=>chairAnchors.every(p=>!!this.world.getVoxel(p.x,p.y,p.z))&&this.obstacles.some(b=>b.minX<=chairX&&b.maxX>=chairX&&b.minZ<=chairZ&&b.maxZ>=chairZ&&Math.abs(b.maxY-baseY-.495)<.001)});
      this.furnitureFootings.push({kind:'chair',...chairFooting});
      this.solidCube(chairX, baseY+.45, z, .48, .09, .48, this.timber, chairAnchors,true);
      for(const level of [.63,.82,1.01])this.solidCube(chairX+side*.2,baseY+level,z,.075,.145,.48,this.timber,chairAnchors);
      for(const edge of [-.205,.205])this.solidCube(chairX+side*.2,baseY+.81,z+edge,.045,.68,.045,this.timber,chairAnchors);
      for(const dx of [-.17,.17])for(const dz of [-.18,.18]){
        this.solidPart(new Vector3(chairX+dx,baseY+.2,z+dz),new Vector3(.055,.4,.055),this.iron,chairAnchors,0,this.legCylinder);
      }
    }
    if(tableFooting){
      this.box(new Vector3(x+.24,tableBase+.826,z),new Vector3(1,1,1),this.cream,anchor,0,this.saucerGeometry);
      this.box(new Vector3(x+.24,tableBase+.832,z),new Vector3(1,1,1),this.cream,anchor,0,this.cupGeometry);
      this.box(new Vector3(x+.31,tableBase+.904,z),new Vector3(1,1,1),this.cream,anchor,0,this.cupHandle);
      this.box(new Vector3(x+.24,tableBase+.94,z),new Vector3(1,1,1),this.coffee,anchor,0,this.coffeeGeometry);
      this.cube(x-.18,tableBase+.821,z+.10,.21,.002,.25,this.cream,anchor,.14);
    }
  }

  private pendant(x: number, z: number, ceiling: number): void {
    const anchor = [{ x: Math.floor(x), y: 15, z: Math.floor(z) }];
    this.cube(x, ceiling - .48, z, .022, .96, .022, this.iron, anchor);
    const shadeGeometry = new CylinderGeometry(.13, .47, .29, 12); this.geometries.add(shadeGeometry);
    const shade = new Mesh(shadeGeometry, this.slate); shade.position.set(x, ceiling - 1.07, z);
    const group = new Group(); group.add(shade); this.attach(group, anchor);
    this.cube(x, ceiling - 1.22, z, .53, .035, .53, this.litTrim, anchor);
    this.lightSources.push({ position: new Vector3(x, ceiling - 1.45, z), color: new Color('#ffd3a0'), anchors: anchor });
    this.lightPool(new Vector3(x, 16.025, z), 3.1, 2.8, '#dda265', .20, anchor);
  }

  private harborInteriors(): void {
    // A clear 3 m central aisle from each real doorway to its existing voxel counter.
    // Counter blocks are furniture, not one-metre terrain steps. Per-cell support
    // keeps a destroyed section from leaving an invisible continuous barrier.
    for (const z of [220, 245]) for (let column = 0; column < 3; column++) {
      for (let x = [12, 31, 50][column] + 2; x <= [25, 44, 62][column] - 2; x++) {
        this.parkedCars.push({ anchors: [{ x, y: 16, z }], bounds: { minX: x, minY: 16, minZ: z, maxX: x + 1, maxY: 17, maxZ: z + 1 } });
      }
    }
    const bakeryCounter = [{ x: 20, y: 16, z: 220 }];
    const loafGeometry=new SphereGeometry(.5,12,8),loafVertices=loafGeometry.getAttribute('position');
    for(let i=0;i<loafVertices.count;i++)loafVertices.setY(i,(Math.max(-.32,loafVertices.getY(i))+.32)/.82-.5);
    loafGeometry.computeVertexNormals();this.geometries.add(loafGeometry);
    const crust=surfaceFinish(this.material('#b27c48',.92),'stone');
    const crumb=this.material('#cda275',.95);
    this.parkedCars.push({ anchors: bakeryCounter, bounds: { minX: 19.71, minY: 17, minZ: 220.01, maxX: 21.89, maxY: 18, maxZ: 220.99 } });
    for (const x of [15.0, 17.7, 20.8]) {
      const support=findFurnitureFooting(this.world,x,220.5,0,furnitureFootContacts([{x:0,z:0}],.725,.4),17);
      if(!support)continue;const trayAnchors=support.anchors;
      this.solidCube(x,17.05,220.5,1.45,.10,.8,this.timber,trayAnchors,true);
      for (let loaf = 0; loaf < 6; loaf++) {
        const bx = x - .46 + (loaf % 3) * .45, bz = 220.3 + Math.floor(loaf / 3) * .3;
        this.box(new Vector3(bx,17.195,bz),new Vector3(.34,.19,.23),crust,trayAnchors,.08,loafGeometry);
        for(const cut of [-.065,0,.065])for(const dz of [-.03,0,.03]){
          const crustY=(.5*Math.sqrt(1-(cut/.17)**2-(dz/.115)**2)+.32)/.82-.5;
          this.cube(bx+cut,17.195+crustY*.19+.001,bz+dz,.009,.003,.027,crumb,trayAnchors,-.35);
        }
      }
    }
    const clearGlass = new MeshPhysicalMaterial({ color: '#9ab5af', transparent: true, opacity: .17, roughness: .08, metalness: .08, clearcoat: 1, depthWrite: false });
    this.materials.add(clearGlass);
    this.cube(20.8,17.46,220.5,2.18,.92,.98,clearGlass,bakeryCounter);
    for (const x of [19.7,21.9])this.cube(x,17.47,220.99,.035,.94,.035,this.brass,bakeryCounter);
    this.solidCube(22.5, 17.16, 220.5, .6, .30, .48, this.iron, bakeryCounter);
    this.solidCube(22.5, 17.39, 220.3, .5, .28, .07, this.dimGlass, bakeryCounter);
    this.interiorBoard(18.4, 20.2, 219.08, 0, 4.3, 2.35, 'SEA SALT BAKERY', ['手作海盐面包  ·  每日清晨出炉', 'SOURDOUGH    /    BUTTER ROLLS', 'COFFEE & A WARM PLACE', '雨天，也等你来'], [{ x: 18, y: 20, z: 218 }]);
    const rackAnchor = [{ x: 13, y: 15, z: 225 }];
    for (const x of [13.25, 14.12]) for (const z of [224.35, 225.2]) this.cube(x, 17.05, z, .045, 2.1, .045, this.iron, rackAnchor);
    for (let shelf = 0; shelf < 4; shelf++) {
      this.cube(13.68, 16.18 + shelf * .53, 224.78, .94, .055, .94, this.cream, rackAnchor);
      for (const z of [224.55, 224.95]) this.box(new Vector3(13.68,16.3025+shelf*.53,z),new Vector3(.65,.19,.22),crust,rackAnchor,0,loafGeometry);
    }
    this.parkedCars.push({ anchors: rackAnchor, bounds: { minX: 13.2, minY: 16, minZ: 224.3, maxX: 14.2, maxY: 18.12, maxZ: 225.3 } });
    this.interiorTable(22.1, 224.5);
    this.pendant(18.6, 223.4, 22.85);

    const canteenCounter = [{ x: 20, y: 16, z: 245 }];
    this.solidCube(21.0, 17.06, 245.5, 2.8, .1, .86, this.iron, canteenCounter,true);
    const potGeometry = new CylinderGeometry(.27, .27, .38, 12); this.geometries.add(potGeometry);
    const lidGeometry = new CylinderGeometry(.3, .3, .035, 12); this.geometries.add(lidGeometry);
    for (const x of [20.2, 21.2]) {
      this.solidPart(new Vector3(x,17.29,245.48),new Vector3(1,1,1),this.cream,canteenCounter,0,potGeometry);
      this.solidPart(new Vector3(x,17.5,245.48),new Vector3(1,1,1),this.iron,canteenCounter,0,lidGeometry);
      this.solidCube(x, 17.56, 245.48, .12, .08, .08, this.iron, canteenCounter);
    }
    const bowlGeometry=new LatheGeometry([[0,0],[.075,0],[.105,.015],[.14,.16],[.125,.17],[.095,.03],[0,.03]].map(([x,y])=>new Vector2(x,y)),16);this.geometries.add(bowlGeometry);
    for(let bowl=0;bowl<4;bowl++)this.box(new Vector3(15.4+bowl*.42,17,245.4),new Vector3(1,1,1),this.cream,canteenCounter,0,bowlGeometry);
    this.interiorBoard(18.9, 20.0, 246.91, Math.PI, 5.2, 2.35, '港 口 食 堂', ['TODAY  /  今日供应', '鲜鱼汤   ·   海盐面包', 'HOT SOUP    /    GRILLED FISH', '末班渡轮前，一盏暖灯'], [{ x: 19, y: 20, z: 247 }]);
    this.interiorTable(22.0, 240.4, true);
    this.interiorTable(22.0, 243.0, true);
    const shelfAnchor = [{ x: 12, y: 20, z: 244 }];
    this.solidCube(13.23, 19.4, 243.8, .45, .08, 2.5, this.timber, shelfAnchor);
    const bottleGeometry=new CylinderGeometry(.07,.08,.46,10),neckGeometry=new CylinderGeometry(.037,.037,.16,10);this.geometries.add(bottleGeometry);this.geometries.add(neckGeometry);
    for (let bottle = 0; bottle < 6; bottle++) {
      this.box(new Vector3(13.23,19.67,242.85+bottle*.36),new Vector3(1,1,1),bottle%2?this.slate:this.terracotta,shelfAnchor,0,bottleGeometry);
      this.box(new Vector3(13.23,19.98,242.85+bottle*.36),new Vector3(1,1,1),this.iron,shelfAnchor,0,neckGeometry);
    }
    this.pendant(18.8, 241.6, 22.85);
  }

  private buildPeople(): void {
    const paths = [
      [98, 169.5, 118, 169.5, 16], [86, 170.6, 103, 170.6, 16], [132, 170.5, 159, 170.5, 16], [175, 170.4, 205, 170.4, 16],
      [124.5, 94, 124.5, 112, 16], [134.8, 94, 134.8, 112, 16], [89.7, 139, 89.7, 151, 16], [78.5, 138, 78.5, 151, 16],
      [124.6, 48, 124.6, 67, 16], [43.6, 48, 43.6, 67, 16], [171, 48, 171, 67, 16], [15, 28, 25, 28, 16],
      [11, 231.3, 28, 231.3, 15], [30, 232.9, 58, 232.9, 15], [142, 169.0, 156, 169.0, 16], [188, 169.3, 210, 169.3, 16],
    ];
    const coats = ['#8c6752', '#465d66', '#c0ad7d', '#54654f', '#8e4e42', '#3d5358'];
    const skins = ['#c99c78', '#a87657', '#d5b08f', '#795846'];
    paths.forEach(([ax, az, bx, bz, y], i) => this.people.push({ a: new Vector3(ax, y, az), b: new Vector3(bx, y, bz), progress: ((i * 7) % 17) / 17, direction: i % 2 ? 1 : -1, speed: .65 + (i % 4) * .12, phase: i * 1.7, color: coats[i % coats.length], skin: skins[i % skins.length] }));
    const n = this.people.length;
    const add = (name: string, geometry: BufferGeometry, material: MeshStandardMaterial, count: number) => {
      const mesh = new InstancedMesh(geometry, material, count); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      this.root.add(mesh); this.pedMeshes[name] = mesh;
    };
    add('coat', this.unitBox, this.material('#ffffff', .89), n * 3);
    add('head', this.unitBox, this.material('#ffffff', .89), n);
    add('hair', this.unitBox, this.material('#2f2926', .96), n);
    add('eyes', this.unitBox, this.rubber, n * 2);
    add('pants', this.unitBox, this.material('#303a3d', .94), n * 2);
    add('boots', this.unitBox, this.rubber, n * 2);
    const umbrellaGeometry = new CylinderGeometry(0, .75, .27, 8); this.geometries.add(umbrellaGeometry);
    add('umbrella', umbrellaGeometry, this.material('#ffffff', .75), n);
    const handleGeometry = new CylinderGeometry(.016, .016, 1, 5); this.geometries.add(handleGeometry);
    add('handle', handleGeometry, this.iron, n);
    for (let i = 0; i < n; i++) {
      for (let part = 0; part < 3; part++) this.pedMeshes.coat.setColorAt(i * 3 + part, new Color(this.people[i].color));
      this.pedMeshes.head.setColorAt(i, new Color(this.people[i].skin));
      this.pedMeshes.umbrella.setColorAt(i, new Color(i % 4 === 0 ? '#af7a51' : i % 4 === 1 ? '#3f655e' : i % 4 === 2 ? '#6a5360' : '#405661'));
    }
  }

  private pedestrianClear(x: number, z: number, foot: number): boolean {
    for (const dx of [-.26, .26]) for (const dz of [-.26, .26]) {
      const ix = Math.floor(x + dx), iz = Math.floor(z + dz);
      if (!this.world.getVoxel(ix, foot - 1, iz) || this.world.getVoxel(ix, foot, iz) || this.world.getVoxel(ix, foot + 1, iz)) return false;
    }
    return true;
  }

  private personPart(mesh: InstancedMesh, index: number, x: number, y: number, z: number, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, pitch = 0): void {
    this.dummyPosition.set(lx, ly, lz).applyAxisAngle(new Vector3(0, 1, 0), yaw).add(new Vector3(x, y, z));
    this.dummyQuaternion.setFromEuler(this.dummyEuler.set(pitch, yaw, 0, 'YXZ'));
    this.dummyMatrix.compose(this.dummyPosition, this.dummyQuaternion, this.dummyScale.set(sx, sy, sz)); mesh.setMatrixAt(index, this.dummyMatrix);
  }

  private updatePeople(dt: number, wetness: number): void {
    const m = this.pedMeshes;
    this.pedestrianObstacles.length = 0;
    this.people.forEach((person, i) => {
      const distance = person.a.distanceTo(person.b);
      let next = person.progress + person.direction * dt * person.speed / distance;
      if (next < 0 || next > 1) { person.direction *= -1; next = Math.max(0, Math.min(1, next)); }
      const point = person.a.clone().lerp(person.b, next);
      const meetsPlayer = this.playerPosition && Math.abs(this.playerPosition.y - point.y) < 1.8 && Math.hypot(point.x - this.playerPosition.x, point.z - this.playerPosition.z) < this.playerAvoidanceRadius;
      const visible = this.pedestrianClear(point.x, point.z, person.a.y) && !meetsPlayer;
      if (visible) person.progress = next;
      else person.direction *= -1;
      const p = person.a.clone().lerp(person.b, person.progress);
      if (!this.pedestrianClear(p.x, p.z, person.a.y)) {
        m.head.setMatrixAt(i, this.zero); m.hair.setMatrixAt(i, this.zero); m.umbrella.setMatrixAt(i, this.zero); m.handle.setMatrixAt(i, this.zero);
        for (let part = 0; part < 3; part++) m.coat.setMatrixAt(i * 3 + part, this.zero);
        for (let part = 0; part < 2; part++) { m.pants.setMatrixAt(i * 2 + part, this.zero); m.boots.setMatrixAt(i * 2 + part, this.zero); m.eyes.setMatrixAt(i * 2 + part, this.zero); }
        return;
      }
      const yaw = Math.atan2((person.b.x - person.a.x) * person.direction, (person.b.z - person.a.z) * person.direction);
      const swing = Math.sin(this.elapsed * person.speed * 6.8 + person.phase) * .35;
      const bob = Math.abs(Math.sin(this.elapsed * person.speed * 6.8 + person.phase)) * .028;
      this.pedestrianObstacles.push({ minX: p.x - .4, minY: p.y, minZ: p.z - .4, maxX: p.x + .4, maxY: p.y + 1.73, maxZ: p.z + .4 });
      this.personPart(m.coat, i * 3, p.x, p.y + bob, p.z, yaw, 0, 1.02, 0, .43, .62, .28);
      this.personPart(m.head, i, p.x, p.y + bob, p.z, yaw, 0, 1.52, .02, .26, .3, .26);
      this.personPart(m.hair, i, p.x, p.y + bob, p.z, yaw, 0, 1.655, .005, .28, .08, .27);
      for (const side of [-1, 1]) {
        const part = side < 0 ? 0 : 1;
        this.personPart(m.coat, i * 3 + part + 1, p.x, p.y + bob, p.z, yaw, side * .28, 1.0, side * swing * .17, .12, .53, .15, side * swing);
        this.personPart(m.pants, i * 2 + part, p.x, p.y, p.z, yaw, side * .12, .41, -side * swing * .17, .15, .64, .18, -side * swing);
        this.personPart(m.boots, i * 2 + part, p.x, p.y, p.z, yaw, side * .12, .09, -side * swing * .32 + .045, .17, .17, .29);
        this.personPart(m.eyes, i * 2 + part, p.x, p.y + bob, p.z, yaw, side * .064, 1.55, .157, .029, .028, .015);
      }
      this.personPart(m.umbrella, i, p.x, p.y, p.z, yaw, .12, 2.12, .06, 1, 1, 1);
      this.personPart(m.handle, i, p.x, p.y, p.z, yaw, .12, 1.61, .06, 1, .88, 1);
    });
    for (const mesh of Object.values(m)) mesh.instanceMatrix.needsUpdate = true;
    m.umbrella.visible = m.handle.visible = wetness > .18;
  }
}
