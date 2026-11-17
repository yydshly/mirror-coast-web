import {Material as M} from './palette';
import type {VoxelWorld} from './voxel';
import {worldIndex,type BuildingRegistry} from '../destruction/buildings';

/** An optional side jetty; the main harbor street and its exits stay open.
 * Only empty cells are populated so old saves retain their original geometry. */
export function addHarborPassage(world:VoxelWorld,buildings?:BuildingRegistry):void{
  const put=(x:number,y:number,z:number,m:number)=>{if(!world.getVoxel(x,y,z))world.setVoxel(x,y,z,m,false);};
  for(let x=-14;x<=7;x++)for(let z=229;z<=235;z++)put(x,14,z,M.Wood);
  for(const x of [-13,-6,1,7])for(const z of [229,235])for(let y=6;y<14;y++)put(x,y,z,M.Wood);
  // Heavy, weathered crates form a real two-metre obstacle, not a trigger wall.
  for(let x=3;x<=5;x++)for(let z=229;z<=235;z++)for(let y=15;y<=16;y++)put(x,y,z,(x+z)%3===0?M.Trim:M.Wood);
  for(let x=3;x<=5;x++)for(let z=229;z<=235;z++)buildings?.add(`explore-passage-crate-${x}-${z}`,'栈桥旧木箱',15,[worldIndex(x,15,z),worldIndex(x,16,z)]);
}
