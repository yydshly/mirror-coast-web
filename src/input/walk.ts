import {obstacleIntersectsBody,obstacleTopAt,orientedCollisionBounds,type SceneObstacle,type SurfaceMotion} from './scene-collisions';
import { Box3,Euler, PerspectiveCamera, Quaternion,Vector3 } from 'three';
import { VoxelWorld, WORLD_HEIGHT, type Vector3Like } from '../world/voxel';
import { PointerLook, type MouseControlMode } from './pointer-look';
import type { WalkingCamera, WalkingViewMode } from './walk-camera';
import {GroundActions,type SeatTarget,type GroundInteraction} from './ground-actions';
import {SEA_LEVEL,MAX_WADING_DEPTH} from '../world/sea-level';
import {recoveryRoadPoints} from '../world/recovery-roads';
import {Material} from '../world/palette';

export const WALK_EYE_HEIGHT = 1.68;
const BODY_HEIGHT = 1.8;
const BODY_RADIUS = .29;
const EPSILON = .0001;
export const WALK_MAX_STEP = .32;
const MAX_STEP = WALK_MAX_STEP;

export type WalkInput = { x: number; z: number; run?: boolean; jump?: boolean; speed?:number };
export type WalkObstacle = SceneObstacle;

function overlapsFootprint(x: number, z: number, obstacle: WalkObstacle): boolean {
  return x + BODY_RADIUS > obstacle.minX + EPSILON && x - BODY_RADIUS < obstacle.maxX - EPSILON &&
    z + BODY_RADIUS > obstacle.minZ + EPSILON && z - BODY_RADIUS < obstacle.maxZ - EPSILON;
}

/** Small, deterministic character motor. Its position is the feet, in metres.
 * Collision reads authoritative voxels every step, including freshly dug holes.
 * The upright AABB is deliberately independent of the async render/collider mesh.
 */
export class VoxelWalker {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  grounded = false;
  recoveredLastStep = false;
  recoveryReason:'water'|'collision'='collision';
  landingSpeed=0;
  private readonly safePosition = new Vector3();
  private jumpHeld = false;
  private supportMotion:{motion:SurfaceMotion;frame:number}|undefined;
  private obstacleProvider: () => readonly WalkObstacle[] = () => [];
  private recoveryProbe:((position:Vector3Like)=>void)|undefined;
  private readonly postureBounds:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
  private readonly postureRotation=new Quaternion();
  private readonly postureVoxel=new Box3();

  constructor(private readonly world: VoxelWorld, initialFeet: Vector3Like = { x: 108, y: 16, z: 171 }, private readonly seaLevel = SEA_LEVEL) {
    this.position.copy(initialFeet);
    this.safePosition.copy(initialFeet);
    this.teleportEye({ x: initialFeet.x, y: initialFeet.y + WALK_EYE_HEIGHT, z: initialFeet.z });
  }

  get eyePosition(): Vector3 { return this.position.clone().add(new Vector3(0, WALK_EYE_HEIGHT, 0)); }

  /** Read the live prop list, so hidden/destroyed decoration cannot leave a wall. */
  setObstacleProvider(provider: () => readonly WalkObstacle[]): void {
    this.obstacleProvider = provider;
    // Attaching a graded surface to an existing voxel-floor save may lift the
    // feet a few centimetres. Reconcile locally rather than recovering sideways.
    const top=this.supportBelow(this.position.x,this.position.z,this.position.y+MAX_STEP);
    if(top!==null&&top>this.position.y&&top-this.position.y<=MAX_STEP&&this.canOccupy({x:this.position.x,y:top,z:this.position.z})){this.position.y=top;this.safePosition.copy(this.position);}
  }
  /** Refresh the live scenery list at a candidate, including distant fallback
   * roads. Ordinary movement keeps its existing per-frame collision cache. */
  setRecoveryProbe(probe:(position:Vector3Like)=>void):void{this.recoveryProbe=probe;}

