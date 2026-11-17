import {Quaternion,Vector3} from 'three';
import type {Vec3} from '../destruction/types';
import {obstaclesIntersect,orientedCollisionBounds,type SceneObstacle} from '../input/scene-collisions';
import {WORLD_HEIGHT,voxelIndex,type VoxelWorld} from '../world/voxel';
import {HELICOPTER_COLLISION_PARTS} from './helicopter-collision';
import {HELIPAD} from '../route/coast-route';

export type ReturnPhase='braking'|'planning'|'climb'|'cruise'|'approach'|'landing'|'holding'|'complete';
export const RETURN_LABELS:Record<ReturnPhase,string>={braking:'减速并稳定悬停',planning:'规划安全离场',climb:'安全离场与爬升',cruise:'飞回码头',approach:'对准停机坪进近',landing:'缓慢降落',holding:'悬停等待通路',complete:'已返航停稳'};

/** Conservative level-flight clearance; real flight still uses Rapier contacts.
 * Queries authoritative voxels, including roofs that have not streamed yet. */
export class FlightSpace{
 private parts:Array<{bounds:SceneObstacle;rotor:boolean;center:Vector3;offset:Vector3;half:Vec3}>;
 private rotation:Quaternion;
 constructor(private world:VoxelWorld,private obstacles:readonly SceneObstacle[],yaw=0){
  this.rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw);
  this.parts=HELICOPTER_COLLISION_PARTS.map(p=>({bounds:{} as SceneObstacle,rotor:!!p.rotor,center:new Vector3(),offset:new Vector3().copy(p.center).applyQuaternion(this.rotation),half:{x:p.half.x+.12,y:p.half.y+.12,z:p.half.z+.12}}));
 }
 clear(p:Vec3):boolean{
  for(const part of this.parts){part.center.copy(p).add(part.offset);orientedCollisionBounds(part.center,this.rotation,part.half,part.bounds);}
  const intersects=(b:SceneObstacle)=>this.parts.some(part=>{
   if(!obstaclesIntersect(part.bounds,b))return false;if(!part.rotor)return true;
   const dx=Math.max(b.minX-part.center.x,0,part.center.x-b.maxX),dz=Math.max(b.minZ-part.center.z,0,part.center.z-b.maxZ);return dx*dx+dz*dz<part.half.x*part.half.x;
  });
  const voxel={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
  for(let y=Math.max(0,Math.floor(p.y-1.65));y<=Math.min(WORLD_HEIGHT-1,Math.floor(p.y+2.2));y++)for(let z=Math.floor(p.z-6.5);z<=Math.floor(p.z+6.5);z++)for(let x=Math.floor(p.x-6.5);x<=Math.floor(p.x+6.5);x++){
   if(!this.world.getVoxel(x,y,z))continue;Object.assign(voxel,{minX:x,maxX:x+1,minY:y,maxY:y+1,minZ:z,maxZ:z+1});if(intersects(voxel))return false;
  }
  for(const b of this.obstacles)if(b.maxX>p.x-7&&b.minX<p.x+7&&b.maxZ>p.z-7&&b.minZ<p.z+7&&b.maxY>p.y-2&&b.minY<p.y+3&&intersects(b))return false;
  return true;
 }
 sweep(a:Vec3,b:Vec3):boolean{
  const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)/.5));
  for(let i=1;i<=n;i++){const t=i/n;if(!this.clear({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}))return false;}return true;
 }
}

type Node={x:number;y:number;z:number;g:number;score:number;parent?:Node};
function corridorHits(a:Vec3,b:Vec3,minX:number,maxX:number,minZ:number,maxZ:number):boolean{
 let lo=0,hi=1;
 for(const [start,end,min,max]of [[a.x,b.x,minX,maxX],[a.z,b.z,minZ,maxZ]]){
  const d=end-start;if(Math.abs(d)<1e-8){if(start<min||start>max)return false;continue;}
  const u=(min-start)/d,v=(max-start)/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>hi)return false;
 }return true;
}
/** Inspect every voxel column in the aircraft's swept corridor, incrementally.
 * Direct chunk reads avoid repeating string-keyed voxel lookups for the skyline. */
