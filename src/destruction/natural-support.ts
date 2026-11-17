import {MAX_ACTIVE_FRAGMENTS} from './types';
import {Material as M} from '../world/palette';
import type {VoxelEdit,VoxelWorld} from '../world/voxel';
import {BuildingRegistry,decodeWorldIndex,worldIndex} from './buildings';
import {makeFragments,isStructureResultCurrent,type StructureResult} from './structure';

/** Tree ownership is metadata over the existing immutable terrain. */
export function registerNaturalTrees(world:VoxelWorld,buildings:BuildingRegistry):number{
 const owned=new Set<number>();for(const b of buildings.all)for(const i of b.indices)owned.add(i);
 const roots:Array<{x:number;y:number;z:number;top:number;cells:Set<number>}>=[];
 for(const chunk of world.chunks.values())for(let i=0;i<chunk.voxels.length;i++){
  if(chunk.voxels[i]!==M.Wood)continue;
  const x=chunk.cx*32+(i&31),z=chunk.cz*32+((i>>5)&31),y=chunk.cy*32+(i>>10);
  if(owned.has(worldIndex(x,y,z))||![M.Rock,M.Grass,M.Dirt,M.Sand].includes(world.getVoxel(x,y-1,z)as never))continue;
  let top=y;while(top<94&&world.getVoxel(x,top+1,z)===M.Wood&&!owned.has(worldIndex(x,top+1,z)))top++;
  if(top-y<2)continue;let leafy=false;
  for(let dy=2;dy<14&&!leafy;dy++)for(let dz=-3;dz<=3&&!leafy;dz++)for(let dx=-3;dx<=3;dx++)if(world.getVoxel(x+dx,y+dy,z+dz)===M.Leaves){leafy=true;break;}
  if(leafy)roots.push({x,y,z,top,cells:new Set()});
 }
 const assigned=new Map<number,{root:typeof roots[number];distance:number}>();
 for(const root of roots)for(let y=root.y;y<=Math.min(95,root.top+6);y++)for(let z=root.z-5;z<=root.z+5;z++)for(let x=root.x-5;x<=root.x+5;x++){
  const index=worldIndex(x,y,z);if(owned.has(index))continue;const m=world.getVoxel(x,y,z);
  if(m!==M.Leaves&&m!==M.Wood&&!(m===M.Grass&&y>=root.y+2))continue;
  if(m===M.Wood&&(x!==root.x||z!==root.z))continue;
  const distance=(x-root.x)**2+(z-root.z)**2+Math.max(0,y-root.top-3)**2,old=assigned.get(index);
  if(!old||distance<old.distance)assigned.set(index,{root,distance});
 }
 for(const [index,{root}]of assigned)root.cells.add(index);
 for(const root of roots)if(root.cells.size)buildings.add(`tree-${root.x}-${root.y}-${root.z}`,'沿岸树木',root.y,root.cells);
 return roots.length;
}

