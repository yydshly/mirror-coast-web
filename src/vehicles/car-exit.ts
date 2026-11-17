import type { Vec3 } from '../destruction/types';
import type { VoxelWorld } from '../world/voxel';

/** Find a nearby standing surface, never teleporting a passenger down a cliff. */
export function findCarExit(world: VoxelWorld, position: Vec3, heading: number, canStand: (feet: Vec3) => boolean, surfaceAt?:(x:number,z:number,maxTop:number)=>number|null): Vec3 | null {
  const floor = position.y - .85;
  for (const side of [2.4,-2.4,3.2,-3.2]) {
    const x=position.x+Math.cos(heading)*side,z=position.z-Math.sin(heading)*side;
    const top=surfaceAt?.(x,z,floor+1.1);
    if(top!==null&&top!==undefined&&Math.abs(top-floor)<=1.1&&canStand({x,y:top,z}))return{x,y:top,z};
    for(let y=Math.floor(floor+.1);y>=Math.floor(floor-2.1);y--) {
      const feet={x,y:y+1,z};
      if(Math.abs(feet.y-floor)>1.1 || !world.contains(Math.floor(x),y,Math.floor(z)) || !world.getVoxel(Math.floor(x),y,Math.floor(z)) || !canStand(feet))continue;
      return feet;
    }
  }
  return null;
}
