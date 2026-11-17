import {Quaternion,Vector3} from 'three';
import type {FragmentVoxel,RubbleFragment,Vec3} from './types';
export const fragmentCell=(x:number,y:number,z:number)=>x+256*(z+256*y);
export type FragmentHit={fragmentId:string;x:number;y:number;z:number;distance:number;point:Vec3;normal:Vec3};
export type FragmentBox={center:Vec3;half:Vec3};

/** Exact cell cover: greedy boxes never fill a carved opening. */
export function fragmentBoxes(voxels:readonly FragmentVoxel[],size:Vec3):FragmentBox[]{
 const remaining=new Set(voxels.map(([x,y,z])=>fragmentCell(x,y,z))),boxes:FragmentBox[]=[];
 for(const [x,y,z]of voxels){
  if(!remaining.has(fragmentCell(x,y,z)))continue;let w=1,d=1,h=1;
  while(x+w<size.x&&remaining.has(fragmentCell(x+w,y,z)))w++;
  while(z+d<size.z&&Array.from({length:w},(_,i)=>fragmentCell(x+i,y,z+d)).every(k=>remaining.has(k)))d++;
  while(y+h<size.y&&Array.from({length:w*d},(_,i)=>fragmentCell(x+i%w,y+h,z+Math.floor(i/w))).every(k=>remaining.has(k)))h++;
  for(let dy=0;dy<h;dy++)for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)remaining.delete(fragmentCell(x+dx,y+dy,z+dz));
  boxes.push({center:{x:x+w/2-size.x/2,y:y+h/2-size.y/2,z:z+d/2-size.z/2},half:{x:w/2,y:h/2,z:d/2}});
 }
 return boxes;
}

export function raycastFragment(fragment:RubbleFragment,origin:Vec3,direction:Vec3,maxDistance:number,cells?:ReadonlySet<number>):FragmentHit|null{
 const q=new Quaternion().copy(fragment.rotation),inverse=q.clone().invert(),o=new Vector3().copy(origin).sub(fragment.position).applyQuaternion(inverse).addScaledVector(new Vector3(fragment.size.x,fragment.size.y,fragment.size.z),.5),d=new Vector3().copy(direction).applyQuaternion(inverse);
 let enter=0,leave=maxDistance;const normal=new Vector3();
 for(const axis of ['x','y','z']as const){
  if(Math.abs(d[axis])<1e-10){if(o[axis]<0||o[axis]>=fragment.size[axis])return null;continue;}
  const a=-o[axis]/d[axis],b=(fragment.size[axis]-o[axis])/d[axis],near=Math.min(a,b);
  if(near>enter){enter=near;normal.set(0,0,0);normal[axis]=-Math.sign(d[axis]);}leave=Math.min(leave,Math.max(a,b));if(enter>leave)return null;
 }
 const map=cells??new Set(fragment.voxels.map(([x,y,z])=>fragmentCell(x,y,z))),p=o.clone().addScaledVector(d,enter+1e-6).floor();let distance=enter;
 const step=new Vector3(Math.sign(d.x),Math.sign(d.y),Math.sign(d.z)),delta=new Vector3(...(['x','y','z']as const).map(a=>d[a]===0?Infinity:Math.abs(1/d[a]))as[number,number,number]);
 const next=new Vector3(...(['x','y','z']as const).map(a=>d[a]===0?Infinity:(p[a]+(step[a]>0?1:0)-o[a])/d[a])as[number,number,number]);
 while(distance<=leave&&p.x>=0&&p.y>=0&&p.z>=0&&p.x<fragment.size.x&&p.y<fragment.size.y&&p.z<fragment.size.z){
  if(map.has(fragmentCell(p.x,p.y,p.z)))return{fragmentId:fragment.id,x:p.x,y:p.y,z:p.z,distance,point:new Vector3().copy(origin).addScaledVector(direction,distance),normal:normal.clone().applyQuaternion(q)};
  const axis=next.x<=next.y&&next.x<=next.z?'x':next.y<=next.z?'y':'z';distance=next[axis];p[axis]+=step[axis];next[axis]+=delta[axis];normal.set(0,0,0);normal[axis]=-step[axis];
 }
 return null;
}

export function carveFragment(fragment:RubbleFragment,hit:FragmentHit,radius=0):{removed:number;fragments:RubbleFragment[]}{
 const remaining=new Map<number,FragmentVoxel>();let removed=0;
 for(const v of fragment.voxels){if((v[0]-hit.x)**2+(v[1]-hit.y)**2+(v[2]-hit.z)**2<=radius**2)removed++;else remaining.set(fragmentCell(v[0],v[1],v[2]),v);}
 const groups:FragmentVoxel[][]=[];
 while(remaining.size){const first=remaining.values().next().value!,group=[first];remaining.delete(fragmentCell(...first.slice(0,3)as[number,number,number]));
  for(let i=0;i<group.length;i++){const [x,y,z]=group[i];for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const nx=x+dx,ny=y+dy,nz=z+dz;if(nx<0||ny<0||nz<0||nx>=fragment.size.x||ny>=fragment.size.y||nz>=fragment.size.z)continue;const key=fragmentCell(nx,ny,nz),v=remaining.get(key);if(v){remaining.delete(key);group.push(v);}}}
  groups.push(group);
 }
 const q=new Quaternion().copy(fragment.rotation);
 const fragments=groups.map((group,i)=>{
  const lo={x:Infinity,y:Infinity,z:Infinity},hi={x:-Infinity,y:-Infinity,z:-Infinity};for(const [x,y,z]of group){lo.x=Math.min(lo.x,x);lo.y=Math.min(lo.y,y);lo.z=Math.min(lo.z,z);hi.x=Math.max(hi.x,x);hi.y=Math.max(hi.y,y);hi.z=Math.max(hi.z,z);}
  const size={x:hi.x-lo.x+1,y:hi.y-lo.y+1,z:hi.z-lo.z+1},offset=new Vector3(lo.x+size.x/2-fragment.size.x/2,lo.y+size.y/2-fragment.size.y/2,lo.z+size.z/2-fragment.size.z/2).applyQuaternion(q);
  const id=i===0?fragment.id:`fragment-${typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${i}`}`;
  return{...fragment,id,size,voxels:group.map(([x,y,z,m])=>[x-lo.x,y-lo.y,z-lo.z,m]as FragmentVoxel),position:new Vector3().copy(fragment.position).add(offset),rotation:{x:q.x,y:q.y,z:q.z,w:q.w},state:'falling' as const,linearVelocity:fragment.state==='falling'?{...fragment.linearVelocity??{x:0,y:0,z:0}}:{x:0,y:0,z:0},angularVelocity:fragment.state==='falling'?{...fragment.angularVelocity??{x:0,y:0,z:0}}:{x:0,y:0,z:0}};
 });
 return{removed,fragments};
}
