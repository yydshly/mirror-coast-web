import {beforeAll,describe,it,expect,vi} from 'vitest';
import {Scene,MeshStandardMaterial} from 'three';
import {generateWorld,shorelineAt} from '../src/world/generate';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
import {VoxelWorld} from '../src/world/voxel';
import {Material as M} from '../src/world/palette';
import {BEDROCK_LAYERS,planVoxelDamage} from '../src/destruction/voxel-damage';
import {MeshQueue} from '../src/world/mesh-queue';
import {meshChunk,type MeshInput,type MeshResult} from '../src/world/mesher';
import {surfacePatches} from '../src/rendering/surface-patches';
import {CollapsePhysics} from '../src/destruction/physics';

describe('terraced shore access',()=>{
 let world:VoxelWorld,treads:WalkTransitions;
 beforeAll(()=>{world=generateWorld().world;treads=new WalkTransitions(new Scene(),world);});
 it.each([8.5,25.5,50.5,80.5,232.5])('walks up multiple sand terraces at x=%s without jumping, then walks down',x=>{
  const shore=shorelineAt(Math.floor(x)),start=shore-1.5,end=Math.max(175.1,shore-5.8);
  const walker=new VoxelWalker(world,{x,y:13,z:start});walker.setObstacleProvider(()=>treads.nearby(walker.position));
  walker.teleportEye({x,y:15.68,z:start});
  let recovered=false;
  for(let i=0;i<160;i++){walker.update(1/60,{x:0,z:-1});recovered||=walker.recoveredLastStep;if(walker.position.z<=end)break;}
  expect(walker.position.z).toBeLessThan(end+.15);expect(walker.position.y).toBeGreaterThan(14.5);expect(recovered).toBe(false);
  expect(walker.canOccupy(walker.position)).toBe(true);
  for(let i=0;i<160;i++){walker.update(1/60,{x:0,z:1});if(walker.position.z>=start)break;}
  expect(walker.position.z).toBeGreaterThan(start-.1);expect(walker.position.y).toBeLessThan(14.5);
 });
 it('does not leave invisible shore steps after their supporting sand is destroyed',()=>{
  const w=generateWorld().world,t=new WalkTransitions(new Scene(),w),x=25,z=shorelineAt(25)-3;
  const before=t.heightAt(x+.7,z+.2);expect(before).not.toBeNull();
  const keys=w.applyEdits([{x,y:13,z,material:0}]);t.sync(keys);
  expect(t.heightAt(x+.7,z+.2)).toBeNull();t.dispose();
 });
});

