import type {VoxelWorld} from './voxel';
import {Material} from './palette';
import {worldIndex,type BuildingRegistry} from '../destruction/buildings';
/** Explicit additive scenery layer. Never replaces existing terrain or an old-city cell. */
export function addSouthBayLandmarks(world:VoxelWorld,buildings:BuildingRegistry){
 const owned=new Set<number>();let foundation=96;
 const put=(x:number,y:number,z:number)=>{if(!world.contains(x,y,z)||world.getVoxel(x,y,z))return;world.setVoxel(x,y,z,Material.Rock,false);owned.add(worldIndex(x,y,z));foundation=Math.min(foundation,y);};
 for(let z=207;z<=223;z++)for(let x=701;x<=727;x++){
  const left=Math.hypot((x-708)/1.02,(z-215)/.88),right=Math.hypot((x-720)/.92,(z-215)/.95),d=Math.min(left,right);
  const columnTop=d<6?Math.floor(13+(6-d)*3.2+Math.sin(x*1.2+z)*.65):0;
  const u=(x-714)/10,curve=Math.sqrt(Math.max(0,1-u*u));
  const bridge=Math.abs(u)<1&&Math.abs(z-215)<=1.4+curve;
  const bridgeBottom=Math.floor(20+8*curve+Math.sin(x*.7+z*.4)*.6);
  const top=Math.max(columnTop,bridge?bridgeBottom+2+Math.floor(curve*1.4):0);
  let bottom=3;for(let y=18;y>=2;y--)if(world.getVoxel(x,y,z)){bottom=y+1;break;}
  for(let y=bottom;y<=top;y++)if(y<=columnTop||bridge&&y>=bridgeBottom)put(x,y,z);
 }
 if(owned.size)buildings.add('region-south-bay-sea-arch','南湾海蚀门',foundation,owned);
 return owned.size;
}
