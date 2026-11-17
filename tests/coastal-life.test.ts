import {beforeAll,describe,expect,it} from 'vitest';
import {InstancedMesh,Scene,Vector3} from 'three';
import {COASTAL_BOAT_ROUTES,CoastalLife,coastalBoatPose,isCoastalWaterClear} from '../src/rendering/coastal-life';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {addExplorationSites} from '../src/world/exploration-sites';
import {Material} from '../src/world/palette';
import type {VoxelWorld} from '../src/world/voxel';

let world:VoxelWorld;
beforeAll(()=>{
  const generated=generateWorld();world=generated.world;
  addHarborQuarter(world,generated.buildings);addRegionalTerrain(world);addRegionalDistricts(world,generated.buildings);addExplorationSites(world,generated.buildings);
});
describe('offshore life',()=>{
  it('keeps all three closed routes and their full clear-water margins away from terrain, piers and the rescue wreck',()=>{
    for(const route of COASTAL_BOAT_ROUTES){
      const period=2*Math.PI/Math.abs(route.rate);
      for(let i=0;i<=360;i++)expect(isCoastalWaterClear(world,coastalBoatPose(route,period*i/360)),`${route.x}: sample ${i}`).toBe(true);
      const first=coastalBoatPose(route,0),last=coastalBoatPose(route,period);
      expect(Math.hypot(last.x-first.x,last.z-first.z)).toBeLessThan(1e-9);
    }
  });
  it('rejects an edited obstacle and a high pier deck over otherwise clear water',()=>{
    const pose=coastalBoatPose(COASTAL_BOAT_ROUTES[1],0),x=Math.floor(pose.x),z=Math.floor(pose.z);
    expect(isCoastalWaterClear(world,pose)).toBe(true);
    world.setVoxel(x,18,z,Material.Wood);expect(isCoastalWaterClear(world,pose)).toBe(false);
    world.setVoxel(x,18,z,0);expect(isCoastalWaterClear(world,pose)).toBe(true);
    const c=Math.cos(pose.heading),s=Math.sin(pose.heading),offsetX=Math.floor(pose.x+c+s*2),offsetZ=Math.floor(pose.z-s+c*2);
    world.setVoxel(offsetX,13,offsetZ,Material.Wood);expect(isCoastalWaterClear(world,pose)).toBe(false);
    world.setVoxel(offsetX,13,offsetZ,0);expect(isCoastalWaterClear(world,pose)).toBe(true);
  });
  it('renders three boats and fifteen birds in eight shared draws without touching the world or overflowing when weather changes',()=>{
    const scene=new Scene(),life=new CoastalLife(scene,world),revisions=[...world.chunks.values()].map(chunk=>chunk.revision);
    for(let i=0;i<100;i++)life.update(.1,new Vector3(256,30,220),0,i%2);
    expect(life.diagnostics).toEqual({boats:3,birds:15,batches:8,blockedBoats:0});
    const root=scene.getObjectByName('coastal-life')!;
    expect(root.children.filter(child=>child instanceof InstancedMesh)).toHaveLength(8);
    expect([...world.chunks.values()].map(chunk=>chunk.revision)).toEqual(revisions);
    life.update(.1,{x:256,y:30,z:220},1,1);expect(life.diagnostics.birds).toBe(0);
    life.dispose();expect(scene.getObjectByName('coastal-life')).toBeUndefined();
  });
  it('puts a visible boat near the south-bay boardwalk and one near the west-cape viewing edge',()=>{
    const rescue={x:657,z:183},cape={x:-189,z:126};
    const southern=coastalBoatPose(COASTAL_BOAT_ROUTES[1],0),western=coastalBoatPose(COASTAL_BOAT_ROUTES[2],0);
    expect(Math.hypot(southern.x-rescue.x,southern.z-rescue.z)).toBeLessThan(85);
    expect(Math.hypot(western.x-cape.x,western.z-cape.z)).toBeLessThan(160);
  });
});
