import {Euler,PerspectiveCamera,Quaternion,Vector3,Scene} from 'three';
import type {VoxelWorld} from '../world/voxel';
import {VoxelWalker} from '../input/walk';
import {orientedCollisionBounds,obstaclesIntersect,obstacleTopAt,contactSeparates,type SceneObstacle} from '../input/scene-collisions';
import {VehicleOrbit} from '../input/vehicle-orbit';
import {clipVehicleCamera} from './chase-camera';
import {bicycleModel} from './bicycle-model';
import {BICYCLE_RIG as R} from './bicycle-rig';
import {bicycleRiderBounds} from './bicycle-collision';
import{bicycleWallCorrection}from'./bicycle-wall-contact';
import type {Vec3} from '../destruction/types';
import {findLocalRecovery,VehicleStallWatch} from './recovery';

export const BICYCLE_SPAWN={x:114,y:16,z:169.8};
export type BicycleState={position:Vec3;heading:number;riding:boolean};
export type BicycleViewState={riding:boolean;speed:number;blocked:string;grounded:boolean;pedaling:boolean;standDeployed:boolean;phase:number;wheelAngle:number;footDown:number;stopping:boolean};

export class Bicycle{
  readonly motor:VoxelWalker;
  private model=bicycleModel();private keys=new Set<string>();private orbit:VehicleOrbit;
  private riding=false;private speed=0;private heading=-Math.PI/2;private steer=0;
  private phase=0;private phaseRate=0;private wheelAngle=0;private backingDistance=0;
  private footDown=1;private mountRemaining=0;private stopRequested=false;private pedaling=false;
  private driveHeld=false;
  private readonly stall=new VehicleStallWatch();
  private recoveryProvider:(()=>readonly SceneObstacle[])|undefined;
  private blocked='';private input:{throttle:number;steer:number;brake:boolean}|undefined;
  private provider:()=>readonly SceneObstacle[]=()=>[];private nearby:readonly SceneObstacle[]=[];
  private motorNearby:readonly SceneObstacle[]=[];
  private listeners:Array<()=>void>=[];private ready=false;private look=new Vector3();
  private q=new Quaternion();private query:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
  private previousQuery:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
  private headQuery:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
  private previousHead:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
  private partCenter=new Vector3();
  readonly obstacles:SceneObstacle[]=Array.from({length:2},()=>({minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0,standable:false,vaultable:false,bicycle:true}));

