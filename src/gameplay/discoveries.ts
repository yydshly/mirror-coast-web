import type {Vector3Like,VoxelWorld} from '../world/voxel';

export const DISCOVERY_IDS=['forest-radio','tidal-rescue','cape-signal'] as const;
export type DiscoveryId=typeof DISCOVERY_IDS[number];
export type DiscoverySite={id:string;title:string;position:Vector3Like;description:string;actionHint:string;anchors:readonly Vector3Like[];route?:readonly {x:number;z:number}[]};
export type DiscoveryPrompt={site:DiscoverySite;distance:number;intact:boolean};

export function validateDiscoveries(value:unknown):DiscoveryId[]{
  if(!Array.isArray(value)||value.length>DISCOVERY_IDS.length||value.some(id=>!DISCOVERY_IDS.includes(id))||new Set(value).size!==value.length)throw new Error('探索记录格式无效。');
  return [...value] as DiscoveryId[];
}

export function visibleFrom(world:VoxelWorld,eyes:Vector3Like,point:Vector3Like):boolean{
  const dx=point.x-eyes.x,dy=point.y-eyes.y,dz=point.z-eyes.z,length=Math.hypot(dx,dy,dz);
  if(length<.1)return true;
  return world.raycast(eyes,{x:dx/length,y:dy/length,z:dz/length},Math.max(0,length-.18))===null;
}

/** A site requires an actual nearby, visible interaction point, including above-ground decks. */
export function discoveryPrompt(world:VoxelWorld,eyes:Vector3Like,sites:readonly DiscoverySite[],range=3.8):DiscoveryPrompt|null{
  let nearest:DiscoveryPrompt|null=null;
  for(const site of sites){
    const distance=Math.hypot(site.position.x-eyes.x,site.position.y-eyes.y,site.position.z-eyes.z);
    if(distance>range || nearest && distance>=nearest.distance || !visibleFrom(world,eyes,site.position))continue;
    nearest={site,distance,intact:site.anchors.every(p=>world.getVoxel(p.x,p.y,p.z)!==0)};
  }
  return nearest;
}
