import {obstacleIntersectsSphere,type SceneObstacle} from './scene-collisions';
import { Euler, PerspectiveCamera, Scene, Vector3 } from 'three';
import { PlayerAvatar } from '../rendering/player-avatar';
import {seatHip,vaultPose,type GroundMotion,type SeatTarget} from './ground-actions';
import type { Vector3Like, VoxelWorld } from '../world/voxel';

export type WalkingViewMode = 'first' | 'third';
export type CameraObstacle = SceneObstacle;
export const WALK_CAMERA_RADIUS = .18;
const EYE_HEIGHT = 1.68;

function sphereIntersectsBox(p: Vector3Like, radius: number, b: CameraObstacle): boolean {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
  return dx * dx + dy * dy + dz * dz < radius * radius;
}

/** Volume checks include the near plane margin rather than just the lens centre. */
export function cameraSphereClear(world: VoxelWorld, p: Vector3Like, obstacles: readonly CameraObstacle[] = [], radius = WALK_CAMERA_RADIUS): boolean {
  for (let y = Math.floor(p.y - radius); y <= Math.floor(p.y + radius); y++) {
    for (let z = Math.floor(p.z - radius); z <= Math.floor(p.z + radius); z++) {
      for (let x = Math.floor(p.x - radius); x <= Math.floor(p.x + radius); x++) {
        if (world.getVoxel(x, y, z) && sphereIntersectsBox(p, radius, { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 })) return false;
      }
    }
  }
  return !obstacles.some(obstacle => obstacleIntersectsSphere(obstacle,p,radius));
}

/** The camera orbits the actual body; it never becomes the player's collision body. */
export class WalkingCamera {
  private readonly avatar = new PlayerAvatar();
  private viewMode: WalkingViewMode = 'third';
  private ready = false;
  private active = false;
  private aiming = false;
  /** Pick the initial seat view once. Manual orbit and restored gaze remain
   * free; a tree behind a bench must not force a close-up on entry. */
  seatCameraYaw(seat:SeatTarget):number{
    if(this.viewMode==='first')return seat.yaw;
    const pivot=new Vector3(seat.position.x,seat.floorY+seatHip(seat.position.y-seat.floorY,1)+.78,seat.position.z),wanted=new Vector3(),clipped=new Vector3(),obstacles=this.obstacleProvider();
    let best=seat.yaw,distance=0;
    for(const offset of [0,.65,-.65,1.15,-1.15,1.6,-1.6]){
      const yaw=seat.yaw+offset,behind=3.8*Math.cos(.03);
      wanted.set(pivot.x+Math.sin(yaw)*behind+Math.cos(yaw)*.35,pivot.y+.32+Math.sin(.03)*3.8,pivot.z+Math.cos(yaw)*behind-Math.sin(yaw)*.35);
      this.clipBoom(pivot,wanted,obstacles,clipped);const clear=pivot.distanceTo(clipped);
      if(clear>distance){distance=clear;best=yaw;}if(clear>=2.6)return yaw;
    }
    return best;
  }
  private avatarYaw = 0;
  private readonly pivot = new Vector3();
  private readonly wanted = new Vector3();
  private readonly candidate = new Vector3();
  private readonly probe = new Vector3();
  private readonly clipped = new Vector3();
  private avoidanceYaw=0;
  private avoidanceClock=0;
  private avoidanceTarget=0;
  private readonly boomObstacles:CameraObstacle[]=[];
  private readonly lastFeet = new Vector3(Infinity, Infinity, Infinity);
  private readonly direction = new Vector3();
  private readonly aimTarget = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  private stride = 0;
  private eyeHeight = EYE_HEIGHT;

  constructor(scene: Scene, private readonly world: VoxelWorld, private readonly obstacleProvider: () => readonly CameraObstacle[] = () => []) {
    this.avatar.root.visible = false; scene.add(this.avatar.root);
  }

  get mode(): WalkingViewMode { return this.viewMode; }

  setAiming(active: boolean): void {
    if (active === this.aiming) return;
    this.aiming = active; this.ready = false;
  }

  setMode(mode: WalkingViewMode): void {
    if (mode !== 'first' && mode !== 'third') throw new Error('Unknown walking view.');
    if (mode === this.viewMode) return;
    this.viewMode = mode; this.ready = false;
    if (mode === 'first') this.avatar.root.visible = false;
  }

  toggle(): WalkingViewMode {
    this.setMode(this.viewMode === 'first' ? 'third' : 'first'); return this.viewMode;
  }

