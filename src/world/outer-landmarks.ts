import type {VoxelWorld} from './voxel';
import {Material} from './palette';
import {worldIndex,type BuildingRegistry} from '../destruction/buildings';
/** Additive sea stacks, outside all existing trails and foundations. */
export function addOuterLandmarks(world:VoxelWorld,registry:BuildingRegistry){
 const owned=new Set<number>();let foundation=95;
 for(const [cx,cz,rx,rz,h]of [[-222,177,4,5,24],[-208,187,3,4,19]])for(let z=cz-rz;z<=cz+rz;z++)for(let x=cx-rx;x<=cx+rx;x++){
  const d=Math.hypot((x-cx)/rx,(z-cz)/rz);if(d>1)continue;
  const top=Math.floor(12+(h-12)*Math.pow(1-d,.5)+Math.sin(x*1.3+z)*.8);let floor=3;
  for(let y=20;y>=2;y--)if(world.getVoxel(x,y,z)){floor=y+1;break;}
  for(let y=floor;y<=top;y++)if(!world.getVoxel(x,y,z)){world.setVoxel(x,y,z,Material.Rock,false);owned.add(worldIndex(x,y,z));foundation=Math.min(foundation,y);}
 }
 if(owned.size)registry.add('region-cape-seastacks','西岬双礁',foundation,owned);
 return owned.size;
}
