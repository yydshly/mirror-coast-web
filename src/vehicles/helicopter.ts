import { Euler, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { CollapsePhysics, type ManagedAircraft } from '../destruction/physics';
import type { Vec3 } from '../destruction/types';
import { COAST_ROUTE, HELICOPTER_SPAWN, HELIPAD } from '../route/coast-route';
import type { VoxelWorld } from '../world/voxel';
import { createHelicopterModel, type HelicopterModel } from './model';
import { RotorAudio } from './rotor-audio';
import type { HelicopterState, HelicopterViewState } from './types';
import { VehicleOrbit } from '../input/vehicle-orbit';
import { clipVehicleCamera } from './chase-camera';
import type { SceneObstacle } from '../input/scene-collisions';
import {HELICOPTER_FORWARD_SPEED,HELICOPTER_REVERSE_SPEED,HELICOPTER_STRAFE_SPEED,HELICOPTER_MANUAL_ACCELERATION,HELICOPTER_MANUAL_BRAKING,HELICOPTER_MANUAL_YAW_RATE} from './driving-tuning';
import {ReturnDeparture,RETURN_LABELS,type ReturnPhase} from './return-flight';
import {helipadClear} from './helicopter-access';

export type HelicopterInput = { pitch: number; strafe: number; yaw: number; lift: number };
type Callbacks = { onNotice: (message: string) => void; canvas?: HTMLCanvasElement;canLand?:()=>boolean;flightObstacles?:()=>readonly SceneObstacle[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const shortestAngle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
const SKID_DROP = 1.46;

/** Arcade lift and velocity control, integrated through Rapier's actual fixed step. */
export class Helicopter {
  private readonly vehicle: ManagedAircraft;
  private readonly model: HelicopterModel;
  private readonly audio = new RotorAudio();
  private readonly keys = new Set<string>();
  private input: HelicopterInput = { pitch: 0, strafe: 0, yaw: 0, lift: 0 };
  private externalInput = false;
  private piloting = false;
  private autopilot = false;
  private engineOn = false;
  private rpm = 0;
  private heading = 0;
  private hoverY = HELICOPTER_SPAWN.y;
  private routeIndex = 0;
  private routeComplete = false;
  private tourStarted = false;
  private flightTime = 0;
  private landingTime = 0;
  private lastNotice = -10;
  private bankCommand = 0;
  private cameraReady = false;
  private readonly location = new Vector3();
  private readonly velocity = new Vector3();
  private readonly desiredVelocity = new Vector3();
  private readonly lookPoint = new Vector3();
  private readonly desiredLook = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly focus = new Vector3();
  private readonly orbit: VehicleOrbit;
  private readonly orientation = new Quaternion();
  private readonly attitude=new Euler(0,0,0,'YXZ');
  private pitchAngle=0;
  private bankAngle=0;
  private recoveryPending=false;
  private flightMode:'tour'|'return'='tour';
  private returnPhase:ReturnPhase='planning';
  private departure:ReturnDeparture|undefined;
  private departureIndex=0;
  private departureHeading=0;
  private holdingReason:'route'|'pad'='route';
  private landingCheck=-Infinity;
  private landingAvailable=true;
  private returnDistance=Infinity;
  private returnStall=0;
  private readonly previousPosition=new Vector3().copy(HELICOPTER_SPAWN);
  private readonly previousOrientation=new Quaternion();
  private previousHeading=0;
  private readonly renderPosition=new Vector3();
  private readonly acceptedOrientation=new Quaternion();
  private pausedVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private visibilitySuspended=false;
  private removed = false;
  private readonly listeners: Array<() => void> = [];
  private obstacleProvider: () => readonly SceneObstacle[] = () => [];

  private constructor(scene: Scene, private physics: CollapsePhysics, private voxelWorld: VoxelWorld, private callbacks: Callbacks) {
    this.orbit = new VehicleOrbit(callbacks.canvas ?? (typeof document !== 'undefined' ? document.querySelector?.('#world') as HTMLCanvasElement | null : null) ?? undefined,{minDistanceScale:.28});
    this.model = createHelicopterModel();
    scene.add(this.model.root);
    this.vehicle = physics.createVehicle(HELICOPTER_SPAWN, (dt) => this.fixedStep(dt));
    this.location.copy(HELICOPTER_SPAWN);
    this.model.root.position.copy(this.location);
    if (typeof document !== 'undefined') {
      this.listen(document, 'keydown', (event) => {
        const key = event as KeyboardEvent;
        if (!this.piloting || key.repeat || (key.target as HTMLElement)?.matches?.('input,textarea,select,button,summary,a,[contenteditable="true"]')) return;
        if (!['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight'].includes(key.code)) return;
        key.preventDefault();
        this.keys.add(key.code); this.externalInput = false;
        const wasAutomatic=this.autopilot;
        this.takeManualControl(key.code!=='ShiftLeft'&&key.code!=='ShiftRight');
        if (wasAutomatic) {
          this.callbacks.onNotice(this.flightMode==='return'?'自动返航已暂停，已切换手动驾驶；H 可重新规划返航。':'已切换手动驾驶；导览已暂停，可点击「继续游览」返回当前航段。');
        }
      });
      this.listen(document, 'keyup', (event) => this.keys.delete((event as KeyboardEvent).code));
    }
    if (typeof window !== 'undefined') this.listen(window, 'blur', () => this.keys.clear());
  }

  static create(scene: Scene, physics: CollapsePhysics, world: VoxelWorld, callbacks: Callbacks): Helicopter {
    return new Helicopter(scene, physics, world, callbacks);
  }

  get position(): Vector3 { return this.location; }
  get ownObstacles():readonly SceneObstacle[]{return this.vehicle.walkObstacles??[];}
  get orbitState() { return this.orbit.state; }
  get motionDiagnostics(){return{physical:{...this.location},rendered:{...this.model.root.position},rotation:{...this.vehicle.body.rotation()},alpha:this.physics.interpolationAlpha,lamps:this.model.lamps.map(l=>l.visible),sceneryColliders:this.vehicle.sceneryCount};}
  resetLook(): void { this.orbit.resetLook(); }
  orbitBy(dx: number, dy: number): void { this.orbit.orbitBy(dx,dy); }
  zoomBy(delta: number): void { this.orbit.zoomBy(delta); }
  /** Live decorative/traffic solids only; own aircraft is already excluded by Rapier. */
  setObstacleProvider(provider: () => readonly SceneObstacle[]): void { this.obstacleProvider=provider; }

  get viewState(): HelicopterViewState {
    const ground = this.groundHeight(this.location.x, this.location.z);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const altitude = Math.max(0, this.location.y - ground - SKID_DROP);
    return {
      piloting: this.piloting, autopilot: this.autopilot, engineOn: this.engineOn,
      rpm: this.rpm, speed, altitude, grounded: altitude < .32 && Math.abs(this.velocity.y) < .5,
      routeIndex: this.routeIndex, waypoint: this.flightMode==='return'?!this.autopilot&&!this.routeComplete?'手动驾驶 · 返航已暂停':RETURN_LABELS[this.returnPhase]:COAST_ROUTE[this.routeIndex]?.name ?? '返回停机坪', routeComplete: this.routeComplete,
      tourStatus:this.routeComplete?'complete':this.autopilot?'active':this.tourStarted?'paused':'idle',
      waypointDistance:this.location.distanceTo(this.flightMode==='return'?HELIPAD.position:COAST_ROUTE[this.routeIndex].position),
      flightMode:this.flightMode,...this.flightMode==='return'?{returnPhase:this.returnPhase,returnAltitude:this.departure?.altitude}:{},
    };
  }

  setMuted(muted: boolean): void { this.audio.setMuted(muted); }

  setPiloting(active: boolean): void {
    if (this.removed || this.piloting === active) return;
    this.keys.clear(); this.input = { pitch: 0, strafe: 0, yaw: 0, lift: 0 }; this.externalInput = false;
    this.piloting = active;
    this.visibilitySuspended=false;
    this.orbit.setEnabled(active);
    if (active) {
      const grounded = this.viewState.grounded;
      // A returned aircraft keeps its debrief until a deliberate departure.
      this.engineOn = !this.routeComplete;
      this.hoverY = this.location.y + (grounded&&!this.routeComplete ? 4.2 : 0);
      this.vehicle.setActive(true);
      this.vehicle.body.setLinvel(this.pausedVelocity, true);
      this.cameraReady = false;
      this.resetRenderPose();
      this.callbacks.onNotice('W/S 前后，Space 上升、Shift 下降；鼠标拖动环视，滚轮可拉近查看驾驶舱，R 回正');
    } else {
      this.pausedVelocity = { ...this.vehicle.body.linvel() };
      this.vehicle.setActive(false);
      this.autopilot = false;
      if (this.viewState.grounded) this.engineOn = false;
    }
  }

  setAutopilot(active: boolean): void {
    if(active&&this.flightMode==='return'){this.startReturnHome();return;}
    if(active&&this.autopilot&&this.piloting)return;
    if (active && !this.piloting) this.setPiloting(true);
    this.autopilot = active;
    if (active) {
      if (this.routeComplete) this.routeIndex = 0;
      this.routeComplete = false; this.tourStarted=true; this.engineOn = true; this.landingTime = 0;
      this.keys.clear(); this.externalInput = false;
      this.callbacks.onNotice(`自动游览：${COAST_ROUTE[this.routeIndex].name}。鼠标拖动环视，点击「暂停游览」悬停；飞行按键可手动接管。`);
    } else {this.releaseControls();this.callbacks.onNotice(this.flightMode==='return'?'自动返航已暂停，正在悬停。H 或「继续返航」可重新规划。':'导览已暂停，正在悬停。点击「继续游览」接着飞，或使用飞行按键自己驾驶。');}
  }

  startTour():void{
    if(this.flightMode==='return'){this.autopilot=false;this.routeIndex=0;this.routeComplete=false;this.tourStarted=false;}
    this.flightMode='tour';this.departure=undefined;this.setAutopilot(true);
  }

  /** A flight command, never a pose reset. Repeated H does not restart a leg. */
  startReturnHome():void{
    if(this.autopilot&&this.flightMode==='return'&&this.returnPhase!=='holding')return;
    if(!this.piloting)this.setPiloting(true);
    this.flightMode='return';this.routeIndex=COAST_ROUTE.length-1;this.tourStarted=true;
    const actualVelocity=this.vehicle.body.linvel();
    if(Math.hypot(this.location.x-HELIPAD.position.x,this.location.z-HELIPAD.position.z)<.65&&this.viewState.grounded&&Math.hypot(actualVelocity.x,actualVelocity.y,actualVelocity.z)<.65){
      this.routeComplete=true;this.autopilot=false;this.engineOn=false;this.returnPhase='complete';this.callbacks.onNotice('直升机已在停机坪停稳，按 F 下机步行。');return;
    }
    this.routeComplete=false;this.autopilot=true;this.engineOn=true;this.landingTime=0;this.keys.clear();this.externalInput=false;
    this.hoverY=this.location.y;this.departureHeading=this.heading;this.departureIndex=0;this.landingCheck=-Infinity;
    this.departure=undefined;
    if(Math.hypot(actualVelocity.x,actualVelocity.z)>.25||Math.abs(actualVelocity.y)>.3)this.setReturnPhase('braking');else this.planReturnDeparture();
    this.callbacks.onNotice('开始自动返航：先寻找安全离场通路，再爬升、回航并降落。飞行按键可随时接管。');
  }

  /** Input adapter also supports deterministic tests and future gamepad controls. */
  setInput(value: Partial<HelicopterInput>): void {
    this.input = {
      pitch: clamp(value.pitch ?? 0, -1, 1), strafe: clamp(value.strafe ?? 0, -1, 1),
      yaw: clamp(value.yaw ?? 0, -1, 1), lift: clamp(value.lift ?? 0, -1, 1),
    };
    this.externalInput = true;
    if (Object.values(this.input).some(component => component !== 0)) {
      this.takeManualControl(this.input.lift>=0||this.input.pitch!==0||this.input.strafe!==0||this.input.yaw!==0);
    }
  }
  /** Reading a panel releases manual commands without leaving the aircraft. */
  releaseControls(pauseTour=true):void{
    if(pauseTour){this.autopilot=false;this.departure=undefined;}
    this.keys.clear();this.input={pitch:0,strafe:0,yaw:0,lift:0};this.externalInput=true;this.hoverY=this.location.y;this.orbit.cancelDrag();
  }

  /** Background tabs freeze physical flight without cancelling the route.
   * Returning resumes the actual pose; no unseen legs are completed. */
  suspendForVisibility():boolean{
    if(!this.piloting||!this.autopilot)return false;
    if(this.visibilitySuspended)return true;
    this.pausedVelocity={...this.vehicle.body.linvel()};
    this.releaseControls(false);this.visibilitySuspended=true;this.vehicle.setActive(false);
    return true;
  }
  resumeAfterVisibility():void{
    if(!this.visibilitySuspended)return;
    this.visibilitySuspended=false;
    if(!this.piloting)return;
    this.vehicle.setActive(true);this.vehicle.body.setLinvel(this.pausedVelocity,true);this.cameraReady=false;
  }

  private restartCompletedRoute(): void {
    if (!this.routeComplete) return;
    this.routeComplete = false;
    this.tourStarted = false;
    this.routeIndex = 0;
    this.flightMode='tour';this.departure=undefined;
  }

  private takeManualControl(startEngine=true):void{
    const automatic=this.autopilot;this.restartCompletedRoute();this.autopilot=false;this.departure=undefined;
    if(automatic)this.hoverY=this.location.y;
    if(startEngine&&!this.engineOn){this.engineOn=true;if(this.viewState.grounded)this.hoverY=this.location.y+3.2;}
  }

  restore(state: HelicopterState): void {
    this.setPiloting(false);
    this.vehicle.setActive(false);
    this.vehicle.body.setTranslation(state.position, false);
    this.vehicle.body.setRotation(state.rotation, false);
    this.heading = Math.atan2(2 * (state.rotation.w * state.rotation.y + state.rotation.x * state.rotation.z), 1 - 2 * (state.rotation.y ** 2 + state.rotation.z ** 2));
    this.pausedVelocity = { ...state.linearVelocity };
    this.routeIndex = clamp(Math.floor(state.routeIndex), 0, COAST_ROUTE.length - 1);
    this.flightMode=state.flightMode??'tour';this.departure=undefined;
    this.engineOn = state.engineOn;
    this.rpm = state.engineOn ? .85 : 0;
    this.location.copy(state.position); this.velocity.set(0, 0, 0); this.hoverY = state.position.y;
    this.model.root.position.copy(this.location); this.model.root.quaternion.copy(state.rotation);
    this.attitude.setFromQuaternion(new Quaternion().copy(state.rotation),'YXZ');this.pitchAngle=this.attitude.x;this.bankAngle=this.attitude.z;
    this.recoveryPending=true;
    this.resetRenderPose();
    const atPad=Math.hypot(this.location.x-HELIPAD.position.x,this.location.z-HELIPAD.position.z)<1.2;
    this.routeComplete = this.routeIndex === COAST_ROUTE.length - 1 && atPad && this.viewState.grounded&&state.tourStatus!=='paused'&&state.tourStatus!=='active';
    this.tourStarted = !this.routeComplete&&(state.tourStatus==='active'||state.tourStatus==='paused'||this.routeIndex>0);
    this.returnPhase=this.routeComplete?'complete':'planning';
  }

  snapshot(): HelicopterState {
    return {
      position: { ...this.vehicle.body.translation() }, rotation: { ...this.vehicle.body.rotation() },
      linearVelocity: this.piloting&&!this.visibilitySuspended ? { ...this.vehicle.body.linvel() } : { ...this.pausedVelocity },
      engineOn: this.engineOn, routeIndex: this.routeIndex,
      tourStatus:this.viewState.tourStatus,
      ...this.flightMode==='return'?{flightMode:'return' as const}:{},
    };
  }

  beforePhysics(dt: number): void {
    if (this.removed||this.visibilitySuspended) return;
    if(this.piloting||this.recoveryPending)this.physics.ensureVehicleTerrain(this.voxelWorld,this.location,this.recoveryPending?16:8);
    this.vehicle.syncProps(this.obstacleProvider(),this.recoveryPending?6:0);
    if(this.recoveryPending){this.recoveryPending=false;this.recoverSavedOverlap();}
    if(this.autopilot&&this.flightMode==='return'&&this.returnPhase==='planning'){
      this.departure?.advance();
      if(this.departure?.status==='ready')this.setReturnPhase('climb');
      else if(this.departure?.status==='blocked')this.holdReturn('route');
    }
    const delta = clamp(dt, 0, .05);
    this.flightTime += delta;
    this.rpm += ((this.engineOn ? 1 : 0) - this.rpm) * (1 - Math.exp(-delta * (this.engineOn ? 1.35 : .85)));
    if (!this.externalInput) this.input = {
      pitch: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      strafe: (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0),
      yaw: (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0),
      lift: (this.keys.has('Space') ? 1 : 0) - (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0),
    };
    if (this.input.lift > 0) this.engineOn = true;
    this.audio.update(this.rpm, this.piloting);
  }

  afterPhysics(dt: number, camera: PerspectiveCamera): void {
    if (this.removed) return;
    const delta = clamp(dt, 0, .05);
    this.location.copy(this.vehicle.body.translation());
    this.velocity.copy(this.vehicle.body.linvel());
    const alpha=this.piloting&&!this.visibilitySuspended?this.physics.interpolationAlpha:1;
    this.renderPosition.lerpVectors(this.previousPosition,this.location,alpha);
    this.model.root.position.copy(this.renderPosition);
    this.orientation.copy(this.vehicle.body.rotation());
    this.model.root.quaternion.copy(this.previousOrientation).slerp(this.orientation,alpha);
    const forwardSpeed = -Math.sin(this.heading) * this.velocity.x - Math.cos(this.heading) * this.velocity.z;
    // Bank and pitch live on the rigid body, so the visual rotor cannot tilt
    // through an awning while its collision disc remains horizontal.
    this.model.airframe.rotation.set(0,0,0);
    this.model.mainRotor.rotation.y += delta * this.rpm * 43;
    this.model.tailRotor.rotation.x += delta * this.rpm * 170;
    this.model.updateRotorAppearance(this.rpm);
    this.model.updateLights(this.engineOn,this.flightTime,this.viewState.altitude<12);
    this.model.updateCabin(delta,this.piloting,{pitch:clamp(forwardSpeed/HELICOPTER_FORWARD_SPEED,-1,1),roll:this.bankCommand,yaw:this.input.yaw,lift:this.autopilot?clamp(this.desiredVelocity.y/5.2,-1,1):this.input.lift,speed:Math.hypot(this.velocity.x,this.velocity.z),altitude:this.viewState.altitude,rpm:this.rpm});
    if (!this.piloting) return;
    this.orbit.update(delta,Math.hypot(this.velocity.x,this.velocity.z));
    const orbit=this.orbit.state;

    const heading=this.previousHeading+shortestAngle(this.heading-this.previousHeading)*alpha;
    const forwardX = -Math.sin(heading), forwardZ = -Math.cos(heading),position=this.renderPosition;
    this.focus.set(position.x, position.y + 1.0, position.z);
    const angle=heading+Math.atan2(3.8,15)+orbit.yaw,elevation=Math.atan2(5,Math.hypot(15,3.8))+orbit.pitch;
    const radius=Math.hypot(15,3.8,5)*orbit.distanceScale,flat=radius*Math.cos(elevation);
    this.cameraTarget.set(this.focus.x+Math.sin(angle)*flat,this.focus.y+Math.sin(elevation)*radius,this.focus.z+Math.cos(angle)*flat);
    const cameraProps=this.obstacleProvider();
    clipVehicleCamera(this.voxelWorld,this.focus,this.cameraTarget,this.vehicle.cameraDistance,this.cameraTarget,cameraProps);
    const ahead=7*Math.max(0,Math.cos(orbit.yaw))**2;
    const nextLook = this.desiredLook.set(position.x + forwardX * ahead, position.y + 1.0, position.z + forwardZ * ahead);
    if (!this.cameraReady) {
      camera.position.copy(this.cameraTarget); this.lookPoint.copy(nextLook); this.cameraReady = true;
    } else {
      camera.position.lerp(this.cameraTarget, 1 - Math.exp(-delta * 3.8));
      this.lookPoint.lerp(nextLook, 1 - Math.exp(-delta * 5));
    }
    clipVehicleCamera(this.voxelWorld,this.focus,camera.position,this.vehicle.cameraDistance,camera.position,cameraProps);
    camera.up.set(0, 1, 0); camera.lookAt(this.lookPoint);
  }

  dispose(): void {
    if (this.removed) return;
    this.setPiloting(false); this.removed = true;
    this.orbit.dispose(); this.listeners.forEach(remove => remove()); this.vehicle.dispose(); this.model.dispose(); this.audio.dispose();
  }

  private fixedStep(dt: number): void {
    const body = this.vehicle.body;
    this.location.copy(body.translation()); this.velocity.copy(body.linvel());
    this.previousPosition.copy(this.location);this.previousOrientation.copy(body.rotation());this.previousHeading=this.heading;
    this.desiredVelocity.set(0, 0, 0);
    let desiredYawRate = this.input.yaw * HELICOPTER_MANUAL_YAW_RATE;
    if(this.autopilot&&this.flightMode==='return'){
      desiredYawRate=this.returnControl(dt);
    } else if (this.autopilot) {
      const waypoint = COAST_ROUTE[this.routeIndex];
      const dx = waypoint.position.x - this.location.x, dz = waypoint.position.z - this.location.z;
      const horizontalDistance = Math.hypot(dx, dz);
      let targetY = waypoint.position.y;
      const final = this.routeIndex === COAST_ROUTE.length - 1;
      if (final) targetY = HELIPAD.position.y + SKID_DROP - .16;
      const dy = targetY - this.location.y;
      const desiredHeading = horizontalDistance > 1 ? Math.atan2(-dx, -dz) : 0;
      const angleError = shortestAngle(desiredHeading - this.heading);
      desiredYawRate = clamp(angleError * 1.5, -.8, .8);
      const turnAllowance = Math.max(.14, Math.cos(angleError));
      const horizontalSpeed = Math.min(final ? 2.0 : this.routeIndex === 0 ? 5 : 15, horizontalDistance * (final ? .8 : .55)) * turnAllowance;
      if (!(this.routeIndex === 0 && this.location.y < 27) && horizontalDistance > .05) {
        this.desiredVelocity.x = dx / horizontalDistance * horizontalSpeed;
        this.desiredVelocity.z = dz / horizontalDistance * horizontalSpeed;
      }
      this.desiredVelocity.y = clamp(dy * 1.05, final ? -1.5 : -4.5, 5.2);
      if (final) {
        if (horizontalDistance < .65 && this.vehicle.hasContact() && this.velocity.length() < .65) this.landingTime += dt;
        else this.landingTime = 0;
        if (this.landingTime > .75) {
          this.routeComplete = true; this.autopilot = false; this.engineOn = false;
          this.hoverY = this.location.y; body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          this.callbacks.onNotice('海岸导览完成，已在码头停稳。可前往渔港步行，或换汽车探索外围道路。');
        }
      } else if (horizontalDistance < waypoint.radius && Math.abs(dy) < (this.routeIndex === 0 ? 3 : waypoint.radius * .65)) {
        this.routeIndex++; this.callbacks.onNotice(`下一航段：${COAST_ROUTE[this.routeIndex].name}`);
      }
    } else {
      const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
      const forward=this.input.pitch*(this.input.pitch>=0?HELICOPTER_FORWARD_SPEED:HELICOPTER_REVERSE_SPEED),sideways=this.input.strafe*HELICOPTER_STRAFE_SPEED;
      this.desiredVelocity.x = -sin * forward + cos * sideways;
      this.desiredVelocity.z = -cos * forward - sin * sideways;
      const horizontal=this.desiredVelocity.length();if(horizontal>HELICOPTER_FORWARD_SPEED)this.desiredVelocity.multiplyScalar(HELICOPTER_FORWARD_SPEED/horizontal);
      if (Math.abs(this.input.lift) > .01) {
        this.hoverY = this.location.y;
        this.desiredVelocity.y = this.input.lift * (this.input.lift > 0 ? 5.2 : 3.8);
      } else this.desiredVelocity.y = clamp((this.hoverY - this.location.y) * 1.5, -3.5, 4);
    }

    if (this.terrainHeight(this.location.x, this.location.z) < 11.8 && this.location.y < 15.8 && this.engineOn) {
      this.desiredVelocity.y = Math.max(this.desiredVelocity.y, (16.3 - this.location.y) * 1.7);
      this.hoverY = Math.max(this.hoverY, 16.3);
      if (this.flightTime - this.lastNotice > 4) {
        this.lastNotice = this.flightTime; this.callbacks.onNotice('海面高度过低，正在自动拉升');
      }
    }
    if (this.location.y > 150) this.desiredVelocity.y = Math.min(this.desiredVelocity.y, (148 - this.location.y) * .7);
    // A finite city still permits coastal excursions; its soft edge brakes gently.
    const b = this.voxelWorld.bounds;
    // Return may start just outside the soft edge after manual braking. Allow
    // its safe climb there, then the planned cruise brings it back inside.
    if(!(this.autopilot&&this.flightMode==='return')){
      if (this.location.x < b.minX - 30) this.desiredVelocity.x = Math.max(this.desiredVelocity.x, (b.minX - 30 - this.location.x) * .6);
      if (this.location.x > b.maxX + 30) this.desiredVelocity.x = Math.min(this.desiredVelocity.x, (b.maxX + 30 - this.location.x) * .6);
      if (this.location.z < b.minZ - 30) this.desiredVelocity.z = Math.max(this.desiredVelocity.z, (b.minZ - 30 - this.location.z) * .6);
      if (this.location.z > b.maxZ + 30) this.desiredVelocity.z = Math.min(this.desiredVelocity.z, (b.maxZ + 30 - this.location.z) * .6);
    }
    const rightAcceleration = Math.cos(this.heading) * (this.desiredVelocity.x - this.velocity.x) - Math.sin(this.heading) * (this.desiredVelocity.z - this.velocity.z);
    const grounded=this.viewState.grounded,bankLimit = grounded ? .025 : .23;
    this.bankCommand = clamp(-rightAcceleration * .018 + desiredYawRate * .07, -bankLimit, bankLimit);
    const heading=shortestAngle(this.heading+desiredYawRate*dt),blend=1-Math.exp(-dt*4);
    const forwardSpeed=-Math.sin(this.heading)*this.velocity.x-Math.cos(this.heading)*this.velocity.z;
    const pitch=this.pitchAngle+(clamp(-forwardSpeed*.011,grounded?-.025:-.18,grounded?.025:.16)-this.pitchAngle)*blend;
    const bank=this.bankAngle+(this.bankCommand*this.rpm*this.rpm-this.bankAngle)*blend;
    this.orientation.setFromEuler(this.attitude.set(pitch,heading,bank,'YXZ'));
    // Setting a quaternion directly bypasses angular CCD. Reject a turn which
    // would sweep the tail/rotor into an obstacle instead of teleporting into it.
    if(this.orientation.angleTo(this.acceptedOrientation.copy(body.rotation()))<.00001||this.vehicle.clearAt(this.location,this.orientation)){
      this.heading=heading;this.pitchAngle=pitch;this.bankAngle=bank;body.setRotation(this.orientation,true);
    }
    body.resetForces(false);
    const mass = Math.max(1, body.mass());
    const engineReady = this.rpm > .72;
    const braking=this.desiredVelocity.x*this.velocity.x+this.desiredVelocity.z*this.velocity.z<=0;
    const acceleration=this.autopilot?this.flightMode==='return'?6.5:5:braking?HELICOPTER_MANUAL_BRAKING:HELICOPTER_MANUAL_ACCELERATION,gain=this.autopilot?2:2.6;
    const accelerationX = engineReady ? clamp((this.desiredVelocity.x - this.velocity.x) * gain, -acceleration, acceleration) : -this.velocity.x * 1.5;
    const accelerationZ = engineReady ? clamp((this.desiredVelocity.z - this.velocity.z) * gain, -acceleration, acceleration) : -this.velocity.z * 1.5;
    const lift = engineReady && this.engineOn ? 9.81 + clamp((this.desiredVelocity.y - this.velocity.y) * 3.2, -5.0, 7.0) : 0;
    body.addForce({ x: mass * accelerationX, y: mass * lift, z: mass * accelerationZ }, true);
    // Rotor collisions stop the body against the real world, not a sampled-height floor.
    if (this.vehicle.hasContact() && (this.desiredVelocity.length()>1||Math.abs(desiredYawRate)>.1) && this.location.y - this.groundHeight(this.location.x, this.location.z) > 2 && this.flightTime - this.lastNotice > 2.5) {
      this.lastNotice = this.flightTime;
      this.callbacks.onNotice('接触障碍，减速后向空旷处脱离');
    }
    if (this.location.y > 150) this.hoverY = Math.min(this.hoverY, 148);
  }

  private resetRenderPose():void{this.previousPosition.copy(this.location);this.renderPosition.copy(this.location);this.previousOrientation.copy(this.vehicle.body.rotation());this.previousHeading=this.heading;this.model.root.position.copy(this.location);this.model.root.quaternion.copy(this.previousOrientation);}

  private setReturnPhase(phase:ReturnPhase):void{this.returnPhase=phase;this.returnDistance=Infinity;this.returnStall=0;}
  private planReturnDeparture():void{
    this.departureHeading=this.heading;this.departureIndex=0;
    this.departure=new ReturnDeparture({...this.location},this.voxelWorld,this.obstacleProvider(),this.heading,this.callbacks.flightObstacles?.());this.setReturnPhase('planning');
  }
  private holdReturn(reason:'route'|'pad'):void{
    this.holdingReason=reason;this.hoverY=this.location.y;this.setReturnPhase('holding');
    this.callbacks.onNotice(reason==='pad'?'停机坪或进近通道被占用，正在悬停等待；清空后自动继续，飞行按键可接管。':'返航离场通路受阻，已悬停。请手动移到开阔处，再按 H 重新规划。');
  }
  private canLand():boolean{
    if(this.flightTime-this.landingCheck>.5){this.landingCheck=this.flightTime;this.landingAvailable=this.callbacks.canLand?.()??helipadClear(this.voxelWorld,this.obstacleProvider());}
    return this.landingAvailable;
  }
  private returnControl(dt:number):number{
    if(this.returnPhase==='braking'||this.returnPhase==='planning'||this.returnPhase==='holding'){
      this.desiredVelocity.y=clamp((this.hoverY-this.location.y)*1.5,-3.5,4);
      if(this.returnPhase==='braking'&&Math.hypot(this.velocity.x,this.velocity.z)<.25&&Math.abs(this.velocity.y)<.3)this.planReturnDeparture();
      if(this.returnPhase==='holding'&&this.holdingReason==='pad'&&this.canLand()){this.setReturnPhase('approach');this.callbacks.onNotice('停机坪通路恢复，继续自动进近。');}
      return 0;
    }
    const target=new Vector3(HELIPAD.position.x,this.departure?.altitude??112,HELIPAD.position.z);
    let maxSpeed=30,verticalDown=-6,desiredHeading=0;
    if(this.returnPhase==='climb'){
      const path=this.departure?.path??[];
      while(this.departureIndex<path.length&&this.location.distanceTo(path[this.departureIndex])<.65){this.departureIndex++;this.returnDistance=Infinity;this.returnStall=0;}
      if(this.departureIndex>=path.length)this.setReturnPhase('cruise');else target.copy(path[this.departureIndex]);
      maxSpeed=6;desiredHeading=this.departureHeading;
    }
    if(this.returnPhase==='approach'||this.returnPhase==='landing'){
      if(!this.canLand()){this.holdReturn('pad');return 0;}
      target.y=this.returnPhase==='landing'?HELIPAD.position.y+SKID_DROP-.16:30;maxSpeed=3;verticalDown=this.returnPhase==='landing'?-Math.min(2.6,Math.max(.7,(this.location.y-target.y)*.55)):-6;
    }
    const dx=target.x-this.location.x,dz=target.z-this.location.z,horizontal=Math.hypot(dx,dz),dy=target.y-this.location.y;
    if(this.returnPhase==='cruise')desiredHeading=horizontal>3?Math.atan2(-dx,-dz):0;
    const yawError=shortestAngle(desiredHeading-this.heading),speed=Math.min(maxSpeed,horizontal*.75);
    if(horizontal>.02){this.desiredVelocity.x=dx/horizontal*speed;this.desiredVelocity.z=dz/horizontal*speed;}
    this.desiredVelocity.y=clamp(dy*1.05,verticalDown,7.5);
    if(this.returnPhase==='cruise'&&horizontal<.65&&Math.abs(dy)<1&&this.velocity.length()<1.5&&Math.abs(yawError)<.08){
      if(this.canLand())this.setReturnPhase('approach');else this.holdReturn('pad');
    }else if(this.returnPhase==='approach'&&horizontal<.45&&Math.abs(dy)<.7&&Math.abs(this.velocity.y)<.9)this.setReturnPhase('landing');
    if(this.returnPhase==='landing'){
      if(horizontal<.65&&this.vehicle.hasContact()&&this.velocity.length()<.65)this.landingTime+=dt;else this.landingTime=0;
      if(this.landingTime>.75){this.routeComplete=true;this.autopilot=false;this.engineOn=false;this.hoverY=this.location.y;this.vehicle.body.setLinvel({x:0,y:0,z:0},true);this.setReturnPhase('complete');this.callbacks.onNotice('已自动返航并在码头停稳。按 F 下机，继续步行或驾车探索。');}
    }
    const distance=this.location.distanceTo(target);
    if(this.returnDistance-distance>.1){this.returnDistance=distance;this.returnStall=0;}
    else if(this.rpm>.75&&distance>1&&this.velocity.length()<.2){this.returnStall+=dt;if(this.returnStall>5)this.holdReturn('route');}
    return clamp(yawError*1.5,-.8,.8);
  }

  /** Old saves may already be inside scenery that previously had no collider.
   * Reconcile once on load; ordinary flight is always resolved by the solver. */
  private recoverSavedOverlap():void{
    const q=this.vehicle.body.rotation();if(this.vehicle.clearAt(this.location,q))return;
    const origin=this.location.clone(),candidate=new Vector3();
    for(let radius=.5;radius<=6;radius+=.5){
      const offsets=[{x:0,y:radius,z:0}];
      for(let i=0;i<12;i++)for(const dy of [0,radius*.5])offsets.push({x:Math.cos(i*Math.PI/6)*radius,y:dy,z:Math.sin(i*Math.PI/6)*radius});
      for(const offset of offsets){candidate.copy(origin).add(offset);if(!this.vehicle.clearAt(candidate,q))continue;
        this.vehicle.body.setTranslation(candidate,false);this.vehicle.body.setLinvel({x:0,y:0,z:0},false);this.location.copy(candidate);this.hoverY=candidate.y;this.pausedVelocity={x:0,y:0,z:0};this.resetRenderPose();
        this.callbacks.onNotice('旧停机位置与障碍重叠，已校正到附近安全位置。');return;
      }
    }
    this.callbacks.onNotice('旧停机位置被障碍包围，请先清理障碍或手动脱离，再按 H 自动返航。');
  }

  private groundHeight(x: number, z: number): number {
    return Math.max(12, this.terrainHeight(x, z));
  }

  private terrainHeight(x: number, z: number): number {
    const columnX = Math.floor(x), columnZ = Math.floor(z);
    for (let y = Math.min(95, Math.floor(this.location.y - .6)); y >= 0; y--) {
      if (this.voxelWorld.getVoxel(columnX, y, columnZ)) return y + 1;
    }
    return 0;
  }

  private listen(target: EventTarget, name: string, handler: (event: Event) => void): void {
    target.addEventListener(name, handler);
    this.listeners.push(() => target.removeEventListener(name, handler));
  }
}

