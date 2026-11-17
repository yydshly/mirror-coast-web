import {describe,it,expect} from 'vitest';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {VoxelWalker} from '../src/input/walk';
import type {SceneObstacle} from '../src/input/scene-collisions';

describe('ordinary visible stair traversal',()=>{
 it('walks up and down 20cm risers with 30cm treads without jumping',()=>{
  const world=new VoxelWorld();for(let x=4;x<24;x++)for(let z=4;z<20;z++)world.setVoxel(x,15,z,Material.Concrete);
  const stairs:SceneObstacle[]=Array.from({length:8},(_,i)=>({minX:12+i*.3,maxX:12+(i+1)*.3,minZ:8,maxZ:16,minY:16,maxY:16+(i+1)*.2}));
  stairs.push({minX:14.4,maxX:22,minZ:8,maxZ:16,minY:16,maxY:17.6});
  const walker=new VoxelWalker(world,{x:10,y:16,z:12});walker.setObstacleProvider(()=>stairs);let recovered=false;
  for(let i=0;i<200;i++){walker.update(1/60,{x:1,z:0});recovered||=walker.recoveredLastStep;}
  expect(walker.position.x,JSON.stringify(walker.position)).toBeGreaterThan(17);expect(walker.position.y).toBeCloseTo(17.6,2);expect(recovered).toBe(false);
  for(let i=0;i<200;i++)walker.update(1/60,{x:-1,z:0});expect(walker.position.x).toBeLessThan(11);expect(walker.position.y).toBeCloseTo(16,2);
 });
});
