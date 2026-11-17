import type { SceneObstacle } from '../input/scene-collisions';
import { Material } from '../world/palette';
import { regionalHeightAt } from '../world/region-terrain';
import type { Vector3Like, VoxelWorld } from '../world/voxel';
import type {TrafficBodyState} from '../destruction/physics';
import {Quaternion,Vector3} from 'three';
import {orientedBoxBounds,contactSeparates} from '../input/scene-collisions';
import {bypassPose,planTrafficBypass,trafficBounds,trafficBoundsOverlap,type TrafficBypass} from './traffic-bypass';
import {JunctionFlow} from './junction-flow';

export type LifeContext={focus:Vector3Like;player?:{position:Vector3Like;radius:number};vehicle?:{position:Vector3Like;heading:number;speed:number};night:number;wetness:number;obstacles:readonly SceneObstacle[];obstacleRevision?:number;dynamicObstacles?:readonly SceneObstacle[];trafficPhysics?:readonly TrafficBodyState[]};
type P={x:number;z:number};
export type RoadRoute={id:string;points:P[];lengths:number[];length:number};
export type LifeCar={id:number;kind:'sedan'|'van'|'bus';route:RoadRoute;distance:number;position:{x:number;y:number;z:number};heading:number;speed:number;maxSpeed:number;length:number;width:number;height:number;waiting:boolean;visible:boolean;braking:boolean;travelled:number;bounds:SceneObstacle;physicsRotation?:TrafficBodyState['rotation'];bypass?:TrafficBypass;bypassYieldAt?:number;nextBypassCheck?:number};
export type LifePerson={id:number;a:P;b:P;progress:number;direction:number;position:{x:number;y:number;z:number};heading:number;speed:number;pace:number;phase:number;wait:number;blockedFor:number;crossing:boolean;committed:boolean;retreating:boolean;visible:boolean;bounds:SceneObstacle};
export type PedestrianSurface=(x:number,z:number,maxTop:number)=>number|null;
export const SIGNALS=[{x:130,z:164},{x:176,z:164},{x:84,z:80},{x:130,z:80},{x:176,z:80},{x:222,z:125}] as const;
export const signalAnchor=(light:P)=>({x:light.x+7,z:light.z+6});
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const angle=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
export function signalPhase(seconds:number):'east-west'|'north-south'|'pedestrians'|'clearance'{const t=((seconds%44)+44)%44;return t<16?'east-west':t<18?'clearance':t<32?'north-south':t<34?'clearance':'pedestrians';}

/** Rounded closed paths stay on the actual right-hand road lanes. No endpoint teleport. */
export function roundedRoute(id:string,corners:readonly P[],radius=5):RoadRoute{
  const points:P[]=[];
  corners.forEach((p,i)=>{
    const prev=corners[(i+corners.length-1)%corners.length],next=corners[(i+1)%corners.length];
    const li=Math.hypot(p.x-prev.x,p.z-prev.z),lo=Math.hypot(next.x-p.x,next.z-p.z),r=Math.min(radius,li*.25,lo*.25);
    const a={x:p.x+(prev.x-p.x)*r/li,z:p.z+(prev.z-p.z)*r/li},b={x:p.x+(next.x-p.x)*r/lo,z:p.z+(next.z-p.z)*r/lo};
    for(let k=0;k<=8;k++){const t=k/8,u=1-t;points.push({x:u*u*a.x+2*u*t*p.x+t*t*b.x,z:u*u*a.z+2*u*t*p.z+t*t*b.z});}
  });
  const lengths=points.map((p,i)=>Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].z-p.z));
  return {id,points,lengths,length:lengths.reduce((a,b)=>a+b,0)};
}
export const TRAFFIC_ROUTES=[
  roundedRoute('city-clockwise',[{x:40,z:82},{x:220,z:82},{x:220,z:162},{x:40,z:162}]),
  roundedRoute('city-counterclockwise',[{x:36,z:166},{x:224,z:166},{x:224,z:78},{x:36,z:78}]),
  roundedRoute('port-delivery',[{x:224,z:82},{x:330,z:82},{x:468.7,z:81.5},{x:518.7,z:126.5},{x:518.7,z:143},{x:470.5,z:143},{x:390.5,z:123},{x:224,z:123}],5),
];
export function sampleRoute(route:RoadRoute,distance:number):{x:number;z:number;heading:number}{
  let d=((distance%route.length)+route.length)%route.length;
  for(let i=0;i<route.points.length;i++){const len=route.lengths[i];if(d<=len){const a=route.points[i],b=route.points[(i+1)%route.points.length],t=len?d/len:0;return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,heading:Math.atan2(a.x-b.x,a.z-b.z)};}d-=len;}
  return {...route.points[0],heading:0};
}
function boundsAt(position:Vector3Like,heading:number,width:number,length:number,height:number,target:SceneObstacle):void{
  const c=Math.abs(Math.cos(heading)),s=Math.abs(Math.sin(heading)),hx=c*width/2+s*length/2,hz=s*width/2+c*length/2;
  Object.assign(target,{minX:position.x-hx,maxX:position.x+hx,minY:position.y,maxY:position.y+height,minZ:position.z-hz,maxZ:position.z+hz});
}
const emptyBounds=():SceneObstacle=>({minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0});
const overlap=(a:SceneObstacle,b:SceneObstacle,margin=0)=>a.minX<b.maxX+margin&&a.maxX>b.minX-margin&&a.minY<b.maxY&&a.maxY>b.minY&&a.minZ<b.maxZ+margin&&a.maxZ>b.minZ-margin;
const valid=(b:SceneObstacle)=>b.maxY>b.minY;
function carOverlap(position:P,heading:number,width:number,length:number,other:LifeCar):boolean{
  const dx=other.position.x-position.x,dz=other.position.z-position.z;
  const a=[[Math.cos(heading),-Math.sin(heading)],[-Math.sin(heading),-Math.cos(heading)]],b=[[Math.cos(other.heading),-Math.sin(other.heading)],[-Math.sin(other.heading),-Math.cos(other.heading)]];
  for(const [x,z] of [...a,...b]){
    const ours=Math.abs(x*a[0][0]+z*a[0][1])*width/2+Math.abs(x*a[1][0]+z*a[1][1])*length/2;
    const theirs=Math.abs(x*b[0][0]+z*b[0][1])*other.width/2+Math.abs(x*b[1][0]+z*b[1][1])*other.length/2;
    if(Math.abs(dx*x+dz*z)>=ours+theirs+.12)return false;
  }
  return true;
}

