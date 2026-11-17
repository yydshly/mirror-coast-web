import RAPIER from '@dimforge/rapier3d-compat';
import { Mesh, MeshStandardMaterial, Scene } from 'three';
import type { BufferGeometry } from 'three';
import type { MeshResult } from '../world/mesher';
import { CHUNK_SIZE } from '../world/voxel';
import { createFragmentGeometry } from './fragment-geometry';
import { MAX_ACTIVE_FRAGMENTS, MAX_SAVED_FRAGMENTS, MAX_SAVED_FRAGMENT_VOXELS } from './types';
import type { FragmentVoxel, RubbleFragment, Vec3 } from './types';
import { orientedBoxBounds,orientedCollisionBounds,obstaclesIntersect, type SceneObstacle } from '../input/scene-collisions';
import {CAR_MIRRORS,CAR_ROOF_BOXES,CAR_CLEARANCE_BOXES,CAR_CONTACT_BOXES} from '../vehicles/car-collision';
import {createMeshInput,meshChunk} from '../world/mesher';
import type {VoxelWorld} from '../world/voxel';
import {Matrix4,Quaternion,Vector3} from 'three';
import type {Quat} from './types';
import {HELICOPTER_COLLISION_PARTS} from '../vehicles/helicopter-collision';
import {carveFragment,fragmentBoxes,fragmentCell,raycastFragment,type FragmentBox,type FragmentHit} from './fragment-edit';
import {trafficMass,boxInertia,type TrafficKind} from '../vehicles/traffic-physics';

export type TrafficBodyState={id:number;position:Vec3;rotation:Quat;linearVelocity:Vec3;angularVelocity:Vec3};
type ActorEntry={body:RAPIER.RigidBody;collider:RAPIER.Collider;colliders:RAPIER.Collider[];half:Vec3;trafficId?:number;kind?:TrafficKind;dynamic?:boolean;restoreFrames?:number;velocity:Vec3;previousPosition:Vec3;previousRotation:Quat};

type PhysicsCallbacks = {
  onStateChange: (fragments: RubbleFragment[]) => void;
  onImpact?: (position: Vec3, strength: number) => void;
};

type FragmentEntry = {
  source: RubbleFragment;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  colliders:RAPIER.Collider[];
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  age: number;
  stableTime: number;
  previousVerticalVelocity: number;
  lastImpact: number;
  walkBounds: SceneObstacle[];
  boxes:FragmentBox[];
  cells:Set<number>;
  precise:boolean;
};

const STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const SNAPSHOT_INTERVAL = 0.75;
let initialize: Promise<void> | undefined;

export type ManagedVehicle = {
  body: RAPIER.RigidBody;
  readonly walkObstacles?:readonly SceneObstacle[];
  setActive: (active: boolean) => void;
  hasContact: () => boolean;
  cameraDistance: (origin: Vec3, direction: Vec3, distance: number) => number;
  dispose: () => void;
};

export type ManagedGroundVehicle = ManagedVehicle & {
  canOccupy: (position: Vec3, rotation: { x: number; y: number; z: number; w: number }) => boolean;
  readonly dynamic:boolean;
  setDynamic:(active:boolean,velocity?:Vec3)=>void;
  promoteImpact:(position:Vec3,rotation:Quat,velocity:Vec3)=>Vec3;
  syncProps:(obstacles:readonly SceneObstacle[])=>void;
  setWheelSteering:(angle:number)=>void;
};

export type ManagedAircraft=ManagedVehicle & {
  syncProps:(obstacles:readonly SceneObstacle[],extraReach?:number)=>void;
  clearAt:(position:Vec3,rotation:Quat)=>boolean;
  readonly sceneryCount:number;
};

type VehicleEntry = { body: RAPIER.RigidBody; colliders: RAPIER.Collider[]; active: boolean; beforeStep: (dt: number) => void; walkBounds: SceneObstacle[]; kind?: 'car' };

function copyFragment(source: RubbleFragment): RubbleFragment {
  return {
    ...source,
    size: { ...source.size },
    voxels: source.voxels.map(voxel => [...voxel] as FragmentVoxel),
    position: { ...source.position },
    rotation: { ...source.rotation },
    ...(source.linearVelocity ? { linearVelocity: { ...source.linearVelocity } } : {}),
    ...(source.angularVelocity ? { angularVelocity: { ...source.angularVelocity } } : {}),
  };
}

function magnitude(vector: Vec3): number { return Math.hypot(vector.x, vector.y, vector.z); }

function validateFragment(fragment: RubbleFragment): void {
  if (!fragment.id || !fragment.buildingId || fragment.id.length > 200 || fragment.buildingId.length > 200 || !fragment.voxels.length) {
    throw new Error('碎块标识或几何数据无效。');
  }
  const sizes = [fragment.size.x, fragment.size.y, fragment.size.z];
  if (!sizes.every(value => Number.isInteger(value) && value > 0 && value <= 256)) throw new Error('碎块尺寸无效。');
  const numeric = [
    ...Object.values(fragment.position), ...Object.values(fragment.rotation),
    ...Object.values(fragment.linearVelocity ?? {}), ...Object.values(fragment.angularVelocity ?? {}),
  ];
  if (!numeric.every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000) ||
      Math.hypot(fragment.rotation.x, fragment.rotation.y, fragment.rotation.z, fragment.rotation.w) < 0.001 ||
      !['falling', 'settled'].includes(fragment.state)) throw new Error('碎块姿态无效。');
  const occupied = new Set<number>();
  for (const [x, y, z, material] of fragment.voxels) {
    if (![x, y, z].every((value, axis) => Number.isInteger(value) && value >= 0 && value < sizes[axis]) ||
        !Number.isInteger(material) || material < 1 || material > 255) throw new Error('碎块体素无效。');
    const key = x + 256 * (z + 256 * y);
    if (occupied.has(key)) throw new Error('碎块包含重复体素。');
    occupied.add(key);
  }
}

/** Bounded rigid-body simulation; voxel data remain authoritative for static buildings. */
export class CollapsePhysics {
  private readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private readonly events = new RAPIER.EventQueue(true);
  private readonly fragments = new Map<string, FragmentEntry>();
  private walkObstacleCache: SceneObstacle[] = [];
  private walkObstaclesDirty = true;
  private readonly colliderOwners = new Map<number, FragmentEntry>();
  private readonly chunks = new Map<string, { collider: RAPIER.Collider | null; revision: number }>();
  private readonly vehicles = new Set<VehicleEntry>();
  private readonly actors: ActorEntry[] = [];
  private decorationBodies=new Set<RAPIER.RigidBody>();
  private supportWake=new Set<string>();
  private restoredTraffic=new Map<number,TrafficBodyState>();
  private accumulator = 0;
  private snapshotClock = 0;
  private elapsed = 0;
  private disposed = false;
  private terrainPending=false;

