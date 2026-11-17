import type {SceneObstacle} from '../input/scene-collisions';
export type TrafficPose={x:number;z:number;heading:number};
export type TrafficBypass={start:number;out:number;back:number;end:number;offset:number;samples:Array<{distance:number;pose:TrafficPose;bounds:SceneObstacle}>;bounds:SceneObstacle};
type Sampler=(distance:number)=>TrafficPose;
const smooth=(t:number)=>{const u=Math.max(0,Math.min(1,t));return u*u*(3-2*u);};
export function trafficBounds(p:TrafficPose,width:number,length:number,height:number):SceneObstacle{
 const c=Math.abs(Math.cos(p.heading)),s=Math.abs(Math.sin(p.heading)),x=c*width/2+s*length/2,z=s*width/2+c*length/2;
 return{minX:p.x-x,maxX:p.x+x,minZ:p.z-z,maxZ:p.z+z,minY:16,maxY:16+height};
}
export const trafficBoundsOverlap=(a:SceneObstacle,b:SceneObstacle,margin=0)=>a.minX<b.maxX+margin&&a.maxX>b.minX-margin&&a.minZ<b.maxZ+margin&&a.maxZ>b.minZ-margin&&a.minY<b.maxY&&a.maxY>b.minY;
function position(sample:Sampler,d:number,plan:TrafficBypass){const p=sample(d),offset=plan.offset*smooth((d-plan.start)/(plan.out-plan.start))*(1-smooth((d-plan.back)/(plan.end-plan.back)));return{x:p.x+Math.cos(p.heading)*offset,z:p.z-Math.sin(p.heading)*offset};}
export function bypassPose(sample:Sampler,d:number,plan?:TrafficBypass):TrafficPose{
 if(!plan||d<=plan.start||d>=plan.end)return sample(d);
 const p=position(sample,d,plan),a=position(sample,d-.02,plan),b=position(sample,d+.02,plan);return{...p,heading:Math.atan2(a.x-b.x,a.z-b.z)};
}
/** A slow, smooth lane change, restricted by the caller to actual clear road. */
export function planTrafficBypass(sample:Sampler,start:number,wreck:SceneObstacle,width:number,length:number,height:number,clear:(pose:TrafficPose,bounds:SceneObstacle)=>boolean):TrafficBypass|null{
 const origin=sample(start);let first=Infinity,last=-Infinity;
 for(let d=0;d<=38;d+=.5){const p=sample(start+d);if(Math.abs(Math.atan2(Math.sin(p.heading-origin.heading),Math.cos(p.heading-origin.heading)))>.12)break;if(trafficBoundsOverlap(trafficBounds(p,width,length,height),wreck,.3)){first=Math.min(first,d);last=d;}}
 // A nose already against an obstacle needs a real reversing manoeuvre; do
 // not invent an abrupt sideways displacement just to empty a queue.
 if(first<9||first>27||!Number.isFinite(first)||last>32)return null;
 for(const offset of [-2.4,2.4,-3.2,3.2,-4,4]){
  const plan:TrafficBypass={start,out:start+first-1.5,back:start+last+2,end:start+last+12,offset,samples:[],bounds:{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity,minY:16,maxY:16+height}};
  let safe=true;
  for(let d=start;d<=plan.end+.001;d+=.5){const pose=bypassPose(sample,d,plan),bounds=trafficBounds(pose,width,length,height);if(trafficBoundsOverlap(bounds,wreck,.22)||!clear(pose,bounds)){safe=false;break;}plan.samples.push({distance:d,pose,bounds});for(const a of ['minX','minZ'] as const)plan.bounds[a]=Math.min(plan.bounds[a],bounds[a]);for(const a of ['maxX','maxZ'] as const)plan.bounds[a]=Math.max(plan.bounds[a],bounds[a]);}
  if(safe)return plan;
 }
 return null;
}