  constructor(scene:Scene,private world:VoxelWorld,canvas?:HTMLCanvasElement,private canControl:()=>boolean=()=>true){
    this.motor=new VoxelWalker(world,BICYCLE_SPAWN);scene.add(this.model.root);this.orbit=new VehicleOrbit(canvas);
    this.motor.setObstacleProvider(()=>this.motorNearby);this.render(0);
    if(typeof document!=='undefined'){
      const down=(e:KeyboardEvent)=>{
        if(!this.riding||!this.canControl()||(e.target as HTMLElement)?.matches?.('input,textarea,select,a,[contenteditable="true"]')||(e.target as HTMLElement)?.closest?.('dialog,[role="dialog"]'))return;
        if(['KeyW','KeyS','KeyA','KeyD','Space'].includes(e.code)){e.preventDefault();canvas?.focus();this.keys.add(e.code);this.input=undefined;}
      };
      const up=(e:KeyboardEvent)=>this.keys.delete(e.code);
      document.addEventListener('keydown',down);document.addEventListener('keyup',up);
      this.listeners.push(()=>document.removeEventListener('keydown',down),()=>document.removeEventListener('keyup',up));
      const blur=()=>this.releaseControls();window.addEventListener('blur',blur);this.listeners.push(()=>window.removeEventListener('blur',blur));
    }
  }
  get position(){return this.motor.position;}
  get viewState():BicycleViewState{
    const notice=this.stall.stuck?'持续受阻 · 按 G 挪到附近安全地面':this.blocked||(this.stopRequested?'正在刹车，停稳后下车…':this.mountRemaining>0?'收起脚撑、脚回到踏板后出发…':'');
    return {riding:this.riding,speed:this.speed,blocked:notice,grounded:this.motor.grounded,pedaling:this.pedaling,standDeployed:this.model.standDeployed,phase:this.phase,wheelAngle:this.wheelAngle,footDown:this.footDown,stopping:this.stopRequested};
  }
  get orbitState(){return this.orbit.state;}
  get dismountReady(){return this.stopRequested&&Math.abs(this.speed)<.15;}
  get canPark(){
    const x=this.position.x+Math.cos(this.heading)*R.standFootX+Math.sin(this.heading)*R.standFootZ;
    const z=this.position.z-Math.sin(this.heading)*R.standFootX+Math.cos(this.heading)*R.standFootZ;
    const floor=this.floorAt(x,z),support=this.wheelSupport(this.position,this.heading);return this.motor.grounded&&support!==null&&Math.abs(support.pitch)<.16&&floor!==null&&Math.abs(floor-support.y)<.10;
  }
  requestDismount(){this.stopRequested=true;this.keys.clear();this.input=undefined;}
  setObstacleProvider(p:()=>readonly SceneObstacle[]){this.provider=p;this.nearby=p();this.motorNearby=this.nearby.filter(b=>b.pedestrianId===undefined);}
  setRecoveryObstacleProvider(p:()=>readonly SceneObstacle[]){this.recoveryProvider=p;}
  /** Validate both tyres and the whole bicycle/rider, including overhead props.
   * Recovery can rotate the bike into an opening; it never edits its obstacles. */
  recoverNearby():boolean{
    const previous=this.nearby,previousMotor=this.motorNearby;
    this.nearby=this.recoveryProvider?.()??this.provider();this.motorNearby=this.nearby;
    const origin=this.position.clone(),bounds=this.world.bounds;
    const result=findLocalRecovery(origin,this.heading,p=>{
      if(p.x<bounds.minX+1.2||p.x>bounds.maxX-1.2||p.z<bounds.minZ+1.2||p.z>bounds.maxZ-1.2)return null;
      const y=this.floorAt(p.x,p.z);if(y===null||y<=12)return null;
      for(const heading of [this.heading,this.heading+Math.PI/2,this.heading-Math.PI/2]){
        const candidate={x:p.x,y,z:p.z},support=this.wheelSupport(candidate,heading);
        if(!support||Math.abs(support.pitch)>.2)continue;candidate.y=support.y;
        if(!this.motor.canOccupy(candidate))continue;
        const body=orientedCollisionBounds({x:p.x,y:support.y+1.2,z:p.z},
          new Quaternion().setFromEuler(new Euler(support.pitch,heading,0,'YXZ')),{x:.4,y:1.16,z:1.1});
        if(this.nearby.some(b=>obstaclesIntersect(body,b)))continue;
        let clear=true;
        for(let iy=Math.floor(body.minY);iy<=Math.floor(body.maxY)&&clear;iy++)for(let iz=Math.floor(body.minZ);iz<=Math.floor(body.maxZ)&&clear;iz++)for(let ix=Math.floor(body.minX);ix<=Math.floor(body.maxX);ix++){
          if(this.world.getVoxel(ix,iy,iz)&&obstaclesIntersect(body,{minX:ix,maxX:ix+1,minY:iy,maxY:iy+1,minZ:iz,maxZ:iz+1})){clear=false;break;}
        }
        if(clear)return{position:candidate,heading};
      }return null;
    });
    if(result){
      this.releaseControls();this.motor.stop();this.position.copy(result.position);this.heading=result.heading;this.steer=0;this.mountRemaining=0;this.footDown=1;
      this.motor.grounded=true;this.blocked='';this.stall.reset();this.ready=false;this.render(0);
    }
    this.nearby=previous;this.motorNearby=previousMotor;
    return !!result;
  }
  setRiding(active:boolean){
    this.riding=active;this.releaseControls();this.footDown=1;this.mountRemaining=active?.45:0;
    this.orbit.setEnabled(active);this.ready=false;this.render(0);
  }
  releaseControls(){this.keys.clear();this.input=undefined;this.speed=0;this.phaseRate=0;this.pedaling=false;this.driveHeld=false;this.stopRequested=false;this.motor.pauseInput();this.orbit.cancelDrag();}
  resetLook(){this.orbit.resetLook();}
  setInput(throttle:number,steer=0,brake=false){this.input={throttle,steer,brake};}
  snapshot():BicycleState{return{position:{...this.position},heading:this.heading,riding:this.riding};}
  restore(s:BicycleState){this.heading=s.heading;this.motor.teleportEye({...s.position,y:s.position.y+1.68});this.speed=0;this.blocked='';this.reconcileWheels();this.render(0);}
  exitPosition(canStand:(p:Vec3)=>boolean):Vec3|null{
    for(const side of [1,-1,1.5,-1.5]){
      const x=this.position.x+Math.cos(this.heading)*side,z=this.position.z-Math.sin(this.heading)*side;
      const y=this.motor.surfaceAt(x,z,this.position.y+.25,.65);
      if(y!==null){const p={x,y,z};if(canStand(p))return p;}
    }return null;
  }
  update(dt:number,camera?:PerspectiveCamera){
    this.nearby=this.provider();this.motorNearby=this.nearby.filter(b=>b.pedestrianId===undefined);const duration=Math.max(0,Math.min(.05,dt)),steps=Math.max(1,Math.ceil(duration*120));
    for(let i=0;i<steps;i++)this.step(duration/steps);
    const input=this.input;
    this.stall.update(duration,this.position,this.riding&&!this.stopRequested&&(input?Math.abs(input.throttle)>.1&&!input.brake:this.keys.has('KeyW')||this.keys.has('KeyS')),!!this.blocked);
    this.render(duration);this.orbit.update(duration,this.speed);if(this.riding&&camera)this.camera(duration,camera);
  }
  private settleLegs(dt:number,down:boolean,rate:number){
    this.phaseRate+=(rate-this.phaseRate)*(1-Math.exp(-dt*12));if(Math.abs(this.phaseRate)<.003)this.phaseRate=0;
    this.phase=(this.phase+this.phaseRate*dt)%(Math.PI*2);
    this.footDown+=((down?1:0)-this.footDown)*(1-Math.exp(-dt*12));
    if(this.footDown<.001)this.footDown=0;if(this.footDown>.999)this.footDown=1;
  }
  private step(dt:number){
    if(!dt)return;const wasBlocked=!!this.blocked;this.blocked='';
    if(!this.riding){this.motor.update(dt,{x:0,z:0});return;}
    const input=this.stopRequested?{throttle:0,steer:0,brake:true}:this.input??{
      throttle:Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS')),
      steer:Number(this.keys.has('KeyA'))-Number(this.keys.has('KeyD')),brake:this.keys.has('Space')};
    const starting=input.throttle>0&&!this.driveHeld;this.driveHeld=input.throttle>0;
    if(starting&&Math.abs(this.speed)<.12&&this.footDown>.12&&this.mountRemaining<=0&&!wasBlocked)this.mountRemaining=.28;
    if(this.mountRemaining>0){
      this.mountRemaining=Math.max(0,this.mountRemaining-dt);this.settleLegs(dt,false,0);
      if(!this.mountRemaining)this.footDown=0;
      this.speed=0;this.pedaling=false;this.motor.pauseInput();this.motor.update(dt,{x:0,z:0});return;
    }
    const prior=this.speed;
    if(input.brake||input.throttle<0&&this.speed>.15)this.speed=Math.max(0,this.speed-8*dt);
    else this.speed+=input.throttle*(input.throttle<0?1.8:3.8)*dt;
    if(input.brake&&prior<0)this.speed=Math.min(0,prior+8*dt);
    if(!input.throttle)this.speed*=Math.exp(-dt*1.1);
    this.speed=Math.max(-1.3,Math.min(8.6,this.speed));
    this.steer+=(input.steer*.48/(1+Math.abs(this.speed)*.12)-this.steer)*(1-Math.exp(-dt*9));
    const heading=this.heading+this.speed*Math.tan(this.steer)/1.48*dt,dx=-Math.sin(heading),dz=-Math.cos(heading);
    const next=this.position.clone().addScaledVector(new Vector3(dx,0,dz),this.speed*dt+(wasBlocked&&input.throttle>0?.05:0));
    const contactOffset=new Vector3();
    let clear=true;const initialSupport=this.wheelSupport(next,heading),oldPitch=this.wheelSupport(this.position,this.heading)?.pitch??0;
    const groundCenter=initialSupport?.y??next.y,grade=Math.tan(initialSupport?.pitch??oldPitch),supportCeiling=Math.max(next.y,groundCenter)+.23;
    orientedCollisionBounds({x:this.position.x,y:this.position.y+.96,z:this.position.z},this.q.setFromEuler(new Euler(oldPitch,this.heading,0,'YXZ')),{x:.31,y:.77,z:.96},this.previousQuery);
    this.riderBounds(this.position,this.q,this.previousHead);
    this.q.setFromAxisAngle(new Vector3(0,1,0),heading);
    this.q.setFromEuler(new Euler(Math.atan(grade),heading,0,'YXZ'));
    orientedCollisionBounds({x:next.x,y:groundCenter+.96,z:next.z},this.q,{x:.31,y:.77,z:.96},this.query);
    this.riderBounds({x:next.x,y:groundCenter,z:next.z},this.q,this.headQuery);
    const slide=(b:SceneObstacle)=>{
      if(Math.abs(this.speed)<.0001)return false;
      const correction=bicycleWallCorrection(this.previousQuery,this.query,b,{x:next.x-this.position.x,z:next.z-this.position.z});
      if(!correction)return false;
      next.x+=correction.x;next.z+=correction.z;contactOffset.x+=correction.x;contactOffset.z+=correction.z;
      orientedCollisionBounds({x:next.x,y:groundCenter+.96,z:next.z},this.q,{x:.31,y:.77,z:.96},this.query);
      this.riderBounds({x:next.x,y:groundCenter,z:next.z},this.q,this.headQuery);return !obstaclesIntersect(this.query,b);
    };
    // Continuous road caps are checked by both wheel probes and the character
    // motor; their enclosing box must not become an invisible vertical wall.
    for(const b of this.nearby){
      if(b.surface||b.standable===true&&b.maxY<=supportCeiling||!obstaclesIntersect(this.query,b))continue;
      if(b.pedestrianId!==undefined&&obstaclesIntersect(this.previousQuery,b)&&contactSeparates(this.previousQuery,this.query,b))continue;
      if(b.pedestrianId===undefined&&slide(b))continue;
      clear=false;this.blocked=b.pedestrianId!==undefined?'有行人靠近 · 可退行让开，或 F 下车':'前方受阻 · 松开 W，S 退行或 F 下车';break;
    }
    const voxel:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
    for(let y=Math.floor(this.query.minY);y<=Math.floor(this.query.maxY);y++)for(let z=Math.floor(this.query.minZ);z<=Math.floor(this.query.maxZ);z++)for(let x=Math.floor(this.query.minX);x<=Math.floor(this.query.maxX);x++)if(this.world.getVoxel(x,y,z)){
      Object.assign(voxel,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1});
      if(obstaclesIntersect(this.query,voxel)&&!slide(voxel)){clear=false;this.blocked='前方受阻 · S 退行或向外转向 / F 下车';}
    }
    for(const b of this.nearby){
      if(b.surface||!obstaclesIntersect(this.headQuery,b))continue;
      if(b.pedestrianId!==undefined&&(obstaclesIntersect(this.previousQuery,b)||obstaclesIntersect(this.previousHead,b))&&contactSeparates(this.previousQuery,this.query,b))continue;
      clear=false;this.blocked='头顶空间不足 · S 退行或 F 下车';break;
    }
    for(let y=Math.floor(this.headQuery.minY);y<=Math.floor(this.headQuery.maxY);y++)for(let z=Math.floor(this.headQuery.minZ);z<=Math.floor(this.headQuery.maxZ);z++)for(let x=Math.floor(this.headQuery.minX);x<=Math.floor(this.headQuery.maxX);x++)if(this.world.getVoxel(x,y,z)){
      Object.assign(voxel,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1});
      if(obstaclesIntersect(this.headQuery,voxel)){clear=false;this.blocked='头顶空间不足 · S 退行或 F 下车';}
    }
    // Compare the old wheels in their actual old heading. A trial steering
    // angle must not mistake the adjacent wall for yesterday's wheel support.
    for(const direction of [-1,1]){
      const y=this.floorAt(next.x+dx*.74*direction,next.z+dz*.74*direction),previous=this.floorAt(this.position.x-Math.sin(this.heading)*.74*direction,this.position.z-Math.cos(this.heading)*.74*direction);
      if(y===null||previous===null||y<previous-.65){clear=false;this.blocked='前方断边或水面 · 请下车探索';break;}
      if(y>previous+.23){clear=false;this.blocked='坡坎过高 · 请下车';break;}
    }
    if(clear&&!this.wheelSupport(next,heading)){clear=false;this.blocked='轮胎前方有陡坎或断边 · S 退行 / F 下车';}
    for(const offset of [-.9,0,.9])for(const side of [-.26,.26])for(const h of [.24,.9,1.65]){
      if(this.world.getVoxel(Math.floor(next.x+dx*offset+Math.cos(heading)*side),Math.floor(groundCenter+grade*offset+h),Math.floor(next.z+dz*offset-Math.sin(heading)*side))){clear=false;this.blocked='前方受阻 · S 后退挪车 / F 下车';}
    }
    if(!clear){this.speed=0;this.pedaling=false;this.settleLegs(dt,true,0);this.motor.pauseInput();this.motor.update(dt,{x:0,z:0});return;}
    const before=this.position.clone(),previousHeading=this.heading;
    if(contactOffset.lengthSq()){
      const count=Math.ceil(contactOffset.length()/.01);
      for(let i=1;i<=count;i++)if(!this.motor.canOccupy(before.clone().addScaledVector(contactOffset,i/count))){this.speed=0;this.blocked='贴近障碍 · S 退行或向外转向';this.motor.pauseInput();return;}
      this.position.add(contactOffset);
    }
    this.heading=heading;const sign=Math.sign(this.speed),x=this.position.x,z=this.position.z;
    this.motor.update(dt,{x:dx*sign,z:dz*sign,speed:Math.abs(this.speed)});
    // The walking motor has a short center footprint. It may accept a step
    // that the complete wheelbase cannot occupy, especially when reversing.
    const actualSupport=this.wheelSupport(this.position,this.heading);
    if(actualSupport&&contactOffset.lengthSq()){
      orientedCollisionBounds({x:this.position.x,y:actualSupport.y+.96,z:this.position.z},this.q.setFromEuler(new Euler(actualSupport.pitch,this.heading,0,'YXZ')),{x:.31,y:.77,z:.96},this.query);
      this.riderBounds({x:this.position.x,y:actualSupport.y,z:this.position.z},this.q,this.headQuery);
    }
    const meetsWall=actualSupport&&contactOffset.lengthSq()>0&&this.nearby.some(b=>b.pedestrianId===undefined&&!b.surface&&!(b.standable===true&&b.maxY<=supportCeiling)&&(obstaclesIntersect(this.query,b)||obstaclesIntersect(this.headQuery,b)));
    if(!actualSupport||meetsWall){
      this.position.copy(before);this.heading=previousHeading;this.motor.stop();this.speed=0;this.pedaling=false;this.blocked='轮组支撑不足 · S 退行 / F 下车';this.settleLegs(dt,true,0);return;
    }
    const distance=Math.hypot(this.position.x-x,this.position.z-z);
    this.wheelAngle=(this.wheelAngle+distance*sign/R.wheelRadius)%(Math.PI*200);
    this.backingDistance=sign<0?this.backingDistance+distance:0;
    this.pedaling=input.throttle>0&&!input.brake&&this.speed>.1;
    this.settleLegs(dt,this.speed<-.05||Math.abs(this.speed)<.12&&input.throttle<=0&&!this.pedaling,this.pedaling?Math.max(1.8,distance/Math.max(dt,.001)/.85):0);
  }
  private floorAt(x:number,z:number):number|null{
    const max=this.position.y+1;let top:number|null=null;
    for(let y=Math.floor(max-1);y>=Math.max(12,Math.floor(this.position.y-2));y--)if(this.world.getVoxel(Math.floor(x),y,Math.floor(z))){top=y+1;break;}
    for(const b of this.nearby)if(b.standable!==false&&x+.05>=b.minX&&x-.05<=b.maxX&&z+.05>=b.minZ&&z-.05<=b.maxZ){
      const y=obstacleTopAt(b,x,z,.05,max);if(y!==null&&y>=this.position.y-1)top=Math.max(top??-Infinity,y);
    }return top;
  }
  private wheelSupport(position:Vec3,heading:number):{y:number;pitch:number}|null{
    const dx=-Math.sin(heading),dz=-Math.cos(heading);let pitch=0,front=position.y,rear=position.y;
    for(let i=0;i<3;i++){
      const f=this.floorAt(position.x+dx*.76*Math.cos(pitch),position.z+dz*.76*Math.cos(pitch)),r=this.floorAt(position.x-dx*.72*Math.cos(pitch),position.z-dz*.72*Math.cos(pitch));
      if(f===null||r===null||Math.abs(f-r)>.65)return null;
      front=f;rear=r;pitch=Math.asin((front-rear)/1.48);
    }
    const y=(front*.72+rear*.76)/1.48+R.wheelRadius*(1-Math.cos(pitch));
    // Check the tyre circumference, not only a ray under each axle: a wheel
    // can hit a ledge while both axle probes still report the lower floor.
    for(const localZ of [-.76,.72]){
      const axleY=y+R.wheelRadius*Math.cos(pitch)-localZ*Math.sin(pitch),offset=localZ*Math.cos(pitch)+R.wheelRadius*Math.sin(pitch);
      const ax=position.x-dx*offset,az=position.z-dz*offset;
      for(let i=0;i<32;i++){
        const a=i*Math.PI/16,h=R.wheelRadius+.014;
        for(const side of [-.04,.04])if(this.world.getVoxel(Math.floor(ax+dx*Math.sin(a)*h+Math.cos(heading)*side),Math.floor(axleY+Math.cos(a)*R.wheelRadius+.004),Math.floor(az+dz*Math.sin(a)*h-Math.sin(heading)*side)))return null;
      }
    }
    return{y,pitch};
  }
  private reconcileWheels():void{
    if(this.wheelSupport(this.position,this.heading))return;
    const initial=this.position.clone();
    for(let radius=.25;radius<=2.5;radius+=.25)for(let i=0;i<16;i++){
      const angle=i*Math.PI/8,x=initial.x+Math.cos(angle)*radius,z=initial.z+Math.sin(angle)*radius,y=this.floorAt(x,z);
      if(y===null)continue;const candidate={x,y,z};
      if(this.motor.canOccupy(candidate)&&this.wheelSupport(candidate,this.heading)){this.motor.teleportEye({...candidate,y:y+1.68});this.blocked='已将旧存档中卡在断边的自行车移到旁边稳固地面';return;}
    }
  }
  private render(dt:number){
    this.model.root.position.copy(this.position);this.model.root.rotation.y=this.heading;
    const support=this.wheelSupport(this.position,this.heading),pitch=support?.pitch??0;
    if(support)this.model.root.position.y=support.y;
    this.model.update(dt,{phase:this.phase,wheelAngle:this.wheelAngle,speed:this.speed,steer:this.steer,
      pitch,riding:this.riding,footDown:this.footDown,
      backingPhase:this.backingDistance/.4*Math.PI*2,groundAt:(x,z)=>this.floorAt(x,z)});
    const parkedOffset=this.riding?0:-.04;
    this.q.setFromEuler(new Euler(pitch,this.heading,0,'YXZ'));
    orientedCollisionBounds(this.partCenter.set(parkedOffset,this.riding?.95:.66,0).applyQuaternion(this.q).add(this.position),
      this.q,{x:this.riding?.34:.40,y:this.riding?.93:.64,z:1.02},this.obstacles[0]);
    if(this.riding)this.riderBounds(this.position,this.q,this.obstacles[1]);
    else{this.obstacles[1].minY=0;this.obstacles[1].maxY=-1;}
  }
  private riderBounds(position:Vec3,rotation:Quaternion,target:SceneObstacle):void{
    bicycleRiderBounds(position,rotation,this.steer,this.speed,target);
  }
  private camera(dt:number,c:PerspectiveCamera){
    const o=this.orbit.state,a=this.heading+o.yaw,e=.28+o.pitch,r=5.8*o.distanceScale;
    const origin=this.model.root.position.clone().add(new Vector3(0,1.2,0));
    const desired=origin.clone().add(new Vector3(Math.sin(a)*r*Math.cos(e),Math.sin(e)*r,Math.cos(a)*r*Math.cos(e)));
    clipVehicleCamera(this.world,origin,desired,()=>r,desired,this.nearby);
    if(!this.ready){c.position.copy(desired);this.look.copy(origin);this.ready=true;}
    else{c.position.lerp(desired,1-Math.exp(-dt*8));this.look.lerp(origin,1-Math.exp(-dt*10));}
    clipVehicleCamera(this.world,origin,c.position,()=>r,c.position,this.nearby);c.up.set(0,1,0);c.lookAt(this.look);
  }
  dispose(){this.model.dispose();this.orbit.dispose();this.listeners.forEach(f=>f());}
}
