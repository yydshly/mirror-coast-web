import {describe,it,expect} from 'vitest';
import {BoxGeometry,Matrix4,MeshStandardMaterial,Quaternion,Scene,Vector3} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {Material as M} from '../src/world/palette';
import {BuildingRegistry} from '../src/destruction/buildings';
import {NaturalSupportQueue,registerNaturalTrees} from '../src/destruction/natural-support';
import {analyzeStructure,createStructureInput,type StructureResult} from '../src/destruction/structure';
import {carveFragment,fragmentBoxes,raycastFragment} from '../src/destruction/fragment-edit';
import {CollapsePhysics} from '../src/destruction/physics';
import {DecorationPhysics} from '../src/destruction/decorations';
import {createMeshInput,meshChunk} from '../src/world/mesher';
import type {RubbleFragment} from '../src/destruction/types';
import {orientedCollisionBounds,obstacleTopAt} from '../src/input/scene-collisions';
import {VoxelWalker} from '../src/input/walk';
import {cameraSphereClear} from '../src/input/walk-camera';
import {StructureQueue} from '../src/destruction/structure-queue';
import {generateCollapseLab,LAB_SHOTS,LAB_TEST_BUILDING_ID} from '../src/destruction/lab';

function beam():RubbleFragment{return{id:'beam',buildingId:'test',size:{x:5,y:1,z:1},voxels:Array.from({length:5},(_,x)=>[x,0,0,M.Brick]),position:{x:8,y:4,z:8},rotation:{x:0,y:0,z:0,w:1},state:'settled'};}
const simulate=(physics:CollapsePhysics,seconds:number)=>{for(let i=0;i<seconds*60;i++)physics.update(1/60);};
describe('continued destruction consistency',()=>{
 it('cuts a rotated settled beam, preserving surviving world cell centres and splitting both sides',()=>{
  const f=beam();f.rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
  const hit=raycastFragment(f,{x:8,y:7,z:8},{x:0,y:-1,z:0},10)!;expect(hit.x).toBe(2);
  const result=carveFragment(f,hit);expect(result.removed).toBe(1);expect(result.fragments).toHaveLength(2);
  expect(result.fragments.map(f=>f.voxels.length)).toEqual([2,2]);
  const centres=result.fragments.flatMap(p=>p.voxels.map(([x,y,z])=>new Vector3(x+.5-p.size.x/2,y+.5-p.size.y/2,z+.5-p.size.z/2).applyQuaternion(new Quaternion().copy(p.rotation)).add(p.position).z)).sort((a,b)=>a-b);
  expect(centres).toEqual([6,7,9,10]);expect(result.fragments.every(f=>f.state==='falling')).toBe(true);
 });
 it('does not cover an excavated opening with a broad walking collider',()=>{
  const f=beam();f.voxels.splice(2,1);const boxes=fragmentBoxes(f.voxels,f.size);
  expect(boxes.some(b=>Math.abs(b.center.x)<b.half.x)).toBe(false);
  expect(raycastFragment(f,{x:8,y:7,z:8},{x:0,y:-1,z:0},10)).toBeNull();
 });
 it('lets the body and camera traverse a rotated one-metre opening while still blocking its walls',()=>{
  const world=new VoxelWorld();for(let x=20;x<44;x++)for(let z=20;z<44;z++)world.setVoxel(x,15,z,M.Rock);
  const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),origin=new Vector3(32,17,32);
  const walls=[-.6,.6].map(x=>orientedCollisionBounds(new Vector3(x,0,0).applyQuaternion(q).add(origin),q,{x:.1,y:1,z:4}));
  const walker=new VoxelWalker(world,{x:32,y:16,z:32});walker.setObstacleProvider(()=>walls);
  expect(walker.canOccupy(walker.position)).toBe(true);expect(cameraSphereClear(world,{x:32,y:17,z:32},walls)).toBe(true);
  const blocked=new Vector3(.6,-1,0).applyQuaternion(q).add(origin);expect(walker.canOccupy(blocked)).toBe(false);
  for(let i=0;i<60;i++)walker.update(1/60,{x:-Math.SQRT1_2,z:-Math.SQRT1_2});
  expect(Math.hypot(walker.position.x-32,walker.position.z-32)).toBeGreaterThan(2);expect(walker.recoveredLastStep).toBe(false);
 });
 it('uses the sloping rubble surface rather than the top of its surrounding AABB as a platform',()=>{
  const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/4),b=orientedCollisionBounds({x:40,y:18,z:40},q,{x:3,y:.5,z:2});
  const top=obstacleTopAt(b,40,40,.29,22)!;expect(top).toBeGreaterThan(18.7);expect(top).toBeLessThan(19);expect(b.maxY-top).toBeGreaterThan(1);
 });
 it('peels an unsupported soil column with its grass cap without scanning intact banks',()=>{
  const world=new VoxelWorld(),registry=new BuildingRegistry(),results:StructureResult[]=[];
  for(let x=8;x<14;x++)for(let y=0;y<=5;y++)world.setVoxel(x,y,8,y===5?M.Grass:M.Dirt);
  const edits=[{x:10,y:3,z:8,material:0},{x:11,y:3,z:8,material:0}];world.applyEdits(edits);
  const q=new NaturalSupportQueue(world,registry,r=>results.push(r));q.enqueue(edits);
  for(let i=0;i<100&&q.pending;i++)q.update(true,20);
  expect(results.flatMap(r=>r.edits).some(p=>p.x===10&&p.y===5)).toBe(true);
  expect(results.flatMap(r=>r.edits).every(p=>p.y>=4&&[10,11].includes(p.x))).toBe(true);
 });
 it('captures actual tree roots before edits and drops the crown coherently when the root is cut',()=>{
  const world=new VoxelWorld(),registry=new BuildingRegistry();for(let y=0;y<6;y++)world.setVoxel(10,y,10,M.Dirt);
  for(let y=6;y<13;y++)world.setVoxel(10,y,10,M.Wood);
  for(let x=8;x<=12;x++)for(let z=8;z<=12;z++)world.setVoxel(x,12,z,x===10&&z===10?M.Wood:M.Leaves);
  expect(registerNaturalTrees(world,registry)).toBe(1);registry.captureFoundations(world);
  expect(analyzeStructure(createStructureInput(world,registry.all[0],'before')).edits).toHaveLength(0);
  world.applyEdits([{x:10,y:5,z:10,material:0}]);const result=analyzeStructure(createStructureInput(world,registry.all[0],'after'));
  expect(result.fragments).toHaveLength(1);expect(result.fragments[0].voxels.length).toBe(31);
 });
 it('also releases road and paving caps over broad excavations instead of leaving a floating kerb',()=>{
  const world=new VoxelWorld(),results:StructureResult[]=[];for(let x=7;x<=15;x++){world.setVoxel(x,0,8,M.Rock);world.setVoxel(x,1,8,M.Dirt);world.setVoxel(x,2,8,x%2?M.Concrete:M.Road);}
  const edits=[];for(let x=9;x<=13;x++)edits.push({x,y:1,z:8,material:0});world.applyEdits(edits);
  const q=new NaturalSupportQueue(world,new BuildingRegistry(),r=>results.push(r));q.enqueue(edits);for(let i=0;i<100&&q.pending;i++)q.update(true,20);
  expect(results.flatMap(r=>r.edits).some(p=>p.x===11&&p.y===2)).toBe(true);
  expect(results.flatMap(r=>r.edits).some(p=>p.x===7||p.x===15)).toBe(false);
 });
 it('never resurrects a soil voxel carved while a completed support job waits for admission',()=>{
  const world=new VoxelWorld(),results:StructureResult[]=[];for(let y=0;y<6;y++)world.setVoxel(10,y,10,y===5?M.Grass:M.Dirt);
  const cut={x:10,y:3,z:10,material:0};world.applyEdits([cut]);const queue=new NaturalSupportQueue(world,new BuildingRegistry(),r=>results.push(r));queue.enqueue([cut]);queue.update(1,20);
  world.applyEdits([{x:10,y:5,z:10,material:0}]);for(let i=0;i<20&&queue.pending;i++)queue.update(1,20);
  expect(results.flatMap(r=>r.fragments.flatMap(f=>f.voxels)).some(v=>v[3]===M.Grass)).toBe(false);
  expect(results.flatMap(r=>r.edits).some(p=>p.y===4)).toBe(true);
 });
 it('holds a collapse when its fragments exceed available slots, then admits it without dropping the job',()=>{
  const {world,buildings}=generateCollapseLab();for(const p of LAB_SHOTS.slice(0,2))world.removeSphere(p,3.2);
  const results:StructureResult[]=[],queue=new StructureQueue(world,buildings,r=>results.push(r));queue.enqueue([LAB_TEST_BUILDING_ID]);queue.update(24);queue.update(1);
  expect(results).toHaveLength(0);expect(queue.pending).toBe(1);queue.update(24);expect(results).toHaveLength(1);expect(results[0].fragments.length).toBeGreaterThan(1);queue.dispose();
 });
 it('reawakens settled rubble only after replacement terrain collision is accepted',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}}),world=new VoxelWorld();
  for(let x=4;x<13;x++)for(let z=4;z<13;z++)world.setVoxel(x,0,z,M.Rock);
  const sync=()=>physics.syncChunk(meshChunk(createMeshInput(world,'0,0,0')!));sync();const f=beam();f.position.y=1.5;physics.restore([f]);
  const edits=[];for(let x=4;x<13;x++)for(let z=4;z<13;z++)edits.push({x,y:0,z,material:0});const keys=world.applyEdits(edits);physics.invalidateSupports(keys);
  physics.wakeUnsupported(false);expect(physics.activeCount).toBe(0);sync();physics.wakeUnsupported(true);simulate(physics,1);
  expect(physics.snapshot()[0].position.y).toBeLessThan(0);physics.dispose();material.dispose();
 });
 it('keeps original bench geometry together, falls into the excavated ground and restores its pose',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}}),world=new VoxelWorld();
  world.setVoxel(8,0,8,M.Rock);physics.syncChunk(meshChunk(createMeshInput(world,'0,0,0')!));
  const props=new DecorationPhysics(scene,world,physics),parts=[1.4,1.8].map(y=>({geometry,material,matrix:new Matrix4().makeScale(1,.12,.3).setPosition(8.5,y,8.5),anchors:[{x:8,y:0,z:8}]}));props.register('bench',parts);
  world.applyEdits([{x:8,y:0,z:8,material:0}]);physics.syncChunk(meshChunk(createMeshInput(world,'0,0,0')!));props.invalidate(['0,0,0']);props.update(()=>true);expect(props.diagnostics.fallen).toBe(1);
  simulate(physics,1);props.update(()=>true);const state=props.snapshot();expect(state[0].position.y).toBeLessThan(0);
  expect(scene.children.find(o=>o.name.startsWith('fallen-decoration'))!.children).toHaveLength(2);
  const restored=new DecorationPhysics(scene,world,physics,state);restored.register('bench',parts);restored.update(()=>true);expect(restored.snapshot()[0].position).toEqual(state[0].position);
  physics.dispose();geometry.dispose();material.dispose();
 });
});
