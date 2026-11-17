import { describe, expect, it,vi } from 'vitest';
import { Scene } from 'three';
import { GroundDetail } from '../src/rendering/ground-detail';
import { Material } from '../src/world/palette';
import { regionalHeightAt } from '../src/world/region-terrain';
import { VoxelWorld } from '../src/world/voxel';

function grassPatch() {
  const world = new VoxelWorld();
  for (let z = 140; z <= 157; z++) for (let x = 133; x <= 169; x++) {
    world.setVoxel(x, regionalHeightAt(x, z), z, Material.Grass);
  }
  return world;
}

describe('ground cover in an editable world', () => {
  it('ignores edits outside its support chunks and restores cover after a local repair',()=>{
    const world=grassPatch(),detail=new GroundDetail(new Scene(),world),focus={x:150,y:18,z:150};detail.update(0,focus);const before=detail.diagnostics.visible,read=vi.spyOn(world,'getVoxel');
    detail.sync(['40,0,40']);expect(read).not.toHaveBeenCalled();read.mockRestore();
    const removed=[];for(let z=140;z<=157;z++)for(let x=133;x<=169;x++){const y=regionalHeightAt(x,z);removed.push({x,y,z,material:world.getVoxel(x,y,z)});world.setVoxel(x,y,z,0);}
    detail.sync(world.chunks.keys());detail.update(0,focus);expect(detail.diagnostics.visible).toBe(0);
    for(const p of removed)world.setVoxel(p.x,p.y,p.z,p.material);detail.sync(world.chunks.keys());detail.update(0,focus);expect(detail.diagnostics.visible).toBe(before);detail.dispose();
  });
  it('is read-only and disappears immediately when its support is removed without moving the camera', () => {
    const world = grassPatch(), before = [...world.chunks].map(([key, c]) => [key, c.voxels.slice()] as const);
    const detail = new GroundDetail(new Scene(), world), focus = { x: 150, y: 18, z: 159 };
    detail.update(0, focus);
    expect(detail.diagnostics.visible).toBeGreaterThan(0);
    for (const [key, voxels] of before) expect(world.chunks.get(key)!.voxels).toEqual(voxels);
    for (let z = 140; z <= 157; z++) for (let x = 133; x <= 169; x++) world.setVoxel(x, regionalHeightAt(x, z), z, 0);
    detail.sync(world.chunks.keys()); detail.update(0, focus);
    expect(detail.diagnostics.visible).toBe(0);
    detail.dispose();
  });

  it('culls small cover from the high aerial camera and restores it when returning to the ground', () => {
    const detail = new GroundDetail(new Scene(), grassPatch());
    detail.update(0, { x: 150, y: 18, z: 159 });
    const groundCount = detail.diagnostics.visible;
    expect(groundCount).toBeGreaterThan(0);
    detail.update(.3, { x: 150, y: 200, z: 159 });
    expect(detail.diagnostics.visible).toBe(0);
    detail.update(.3, { x: 150, y: 18, z: 159 });
    expect(detail.diagnostics.visible).toBe(groundCount);
    expect(detail.diagnostics.batches).toBeLessThanOrEqual(5);
    detail.dispose();
  });
});
