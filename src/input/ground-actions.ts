import {Vector3} from 'three';
import type {Vector3Like} from '../world/voxel';
import type {SceneObstacle} from './scene-collisions';
import type {VoxelWalker} from './walk';
import {nearbyRailFrames,voxelRailsNear} from './vault-rails';

export type SeatTarget={id:string;position:Vector3Like;floorY:number;yaw:number;kind?:'bench'|'chair';halfWidth?:number;halfDepth?:number;available:()=>boolean};
export type GroundMotion={sit:number;seatHeight:number;bodyYaw?:number;vault?:number;handForward?:number;handHeight?:number;landing:number;verticalSpeed:number;gazeYaw?:number;gazePitch?:number};
export type VaultPlan={start:Vector3;launch?:Vector3;end:Vector3;rail:SceneObstacle;yaw:number;apex:number};
export type GroundInteraction={kind:'sit';seat:SeatTarget;label:string}|{kind:'stand';label:string}|{kind:'vault';plan:VaultPlan;label:string};
type SeatAction={kind:'approach-seat'|'sit-down'|'seated'|'stand-up';seat:SeatTarget;start:Vector3;exit:Vector3;initialYaw:number;time:number;path?:Vector3[];recovery?:boolean;blocked?:boolean;waiting?:number};
type VaultAction={kind:'vault';plan:VaultPlan;time:number;retreat?:boolean;blocked?:boolean};
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(t:number)=>{const v=clamp(t);return v*v*(3-2*v);};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const angle=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
export const seatHip=(height:number,blend:number)=>.51+.37*Math.cos(Math.acos(clamp((height+.075-.51)/.37,-1,1))*blend);
const forward=(yaw:number)=>({x:-Math.sin(yaw),z:-Math.cos(yaw)});
export const seatDuration=(seat:SeatTarget,sitting:boolean)=>seat.kind==='chair'?(sitting?1.35:1.15):(sitting ? .95 : .65);

/** The same staged pose drives the avatar, camera and collision sweep. At a
 * dining table, bend before moving sideways onto the seat; rise after exiting. */
export function seatTransition(seat:SeatTarget,start:Vector3Like,end:Vector3Like,t:number,sitting:boolean){
 if(seat.kind==='chair'){
  const u=sitting?clamp(t):1-clamp(t),sit=smooth((u-.15)/.55),move=smooth((u-.45)/.45);
  return{position:new Vector3().copy(sitting?start:end).lerp(sitting?end:start,move),sit};
 }
 const blend=sitting?smooth((t-.25)/.75):smooth(t);
 return{position:new Vector3().copy(start).lerp(end,blend),sit:sitting?blend:1-blend};
}

/** The renderer and collision sweep share the same tucked legs and hip height. */
export function vaultPose(t:number){
 const tuck=t<.18?0:t<.40?smooth((t-.18)/.22):t<.78?1:1-smooth((t-.78)/.22);
 const brace=t<.18?Math.sin(t/.18*Math.PI)*.3:0,upper=1.5*tuck+brace,lower=-2.65*tuck-2*brace;
 const offset=t<.18?-(.88-.37*Math.cos(upper)-.36*Math.cos(upper+lower)-.15):-.04*tuck;
 return{tuck,upper,lower,offset};
}

export function vaultPoint(plan:VaultPlan,t:number):Vector3{
 const p=(plan.launch??plan.start).clone();
 if(t<.18)return plan.start.clone().lerp(p,smooth(t/.18));
 if(t<.40){p.y=lerp(plan.start.y,plan.apex,smooth((t-.18)/.22));return p;}
 if(t<.78){const u=smooth((t-.40)/.38);p.lerp(plan.end,u);p.y=plan.apex+Math.sin(u*Math.PI)*.06;return p;}
 p.copy(plan.end);p.y=lerp(plan.apex,plan.end.y,smooth((t-.78)/.22));return p;
}

export function vaultBodyClear(motor:VoxelWalker,plan:VaultPlan,t:number):boolean{
 const p=vaultPoint(plan,t),pose=vaultPose(t),f=forward(plan.yaw),hip=p.y+.88+pose.offset;
 if(!motor.bodyClear({x:p.x,y:hip-.055,z:p.z},.97,.27))return false;
 for(const side of [-.095,.095]){
  const x=p.x+f.z*side,z=p.z-f.x*side,kneeForward=.37*Math.sin(pose.upper),kneeY=hip-.37*Math.cos(pose.upper),ankleForward=kneeForward+.36*Math.sin(pose.upper+pose.lower),ankleY=kneeY-.36*Math.cos(pose.upper+pose.lower);
  for(const [from,to,y0,y1] of [[0,kneeForward,hip,kneeY],[kneeForward,ankleForward,kneeY,ankleY]])for(let i=1;i<=5;i++){
   const u=i/5,d=lerp(from,to,u),y=lerp(y0,y1,u);if(!motor.bodyClear({x:x+f.x*d,y:y-.085,z:z+f.z*d},.17,.095))return false;
  }
  const boot=ankleForward+.045;if(!motor.bodyClear({x:x+f.x*boot,y:ankleY-.145,z:z+f.z*boot},.14,.15))return false;
 }
 return true;
}

