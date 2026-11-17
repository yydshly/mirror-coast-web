import {afterEach,describe,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {carFeedback} from '../src/vehicles/vehicle-feedback';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import type {SceneObstacle} from '../src/input/scene-collisions';
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
async function setup(){
 const world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256}),scene=new Scene(),material=new MeshStandardMaterial(),camera=new PerspectiveCamera();
 for(let x=220;x<340;x++)for(let z=146;z<183;z++)for(let y=10;y<16;y++)world.setVoxel(x,y,z,y===15?Material.Road:Material.Rock);
 cleanup.push(()=>material.dispose());const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});cleanup.push(()=>physics.dispose());
 const car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>car.dispose());
 const frame=(dt=1/60)=>{car.beforePhysics(dt);physics.update(dt);car.afterPhysics(dt,camera);};
 return{world,scene,physics,car,camera,frame,simulate:(seconds:number)=>{for(let i=0;i<seconds*60;i++)frame();}};
}
describe('shared rigid-body car responses',()=>{
 it('recovers from an impact while reversing continuously, without requiring a one-second stop or zeroing the handover speed',async()=>{
  const {car,frame}=await setup();car.setObstacleProvider(()=>[{minX:279,maxX:283,minY:16,maxY:19,minZ:162,maxZ:166}]);car.setDriving(true);car.setInput({throttle:1});
  for(let i=0;i<300&&!car.viewState.recovering;i++)frame();
  expect(car.viewState.recovering).toBe(true);
  expect(carFeedback(car.viewState).condition).toContain('未受损');const contact=car.position.clone();car.setInput({throttle:-1});
  let handover=false;const trace:unknown[]=[];
  for(let i=0;i<150;i++){const before=car.viewState;frame();if(i%15===0)trace.push({frame:i,x:car.position.x,...car.viewState});if(before.recovering&&!car.viewState.recovering){handover=true;expect(Math.abs(car.viewState.speed-before.speed)).toBeLessThan(.5);}}
  expect(handover,JSON.stringify(trace)).toBe(true);expect(car.position.x).toBeLessThan(contact.x-5);expect(car.viewState.speed).toBeLessThan(-4);expect(carFeedback(car.viewState).condition).toContain('动力正常');
 });
 it('removes temporary prop colliders when the car returns to its road motor',async()=>{
  const {car,physics,simulate}=await setup();let props:SceneObstacle[]=[{minX:279,maxX:283,minY:16,maxY:19,minZ:162,maxZ:166}];
  car.setObstacleProvider(()=>props);car.setDriving(true);car.setInput({throttle:1});simulate(4);car.releaseControls();simulate(3);
  expect(car.snapshot().rigidBody).toBeUndefined();props=[];
  physics.addFragments([{id:'prop-removal-probe',buildingId:'test',size:{x:1,y:1,z:1},voxels:[[0,0,0,Material.Brick]],position:{x:281,y:22,z:164},rotation:{x:0,y:0,z:0,w:1},state:'falling'}]);
  simulate(3);expect(physics.snapshot()[0].position.y).toBeLessThan(17);
 });
 it('tips into an excavation with one supported wheel side and preserves the overturned pose on restore',async()=>{
  const {world,car,simulate,scene,physics,camera}=await setup();
  car.restore({position:{x:248,y:16.85,z:163.65},heading:-Math.PI/2,speed:0});
  for(let x=242;x<255;x++)for(let z=156;z<164;z++)for(let y=12;y<16;y++)world.setVoxel(x,y,z,0);
  simulate(3);
  const state=car.snapshot(),up=new Vector3(0,1,0).applyQuaternion(new Quaternion().copy(state.rigidBody!.rotation));
  expect(state.rigidBody).toBeDefined();expect(up.y).toBeLessThan(.5);expect(state.position.y).toBeLessThan(16);
  const root=scene.getObjectByName('coastal-road-car')!;expect(new Vector3(0,1,0).applyQuaternion(root.quaternion).y).toBeLessThan(.5);
  car.dispose();const restored=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>restored.dispose());restored.restore(state);restored.afterPhysics(0,camera);
  expect(restored.position.distanceTo(state.position)).toBeLessThan(.001);
  expect(restored.snapshot().rigidBody!.rotation).toEqual(state.rigidBody!.rotation);
 });
 it('transfers impact motion to traffic and keeps that body physical when navigation synchronizes again',async()=>{
  const {car,physics,frame}=await setup();const target:SceneObstacle={minX:279,maxX:283,minY:16,maxY:17.5,minZ:162.9,maxZ:165.1,trafficId:0,trafficHeading:Math.PI/2,trafficHalfSize:{x:1.1,y:.75,z:2}};
  physics.syncActorObstacles([target]);car.setObstacleProvider(()=>[target]);car.setDriving(true);car.setInput({throttle:1});
  let impact=false,playerBecameDynamic=false,peakTargetSpeed=0;const trace:unknown[]=[];
  for(let i=0;i<300;i++){
   physics.syncActorObstacles([target]);frame();const targetState=physics.trafficSnapshot()[0];
   playerBecameDynamic ||= !!car.snapshot().rigidBody;
   if(targetState){if(!impact){expect(Math.abs(new Quaternion().copy(targetState.rotation).dot(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2)))).toBeGreaterThan(.95);}if(!impact||i%30===0)trace.push({frame:i,car:car.snapshot(),target:targetState});impact=true;peakTargetSpeed=Math.max(peakTargetSpeed,Math.hypot(targetState.linearVelocity.x,targetState.linearVelocity.z));}
  }
  const moved=physics.trafficSnapshot()[0];
  expect(impact).toBe(true);expect(peakTargetSpeed,JSON.stringify(trace)).toBeGreaterThan(2);expect(moved.position.x).toBeGreaterThan(282);
  expect(car.position.x).toBeLessThan(moved.position.x);expect(playerBecameDynamic).toBe(true);
  const before=moved.position.x;physics.syncActorObstacles([target]);expect(physics.trafficSnapshot()[0].position.x).toBe(before);
 });
});
