import {afterEach,it,expect} from 'vitest';
import {MeshStandardMaterial,Scene,PerspectiveCamera,Quaternion,Vector3} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {orientedCollisionBounds} from '../src/input/scene-collisions';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
async function setup(){const scene=new Scene(),world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256}),mat=new MeshStandardMaterial(),camera=new PerspectiveCamera();for(let x=230;x<330;x++)for(let z=146;z<183;z++)world.setVoxel(x,15,z,Material.Road);const physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}});cleanup.push(()=>mat.dispose(),()=>physics.dispose());const car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>car.dispose());const step=()=>{car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);};return{car,physics,step};}
it('keeps actual mirrors and roof rails present in the rigid-body contact shapes',async()=>{
 const {car,physics,step}=await setup();car.restore({position:{x:270,y:16.85,z:164},heading:0,speed:0});car.setDriving(true);step();
 const observer=physics.createGroundVehicle({x:310,y:25,z:170},()=>{});cleanup.push(()=>observer.dispose());
 expect(observer.cameraDistance({x:271.035,y:20,z:163.19},{x:0,y:-1,z:0},10)).toBeCloseTo(2.6,2);
 expect(observer.cameraDistance({x:270.57,y:20,z:164.35},{x:0,y:-1,z:0},10)).toBeCloseTo(2.01,2);
});
it('drives beside an angled obstacle through the empty part of its broad bounding box',async()=>{
 const {car,step}=await setup(),rail=orientedCollisionBounds({x:281,y:17,z:164},new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),{x:3,y:.5,z:.08});
 car.setObstacleProvider(()=>[rail]);car.restore({position:{x:280,y:16.85,z:167.5},heading:-Math.PI/4,speed:0});car.setDriving(true);expect(car.position.x).toBeCloseTo(280,3);car.setInput({throttle:1});for(let i=0;i<160;i++)step();expect(car.position.distanceTo({x:280,y:16.85,z:167.5})).toBeGreaterThan(10);expect(car.snapshot().rigidBody).toBeUndefined();
});
it('detects a managed obstruction at the mirror even when the main body is clear',async()=>{
 const {physics}=await setup(),vehicle=physics.createGroundVehicle({x:270,y:16.85,z:164},()=>{});cleanup.push(()=>vehicle.dispose());vehicle.setActive(true);physics.syncActorObstacles([{minX:271.01,maxX:271.14,minY:16.88,maxY:17.02,minZ:163.12,maxZ:163.26}]);physics.update(1/60);expect(vehicle.canOccupy({x:270,y:16.85,z:164},{x:0,y:0,z:0,w:1})).toBe(false);
});