/** Swept, posture-aware interactions. Ordinary movement keeps its normal body. */
export class GroundActions {
 private action:SeatAction|VaultAction|undefined;
 private seats:()=>readonly SeatTarget[]=()=>[];
 private impact=0;
 private proximityHint='';
 private readonly lastClear=new Vector3();
 constructor(private motor:VoxelWalker,private obstacles:()=>readonly SceneObstacle[],private notice:(message:string)=>void=()=>{}){}
 setSeatProvider(provider:()=>readonly SeatTarget[]):void{this.seats=provider;}
 get phase(){return this.action?.kind??'standing';}
 get locked(){return !!this.action;}
 get posture(){return this.action?.kind==='seated'?{kind:'seated' as const,seatId:this.action.seat.id}:undefined;}
 get resumeFeet():Vector3Like{return this.action?.kind==='approach-seat'?this.motor.position:this.action?.kind==='vault'?this.action.plan.start:this.action?this.action.exit:this.motor.position;}
 get motion():GroundMotion{
  const a=this.action,m:GroundMotion={sit:0,seatHeight:.53,landing:this.impact,verticalSpeed:this.motor.velocity.y};
  if(!a)return m;
  if(a.kind==='approach-seat'){if(Math.hypot(this.motor.velocity.x,this.motor.velocity.z)>.05)m.bodyYaw=Math.atan2(-this.motor.velocity.x,-this.motor.velocity.z);return m;}
  if(a.kind==='vault'){
   const p=a.time/1.08,f=forward(a.plan.yaw);m.vault=p;m.bodyYaw=a.plan.yaw;
   m.handForward=(a.plan.rail.minX+a.plan.rail.maxX)*.5*f.x+(a.plan.rail.minZ+a.plan.rail.maxZ)*.5*f.z-this.motor.position.x*f.x-this.motor.position.z*f.z;
   m.handHeight=a.plan.rail.maxY-this.motor.position.y;return m;
  }
  m.seatHeight=a.seat.position.y-a.seat.floorY;
  m.sit=a.kind==='seated'?1:seatTransition(a.seat,a.start,a.kind==='sit-down'?new Vector3(a.seat.position.x,a.seat.floorY,a.seat.position.z):a.exit,a.time/seatDuration(a.seat,a.kind==='sit-down'),a.kind==='sit-down').sit;
  m.bodyYaw=a.kind==='sit-down'?angle(a.initialYaw,a.seat.yaw,smooth(a.time/.32)):a.seat.yaw;
  return m;
 }
 get status():string{
  if(this.action?.blocked)return '动作前方被挡住，保持当前姿势，等待空间让开…';
  if(this.action?.kind==='vault'&&this.action.retreat)return '落点或通道改变，保持收腿，退回栏杆这一侧…';
  return this.phase==='approach-seat'?'正在走到座位旁 · WASD / Space 可取消':this.phase==='seated'?'坐着休息 · 拖动环视 · E / Space 起身 · WASD 起身后行走':this.phase==='sit-down'?'转身、屈膝，慢慢落座…':this.phase==='stand-up'?'让开座面，站稳后继续走…':this.phase==='vault'?'扶栏、收腿、跨越后落地…':this.proximityHint||'Space 跳跃 · 靠近座椅或低栏，按 E 互动';
 }
 get yaw():number|undefined{return this.action?.kind==='vault'?this.action.plan.yaw:this.action?.seat.yaw;}
 interaction(yaw:number):GroundInteraction|null{
  if(this.action)return this.action.kind==='seated'?{kind:'stand',label:'起身 · WASD 也可起身行走'}:null;
  this.proximityHint='';
  if(!this.motor.grounded||Math.abs(this.motor.velocity.y)>.1)return null;
  const p=this.motor.position;
  for(const seat of [...this.seats()].sort((a,b)=>Math.hypot(p.x-a.position.x,p.z-a.position.z)-Math.hypot(p.x-b.position.x,p.z-b.position.z))){
   const plan=this.planSeat(seat);if(plan)return{kind:'sit',seat,label:plan.length?'走到座位旁坐下':seat.kind==='chair'?'坐下休息':'坐下休息 / 看海'};
  }
  const plan=this.planVault(yaw);return plan?{kind:'vault',plan,label:'翻越低栏 · 确认落点后跨过'}:null;
 }
 interact(value:GroundInteraction,yaw:number):boolean{
  if(value.kind==='stand')return this.stand();
  if(this.action)return false;
  if(value.kind==='sit'){
   const path=this.planSeat(value.seat);if(!path)return false;
   this.action={kind:path.length?'approach-seat':'sit-down',seat:value.seat,start:this.motor.position.clone(),exit:path.at(-1)?.clone()??this.motor.position.clone(),initialYaw:yaw,time:0,path};
   this.motor.stop();this.lastClear.copy(this.motor.position);return true;
  }
  const plan=this.planVault(yaw);if(!plan)return false;
  this.action={kind:'vault',plan,time:0};this.motor.stop();this.lastClear.copy(this.motor.position);return true;
 }
 restoreSeat(id:string):boolean{
  const seat=this.seats().find(s=>s.id===id&&s.available());if(!seat)return false;
  const seated=new Vector3(seat.position.x,seat.floorY,seat.position.z),exit=this.exitCandidates(seat).find(p=>this.motor.canOccupy(p)&&this.seatPathClear(seat,seated,p,false));
  if(!exit||!this.postureClear(seat,seated,1))return false;
  this.action={kind:'seated',seat,start:exit.clone(),exit,initialYaw:seat.yaw,time:seatDuration(seat,true)};this.motor.position.copy(seated);this.motor.stop();this.motor.grounded=true;return true;
 }
 stand():boolean{
  const a=this.action;if(!a||a.kind!=='seated')return false;
  const candidates=[a.exit,...this.exitCandidates(a.seat)];
  for(const end of candidates){const floor=this.motor.surfaceAt(end.x,end.z,a.seat.floorY+.25,.45);if(floor===null||Math.abs(floor-a.seat.floorY)>.25)continue;end.y=floor;
   if(this.motor.canOccupy(end)&&this.seatPathClear(a.seat,this.motor.position,end,false)){this.action={...a,kind:'stand-up',start:this.motor.position.clone(),exit:end.clone(),time:0};return true;}
  }
  this.notice('椅前空间被挡住，暂时无法起身。请先让出落脚位置。');return false;
 }
 cancel():void{
  if(!this.action)return;const feet=this.resumeFeet;
  if(this.motor.canOccupy(feet))this.motor.position.copy(feet);
  this.action=undefined;this.motor.stop();
 }
 landed(speed:number):void{this.impact=Math.max(this.impact,clamp((speed-2)/6));}
 update(dt:number):boolean{
  this.impact*=Math.exp(-dt*10);const a=this.action;if(!a)return false;
  if(a.kind!=='vault'&&!a.seat.available()&&!a.recovery){
   if(a.kind==='seated'&&this.stand()){if(this.action&&this.action.kind!=='vault')this.action.recovery=true;this.notice('座位失去支撑，正在起身离开。');return true;}
   this.action=undefined;this.motor.stop();this.notice('座位已经损坏，身体恢复下落。');return false;
  }
  if(a.kind==='seated'){if(!this.postureClear(a.seat,this.motor.position,1)){if(!this.stand()){this.action=undefined;return false;}}this.motor.grounded=true;return true;}
  if(a.kind==='approach-seat'){
   const next=a.path?.[0];
   if(!next){this.motor.stop();this.action={...a,kind:'sit-down',start:this.motor.position.clone(),exit:this.motor.position.clone(),time:0};return true;}
   const dx=next.x-this.motor.position.x,dz=next.z-this.motor.position.z,d=Math.hypot(dx,dz);
   if(d<.055){a.path!.shift();return true;}
   const before=this.motor.position.clone(),scale=Math.min(.55,d/.22);
   this.motor.update(dt,{x:dx/d*scale,z:dz/d*scale});
   a.waiting=this.motor.position.distanceToSquared(before)<1e-7?(a.waiting??0)+dt:0;
   if(this.motor.recoveredLastStep||this.motor.position.y<a.seat.floorY-.5||(a.waiting??0)>1.1){this.action=undefined;this.motor.pauseInput();this.notice('前往椅子的通道改变，请靠近空的一侧再坐。');return false;}
   return true;
  }
  const duration=a.kind==='vault'?1.08:seatDuration(a.seat,a.kind==='sit-down'),endTime=a.kind==='vault'&&a.retreat?Math.max(0,a.time-dt):Math.min(duration,a.time+dt),count=Math.max(1,Math.ceil(Math.abs(endTime-a.time)/.012));
  const startTime=a.time;let acceptedTime=startTime;
  for(let i=1;i<=count;i++){
   const time=lerp(startTime,endTime,i/count),t=time/duration;
   if(a.kind==='vault'){
    const p=vaultPoint(a.plan,t),floor=this.motor.surfaceAt(a.plan.end.x,a.plan.end.z,a.plan.end.y+.15,.35);
    if(!a.retreat&&(floor===null||Math.abs(floor-a.plan.end.y)>.15)){a.time=acceptedTime;a.retreat=true;this.notice('落点已改变，正在退回栏杆这一侧。');return true;}
    if(!vaultBodyClear(this.motor,a.plan,t)){
     a.time=acceptedTime;if(!a.retreat){a.retreat=true;this.notice('通道被挡住，正在原路退回。');}
     else if(!a.blocked){a.blocked=true;this.notice('退回通道被挡住，保持收腿等待让开。');}return true;
    }
    a.blocked=false;
    this.motor.position.copy(p);this.motor.grounded=t<.18;
   }else{
    const {position:p,sit}=seatTransition(a.seat,a.start,a.kind==='sit-down'?new Vector3(a.seat.position.x,a.seat.floorY,a.seat.position.z):a.exit,t,a.kind==='sit-down');
    if(!this.postureClear(a.seat,p,sit)){a.time=acceptedTime;if(!a.blocked)this.notice('动作空间被挡住，保持姿势等待让开。');a.blocked=true;this.motor.stop();return true;}
    a.blocked=false;
    this.motor.position.copy(p);this.motor.grounded=true;
   }
   this.lastClear.copy(this.motor.position);
   acceptedTime=time;
  }
  a.time=endTime;
  if(a.kind==='vault'&&a.retreat?endTime<=0:endTime>=duration){
   if(a.kind==='sit-down')this.action={...a,kind:'seated'};
   else{this.action=undefined;this.motor.stop();this.motor.grounded=true;if(a.kind==='vault'&&!a.retreat)this.landed(5);}
  }
  return true;
 }
 private postureClear(seat:SeatTarget,p:Vector3Like,blend:number):boolean{
  const f=forward(seat.yaw),hip=seatHip(seat.position.y-seat.floorY,blend),theta=Math.acos(clamp((seat.position.y-seat.floorY+.075-.51)/.37,-1,1))*blend,reach=.37*Math.sin(theta);
  if(!this.motor.postureClear({x:p.x,y:p.y+hip-.055,z:p.z},1.01,.285,.29,seat.yaw))return false;
  if(!this.motor.postureClear({x:p.x+f.x*reach*.5,y:p.y+hip-.04,z:p.z+f.z*reach*.5},.13,.19,.19,seat.yaw))return false;
  for(const side of [-.095,.095])if(!this.motor.postureClear({x:p.x+f.x*reach+f.z*side,y:p.y+.005,z:p.z+f.z*reach-f.x*side},.51,.13,.15,seat.yaw))return false;
  return true;
 }
 private seatPathClear(seat:SeatTarget,start:Vector3Like,end:Vector3Like,sitting:boolean):boolean{
  for(let i=0;i<=48;i++){const pose=seatTransition(seat,start,end,i/48,sitting);if(!this.postureClear(seat,pose.position,pose.sit))return false;}return true;
 }
 private exitCandidates(seat:SeatTarget):Vector3[]{
  const f=forward(seat.yaw),side={x:f.z,z:-f.x},point=(u:number,v:number)=>new Vector3(seat.position.x+side.x*u+f.x*v,seat.floorY,seat.position.z+side.z*u+f.z*v);
  return seat.kind==='chair'?[-1,1].flatMap(s=>[point(s*.58,.03),point(s*.70,.03)]):[0,.45,-.45,.8,-.8].map(u=>point(u,.92));
 }
 private walkPathClear(start:Vector3,end:Vector3):boolean{
  const n=Math.max(1,Math.ceil(start.distanceTo(end)/.10));let y=start.y;
  for(let i=0;i<=n;i++){
   const p=start.clone().lerp(end,i/n),floor=this.motor.surfaceAt(p.x,p.z,y+.32,.65);
   if(floor===null||Math.abs(floor-y)>.33||!this.motor.canOccupy({x:p.x,y:floor,z:p.z}))return false;y=floor;
  }return Math.abs(y-end.y)<.15;
 }
 private planSeat(seat:SeatTarget):Vector3[]|null{
  const p=this.motor.position,f=forward(seat.yaw),side={x:f.z,z:-f.x},dx=p.x-seat.position.x,dz=p.z-seat.position.z;
  const along=dx*side.x+dz*side.z,depth=dx*f.x+dz*f.z;
  const halfWidth=seat.halfWidth??.95,halfDepth=seat.halfDepth??.30;
  if(Math.hypot(Math.max(0,Math.abs(along)-halfWidth),Math.max(0,Math.abs(depth)-halfDepth))>1.2||Math.abs(p.y-seat.floorY)>.32||!seat.available())return null;
  const seated=new Vector3(seat.position.x,seat.floorY,seat.position.z);
  if((seat.kind!=='chair'||Math.abs(along)>=.50&&Math.abs(along)<=.72&&Math.abs(depth)<.12)&&this.seatPathClear(seat,p,seated,true))return[];
  const point=(u:number,v:number)=>new Vector3(seat.position.x+side.x*u+f.x*v,seat.floorY,seat.position.z+side.z*u+f.z*v);
  const paths:Vector3[][]=[];
  const entries=seat.kind==='chair'?this.exitCandidates(seat):[.75,.95].flatMap(v=>[0,.35,-.35].map(u=>point(u,v)));
  for(const front of entries){
   const approachDepth=(front.x-seat.position.x)*f.x+(front.z-seat.position.z)*f.z;
   if(!this.motor.canOccupy(front)||!this.seatPathClear(seat,front,seated,true))continue;
   paths.push([front]);
   for(const s of [-1,1])paths.push([point(s*(halfWidth+.5),clamp(depth,-halfDepth-.55,Math.max(.95,approachDepth))),point(s*(halfWidth+.5),approachDepth),front]);
  }
  const result=paths.filter(path=>{let from=p;for(const to of path){if(!this.walkPathClear(from,to))return false;from=to;}return true;}).sort((a,b)=>{
   const length=(path:Vector3[])=>path.reduce((s,to,i)=>s+to.distanceTo(i?path[i-1]:p),0);return length(a)-length(b);
  })[0]??null;
  if(!result)this.proximityHint='椅前通道被挡住，请从空的一侧靠近。';return result;
 }
 private planVault(_yaw:number):VaultPlan|null{
  const start=this.motor.position;
  for(const frame of nearbyRailFrames([...this.obstacles(),...voxelRailsNear(this.motor)],start)){
   const {rail,normal:n,tangent:t,half}=frame,projected=start.x*n.x+start.z*n.z,sign=Math.sign(frame.plane-projected),d=Math.abs(frame.plane-projected),along=start.x*t.x+start.z*t.z;
   if(d<half+.275||d>half+1.2||along<frame.low-.1||along>frame.high+.1)continue;
   if(frame.top-start.y>1.5){this.proximityHint='这段栏杆超过可翻高度，请走台阶或缺口。';continue;}if(frame.top-start.y<.45)continue;
   const landingAlong=clamp(along,frame.low+.30,frame.high-.30),end=new Vector3(n.x*(frame.plane+sign*(half+.70))+t.x*landingAlong,start.y,n.z*(frame.plane+sign*(half+.70))+t.z*landingAlong);
   this.proximityHint='此处落点或通道不安全，沿栏杆换个位置。';
   const floor=this.motor.surfaceAt(end.x,end.z,start.y+1.05,2.1);if(floor===null||floor<=12.2||Math.abs(start.y-floor)>1.05){this.proximityHint='栏杆另一侧是水面或落差过大，无法安全落脚。';continue;}end.y=floor;if(!this.motor.canOccupy(end))continue;
   if(frame.top-Math.min(start.y,floor)>1.5){this.proximityHint='两侧高差过大，无法安全往返，请走台阶或缺口。';continue;}
   let supported=true;for(const dx of [-.19,.19])for(const dz of [-.19,.19]){const y=this.motor.surfaceAt(end.x+dx,end.z+dz,floor+.08,.3);if(y===null||Math.abs(y-floor)>.15)supported=false;}if(!supported)continue;
   const launch=new Vector3(n.x*(frame.plane-sign*(half+.56))+t.x*landingAlong,start.y,n.z*(frame.plane-sign*(half+.56))+t.z*landingAlong);
   const plan={start:start.clone(),launch,end,rail,yaw:Math.atan2(-n.x*sign,-n.z*sign),apex:Math.max(start.y,end.y,frame.top-.42)};
   let clear=true;for(let i=0;i<=72;i++)if(!vaultBodyClear(this.motor,plan,i/72)){clear=false;break;}
   if(clear){this.proximityHint='';return plan;}
  }return null;
 }
}