describe('excavation and blast consistency',()=>{
 function earth(){const w=new VoxelWorld();for(let z=20;z<45;z++)for(let x=20;x<45;x++)for(let y=0;y<16;y++)w.setVoxel(x,y,z,y<12?M.Rock:M.Dirt);return w;}
 it('cuts surface markings exactly at their own ground cells, including the middle of a long strip',()=>{
  const patches=surfacePatches(199.5,170.15,5,.2),remaining=patches.filter(p=>p.anchorX!==199);
  expect(patches.reduce((a,p)=>a+p.width*p.depth,0)).toBeCloseTo(1,6);
  expect(remaining.every(p=>p.x+p.width/2<=199||p.x-p.width/2>=200)).toBe(true);
  expect(patches.every(p=>p.x-p.width/2>=p.anchorX-1e-6&&p.x+p.width/2<=p.anchorX+1+1e-6)).toBe(true);
 });
 it('plans a shallow continuous crater with a solid exposed bottom, then lands the player on that exact bottom',()=>{
  const w=earth(),p={x:31.5,y:15.5,z:31.5},walker=new VoxelWalker(w,{x:31.5,y:16,z:31.5});
  const plan=planVoxelDamage(w,p,true);expect(plan.edits.length).toBeGreaterThan(20);expect(w.getVoxel(31,15,31)).toBe(M.Dirt);
  w.applyEdits(plan.edits);expect(w.getVoxel(31,14,31)).toBe(0);expect(w.getVoxel(31,13,31)).toBe(M.Dirt);
  for(let i=0;i<180;i++)walker.update(1/60,{x:0,z:0});
  expect(walker.position.y).toBeCloseTo(14,3);expect(walker.grounded).toBe(true);expect(walker.canOccupy(walker.position)).toBe(true);
 });
 it('keeps the finite world sealed after repeated blasts and rejects carving its bedrock',()=>{
  const w=earth();for(let y=15;y>=0;y--)w.applyEdits(planVoxelDamage(w,{x:31.5,y:y+.5,z:31.5},true).edits);
  for(let y=0;y<BEDROCK_LAYERS;y++)expect(w.getVoxel(31,y,31)).toBe(M.Rock);
  expect(planVoxelDamage(w,{x:31.5,y:2.5,z:31.5},false).edits).toEqual([]);
 });
 it('recovers onto a still-supported dry bank when the last safe position was itself blasted out',()=>{
  const w=earth(),walker=new VoxelWalker(w,{x:31.5,y:16,z:31.5});
  for(let z=29;z<=34;z++)for(let x=29;x<=34;x++)for(let y=3;y<=15;y++)w.setVoxel(x,y,z,0);
  let recovered=false;for(let i=0;i<180;i++){walker.update(1/60,{x:0,z:0});recovered||=walker.recoveredLastStep;}
  expect(recovered).toBe(true);expect(walker.position.y).toBeCloseTo(16,3);expect(walker.grounded).toBe(true);expect(walker.canOccupy(walker.position)).toBe(true);
 });
 it('can deliberately jump from a crater floor onto a one-voxel rim instead of being permanently trapped',()=>{
  const w=earth();for(let z=29;z<35;z++)for(let x=29;x<35;x++)w.setVoxel(x,15,z,0);
  const walker=new VoxelWalker(w,{x:31.5,y:15,z:31.5});
  for(let i=0;i<60;i++)walker.update(1/60,{x:0,z:-1});expect(walker.position.z).toBeGreaterThan(29.28);
  for(let i=0;i<60;i++)walker.update(1/60,{x:0,z:-1,jump:true});
  expect(walker.position.z).toBeLessThan(28.5);expect(walker.position.y).toBeCloseTo(16,3);expect(walker.canOccupy(walker.position)).toBe(true);
 });
 it('still breaks an elevated building in a full sphere',()=>{
  const w=new VoxelWorld();for(let y=25;y<=35;y++)for(let z=28;z<36;z++)for(let x=28;x<36;x++)w.setVoxel(x,y,z,M.Brick);
  const {edits}=planVoxelDamage(w,{x:31.5,y:30.5,z:31.5},true);
  expect(edits.some(e=>e.x===31&&e.y===27&&e.z===31)).toBe(true);
 });
 it('lands real rigid debris on the same newly exposed crater floor as the character',async()=>{
  const w=earth(),material=new MeshStandardMaterial(),physics=await CollapsePhysics.create(new Scene(),material,{onStateChange:()=>{}}),queue=new MeshQueue(w,m=>physics.syncChunk(m));
  try{
   queue.commitEdits(w.chunks.keys());
   const dirty=w.applyEdits(planVoxelDamage(w,{x:31.5,y:15.5,z:31.5},true).edits);queue.commitEdits(dirty);
   physics.addFragments([{id:'crater-probe',buildingId:'probe',size:{x:1,y:1,z:1},voxels:[[0,0,0,M.Rock]],position:{x:31.5,y:18,z:31.5},rotation:{x:0,y:0,z:0,w:1},state:'falling'}]);
   for(let i=0;i<240;i++)physics.update(1/60);
   expect(physics.snapshot()[0].position.y).toBeCloseTo(14.5,1);
  }finally{queue.dispose();physics.dispose();material.dispose();}
 });
 it('replaces render/collision surfaces immediately even while an obsolete worker mesh is in flight',()=>{
  class WorkerStub{static latest:WorkerStub;jobs:MeshInput[]=[];onmessage:((e:{data:MeshResult})=>void)|null=null;onerror=null;constructor(){WorkerStub.latest=this;}postMessage(i:MeshInput){this.jobs.push(i);}terminate(){}}
  vi.stubGlobal('Worker',WorkerStub);const w=earth(),installed:MeshResult[]=[],queue=new MeshQueue(w,m=>installed.push(m));
  try{
   queue.enqueue(['0,0,0']);const worker=WorkerStub.latest,old=worker.jobs[0];
   const dirty=w.applyEdits(planVoxelDamage(w,{x:30.5,y:15.5,z:30.5},true).edits);
   queue.commitEdits(dirty);expect(dirty.every(k=>queue.hasCurrentMesh(k))).toBe(true);const count=installed.length;
   worker.onmessage?.({data:meshChunk(old)});queue.update(2);
   expect(installed.length).toBe(count);expect(dirty.every(k=>queue.hasCurrentMesh(k))).toBe(true);
  }finally{queue.dispose();vi.unstubAllGlobals();}
 });
});
