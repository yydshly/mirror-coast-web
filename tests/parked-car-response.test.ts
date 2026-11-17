import {expect,it} from 'vitest';
import {Scene} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {BuildingRegistry} from '../src/destruction/buildings';
import {StreetArt} from '../src/rendering/street-art';
it('moves parked-car instances and collisions together, keeps their crash pose after anchor edits and restores them over a saved hole',()=>{
 const world=new VoxelWorld();for(let x=30;x<218;x++)for(let z=30;z<180;z++)world.setVoxel(x,15,z,Material.Road);
 const art=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false});
 try{
  const original=art.vehicleObstacles.find(b=>b.trafficId===18)!;expect(original).toBeDefined();
  const state={id:18,position:{x:90.8,y:16.675,z:145},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}};
  art.syncTraffic([state]);expect((original.minX+original.maxX)/2).toBeCloseTo(90.8,4);
  const footing=art.propFootings.find(p=>p.kind==='car')!;
  const dirty=world.applyEdits(footing.anchors.map(p=>({...p,material:0})));art.sync(dirty);
  expect(art.obstacles).toContain(original);expect((original.minX+original.maxX)/2).toBeCloseTo(90.8,4);
  const restored=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false,parkedStates:[state]});
  try{restored.syncTraffic([state]);const b=restored.vehicleObstacles.find(b=>b.trafficId===18)!;expect((b.minX+b.maxX)/2).toBeCloseTo(90.8,4);}finally{restored.dispose();}
  expect(art.clearTraffic(new Set([18]))).toEqual([18]);expect(original.maxY).toBeLessThan(original.minY);
  art.syncTraffic([state]);art.sync(world.chunks.keys());expect(original.maxY).toBeLessThan(original.minY);
  expect(art.clearTraffic(new Set([18]))).toEqual([]);
 }finally{art.dispose();}
});