export class StreetLifeSimulation{
  private removedTraffic=new Set<number>();
  private readonly surfaceAt:PedestrianSurface|undefined;
  readonly cars:LifeCar[]=[];
  readonly people:LifePerson[]=[];
  readonly obstacles:SceneObstacle[]=[];
  readonly pedestrianObstacles:SceneObstacle[]=[];
  elapsed=0;
  private accumulator=0;
  private candidateBounds=emptyBounds();
  private obstacleGrid=new Map<string,SceneObstacle[]>();
  private indexedSource:readonly SceneObstacle[]|undefined;
  private indexedRevision:number|undefined;
  private indexedFloor=Infinity;private indexedCeiling=-Infinity;
  private movingObstacles:SceneObstacle[]=[];
  private dynamicObstacles:readonly SceneObstacle[]=[];
  private junctions=new JunctionFlow(sampleRoute,SIGNALS,signalPhase,TRAFFIC_ROUTES,light=>{const p=signalAnchor(light);return !!this.world.getVoxel(p.x,15,p.z);});
  private roadCells=new Map<number,{revision:number;chunk:unknown;clearance:number;material:number}>();
  private previousCars=new Map<number,{x:number;y:number;z:number;heading:number}>();
  /** Fixed scenery is indexed until its source/revision changes; falling props
   * remain live queries and must never leave stale entries in the fixed grid. */
  private indexObstacles(obstacles:readonly SceneObstacle[],revision?:number):void{
    let floor=16,ceiling=20;
    for(const p of this.people){floor=Math.min(floor,p.position.y);ceiling=Math.max(ceiling,p.position.y+1.76);}
    for(const c of this.cars){floor=Math.min(floor,c.position.y);ceiling=Math.max(ceiling,c.position.y+c.height);}
    // Spawn repair can lift 1.05m, followed by a normal 0.32m tread in this
    // same step. Keep their combined reach inside the already indexed band.
    const covered=floor>=this.indexedFloor+1.5&&ceiling<=this.indexedCeiling-1.5;
    if(covered&&this.indexedSource&&(revision!==undefined?this.indexedRevision===revision:this.indexedSource===obstacles&&this.indexedRevision===undefined))return;
    // This grid serves road traffic and pedestrians only. Upper-storey details
    // outside every actor's vertical reach need no traffic-grid entries. Keep
    // two metres of headroom and rebuild before an actor leaves that band;
    // player/aircraft collision and live falling props remain independent.
    this.indexedFloor=Math.floor(floor)-2;this.indexedCeiling=Math.ceil(ceiling)+2;
    this.indexedSource=obstacles;this.indexedRevision=revision;this.movingObstacles.length=0;
    this.obstacleGrid.clear();
    for(const b of obstacles){
      if(b.motion||b.physicsManaged||b.trafficId!==undefined){this.movingObstacles.push(b);continue;}
      if(!valid(b)||b.maxY<this.indexedFloor||b.minY>this.indexedCeiling)continue;
      for(let y=Math.floor(Math.max(b.minY,this.indexedFloor)/4);y<=Math.floor(Math.min(b.maxY,this.indexedCeiling)/4);y++)for(let z=Math.floor(b.minZ/16);z<=Math.floor(b.maxZ/16);z++)for(let x=Math.floor(b.minX/16);x<=Math.floor(b.maxX/16);x++){
        const key=`${x},${y},${z}`,bucket=this.obstacleGrid.get(key);if(bucket)bucket.push(b);else this.obstacleGrid.set(key,[b]);
      }
    }
  }
  private nearbyObstacles(b:SceneObstacle,margin=0):SceneObstacle[]{
    const found=new Set<SceneObstacle>();
    for(let y=Math.floor(b.minY/4);y<=Math.floor(b.maxY/4);y++)for(let z=Math.floor((b.minZ-margin)/16);z<=Math.floor((b.maxZ+margin)/16);z++)for(let x=Math.floor((b.minX-margin)/16);x<=Math.floor((b.maxX+margin)/16);x++){
      for(const other of this.obstacleGrid.get(`${x},${y},${z}`)??[])if(overlap(b,other,margin))found.add(other);
    }
    for(const other of this.movingObstacles)if(overlap(b,other,margin))found.add(other);
    for(const other of this.dynamicObstacles)if(valid(other)&&overlap(b,other,margin))found.add(other);
    return [...found];
  }
  constructor(readonly world:VoxelWorld,options:{cars?:number;people?:boolean;surfaceAt?:PedestrianSurface;removedTraffic?:readonly number[]}={}){
    this.removedTraffic=new Set(options.removedTraffic);
    this.surfaceAt=options.surfaceAt;
    const count=options.cars??18;
    const per=[Math.ceil(count*8/18),Math.floor(count*5/18),0];per[2]=count-per[0]-per[1];
    let id=0;
    TRAFFIC_ROUTES.forEach((route,r)=>{
      for(let i=0;i<per[r];i++){
        const kind:LifeCar['kind']=id%8===2?'bus':id%4===1?'van':'sedan';
        const length=kind==='bus'?6.4:kind==='van'?4.8:4.05,width=kind==='bus'?2:1.75,height=kind==='bus'?2.65:kind==='van'?2.15:1.45;
        let distance=(i+.28+r*.09)*route.length/per[r],p=sampleRoute(route,distance);
        for(let n=0;n<80&&!this.roadClear(p,p.heading,width,length,height);n++){distance+=2;p=sampleRoute(route,distance);}
        const bounds=emptyBounds(),car:LifeCar={id:id++,kind,route,distance,position:{x:p.x,y:16,z:p.z},heading:p.heading,speed:0,maxSpeed:kind==='bus'?5.2:5.7+(id%3)*.45,length,width,height,waiting:false,visible:true,braking:false,travelled:0,bounds};
        this.cars.push(car);this.obstacles.push(bounds);boundsAt(car.position,car.heading,width,length,height,bounds);
        if(this.removedTraffic.has(car.id)){car.visible=false;bounds.maxY=-1;}
      }
    });
    if(options.people!==false)this.createPeople();
  }
  /** Rejoin the existing route as part of the manual action. A route with no
   * safe space leaves the car withdrawn; there is no automatic respawn job. */
  clearAccidents(ids:ReadonlySet<number>,focus:Vector3Like,clear:(bounds:SceneObstacle)=>boolean):{resumed:number;removed:number[]}{
    let resumed=0;const removed:number[]=[];
    for(const car of this.cars){
      // The physical snapshot can be one frame ahead of the visual simulator.
      if(!ids.has(car.id))continue;
      let accepted:{distance:number;pose:ReturnType<typeof sampleRoute>}|undefined;
      for(let offset=8;offset<car.route.length;offset+=8){
        const distance=car.distance+offset,p=sampleRoute(car.route,distance),b=trafficBounds(p,car.width+.3,car.length+1,car.height);
        if(Math.hypot(p.x-focus.x,p.z-focus.z)<80||!this.roadClear(p,p.heading,car.width+.25,car.length+.5,car.height)||!this.roadClear(sampleRoute(car.route,distance+7),p.heading,car.width,car.length,car.height))continue;
        if(this.cars.some(other=>other!==car&&other.visible&&(!ids.has(other.id)||!other.physicsRotation)&&trafficBoundsOverlap(b,other.bounds,1.5))||this.people.some(person=>person.visible&&trafficBoundsOverlap(b,person.bounds,1))||!clear(b))continue;
        accepted={distance,pose:p};break;
      }
      delete car.physicsRotation;delete car.bypass;delete car.bypassYieldAt;delete car.nextBypassCheck;
      car.speed=0;car.waiting=false;car.braking=false;
      if(accepted){
        car.distance=accepted.distance;Object.assign(car.position,accepted.pose,{y:16});car.heading=accepted.pose.heading;car.visible=true;
        boundsAt(car.position,car.heading,car.width,car.length,car.height,car.bounds);this.removedTraffic.delete(car.id);resumed++;
      }else{this.removedTraffic.add(car.id);removed.push(car.id);car.visible=false;car.bounds.minY=0;car.bounds.maxY=-1;}
      car.bounds.trafficHeading=car.heading;car.bounds.trafficVelocity={x:0,y:0,z:0};
      this.previousCars.set(car.id,{...car.position,heading:car.heading});
    }
    return{resumed,removed};
  }
  get diagnostics(){return {cars:this.cars.length,people:this.people.length,movingCars:this.cars.filter(c=>c.visible&&c.speed>.2).length,waitingCars:this.cars.filter(c=>c.visible&&c.waiting).length,detouringCars:this.cars.filter(c=>!!c.bypass).length,walkingPeople:this.people.filter(p=>p.visible&&p.speed>.1).length,waitingPeople:this.people.filter(p=>p.visible&&p.speed<.1).length,signal:signalPhase(this.elapsed),junctions:this.junctions.diagnostics};}
  update(dt:number,context:LifeContext):void{
    for(const car of this.cars){
      if(this.removedTraffic.has(car.id))continue;
      car.bounds.trafficId=car.id;
      car.bounds.trafficKind=car.kind;
      car.bounds.trafficVelocity={x:-Math.sin(car.heading)*car.speed,y:0,z:-Math.cos(car.heading)*car.speed};
      car.bounds.trafficHeading=car.heading;car.bounds.trafficHalfSize={x:car.width/2,y:car.height/2,z:car.length/2};
      const state=context.trafficPhysics?.find(s=>s.id===car.id);if(!state)continue;
      const q=new Quaternion().copy(state.rotation),p=new Vector3(0,-car.height/2,0).applyQuaternion(q).add(state.position),f=new Vector3(0,0,-1).applyQuaternion(q);
      Object.assign(car.position,p);car.physicsRotation=state.rotation;car.bypass=undefined;car.visible=true;car.speed=Math.hypot(state.linearVelocity.x,state.linearVelocity.z);car.heading=Math.atan2(-f.x,-f.z);car.braking=true;
      orientedBoxBounds(state.position,state.rotation,{x:Math.max(car.width/2,car.width*.48+.11),y:car.height/2,z:car.length/2},car.bounds);
    }
    this.accumulator+=clamp(dt,0,.1);
    this.dynamicObstacles=context.dynamicObstacles??[];
    if(this.accumulator>=1/30)this.indexObstacles(context.obstacles,context.obstacleRevision);
    while(this.accumulator>=1/30){this.accumulator-=1/30;this.elapsed+=1/30;this.step(1/30,context);}
  }
  private step(dt:number,context:LifeContext):void{
    for(const car of this.cars)this.previousCars.set(car.id,{...car.position,heading:car.heading});
    this.junctions.update(this.cars,this.elapsed,context,(car,x,z,heading)=>this.roadClear({x,z},heading,car.width,car.length,car.height));
    for(const car of this.cars){
      if(this.removedTraffic.has(car.id))continue;
      if(car.physicsRotation)continue;
      const supported=this.roadClear(car.position,car.heading,car.width,car.length,car.height);
      car.visible=supported;
      if(!supported){car.speed=0;car.waiting=true;car.bounds.minY=0;car.bounds.maxY=-1;continue;}
      if(car.bypass&&car.distance>=car.bypass.end)car.bypass=undefined;
      this.checkBypass(car,context);
      let desired=car.maxSpeed*(1-context.wetness*.18);
      desired=Math.min(desired,this.junctions.speedLimit(car));
      if(car.bypass)desired=Math.min(desired,2.8);
      else if(car.bypassYieldAt!==undefined)desired=Math.min(desired,Math.sqrt(2*5.5*Math.max(0,car.bypassYieldAt-car.distance)));
      const ahead=this.routePose(car,car.distance+4);
      const turning=!!car.bypass||Math.abs(angle(ahead.heading-car.heading))>.12||Math.abs(angle(this.routePose(car,car.distance+10).heading-car.heading))>.12;
      if(Math.abs(angle(ahead.heading-car.heading))>.12)desired=Math.min(desired,3.2);
      // These poses describe this car's curved lane, independent of whichever
      // other vehicle is being perceived. Sample them once per simulation step.
      const turnSamples=turning?[.5,1,2,3.5,5.5,8,12,18].map(distance=>({distance,pose:this.routePose(car,car.distance+distance)})):[];
      const fx=-Math.sin(car.heading),fz=-Math.cos(car.heading);
      const lane=sampleRoute(car.route,car.distance),lfx=-Math.sin(lane.heading),lfz=-Math.cos(lane.heading),phase=signalPhase(this.elapsed),axis=Math.abs(lfx)>.85?'east-west':Math.abs(lfz)>.85?'north-south':null;
      if(axis&&phase!==axis&&!this.junctions.committed(car))for(const light of SIGNALS){
        const anchor=signalAnchor(light);if(!this.world.getVoxel(anchor.x,15,anchor.z))continue;
        const dx=light.x-car.position.x,dz=light.z-car.position.z,front=dx*lfx+dz*lfz,lateral=Math.abs(dx*lfz-dz*lfx);
        if(front>5&&front<24&&lateral<3.4)desired=Math.min(desired,Math.sqrt(2*4.5*Math.max(0,front-10.2)));
      }
      const perceive=(b:SceneObstacle,extra=0)=>{
        if(!valid(b)||b.maxY<=car.position.y+.1||b.minY>=car.position.y+car.height)return;
        if(b.maxX<car.position.x-28||b.minX>car.position.x+28||b.maxZ<car.position.z-28||b.minZ>car.position.z+28)return;
        const dx=(b.minX+b.maxX)/2-car.position.x,dz=(b.minZ+b.maxZ)/2-car.position.z;
        const hx=(b.maxX-b.minX)/2,hz=(b.maxZ-b.minZ)/2,front=dx*fx+dz*fz,lateral=Math.abs(dx*fz-dz*fx),side=Math.abs(fz)*hx+Math.abs(fx)*hz;
        const gap=front-(Math.abs(fx)*hx+Math.abs(fz)*hz)-car.length/2;
        if(front>0&&lateral<car.width/2+side+.3+extra&&gap<22)desired=Math.min(desired,Math.sqrt(2*5.5*Math.max(0,gap-1.5-extra)));
      };
      for(const other of this.cars)if(other!==car&&other.visible){
        if(other.physicsRotation&&!car.bypass){perceive(other.bounds,.25);continue;}
        const dx=other.position.x-car.position.x,dz=other.position.z-car.position.z,front=dx*fx+dz*fz;
        if(Math.hypot(dx,dz)>30)continue;
        if(turning){
          // Follow the curved lane, not an infinite straight braking corridor.
          // At the waterfront bend that corridor points into the opposing queue
          // even though the car's actual turning footprint clears it.
          for(const {distance,pose:p} of turnSamples)if(carOverlap(p,p.heading,car.width,car.length,other)){desired=Math.min(desired,Math.sqrt(2*5.5*Math.max(0,distance-1.15)));break;}
          continue;
        }
        if(front<=0||front>30)continue;
        const relative=other.heading-car.heading,c=Math.abs(Math.cos(relative)),s=Math.abs(Math.sin(relative));
        const lateral=Math.abs(dx*fz-dz*fx),side=c*other.width/2+s*other.length/2,gap=front-c*other.length/2-s*other.width/2-car.length/2;
        if(lateral<car.width/2+side+.25)desired=Math.min(desired,Math.sqrt(2*5.5*Math.max(0,gap-1.5)));
      }
      for(const other of this.cars)if(other!==car&&other.bypass&&trafficBoundsOverlap(other.bypass.bounds,{minX:car.position.x-32,maxX:car.position.x+32,minZ:car.position.z-32,maxZ:car.position.z+32,minY:16,maxY:16+car.height})){
        for(const d of [0,1,2,4,7,10,15,20,28]){const b=trafficBounds(this.routePose(car,car.distance+d),car.width,car.length,car.height);if(other.bypass.samples.some(p=>trafficBoundsOverlap(b,p.bounds,.35))){desired=Math.min(desired,Math.sqrt(2*5.5*Math.max(0,d-2)));break;}}
      }
      for(const p of this.people)if(p.visible)perceive(p.bounds,.25);
      // Only the forward lane corridor can affect this step. A 64m square
      // repeatedly collected thousands of facade parts beside/behind each car.
      const halfWidth=car.width/2+1.2,halfLength=car.length/2+14;
      const cx=car.position.x+fx*12,cz=car.position.z+fz*12;
      const hx=Math.abs(fx)*halfLength+Math.abs(fz)*halfWidth,hz=Math.abs(fz)*halfLength+Math.abs(fx)*halfWidth;
      const nearby=this.nearbyObstacles({minX:cx-hx,maxX:cx+hx,minY:car.position.y,maxY:car.position.y+car.height,minZ:cz-hz,maxZ:cz+hz});
      for(const b of nearby)perceive(b);
      if(context.player){const p=context.player.position,r=context.player.radius;perceive({minX:p.x-r,maxX:p.x+r,minY:p.y-.5,maxY:p.y+1.8,minZ:p.z-r,maxZ:p.z+r},.5);}
      const previous=car.speed;car.speed+=clamp(desired-car.speed,-dt*6,dt*1.4);
      const peek=this.routePose(car,car.distance+.25),scale=car.bypass?Math.max(1,Math.hypot(peek.x-car.position.x,peek.z-car.position.z)/.25):1;
      const distance=car.speed*dt/scale,p=this.routePose(car,car.distance+distance);
      const next={x:p.x,y:16,z:p.z};boundsAt(next,p.heading,car.width,car.length,car.height,this.candidateBounds);
      const occupied=nearby.some(b=>overlap(this.candidateBounds,b,.12))||this.cars.some(other=>other!==car&&other.visible&&(other.physicsRotation?overlap(this.candidateBounds,other.bounds,.12):carOverlap(next,p.heading,car.width,car.length,other)))||this.people.some(person=>person.visible&&overlap(this.candidateBounds,person.bounds,.25));
      const player=context.player,meetsPlayer=player&&Math.abs(player.position.y-16)<3&&player.position.x>this.candidateBounds.minX-player.radius&&player.position.x<this.candidateBounds.maxX+player.radius&&player.position.z>this.candidateBounds.minZ-player.radius&&player.position.z<this.candidateBounds.maxZ+player.radius;
      if(!this.roadClear(next,p.heading,car.width,car.length,car.height)||occupied||meetsPlayer){car.speed=0;car.waiting=true;car.braking=true;}
      else{car.distance+=distance;car.travelled+=Math.hypot(next.x-car.position.x,next.z-car.position.z);Object.assign(car.position,next);car.heading=p.heading;car.waiting=desired<.3;car.braking=car.speed<previous-.015||desired<.4;}
      boundsAt(car.position,car.heading,car.width,car.length,car.height,car.bounds);
      car.bounds.trafficHeading=car.heading;
      car.bounds.trafficVelocity={x:-Math.sin(car.heading)*car.speed,y:0,z:-Math.cos(car.heading)*car.speed};
    }
    for(const person of this.people)this.stepPerson(person,dt,context);
  }
  private routePose(car:LifeCar,distance:number){return bypassPose(d=>sampleRoute(car.route,d),distance,car.bypass);}
  /** Render between fixed traffic steps; physical bounds stay on the current
   * simulation pose and are never delayed or smoothed through an obstacle. */
  renderCar(car:LifeCar){
    const p=this.previousCars.get(car.id),alpha=Math.min(1,this.accumulator*30);
    if(!p||car.physicsRotation)return{...car.position,heading:car.heading};
    return{x:p.x+(car.position.x-p.x)*alpha,y:p.y+(car.position.y-p.y)*alpha,z:p.z+(car.position.z-p.z)*alpha,heading:p.heading+angle(car.heading-p.heading)*alpha};
  }
  private checkBypass(car:LifeCar,context:LifeContext):void{
    if(car.bypass||this.elapsed<(car.nextBypassCheck??0))return;car.nextBypassCheck=this.elapsed+.8;car.bypassYieldAt=undefined;
    const wrecks=this.cars.filter(c=>c!==car&&c.physicsRotation&&c.visible&&c.speed<.4&&Math.hypot(c.position.x-car.position.x,c.position.z-car.position.z)<45);
    for(const wreck of wrecks){
      for(let d=0;d<=38;d+=1){const p=sampleRoute(car.route,car.distance+d);if(trafficBoundsOverlap(trafficBounds(p,car.width,car.length,car.height),wreck.bounds,.3)){car.bypassYieldAt=Math.min(car.bypassYieldAt??Infinity,car.distance+d-17);break;}}
      const plan=planTrafficBypass(d=>sampleRoute(car.route,d),car.distance,wreck.bounds,car.width,car.length,car.height,(p,b)=>{
        if(!this.bypassRoadClear(p,car)||this.nearbyObstacles(b,.18).length)return false;
        if(this.cars.some(other=>other!==car&&other.visible&&(other.physicsRotation?trafficBoundsOverlap(b,other.bounds,.2):carOverlap(p,p.heading,car.width+.3,car.length+.3,other))))return false;
        if(this.cars.some(other=>other!==car&&other.bypass&&trafficBoundsOverlap(b,other.bypass.bounds,.4)))return false;
        if(this.people.some(person=>person.visible&&trafficBoundsOverlap(b,person.bounds,.65)))return false;
        const player=context.player;if(player&&Math.abs(player.position.y-16)<3&&player.position.x>b.minX-player.radius-.5&&player.position.x<b.maxX+player.radius+.5&&player.position.z>b.minZ-player.radius-.5&&player.position.z<b.maxZ+player.radius+.5)return false;
        return true;
      });
      if(plan){car.bypass=plan;car.bypassYieldAt=undefined;return;}
    }
  }
  private bypassRoadClear(p:{x:number;z:number;heading:number},car:LifeCar):boolean{
    if(!this.roadClear(p,p.heading,car.width+.24,car.length+.2,car.height))return false;
    const c=Math.cos(p.heading),s=Math.sin(p.heading);
    for(const x of [-(car.width+.24)/2,0,(car.width+.24)/2])for(const z of [-(car.length+.2)/2,0,(car.length+.2)/2]){const m=this.world.getVoxel(Math.floor(p.x+c*x+s*z),15,Math.floor(p.z-s*x+c*z));if(m!==Material.Road&&m!==Material.Stripe)return false;}
    return true;
  }
  /** Queried every advance, independently of asynchronous render/collider meshes. */
  roadClear(p:P,heading:number,width:number,length:number,height:number):boolean{
    const center=this.roadCell(Math.floor(p.x),Math.floor(p.z)).material;
    if(![Material.Road,Material.Stripe,Material.Concrete,Material.Trim].includes(center as never))return false;
    const c=Math.cos(heading),s=Math.sin(heading);
    for(const lx of [-width*.48,0,width*.48])for(const lz of [-length*.48,0,length*.48]){
      const x=Math.floor(p.x+c*lx+s*lz),z=Math.floor(p.z-s*lx+c*lz);
      const cell=this.roadCell(x,z);if(!cell.material||cell.clearance<Math.ceil(height))return false;
    }
    return true;
  }
  private roadCell(x:number,z:number){
    const key=(x+1000000)*2000001+z+1000000,chunk=this.world.chunks.get(`${x>>5},0,${z>>5}`),old=this.roadCells.get(key);
    if(old&&old.chunk===chunk&&old.revision===(chunk?.revision??-1))return old;
    let clearance=0;const material=this.world.getVoxel(x,15,z);for(let y=16;y<20&&!this.world.getVoxel(x,y,z);y++)clearance++;
    const value={revision:chunk?.revision??-1,chunk,material,clearance};this.roadCells.set(key,value);return value;
  }
  private standingAt(x:number,z:number,previous:number,repair=false):number|null{
    let highest=-Infinity,lowest=Infinity;
    for(const [dx,dz] of [[0,0],[-.23,-.23],[-.23,.23],[.23,-.23],[.23,.23]]){
      let floor:number|null=null;
      for(let y=Math.min(93,Math.floor(previous+.05));y>=Math.max(12,Math.floor(previous-2.1));y--)if(this.world.getVoxel(Math.floor(x+dx),y,Math.floor(z+dz))){floor=y+1;break;}
      if(floor===null)return null;
      // Fine treads are real rendered solids above the old voxel surface.
      // Spawn/reconciliation may lift an already embedded actor; advancing
      // still has to obey the ordinary 32 cm step limit.
      floor=Math.max(floor,this.surfaceAt?.(x+dx,z+dz,floor+1.05)??-Infinity);
      highest=Math.max(highest,floor);lowest=Math.min(lowest,floor);
    }
    if(highest-lowest>.32||Math.abs(highest-previous)>(repair?1.05:.32))return null;
    for(const dx of [-.23,.23])for(const dz of [-.23,.23])for(let y=Math.floor(highest+.001);y<highest+1.75;y++)if(this.world.getVoxel(Math.floor(x+dx),y,Math.floor(z+dz)))return null;
    return highest;
  }
  private createPeople():void{
    const paths:number[][]=[
      [8,170.5,34,170.5],[46,170.6,76,170.6],[90,170.5,120,170.5],[140,170.6,165,170.6],[182,170.6,211,170.6],[231,170.5,249,170.5],
      [124.6,93,124.6,112],[135.4,93,135.4,112],[89.6,138,89.6,151],[78.5,138,78.5,151],[43.5,48,43.5,68],[170.4,48,170.4,68],
      [124.6,48,124.6,68],[181.6,93,181.6,112],[15,28,25,28],[11,231.3,28,231.3,15],[31,232.9,58,232.9,15],[188,169.3,210,169.3],
      [304,131,336,131],[350,131,382,131],[397,131,420,137],[340,73.8,377,73.8],[426,73.8,458,73.8],[440,183.6,477,183.6,15],[487,183.6,525,183.6,15],
      [136.1,-46,136.1,-90],[71,-57,71,-88],[188.8,-67,188.8,-96],[-59,108,-59,140],[-113,119,-137,107],
      [135.5,157.5,135.5,170.4,16,1],[181.5,73.5,181.5,86.5,16,1],
    ];
    paths.forEach(([ax,az,bx,bz,base,cross],i)=>{
      const a={x:ax,z:az},b={x:bx,z:bz};let progress=cross?0:((i*7)%23)/23;
      const preferred=base??regionalHeightAt(ax+(bx-ax)*progress,az+(bz-az)*progress)+1;
      let p={x:ax+(bx-ax)*progress,z:az+(bz-az)*progress},y=this.standingAt(p.x,p.z,preferred,true);
      for(let n=0;n<24&&y===null;n++){progress=n/24;p={x:ax+(bx-ax)*progress,z:az+(bz-az)*progress};y=this.standingAt(p.x,p.z,base??regionalHeightAt(p.x,p.z)+1,true);}
      const bounds=emptyBounds(),direction=i%2?1:-1,person:LifePerson={id:i,a,b,progress,direction:cross?1:direction,position:{...p,y:y??preferred},heading:Math.atan2(-(bx-ax)*direction,-(bz-az)*direction),speed:0,pace:cross?1.7:.8+(i%5)*.11,phase:i*1.7,wait:cross?0:(i%3)*.4,blockedFor:0,crossing:!!cross,committed:false,retreating:false,visible:y!==null,bounds};
      bounds.pedestrianId=person.id;bounds.standable=false;
      this.people.push(person);this.pedestrianObstacles.push(bounds);if(person.visible)boundsAt(person.position,0,.55,.55,1.76,bounds);else{bounds.minY=0;bounds.maxY=-1;}
    });
  }
  private stepPerson(p:LifePerson,dt:number,context:LifeContext):void{
    const currentFloor=this.standingAt(p.position.x,p.position.z,p.position.y,true);
    if(currentFloor===null){p.visible=false;p.speed=0;p.bounds.minY=0;p.bounds.maxY=-1;return;}
    p.visible=true;p.position.y=currentFloor;p.speed=0;
    boundsAt(p.position,0,.55,.55,1.76,p.bounds);
    if(p.wait>0){p.wait-=dt;return;}
    const length=Math.hypot(p.b.x-p.a.x,p.b.z-p.a.z);
    if(p.crossing&&!p.committed){const left=44-this.elapsed%44;if(signalPhase(this.elapsed)!=='pedestrians'||left<length/p.pace+.4)return;p.committed=true;}
    const travel=dt*p.pace*(1+context.wetness*.1),next=clamp(p.progress+p.direction*travel/length,0,1),x=p.a.x+(p.b.x-p.a.x)*next,z=p.a.z+(p.b.z-p.a.z)*next;
    const floor=this.standingAt(x,z,p.position.y),candidate={x,y:floor??p.position.y,z};boundsAt(candidate,0,.55,.55,1.76,this.candidateBounds);
    const player=context.player,oldDistance=player?Math.hypot(p.position.x-player.position.x,p.position.z-player.position.z):Infinity,newDistance=player?Math.hypot(x-player.position.x,z-player.position.z):Infinity;
    const leavingPlayer=!!player&&oldDistance<player.radius+.44&&newDistance>oldDistance+1e-6;
    const meetsPlayer=player&&Math.abs(player.position.y-p.position.y)<2.2&&newDistance<player.radius+.44&&!leavingPlayer;
    const blocked=floor===null||meetsPlayer||this.nearbyObstacles(this.candidateBounds,.12).some(b=>!b.bicycle||!contactSeparates(p.bounds,this.candidateBounds,b,.12))||this.cars.some(c=>c.visible&&overlap(this.candidateBounds,c.bounds,.75))||this.people.some(other=>other!==p&&other.visible&&Math.abs(other.position.y-p.position.y)<1.8&&Math.hypot(x-other.position.x,z-other.position.z)<.6);
    if(blocked){
      p.blockedFor+=dt;
      if(p.blockedFor>2.5&&p.crossing&&p.committed&&!p.retreating){p.direction*=-1;p.retreating=true;p.blockedFor=0;}
      else if(p.blockedFor>2&&!p.crossing){p.direction*=-1;p.wait=1.1;p.blockedFor=0;}
      return;
    }
    p.blockedFor=0;p.progress=next;p.speed=Math.hypot(x-p.position.x,z-p.position.z)/dt;Object.assign(p.position,candidate);
    const target=Math.atan2(-(p.b.x-p.a.x)*p.direction,-(p.b.z-p.a.z)*p.direction);p.heading=angle(p.heading+angle(target-p.heading)*(1-Math.exp(-dt*7)));
    if(next<=0||next>=1){p.direction*=-1;p.wait=1.5+(p.id%4)*.7;p.committed=false;p.retreating=false;}
    boundsAt(p.position,0,.55,.55,1.76,p.bounds);
  }
}