function* corridorAltitude(origin:Vec3,world:VoxelWorld,obstacles:readonly SceneObstacle[]):Generator<void,number>{
 const goal=HELIPAD.position,margin=8.5,dx=goal.x-origin.x,dz=goal.z-origin.z,length2=dx*dx+dz*dz;let highest=12;
 for(let i=0;i<obstacles.length;i++){
  const b=obstacles[i];if(corridorHits(origin,goal,b.minX-margin,b.maxX+margin,b.minZ-margin,b.maxZ+margin))highest=Math.max(highest,b.maxY);
  if(i%64===0)yield;
 }
 const bounds=world.bounds;
 for(let cz=Math.max(bounds.minZ>>5,Math.floor((Math.min(origin.z,goal.z)-margin)/32));cz<=Math.min((bounds.maxZ-1)>>5,Math.floor((Math.max(origin.z,goal.z)+margin)/32));cz++)for(let cx=Math.max(bounds.minX>>5,Math.floor((Math.min(origin.x,goal.x)-margin)/32));cx<=Math.min((bounds.maxX-1)>>5,Math.floor((Math.max(origin.x,goal.x)+margin)/32));cx++){
  if(!corridorHits(origin,goal,cx*32-margin,cx*32+32+margin,cz*32-margin,cz*32+32+margin))continue;
  const chunks=[0,1,2].map(y=>world.chunks.get(`${cx},${y},${cz}`)?.voxels);
  for(let z=0;z<32;z++)for(let x=0;x<32;x++){
   const wx=cx*32+x+.5,wz=cz*32+z+.5,t=length2?Math.max(0,Math.min(1,((wx-origin.x)*dx+(wz-origin.z)*dz)/length2)):0;
   if((wx-origin.x-dx*t)**2+(wz-origin.z-dz*t)**2>margin*margin)continue;
   for(let y=WORLD_HEIGHT-1;y>=Math.max(0,Math.floor(highest));y--)if(chunks[y>>5]?.[voxelIndex(x,y&31,z)]){highest=Math.max(highest,y+1);break;}
   yield;
  }
 }
 return Math.max(30,origin.y,highest+9);
}
/** Small incremental 3D search around departure, then a skyline-clear cruise.
 * Up and side moves may escape an awning; every edge is swept, never skipped. */
export class ReturnDeparture{
 altitude=30;
 status:'planning'|'ready'|'blocked'='planning';
 path:Vec3[]=[];
 private open:Node[]=[];private best=new Map<string,number>();private visited=0;
 private space:FlightSpace;
 private skyline:Generator<void,number>|undefined;
 constructor(private origin:Vec3,world:VoxelWorld,obstacles:readonly SceneObstacle[],yaw:number,corridorObstacles=obstacles){
  this.space=new FlightSpace(world,obstacles,yaw);this.skyline=corridorAltitude(origin,world,corridorObstacles);
 }
 private position(n:Node):Vec3{return{x:this.origin.x+n.x*2,y:Math.min(this.altitude,this.origin.y+n.y*2),z:this.origin.z+n.z*2};}
 advance(budgetMs=2):void{
  if(this.status!=='planning')return;const started=performance.now();let count=0;
  while(this.skyline){
   const result=this.skyline.next();if(result.done){
    this.skyline=undefined;if(result.value>138){this.status='blocked';return;}this.altitude=result.value;
    this.open.push({x:0,y:0,z:0,g:0,score:this.altitude-this.origin.y});this.best.set('0,0,0',0);break;
   }if(performance.now()-started>=budgetMs)return;
  }
  while(this.open.length&&this.visited<4500){
   let chosen=0;for(let i=1;i<this.open.length;i++)if(this.open[i].score<this.open[chosen].score)chosen=i;
   const node=this.open.splice(chosen,1)[0],p=this.position(node);this.visited++;
   if(p.y>=this.altitude-.01){
    const nodes:Vec3[]=[];for(let n:Node|undefined=node;n?.parent;n=n.parent)nodes.unshift(this.position(n));
    const path=[this.origin,...nodes];this.path=nodes.filter((_,i)=>{if(i===nodes.length-1)return true;const a=path[i],b=path[i+1],c=path[i+2];const u=new Vector3(b.x-a.x,b.y-a.y,b.z-a.z).normalize(),v=new Vector3(c.x-b.x,c.y-b.y,c.z-b.z).normalize();return u.dot(v)<.9999;});
    this.status='ready';return;
   }
   for(const [dx,dy,dz]of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1]]){
    const next:Node={x:node.x+dx,y:node.y+dy,z:node.z+dz,g:node.g+Math.hypot(dx,dy,dz)*2+(dy?0:.15),score:0,parent:node};
    if(Math.hypot(next.x,next.z)>11)continue;const key=`${next.x},${next.y},${next.z}`;if((this.best.get(key)??Infinity)<=next.g)continue;
    const target=this.position(next);if(!this.space.sweep(p,target))continue;next.score=next.g+this.altitude-target.y+Math.hypot(next.x,next.z)*.04;this.best.set(key,next.g);this.open.push(next);
   }
   if(++count>=12||performance.now()-started>=budgetMs)return;
  }
  this.status='blocked';
 }
}
