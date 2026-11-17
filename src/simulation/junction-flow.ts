import type {LifeCar,LifeContext,RoadRoute} from './street-life-sim';
import {trafficBounds,trafficBoundsOverlap} from './traffic-bypass';

type Approach={car:LifeCar;entry:number;exit:number;inside:boolean;arrived:number};
// Include the uncontrolled waterfront bends: their turning lanes share space.
type Point={x:number;z:number};
type Window={entry:number;exit:number};

/** Reserve an intersection before entering it, with room to leave it. Real
 * collision checks remain authoritative; reservations never move an actor. */
export class JunctionFlow{
 private owners=new Map<number,Set<number>>();
 private arrived=new Map<string,number>();
 private limits=new Map<number,number>();
 private occupied=new Set<number>();
 private centers:Point[];
 private windows=new Map<RoadRoute,Window[][]>();
 private paths=new Map<RoadRoute,ReturnType<typeof trafficBounds>[][]>();
 private routeIds=new Map<RoadRoute,number>();
 private conflicts=new Map<string,boolean>();
 constructor(private sampleRoute:(route:RoadRoute,d:number)=>Point&{heading:number},private signals:readonly Point[],private phase:(seconds:number)=>string,routes:readonly RoadRoute[],private signalActive:(p:Point)=>boolean=()=>true){
  this.centers=[...signals,{x:38,z:80},{x:38,z:164},{x:222,z:80},{x:222,z:164}].filter((p,i,a)=>a.findIndex(q=>Math.hypot(p.x-q.x,p.z-q.z)<5)===i);
  for(const route of routes)this.indexRoute(route);
 }
 private indexRoute(route:RoadRoute){
  const all=this.centers.map(center=>{const windows:Window[]=[];let open:Window|undefined;
   for(let d=0;d<=route.length;d+=.5){const p=this.sampleRoute(route,d),inside=Math.hypot(p.x-center.x,p.z-center.z)<6.4;if(inside){if(!open){open={entry:d,exit:d};windows.push(open);}open.exit=d;}else open=undefined;}
   if(windows.length>1&&windows[0].entry===0&&windows.at(-1)!.exit>route.length-.5){const first=windows.shift()!;windows.at(-1)!.exit=first.exit+route.length;}
   return windows;
  });this.windows.set(route,all);this.routeIds.set(route,this.routeIds.size);
  this.paths.set(route,all.map(windows=>windows.flatMap(w=>{
   const bounds=[];for(let d=w.entry-3.5;d<=w.exit+3.5;d+=1.5)bounds.push(trafficBounds(this.sampleRoute(route,d),2.2,6.6,3));return bounds;
  })));return all;
 }
 private pathsConflict(j:number,a:RoadRoute,b:RoadRoute):boolean{
  if(a===b)return true;
  const ai=this.routeIds.get(a)!,bi=this.routeIds.get(b)!,key=`${j}:${Math.min(ai,bi)}:${Math.max(ai,bi)}`;
  const old=this.conflicts.get(key);if(old!==undefined)return old;
  const overlap=this.paths.get(a)![j].some(p=>this.paths.get(b)![j].some(q=>trafficBoundsOverlap(p,q,.12)));
  this.conflicts.set(key,overlap);return overlap;
 }
 update(cars:readonly LifeCar[],seconds:number,context:LifeContext,roadClear:(car:LifeCar,x:number,z:number,heading:number)=>boolean):void{
  this.limits.clear();this.occupied.clear();const active=new Set<string>();
  for(let j=0;j<this.centers.length;j++){
   const center=this.centers[j],approaches:Approach[]=[];
   for(const car of cars){
    if(!car.visible||car.physicsRotation||car.bypass||Math.hypot(car.position.x-center.x,car.position.z-center.z)>30)continue;
    let entry=Infinity,exit=-Infinity;
    for(const w of (this.windows.get(car.route)??this.indexRoute(car.route))[j]){const cycle=Math.floor((car.distance-w.entry)/car.route.length);for(const k of [cycle,cycle+1]){const a=w.entry+k*car.route.length-car.distance,b=w.exit+k*car.route.length-car.distance;if(b+car.length/2>=0&&a<entry){entry=a;exit=b;}}}
    if(!Number.isFinite(entry))continue;
    const inside=Math.hypot(car.position.x-center.x,car.position.z-center.z)<6.4+car.length/2;
    if(entry>20&&!inside)continue;
    const key=`${j}:${car.id}`;active.add(key);if(!this.arrived.has(key))this.arrived.set(key,seconds);
    approaches.push({car,entry,exit,inside,arrived:this.arrived.get(key)!});if(inside)this.occupied.add(car.id);
   }
   // Committed vehicles clear even if the signal changes behind them. Reserve
   // conflicting paths, rather than unnecessarily closing every lane in a box.
   const admitted=approaches.filter(a=>a.inside);
   const candidates=approaches.filter(a=>!a.inside).filter(a=>{
     const p=this.sampleRoute(a.car.route,a.car.distance),axis=Math.abs(Math.sin(p.heading))>.85?'east-west':Math.abs(Math.cos(p.heading))>.85?'north-south':null;
     if(this.signals.some(s=>Math.hypot(s.x-center.x,s.z-center.z)<2&&this.signalActive(s))&&axis&&this.phase(seconds)!==axis)return false;
     if(a.entry>Math.max(10,a.car.speed*a.car.speed/9+3))return false;
     // The complete car must fit beyond the box before it may enter. Check
     // several metres of departure lane, not an unrelated opposing queue.
     for(let d=a.exit+a.car.length/2+1;d<=a.exit+a.car.length+3;d+=2){
      const p=this.sampleRoute(a.car.route,a.car.distance+d),b=trafficBounds(p,a.car.width,a.car.length,a.car.height);
      if(!roadClear(a.car,p.x,p.z,p.heading))return false;
      if(cars.some(c=>c!==a.car&&c.visible&&c.speed<.5&&trafficBoundsOverlap(b,c.bounds,.4)))return false;
      if(context.player){const q=context.player.position,r=context.player.radius;if(Math.abs(q.y-16)<3&&q.x>b.minX-r&&q.x<b.maxX+r&&q.z>b.minZ-r&&q.z<b.maxZ+r)return false;}
      if(context.dynamicObstacles?.some(o=>trafficBoundsOverlap(b,o,.2)))return false;
     }
     return true;
    }).sort((a,b)=>a.arrived-b.arrived||a.entry-b.entry||a.car.id-b.car.id);
   for(const a of candidates)if(!admitted.some(b=>this.pathsConflict(j,a.car.route,b.car.route)))admitted.push(a);
   if(admitted.length)this.owners.set(j,new Set(admitted.map(a=>a.car.id)));else this.owners.delete(j);
   for(const a of approaches)if(!admitted.includes(a)){const stop=Math.max(0,a.entry-a.car.length/2-1);this.limits.set(a.car.id,Math.min(this.limits.get(a.car.id)??Infinity,Math.sqrt(9*stop)));}
  }
  for(const key of this.arrived.keys())if(!active.has(key))this.arrived.delete(key);
 }
 speedLimit(car:LifeCar){return this.limits.get(car.id)??Infinity;}
 committed(car:LifeCar){return this.occupied.has(car.id);}
 get diagnostics(){return{reserved:this.owners.size,holding:this.limits.size};}
}
