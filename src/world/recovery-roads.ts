import {REGION_ROADS} from './region-layout';
/** Bounded candidates only. Callers still validate live ground, full body
 * clearance and a usable departure; a map line never authorizes a teleport. */
export function recoveryRoadPoints(origin:{x:number;z:number}):Array<{x:number;z:number}>{
 const points:Array<{x:number;z:number}>=[],seen=new Set<string>();
 const add=(x:number,z:number)=>{const key=`${x.toFixed(2)},${z.toFixed(2)}`;if(!seen.has(key)){seen.add(key);points.push({x,z});}};
 for(const road of REGION_ROADS)for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(length/12));
  for(let n=0;n<=steps;n++)add(a.x+dx*n/steps,a.z+dz*n/steps);
  const t=length?Math.max(0,Math.min(1,((origin.x-a.x)*dx+(origin.z-a.z)*dz)/(length*length))):0;add(a.x+dx*t,a.z+dz*t);
 }
 for(const [x,z]of [[248,164],[274,154],[130,164],[176,164],[84,164],[222,125],[130,80]])add(x,z);
 return points.sort((a,b)=>(a.x-origin.x)**2+(a.z-origin.z)**2-(b.x-origin.x)**2-(b.z-origin.z)**2);
}
