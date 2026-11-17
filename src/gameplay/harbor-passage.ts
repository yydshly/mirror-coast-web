import type {Vector3Like,VoxelWorld} from '../world/voxel';
import {visibleFrom} from './discoveries';

export type CoastOutingSave={logRead:boolean;beaconLinked:boolean};
export const HARBOR_LOG={x:-11.49,y:16.05,z:232.5} as const;
export const HARBOR_PASSAGE={minX:3,maxX:5,minZ:230,maxZ:233,floor:14} as const;
export function validateCoastOuting(v:unknown):CoastOutingSave{
  const s=v as CoastOutingSave;
  if(!s||typeof s.logRead!=='boolean'||typeof s.beaconLinked!=='boolean'||s.beaconLinked&&!s.logRead)throw new Error('沿海通路记录无效。');
  return {logRead:s.logRead,beaconLinked:s.beaconLinked};
}

/** The passage is read from live voxels, never from a completion flag. A pair
 * of empty, supported lanes is required; destroying the deck cannot open it. */
export class HarborPassage{
  readonly state:CoastOutingSave;
  constructor(private world:VoxelWorld,saved?:CoastOutingSave){this.state=saved?validateCoastOuting(saved):{logRead:false,beaconLinked:false};}
  get status():'blocked'|'open'|'broken'{
    let supported=false;
    for(let z=230;z<=232;z++){
      let floor=true,clear=true;
      for(let x=-10;x<=7;x++)for(let dz=0;dz<2;dz++){
        if(!this.world.getVoxel(x,14,z+dz))floor=false;
        for(let y=15;y<=16;y++)if(this.world.getVoxel(x,y,z+dz))clear=false;
      }
      if(floor&&clear)return 'open';
      supported ||= floor;
    }
    return supported?'blocked':'broken';
  }
  nearLog(feet:Vector3Like,eyes:Vector3Like):boolean{
    return Math.hypot(feet.x-HARBOR_LOG.x,feet.z-HARBOR_LOG.z)<2.5&&Math.abs(feet.y-15)<.55&&!!this.world.getVoxel(-12,14,232)&&visibleFrom(this.world,eyes,HARBOR_LOG);
  }
  readLog():void{this.state.logRead=true;}
  linkBeacon():boolean{if(!this.state.logRead)return false;this.state.beaconLinked=true;return true;}
  get snapshot():CoastOutingSave{return {...this.state};}
}
