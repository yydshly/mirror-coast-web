import { describe,expect,it } from 'vitest';
import { findCarExit } from '../src/vehicles/car-exit';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';
import { VoxelWalker } from '../src/input/walk';

function setup(){
  const world=new VoxelWorld();
  for(let x=12;x<28;x++)for(let z=12;z<28;z++)world.setVoxel(x,15,z,Material.Road);
  const walker=new VoxelWalker(world,{x:20,y:16,z:20});
  return {world,walker,exit:()=>findCarExit(world,{x:20,y:16.85,z:20},0,feet=>walker.canOccupy(feet))};
}
describe('safe vehicle exits',()=>{
  it('chooses the opposite side when the first side is a building wall',()=>{
    const {world,exit}=setup();
    for(let x=22;x<25;x++)for(let z=18;z<23;z++)for(let y=16;y<21;y++)world.setVoxel(x,y,z,Material.Brick);
    expect(exit()).toEqual({x:17.6,y:16,z:20});
  });
  it('refuses both sides when parking at a cliff instead of dropping to a lower surface',()=>{
    const {world,exit}=setup();
    for(let x=12;x<28;x++)if(x<19||x>21)for(let z=12;z<28;z++){
      world.setVoxel(x,15,z,Material.Air);world.setVoxel(x,7,z,Material.Rock);
    }
    expect(exit()).toBeNull();
  });
  it('respects live furniture and vehicle collision bounds when finding a standing surface',()=>{
    const {walker,exit}=setup();
    walker.setObstacleProvider(()=>[{minX:16,maxX:25,minY:16,maxY:19,minZ:18,maxZ:22}]);
    expect(exit()).toBeNull();
  });
});
