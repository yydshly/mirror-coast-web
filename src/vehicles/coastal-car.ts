import { Euler, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type {Quat} from '../destruction/types';
import { CollapsePhysics, type ManagedGroundVehicle } from '../destruction/physics';
import type { Vec3 } from '../destruction/types';
import { WORLD_HEIGHT, type VoxelWorld } from '../world/voxel';
import { createCoastalCarModel } from './coastal-car-model';
import {obstaclesIntersect,orientedCollisionBounds,surfaceIntersectsBox,type SceneObstacle} from '../input/scene-collisions';
import {CAR_CLEARANCE_BOXES,CAR_CONTACT_BOXES,CAR_MIRRORS,CAR_ROOF_BOXES} from './car-collision';
import { VehicleOrbit } from '../input/vehicle-orbit';
import { clipVehicleCamera } from './chase-camera';
import { Material } from '../world/palette';
import { REGION_ROADS } from '../world/region-layout';
import {CAR_FORWARD_SPEED,CAR_REVERSE_SPEED,type CarSignal} from './driving-tuning';

export const CAR_SPAWN = { x: 248, y: 16.85, z: 164 };
const RIDE_HEIGHT = .85, HALF_WIDTH = .97, HALF_LENGTH = 2.35;
const WHEEL_X=.95, WHEEL_Z=1.43, WHEEL_RADIUS=.39;
const SHELL_GROUND_BOXES=[
 {center:{x:0,y:-.075,z:-1.73},half:{x:.85,y:.23,z:.46}},
 {center:{x:0,y:-.10,z:1.91},half:{x:.85,y:.20,z:.265}},
 {center:{x:0,y:.81,z:.39},half:{x:.85,y:.0425,z:.97}},
 ...[-1,1].map(side=>({center:{x:side*.85,y:-.08,z:0},half:{x:.065,y:.26,z:.86}})),
];
type Support={highest:number;average:number;front:number;rear:number;left:number;right:number;heights:number[]};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export type CarState = { position: Vec3; heading: number; speed: number;rigidBody?:{rotation:Quat;linearVelocity:Vec3;angularVelocity:Vec3} };
export type CarInput = { throttle: number; steer: number; brake: boolean };
export type CarBlockage='front'|'rear'|'step'|'trapped'|null;
export type CarViewState = { driving: boolean; speed: number; blocked: boolean; grounded: boolean;overturned:boolean;blockage:CarBlockage;recovering:boolean;signal:CarSignal;signalLit:boolean;braking:boolean };

/** Road motor on stable ground; shared rigid-body response to impacts and lost support. */
export class CoastalCar {
  private readonly vehicle: ManagedGroundVehicle;
  private readonly model = createCoastalCarModel();
  private readonly keys = new Set<string>();
  private readonly location = new Vector3().copy(CAR_SPAWN);
  private readonly previousPosition = new Vector3().copy(CAR_SPAWN);
  private readonly renderPosition = new Vector3().copy(CAR_SPAWN);
  private readonly previousOrientation = new Quaternion();
  private previousHeading = -Math.PI / 2;
  private previousWheelHeights = [16,16,16,16];
  private readonly orientation = new Quaternion();
  private readonly lookPoint = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly cameraOrigin = new Vector3();
  private readonly targetLook = new Vector3();
  private readonly orbit: VehicleOrbit;
  private readonly listeners: Array<() => void> = [];
  private input: CarInput = { throttle: 0, steer: 0, brake: false };
  private externalInput = false;
  private driving = false;
  private heading = -Math.PI / 2;
  private speed = 0;
  private blocked = false;
  private blockage:CarBlockage=null;
  private grounded = true;
  private cameraReady = false;
  private removed = false;
  private pitch = 0;
  private bank = 0;
  private suspension = 0;
  private fallSpeed=0;
  private wheelHeights:number[]=[16,16,16,16];
  private lastNotice = -10;
  private elapsed = 0;
  private night = 0;
  private dynamicAge=0;
  private calmTime=0;
  private steering=0;
  private signal:CarSignal='off';
  private manualSignal=false;
  private signalHeading=0;
  private signalTurn=0;
  private signalQuiet=0;
  private signalClock=0;
  private propClock=0;
  private checkRestoredPose=false;
  private obstacleProvider: () => readonly SceneObstacle[] = () => [];
  private recoveryObstacleProvider: (() => readonly SceneObstacle[]) | undefined;
  private surfaceProvider:((x:number,z:number,maxTop:number)=>number|null)|undefined;
  private clearanceBounds:SceneObstacle[]=CAR_CLEARANCE_BOXES.map(()=>({minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0}));
  private clearanceRotation=new Quaternion();
  private clearanceCenter=new Vector3();

  private constructor(scene: Scene, private physics: CollapsePhysics, private world: VoxelWorld, private callbacks: { onNotice: (message: string) => void;onImpact?:(position:Vec3,strength:number)=>void; canvas?: HTMLCanvasElement }) {
    this.orbit = new VehicleOrbit(callbacks.canvas ?? (typeof document !== 'undefined' ? document.querySelector?.('#world') as HTMLCanvasElement | null : null) ?? undefined);
    scene.add(this.model.root);
    this.vehicle = physics.createGroundVehicle(CAR_SPAWN, dt => this.fixedStep(dt));
    this.orientation.setFromAxisAngle(new Vector3(0, 1, 0), this.heading);
    this.vehicle.body.setRotation(this.orientation, false);
    this.model.root.position.copy(this.location); this.model.root.quaternion.copy(this.orientation);
    this.alignToGround();
    this.resetRenderPose();
    if (typeof document !== 'undefined') {
      this.listen(document, 'keydown', event => {
        const key = event as KeyboardEvent;
        if (!this.driving || key.repeat || (key.target as HTMLElement)?.matches?.('input,textarea,select,button,summary,a,[contenteditable="true"]')) return;
        if(['KeyZ','KeyC','KeyX'].includes(key.code)){key.preventDefault();this.toggleSignal(key.code==='KeyZ'?'left':key.code==='KeyC'?'right':'hazard');return;}
        if (!['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'].includes(key.code)) return;
        key.preventDefault(); this.keys.add(key.code); this.externalInput = false;
      });
      this.listen(document, 'keyup', event => this.keys.delete((event as KeyboardEvent).code));
    }
    if (typeof window !== 'undefined') this.listen(window, 'blur', () => this.keys.clear());
  }

  static create(scene: Scene, physics: CollapsePhysics, world: VoxelWorld, callbacks: { onNotice: (message: string) => void;onImpact?:(position:Vec3,strength:number)=>void; canvas?: HTMLCanvasElement }): CoastalCar {
    return new CoastalCar(scene, physics, world, callbacks);
  }

  get position(): Vector3 { return this.location; }
  get viewState(): CarViewState { const q=this.vehicle.body.rotation();return { driving: this.driving, speed: this.speed, blocked: this.blocked, grounded: this.grounded,blockage:this.blockage,overturned:1-2*(q.x*q.x+q.z*q.z)<.55,recovering:this.vehicle.dynamic,signal:this.activeSignal,signalLit:this.signalClock%1<.5,braking:this.input.brake||this.input.throttle<0&&this.speed>.2||this.input.throttle>0&&this.speed<-.2 }; }
  private get activeSignal():CarSignal{return this.vehicle.dynamic&&Math.abs(this.speed)<2?'hazard':this.signal;}
  toggleSignal(signal:Exclude<CarSignal,'off'>):void{this.signal=this.signal===signal?'off':signal;this.manualSignal=this.signal!=='off';this.signalHeading=this.heading;this.signalTurn=0;this.signalQuiet=0;this.signalClock=0;}
  get orbitState() { return this.orbit.state; }
  get motionDiagnostics(){return{fixedHz:60,alpha:this.physics.interpolationAlpha,physical:{...this.location},rendered:{...this.model.root.position},lag:this.location.distanceTo(this.model.root.position),dynamic:this.vehicle.dynamic,rotation:{...this.vehicle.body.rotation()},velocity:{...this.vehicle.body.linvel()}};}
  resetLook(): void { this.orbit.resetLook(); }
  orbitBy(dx: number, dy: number): void { this.orbit.orbitBy(dx,dy); }
  zoomBy(delta: number): void { this.orbit.zoomBy(delta); }

  /** Decorative road solids only; Rapier already handles vehicles/debris and excludes this car. */
  setObstacleProvider(provider: () => readonly SceneObstacle[]): void { this.obstacleProvider = provider; }
  setSurfaceProvider(provider:(x:number,z:number,maxTop:number)=>number|null):void{this.surfaceProvider=provider;if(!this.vehicle.dynamic)this.alignToGround();}
  get wheelContacts(){
    if(this.vehicle.dynamic){const q=new Quaternion().copy(this.vehicle.body.rotation());return[-WHEEL_X,WHEEL_X].flatMap(x=>[-WHEEL_Z,WHEEL_Z].map(z=>new Vector3(x,-RIDE_HEIGHT,z).applyQuaternion(q).add(this.location)));}
    const c=Math.cos(this.heading),s=Math.sin(this.heading);let i=0;
    return [-WHEEL_X,WHEEL_X].flatMap(dx=>[-WHEEL_Z,WHEEL_Z].map(dz=>({x:this.location.x+c*dx+s*dz,z:this.location.z-s*dx+c*dz,y:this.wheelHeights[i++]})));
  }
  /** Full prop list is used for road rescue and the entry pose check, not each frame. */
  setRecoveryObstacleProvider(provider: () => readonly SceneObstacle[]): void { this.recoveryObstacleProvider=provider; }
  pedestrianImpact():void{if(!this.vehicle.dynamic)this.speed*=.92;}
  setNight(night: number): void { this.night=night;this.model.setNight(night,this.driving); }

  /** Nearby actual road, four supported wheels, no actor/prop overlap. */
  recoverToRoad(): boolean {
    if(this.removed)return false;
    const radius=80,b=this.world.bounds,source=this.location,candidates:Array<{x:number;z:number;top:number;distance:number}>=[];
    const existing=this.roadSurfaceAt(source.x,source.z);
    if(existing!==null)candidates.push({x:source.x,z:source.z,top:existing,distance:0});
    for(let z=Math.max(b.minZ,Math.floor(source.z-radius));z<Math.min(b.maxZ,Math.ceil(source.z+radius));z++){
      for(let x=Math.max(b.minX,Math.floor(source.x-radius));x<Math.min(b.maxX,Math.ceil(source.x+radius));x++){
        const px=x+.5,pz=z+.5,distance=(px-source.x)**2+(pz-source.z)**2;
        if(distance>radius**2)continue;
        const top=this.roadSurfaceAt(px,pz);if(top!==null)candidates.push({x:px,z:pz,top,distance});
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    const props=this.recoveryObstacleProvider?.()??this.obstacleProvider(),rotation=new Quaternion();
    for(const candidate of candidates)for(const heading of this.roadHeadingsAt(candidate.x,candidate.z,candidate.top)){
      const support=this.groundSupport(candidate.x,candidate.z,heading,candidate.top);
      if(!support)continue;
      const c=Math.cos(heading),s=Math.sin(heading);
      let wheelsOnRoad=true;
      for(const dx of [-WHEEL_X,WHEEL_X])for(const dz of [-WHEEL_Z,WHEEL_Z]){
        if(this.roadSurfaceAt(candidate.x+c*dx+s*dz,candidate.z-s*dx+c*dz)===null)wheelsOnRoad=false;
      }
      if(!wheelsOnRoad)continue;
      const position={x:candidate.x,y:support.highest+RIDE_HEIGHT,z:candidate.z};
      rotation.setFromAxisAngle(new Vector3(0,1,0),heading);
      if(!this.staticClear(position,heading,props)||!this.vehicle.canOccupy(position,rotation))continue;
      this.vehicle.setDynamic(false);this.vehicle.body.setLinvel({x:0,y:0,z:0},false);this.vehicle.body.setAngvel({x:0,y:0,z:0},false);
      this.location.copy(position);this.heading=heading;this.speed=0;this.blocked=false;this.blockage=null;this.grounded=true;
      this.keys.clear();this.input={throttle:0,steer:0,brake:false};this.externalInput=false;this.steering=0;this.signal='off';this.manualSignal=false;
      this.orientation.copy(rotation);this.vehicle.body.setTranslation(position,false);this.vehicle.body.setRotation(rotation,false);
      this.location.copy(this.vehicle.body.translation());
      this.vehicle.body.setNextKinematicTranslation(this.location);this.vehicle.body.setNextKinematicRotation(rotation);
      this.model.root.position.copy(this.location);this.model.root.quaternion.copy(rotation);
      this.applySupport(support);this.applyModelPose(true);
      this.resetRenderPose();
      this.cameraReady=false;return true;
    }
    this.speed=0;this.keys.clear();this.input={throttle:0,steer:0,brake:false};this.externalInput=false;
    return false;
  }

  setDriving(active: boolean): void {
    if(this.removed)return;
    let recoveryNotice:string|undefined;
    if(active&&!this.vehicle.dynamic){
      const props=this.recoveryObstacleProvider?.()??this.obstacleProvider();
      const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),this.heading);
      if(!this.staticClear(this.location,this.heading,props)||!this.vehicle.canOccupy(this.location,rotation)){
        const recovered=this.recoverToRoad();this.blocked=!recovered;this.blockage=recovered?null:'trapped';
        recoveryNotice=recovered?'已将卡住的汽车移到附近可通行道路。':'车辆卡住，附近没有可用道路；请先清理障碍或使用道路救援。';
      }
    }
    if(active===this.driving){if(recoveryNotice)this.callbacks.onNotice(recoveryNotice);return;}
    this.driving = active; this.keys.clear(); this.externalInput = false;
    this.steering=0;this.signal='off';this.manualSignal=false;
    this.input = { throttle: 0, steer: 0, brake: false }; this.speed = 0;
    this.vehicle.setActive(active); this.cameraReady = false;
    this.resetRenderPose();
    this.orbit.setEnabled(active);
    this.model.setNight(this.night,active);
    if (active) this.callbacks.onNotice(recoveryNotice??'W/S 油门与倒车，A/D 转向；Z/C 转向灯，X 双闪；鼠标拖动环视，Esc 下车');
  }

  setInput(input: Partial<CarInput>): void {
    this.externalInput = true;
    this.input = { throttle: clamp(input.throttle ?? 0, -1, 1), steer: clamp(input.steer ?? 0, -1, 1), brake: !!input.brake };
  }
  /** Overlay reading keeps the car selected, but releases capture and holds its brake. */
  releaseControls():void{
    this.keys.clear();this.input={throttle:0,steer:0,brake:true};this.externalInput=true;this.orbit.cancelDrag();
  }

  snapshot(): CarState { return { position: { x: this.location.x, y: this.location.y, z: this.location.z }, heading: this.heading, speed: this.speed,...this.vehicle.dynamic?{rigidBody:{rotation:{...this.vehicle.body.rotation()},linearVelocity:{...this.vehicle.body.linvel()},angularVelocity:{...this.vehicle.body.angvel()}}}:{} }; }

  restore(state: CarState): void {
    if (this.removed) return;
    this.setDriving(false);
    this.vehicle.setDynamic(false);
    if (![state.position.x, state.position.y, state.position.z, state.heading, state.speed].every(Number.isFinite)) throw new Error('汽车存档姿态无效。');
    this.location.copy(state.position); this.heading = Math.atan2(Math.sin(state.heading),Math.cos(state.heading)); this.speed = 0;
    this.orientation.setFromAxisAngle(new Vector3(0, 1, 0), this.heading);
    this.vehicle.body.setTranslation(this.location, false); this.vehicle.body.setRotation(this.orientation, false);
    this.model.root.position.copy(this.location); this.model.root.quaternion.copy(this.orientation);
    if(state.rigidBody){
      this.vehicle.body.setRotation(state.rigidBody.rotation,false);this.enterDynamics(state.rigidBody.linearVelocity);
      this.vehicle.body.setAngvel(state.rigidBody.angularVelocity,true);
    }else this.alignToGround();
    this.resetRenderPose();
    this.cameraReady = false;
    this.checkRestoredPose=true;
  }

  beforePhysics(dt: number): void {
    this.elapsed += Math.max(0, Math.min(dt, .05));
    if(this.physics.hasActivePedestrians){
      for(const p of this.physics.pedestrianSnapshot())this.physics.ensureVehicleTerrain(this.world,p.position,4);
      if(!this.vehicle.dynamic){this.propClock+=dt;if(this.propClock>.2){this.propClock=0;this.vehicle.syncProps(this.obstacleProvider());}}
    }
    if(this.checkRestoredPose){
      this.checkRestoredPose=false;
      // Run after scenery/road providers are ready. A solver cannot reliably
      // escape a save already deep inside a solid terrain mesh. Ordinary
      // contacts and valid overturned cars keep their saved pose.
      const props=this.recoveryObstacleProvider?.()??this.obstacleProvider();
      const invalid=this.vehicle.dynamic?this.restoredTerrainOverlap():!this.staticClear(this.location,this.heading,props);
      if(invalid){
        if(this.recoverToRoad())this.callbacks.onNotice('存档中的汽车与地形或障碍重叠，已移到附近可通行道路。');
        else this.callbacks.onNotice('存档中的汽车与障碍重叠；附近没有可用道路，请清理障碍或使用道路救援。');
      }
    }
    if(!this.removed&&!this.vehicle.dynamic&&this.unstableAt(this.location))this.enterDynamics();
    if(!this.removed&&!this.vehicle.dynamic&&!this.tyresClear(this.location,this.heading,this.wheelHeights))this.enterDynamics();
    if(!this.removed&&!this.vehicle.dynamic){const support=this.groundSupport(this.location.x,this.location.z,this.heading,this.location.y-RIDE_HEIGHT);if(support&&!this.shellGroundClear(this.location,this.heading,support))this.enterDynamics();}
    if(!this.removed&&!this.driving&&!this.vehicle.dynamic){
      const support=this.groundSupport(this.location.x,this.location.z,this.heading,this.location.y-RIDE_HEIGHT,true);
      if(support){
        const target=support.highest+RIDE_HEIGHT;
        if(target<this.location.y-.002){
          this.fallSpeed=Math.min(35,this.fallSpeed+9.81*Math.min(.05,Math.max(0,dt)));
          this.location.y=Math.max(target,this.location.y-this.fallSpeed*Math.min(.05,Math.max(0,dt)));
        }else this.location.y=target;
        this.grounded=Math.abs(this.location.y-target)<.003;
        if(this.grounded){this.applySupport(support);this.fallSpeed=0;}
        this.vehicle.body.setTranslation(this.location,false);
      }else{this.grounded=false;this.fallWithoutSupport(Math.min(.05,Math.max(0,dt)));this.vehicle.body.setTranslation(this.location,false);}
    }
    if (!this.externalInput) this.input = {
      throttle: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
      steer: Number(this.keys.has('KeyA')) - Number(this.keys.has('KeyD')),
      brake: this.keys.has('Space'),
    };
  }

  afterPhysics(dt: number, camera: PerspectiveCamera): void {
    if (this.removed) return;
    const delta = Math.max(0, Math.min(dt, .05));
    this.location.copy(this.vehicle.body.translation());
    // A 100–144Hz display frequently renders without a new 60Hz physics pose.
    // Sample the last two accepted poses with the accumulator remainder instead
    // of displaying repeated frames followed by a whole fixed-step jump.
    const alpha=this.driving||this.vehicle.dynamic?this.physics.interpolationAlpha:1;
    this.renderPosition.lerpVectors(this.previousPosition,this.location,alpha);
    this.model.root.position.copy(this.renderPosition);
    this.orientation.copy(this.vehicle.body.rotation());
    this.model.root.quaternion.copy(this.previousOrientation).slerp(this.orientation,alpha);
    if(this.vehicle.dynamic){this.model.shell.rotation.x=0;this.model.shell.rotation.z=0;this.model.shell.position.y=-.18;this.model.setWheelHeights([-.46,-.46,-.46,-.46]);}
    else this.applyModelPose(false,delta,alpha);
    this.model.setGrounded(this.grounded&&new Vector3(0,1,0).applyQuaternion(this.orientation).y>.98);
    this.updateSignals(delta);
    const state=this.viewState;
    this.model.update(delta, this.driving ? this.speed : 0, this.steering, state.braking,{signal:state.signal,lit:state.signalLit,reversing:this.speed<-.2});
    this.model.updateCabin(delta,this.driving,this.input.throttle,state.braking,state.speed);
    if (!this.driving) return;
    this.orbit.update(delta,this.speed);
    const orbit=this.orbit.state;
    const turn=Math.atan2(Math.sin(this.heading-this.previousHeading),Math.cos(this.heading-this.previousHeading));
    const heading=this.previousHeading+turn*alpha;
    const fx = -Math.sin(heading), fz = -Math.cos(heading),position=this.renderPosition;
    this.cameraOrigin.set(position.x, position.y + .7, position.z);
    const overturned=this.viewState.overturned;
    const angle=heading+Math.atan2(.7,7.4)+orbit.yaw,elevation=Math.max(overturned?.85:-1.3,Math.atan2(2.3,Math.hypot(7.4,.7))+orbit.pitch);
    const radius=(Math.hypot(7.4,.7,2.3)+(overturned?4:0))*orbit.distanceScale,flat=radius*Math.cos(elevation);
    this.cameraTarget.set(this.cameraOrigin.x+Math.sin(angle)*flat,this.cameraOrigin.y+Math.sin(elevation)*radius,this.cameraOrigin.z+Math.cos(angle)*flat);
    const cameraProps=this.obstacleProvider();
    clipVehicleCamera(this.world,this.cameraOrigin,this.cameraTarget,this.vehicle.cameraDistance,this.cameraTarget,cameraProps);
    const ahead=4*Math.max(0,Math.cos(orbit.yaw))**2;
    const targetLook = this.targetLook.set(position.x + fx * ahead, position.y + .45, position.z + fz * ahead);
    if (!this.cameraReady) { camera.position.copy(this.cameraTarget); this.lookPoint.copy(targetLook); this.cameraReady = true; }
    else { camera.position.lerp(this.cameraTarget, 1 - Math.exp(-delta * 5)); this.lookPoint.lerp(targetLook, 1 - Math.exp(-delta * 7)); }
    // A second check prevents the smoothed camera from cutting a road-side corner.
    clipVehicleCamera(this.world,this.cameraOrigin,camera.position,this.vehicle.cameraDistance,camera.position,cameraProps);
    camera.up.set(0, 1, 0); camera.lookAt(this.lookPoint);
  }

  dispose(): void {
    if (this.removed) return;
    this.setDriving(false); this.removed = true;
    this.orbit.dispose(); this.listeners.forEach(remove => remove()); this.vehicle.dispose(); this.model.dispose();
  }

  private fixedStep(dt: number): void {
    this.location.copy(this.vehicle.body.translation()); this.blocked = false;this.blockage=null;
    this.previousPosition.copy(this.location);this.previousOrientation.copy(this.vehicle.body.rotation());
    this.previousHeading=this.heading;this.previousWheelHeights=this.wheelHeights.slice();
    this.steering+=(this.input.steer-this.steering)*(1-Math.exp(-dt*11));
    this.vehicle.setWheelSteering(this.steering*.62/(1+this.speed*this.speed/100));
    if(this.vehicle.dynamic){this.dynamicStep(dt);return;}
    const brake = this.input.brake || this.input.throttle < 0 && this.speed > .2 || this.input.throttle>0&&this.speed<-.2;
    const acceleration = brake ? -Math.sign(this.speed) * 13 : this.input.throttle * (this.speed < 0 ? 4 : 6);
    const previous = this.speed;
    this.speed = clamp(this.speed + acceleration * dt, -CAR_REVERSE_SPEED, CAR_FORWARD_SPEED);
    if (brake && Math.sign(previous) !== Math.sign(this.speed)) this.speed = 0;
    if (!this.input.throttle || this.input.brake) this.speed *= Math.exp(-dt * (this.input.brake ? 6 : .6));
    const wheelAngle=this.steering*.62/(1+this.speed*this.speed/100);
    const angle = this.heading + this.speed*Math.tan(wheelAngle)/2.86*dt;
    const nextHeading = Math.atan2(Math.sin(angle),Math.cos(angle));
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), nextHeading);
    if (this.driveClear(this.location, nextHeading) && this.vehicle.canOccupy(this.location, rotation)) this.heading = nextHeading;
    const travel = this.speed * dt, count = Math.max(1, Math.ceil(Math.abs(travel) / .15));
    for (let i = 0; i < count; i++) {
      const candidate = this.location.clone();
      candidate.x -= Math.sin(this.heading) * travel / count; candidate.z -= Math.cos(this.heading) * travel / count;
      const support = this.groundSupport(candidate.x, candidate.z, this.heading, this.location.y - RIDE_HEIGHT);
      if (!support) {
        if(this.unstableAt(candidate)&&this.driveClear(candidate,this.heading)&&this.vehicle.canOccupy(candidate,this.orientation)){
          this.enterDynamics();return;
        }
        this.grounded=!!this.groundSupport(this.location.x,this.location.z,this.heading,this.location.y-RIDE_HEIGHT);this.blocked=true;this.blockage='step';this.speed=0;break;
      }
      candidate.y = support.highest + RIDE_HEIGHT;
      this.orientation.setFromAxisAngle(new Vector3(0, 1, 0), this.heading);
      if (!this.driveClear(candidate, this.heading) || !this.vehicle.canOccupy(candidate, this.orientation)) {
        if(Math.abs(this.speed)>.8){const velocity=this.vehicle.promoteImpact(candidate,this.orientation,{x:-Math.sin(this.heading)*this.speed,y:0,z:-Math.cos(this.heading)*this.speed});this.enterDynamics(velocity);this.callbacks.onImpact?.(candidate,Math.min(1.5,Math.abs(this.speed)/12));return;}
        this.blocked=true;this.blockage=this.driveClear(this.location,this.heading)?this.input.throttle<0?'rear':'front':'trapped';this.speed=0;break;
      }
      this.location.copy(candidate); this.grounded = true;
      this.applySupport(support);
    }
    if(!this.grounded)this.fallWithoutSupport(dt);
    if (this.blocked && this.elapsed - this.lastNotice > 4 && Math.abs(this.input.throttle) > .1) {
      this.lastNotice = this.elapsed; this.callbacks.onNotice(this.blockage==='trapped'?'车辆卡住，可使用道路救援。':this.blockage==='step'?'道路台阶或落差过大，请沿坡道行驶。':this.blockage==='rear'?'后方受阻，请向前调整或使用道路救援。':'前方受阻，松开油门后倒车调整；卡住时可使用道路救援。');
    }
    this.orientation.setFromAxisAngle(new Vector3(0, 1, 0), this.heading);
    this.vehicle.body.setNextKinematicTranslation(this.location); this.vehicle.body.setNextKinematicRotation(this.orientation);
  }

  private unstableAt(position:Vec3):boolean{
    const c=Math.cos(this.heading),s=Math.sin(this.heading);let i=0;
    for(const dx of [-WHEEL_X,WHEEL_X])for(const dz of [-WHEEL_Z,WHEEL_Z]){
      const expected=this.wheelHeights[i++],top=this.floorAt(position.x+c*dx+s*dz,position.z-s*dx+c*dz,Math.max(position.y-RIDE_HEIGHT+.3,expected+.3),WORLD_HEIGHT);
      if(top===null||top<expected-.55)return true;
    }
    return false;
  }
  private enterDynamics(velocity:Vec3={x:-Math.sin(this.heading)*this.speed,y:-this.fallSpeed,z:-Math.cos(this.heading)*this.speed}):void{
    if(this.vehicle.dynamic)return;
    this.physics.ensureVehicleTerrain(this.world,this.location);this.vehicle.syncProps(this.obstacleProvider());
    this.vehicle.body.setTranslation(this.location,false);this.vehicle.setDynamic(true,velocity);
    this.dynamicAge=0;this.calmTime=0;this.propClock=0;
  }
  private dynamicStep(dt:number):void{
    this.dynamicAge+=dt;this.propClock+=dt;this.physics.ensureVehicleTerrain(this.world,this.location);
    if(this.propClock>.2){this.propClock=0;this.vehicle.syncProps(this.obstacleProvider());}
    const body=this.vehicle.body,q=new Quaternion().copy(body.rotation()),up=new Vector3(0,1,0).applyQuaternion(q),forward=new Vector3(0,0,-1).applyQuaternion(q),v=body.linvel();
    if(Math.hypot(forward.x,forward.z)>.1)this.heading=Math.atan2(-forward.x,-forward.z);
    this.speed=v.x*-Math.sin(this.heading)+v.z*-Math.cos(this.heading);this.grounded=this.vehicle.hasContact();
    this.blocked=this.driving&&Math.abs(this.input.throttle)>.1&&Math.abs(this.speed)<.2&&this.grounded&&this.dynamicAge>.3;this.blockage=this.blocked?(this.input.throttle<0?'rear':'front'):null;
    // Supported slopes need current wheel samples too. Keeping the spawn's
    // wheel heights on a tilted body prevents recovery on lower road sections.
    if(this.grounded&&up.y>.9)this.wheelHeights=this.wheelContacts.map(p=>p.y);
    if(this.driving&&up.y>.75&&this.grounded&&this.dynamicAge>.18){
      const mass=body.mass(),braking=this.input.brake||this.input.throttle<0&&this.speed>.2||this.input.throttle>0&&this.speed<-.2;
      if(braking){const factor=Math.min(1,dt*7);body.applyImpulse({x:-v.x*mass*factor,y:0,z:-v.z*mass*factor},true);}
      // Fixed tyre shapes have sliding contact friction. Tractive force must
      // overcome that breakaway load, including when reversing after impact.
      else if(this.input.throttle*(this.speed)<(this.input.throttle<0?CAR_REVERSE_SPEED:CAR_FORWARD_SPEED))body.applyImpulse({x:forward.x*this.input.throttle*12*mass*dt,y:0,z:forward.z*this.input.throttle*12*mass*dt},true);
      const angular=body.angvel(),desired=this.speed*Math.tan(this.steering*.62/(1+this.speed*this.speed/100))/2.86;
      body.setAngvel({x:angular.x,y:angular.y+(desired-angular.y)*Math.min(1,dt*3),z:angular.z},true);
    }
    const angular=body.angvel(),lateral=v.x*Math.cos(this.heading)-v.z*Math.sin(this.heading);
    const settled=Math.abs(v.y)<.35&&Math.abs(lateral)<.65&&Math.hypot(angular.x,angular.z)<.2&&Math.abs(angular.y)<.6;
    const support=settled&&this.grounded&&up.y>.9?this.groundSupport(this.location.x,this.location.z,this.heading,this.location.y-RIDE_HEIGHT,true):null;
    const roadUp=support?new Vector3(0,1,0).applyEuler(new Euler(clamp(Math.atan2(support.front-support.rear,2*WHEEL_Z),-.4,.4),this.heading,clamp(Math.atan2(support.right-support.left,2*WHEEL_X),-.3,.3),'YXZ')):null;
    // A settled car follows the road normal on a hill. Requiring world-up
    // permanently traps a valid slope contact in the crash controller.
    this.calmTime=settled&&support&&roadUp&&up.dot(roadUp)>.995&&!this.unstableAt(this.location)?this.calmTime+dt:0;
    // Upright contact can return to the road motor. An overturned car keeps its
    // physical pose until the player explicitly uses road rescue.
    if(this.dynamicAge>.4&&this.calmTime>.25){
      const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),this.heading);
      const candidate={x:this.location.x,y:support?support.highest+RIDE_HEIGHT:this.location.y,z:this.location.z};
      // Flattening a contact pose into the road motor must not embed the rear
      // bumper in a wall and make every later forward/reverse step invalid.
      // The road motor anchors at the highest wheel and offsets the visible
      // suspension; physics anchors near the average contact plane instead.
    if(support&&Math.abs(candidate.y-this.location.y)<.18+support.highest-support.average&&this.driveClear(candidate,this.heading)&&this.vehicle.canOccupy(candidate,rotation)){
        // Keep longitudinal motion across the handover. No one-second stop is
        // required, and a held accelerator cannot postpone recovery forever.
        const resumeSpeed=clamp(this.speed,-CAR_REVERSE_SPEED,CAR_FORWARD_SPEED);
        this.vehicle.setDynamic(false);this.speed=resumeSpeed;this.fallSpeed=0;this.location.copy(candidate);body.setTranslation(candidate,false);this.orientation.copy(rotation);body.setRotation(rotation,false);this.alignToGround();
        this.vehicle.body.setNextKinematicTranslation(this.location);this.vehicle.body.setNextKinematicRotation(rotation);
      }
    }
  }

  private updateSignals(dt:number):void{
    this.signalClock+=dt;
    if(!this.driving)return;
    if(!this.manualSignal){
      const automatic=this.input.steer>.25?'left':this.input.steer<-.25?'right':'off';
      this.signalQuiet=automatic==='off'?this.signalQuiet+dt:0;
      if(automatic!=='off'&&automatic!==this.signal){this.signal=automatic;this.signalClock=0;}
      else if(this.signalQuiet>1)this.signal='off';
    }else if(this.signal==='left'||this.signal==='right'){
      const turn=Math.atan2(Math.sin(this.heading-this.signalHeading),Math.cos(this.heading-this.signalHeading));
      this.signalTurn=Math.max(this.signalTurn,turn*(this.signal==='left'?1:-1));
      if(this.signalTurn>.3&&Math.abs(this.steering)<.12){this.signal='off';this.manualSignal=false;}
    }
  }

  /** Motor-only vertical settling; unstable contacts use enterDynamics above. */
  private fallWithoutSupport(dt:number):void{
    const c=Math.cos(this.heading),s=Math.sin(this.heading),tops:number[]=[];
    for(const dx of [-WHEEL_X,WHEEL_X])for(const dz of [-WHEEL_Z,WHEEL_Z]){
      const top=this.floorAt(this.location.x+c*dx+s*dz,this.location.z-s*dx+c*dz,this.location.y-RIDE_HEIGHT+.25,WORLD_HEIGHT);
      if(top!==null)tops.push(top);
    }
    const highest=tops.length?Math.max(...tops):-Infinity,target=highest+RIDE_HEIGHT;
    // Do not pull a remaining supported wheel through the road beside a pit.
    if(target>=this.location.y-.003){
      this.fallSpeed=0;
      const support=this.groundSupport(this.location.x,this.location.z,this.heading,this.location.y-RIDE_HEIGHT,true);
      if(support){this.grounded=true;this.applySupport(support);}return;
    }
    this.fallSpeed=Math.min(35,this.fallSpeed+9.81*dt);
    const destination=Math.max(target,this.location.y-this.fallSpeed*dt),distance=this.location.y-destination;
    const steps=Math.max(1,Math.ceil(distance/.12)),candidate=this.location.clone();
    for(let i=0;i<steps;i++){
      candidate.y=this.location.y-distance/steps;
      if(!this.driveClear(candidate,this.heading)||!this.vehicle.canOccupy(candidate,this.orientation)){this.fallSpeed=0;break;}
      this.location.y=candidate.y;
    }
    this.grounded=Number.isFinite(target)&&Math.abs(this.location.y-target)<.003;
    if(this.grounded){this.fallSpeed=0;const support=this.groundSupport(this.location.x,this.location.z,this.heading,highest,true);if(support)this.applySupport(support);}
  }

  private groundSupport(x: number, z: number, heading: number, currentFloor: number, parked=false): Support | null {
    const values: number[] = [], c = Math.cos(heading), s = Math.sin(heading);
    for (const dx of [-WHEEL_X, WHEEL_X]) for (const dz of [-WHEEL_Z, WHEEL_Z]) {
      const px = x + c * dx + s * dz, pz = z - s * dx + c * dz;
      const floor = this.floorAt(px, pz, currentFloor + .25,parked?WORLD_HEIGHT:4);
      if (floor === null || (!parked&&(floor < currentFloor - 2.05||floor<=12))) return null;
      // The tyre reaches a curb before its axle does. A circular envelope
      // raises the contact gradually on a usable tread, rather than burying
      // the rim or switching a valid graded road into crash physics.
      let contact=floor;
      const wheelYaw=heading+(dz<0?this.steering*.62/(1+this.speed*this.speed/100):0),wc=Math.cos(wheelYaw),ws=Math.sin(wheelYaw);
      for(const d of [-.398,-.37,-.30,-.18,0,.18,.30,.37,.398])for(const side of [-.112,.112]){
        const top=this.floorAt(px-ws*d+wc*side,pz-wc*d-ws*side,currentFloor+.65,parked?WORLD_HEIGHT:4);
        if(top!==null)contact=Math.max(contact,top-WHEEL_RADIUS+Math.sqrt(Math.max(0,WHEEL_RADIUS**2-d*d)));
      }
      values.push(contact);
    }
    return { highest: Math.max(...values), average: values.reduce((a,b) => a+b,0) / 4, front: (values[0]+values[2])/2, rear: (values[1]+values[3])/2, left: (values[0]+values[1])/2, right: (values[2]+values[3])/2,heights:values };
  }

  private alignToGround():void{
    const support=this.groundSupport(this.location.x,this.location.z,this.heading,this.location.y-RIDE_HEIGHT,true);
    if(!support)return;
    this.location.y=support.highest+RIDE_HEIGHT;this.applySupport(support);this.grounded=true;this.fallSpeed=0;
    this.vehicle.body.setTranslation(this.location,false);this.model.root.position.copy(this.location);this.applyModelPose(true);
  }
  private applySupport(support:Support):void{
    this.pitch=clamp(Math.atan2(support.front-support.rear,2*WHEEL_Z),-.4,.4);
    this.bank=clamp(Math.atan2(support.right-support.left,2*WHEEL_X),-.3,.3);
    this.suspension=support.average-support.highest-.18;
    // Finite travel: a tyre may hang over a hole, but cannot extend metres
    // below the chassis merely to manufacture a contact with the seabed.
    this.wheelHeights=this.supportWheelHeights(support);
  }
  private supportWheelHeights(support:Support):number[]{
    const pitch=clamp(Math.atan2(support.front-support.rear,2*WHEEL_Z),-.4,.4),bank=clamp(Math.atan2(support.right-support.left,2*WHEEL_X),-.3,.3);
    return support.heights.map((height,i)=>{
      const x=i<2?-WHEEL_X:WHEEL_X,z=i%2?WHEEL_Z:-WHEEL_Z;
      const plane=support.average+Math.sin(bank)*x-Math.sin(pitch)*z;
      return clamp(height,plane-.22,plane+.22);
    });
  }

  private tyresClear(position:Vec3,heading:number,heights:readonly number[]):boolean{
    const c=Math.cos(heading),s=Math.sin(heading);let wheel=0;
    for(const x of [-WHEEL_X,WHEEL_X])for(const z of [-WHEEL_Z,WHEEL_Z]){
      const ax=position.x+c*x+s*z,az=position.z-s*x+c*z,y=heights[wheel++]+WHEEL_RADIUS,wheelYaw=heading+(z<0?this.steering*.62/(1+this.speed*this.speed/100):0),wc=Math.cos(wheelYaw),ws=Math.sin(wheelYaw);
      for(let i=0;i<32;i++){const a=i*Math.PI/16,d=Math.sin(a)*(WHEEL_RADIUS+.008),h=y+Math.cos(a)*WHEEL_RADIUS+.005;
        for(const side of [-.112,.112])if(this.world.getVoxel(Math.floor(ax-ws*d+wc*side),Math.floor(h),Math.floor(az-wc*d-ws*side)))return false;
      }
    }return true;
  }
  private restoredTerrainOverlap():boolean{
    const q=new Quaternion().copy(this.vehicle.body.rotation()),margin=.04;
    for(const part of [...CAR_CONTACT_BOXES,...CAR_ROOF_BOXES,...CAR_MIRRORS]){
      const center=new Vector3().copy(part.center).applyQuaternion(q).add(this.location),half={x:part.half.x-margin,y:part.half.y-margin,z:part.half.z-margin};
      if(half.x<=0||half.y<=0||half.z<=0)continue;
      const b=orientedCollisionBounds(center,q,half);
      for(let z=Math.floor(b.minZ);z<=Math.floor(b.maxZ);z++)for(let x=Math.floor(b.minX);x<=Math.floor(b.maxX);x++)for(let y=Math.floor(b.minY);y<=Math.floor(b.maxY);y++)if(this.world.getVoxel(x,y,z)&&obstaclesIntersect(b,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1}))return true;
    }
    for(const x of [-WHEEL_X,WHEEL_X])for(const z of [-WHEEL_Z,WHEEL_Z])for(let i=0;i<24;i++)for(const side of [-.075,.075]){
      const a=i*Math.PI/12,p=new Vector3(x+side,-.46+Math.cos(a)*(WHEEL_RADIUS-margin),z+Math.sin(a)*(WHEEL_RADIUS-margin)).applyQuaternion(q).add(this.location);
      if(this.world.getVoxel(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)))return true;
    }
    return false;
  }
  private shellGroundClear(position:Vec3,heading:number,support:Support,props:readonly SceneObstacle[]=this.obstacleProvider()):boolean{
    const pitch=clamp(Math.atan2(support.front-support.rear,2*WHEEL_Z),-.4,.4),bank=clamp(Math.atan2(support.right-support.left,2*WHEEL_X),-.3,.3),suspension=support.average-support.highest-.18;
    const q=new Quaternion().setFromEuler(new Euler(pitch,heading,bank,'YXZ'));
    for(const p of SHELL_GROUND_BOXES){const centre=new Vector3().copy(p.center).applyQuaternion(q).add(position);centre.y+=suspension;const b=orientedCollisionBounds(centre,q,p.half);
      for(let z=Math.floor(b.minZ);z<=Math.floor(b.maxZ);z++)for(let x=Math.floor(b.minX);x<=Math.floor(b.maxX);x++)for(let y=Math.floor(b.minY+.006);y<=Math.floor(b.maxY);y++)if(this.world.getVoxel(x,y,z)&&obstaclesIntersect(b,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1}))return false;
      if(props.some(prop=>prop.surface&&surfaceIntersectsBox(prop,b)))return false;
    }return true;
  }
  private resetRenderPose():void{
    this.previousPosition.copy(this.location);this.renderPosition.copy(this.location);
    this.previousOrientation.copy(this.vehicle.body.rotation());this.previousHeading=this.heading;
    this.previousWheelHeights=this.wheelHeights.slice();
    this.model.root.position.copy(this.location);this.model.root.quaternion.copy(this.previousOrientation);
  }
  private applyModelPose(immediate:boolean,dt=0,alpha=1):void{
    const blend=immediate?1:1-Math.exp(-dt*12);
    this.model.shell.rotation.x+=(this.pitch-this.model.shell.rotation.x)*blend;
    this.model.shell.rotation.z+=(this.bank-this.model.shell.rotation.z)*blend;
    this.model.shell.position.y+=(this.suspension-this.model.shell.position.y)*blend;
    // Exact tyre contact is independent of the body's spring animation.
    if(this.grounded)this.model.setWheelHeights(this.wheelHeights.map((y,i)=>this.previousWheelHeights[i]+(y-this.previousWheelHeights[i])*alpha+WHEEL_RADIUS-this.model.root.position.y));
  }

  private floorAt(x: number, z: number, maxTop: number,depth=4): number | null {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < this.world.bounds.minX || ix >= this.world.bounds.maxX || iz < this.world.bounds.minZ || iz >= this.world.bounds.maxZ) return null;
    for (let y = Math.min(WORLD_HEIGHT - 1, Math.floor(maxTop - 1 + .0001)); y >= Math.max(0, Math.floor(maxTop - depth)); y--) {
      if (this.world.getVoxel(ix, y, iz)) return Math.max(y+1,this.surfaceProvider?.(x,z,depth===WORLD_HEIGHT?WORLD_HEIGHT:maxTop)??-Infinity);
    }
    return null;
  }

  private driveClear(position:Vec3,heading:number):boolean{return this.staticClear(position,heading,this.obstacleProvider(),this.physics.handlesPedestrianContacts);}
  private staticClear(position: Vec3, heading: number, props: readonly SceneObstacle[] = this.obstacleProvider(),allowPedestrians=false): boolean {
    const c = Math.cos(heading), s = Math.sin(heading), ac = Math.abs(c), as = Math.abs(s);
    const extentX = ac * HALF_WIDTH + as * HALF_LENGTH, extentZ = as * HALF_WIDTH + ac * HALF_LENGTH;
    const b = this.world.bounds;
    if (position.x - extentX < b.minX || position.x + extentX >= b.maxX || position.z - extentZ < b.minZ || position.z + extentZ >= b.maxZ) return false;
    this.clearanceRotation.set(0,Math.sin(heading/2),0,Math.cos(heading/2));
    // Match Rapier's contact skin so a settled bumper can return to the road
    // motor instead of treating submillimetre solver contact as penetration.
    CAR_CLEARANCE_BOXES.forEach((part,i)=>orientedCollisionBounds(this.clearanceCenter.copy(part.center).applyQuaternion(this.clearanceRotation).add(position),this.clearanceRotation,{x:part.half.x-.004,y:part.half.y-.004,z:part.half.z-.004},this.clearanceBounds[i]));
    for(const obstacle of props)if(!(allowPedestrians&&obstacle.pedestrianId!==undefined)&&!obstacle.surface&&this.clearanceBounds.some(part=>obstaclesIntersect(part,obstacle)))return false;
    const cellProjection = .5 * (ac + as);
    for (let z = Math.floor(position.z - extentZ); z <= Math.floor(position.z + extentZ); z++) for (let x = Math.floor(position.x - extentX); x <= Math.floor(position.x + extentX); x++) {
      const dx = x + .5 - position.x, dz = z + .5 - position.z;
      if (Math.abs(dx * c - dz * s) >= HALF_WIDTH + cellProjection-.004 || Math.abs(dx * s + dz * c) >= HALF_LENGTH + cellProjection-.004) continue;
      for (let y = Math.floor(position.y - .36 + .001); y <= Math.floor(position.y + .8 - .001); y++) if (this.world.getVoxel(x, y, z)) return false;
    }
    for(const part of this.clearanceBounds.slice(1))for(let z=Math.floor(part.minZ);z<=Math.floor(part.maxZ);z++)for(let x=Math.floor(part.minX);x<=Math.floor(part.maxX);x++)for(let y=Math.floor(part.minY);y<=Math.floor(part.maxY);y++)if(this.world.getVoxel(x,y,z)&&obstaclesIntersect(part,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1}))return false;
    const support=this.groundSupport(position.x,position.z,heading,position.y-RIDE_HEIGHT);
    if(support&&!this.tyresClear(position,heading,this.supportWheelHeights(support)))return false;
    if(support&&!this.shellGroundClear(position,heading,support,props))return false;
    return true;
  }

  /** Topmost solid must itself be road: roofs, grass shelves and covered roads are excluded. */
  private roadSurfaceAt(x:number,z:number):number|null {
    const ix=Math.floor(x),iz=Math.floor(z);
    if(!this.world.contains(ix,0,iz))return null;
    const offset=(ix&31)+32*(iz&31);
    for(let cy=(WORLD_HEIGHT-1)>>5;cy>=0;cy--){
      const chunk=this.world.chunks.get(`${ix>>5},${cy},${iz>>5}`);if(!chunk)continue;
      for(let ly=31;ly>=0;ly--){
        const material=chunk.voxels[offset+1024*ly];if(!material)continue;
        return material===Material.Road||material===Material.Stripe?cy*32+ly+1:null;
      }
    }
    return null;
  }

  private roadHeadingsAt(x:number,z:number,top:number):number[] {
    const headings:number[]=[],delta=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
    const addAxis=(heading:number)=>{
      const pair=[heading,Math.atan2(Math.sin(heading+Math.PI),Math.cos(heading+Math.PI))].sort((a,b)=>delta(a,this.heading)-delta(b,this.heading));
      for(const value of pair)if(!headings.some(old=>delta(old,value)<.001))headings.push(value);
    };
    let nearest=12**2,tangent:number|undefined;
    for(const road of REGION_ROADS)for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length)),distance=(x-a.x-dx*t)**2+(z-a.z-dz*t)**2;
      if(distance<nearest&&Math.abs(a.y+(b.y-a.y)*t+1-top)<1.5){nearest=distance;tangent=Math.atan2(-dx,-dz);}
    }
    if(tangent!==undefined)addAxis(tangent);
    const horizontal=[this.roadSurfaceAt(x-3,z),this.roadSurfaceAt(x+3,z)].every(y=>y!==null&&Math.abs(y-top)<=1);
    const vertical=[this.roadSurfaceAt(x,z-3),this.roadSurfaceAt(x,z+3)].every(y=>y!==null&&Math.abs(y-top)<=1);
    const axes:number[]=[];if(horizontal)axes.push(-Math.PI/2);if(vertical)axes.push(0);
    axes.sort((a,b)=>Math.min(delta(a,this.heading),delta(a+Math.PI,this.heading))-Math.min(delta(b,this.heading),delta(b+Math.PI,this.heading)));
    for(const axis of axes)addAxis(axis);
    if(!headings.some(old=>delta(old,this.heading)<.001))headings.push(this.heading);
    return headings;
  }

  private listen(target: EventTarget, type: string, listener: (event: Event) => void): void {
    target.addEventListener(type, listener); this.listeners.push(() => target.removeEventListener(type, listener));
  }
}
