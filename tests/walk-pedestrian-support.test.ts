import {describe,expect,it} from 'vitest';
import {VoxelWalker,type WalkObstacle} from '../src/input/walk';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';

function street(){
 const world=new VoxelWorld();
 for(let z=4;z<45;z++)for(let x=4;x<45;x++)world.setVoxel(x,15,z,Material.Road);
 return world;
}
const person=():WalkObstacle=>({minX:20.2,maxX:20.8,minY:16,maxY:17.76,minZ:20.2,maxZ:20.8,standable:false});
function simulate(walker:VoxelWalker,seconds:number,input={x:0,z:0}){for(let frame=0;frame<seconds*60;frame++)walker.update(1/60,input);}

describe('pedestrians obstruct movement without becoming walking platforms',()=>{
 it('chooses clear ground beside a pedestrian occupying the requested spawn',()=>{
  const world=street(),walker=new VoxelWalker(world,{x:10.5,y:16,z:10.5}),pedestrian=person();
  walker.setObstacleProvider(()=>[pedestrian]);
  walker.teleportEye({x:20.5,y:17.68,z:20.5});
  expect(walker.position.y).toBeCloseTo(16,4);expect(walker.grounded).toBe(true);
  expect(Math.hypot(walker.position.x-20.5,walker.position.z-20.5)).toBeGreaterThan(.5);
  expect(Math.hypot(walker.position.x-20.5,walker.position.z-20.5)).toBeLessThan(2);
  expect(walker.canOccupy(walker.position)).toBe(true);
 });
 it('blocks approach without stepping onto even a low nonstandable body',()=>{
  const walker=new VoxelWalker(street(),{x:17,y:16,z:20.5});
  walker.setObstacleProvider(()=>[{...person(),maxY:16.35}]);
  simulate(walker,3,{x:1,z:0});
  expect(walker.position.x).toBeLessThan(19.92);expect(walker.position.y).toBeCloseTo(16,4);
  expect(walker.grounded).toBe(true);
 });
 it('moves aside when falling onto a stationary pedestrian and continues down to the street',()=>{
  const world=street(),walker=new VoxelWalker(world,{x:20.5,y:16,z:20.5});
  walker.setObstacleProvider(()=>[person()]);walker.position.set(20.5,20,20.5);walker.grounded=false;
  simulate(walker,2);
  expect(walker.position.y).toBeCloseTo(16,4);expect(walker.grounded).toBe(true);
  expect(walker.canOccupy(walker.position)).toBe(true);
  expect(Math.hypot(walker.position.x-20.5,walker.position.z-20.5)).toBeGreaterThan(.6);
 });
 it('releases a character restored exactly above a pedestrian head instead of retaining false grounding',()=>{
  const walker=new VoxelWalker(street(),{x:20.5,y:16,z:20.5});
  walker.setObstacleProvider(()=>[person()]);walker.position.set(20.5,17.76,20.5);walker.grounded=true;
  simulate(walker,2);
  expect(walker.position.y).toBeCloseTo(16,4);expect(walker.grounded).toBe(true);
 });
 it('chooses another side instead of sweeping through a nearby building wall',()=>{
  const world=street(),walker=new VoxelWalker(world,{x:20.5,y:16,z:20.5});
  for(let y=16;y<24;y++)for(let z=18;z<23;z++)world.setVoxel(19,y,z,Material.Brick);
  walker.setObstacleProvider(()=>[person()]);walker.position.set(20.5,20,20.5);walker.grounded=false;
  simulate(walker,2);
  expect(walker.position.y).toBeCloseTo(16,4);expect(walker.position.x).toBeGreaterThan(20.28);
  expect(walker.canOccupy(walker.position)).toBe(true);
 });
 it('continues treating an ordinary car roof as a supported standing surface',()=>{
  const walker=new VoxelWalker(street(),{x:10.5,y:16,z:10.5}),car={minX:19,maxX:23,minY:16,maxY:17.6,minZ:19,maxZ:23};
  walker.setObstacleProvider(()=>[car]);walker.teleportEye({x:20.5,y:19.28,z:20.5});simulate(walker,1);
  expect(walker.position.y).toBeCloseTo(17.6,4);expect(walker.grounded).toBe(true);
 });
});