const soil=(m:number)=>m===M.Dirt||m===M.Grass||m===M.Sand;
const groundCover=(m:number)=>soil(m)||m===M.Concrete||m===M.Road||m===M.Stripe;
/** Local gravity/shear rule. Work is sliced; a blast never scans the whole map. */
export class NaturalSupportQueue{
 private waiting=new Set<number>();private visited=new Set<number>();private cells=new Map<number,number>();private frontier:number[]=[];private sequence=0;private completed:StructureResult|undefined;
 constructor(private world:VoxelWorld,private buildings:BuildingRegistry,private onResult:(r:StructureResult)=>void){}
 get pending(){return this.waiting.size+(this.frontier.length?1:0)+(this.completed?1:0);}
 enqueue(edits:readonly Pick<VoxelEdit,'x'|'y'|'z'>[]):void{
  for(const p of edits)for(const [dx,dy,dz]of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){const x=p.x+dx,y=p.y+dy,z=p.z+dz;if(this.world.contains(x,y,z)&&groundCover(this.world.getVoxel(x,y,z)))this.waiting.add(worldIndex(x,y,z));}
 }
 update(canSpawn:boolean|number,budgetMs=1.2):void{
  const capacity=typeof canSpawn==='number'?Math.max(0,canSpawn):canSpawn?MAX_ACTIVE_FRAGMENTS:0;
  if(!capacity)return;
  if(this.completed){
   if(!isStructureResultCurrent(this.world,this.completed)){for(const p of this.completed.edits)if(groundCover(this.world.getVoxel(p.x,p.y,p.z)))this.waiting.add(worldIndex(p.x,p.y,p.z));this.completed=undefined;return;}
   if(this.completed.fragments.length<=capacity){const result=this.completed;this.completed=undefined;this.onResult(result);}return;}const start=performance.now();let steps=0;
  while(steps++<600&&performance.now()-start<budgetMs){
   if(!this.frontier.length){
    if(this.cells.size){this.finish();return;}
    const seed=this.waiting.values().next().value;if(seed===undefined)return;this.waiting.delete(seed);this.visited.clear();
    if(this.loose(seed))this.frontier.push(seed);else continue;
   }
   const index=this.frontier.pop()!;if(this.visited.has(index))continue;this.visited.add(index);const p=decodeWorldIndex(index),m=this.world.getVoxel(p.x,p.y,p.z);
   if(!groundCover(m)||this.buildings.findAt(p.x,p.y,p.z))continue;
   // Upward cells belong to the same unsupported column; horizontal soil is
   // admitted only when it has also lost its direct/short lateral bearing.
   this.cells.set(index,m);this.waiting.delete(index);
   if(this.cells.size>=4096){this.frontier=[];this.finish();return;}
   for(const [dx,dy,dz]of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
    const x=p.x+dx,y=p.y+dy,z=p.z+dz;if(!this.world.contains(x,y,z)||!groundCover(this.world.getVoxel(x,y,z)))continue;
    const next=worldIndex(x,y,z);if(!this.visited.has(next)&&(dy===1||this.loose(next)))this.frontier.push(next);
   }
  }
 }
 private loose(index:number):boolean{
  const p=decodeWorldIndex(index),m=this.world.getVoxel(p.x,p.y,p.z);if(!groundCover(m)||p.y<=0||this.world.getVoxel(p.x,p.y-1,p.z)||this.buildings.findAt(p.x,p.y,p.z))return false;
  if(m===M.Sand)return true;
  // Concrete can keep a short edge lip, but a long road/kerb slab cannot span a
  // newly excavated pit on invisible support. Registered structures are excluded.
  if(m===M.Concrete)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])if(this.world.getVoxel(p.x+dx,p.y,p.z+dz)&&this.world.getVoxel(p.x+dx,p.y-1,p.z+dz))return false;
  // A single-cell dirt lip can bridge opposite intact banks; larger undercuts
  // have no such bearing and peel away instead of suspending an entire slope.
  for(const [dx,dz]of [[1,0],[0,1]])if(this.world.getVoxel(p.x+dx,p.y,p.z+dz)&&this.world.getVoxel(p.x+dx,p.y-1,p.z+dz)&&this.world.getVoxel(p.x-dx,p.y,p.z-dz)&&this.world.getVoxel(p.x-dx,p.y-1,p.z-dz))return false;
  return true;
 }
 private finish():void{
  const cells=this.cells;this.cells=new Map();this.frontier=[];
  if(!cells.size)return;
  for(const [i,m]of cells){const p=decodeWorldIndex(i);if(this.world.getVoxel(p.x,p.y,p.z)!==m){this.enqueue([...cells.keys()].map(decodeWorldIndex));return;}}
  const eventId=`soil-${Date.now().toString(36)}-${++this.sequence}`,edits=[...cells.keys()].map(i=>({...decodeWorldIndex(i),material:0})),keys=new Set(edits.map(p=>`${p.x>>5},${p.y>>5},${p.z>>5}`));
  this.completed={buildingId:eventId,eventId,edits,fragments:makeFragments(cells,'natural-soil',eventId),checkedVoxels:cells.size,detachedComponents:1,reason:'disconnected',revisions:[...keys].map(key=>({key,revision:this.world.chunks.get(key)?.revision??0}))};
 }
}