  stop(): void { this.velocity.set(0, 0, 0); this.jumpHeld = false; }
  pauseInput(): void { this.velocity.x = 0; this.velocity.z = 0; this.jumpHeld = false; }

  /** An eye-height spawn is snapped to a nearby clear, dry standing surface.
   * This also handles an imported observer camera inside a wall or above a roof.
   */
  teleportEye(eye: Vector3Like): void {
    const finite = [eye.x, eye.y, eye.z].every(Number.isFinite);
    const source = finite ? eye : this.eyePosition;
    const b = this.world.bounds;
    const x = Math.max(b.minX + BODY_RADIUS, Math.min(b.maxX - BODY_RADIUS, source.x));
    const z = Math.max(b.minZ + BODY_RADIUS, Math.min(b.maxZ - BODY_RADIUS, source.z));
    const maxFeet = Math.max(this.seaLevel + 6, Math.min(WORLD_HEIGHT + 1, source.y - WALK_EYE_HEIGHT + MAX_STEP));
    let found: Vector3 | null = null;
    // A validated exit/seat position takes precedence over broad recovery.
    // On a low beach, the recovery ceiling can include the aircraft's rotor;
    // selecting that higher prop would lift a safe side-door exit into the air.
    const requestedFeet=source.y-WALK_EYE_HEIGHT;
    this.recoveryProbe?.({x,y:requestedFeet,z});
    const requestedFloor=this.standingSurface(x,z,requestedFeet+MAX_STEP);
    if(requestedFloor!==null&&requestedFloor>=requestedFeet-.65)found=new Vector3(x,requestedFloor,z);
    for (let radius = 0; radius <= 16 && !found; radius++) {
      for (let dz = -radius; dz <= radius && !found; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (radius && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const px = Math.max(b.minX + BODY_RADIUS, Math.min(b.maxX - BODY_RADIUS, x + dx));
        const pz = Math.max(b.minZ + BODY_RADIUS, Math.min(b.maxZ - BODY_RADIUS, z + dz));
        this.recoveryProbe?.({x:px,y:maxFeet,z:pz});const floor = this.standingSurface(px, pz, maxFeet);
        if (floor !== null) { found = new Vector3(px, floor, pz); break; }
      }
    }
    if(!found){this.recoveryProbe?.(this.safePosition);if(this.safePosition.y>=this.seaLevel&&this.canOccupy(this.safePosition)&&this.hasSafeFooting(this.safePosition))found=this.safePosition.clone();}
    // A destroyed last footing must not create an endless fall/recovery loop.
    // This finite fallback reads actual roads, never a synthetic sea floor.
    if(!found)for(const p of recoveryRoadPoints({x,z})){
      this.recoveryProbe?.({...p,y:WORLD_HEIGHT});
      const top=this.standingSurface(p.x,p.z,WORLD_HEIGHT);if(top===null)continue;
      if(![Material.Road,Material.Stripe,Material.Concrete].includes(this.world.getVoxel(Math.floor(p.x),Math.round(top)-1,Math.floor(p.z)) as never))continue;
      found=new Vector3(p.x,top,p.z);break;
    }
    if (found) this.position.copy(found);
    else this.position.set(x, Math.max(this.seaLevel + 3, maxFeet), z);
    this.recoveryProbe?.(this.position);
    this.stop();
    this.grounded = this.hasFloor();
    this.rememberSupportMotion();
    if (this.grounded) this.safePosition.copy(this.position);
  }

  /** Exposed for meaningful collision checks without a DOM or graphics context. */
  canOccupy(position: Vector3Like): boolean {
    return this.bodyClear(position,BODY_HEIGHT,BODY_RADIUS);
  }

  bodyClear(position:Vector3Like,height:number,radius:number):boolean {
    const b = this.world.bounds;
    if (position.x < b.minX + radius || position.z < b.minZ + radius || position.x > b.maxX - radius || position.z > b.maxZ - radius) return false;
    const minX = Math.floor(position.x - radius + EPSILON), maxX = Math.floor(position.x + radius - EPSILON);
    const minZ = Math.floor(position.z - radius + EPSILON), maxZ = Math.floor(position.z + radius - EPSILON);
    const minY = Math.floor(position.y + EPSILON), maxY = Math.floor(position.y + height - EPSILON);
    for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (this.world.getVoxel(x, y, z)) return false;
    }
    for (const obstacle of this.obstacleProvider()) {
      if (obstacleIntersectsBody(obstacle,position,radius,height)) return false;
    }
    return true;
  }

