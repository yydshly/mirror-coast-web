import type {SceneObstacle} from './scene-collisions';
import type {Vector3Like} from '../world/voxel';
import type {VoxelWalker} from './walk';
import {Material} from '../world/palette';

export type RailFrame={normal:{x:number;z:number};tangent:{x:number;z:number};plane:number;half:number;low:number;high:number;top:number;rail:SceneObstacle};

/** Geometry-based rail surfaces. Adjacent collision sections share a continuous
 * interaction span; rotated fences use their OBB rather than a wide world AABB. */
export function nearbyRailFrames(obstacles:readonly SceneObstacle[],feet:Vector3Like):RailFrame[]{
 const frames:RailFrame[]=[];
 for(const b of obstacles){
  if(b.vaultable===false||b.physicsManaged&&!b.vaultable)continue;
  let nx:number,nz:number,half:number,length:number;
  if(b.obb){
   const e=b.obb.rotation.elements,narrow=b.obb.halfSize.x<=b.obb.halfSize.z?'x':'z',i=narrow==='x'?0:6;
   nx=e[i];nz=e[i+2];const n=Math.hypot(nx,nz);if(n<.9)continue;nx/=n;nz/=n;
   half=b.obb.halfSize[narrow];length=b.obb.halfSize[narrow==='x'?'z':'x']*2;
  }else{const sx=b.maxX-b.minX,sz=b.maxZ-b.minZ;nx=sx<=sz?1:0;nz=sx<=sz?0:1;half=Math.min(sx,sz)/2;length=Math.max(sx,sz);}
  if(half>(b.vaultable ? .55 : .25)||length<.35)continue;
  if(!b.vaultable&&(b.standable!==false||length<2.4||b.minY>feet.y+.35))continue;
  if(nx<-.0001||Math.abs(nx)<.0001&&nz<0){nx=-nx;nz=-nz;}
  const tangent={x:-nz,z:nx},x=(b.minX+b.maxX)/2,z=(b.minZ+b.maxZ)/2,plane=x*nx+z*nz,along=x*tangent.x+z*tangent.z;
  frames.push({normal:{x:nx,z:nz},tangent,plane,half,low:along-length/2,high:along+length/2,top:b.maxY,rail:b});
 }
 // Repeat merging to include chains even if a scene provider lists them out of order.
 for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;){
  const a=frames[i],b=frames[j];
  if(a.normal.x*b.normal.x+a.normal.z*b.normal.z>.998&&Math.abs(a.plane-b.plane)<.12&&Math.abs(a.top-b.top)<.35&&a.low<=b.high+.2&&b.low<=a.high+.2){
   a.low=Math.min(a.low,b.low);a.high=Math.max(a.high,b.high);a.half=Math.max(a.half,b.half);a.top=Math.max(a.top,b.top);
   a.rail={minX:Math.min(a.rail.minX,b.rail.minX),maxX:Math.max(a.rail.maxX,b.rail.maxX),minY:Math.min(a.rail.minY,b.rail.minY),maxY:a.top,minZ:Math.min(a.rail.minZ,b.rail.minZ),maxZ:Math.max(a.rail.maxZ,b.rail.maxZ),vaultable:true,standable:false};frames.splice(j,1);j=i+1;
  }else j++;
 }
 return frames.sort((a,b)=>Math.abs(feet.x*a.normal.x+feet.z*a.normal.z-a.plane)-Math.abs(feet.x*b.normal.x+feet.z*b.normal.z-b.plane));
}

/** Low, thin voxel parapets use the same planner as decorative railings. A
 * terrain slope or house wall continues into the next column and is rejected. */
export function voxelRailsNear(motor:VoxelWalker):SceneObstacle[]{
 const p=motor.position,rails:SceneObstacle[]=[],seen=new Set<string>(),materials=new Set<number>([Material.Wood,Material.Trim,Material.Concrete,Material.Brick,Material.Rock]);
 const y=Math.floor(p.y+.45);
 for(const axis of ['x','z']as const)for(const sign of [-1,1])for(const distance of [.4,.8,1.2,1.6]){
  const x=Math.floor(p.x+(axis==='x'?distance*sign:0)),z=Math.floor(p.z+(axis==='z'?distance*sign:0));
  const k=`${axis},${x},${z}`;if(seen.has(k))continue;seen.add(k);
  if(!materials.has(motor.voxelAt(x,y,z)))continue;
  let top=y;while(top<95&&motor.voxelAt(x,top+1,z))top++;
  if(top+1-p.y<.45||top+1-p.y>1.5)continue;
  if(motor.voxelAt(x+(axis==='x'?1:0),y,z+(axis==='z'?1:0))||motor.voxelAt(x-(axis==='x'?1:0),y,z-(axis==='z'?1:0)))continue;
  let low=0,high=0;
  const solid=(n:number)=>materials.has(motor.voxelAt(x+(axis==='z'?n:0),y,z+(axis==='x'?n:0)))&&!motor.voxelAt(x+(axis==='z'?n:0),top+1,z+(axis==='x'?n:0));
  while(low>-8&&solid(low-1))low--;while(high<8&&solid(high+1))high++;
  if(high-low<1)continue;
  rails.push({minX:x+(axis==='z'?low:0),maxX:x+1+(axis==='z'?high:0),minY:y,maxY:top+1,minZ:z+(axis==='x'?low:0),maxZ:z+1+(axis==='x'?high:0),vaultable:true,standable:false});
 }
 return rails;
}
