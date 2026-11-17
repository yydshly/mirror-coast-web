import{afterEach,expect,it,vi}from'vitest';
import{IDBFactory}from'fake-indexeddb';
import{MeshStandardMaterial,Quaternion,Scene,Vector3}from'three';
import{CollapsePhysics,type TrafficBodyState}from'../src/destruction/physics';
import{WorldPersistence}from'../src/persistence/storage';
import{StreetLifeSimulation,sampleRoute,type LifeContext}from'../src/simulation/street-life-sim';
import{VoxelWorld}from'../src/world/voxel';
import{Material}from'../src/world/palette';
import type{SceneObstacle}from'../src/input/scene-collisions';
const cleanup:Array<()=>void>=[];afterEach(()=>{cleanup.splice(0).reverse().forEach(f=>f());vi.unstubAllGlobals();});
const zero={x:0,y:0,z:0};
const state=(id:number,x:number,z=82):TrafficBodyState=>({id,position:{x,y:16.725,z},rotation:{x:0,y:0,z:0,w:1},linearVelocity:zero,angularVelocity:zero});
function street(){const world=new VoxelWorld();for(let x=30;x<232;x++)for(let z=75;z<171;z++)if(z<88||z>156||x<45||x>216)world.setVoxel(x,15,z,Material.Road,false);return world;}

it('clears only selected physical actors, keeps shared actor indices and removes pending restored wrecks',async()=>{
 const material=new MeshStandardMaterial(),physics=await CollapsePhysics.create(new Scene(),material,{onStateChange:()=>{}});cleanup.push(()=>material.dispose(),()=>physics.dispose());
 const box=(id:number,x:number):SceneObstacle=>({minX:x-.9,maxX:x+.9,minY:16,maxY:17.45,minZ:80,maxZ:84,trafficId:id});
 const bounds=[box(0,60),box(2,100),box(19,140)];physics.restoreTraffic([state(2,100),state(19,140)]);physics.syncActorObstacles(bounds);
 const probe=physics.createGroundVehicle({x:10,y:16.85,z:100},()=>{});cleanup.push(()=>probe.dispose());probe.setActive(true);physics.update(1/60);
 expect(probe.cameraDistance({x:96,y:16.8,z:82},{x:1,y:0,z:0},8)).toBeLessThan(8);
 physics.clearTraffic(new Set([2]));bounds[1]=box(2,190);physics.syncActorObstacles(bounds);physics.update(1/60);
 expect(physics.trafficSnapshot().map(s=>s.id)).toEqual([19]);expect(probe.cameraDistance({x:96,y:16.8,z:82},{x:1,y:0,z:0},8)).toBe(8);
 physics.restoreTraffic([state(3,100)]);physics.clearTraffic(new Set([3]));physics.syncActorObstacles([...bounds,box(3,170)]);expect(physics.trafficSnapshot().some(s=>s.id===3)).toBe(false);
});

it('releases a blocked follower and safely rejoins cleared cars away from the incident',()=>{
 const sim=new StreetLifeSimulation(street(),{cars:3,people:false}),follower=sim.cars[0],wreck=sim.cars[1];
 follower.distance=45;const p=sampleRoute(follower.route,45);Object.assign(follower.position,p);follower.heading=p.heading;
 const impact=sampleRoute(wreck.route,65),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),impact.heading),context:LifeContext={focus:{x:p.x,y:16,z:p.z},night:0,wetness:0,obstacles:[{minX:impact.x-15,maxX:impact.x+15,minY:16,maxY:20,minZ:75,maxZ:80.5},{minX:impact.x-15,maxX:impact.x+15,minY:16,maxY:20,minZ:83.5,maxZ:88}],trafficPhysics:[{...state(wreck.id,impact.x),position:{x:impact.x,y:16+wreck.height/2,z:impact.z},rotation:q}]};
 for(let i=0;i<240;i++)sim.update(1/30,context);expect(follower.speed).toBeLessThan(.1);const before=follower.travelled;
 const result=sim.clearAccidents(new Set([wreck.id]),context.focus,()=>true);expect(result.resumed).toBe(1);expect(result.removed).toEqual([]);expect(wreck.physicsRotation).toBeUndefined();expect(Math.hypot(wreck.position.x-p.x,wreck.position.z-p.z)).toBeGreaterThanOrEqual(80);
 for(let i=0;i<240;i++)sim.update(1/30,{...context,trafficPhysics:[]});expect(follower.travelled-before).toBeGreaterThan(12);
});

it('withdraws an accident car when no safe road slot exists and retains that removal on restore',()=>{
 const world=street(),sim=new StreetLifeSimulation(world,{cars:3,people:false}),car=sim.cars[0],context:LifeContext={focus:{...car.position},night:0,wetness:0,obstacles:[],trafficPhysics:[state(car.id,car.position.x,car.position.z)]};
 sim.update(0,context);expect(sim.clearAccidents(new Set([car.id]),context.focus,()=>false)).toEqual({resumed:0,removed:[car.id]});
 for(let i=0;i<60;i++)sim.update(1/30,{...context,trafficPhysics:[]});expect(car.visible).toBe(false);expect(car.bounds.maxY).toBeLessThan(car.bounds.minY);
 const restored=new StreetLifeSimulation(world,{cars:3,people:false,removedTraffic:[car.id]});restored.update(1/30,context);expect(restored.cars[0].visible).toBe(false);
});

it('accepts a newly physical accident before the next visual simulation update',()=>{
 const sim=new StreetLifeSimulation(street(),{cars:3,people:false}),car=sim.cars[0],old={...car.position};
 expect(car.physicsRotation).toBeUndefined();expect(sim.clearAccidents(new Set([car.id]),old,()=>true).resumed).toBe(1);
 expect(Math.hypot(car.position.x-old.x,car.position.z-old.z)).toBeGreaterThanOrEqual(80);
});

it('commits clearance after an older crash write and retains unrelated destruction and player car',async()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());const options={worldVersion:'clearance-test',seed:48271},persistence=new WorldPersistence(options);cleanup.push(()=>persistence.dispose());
 const player={position:{x:70,y:17.68,z:90},rotation:zero,car:{position:{x:72,y:16.85,z:90},heading:0,speed:0},traffic:[state(19,100)]};
 const edit={x:31,y:20,z:32,material:0};persistence.record([edit]);persistence.setPlayer(player);const older=persistence.flush();await Promise.resolve();persistence.setPlayer({...player,traffic:[],removedTraffic:[19]});await older;await persistence.flush();
 const restored=new WorldPersistence(options);cleanup.push(()=>restored.dispose());const save=await restored.load();expect(save?.player?.traffic).toEqual([]);expect(save?.player?.removedTraffic).toEqual([19]);expect(save?.player?.car).toEqual(player.car);expect(save?.edits).toEqual([edit]);
 const exported=await persistence.exportSave();await restored.importSave(exported);expect(JSON.parse(await restored.exportSave()).player.removedTraffic).toEqual([19]);
 expect(()=>restored.setPlayer({...player,removedTraffic:[19]})).toThrow();expect(()=>restored.setPlayer({...player,traffic:[],removedTraffic:[19,19]})).toThrow();expect(()=>restored.setPlayer({...player,traffic:[],removedTraffic:[24]})).toThrow();
});