  /** Seated shoulders, thighs and boots rotate with the chair. A world-axis box
   * otherwise becomes wider against a diagonal backrest than the actual person. */
  postureClear(position:Vector3Like,height:number,halfWidth:number,halfDepth:number,yaw:number):boolean{
    this.postureRotation.setFromAxisAngle(new Vector3(0,1,0),yaw);
    const b=orientedCollisionBounds({x:position.x,y:position.y+height/2,z:position.z},this.postureRotation,{x:halfWidth-EPSILON,y:height/2-EPSILON,z:halfDepth-EPSILON},this.postureBounds),obb=b.obb!,limits=this.world.bounds;
    if(b.minX<limits.minX||b.maxX>limits.maxX||b.minZ<limits.minZ||b.maxZ>limits.maxZ)return false;
    for(let y=Math.floor(b.minY);y<=Math.floor(b.maxY);y++)for(let z=Math.floor(b.minZ);z<=Math.floor(b.maxZ);z++)for(let x=Math.floor(b.minX);x<=Math.floor(b.maxX);x++)if(this.world.getVoxel(x,y,z)){
      this.postureVoxel.min.set(x+EPSILON,y+EPSILON,z+EPSILON);this.postureVoxel.max.set(x+1-EPSILON,y+1-EPSILON,z+1-EPSILON);if(obb.intersectsBox3(this.postureVoxel))return false;
    }
    for(const o of this.obstacleProvider()){
      if(o.maxX<=b.minX||o.minX>=b.maxX||o.maxY<=b.minY||o.minY>=b.maxY||o.maxZ<=b.minZ||o.minZ>=b.maxZ)continue;
      if(o.obb){if(obb.intersectsOBB(o.obb))return false;}
      else{this.postureVoxel.min.set(o.minX+EPSILON,o.minY+EPSILON,o.minZ+EPSILON);this.postureVoxel.max.set(o.maxX-EPSILON,o.maxY-EPSILON,o.maxZ-EPSILON);if(obb.intersectsBox3(this.postureVoxel))return false;}
    }return true;
  }

  surfaceAt(x:number,z:number,maxTop:number,drop:number):number|null{const top=this.standingSurface(x,z,maxTop);return top!==null&&top>=maxTop-drop?top:null;}
  get obstacles():readonly WalkObstacle[]{return this.obstacleProvider();}
  voxelAt(x:number,y:number,z:number):number{return this.world.getVoxel(x,y,z);}