  /** Fraction between accepted fixed poses; visual sampling never changes collisions. */
  get interpolationAlpha(): number { return Math.max(0, Math.min(1, this.accumulator / STEP)); }

  private constructor(private scene: Scene, private material: MeshStandardMaterial, private callbacks: PhysicsCallbacks) {
    this.world.timestep = STEP;
    // Only below the finite voxel world's floor. Off-map fragments cannot fall
    // forever and occupy the dynamic budget; visible excavated surfaces stay open.
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(2048, 0.5, 2048).setTranslation(128, -32.5, 128));
  }

  static async create(scene: Scene, material: MeshStandardMaterial, callbacks: PhysicsCallbacks): Promise<CollapsePhysics> {
    initialize ??= RAPIER.init();
    await initialize;
    return new CollapsePhysics(scene, material, callbacks);
  }

  get activeCount(): number {
    let count = 0;
    for (const fragment of this.fragments.values()) if (fragment.source.state === 'falling') count++;
    return count;
  }

  get settledCount(): number { return this.fragments.size - this.activeCount; }
  get totalCount(): number { return this.fragments.size; }

  /** Conservative current-pose bounds without copying saved voxel payloads. */
  get walkObstacles(): readonly SceneObstacle[] {
    if (this.disposed) return [];
    if (this.walkObstaclesDirty) {
      this.walkObstacleCache = [...this.fragments.values()].flatMap(entry => entry.walkBounds);
      for (const vehicle of this.vehicles) this.walkObstacleCache.push(...vehicle.walkBounds);
      for(const bounds of this.walkObstacleCache)bounds.physicsManaged=true;
      this.walkObstaclesDirty = false;
    }
    for (const vehicle of this.vehicles) this.updateVehicleWalkBounds(vehicle);
    return this.walkObstacleCache;
  }

  createDecoration(position:Vec3,boxes:Array<{center:Vec3;half:Vec3;rotation:Quat}>,state?:{rotation:Quat;linearVelocity:Vec3;angularVelocity:Vec3;sleeping?:boolean}){
    const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x,position.y,position.z).setRotation(state?.rotation??{x:0,y:0,z:0,w:1}).setLinearDamping(.22).setAngularDamping(.8).setCanSleep(true).setCcdEnabled(true));
    for(const b of boxes)this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.half.x,b.half.y,b.half.z).setTranslation(b.center.x,b.center.y,b.center.z).setRotation(b.rotation).setFriction(.85).setDensity(.2).setRestitution(.03),body);
    body.setLinvel(state?.linearVelocity??{x:0,y:0,z:0},true);body.setAngvel(state?.angularVelocity??{x:.04,y:0,z:.03},true);if(state?.sleeping)body.sleep();this.decorationBodies.add(body);return{body,boxes};
  }
  invalidateSupports(keys:Iterable<string>):void{
    const dirty=new Set(keys);for(const e of this.fragments.values())if(e.source.state==='settled'&&e.walkBounds.some(b=>{for(let x=(b.minX-1)>>5;x<=((b.maxX+1)>>5);x++)for(let y=(b.minY-1)>>5;y<=((b.maxY+1)>>5);y++)for(let z=(b.minZ-1)>>5;z<=((b.maxZ+1)>>5);z++)if(dirty.has(`${x},${y},${z}`))return true;return false;}))this.supportWake.add(e.source.id);
    for(const body of this.decorationBodies){const p=body.translation();let near=false;for(let x=(p.x-12)>>5;x<=((p.x+12)>>5);x++)for(let y=(p.y-12)>>5;y<=((p.y+12)>>5);y++)for(let z=(p.z-12)>>5;z<=((p.z+12)>>5);z++)if(dirty.has(`${x},${y},${z}`))near=true;if(near)body.wakeUp();}
  }
  wakeUnsupported(accepted:boolean):void{
    if(!accepted)return;const changed:RubbleFragment[]=[];const started=performance.now();
    for(const id of this.supportWake){if(this.activeCount>=MAX_ACTIVE_FRAGMENTS||changed.length&&performance.now()-started>2.5)break;const e=this.fragments.get(id);this.supportWake.delete(id);if(!e||e.source.state!=='settled')continue;e.source.state='falling';e.age=e.stableTime=0;e.body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);this.buildFragmentColliders(e);changed.push(this.snapshotEntry(e));}
    if(changed.length)this.callbacks.onStateChange(changed);
  }

  /** The helicopter uses the same accepted surfaces and debris as destruction. */
  createVehicle(position: Vec3, beforeStep: (dt: number) => void): ManagedAircraft {
    this.assertOpen();
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z).setCanSleep(false)
      .setCcdEnabled(true).setAdditionalMass(520));
    body.setEnabledRotations(false, false, false, false);
    const shapes=HELICOPTER_COLLISION_PARTS.map(p=>p.rotor?new RAPIER.Cylinder(p.half.y,p.half.x):new RAPIER.Cuboid(p.half.x,p.half.y,p.half.z));
    const colliders=HELICOPTER_COLLISION_PARTS.map(p=>this.world.createCollider(
      (p.rotor?RAPIER.ColliderDesc.cylinder(p.half.y,p.half.x):RAPIER.ColliderDesc.cuboid(p.half.x,p.half.y,p.half.z))
      .setTranslation(p.center.x,p.center.y,p.center.z).setDensity(p.rotor?.01:.1).setFriction(p.rotor?.15:.75).setRestitution(0),body));
    const entry: VehicleEntry = { body, colliders, beforeStep, active: false, walkBounds: HELICOPTER_COLLISION_PARTS.map(() => ({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 })) };
    this.vehicles.add(entry);
    this.updateVehicleWalkBounds(entry); this.walkObstaclesDirty = true;
    let removed = false;
    const props=new Map<SceneObstacle,{collider:RAPIER.Collider;signature:string}>();
    return {
      body,
      walkObstacles:entry.walkBounds,
      get sceneryCount(){return props.size;},
      syncProps:(obstacles,extraReach=0)=>{
        if(removed||this.disposed)return;
        const at=body.translation(),retained=new Set<SceneObstacle>(),reach=9+extraReach+Math.min(5,magnitude(body.linvel())*.15);
        for(const b of obstacles){
          if(b.physicsManaged||b.trafficId!==undefined||b.maxY<=b.minY||b.maxX<=b.minX||b.maxZ<=b.minZ||b.maxX<at.x-reach||b.minX>at.x+reach||b.maxZ<at.z-reach||b.minZ>at.z+reach||b.maxY<at.y-7-extraReach||b.minY>at.y+7+extraReach)continue;
          retained.add(b);
          const signature=[b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ,...b.obb?.rotation.elements??[]].join(',');
          const existing=props.get(b);if(existing?.signature===signature)continue;
          if(existing)this.world.removeCollider(existing.collider,false);
          const center=b.hull?{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:(b.minZ+b.maxZ)/2}:b.obb?.center??{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:(b.minZ+b.maxZ)/2};
          const half=b.obb?.halfSize??{x:(b.maxX-b.minX)/2,y:(b.maxY-b.minY)/2,z:(b.maxZ-b.minZ)/2};
          const desc=(b.hull?RAPIER.ColliderDesc.convexHull(b.hull):null)??RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z);
          desc.setTranslation(center.x,center.y,center.z).setFriction(.5).setRestitution(0);
          if(!b.hull&&b.obb)desc.setRotation(new Quaternion().setFromRotationMatrix(new Matrix4().setFromMatrix3(b.obb.rotation)));
          props.set(b,{collider:this.world.createCollider(desc),signature});
        }
        for(const [b,p]of props)if(!retained.has(b)){this.world.removeCollider(p.collider,false);props.delete(b);}
        this.world.propagateModifiedBodyPositionsToColliders();
      },
      clearAt:(point,rotation)=>{
        if(removed||this.disposed)return false;
        const q=new Quaternion().copy(rotation);let clear=true;
        const terrain:RAPIER.Collider[]=[];
        for(let z=Math.floor((point.z-8)/32);z<=Math.floor((point.z+8)/32);z++)for(let x=Math.floor((point.x-8)/32);x<=Math.floor((point.x+8)/32);x++)for(let y=Math.max(0,Math.floor((point.y-8)/32));y<=Math.min(2,Math.floor((point.y+8)/32));y++){const c=this.chunks.get(`${x},${y},${z}`)?.collider;if(c)terrain.push(c);}
        for(let i=0;i<shapes.length&&clear;i++){
          const center=new Vector3().copy(HELICOPTER_COLLISION_PARTS[i].center).applyQuaternion(q).add(point),shape=shapes[i];
          const contact=(c:RAPIER.Collider)=>{const hit=c.contactShape(shape,center,rotation,0);if(hit&&hit.distance<-.025){clear=false;return false;}return true;};
          // Rapier's broad phase is refreshed by step(). Also query newly
          // installed scenery/terrain directly before the first step on load.
          const bounds=orientedBoxBounds(center,rotation,HELICOPTER_COLLISION_PARTS[i].half);
          for(const [b,p]of props)if(obstaclesIntersect(bounds,b)&&!contact(p.collider))break;
          if(clear)for(const c of terrain)if(!contact(c))break;
          if(clear)this.world.intersectionsWithShape(center,rotation,shape,contact,undefined,undefined,undefined,body);
        }
        return clear;
      },
      setActive: (active) => {
        if (removed || this.disposed) return;
        entry.active = active;
        body.setBodyType(active ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed, true);
        if (active) body.recomputeMassPropertiesFromColliders();
      },
      hasContact: () => !removed && !this.disposed && colliders.some(collider => this.hasSurfaceContact(collider)),
      cameraDistance: (origin, direction, distance) => {
        if (removed || this.disposed) return distance;
        const hit = this.world.castRay(new RAPIER.Ray(origin, direction), distance, false, undefined, undefined, undefined, body);
        return hit ? Math.max(.8, hit.timeOfImpact - .4) : distance;
      },
      dispose: () => {
        if (removed) return;
        removed = true;
        this.vehicles.delete(entry);
        this.walkObstaclesDirty = true;
        for(const p of props.values())if(!this.disposed)this.world.removeCollider(p.collider,false);
        props.clear();
        if (!this.disposed) this.world.removeRigidBody(body);
      },
    };
  }

  /** A terrain-controlled car is still a collidable member of this shared world. */
  createGroundVehicle(position: Vec3, beforeStep: (dt: number) => void): ManagedGroundVehicle {
    this.assertOpen();
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setCanSleep(false).setCcdEnabled(true));
    const shape = new RAPIER.Cuboid(.97, .8, 2.35);
    const colliders = CAR_CONTACT_BOXES.map((p,i)=>this.world.createCollider(RAPIER.ColliderDesc.cuboid(p.half.x,p.half.y,p.half.z).setTranslation(p.center.x,p.center.y,p.center.z).setMass(i?15:1000).setFriction(i?.45:.65).setRestitution(i?.08:.12),body));
    const tyres:Array<{collider:RAPIER.Collider;front:boolean}>=[];
    for(const x of [-.95,.95])for(const z of [-1.43,1.43]){const collider=this.world.createCollider(RAPIER.ColliderDesc.cylinder(.115,.39).setRotation({x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2}).setTranslation(x,-.46,z).setMass(22).setFriction(.85).setRestitution(.08),body);colliders.push(collider);tyres.push({collider,front:z<0});}
    for(const p of [...CAR_MIRRORS,...CAR_ROOF_BOXES])colliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(p.half.x,p.half.y,p.half.z).setTranslation(p.center.x,p.center.y,p.center.z).setMass(1).setFriction(.6).setRestitution(.08),body));
    for(const c of colliders)c.setMass(0);
    body.setAdditionalMassProperties(1250,{x:0,y:-.19,z:0},boxInertia(1250,{x:1.05,y:.65,z:2.3}),{x:0,y:0,z:0,w:1},false);
    body.setAdditionalSolverIterations(4);
    const entry: VehicleEntry = { body, colliders, beforeStep, active: false, kind: 'car', walkBounds: CAR_CLEARANCE_BOXES.map(()=>({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 })) };
    this.vehicles.add(entry); this.updateVehicleWalkBounds(entry); this.walkObstaclesDirty = true;
    let removed = false;
    let dynamic=false,motorActive=false;const propColliders=new Map<SceneObstacle,{collider:RAPIER.Collider;signature:string}>();
    const mode=()=>{entry.active=motorActive||dynamic;body.setBodyType(dynamic?RAPIER.RigidBodyType.Dynamic:motorActive?RAPIER.RigidBodyType.KinematicPositionBased:RAPIER.RigidBodyType.Fixed,true);};
    return {
      body,
      get dynamic(){return dynamic;},
      setWheelSteering:angle=>{if(removed||this.disposed)return;const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),angle).multiply(new Quaternion(0,0,Math.SQRT1_2,Math.SQRT1_2));for(const tyre of tyres)if(tyre.front)tyre.collider.setRotationWrtParent(q);},
      setActive: active => {
        if (removed || this.disposed) return;
        motorActive=active;mode();
      },
      setDynamic:(active,velocity)=>{
        if(removed||this.disposed||active===dynamic)return;
        if(!active){for(const {collider}of propColliders.values())this.world.removeCollider(collider,false);propColliders.clear();}
        dynamic=active;mode();body.recomputeMassPropertiesFromColliders();body.setLinearDamping(.12);body.setAngularDamping(.65);
        if(active&&velocity)body.setLinvel(velocity,true);
      },
      promoteImpact:(point,rotation,velocity)=>{
        const accepted={...velocity};
        const struck:ActorEntry[]=[];
        this.world.intersectionsWithShape(point,rotation,shape,collider=>{
          const actor=this.actors.find(a=>a?.collider.handle===collider.handle);
          if(actor?.trafficId!==undefined)struck.push(actor);
          return true;
        },undefined,undefined,undefined,body,c=>c.parent()!==null);
        // Rapier queries borrow the body set. Change body types only after the
        // query has returned, never from its callback.
        // Switch authority before contact. Rapier computes one impulse at the
        // real contact point; no second centre-to-centre shove is added here.
        for(const actor of struck)if(!actor.dynamic)this.activateTrafficActor(actor,actor.velocity);
        return accepted;
      },
      syncProps:obstacles=>{
        const at=body.translation(),verticalReach=4+Math.abs(body.linvel().y)*.25,retained=new Set<SceneObstacle>();
        // Non-standable describes feet, not whether a bumper can hit the object.
        // Only skip shapes that already have a collider in this physics world.
        for(const b of obstacles){if(b.physicsManaged||b.trafficId!==undefined||b.maxY<=b.minY||b.maxX<=b.minX||b.maxZ<=b.minZ)continue;
          if(b.maxX<at.x-12||b.minX>at.x+12||b.maxZ<at.z-12||b.minZ>at.z+12||b.maxY<at.y-verticalReach||b.minY>at.y+verticalReach)continue;
          // Retain unchanged road contacts. Recreating them every 0.2s broke
          // the continuous contact needed to finish recovery on a slope.
          retained.add(b);
          const signature=[b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ,...b.surface??[],...b.obb?.rotation.elements??[],...b.obb?[b.obb.center.x,b.obb.center.y,b.obb.center.z,b.obb.halfSize.x,b.obb.halfSize.y,b.obb.halfSize.z]:[]].join(',');
          const previous=propColliders.get(b);if(previous?.signature===signature)continue;
          if(previous)this.world.removeCollider(previous.collider,false);
          if(b.surface){const h=b.surface;propColliders.set(b,{collider:this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array([b.minX,h[0],b.minZ,b.maxX,h[1],b.minZ,b.minX,h[2],b.maxZ,b.maxX,h[3],b.maxZ]),new Uint32Array([0,2,1,1,2,3])).setFriction(.85).setRestitution(.02)),signature});continue;}
          const center=b.obb?.center??{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:(b.minZ+b.maxZ)/2};
          const half=b.obb?.halfSize??{x:(b.maxX-b.minX)/2,y:(b.maxY-b.minY)/2,z:(b.maxZ-b.minZ)/2};
          const desc=RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z).setFriction(.6).setRestitution(.12);
          if(b.obb)desc.setRotation(new Quaternion().setFromRotationMatrix(new Matrix4().setFromMatrix3(b.obb.rotation)));
          propColliders.set(b,{collider:this.world.createCollider(desc),signature});
        }
        for(const [b,p]of propColliders)if(!retained.has(b)){this.world.removeCollider(p.collider,false);propColliders.delete(b);}
      },
      canOccupy: (point, rotation) => {
        if (removed || this.disposed) return false;
        let clear = true;
        // Chunk terrain is queried from authoritative voxels by the motor. This
        // query adds current falling/settled debris and other managed vehicles.
        this.world.intersectionsWithShape(point, rotation, shape, () => { clear = false; return false; }, undefined, undefined, undefined, body, collider => collider.parent() !== null);
        if(clear)for(const p of CAR_MIRRORS){const center=new Vector3().copy(p.center).applyQuaternion(new Quaternion().copy(rotation)).add(point);this.world.intersectionsWithShape(center,rotation,new RAPIER.Cuboid(p.half.x,p.half.y,p.half.z),()=>{clear=false;return false;},undefined,undefined,undefined,body,c=>c.parent()!==null);if(!clear)break;}
        return clear;
      },
      hasContact: () => !removed && !this.disposed && colliders.some(collider => this.hasSurfaceContact(collider)),
      cameraDistance: (origin, direction, distance) => {
        if (removed || this.disposed) return distance;
        const hit = this.world.castRay(new RAPIER.Ray(origin, direction), distance, false, undefined, undefined, undefined, body);
        return hit ? Math.max(.6, hit.timeOfImpact - .4) : distance;
      },
      dispose: () => {
        if (removed) return;
        removed = true; this.vehicles.delete(entry); this.walkObstaclesDirty = true;
        for(const {collider}of propColliders.values())this.world.removeCollider(collider,false);
        propColliders.clear();
        if (!this.disposed) this.world.removeRigidBody(body);
      },
    };
  }

  /** Authority-driven street actors share collisions without joining the rubble budget. */
  syncActorObstacles(obstacles:readonly SceneObstacle[],dt=1/60):void {
    if(this.disposed)return;
    obstacles.forEach((bounds,index)=>{
      bounds.physicsManaged=true;
      const valid=bounds.maxY>bounds.minY && bounds.maxX>bounds.minX && bounds.maxZ>bounds.minZ && [bounds.minX,bounds.maxX,bounds.minY,bounds.maxY,bounds.minZ,bounds.maxZ].every(Number.isFinite);
      let entry=this.actors[index];
      if(entry?.dynamic)return;
      if(!valid){entry?.body.setEnabled(false);return;}
      const half=bounds.trafficHalfSize??{x:Math.max(.05,Math.ceil((bounds.maxX-bounds.minX)*10)/20),y:Math.max(.05,Math.ceil((bounds.maxY-bounds.minY)*10)/20),z:Math.max(.05,Math.ceil((bounds.maxZ-bounds.minZ)*10)/20)};
      const position={x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,z:(bounds.minZ+bounds.maxZ)/2};
      if(!entry){
        const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x,position.y,position.z));
        const collider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setFriction(.8).setRestitution(0),body);
        entry={body,collider,colliders:[collider],half,trafficId:bounds.trafficId,kind:bounds.trafficKind,velocity:{x:0,y:0,z:0},previousPosition:{...position},previousRotation:{x:0,y:0,z:0,w:1}};this.actors[index]=entry;
        const saved=bounds.trafficId===undefined?undefined:this.restoredTraffic.get(bounds.trafficId);
        if(saved){body.setTranslation(saved.position,false);body.setRotation(saved.rotation,false);this.activateTrafficActor(entry,saved.linearVelocity);entry.restoreFrames=120;entry.body.setAngvel(saved.angularVelocity,true);entry.previousPosition={...saved.position};entry.previousRotation={...saved.rotation};this.restoredTraffic.delete(saved.id);return;}
      }
      const old=entry.body.translation();entry.velocity=bounds.trafficVelocity??{x:Math.max(-12,Math.min(12,(position.x-old.x)/Math.max(.008,dt))),y:0,z:Math.max(-12,Math.min(12,(position.z-old.z)/Math.max(.008,dt)))};
      entry.body.setEnabled(true);
      if(entry.half.x!==half.x||entry.half.y!==half.y||entry.half.z!==half.z){entry.collider.setShape(new RAPIER.Cuboid(half.x,half.y,half.z));entry.half=half;}
      // Navigation owns these accepted poses. They participate in collisions but
      // never join the active rubble budget or the actor's own obstacle provider.
      entry.body.setTranslation(position,true);entry.body.setNextKinematicTranslation(position);
      if(bounds.trafficHeading!==undefined){const rotation={x:0,y:Math.sin(bounds.trafficHeading/2),z:0,w:Math.cos(bounds.trafficHeading/2)};entry.body.setRotation(rotation,true);entry.body.setNextKinematicRotation(rotation);}
    });
    for(let i=obstacles.length;i<this.actors.length;i++)if(this.actors[i])this.world.removeRigidBody(this.actors[i].body);
    this.actors.length=obstacles.length;
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  private activateTrafficActor(actor:ActorEntry,velocity:Vec3):void{
    const p=actor.body.translation(),q=actor.body.rotation();this.world.removeRigidBody(actor.body);
    const profile=trafficMass(actor.half,actor.kind),body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setRotation(q).setLinearDamping(.18).setAngularDamping(.9).setCcdEnabled(true).setAdditionalSolverIterations(4));
    actor.body=body;
    actor.previousPosition={...p};actor.previousRotation={...q};
    actor.collider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(actor.half.x*.99,Math.max(.2,actor.half.y-.1575),actor.half.z*.99).setTranslation(0,.1125,0).setMass(0).setFriction(.55).setRestitution(.05).setContactSkin(.006),body);
    actor.colliders=[actor.collider];
    for(const x of [-actor.half.x*.96,actor.half.x*.96])for(const z of [-actor.half.z*.64,actor.half.z*.64])actor.colliders.push(this.world.createCollider(RAPIER.ColliderDesc.cylinder(.11,.31).setRotation({x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2}).setTranslation(x,-actor.half.y+.31,z).setMass(0).setFriction(.35).setRestitution(.03),body));
    body.setAdditionalMassProperties(profile.mass,{x:0,y:profile.comHeight-actor.half.y,z:0},boxInertia(profile.mass,actor.half),{x:0,y:0,z:0,w:1},true);
    body.recomputeMassPropertiesFromColliders();body.setLinvel(velocity,true);actor.dynamic=true;
  }

  /** A car already sliding, or traffic struck by another crashed car, must not
   * hit an infinite-mass navigation body on the following contact. */
  private promoteApproachingTraffic(dt:number):void{
    const moving=[...[...this.vehicles].filter(v=>v.kind==='car'&&v.body.isDynamic()).map(v=>({body:v.body,colliders:v.colliders})),...this.actors.filter(a=>a?.dynamic)];
    const pending=new Set<ActorEntry>();
    for(const actor of this.actors){
      if(!actor||actor.dynamic||actor.trafficId===undefined||!actor.body.isEnabled())continue;
      const at=actor.body.translation();
      for(const source of moving){
        const p=source.body.translation(),v=source.body.linvel(),relative={x:v.x-actor.velocity.x,y:v.y,z:v.z-actor.velocity.z},margin=.045+Math.min(1,magnitude(relative)*dt);
        if(Math.hypot(p.x-at.x,p.z-at.z)>Math.hypot(actor.half.x,actor.half.z)+4+margin||Math.abs(p.y-at.y)>actor.half.y+2)continue;
        if(source.colliders.some(c=>{const hit=c.contactCollider(actor.collider,margin);return hit!==null&&(hit.distance<.015||relative.x*(at.x-p.x)+relative.z*(at.z-p.z)>0);})){pending.add(actor);break;}
      }
    }
    for(const actor of pending)this.activateTrafficActor(actor,actor.velocity);
  }

  /** Invalid old wrecks can have wheels embedded on both sides of another
   * body. Vertical contact normals then oppose one another. During load only,
   * ease this overlap sideways without righting wrecks or moving through walls. */
  private separateRestoredWrecks():void{
    const sources=[...[...this.vehicles].filter(v=>v.kind==='car'&&v.body.isDynamic()).map(v=>({body:v.body,colliders:v.colliders,half:{x:1.1,y:.8,z:2.35}})),...this.actors.filter(a=>a?.dynamic)];
    const canShift=(source:{body:RAPIER.RigidBody;colliders:RAPIER.Collider[]},other:RAPIER.RigidBody,shift:Vec3)=>{
      let clear=true;
      for(const collider of source.colliders){const p=collider.translation(),candidate={x:p.x+shift.x,y:p.y,z:p.z+shift.z},q=collider.rotation();
        this.world.intersectionsWithShape(candidate,q,collider.shape,c=>{
          if(c.parent()?.handle===other.handle)return true;
          const proposed=c.contactShape(collider.shape,candidate,q,0),existing=c.contactCollider(collider,0);
          if(proposed&&proposed.distance<-.025&&proposed.distance<(existing?.distance??0)-.002){clear=false;return false;}return true;
        },undefined,undefined,undefined,source.body);if(!clear)break;
      }return clear;
    };
    for(const actor of this.actors){
      if(!actor?.dynamic||!actor.restoreFrames)continue;actor.restoreFrames--;
      for(const source of sources){
        if(source.body===actor.body||magnitude(source.body.linvel())>1.2||magnitude(actor.body.linvel())>1.2)continue;
        let depth=0;for(const c of source.colliders)for(const other of actor.colliders){const hit=c.contactCollider(other,0);if(hit)depth=Math.max(depth,-hit.distance);}
        if(depth<.035)continue;
        const a=source.body.translation(),b=actor.body.translation(),ab=orientedBoxBounds(a,source.body.rotation(),source.half),bb=orientedBoxBounds(b,actor.body.rotation(),actor.half);
        const overlapX=Math.min(ab.maxX,bb.maxX)-Math.max(ab.minX,bb.minX),overlapZ=Math.min(ab.maxZ,bb.maxZ)-Math.max(ab.minZ,bb.minZ),axis=overlapX<overlapZ?'x':'z',direction=Math.sign(a[axis]-b[axis])||1;
        const amount=Math.min(.04,depth-.015),share=actor.body.mass()/(source.body.mass()+actor.body.mass()),first={x:0,y:0,z:0},second={x:0,y:0,z:0};first[axis]=direction*amount*share;second[axis]=-direction*amount*(1-share);
        if(!canShift(source,actor.body,first)||!canShift(actor,source.body,second))continue;
        source.body.setTranslation({x:a.x+first.x,y:a.y,z:a.z+first.z},true);actor.body.setTranslation({x:b.x+second.x,y:b.y,z:b.z+second.z},true);this.world.propagateModifiedBodyPositionsToColliders();
      }
    }
  }

  trafficSnapshot(interpolate=false):TrafficBodyState[]{
    return this.actors.filter(a=>a?.dynamic&&a.trafficId!==undefined).map(a=>{
      const position={...a.body.translation()},rotation={...a.body.rotation()};
      if(interpolate){const p=new Vector3().copy(a.previousPosition).lerp(position,this.interpolationAlpha),q=new Quaternion().copy(a.previousRotation).slerp(new Quaternion().copy(rotation),this.interpolationAlpha);Object.assign(position,p);Object.assign(rotation,{x:q.x,y:q.y,z:q.z,w:q.w});}
      return{id:a.trafficId!,position,rotation,linearVelocity:{...a.body.linvel()},angularVelocity:{...a.body.angvel()}};
    });
  }
  restoreTraffic(states:readonly TrafficBodyState[]):void{this.restoredTraffic=new Map(states.map(s=>[s.id,s]));}
  /** Explicit manual clearance, called outside step/query callbacks. Keep actor
   * slots stable: pedestrians and parked cars share this indexed collection. */
  clearTraffic(ids:ReadonlySet<number>):void{
    if(this.disposed)return;
    for(const id of ids)this.restoredTraffic.delete(id);
    for(let i=0;i<this.actors.length;i++){
      const actor=this.actors[i];
      if(!actor?.dynamic||actor.trafficId===undefined||!ids.has(actor.trafficId))continue;
      this.world.removeRigidBody(actor.body);delete this.actors[i];
    }
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  ensureVehicleTerrain(world:VoxelWorld,position:Vec3,reach=8):void{
    for(let cz=Math.floor((position.z-reach)/32);cz<=Math.floor((position.z+reach)/32);cz++)for(let cx=Math.floor((position.x-reach)/32);cx<=Math.floor((position.x+reach)/32);cx++)for(let cy=Math.max(0,Math.floor((position.y-reach-1)/32));cy<=Math.min(2,Math.floor((position.y+reach-4)/32));cy++){
      const key=`${cx},${cy},${cz}`,chunk=world.chunks.get(key);if(!chunk||this.chunks.get(key)?.revision===chunk.revision)continue;
      const input=createMeshInput(world,key);if(input)this.syncChunk(meshChunk(input));
    }
  }

  /** Replacement follows the same accepted chunk revision as the visible mesh. */
  syncChunk(result: MeshResult): void {
    if (this.disposed) return;
    const previous = this.chunks.get(result.key);
    if (previous && result.revision <= previous.revision) return;
    if (previous?.collider) this.world.removeCollider(previous.collider, true);
    let collider: RAPIER.Collider | null = null;
    if (result.indices.length) {
      const description = RAPIER.ColliderDesc.trimesh(result.positions, result.indices)
        .setTranslation(result.cx * CHUNK_SIZE, result.cy * CHUNK_SIZE, result.cz * CHUNK_SIZE)
        .setFriction(0.85).setRestitution(0.02);
      collider = this.world.createCollider(description);
    }
    this.chunks.set(result.key, { collider, revision: result.revision });
    this.terrainPending=true;
  }

  /** Build Rapier's broad phase as static streaming arrives, instead of leaving
   * the whole city's first simulation step to the first explosion. Never advance
   * an active/saved dynamic body while its ground is still loading. */
  prepareStaticTerrain():boolean{
    if(!this.terrainPending||this.disposed||this.activeCount||[...this.vehicles].some(v=>v.active)||this.actors.some(a=>a?.dynamic)||[...this.decorationBodies].some(b=>!b.isSleeping()))return false;
    this.world.step(this.events);this.events.drainCollisionEvents(()=>{});this.terrainPending=false;return true;
  }

  /** Entire batch is checked before adding or replacing any mesh/body. */
  addFragments(fragments: RubbleFragment[]): void {
    this.assertOpen();
    this.validateBatch(fragments, false);
    for (const fragment of fragments) {
      const previous = this.fragments.get(fragment.id);
      if (previous) this.removeFragment(previous);
      this.insertFragment(fragment);
    }
  }

  /** Restore the complete saved rubble collection without changing its poses. */
  restore(fragments: RubbleFragment[]): void {
    this.assertOpen();
    this.validateBatch(fragments, true);
    for (const entry of this.fragments.values()) this.removeFragment(entry);
    for (const fragment of fragments) this.insertFragment(fragment);
  }

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0 || (this.activeCount === 0 && ![...this.vehicles].some(vehicle => vehicle.active)&&!this.actors.some(a=>a?.dynamic)&&![...this.decorationBodies].some(b=>!b.isSleeping()))) return;
    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_SUBSTEPS);
    const changed = new Set<string>();
    let substeps = 0;
    while (this.accumulator >= STEP && substeps++ < MAX_SUBSTEPS) {
      for(const actor of this.actors)if(actor?.dynamic){actor.previousPosition={...actor.body.translation()};actor.previousRotation={...actor.body.rotation()};}
      for (const vehicle of this.vehicles) if (vehicle.active) vehicle.beforeStep(STEP);
      this.promoteApproachingTraffic(STEP);
      for (const entry of this.fragments.values()) {
        if (entry.source.state === 'falling') entry.previousVerticalVelocity = entry.body.linvel().y;
      }
      this.world.step(this.events);
      this.terrainPending=false;
      this.separateRestoredWrecks();
      this.elapsed += STEP;
      this.snapshotClock += STEP;
      this.accumulator -= STEP;
      this.events.drainCollisionEvents((first, second, started) => {
        if (!started) return;
        for (const handle of [first, second]) {
          const entry = this.colliderOwners.get(handle);
          if (!entry || entry.source.state !== 'falling' || this.elapsed - entry.lastImpact < 0.6) continue;
          const speed = Math.abs(entry.previousVerticalVelocity);
          if (speed < 1.8) continue;
          entry.lastImpact = this.elapsed;
          const position = entry.body.translation();
          this.callbacks.onImpact?.({ x: position.x, y: position.y - entry.source.size.y / 2, z: position.z }, Math.min(1, speed / 10));
        }
      });

      for (const entry of this.fragments.values()) {
        if (entry.source.state !== 'falling') continue;
        entry.age += STEP;
        const speed = magnitude(entry.body.linvel());
        const spin = magnitude(entry.body.angvel());
        const onSurface = entry.colliders.some(c=>this.hasSurfaceContact(c));
        const quiet = speed < 0.3 && spin < 0.3;
        const oldAndSlow = entry.age > 12 && speed < 0.7 && spin < 0.7;
        // Contact is mandatory: a slowly falling body at its apex must not freeze.
        entry.stableTime = onSurface && (quiet || oldAndSlow || entry.body.isSleeping()) ? entry.stableTime + STEP : 0;
        if (entry.stableTime >= 0.75) {
          entry.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
          entry.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
          entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
          entry.source.state = 'settled';
          if(!entry.precise)this.buildFragmentColliders(entry);
          changed.add(entry.source.id);
        }
      }
    }

    for (const entry of this.fragments.values()) {
      if(entry.source.state==='settled'&&!changed.has(entry.source.id))continue;
      const position = entry.body.translation();
      const rotation = entry.body.rotation();
      entry.mesh.position.set(position.x, position.y, position.z);
      entry.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      const q=new Quaternion().copy(rotation);
      entry.boxes.forEach((b,i)=>orientedCollisionBounds(new Vector3().copy(b.center).applyQuaternion(q).add(position),rotation,b.half,entry.walkBounds[i]));
    }
    if (this.snapshotClock >= SNAPSHOT_INTERVAL) {
      this.snapshotClock %= SNAPSHOT_INTERVAL;
      for (const entry of this.fragments.values()) if (entry.source.state === 'falling') changed.add(entry.source.id);
    }
    if (changed.size) this.callbacks.onStateChange([...changed].map(id => this.snapshotEntry(this.fragments.get(id)!)));
  }

  snapshot(): RubbleFragment[] {
    if (this.disposed) return [];
    return [...this.fragments.values()].map(entry => this.snapshotEntry(entry));
  }

  raycastFragments(origin:Vec3,direction:Vec3,maxDistance=180):FragmentHit|null{
    let closest:FragmentHit|null=null;
    for(const entry of this.fragments.values()){
      const hit=raycastFragment({...entry.source,position:entry.body.translation(),rotation:entry.body.rotation()},origin,direction,closest?.distance??maxDistance,entry.cells);
      if(hit&&(!closest||hit.distance<closest.distance))closest=hit;
    }
    return closest;
  }
  planFragmentEdit(hit:FragmentHit,blast=false){
    const entry=this.fragments.get(hit.fragmentId);if(!entry)return null;
    const result=carveFragment(this.snapshotEntry(entry),hit,blast?3.2:0);
    this.validateBatch(result.fragments,false,new Set([entry.source.id]));
    return{...result,removeFragmentIds:[entry.source.id]};
  }
  fragmentCellPose(hit:FragmentHit){
    const e=this.fragments.get(hit.fragmentId);if(!e)return null;
    const rotation=e.body.rotation(),position=new Vector3(hit.x+.5-e.source.size.x/2,hit.y+.5-e.source.size.y/2,hit.z+.5-e.source.size.z/2).applyQuaternion(new Quaternion().copy(rotation)).add(e.body.translation());
    return{position,rotation};
  }
  applyFragmentEdit(change:{fragments:RubbleFragment[];removeFragmentIds:string[]}):void{
    this.validateBatch(change.fragments,false,new Set(change.removeFragmentIds));
    const dirty=new Set<string>();for(const id of change.removeFragmentIds){const entry=this.fragments.get(id);if(!entry)continue;for(const b of entry.walkBounds)for(let x=b.minX>>5;x<=b.maxX>>5;x++)for(let y=b.minY>>5;y<=b.maxY>>5;y++)for(let z=b.minZ>>5;z<=b.maxZ>>5;z++)dirty.add(`${x},${y},${z}`);this.removeFragment(entry);}
    for(const fragment of change.fragments)this.insertFragment(fragment);
    this.invalidateSupports(dirty);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const entry of this.fragments.values()) this.removeFragment(entry);
    this.vehicles.clear();
    this.actors.length=0;
    this.chunks.clear();
    this.colliderOwners.clear();
    this.events.free();
    this.world.free();
    this.disposed = true;
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('坍塌物理系统已关闭。');
  }

  private validateBatch(incoming: RubbleFragment[], replaceAll: boolean,removed:ReadonlySet<string>=new Set()): void {
    const ids = new Set<string>();
    for (const fragment of incoming) {
      validateFragment(fragment);
      if (ids.has(fragment.id)) throw new Error('同一批次中存在重复碎块标识。');
      ids.add(fragment.id);
    }
    let active = incoming.filter(fragment => fragment.state === 'falling').length;
    let count = incoming.length;
    let voxels = incoming.reduce((sum, fragment) => sum + fragment.voxels.length, 0);
    if (!replaceAll) for (const entry of this.fragments.values()) {
      if (ids.has(entry.source.id)||removed.has(entry.source.id)) continue;
      if (entry.source.state === 'falling') active++;
      count++;
      voxels += entry.source.voxels.length;
    }
    if (active > MAX_ACTIVE_FRAGMENTS) throw new Error(`同时运动的碎块不能超过 ${MAX_ACTIVE_FRAGMENTS} 组，请等待当前坍塌落定。`);
    if (count > MAX_SAVED_FRAGMENTS || voxels > MAX_SAVED_FRAGMENT_VOXELS) throw new Error('废墟已达到当前版本的保存上限，请先导出存档。');
  }

  private insertFragment(fragment: RubbleFragment): void {
    const source = copyFragment(fragment);
    const description = (source.state === 'settled' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(source.position.x, source.position.y, source.position.z)
      .setRotation(source.rotation)
      .setLinearDamping(0.12).setAngularDamping(1.5)
      .setCanSleep(true).setCcdEnabled(true);
    const body = this.world.createRigidBody(description);
    if (source.state === 'falling') {
      body.setLinvel(source.linearVelocity ?? { x: 0.12, y: 0, z: 0.08 }, true);
      body.setAngvel(source.angularVelocity ?? { x: 0.08, y: 0.04, z: 0.06 }, true);
    }
    const mesh = new Mesh(createFragmentGeometry(source), this.material);
    mesh.position.copy(source.position);
    mesh.quaternion.set(source.rotation.x, source.rotation.y, source.rotation.z, source.rotation.w);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `rubble:${source.id}`;
    this.scene.add(mesh);
    const boxes=fragmentBoxes(source.voxels,source.size),walkBounds=boxes.map(b=>orientedCollisionBounds(new Vector3().copy(b.center).applyQuaternion(new Quaternion().copy(source.rotation)).add(source.position),source.rotation,b.half));
    const entry: FragmentEntry = { source, body, collider:null as unknown as RAPIER.Collider,colliders:[], mesh, age: 0, stableTime: 0, previousVerticalVelocity: 0, lastImpact: -1, walkBounds,boxes,cells:new Set(source.voxels.map(([x,y,z])=>fragmentCell(x,y,z))),precise:false };
    this.buildFragmentColliders(entry);
    this.fragments.set(source.id, entry);
    this.walkObstaclesDirty = true;
  }

  private buildFragmentColliders(entry:FragmentEntry):void{
    for(const c of entry.colliders){this.colliderOwners.delete(c.handle);this.world.removeCollider(c,false);}entry.colliders=[];
    const geometry=entry.mesh.geometry,positions=geometry.getAttribute('position').array as Float32Array;
    let descriptions:RAPIER.ColliderDesc[];
    entry.precise=entry.boxes.length<=96||entry.source.state==='settled';
    if(entry.boxes.length<=96)descriptions=entry.boxes.map(b=>RAPIER.ColliderDesc.cuboid(Math.max(.05,b.half.x-.006),Math.max(.05,b.half.y-.006),Math.max(.05,b.half.z-.006)).setTranslation(b.center.x,b.center.y,b.center.z));
    else if(entry.source.state==='settled')descriptions=[RAPIER.ColliderDesc.trimesh(positions,geometry.getIndex()!.array as Uint32Array)];
    else descriptions=[RAPIER.ColliderDesc.convexHull(positions)??RAPIER.ColliderDesc.cuboid(entry.source.size.x/2,entry.source.size.y/2,entry.source.size.z/2)];
    for(const d of descriptions){const c=this.world.createCollider(d.setFriction(.9).setRestitution(.035).setDensity(1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),entry.body);entry.colliders.push(c);this.colliderOwners.set(c.handle,entry);}
    entry.collider=entry.colliders[0];
  }

  private removeFragment(entry: FragmentEntry): void {
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    for(const c of entry.colliders)this.colliderOwners.delete(c.handle);
    this.world.removeRigidBody(entry.body);
    this.fragments.delete(entry.source.id);
    this.walkObstaclesDirty = true;
  }

  private updateVehicleWalkBounds(entry: VehicleEntry): void {
    const body = entry.body.translation(), q = entry.body.rotation();
    if (entry.kind === 'car') {
      CAR_CLEARANCE_BOXES.forEach((p,i)=>orientedCollisionBounds(new Vector3().copy(p.center).applyQuaternion(new Quaternion().copy(q)).add(body),q,p.half,entry.walkBounds[i]));return;
    }
    const rotation=new Quaternion().copy(q);
    HELICOPTER_COLLISION_PARTS.forEach((p,i)=>{
      const center=new Vector3().copy(p.center).applyQuaternion(rotation).add(body);
      if(!p.rotor){orientedCollisionBounds(center,q,p.half,entry.walkBounds[i]);return;}
      const axis=new Vector3(0,1,0).applyQuaternion(rotation),extent=(n:number)=>p.half.x*Math.sqrt(Math.max(0,1-n*n))+p.half.y*Math.abs(n);
      orientedBoxBounds(center,{x:0,y:0,z:0,w:1},{x:extent(axis.x),y:extent(axis.y),z:extent(axis.z)},entry.walkBounds[i]);
    });
  }

  private snapshotEntry(entry: FragmentEntry): RubbleFragment {
    const result = copyFragment(entry.source);
    result.position = { ...entry.body.translation() };
    result.rotation = { ...entry.body.rotation() };
    result.linearVelocity = entry.source.state === 'falling' ? { ...entry.body.linvel() } : { x: 0, y: 0, z: 0 };
    result.angularVelocity = entry.source.state === 'falling' ? { ...entry.body.angvel() } : { x: 0, y: 0, z: 0 };
    return result;
  }

  private hasSurfaceContact(collider: RAPIER.Collider): boolean {
    let touching = false;
    this.world.contactPairsWith(collider, other => {
      if (touching) return;
      this.world.contactPair(collider, other, manifold => {
        // Sleeping pairs can retain geometric contacts with no active solver
        // contacts. Read their actual gap so sleeping debris can finish settling.
        for (let index = 0; index < manifold.numContacts(); index++) {
          if (manifold.contactDist(index) <= 0.035) { touching = true; break; }
        }
      });
    });
    return touching;
  }
}
