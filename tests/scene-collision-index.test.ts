import {describe,it,expect} from 'vitest';
import {SceneCollisionIndex} from '../src/input/scene-collision-index';
import {collectNearbyObstacles,type SceneObstacle} from '../src/input/scene-collisions';
const bounds=(x:number,z:number,y=16):SceneObstacle=>({minX:x,maxX:x+1,minY:y,maxY:y+2,minZ:z,maxZ:z+1});
describe('nearby scenery queries without scanning the whole city',()=>{
 it('matches full queries across cell boundaries, negative coordinates and vertical ranges',()=>{
  const scenery=Array.from({length:2000},(_,i)=>bounds(i%50*3-80,Math.floor(i/50)*4-90,i%3*12));
  const grid=new SceneCollisionIndex();grid.rebuild([scenery]);
  for(const p of [{x:0,y:16,z:0},{x:-16,y:25,z:-32},{x:58,y:0,z:34}])for(const vertical of [8,Infinity])expect(new Set(grid.query(p,17,vertical))).toEqual(new Set(collectNearbyObstacles(p,[scenery],17,vertical)));
 });
 it('keeps boats, physically moved parked cars and live bodies current, and removes destroyed scenery on rebuild',()=>{
  const wall=bounds(1,1),boat={...bounds(90,90),motion:{frame:0,delta:{x:0,y:0,z:0}}},car={...bounds(70,70),trafficId:20},body={...bounds(80,80),physicsManaged:true};
  const grid=new SceneCollisionIndex();grid.rebuild([[wall,boat,car]]);expect(grid.query({x:0,y:16,z:0},4,8,[[body]])).toEqual([wall]);
  for(const b of [boat,car,body])Object.assign(b,bounds(2,2));
  expect(new Set(grid.query({x:0,y:16,z:0},4,8,[[body,car]]))).toEqual(new Set([wall,boat,car,body]));
  grid.rebuild([[boat,car]]);expect(grid.query({x:0,y:16,z:0},4,8,[[body]])).not.toContain(wall);
 });
 it('visits local candidates even with a large distant city, without discarding close collisions',()=>{
  const local=bounds(15,15),far=Array.from({length:20000},(_,i)=>bounds(400+i%100,400+Math.floor(i/100)));
  const grid=new SceneCollisionIndex();grid.rebuild([[...far,local]]);expect(grid.query({x:16,y:16,z:16},4,8)).toEqual([local]);expect(grid.diagnostics.lastVisited).toBeLessThan(10);
 });
 it('tracks removals, repaired bounds and cell changes through repeated local destruction without duplicates',()=>{
  const fixed=bounds(-1,15),edited=bounds(16,16),removed=bounds(18,16),grid=new SceneCollisionIndex();
  let scenery=[fixed,edited,removed];grid.rebuild([scenery,[edited]]);
  Object.assign(edited,bounds(-33,-18));scenery=[edited,fixed];grid.rebuild([scenery]);
  expect(grid.query({x:18,y:16,z:16},2,8)).not.toContain(edited);expect(grid.query({x:18,y:16,z:16},2,8)).not.toContain(removed);
  expect(grid.query({x:-33,y:16,z:-18},3,8)).toEqual([edited]);
  removed.maxY=-1;scenery.push(removed);grid.rebuild([scenery]);Object.assign(removed,bounds(18,16));grid.rebuild([scenery,[removed]]);
  expect(grid.query({x:18,y:16,z:16},2,8)).toEqual([removed]);expect(grid.diagnostics.static).toBe(3);
  for(let i=0;i<5;i++){grid.rebuild([scenery]);for(const p of [{x:-16,y:16,z:16},{x:-33,y:16,z:-18},{x:18,y:16,z:16}])expect(new Set(grid.query(p,17,8))).toEqual(new Set(collectNearbyObstacles(p,[scenery],17,8)));}
 });
 it('removes old cell membership when a static object becomes physical, and reindexes it when static again',()=>{
  const b=bounds(1,1),grid=new SceneCollisionIndex();grid.rebuild([[b]]);b.physicsManaged=true;grid.rebuild([[b,b]]);Object.assign(b,bounds(100,100));
  expect(grid.query({x:1,y:16,z:1},2,8)).toHaveLength(0);expect(grid.query({x:100,y:16,z:100},2,8)).toEqual([b]);
  b.physicsManaged=false;grid.rebuild([[b]]);expect(grid.moving).toHaveLength(0);expect(grid.query({x:100,y:16,z:100},2,8)).toEqual([b]);
 });
});