  update(dt: number, input: WalkInput): void {
    this.recoveredLastStep = false;
    this.recoveryReason='collision';
    this.landingSpeed=0;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Standing on a heaving deck follows its accepted collision pose. Jumping
    // releases the support; a decorative bob must not push the actor through it.
    if(this.grounded&&this.supportMotion&&this.velocity.y<=.01){const support=this.supportMotion,m=support.motion;if(m.frame!==support.frame){const p=this.position.clone().add(m.delta);if(this.canOccupy(p))this.position.copy(p);support.frame=m.frame;}}
    // A falling fragment or moving pedestrian can occupy yesterday's free spot.
    // Resolve to nearby supported space before attempting normal sweeps.
    if (!this.canOccupy(this.position)) {
      let free: Vector3 | null = null;
      for (let radius = 1; radius <= 16 && !free; radius++) {
        for (let dz = -radius; dz <= radius && !free; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = this.position.x + dx, z = this.position.z + dz;
          const floor = this.standingSurface(x, z, this.position.y + .05);
          if (floor !== null) { free = new Vector3(x, floor, z); break; }
        }
      }
      if (free) {
        this.position.copy(free); this.stop(); this.grounded = true; this.safePosition.copy(free);
      } else this.teleportEye(this.eyePosition);
      this.recoveredLastStep = true;
      if (!this.canOccupy(this.position)) return;
    }
    const duration = Math.min(dt, .1);
    const substeps = Math.ceil(duration * 120);
    const step = duration / substeps;
    const length = Math.max(1, Math.hypot(input.x, input.z));
    const speed = input.speed===undefined?(input.run?5.2:3.15):Math.max(0,Math.min(12,input.speed));
    const targetX = input.x / length * speed, targetZ = input.z / length * speed;
    this.grounded = this.hasFloor() && this.velocity.y <= .01;
    // Leave clearance above a full voxel edge. At 6.2 m/s the discrete gravity
    // step peaks just below 1m, making a seemingly reachable crater rim a trap.
    if (input.jump && !this.jumpHeld && this.grounded) { this.velocity.y = 6.6; this.grounded = false; }
    this.jumpHeld = !!input.jump;
    for (let i = 0; i < substeps; i++) {
      const blend = 1 - Math.exp(-step * (this.grounded ? 14 : 3));
      this.velocity.x += (targetX - this.velocity.x) * blend;
      this.velocity.z += (targetZ - this.velocity.z) * blend;
      this.moveHorizontal('x', this.velocity.x * step);
      this.moveHorizontal('z', this.velocity.z * step);
      this.velocity.y = Math.max(-24, this.velocity.y - 19 * step);
      this.moveVertical(this.velocity.y * step);
      if (this.position.y < this.seaLevel - MAX_WADING_DEPTH) {
        // Swimming is outside this phase: recover to the last actual dry footing.
        // The old safe position may itself have been excavated. Revalidate it,
        // otherwise every frame drops back into the same freshly blasted hole.
        this.teleportEye({x:this.safePosition.x,y:Math.max(this.safePosition.y,this.seaLevel+1)+WALK_EYE_HEIGHT,z:this.safePosition.z});
        this.grounded = this.hasFloor(); this.recoveredLastStep = true;this.recoveryReason='water';
        break;
      }
      if (this.grounded && this.position.y >= this.seaLevel) this.safePosition.copy(this.position);
    }
    this.rememberSupportMotion();
  }

  private rememberSupportMotion():void{this.supportMotion=undefined;if(this.grounded)for(const b of this.obstacleProvider())if(b.motion&&b.standable!==false&&overlapsFootprint(this.position.x,this.position.z,b)){const top=obstacleTopAt(b,this.position.x,this.position.z,BODY_RADIUS,this.position.y+.03);if(top!==null&&Math.abs(top-this.position.y)<.055){this.supportMotion={motion:b.motion,frame:b.motion.frame};break;}}}

  private moveHorizontal(axis: 'x' | 'z', distance: number): void {
    if (Math.abs(distance) < 1e-8) return;
    const target = this.position.clone();
    const b = this.world.bounds;
    target[axis] = Math.max((axis === 'x' ? b.minX : b.minZ) + BODY_RADIUS, Math.min((axis === 'x' ? b.maxX : b.maxZ) - BODY_RADIUS, target[axis] + distance));
    if (this.canOccupy(target)) { this.position[axis] = target[axis]; return; }
    if (this.grounded && this.velocity.y <= 0) {
      const top = this.supportBelow(target.x, target.z, this.position.y + MAX_STEP);
      if (top !== null && top > this.position.y + EPSILON && top - this.position.y <= MAX_STEP) {
        target.y = top;
        if (this.canOccupy(target)) { this.position.copy(target); return; }
      }
    }
    this.velocity[axis] = 0;
  }