  update(dt: number, camera: PerspectiveCamera, feet: Vector3Like, yaw: number, pitch: number, speed: number, grounded: boolean,motion?:GroundMotion): void {
    const delta = Math.max(0, Math.min(.1, dt));
    if (![feet.x, feet.y, feet.z, yaw, pitch].every(Number.isFinite)) return;
    const resetPose = !this.active || this.lastFeet.distanceToSquared(feet) > 64;
    if (resetPose) { this.ready = false; this.avatarYaw = yaw;this.avoidanceYaw=this.avoidanceTarget=0;this.avoidanceClock=0; }
    this.active = true;
    const obstacles = this.obstacleProvider();
    const dx = feet.x - this.lastFeet.x, dz = feet.z - this.lastFeet.z;
    if(motion?.bodyYaw!==undefined)this.avatarYaw=motion.bodyYaw;
    else if (this.aiming || this.viewMode === 'first') this.avatarYaw = yaw;
    else if (!resetPose && dx * dx + dz * dz > .000001) {
      const target = Math.atan2(-dx, -dz);
      const turn = Math.atan2(Math.sin(target - this.avatarYaw), Math.cos(target - this.avatarYaw));
      this.avatarYaw += turn * (1 - Math.exp(-delta * 14));
      this.avatarYaw = Math.atan2(Math.sin(this.avatarYaw), Math.cos(this.avatarYaw));
    }
    this.avatar.root.position.copy(feet);
    const offset=motion?.sit?seatHip(motion.seatHeight,motion.sit)-.88:motion?.vault!==undefined?-.08*vaultPose(motion.vault).tuck:0,dip=(motion?.landing??0)*.09;
    this.avatar.animate(delta, this.avatarYaw, speed, grounded,motion?{...motion,gazeYaw:Math.atan2(Math.sin(yaw-this.avatarYaw),Math.cos(yaw-this.avatarYaw)),gazePitch:pitch}:undefined);
    this.stride += delta * Math.max(0, speed) * 2.4;
    if (camera.near !== .08) { camera.near = .08; camera.updateProjectionMatrix(); }
    if (this.viewMode === 'first') {
      const bob = grounded ? Math.sin(this.stride) * .018 * Math.min(1, speed / 3.15) : 0;
      const targetY = feet.y + EYE_HEIGHT+offset-dip;
      if (!this.ready) this.eyeHeight = targetY;
      else this.eyeHeight += (targetY - this.eyeHeight) * (1 - Math.exp(-delta * 20));
      this.pivot.set(feet.x, targetY, feet.z);
      this.wanted.set(feet.x, Math.min(feet.y + 1.72+offset, Math.max(feet.y + 1.25+offset, this.eyeHeight + bob)), feet.z);
      // A smoothed stair rise must not put the lens into a newly raised block.
      if (!cameraSphereClear(this.world, this.wanted, obstacles, .085)) this.wanted.copy(this.pivot);
      camera.position.copy(this.wanted);
      camera.quaternion.setFromEuler(this.rotation.set(pitch, yaw, 0, 'YXZ'));
      this.avatar.root.visible = false;
    } else {
      this.pivot.set(feet.x, feet.y + (this.aiming ? EYE_HEIGHT : 1.28)+offset+(motion?.sit??0)*.38-dip, feet.z);
      const orbitPitch = Math.max(-1.12, Math.min(1.05, pitch));
      // Tools use a clear shoulder line; observation gives the explorer more room.
      const boomLength = this.aiming ? 3.5 : 4.6-(motion?.sit??0)*.8;
      const shoulder = this.aiming ? .85 : .35;
      const behind = boomLength * Math.cos(orbitPitch);
      this.wanted.set(
        this.pivot.x + Math.sin(yaw) * behind + Math.cos(yaw) * shoulder,
        this.pivot.y + (this.aiming ? .24 : .82-(motion?.sit??0)*.50) - Math.sin(orbitPitch) * boomLength,
        this.pivot.z + Math.cos(yaw) * behind - Math.sin(yaw) * shoulder,
      );
      this.clipBoom(this.pivot, this.wanted, obstacles, this.wanted);
      if(!this.aiming){
        // Hold a clear side view at a wall instead of squeezing the lens into
        // the explorer. Re-evaluate at 5Hz; retain side choice through corners.
        this.avoidanceClock-=delta;
        // In a roofed passage retain the low boom until the pivot itself exits;
        // choosing a long side ray could otherwise look over the whole roof.
        const roofed=this.world.getVoxel(Math.floor(feet.x),Math.floor(this.pivot.y+1),Math.floor(feet.z))!==0;
        const clear=this.wanted.distanceTo(this.pivot);
        if(this.avoidanceClock<=0){
          this.avoidanceClock=.2;let score=clear,best=0;
          if(!roofed&&(clear<2.2||Math.abs(this.avoidanceYaw)>.04))for(const turn of [-1.45,-1.1,-.65,.65,1.1,1.45]){
            const a=yaw+turn;
            this.probe.set(this.pivot.x+Math.sin(a)*behind+Math.cos(a)*shoulder,this.pivot.y+.82-(motion?.sit??0)*.5-Math.sin(orbitPitch)*boomLength,this.pivot.z+Math.cos(a)*behind-Math.sin(a)*shoulder);
            this.clipBoom(this.pivot,this.probe,obstacles,this.clipped);
            const value=this.clipped.distanceTo(this.pivot)-Math.abs(turn)*.55-Math.abs(turn-this.avoidanceTarget)*.3;
            if(value>score+.12){score=value;best=turn;}
          }
          this.avoidanceTarget=best;
        }
        this.avoidanceYaw+=(this.avoidanceTarget-this.avoidanceYaw)*(this.ready?1-Math.exp(-delta*5):1);
        if(Math.abs(this.avoidanceYaw)>.002){const a=yaw+this.avoidanceYaw;this.wanted.set(this.pivot.x+Math.sin(a)*behind+Math.cos(a)*shoulder,this.pivot.y+.82-(motion?.sit??0)*.5-Math.sin(orbitPitch)*boomLength,this.pivot.z+Math.cos(a)*behind-Math.sin(a)*shoulder);this.clipBoom(this.pivot,this.wanted,obstacles,this.wanted);}
      }
      if (this.ready) {
        this.candidate.copy(camera.position).lerp(this.wanted, 1 - Math.exp(-delta * 13));
        // Re-check the interpolated boom: smoothing around a corner cannot cut through it.
        this.clipBoom(this.pivot, this.candidate, obstacles, this.candidate);
        camera.position.copy(this.candidate);
      } else camera.position.copy(this.wanted);
      if (this.aiming) {
        this.aimTarget.set(feet.x - Math.sin(yaw) * Math.cos(pitch) * 8, feet.y + EYE_HEIGHT + Math.sin(pitch) * 8, feet.z - Math.cos(yaw) * Math.cos(pitch) * 8);
        camera.lookAt(this.aimTarget);
      } else camera.lookAt(this.pivot);
      const distance = camera.position.distanceTo(this.pivot);
      const fade = Math.max(0, Math.min(1, (distance - .62) / .75));
      this.avatar.setOpacity(fade * fade * (3 - 2 * fade));
    }
    this.ready = true; this.lastFeet.copy(feet);
  }

