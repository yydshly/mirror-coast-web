import {Material as M} from '../world/palette';
import {regionalHeightAt} from '../world/region-terrain';
import type {Vector3Like,VoxelEdit,VoxelWorld} from '../world/voxel';

export const BEDROCK_LAYERS=3;
const groundMaterials=new Set<number>([M.Rock,M.Dirt,M.Grass,M.Sand,M.Concrete,M.Road,M.Stripe,M.Trim]);

/** Plan first: persistence accepts the entire edit before any collision changes.
 * Soil blasts make a broad, shallow bowl; building blasts retain spherical reach.
 * A finite voxel map always retains its lowest three solid geological layers. */
export function planVoxelDamage(world:VoxelWorld,center:Vector3Like,blast:boolean):{edits:VoxelEdit[];material:number}{
  const hit={x:Math.floor(center.x),y:Math.floor(center.y),z:Math.floor(center.z)},material=world.getVoxel(hit.x,hit.y,hit.z);
  const edits:VoxelEdit[]=[];
  if(![center.x,center.y,center.z].every(Number.isFinite))return{edits,material};
  const r=blast?3.2:0,extent=Math.ceil(r);
  for(let y=hit.y-extent;y<=hit.y+extent;y++)for(let z=hit.z-extent;z<=hit.z+extent;z++)for(let x=hit.x-extent;x<=hit.x+extent;x++){
    const m=world.getVoxel(x,y,z);if(!m||y<BEDROCK_LAYERS)continue;
    if(blast){
      const dx=x+.5-center.x,dy=y+.5-center.y,dz=z+.5-center.z;
      if(dx*dx+dy*dy+dz*dz>r*r)continue;
      if(groundMaterials.has(m)&&y<=regionalHeightAt(x,z)){
        const depth=dy<0?(m===M.Rock?1.15:1.8):r;
        if((dx*dx+dz*dz)/(r*r)+dy*dy/(depth*depth)>1)continue;
      }
    }
    edits.push({x,y,z,material:0});
  }
  return{edits,material};
}