  private moveVertical(distance: number): void {
    const wasGrounded=this.grounded,impact=-this.velocity.y;
    const target = this.position.clone(); target.y += distance;
    if(distance<0&&this.avoidNonStandableLanding(target))return;
    if (this.canOccupy(target)) {
      this.position.y = target.y;
      this.grounded = distance <= 0 && this.hasFloor();
      if (this.grounded) {
        if(!wasGrounded)this.landingSpeed=Math.max(this.landingSpeed,impact);
        const top = this.supportBelow(this.position.x, this.position.z, this.position.y + .04);
        if (top !== null && this.position.y - top < .06) this.position.y = top;
        this.velocity.y = 0;
      }
      return;
    }
    // Sweep in small fixed steps, then resolve contact to submillimetre precision.
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) * .5;
      target.y = this.position.y + distance * mid;
      if (this.canOccupy(target)) low = mid; else high = mid;
    }
    this.position.y += distance * low;
    this.grounded = distance < 0 && this.hasFloor();
    this.velocity.y = 0;
    if (this.grounded) {
      if(!wasGrounded)this.landingSpeed=Math.max(this.landingSpeed,impact);
      const top = this.supportBelow(this.position.x, this.position.z, this.position.y + .04);
      if (top !== null && this.position.y - top < .06) this.position.y = top;
    }
  }

  /** People block the body, but are not miniature platforms. Move just beyond
   * the nearest shoulder before continuing the fall, without sweeping through
   * walls or placing the player directly onto a pedestrian's moving head. */
  private avoidNonStandableLanding(target:Vector3):boolean {
    const people=this.obstacleProvider().filter(obstacle=>obstacle.standable===false&&
      overlapsFootprint(this.position.x,this.position.z,obstacle)&&
      this.position.y>=obstacle.maxY-.002&&target.y<obstacle.maxY+EPSILON);
    if(!people.length)return false;
    const candidates:Array<{x:number;z:number}>=[];
    for(const obstacle of people){
      const margin=BODY_RADIUS+.025;
      candidates.push(
        {x:obstacle.minX-margin,z:this.position.z},{x:obstacle.maxX+margin,z:this.position.z},
        {x:this.position.x,z:obstacle.minZ-margin},{x:this.position.x,z:obstacle.maxZ+margin},
      );
    }
    candidates.sort((a,b)=>Math.hypot(a.x-this.position.x,a.z-this.position.z)-Math.hypot(b.x-this.position.x,b.z-this.position.z));
    for(const candidate of candidates){
      const length=Math.hypot(candidate.x-this.position.x,candidate.z-this.position.z);
      if(length>1.5)continue;
      const landing={x:candidate.x,y:target.y,z:candidate.z};
      if(!this.canOccupy(landing))continue;
      let clear=true;
      const steps=Math.max(1,Math.ceil(length/.10));
      for(let i=1;i<=steps;i++){
        const fraction=i/steps;
        if(!this.canOccupy({x:this.position.x+(candidate.x-this.position.x)*fraction,y:this.position.y,z:this.position.z+(candidate.z-this.position.z)*fraction})){clear=false;break;}
      }
      if(!clear)continue;
      this.position.copy(landing);this.grounded=false;return true;
    }
    return false;
  }

  private hasFloor(): boolean {
    const top = this.supportBelow(this.position.x, this.position.z, this.position.y + .025);
    return top !== null && this.position.y - top >= -.025 && this.position.y - top < .055;
  }
  private hasSafeFooting(p:Vector3Like):boolean{
    const top=this.supportBelow(p.x,p.z,p.y+.025);return top!==null&&top>=this.seaLevel&&Math.abs(p.y-top)<.055;
  }

  private supportBelow(x: number, z: number, maxTop: number): number | null {
    const minX = Math.floor(x - BODY_RADIUS + EPSILON), maxX = Math.floor(x + BODY_RADIUS - EPSILON);
    const minZ = Math.floor(z - BODY_RADIUS + EPSILON), maxZ = Math.floor(z + BODY_RADIUS - EPSILON);
    const y = Math.floor(maxTop - 1 + EPSILON);
    let highest: number | null = null;
    for (let py = y; py >= Math.max(0, y - 2); py--) for (let pz = minZ; pz <= maxZ; pz++) for (let px = minX; px <= maxX; px++) {
      if (py + 1 <= maxTop + EPSILON && this.world.getVoxel(px, py, pz)) highest = Math.max(highest ?? -Infinity, py + 1);
    }
    for (const obstacle of this.obstacleProvider()) {
      if(obstacle.standable===false)continue;
      if (obstacle.maxY >= maxTop - 3 && overlapsFootprint(x,z,obstacle)) {const top=obstacleTopAt(obstacle,x,z,BODY_RADIUS,maxTop);if(top!==null&&top>=maxTop-3)highest=Math.max(highest??-Infinity,top);}
    }
    return highest;
  }

  private standingSurface(x: number, z: number, maxFeet: number): number | null {
    let highest: number | null = null;
    for (const obstacle of this.obstacleProvider()) {
      if(obstacle.standable===false)continue;
      if (obstacle.maxY >= this.seaLevel && overlapsFootprint(x,z,obstacle)) {const top=obstacleTopAt(obstacle,x,z,BODY_RADIUS,maxFeet);if(top!==null&&top>=this.seaLevel&&this.canOccupy({x,y:top,z}))highest=Math.max(highest??-Infinity,top);}
    }
    for (let y = Math.min(WORLD_HEIGHT - 1, Math.floor(maxFeet - 1)); y >= Math.ceil(this.seaLevel)-1; y--) {
      if (!this.world.getVoxel(Math.floor(x), y, Math.floor(z))) continue;
      const feet = y + 1;
      if (this.canOccupy({ x, y: feet, z })) return Math.max(highest ?? -Infinity, feet);
    }
    return highest;
  }
}

