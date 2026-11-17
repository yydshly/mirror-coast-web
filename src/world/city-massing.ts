import {decodeWorldIndex,worldIndex,type BuildingRegistry} from '../destruction/buildings';
import {Material as M} from './palette';
import type {VoxelWorld} from './voxel';

export type MassingSection={
 x0:number;x1:number;z0:number;z1:number;base:number;height:number;
 roof:'flat'|'gable';groundFloor:boolean;
};
export type CityMassing={kind:'coastal-terraces'|'corner-wings'|'dock-warehouse';sections:MassingSection[]};

/** A deterministic retrofit inside the original occupied building volumes.
 * Run before loading player edits. IDs, ground entrances and ownership indices
 * remain stable; saved air/material edits and rubble still take precedence. */
export function applyCityMassing(world:VoxelWorld,buildings:BuildingRegistry):Map<string,CityMassing>{
 const plans=new Map<string,CityMassing>();
 for(const building of buildings.all){
  if(!building.id.startsWith('city-building-'))continue;
  const b=building.bounds,base=building.foundationY,x0=b.minX+1,x1=b.maxX-1,z0=b.minZ+1,z1=b.maxZ-1;
  const width=x1-x0+1,depth=z1-z0+1,index=Number(building.id.slice(-3));
  let roofY=b.maxY;
  while(roofY>base){const m=world.getVoxel(x0+1,roofY,z0+1);if(m===M.Roof||m===M.Terracotta)break;roofY--;}
  const originalHeight=roofY-base-1;
  if(originalHeight<12||width<8||depth<8)continue;
  const coastal=z0>=136&&z0<170,warehouse=z0>170;
  const corner=!coastal&&!warehouse&&((z0<30&&width>=18)||(z0>=47&&z0<=113&&(x0===95||x0===141)));
  if(!coastal&&!warehouse&&!corner)continue;
  const section=(sx0:number,sx1:number,sz0:number,sz1:number,y:number,height:number,roof:'flat'|'gable'='flat',groundFloor=false):MassingSection=>({x0:sx0,x1:sx1,z0:sz0,z1:sz1,base:y,height,roof,groundFloor});
  let plan:CityMassing;
  if(warehouse){
   plan={kind:'dock-warehouse',sections:[section(x0,x1,z0,z1,base,6,'gable',true)]};
  }else{
   const podium=originalHeight<=12?4:8,upperBase=base+podium+2,upperHeight=Math.max(4,Math.floor((originalHeight-podium-2)/4)*4);
   const sections=[section(x0,x1,z0,z1,base,podium,'flat',true)];
   if(coastal){
    // Broad two-storey shops with offset homes above and a clear sea terrace.
    const inset=width>=18?Math.floor(width*.28):2;
    sections.push(section(x0+(index%2?inset:1),x1-(index%2?1:inset),z0+1,z1-4,upperBase,upperHeight,index%2?'gable':'flat'));
   }else if(width>=18){
    // The two wings share a grounded plinth, but end at different heights.
    const split=x0+Math.floor(width*.58);
    sections.push(section(x0,split-1,z0,z1-2,upperBase,upperHeight,'gable'));
    sections.push(section(split+1,x1,z0+2,z1-1,upperBase,Math.max(4,upperHeight-8)));
   }else{
    // Slender street-corner blocks retain their height behind a lower street wall.
    sections.push(section(x0+1,x1-1,z0+1,z1-4,upperBase,upperHeight));
   }
   plan={kind:coastal?'coastal-terraces':'corner-wings',sections};
  }
  for(const s of plan.sections)if(s.roof==='gable'&&s.base+s.height+4>roofY){const shortened=Math.floor((roofY-s.base-4)/4)*4;if(shortened>=4)s.height=shortened;else s.roof='flat';}
  const original=new Map<number,number>();
  for(const index of building.indices){const p=decodeWorldIndex(index);original.set(index,world.getVoxel(p.x,p.y,p.z));world.setVoxel(p.x,p.y,p.z,M.Air,false);}
  // Even roof edges must stay inside existing ownership. This also means an
  // old fully demolished building cannot gain new, unrecorded solid cells.
  const owned=new Set(building.indices);
  const put=(x:number,y:number,z:number,m:number)=>{const key=worldIndex(x,y,z);if(owned.has(key)&&original.get(key))world.setVoxel(x,y,z,m,false);};
  const wall=[...original.values()].find(m=>m===M.Cream||m===M.Brick||m===M.Blue||m===M.Mint)??M.Cream;
  const roofMaterial=index%2?M.Terracotta:M.Roof;
  for(const s of plan.sections){
   const wallTop=s.base+s.height-1;
   for(let y=s.base;y<=wallTop;y++)for(let z=s.z0;z<=s.z1;z++)for(let x=s.x0;x<=s.x1;x++){
    const floor=(y-s.base)%4,edgeX=x===s.x0||x===s.x1,edgeZ=z===s.z0||z===s.z1;
    const window=floor>=1&&floor<=2&&((edgeZ&&(x-s.x0)%4>=1&&(x-s.x0)%4<=2)||(edgeX&&(z-s.z0)%4>=1&&(z-s.z0)%4<=2));
    put(x,y,z,floor===3&&(edgeX||edgeZ)?M.Trim:window?((x+z+y+index)%5?M.Window:M.DarkWindow):wall);
   }
   if(s.groundFloor){const door=Math.floor((x0+x1)/2);for(let y=base;y<base+3;y++)for(let x=door;x<=door+1;x++)put(x,y,z1,M.DarkWindow);}
   for(let z=s.z0;z<=s.z1;z++)for(let x=s.x0;x<=s.x1;x++){
    if(s.roof==='flat'){
     put(x,wallTop+1,z,M.Trim);put(x,wallTop+2,z,roofMaterial);
    }else{
     const cross=width>=depth?Math.min(z-s.z0,s.z1-z):Math.min(x-s.x0,s.x1-x);
     const lift=Math.min(3,Math.floor(cross/2));
     for(let y=wallTop+1;y<wallTop+2+lift;y++)put(x,y,z,wall);
     put(x,wallTop+2+lift,z,roofMaterial);
    }
   }
  }
  plans.set(building.id,plan);
 }
 return plans;
}