  hide(): void { this.active = false; this.ready = false; this.avatar.root.visible = false; }

  dispose(): void { this.avatar.dispose(); }

  private clipBoom(origin: Vector3, destination: Vector3, obstacles: readonly CameraObstacle[], output: Vector3): void {
    this.direction.copy(destination).sub(origin);
    const distance = this.direction.length();
    if (distance < 1e-6) { output.copy(origin); return; }
    this.direction.multiplyScalar(1 / distance);
    // Broad-phase once for the whole boom. Previously every 5cm sample tested
    // every nearby facade, table leg and tread, twice per rendered frame.
    const r=WALK_CAMERA_RADIUS,minX=Math.min(origin.x,destination.x)-r,maxX=Math.max(origin.x,destination.x)+r,minY=Math.min(origin.y,destination.y)-r,maxY=Math.max(origin.y,destination.y)+r,minZ=Math.min(origin.z,destination.z)-r,maxZ=Math.max(origin.z,destination.z)+r;
    this.boomObstacles.length=0;
    for(const b of obstacles)if(b.maxX>minX&&b.minX<maxX&&b.maxY>minY&&b.minY<maxY&&b.maxZ>minZ&&b.minZ<maxZ)this.boomObstacles.push(b);
    const steps = Math.ceil(distance / .055);
    let safe = 0;
    for (let i = 1; i <= steps; i++) {
      const next = distance * i / steps;
      const p = { x: origin.x + this.direction.x * next, y: origin.y + this.direction.y * next, z: origin.z + this.direction.z * next };
      if (!cameraSphereClear(this.world, p, this.boomObstacles)) {
        let low = safe, high = next;
        for (let n = 0; n < 10; n++) {
          const mid = (low + high) * .5;
          const point = { x: origin.x + this.direction.x * mid, y: origin.y + this.direction.y * mid, z: origin.z + this.direction.z * mid };
          if (cameraSphereClear(this.world, point, this.boomObstacles)) low = mid; else high = mid;
        }
        output.copy(origin).addScaledVector(this.direction, Math.max(0, low - .015)); return;
      }
      safe = next;
    }
    output.copy(origin).addScaledVector(this.direction, distance);
  }
}
