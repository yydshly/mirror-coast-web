import {decodeWorldIndex,worldIndex,type BuildingRegistry} from '../destruction/buildings';
import {Material as M} from '../world/palette';
import type {VoxelWorld} from '../world/voxel';

export type TreePreviewBox={minX:number;minY:number;minZ:number;maxX:number;maxY:number;maxZ:number;material:number};
type TreeColumn={x:number;z:number;cells:number[]};

/** Sparse canopy bands and contiguous wood runs preserve the air under trees.
 * They share the terrain sector's draw call and near/far readiness boundary. */
export class TreePreview{
 private owned=new Set<number>();private columns=new Map<string,TreeColumn[]>();readonly count:number;
 constructor(private world:VoxelWorld,buildings?:BuildingRegistry){
  const trees=buildings?.all.filter(b=>b.id.startsWith('tree-'))??[];this.count=trees.length;
  for(const tree of trees){
   const root=decodeWorldIndex(tree.indices[0]),columns=new Map<string,number[]>();
   for(const index of tree.indices){this.owned.add(index);const p=decodeWorldIndex(index),key=`${p.x>>5},${p.z>>5}`,cells=columns.get(key);if(cells)cells.push(index);else columns.set(key,[index]);}
   for(const [key,cells]of columns){const entry={x:root.x,z:root.z,cells},list=this.columns.get(key);if(list)list.push(entry);else this.columns.set(key,[entry]);}
  }
 }
 contains(x:number,y:number,z:number,material:number):boolean{
  return(material===M.Wood||material===M.Leaves||material===M.Grass)&&this.owned.has(worldIndex(x,y,z));
 }
 boxes(cx:number,cz:number):TreePreviewBox[]{
  const boxes:TreePreviewBox[]=[];
  for(const tree of this.columns.get(`${cx},${cz}`)??[]){
   const leaves=new Map<string,TreePreviewBox>(),wood=new Map<string,number[]>();
   for(const index of tree.cells){
    const p=decodeWorldIndex(index),m=this.world.getVoxel(p.x,p.y,p.z);
    if(m===M.Wood){const key=`${p.x},${p.z}`,ys=wood.get(key);if(ys)ys.push(p.y);else wood.set(key,[p.y]);}
    else if(m===M.Leaves||m===M.Grass){
     const key=`${p.y>>1},${p.x<tree.x?0:1},${p.z<tree.z?0:1}`,old=leaves.get(key);
     if(old){old.minX=Math.min(old.minX,p.x);old.minY=Math.min(old.minY,p.y);old.minZ=Math.min(old.minZ,p.z);old.maxX=Math.max(old.maxX,p.x+1);old.maxY=Math.max(old.maxY,p.y+1);old.maxZ=Math.max(old.maxZ,p.z+1);}
     else leaves.set(key,{minX:p.x,minY:p.y,minZ:p.z,maxX:p.x+1,maxY:p.y+1,maxZ:p.z+1,material:M.Leaves});
    }
   }
   boxes.push(...leaves.values());
   for(const [key,ys]of wood){
    const [x,z]=key.split(',').map(Number);ys.sort((a,b)=>a-b);let lo=ys[0],hi=lo;
    const add=()=>boxes.push({minX:x,minY:lo,minZ:z,maxX:x+1,maxY:hi+1,maxZ:z+1,material:M.Wood});
    for(const y of ys.slice(1)){if(y===hi+1)hi=y;else{add();lo=hi=y;}}add();
   }
  }
  return boxes;
 }
}
