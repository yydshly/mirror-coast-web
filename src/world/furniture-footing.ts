import type {VoxelWorld} from './voxel';
import {Material} from './palette';

export type FurnitureContact={x:number;z:number};
export type FurnitureFooting={x:number;y:number;z:number;anchors:Array<{x:number;y:number;z:number}>};

/** Furniture stands on all its actual feet, never on a height sampled at its centre. */
export function findFurnitureFooting(world:VoxelWorld,x:number,z:number,yaw:number,contacts:readonly FurnitureContact[],expectedTop:number,searchRadius=0,allowRoad=false,accept?:(x:number,z:number)=>boolean):FurnitureFooting|null {
  const candidates=[{x,z}];
  for(let r=.5;r<=searchRadius;r+=.5)for(let dz=-r;dz<=r;dz+=.5)for(let dx=-r;dx<=r;dx+=.5){
    if(Math.max(Math.abs(dx),Math.abs(dz))===r)candidates.push({x:x+dx,z:z+dz});
  }
  const c=Math.cos(yaw),s=Math.sin(yaw);
  for(const candidate of candidates){
    if(accept&&!accept(candidate.x,candidate.z))continue;
    const anchors: FurnitureFooting['anchors']=[];let top:number|undefined,valid=true;
    for(const foot of contacts){
      const px=Math.floor(candidate.x+c*foot.x+s*foot.z),pz=Math.floor(candidate.z-s*foot.x+c*foot.z);
      let floor:number|undefined;
      for(let y=Math.min(92,Math.floor(expectedTop+1));y>=Math.max(12,Math.floor(expectedTop-3));y--){
        const m=world.getVoxel(px,y,pz);
        if(!m||m===Material.Leaves||(!allowRoad&&(m===Material.Road||m===Material.Stripe)))continue;
        if(world.getVoxel(px,y+1,pz)||world.getVoxel(px,y+2,pz))continue;
        floor=y+1;break;
      }
      if(floor===undefined||(top!==undefined&&Math.abs(floor-top)>.001)){valid=false;break;}
      top=floor;anchors.push({x:px,y:floor-1,z:pz});
    }
    if(valid&&top!==undefined)return{...candidate,y:top,anchors:[...new Map(anchors.map(p=>[`${p.x},${p.y},${p.z}`,p])).values()]};
  }
  return null;
}

/** Include the corners of each foot's contact patch, including across voxel edges. */
export function furnitureFootContacts(centres:readonly FurnitureContact[],halfX:number,halfZ:number):FurnitureContact[]{
  return centres.flatMap(p=>[-halfX,halfX].flatMap(dx=>[-halfZ,halfZ].map(dz=>({x:p.x+dx,z:p.z+dz}))));
}
