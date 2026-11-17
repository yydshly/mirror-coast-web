import {beforeAll,describe,expect,it} from 'vitest';
import {InstancedMesh,Matrix4,Scene,Vector3} from 'three';
import {CoastalBoat} from '../src/vehicles/coastal-boat';
import {obstaclesIntersect} from '../src/input/scene-collisions';
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
  it('keeps each solid hull aligned with the actual rendered fishing boat, including offscreen updates',()=>{
    const scene=new Scene(),life=new CoastalLife(scene,world);
    try{
      life.update(.1,{x:3000,y:30,z:3000},0,.5);
      const paint=scene.getObjectByName('coastal-life-boat-paint') as InstancedMesh,matrix=new Matrix4(),center=new Vector3();paint.getMatrixAt(0,matrix);center.setFromMatrixPosition(matrix);
      const hull=life.obstacles[0];expect(hull.obb!.center.distanceTo(center)).toBeLessThan(1e-4);expect(hull.obb!.halfSize.x).toBeCloseTo(3.05/2);expect(life.obstacles.length).toBeGreaterThan(60);
    }finally{life.dispose();}
  });
  it('yields to a stationary player vessel, never drives through it, then resumes after it leaves',()=>{
    const scene=new Scene(),life=new CoastalLife(scene,world),boat=new CoastalBoat(scene,world),route=COASTAL_BOAT_ROUTES[0],ahead=coastalBoatPose(route,10);
    try{
      expect(boat.restore({position:{x:ahead.x,y:12.08,z:ahead.z},heading:ahead.heading,piloting:false})).toBe(false);life.setObstacleProvider(()=>boat.obstacles);
      for(let i=0;i<900;i++){life.update(1/60,{x:ahead.x,y:12,z:ahead.z});expect(life.obstacles.some(a=>boat.obstacles.some(b=>obstaclesIntersect(a,b)))).toBe(false);}
      expect(life.vesselStates[0].moving).toBe(false);const before=life.vesselStates[0];life.setObstacleProvider(()=>[]);life.update(.1,{x:ahead.x,y:12,z:ahead.z});expect(life.vesselStates[0].moving).toBe(true);expect(life.vesselStates[0].x).not.toBe(before.x);
    }finally{boat.dispose();life.dispose();}
  });
  it('stops the controlled motorboat before the fishing hull and allows a normal reverse departure',()=>{
    const scene=new Scene(),life=new CoastalLife(scene,world),boat=new CoastalBoat(scene,world),vessel=life.vesselStates[0],x=vessel.x+Math.sin(vessel.heading)*12,z=vessel.z+Math.cos(vessel.heading)*12;
    try{
      boat.restore({position:{x,y:12.08,z},heading:vessel.heading,piloting:true});boat.setPiloting(true);boat.setObstacleProvider(()=>life.obstacles);boat.setInput(1);
      for(let i=0;i<360;i++){boat.update(1/60);const a=life.obstacles.find(a=>boat.obstacles.some(b=>obstaclesIntersect(a,b))),b=a&&boat.obstacles.find(b=>obstaclesIntersect(a,b));expect(!!a,JSON.stringify({i,p:boat.snapshot(),status:boat.viewState,a,b})).toBe(false);}
      expect(boat.viewState.blocked).toBe(true);const p=boat.position.clone();boat.setInput(-1);for(let i=0;i<240;i++)boat.update(1/60);expect(boat.position.distanceTo(p)).toBeGreaterThan(3);expect(boat.viewState.speed).toBeLessThan(-1);
    }finally{boat.dispose();life.dispose();}
  });
});
