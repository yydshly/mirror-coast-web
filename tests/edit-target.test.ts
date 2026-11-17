import {describe,expect,it} from 'vitest';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {walkingEditTarget} from '../src/input/edit-target';

describe('body-relative editing in both camera views',()=>{
  it('allows a surface seven metres from the player even with a four-metre camera boom',()=>{
    const world=new VoxelWorld();world.setVoxel(20,17,12,Material.Brick);
    const hit=walkingEditTarget(world,{x:20.5,y:17.68,z:24.5},{x:0,y:0,z:-1},{x:20.5,y:17.68,z:20.5});
    expect(hit).toMatchObject({x:20,y:17,z:12});expect(hit!.distance).toBeCloseTo(7.5,4);
  });
  it('prevents a shoulder camera from editing around a wall blocking the character',()=>{
    const world=new VoxelWorld();world.setVoxel(20,17,12,Material.Brick);world.setVoxel(20,17,17,Material.Concrete);
    const camera={x:12,y:17.68,z:24},eyes={x:20.5,y:17.68,z:20.5};
    const dx=20.5-camera.x,dz=12.5-camera.z,length=Math.hypot(dx,dz),direction={x:dx/length,y:0,z:dz/length};
    expect(world.raycast(camera,direction,30)).toMatchObject({x:20,y:17,z:12});
    expect(walkingEditTarget(world,camera,direction,eyes)).toBeNull();
  });
  it('keeps the same reach limit in first person and rejects distant surfaces',()=>{
    const world=new VoxelWorld();world.setVoxel(20,17,10,Material.Brick);
    const eyes={x:20.5,y:17.68,z:20.5};
    expect(walkingEditTarget(world,eyes,{x:0,y:0,z:-1},eyes)).toBeNull();
    world.setVoxel(20,17,15,Material.Brick);
    expect(walkingEditTarget(world,eyes,{x:0,y:0,z:-1},eyes)).toMatchObject({x:20,y:17,z:15});
  });
});