type WalkCallbacks = {
  onActiveChange: (active: boolean) => void;
  onFallback: () => void;
  onRecover?: (reason:'water'|'collision') => void;
  onAction?: () => void;
  onTool?: (index: number) => void;
  onHelp?: () => void;
  onHome?: () => void;
  onMouseMode?: (mode: MouseControlMode) => void;
  onViewChange?: (mode: WalkingViewMode) => void;
  onNotice?:(message:string)=>void;
  primaryDrag?: () => boolean;
};

/** Eye-height controller. Gravity/collision are handled by VoxelWalker, never by
 * moving the free-flight camera and then trying to push it out of buildings.
 */
export class WalkingController {
  readonly motor: VoxelWalker;
  readonly actions:GroundActions;
  private enabled = true;
  private active = false;
  private look: PointerLook;
  private primaryHeld = false;
  private repeat = 0;
  private keys = new Set<string>();
  private handlers: Array<() => void> = [];
  private targetRotation = new Euler(0, 0, 0, 'YXZ');
  private rotation = new Euler(0, 0, 0, 'YXZ');

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, world: VoxelWorld, private callbacks: WalkCallbacks, private view?: WalkingCamera) {
    this.motor = new VoxelWalker(world);
    this.actions=new GroundActions(this.motor,()=>this.motor.obstacles,message=>this.callbacks.onNotice?.(message));
    camera.rotation.order = 'YXZ';
    this.targetRotation.setFromQuaternion(camera.quaternion, 'YXZ');
    this.rotation.copy(this.targetRotation);
    this.look = new PointerLook(canvas, {
      primaryDrag: () => this.callbacks.primaryDrag?.() ?? true,
      onMode: mode => {
        this.setActive(mode !== 'paused'); this.callbacks.onMouseMode?.(mode);
        if (mode === 'drag') this.callbacks.onFallback();
        if (mode === 'paused') { this.keys.clear(); this.primaryHeld = false; this.motor.pauseInput(); }
      },
      onLook: (dx,dy) => {
        this.targetRotation.y -= dx * .0022;
        this.targetRotation.x = Math.max(-1.42, Math.min(1.42, this.targetRotation.x - dy * .0022));
      },
      onPrimary: held => {
        this.primaryHeld = held;
        if (held) { this.repeat = .23; this.callbacks.onAction?.(); }
      },
    });
    this.listen(window, 'blur', () => { this.keys.clear(); this.primaryHeld = false; });
    this.listen(document, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (!this.enabled || (key.target as HTMLElement)?.matches?.('input,textarea,select,button,summary,a,[contenteditable="true"]')) return;
      if (key.code === 'Escape') { this.stop(); return; }
      if (key.code === 'Tab') { key.preventDefault(); this.stop(); this.callbacks.onHelp?.(); return; }
      if (key.code === 'KeyH' && !key.repeat) { this.callbacks.onHome?.(); return; }
      if (key.code === 'KeyC' && !key.repeat) { key.preventDefault(); this.toggleView(); return; }
      if (['Digit1', 'Digit2', 'Digit3'].includes(key.code) && !key.repeat) this.callbacks.onTool?.(Number(key.code.slice(-1)) - 1);
      if (!this.active) return;
      if(this.actions.phase==='approach-seat'&&['KeyW','KeyA','KeyS','KeyD','Space'].includes(key.code))this.actions.cancel();
      if(this.actions.locked&&key.code==='Space'){if(!key.repeat&&this.actions.phase==='seated')this.actions.stand();key.preventDefault();return;}
      if(this.actions.phase==='seated'&&['KeyW','KeyA','KeyS','KeyD'].includes(key.code)&&!key.repeat)this.actions.stand();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key.code)) key.preventDefault();
      this.keys.add(key.code);
    });
    this.listen(document, 'keyup', event => this.keys.delete((event as KeyboardEvent).code));
  }

  get isActive(): boolean { return this.active; }
  get grounded(): boolean { return this.motor.grounded; }
  get viewMode(): WalkingViewMode { return this.view?.mode ?? 'first'; }
  setSeatProvider(provider:()=>readonly SeatTarget[]):void{this.actions.setSeatProvider(provider);}
  get bodyInteraction():GroundInteraction|null{return this.actions.interaction(this.rotation.y);}
  performGroundInteraction(value:GroundInteraction):boolean{const ok=this.actions.interact(value,this.rotation.y);if(ok){if(value.kind==='sit'){this.targetRotation.y=this.view?.seatCameraYaw(value.seat)??value.seat.yaw;this.targetRotation.x=-.03;}else if(value.kind==='vault'){this.targetRotation.y=value.plan.yaw;this.targetRotation.x=Math.max(-.25,Math.min(.2,this.targetRotation.x));}if(!this.active)void this.start();}return ok;}
  restoreSeat(id:string):boolean{const restored=this.actions.restoreSeat(id);if(restored)this.renderView(0);return restored;}
  get pose(): { position: Vector3Like; rotation: Vector3Like; view: WalkingViewMode } {
    const p=this.actions.resumeFeet;
    return { position: { x:p.x,y:p.y+WALK_EYE_HEIGHT,z:p.z }, rotation: { x: this.rotation.x, y: this.rotation.y, z: 0 }, view: this.viewMode };
  }

  setViewMode(mode: WalkingViewMode): void {
    this.view?.setMode(mode);
    this.renderView(0);
    this.callbacks.onViewChange?.(this.viewMode);
  }

  toggleView(): void { this.setViewMode(this.viewMode === 'first' ? 'third' : 'first'); }

  setAiming(active: boolean): void { this.view?.setAiming(active); if (this.enabled) this.renderView(0); }
  cancelAction(): void { this.primaryHeld = false; this.repeat = 0; this.look.cancelPrimary(); }

  async start(): Promise<void> {
    if (!this.enabled) return;
    this.keys.clear(); this.primaryHeld = false;
    this.canvas.focus();
    await this.look.start();
  }

  stop(): void {
    this.keys.clear(); this.primaryHeld = false; this.motor.pauseInput(); this.look.stop();
    this.setActive(false);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) {this.stop();this.actions.cancel();}
    this.enabled = enabled;
    this.look.setEnabled(enabled);
    if (!enabled) this.view?.hide();
  }

  teleport(eye: Vector3Like, lookAt?: Vector3Like): void {
    this.actions.cancel();
    this.keys.clear(); this.primaryHeld = false;
    this.motor.teleportEye(eye);
    this.camera.position.copy(this.motor.eyePosition);
    if (lookAt) this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    this.targetRotation.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.rotation.copy(this.targetRotation); this.view?.hide(); this.renderView(0);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const delta = Math.max(0, Math.min(.05, dt));
    if(this.actions.locked){
      if(this.active){
        if(this.keys.has('ArrowLeft'))this.targetRotation.y+=delta*1.15;
        if(this.keys.has('ArrowRight'))this.targetRotation.y-=delta*1.15;
        if(this.keys.has('ArrowUp'))this.targetRotation.x=Math.min(1.42,this.targetRotation.x+delta*.8);
        if(this.keys.has('ArrowDown'))this.targetRotation.x=Math.max(-1.42,this.targetRotation.x-delta*.8);
      }
      const blend=1-Math.exp(-delta*(this.actions.phase==='sit-down'?4.5:18));
      this.rotation.y+=Math.atan2(Math.sin(this.targetRotation.y-this.rotation.y),Math.cos(this.targetRotation.y-this.rotation.y))*blend;
      this.rotation.x+=(this.targetRotation.x-this.rotation.x)*blend;
      if(this.actions.update(delta)){this.renderView(delta);return;}
    }else this.actions.update(delta);
    if (!this.active) {
      // Esc releases input, not gravity. A paused player still falls after the
      // support underfoot is destroyed, and must finish an in-progress landing.
      this.motor.update(delta, { x: 0, z: 0 });
      this.actions.landed(this.motor.landingSpeed);
      if (this.motor.recoveredLastStep) this.callbacks.onRecover?.(this.motor.recoveryReason);
      this.renderView(delta); return;
    }
    if (this.keys.has('ArrowLeft')) this.targetRotation.y += delta * 1.15;
    if (this.keys.has('ArrowRight')) this.targetRotation.y -= delta * 1.15;
    if (this.keys.has('ArrowUp')) this.targetRotation.x = Math.min(1.42, this.targetRotation.x + delta * .8);
    if (this.keys.has('ArrowDown')) this.targetRotation.x = Math.max(-1.42, this.targetRotation.x - delta * .8);
    const smooth = 1 - Math.exp(-delta * 18);
    this.rotation.y += Math.atan2(Math.sin(this.targetRotation.y - this.rotation.y), Math.cos(this.targetRotation.y - this.rotation.y)) * smooth;
    this.rotation.x += (this.targetRotation.x - this.rotation.x) * smooth;
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const yaw = this.rotation.y;
    this.motor.update(delta, {
      x: -Math.sin(yaw) * forward + Math.cos(yaw) * right,
      z: -Math.cos(yaw) * forward - Math.sin(yaw) * right,
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'), jump: this.keys.has('Space'),
    });
    this.actions.landed(this.motor.landingSpeed);
    if (this.motor.recoveredLastStep) this.callbacks.onRecover?.(this.motor.recoveryReason);
    this.renderView(delta);
    if (this.primaryHeld) {
      this.repeat -= delta;
      if (this.repeat <= 0) { this.repeat = .23; this.callbacks.onAction?.(); }
    }
  }

  dispose(): void { this.stop(); this.look.dispose(); this.view?.dispose(); this.handlers.forEach(remove => remove()); }

  private renderView(dt: number): void {
    if (this.view) this.view.update(dt, this.camera, this.motor.position, this.rotation.y, this.rotation.x, Math.hypot(this.motor.velocity.x, this.motor.velocity.z), this.motor.grounded,this.actions.motion);
    else { this.camera.position.copy(this.motor.eyePosition); this.camera.quaternion.setFromEuler(this.rotation); }
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active; this.callbacks.onActiveChange(active);
  }

  private listen(target: EventTarget, name: string, handler: (event: Event) => void): void {
    target.addEventListener(name, handler);
    this.handlers.push(() => target.removeEventListener(name, handler));
  }
}
