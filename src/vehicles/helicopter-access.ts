import type {Vec3} from '../destruction/types';
import type {VoxelWorld} from '../world/voxel';
import {HELICOPTER_SPAWN} from '../route/coast-route';
import {HELICOPTER_COLLISION_PARTS} from './helicopter-collision';
import {WORLD_HEIGHT} from '../world/voxel';

/** Side doors clear the cabin, skids and rotor column; never exit in midair. */
export function helicopterExit(world:VoxelWorld,p:Vec3,yaw:number,canStand:(p:Vec3)=>boolean):Vec3|null{
 const floor=p.y-1.46;
 for(const side of [2.3,-2.3,3,-3])for(const offset of [0,.8,-.8]){
  const x=p.x+Math.cos(yaw)*side-Math.sin(yaw)*offset,z=p.z-Math.sin(yaw)*side-Math.cos(yaw)*offset;
  for(let y=Math.floor(floor+.15);y>=Math.floor(floor-.8);y--){const feet={x,y:y+1,z};if(Math.abs(feet.y-floor)>.5||feet.y<=12||!world.getVoxel(Math.floor(x),y,Math.floor(z))||!canStand(feet))continue;return feet;}
 }return null;
}
export function helipadClear(world:VoxelWorld,obstacles:readonly import('../input/scene-collisions').SceneObstacle[]):boolean{
 const p=HELICOPTER_SPAWN;
 for(const x of [-1,0,1])for(const z of [-1.7,0,1.7])if(!world.getVoxel(Math.floor(p.x+x),14,Math.floor(p.z+z)))return false;
 // Check the entire vertical approach, including the rotor and the tail.
 // A clear floor alone must not authorize descent through an overhead roof.
 for(const part of HELICOPTER_COLLISION_PARTS){
  const x=p.x+part.center.x,z=p.z+part.center.z,bottom=p.y+part.center.y-part.half.y;
  const hits=(b:import('../input/scene-collisions').SceneObstacle)=>{
   if(b.maxY<=bottom+.02||b.minY>=114||b.maxX<=x-part.half.x||b.minX>=x+part.half.x||b.maxZ<=z-part.half.z||b.minZ>=z+part.half.z)return false;
   if(!part.rotor)return true;const dx=Math.max(b.minX-x,0,x-b.maxX),dz=Math.max(b.minZ-z,0,z-b.maxZ);return dx*dx+dz*dz<part.half.x*part.half.x;
  };
  for(let iy=Math.max(0,Math.floor(bottom));iy<WORLD_HEIGHT;iy++)for(let iz=Math.floor(z-part.half.z);iz<=Math.floor(z+part.half.z);iz++)for(let ix=Math.floor(x-part.half.x);ix<=Math.floor(x+part.half.x);ix++)if(world.getVoxel(ix,iy,iz)&&hits({minX:ix,maxX:ix+1,minY:iy,maxY:iy+1,minZ:iz,maxZ:iz+1}))return false;
  if(obstacles.some(hits))return false;
 }
 return true;
}
