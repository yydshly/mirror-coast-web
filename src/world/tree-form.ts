import {decodeWorldIndex,worldIndex,type BuildingRegistry} from '../destruction/buildings';
import {Material as M} from './palette';
import type {VoxelWorld} from './voxel';

export type CrownLobe={x:number;y:number;z:number;rx:number;ry:number;rz:number};
export type TreeCorridor={minX:number;maxX:number;minZ:number;maxZ:number};
export function treeSeed(x:number,z:number):number{return(Math.imul(x|0,374761393)^Math.imul(z|0,668265263))>>>0;}

/** Shared, offset leaf masses: a lower fork and a taller crown, not one lid. */
export function broadleafCrown(seed:number):CrownLobe[]{
 const angle=(seed%13)*Math.PI*2/13,c=Math.cos(angle),s=Math.sin(angle);
 return[
  {x:-.38,y:-.18,z:-.13,rx:.68,ry:.66,rz:.65},
  {x:.40,y:.05,z:.22,rx:.62,ry:.72,rz:.64},
  {x:.02,y:.50,z:-.10,rx:.61,ry:.58,rz:.60},
  {x:-.04,y:-.30,z:.40,rx:.60,ry:.53,rz:.57},
 ].map(p=>({...p,x:p.x*c-p.z*s,z:p.x*s+p.z*c}));
}

/** Protect the actual old-city doorway sightline, without relocating saved roots. */
export function treeEntranceCorridors(buildings:BuildingRegistry):TreeCorridor[]{
 return buildings.all.filter(b=>b.id.startsWith('city-building-')&&b.bounds.maxZ<170).map(b=>{
  const x=(b.bounds.minX+b.bounds.maxX+1)/2;
  return{minX:x-1.35,maxX:x+1.35,minZ:b.bounds.maxZ,maxZ:b.bounds.maxZ+8};
 });
}

type Root={x:number;y:number;z:number;top:number;cells:Set<number>};
/** Only prune/reshape already owned cells. Legacy cut-down saves cannot grow
 * extra tree cells, and the physical tree has the same silhouette as its mesh. */
export function refineTreeCanopy(world:VoxelWorld,root:Root,corridors:readonly TreeCorridor[]):void{
 const foliage=[...root.cells].map(decodeWorldIndex).filter(p=>{const m=world.getVoxel(p.x,p.y,p.z);return m===M.Leaves||m===M.Grass;});
 if(foliage.length<8)return;
 const low=Math.min(...foliage.map(p=>p.y)),high=Math.max(...foliage.map(p=>p.y));
 const conifer=high-low>=6&&high-root.top<=2,seed=treeSeed(root.x,root.z),lobes=broadleafCrown(seed);
 const radius=Math.max(1.8,Math.max(...foliage.map(p=>Math.max(Math.abs(p.x-root.x),Math.abs(p.z-root.z))))+.25),mid=(low+high)/2;
 const doors=corridors.filter(r=>root.x+radius>=r.minX&&root.x-radius<=r.maxX&&root.z+radius>=r.minZ&&root.z-radius<=r.maxZ);
 for(const p of foliage){
  const dx=p.x-root.x,dz=p.z-root.z;
  let keep:boolean;
  if(conifer){
   const t=(p.y-low)/Math.max(1,high-low),r=Math.max(1.1,(radius+.3)*(1-t)+.5)*((p.y-low)%3===2?.83:1);
   keep=p.y<root.top&&(dx/r)**2+(dz/(r*.91))**2<=1.15;
  }else{
   const x=dx/radius,z=dz/radius,y=(p.y-mid)/Math.max(2.7,(high-low)/2+1.6);
   keep=lobes.some(l=>((x-l.x)/l.rx)**2+((y-l.y)/l.ry)**2+((z-l.z)/l.rz)**2<=1.1);
  }
  if(doors.some(r=>p.x+.5>=r.minX&&p.x+.5<=r.maxX&&p.z+.5>=r.minZ&&p.z+.5<=r.maxZ))keep=false;
  if(!keep)world.setVoxel(p.x,p.y,p.z,M.Air,false);
  else if(world.getVoxel(p.x,p.y,p.z)===M.Grass)world.setVoxel(p.x,p.y,p.z,M.Leaves,false);
 }
 if(conifer)world.setVoxel(root.x,root.top,root.z,M.Leaves,false);
 else{
  // Forks use existing canopy cells, keeping their original save ownership.
  for(const [dx,dz]of [[seed%2?1:-1,0],[0,seed%3?1:-1]])for(let y=root.top-1;y<=root.top+1;y++){
   const p={x:root.x+dx,y,z:root.z+dz},index=worldIndex(p.x,p.y,p.z),m=world.getVoxel(p.x,p.y,p.z);
   if(root.cells.has(index)&&(m===M.Leaves||m===M.Grass))world.setVoxel(p.x,p.y,p.z,M.Wood,false);
  }
 }
 // The old conifer generator had a tip touching only diagonally. Keep only
 // the component attached to the root, so the new silhouette has real support.
 const start=worldIndex(root.x,root.y,root.z),connected=new Set<number>(),queue=[start];
 for(let i=0;i<queue.length;i++){
  const index=queue[i];if(connected.has(index)||!root.cells.has(index))continue;const p=decodeWorldIndex(index);
  if(!world.getVoxel(p.x,p.y,p.z))continue;connected.add(index);
  for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const next=worldIndex(p.x+dx,p.y+dy,p.z+dz);if(root.cells.has(next)&&!connected.has(next))queue.push(next);}
 }
 for(const index of root.cells)if(!connected.has(index)){const p=decodeWorldIndex(index);world.setVoxel(p.x,p.y,p.z,M.Air,false);}
}
