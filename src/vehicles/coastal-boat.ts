import {Euler,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import type {Vec3} from '../destruction/types';
import {WORLD_HEIGHT,type VoxelWorld} from '../world/voxel';
import {SEA_LEVEL} from '../world/sea-level';
import {contactSeparates,obstaclesIntersect,orientedCollisionBounds,obstacleTopAt,type SceneObstacle,type SurfaceMotion} from '../input/scene-collisions';
import {VehicleOrbit} from '../input/vehicle-orbit';
import {clipVehicleCamera} from './chase-camera';
import {coastalBoatModel} from './boat-model';
import {BOAT_SPAWN,BOAT_LANDINGS} from '../route/boat-route';
import {waterSurfaceHeight} from '../rendering/water-surface';
import {Material} from '../world/palette';
import {BOAT_HULL,BOAT_PARTS} from './boat-shape';

export type BoatState={position:Vec3;heading:number;piloting:boolean;grounded?:boolean};
export type BoatViewState={piloting:boolean;speed:number;status:string;blocked:boolean;stopping:boolean;stopped:boolean;grounded:boolean};
type BoatInput={throttle:number;steer:number;brake:boolean};
type Blockage='shore'|'obstacle'|'clearance'|'edge'|null;
type Support={y:number;pitch:number;grounded:boolean};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export class CoastalBoat{
 readonly position=new Vector3().copy(BOAT_SPAWN);readonly obstacles:SceneObstacle[]=[];
 private model=coastalBoatModel();private orbit:VehicleOrbit;private heading=Math.PI;private speed=0;private yawRate=0;private rudder=0;private piloting=false;private stopping=false;private blockage:Blockage=null;private time=0;
 private night=0;private velocity=new Vector3();private keys=new Set<string>();private input:BoatInput|undefined;private provider:(p:Vec3)=>readonly SceneObstacle[]=()=>[];private nearby:readonly SceneObstacle[]=[];private removers:Array<()=>void>=[];private cameraReady=false;private focus=new Vector3();private wanted=new Vector3();private q=new Quaternion();private body:SceneObstacle={} as SceneObstacle;private voxel:SceneObstacle={} as SceneObstacle;
 private motion:SurfaceMotion={frame:0,delta:{x:0,y:0,z:0}};
 private grounded=false;private groundY=SEA_LEVEL+.08;private groundPitch=0;private dryStern=false;
 private sample=new Vector3();private poseQ=new Quaternion();private poseP=new Vector3();
 private poseEuler=new Euler(0,0,0,'YXZ');
 private before={} as SceneObstacle;private previousQ=new Quaternion();private previousP=new Vector3();private hitOverhead=false;private sandTop=0;
 private lastContact=-Infinity;
 constructor(scene:Scene,private world:VoxelWorld,canvas?:HTMLCanvasElement,private canControl:()=>boolean=()=>true,private waterHeight:(x:number,z:number)=>number=(x,z)=>waterSurfaceHeight(x,z,this.time)){
  scene.add(this.model.root);this.orbit=new VehicleOrbit(canvas);
  for(const part of BOAT_PARTS)this.obstacles.push({minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0,standable:!!part.deck,vaultable:false,motion:this.motion});
  if(typeof document!=='undefined'){
   const down=(e:KeyboardEvent)=>{if(!this.piloting||!this.canControl()||(e.target as HTMLElement)?.matches?.('input,textarea,select,button,a,[contenteditable="true"]'))return;if(['KeyW','KeyS','KeyA','KeyD','Space'].includes(e.code)){e.preventDefault();canvas?.focus();this.keys.add(e.code);this.input=undefined;}},up=(e:KeyboardEvent)=>this.keys.delete(e.code),blur=()=>this.releaseControls();
   document.addEventListener('keydown',down);document.addEventListener('keyup',up);window.addEventListener('blur',blur);this.removers.push(()=>document.removeEventListener('keydown',down),()=>document.removeEventListener('keyup',up),()=>window.removeEventListener('blur',blur));
  }this.render(0);
 }
 setObstacleProvider(p:(position:Vec3)=>readonly SceneObstacle[]){this.provider=p;}
 get viewState():BoatViewState{
  const stopped=Math.abs(this.speed)<.2;
  const status=this.stopping?'正在减速，停稳后寻找安全上岸位置…':
   this.blockage==='clearance'?'桥下净空不足 · S 倒退绕行，卡住按 G':
   this.blockage==='shore'?'水太浅或前方有礁石 · S 倒退回深水，G 安全脱困':
   this.blockage==='obstacle'?'接触船只、桥墩或障碍 · S 倒退，卡住按 G':
   this.blockage==='edge'?'已到探索边界 · 请转向沿岸航行':
   this.grounded?(this.dryStern?'已冲滩搁浅，螺旋桨离水 · F 上岸，G 回到深水':stopped?'已搁浅，船尾仍在水中 · S 倒退，或 F 上岸 / G 脱困':'船底触沙，正在减速搁浅 · S 倒退回水，或 F 上岸 / G 脱困'):
   stopped?'W 出航 · 靠岸停稳后 F 上岸 · M 查看三处靠泊点':'沿岸航行 · 留意浅滩，提前减速靠泊';
  return{piloting:this.piloting,speed:this.speed,blocked:!!this.blockage,stopping:this.stopping,stopped,grounded:this.grounded,status};
 }
 get orbitState(){return this.orbit.state;}
 get dismountReady(){return this.stopping&&Math.abs(this.speed)<.15;}
 get headingAngle(){return this.heading;}
 get boardingPoint(){return new Vector3(.43,1.2,-.04).applyAxisAngle(new Vector3(0,1,0),this.heading).add(this.position);}
 canBoard(feet:Vec3):boolean{return Math.hypot(feet.x-this.position.x,feet.z-this.position.z)<4.2&&Math.abs(feet.y-(SEA_LEVEL+.65))<2.6;}
 setPiloting(active:boolean){this.piloting=active;this.stopping=false;this.releaseControls();if(!active){this.speed=0;this.velocity.set(0,0,0);}this.orbit.setEnabled(active);this.cameraReady=false;this.render(0);}
 setInput(throttle:number,steer=0,brake=false){this.input={throttle,steer,brake};}
 requestDismount(){this.stopping=true;this.keys.clear();this.input=undefined;}
 cancelDismount(){this.stopping=false;this.releaseControls();}
 releaseControls(){this.keys.clear();this.input=undefined;this.orbit.cancelDrag();}
 resetLook(){this.orbit.resetLook();}
 snapshot():BoatState{return{position:{x:this.position.x,y:this.grounded?this.groundY:SEA_LEVEL+.08,z:this.position.z},heading:this.heading,piloting:this.piloting,...this.grounded?{grounded:true}:{}};}
 restore(state:BoatState):boolean{this.position.copy(state.position);this.heading=state.heading;this.speed=0;this.velocity.set(0,0,0);this.nearby=this.provider(this.position);const support=this.supportAt(this.position,this.heading,!!state.grounded||state.position.y>SEA_LEVEL+.16),invalid=!support||!!this.testPose(this.position,this.heading,support);if(support)this.applySupport(support);if(invalid&&!this.recoverNearby())this.blockage='obstacle';this.render(0);return invalid;}
 /** G searches real deep water; it never deletes a quay or puts a hull on sand. */
 recoverNearby():boolean{
  const source=this.position.clone();let result:{p:Vec3;heading:number}|undefined;
  const check=(p:Vec3)=>{this.nearby=this.provider(p);for(const heading of [this.heading,this.heading+Math.PI/2,this.heading-Math.PI/2,this.heading+Math.PI]){const exit={x:p.x-Math.sin(heading)*3,y:p.y,z:p.z-Math.cos(heading)*3},support=this.supportAt(p,heading,false),end=this.supportAt(exit,heading,false);if(support&&end&&!this.testPose(p,heading,support)&&!this.testPose(exit,heading,end)){result={p,heading};return true;}}return false;};
  for(const radius of [1.5,3,5,8,12,20,32]){for(let i=0;i<16;i++){const a=this.heading+i*Math.PI/8;if(check({x:source.x+Math.sin(a)*radius,y:SEA_LEVEL+.08,z:source.z+Math.cos(a)*radius}))break;}if(result)break;}
  if(!result)for(const landing of [...BOAT_LANDINGS].sort((a,b)=>Math.hypot(a.boat.x-source.x,a.boat.z-source.z)-Math.hypot(b.boat.x-source.x,b.boat.z-source.z)))if(check({...landing.boat,y:SEA_LEVEL+.08}))break;
  if(!result)return false;this.position.copy(result.p);this.heading=result.heading;this.grounded=this.dryStern=false;this.groundPitch=0;this.speed=0;this.velocity.set(0,0,0);this.yawRate=this.rudder=0;this.stopping=false;this.blockage=null;this.releaseControls();this.cameraReady=false;this.render(0);return true;
 }
 exitPosition(canStand:(p:Vec3)=>boolean):Vec3|null{
  if(Math.abs(this.speed)>.2)return null;const props=this.provider(this.position),c=Math.cos(this.heading),s=Math.sin(this.heading);
  for(const side of [-1,1])for(const across of [3.2,2.8,2.3])for(const along of [0,1.1,-1.1]){
   const x=this.position.x+c*side*across+s*along,z=this.position.z-s*side*across+c*along;let top:number|null=null;
   for(let y=Math.floor(SEA_LEVEL+1.9);y>=SEA_LEVEL-1;y--)if(this.world.getVoxel(Math.floor(x),y,Math.floor(z))){top=y+1;break;}
   for(const b of props)if(b.standable!==false&&x+.29>b.minX&&x-.29<b.maxX&&z+.29>b.minZ&&z-.29<b.maxZ){const t=obstacleTopAt(b,x,z,.29,SEA_LEVEL+2.1);if(t!==null&&t>=SEA_LEVEL)top=Math.max(top??-Infinity,t);}
   if(top===null||top<SEA_LEVEL||top>SEA_LEVEL+1.9)continue;const p={x,y:top,z};if(!canStand(p))continue;
   // A person needs a real supported footprint, not one corner over deep water.
   let supported=0;for(const dx of [-.19,.19])for(const dz of [-.19,.19]){if(this.world.getVoxel(Math.floor(x+dx),Math.floor(top-.02),Math.floor(z+dz))||props.some(b=>b.standable!==false&&x+dx>=b.minX&&x+dx<=b.maxX&&z+dz>=b.minZ&&z+dz<=b.maxZ&&Math.abs((obstacleTopAt(b,x+dx,z+dz,.02,top+.05)??-100)-top)<.12))supported++;}
   if(supported>=3)return p;
  }return null;
 }
 exitHeading(feet:Vec3):number{
  const dock=BOAT_LANDINGS.find(l=>Math.hypot(feet.x-l.x,feet.z-l.endZ)<8);
  return dock?Math.atan2(feet.x-dock.x,feet.z-dock.z):Math.atan2(this.position.x-feet.x,this.position.z-feet.z);
 }
 update(dt:number,camera?:PerspectiveCamera,night=0){
  this.night=night;
  const duration=clamp(dt,0,.05);this.time+=duration;this.nearby=this.provider(this.position);if(this.time-this.lastContact>1.5)this.blockage=null;
  if(this.piloting){
   const enabled=this.canControl(),input=this.stopping?{throttle:0,steer:0,brake:true}:enabled?(this.input??{throttle:Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS')),steer:Number(this.keys.has('KeyA'))-Number(this.keys.has('KeyD')),brake:this.keys.has('Space')}):{throttle:0,steer:0,brake:true};
   const reversing=input.throttle<0&&this.speed>.15,braking=input.brake||reversing;
   if(braking)this.speed=Math.sign(this.speed)*Math.max(0,Math.abs(this.speed)-5.5*duration);else if(!this.grounded||input.throttle<0&&!this.dryStern)this.speed+=input.throttle*(input.throttle<0?1.8:3.4)*duration;
   this.speed*=Math.exp(-duration*(this.grounded?2.1:input.throttle&&!braking?.06:.40));if(this.grounded&&Math.abs(this.speed)<.04)this.speed=0;this.speed=clamp(this.speed,-2.2,11.5);
   this.rudder+=(input.steer-this.rudder)*(1-Math.exp(-duration*6));const desiredYaw=this.rudder*this.speed*.12;this.yawRate+=(desiredYaw-this.yawRate)*(1-Math.exp(-duration*3.5));
   const target=new Vector3(-Math.sin(this.heading)*this.speed,0,-Math.cos(this.heading)*this.speed);this.velocity.lerp(target,1-Math.exp(-duration*3.2));
   if(braking||this.grounded)this.velocity.multiplyScalar(Math.exp(-duration*(this.grounded?2.1:3)));
   const steps=Math.max(1,Math.ceil(Math.max(this.velocity.length()*duration/.16,Math.abs(this.yawRate)*duration/.035)));
   for(let i=0;i<steps;i++){
    const heading=this.heading+this.yawRate*duration/steps,next=this.position.clone().addScaledVector(this.velocity,duration/steps),support=this.supportAt(next,heading,this.grounded||Math.abs(this.speed)>3.5),blocked=support?this.testPose(next,heading,support,true):'shore';
    if(!blocked&&support){this.position.x=next.x;this.position.z=next.z;this.heading=Math.atan2(Math.sin(heading),Math.cos(heading));this.applySupport(support);if(this.velocity.length()>.3)this.blockage=null;continue;}
    this.blockage=blocked;this.lastContact=this.time;this.speed=0;this.velocity.set(0,0,0);this.yawRate=0;break;
   }
  }
  this.render(duration);this.orbit.update(duration,this.speed);if(this.piloting&&camera)this.updateCamera(duration,camera);
 }
 /** Water depth excludes everything above the waterline. Bridge clearance is
  * checked against the visible hull, windscreen and seated person's height. */
 private bedAt(x:number,z:number):number{for(let y=SEA_LEVEL-1;y>=0;y--)if(this.world.getVoxel(Math.floor(x),y,Math.floor(z)))return y+1;return 0;}
 private supportAt(p:Vec3,heading:number,beach:boolean):Support|null{
  const c=Math.cos(heading),s=Math.sin(heading),samples:Array<{z:number;top:number}>=[];let front=0,back=0,highest=0;
  for(const band of BOAT_HULL)for(const dx of [-band.half.x-.05,0,band.half.x+.05])for(const localZ of [band.center.z-band.half.z-.08,band.center.z+band.half.z+.08]){
   const x=p.x+c*dx+s*localZ,z=p.z-s*dx+c*localZ;let top=this.bedAt(x,z);
   // Only sand can support a controlled beaching. Raised decks, stone quays,
   // bridge piles and higher inland terrain remain actual solid obstacles.
   for(let y=SEA_LEVEL;y<=SEA_LEVEL+1;y++)if(this.world.getVoxel(Math.floor(x),y,Math.floor(z))===Material.Sand)top=y+1;
   if(top>SEA_LEVEL-.65){if(!beach||top>SEA_LEVEL+1||this.world.getVoxel(Math.floor(x),top-1,Math.floor(z))!==Material.Sand)return null;}
   samples.push({z:localZ,top});highest=Math.max(highest,top);if(localZ< -1)front=Math.max(front,top);if(localZ>1)back=Math.max(back,top);
  }
  if(highest<=SEA_LEVEL-.65)return{y:SEA_LEVEL+.08,pitch:0,grounded:false};
  const pitch=clamp(Math.atan2(front-back,4.5),-.22,.22);let y=SEA_LEVEL+.08;
  for(const point of samples)y=Math.max(y,point.top+.47+Math.sin(pitch)*point.z);
  return{y,pitch,grounded:true};
 }
 private applySupport(s:Support){this.grounded=s.grounded;this.groundY=s.y;this.groundPitch=s.pitch;this.dryStern=s.grounded&&s.y-Math.sin(s.pitch)*2.72-Math.cos(s.pitch)*.19>SEA_LEVEL-.04;}
 private testPose(p:Vec3,heading:number,support:Support,separate=false,settles=0):Blockage{
  const bounds=this.world.bounds;if(p.x<bounds.minX-24||p.x>bounds.maxX+24||p.z<bounds.minZ-24||p.z>bounds.maxZ+24)return'edge';
  const dx=-Math.sin(heading),dz=-Math.cos(heading),pitch=support.grounded?support.pitch:Math.atan2(this.waterHeight(p.x+dx*1.5,p.z+dz*1.5)-this.waterHeight(p.x-dx*1.5,p.z-dz*1.5),3),bank=support.grounded?0:clamp(-this.yawRate*this.speed*.012,-.08,.08);
  this.poseQ.setFromEuler(this.poseEuler.set(pitch,heading,bank,'YXZ'));this.poseP.set(p.x,support.grounded?support.y:this.waterHeight(p.x,p.z)+.08,p.z);
  if(separate){this.previousQ.copy(this.model.root.quaternion);this.previousP.copy(this.position);}
  // A small wave envelope prevents the rendered windscreen/head bobbing into
  // an overhead beam after a flat-water collision check has passed.
  for(const part of BOAT_PARTS){const margin=support.grounded?0:.04,half={x:part.half.x+margin,y:part.half.y+margin,z:part.half.z+margin};this.sample.copy(part.center).applyQuaternion(this.poseQ).add(this.poseP);orientedCollisionBounds(this.sample,this.poseQ,half,this.body);if(separate)orientedCollisionBounds(this.sample.copy(part.center).applyQuaternion(this.previousQ).add(this.previousP),this.previousQ,half,this.before);if(this.solid(this.body,separate?this.before:undefined)){
    // Fit the keel to the actual stepped sand cells too, including a corner
    // between footprint samples. Never lift through rock, piles or a high bank.
    if(part.deck&&support.grounded&&this.sandTop&&settles<3){const raised=support.y+this.sandTop-this.body.minY+.025;if(raised<=SEA_LEVEL+1.7){support.y=raised;return this.testPose(p,heading,support,separate,settles+1);}}
    return this.hitOverhead?'clearance':'obstacle';
   }}
  return null;
 }
 private solid(b:SceneObstacle,before?:SceneObstacle):boolean{
  this.hitOverhead=false;this.sandTop=0;const hits=(o:SceneObstacle)=>obstaclesIntersect(b,o)&&!(before&&obstaclesIntersect(before,o)&&contactSeparates(before,b,o));
  for(const o of this.nearby)if(hits(o)){this.hitOverhead=o.minY>SEA_LEVEL+1;return true;}
  for(let y=Math.max(0,Math.floor(b.minY));y<=Math.min(WORLD_HEIGHT-1,Math.floor(b.maxY));y++)for(let z=Math.floor(b.minZ);z<=Math.floor(b.maxZ);z++)for(let x=Math.floor(b.minX);x<=Math.floor(b.maxX);x++){const m=this.world.getVoxel(x,y,z);if(m){Object.assign(this.voxel,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1});if(hits(this.voxel)){this.hitOverhead=y>=SEA_LEVEL+1;if(m===Material.Sand&&y>=SEA_LEVEL-1&&y<=SEA_LEVEL)this.sandTop=y+1;return true;}}}
  return false;
 }
 private render(dt:number){
  const oldY=this.position.y,y=this.grounded?this.groundY:this.waterHeight(this.position.x,this.position.z)+.08;this.position.y=y;this.motion.delta.y=y-oldY;this.motion.frame++;
  const dx=-Math.sin(this.heading),dz=-Math.cos(this.heading),pitch=this.grounded?this.groundPitch:Math.atan2(this.waterHeight(this.position.x+dx*1.5,this.position.z+dz*1.5)-this.waterHeight(this.position.x-dx*1.5,this.position.z-dz*1.5),3),bank=this.grounded?0:clamp(-this.yawRate*this.speed*.012,-.08,.08);
  this.model.root.position.copy(this.position);this.model.root.rotation.set(pitch,this.heading,bank,'YXZ');this.q.copy(this.model.root.quaternion);
  BOAT_PARTS.forEach((part,i)=>{orientedCollisionBounds(this.sample.copy(part.center).applyQuaternion(this.q).add(this.position),this.q,part.half,this.obstacles[i]);if(part.rider&&!this.piloting)this.obstacles[i].minY=this.obstacles[i].maxY=-1000;});
  this.model.update(dt,this.piloting,this.speed,this.rudder,this.night);
 }
 private updateCamera(dt:number,camera:PerspectiveCamera){
  const o=this.orbit.state,a=this.heading+o.yaw,r=8.4*o.distanceScale,e=.26+o.pitch;this.focus.copy(this.position).add(new Vector3(0,1.25,0));this.wanted.copy(this.focus).add(new Vector3(Math.sin(a)*r*Math.cos(e),Math.sin(e)*r,Math.cos(a)*r*Math.cos(e)));this.wanted.y=Math.max(SEA_LEVEL+.35,this.wanted.y);
  clipVehicleCamera(this.world,this.focus,this.wanted,()=>Infinity,this.wanted,this.nearby);
  if(!this.cameraReady){camera.position.copy(this.wanted);this.cameraReady=true;}else camera.position.lerp(this.wanted,1-Math.exp(-dt*5));camera.lookAt(this.focus);
 }
 dispose(){this.removers.forEach(f=>f());this.orbit.dispose();this.model.dispose();}
}
