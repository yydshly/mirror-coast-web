import {afterEach,expect,it} from 'vitest';
import {Box3,Euler,Mesh,MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import {StreetArt} from '../src/rendering/street-art';
import {BuildingRegistry} from '../src/destruction/buildings';
import {CollapsePhysics} from '../src/destruction/physics';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {orientedCollisionBounds,obstaclesIntersect} from '../src/input/scene-collisions';
import {Bicycle} from '../src/vehicles/bicycle';
import {bicycleModel} from '../src/vehicles/bicycle-model';
import {bicycleRiderBounds} from '../src/vehicles/bicycle-collision';
import {CoastalCar} from '../src/vehicles/coastal-car';

const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
function road(){const world=new VoxelWorld();for(let x=30;x<218;x++)for(let z=30;z<190;z++)world.setVoxel(x,15,z,Material.Road,false);return world;}
it.each([18,22])('keeps parked car %s rotated after a crash, updates the same handles, and releases its old location',id=>{
 const world=road(),art=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false});cleanup.push(()=>art.dispose());
 const b=art.vehicleObstacles.find(p=>p.trafficId===id)!;expect(b).toBeDefined();
 const original=new Vector3((b.minX+b.maxX)/2,(b.minY+b.maxY)/2,(b.minZ+b.maxZ)/2),half=new Vector3((b.maxX-b.minX)/2,(b.maxY-b.minY)/2,(b.maxZ-b.minZ)/2);
 const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),center=new Vector3(120,16.675,170);
 art.syncTraffic([{id,position:center,rotation:q,linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}]);
 expect(art.vehicleObstacles.find(p=>p.trafficId===id)).toBe(b);expect(b.obb).toBeDefined();
 expect(b.obb!.center.distanceTo(center)).toBeLessThan(.001);expect(b.obb!.halfSize.distanceTo(half)).toBeLessThan(.001);
 const corner=orientedCollisionBounds({x:b.maxX-.12,y:16.8,z:b.minZ+.12},new Quaternion(),{x:.04,y:.1,z:.04});
 expect(obstaclesIntersect(corner,b)).toBe(false);
 expect(obstaclesIntersect(orientedCollisionBounds(center,new Quaternion(),{x:.1,y:.1,z:.1}),b)).toBe(true);
 expect(obstaclesIntersect(orientedCollisionBounds(original,new Quaternion(),{x:.1,y:.1,z:.1}),b)).toBe(false);
});
it.each(['car','helicopter'] as const)('refreshes the %s scenery collider when local dimensions change but broad bounds stay the same',async kind=>{
 const material=new MeshStandardMaterial(),physics=await CollapsePhysics.create(new Scene(),material,{onStateChange:()=>{}});cleanup.push(()=>material.dispose(),()=>physics.dispose());
 const vehicle=kind==='car'?physics.createGroundVehicle({x:105,y:30,z:205},()=>{}):physics.createVehicle({x:105,y:30,z:205},()=>{});cleanup.push(()=>vehicle.dispose());
 vehicle.setActive(true);
 const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),center={x:108,y:30,z:209},prop=orientedCollisionBounds(center,q,{x:3,y:1,z:.1});
 const origin={x:109.5,y:35,z:210.5},direction={x:0,y:-1,z:0},distance=()=>vehicle.cameraDistance(origin,direction,10);
 vehicle.syncProps([prop]);physics.update(1/60);expect(distance()).toBe(10);
 const broad=[prop.minX,prop.maxX,prop.minZ,prop.maxZ];orientedCollisionBounds(center,q,{x:.1,y:1,z:3},prop);expect([prop.minX,prop.maxX,prop.minZ,prop.maxZ]).toEqual(broad);
 vehicle.syncProps([prop]);physics.update(1/60);expect(distance()).toBeCloseTo(3.6,1);
 vehicle.syncProps([]);physics.update(1/60);expect(distance()).toBe(10);
});
it('keeps the rendered rider head below an overhead bar, while a genuinely high opening remains rideable',()=>{
 const model=bicycleModel();cleanup.push(()=>model.dispose());model.update(0,{phase:0,wheelAngle:0,speed:4,steer:0,pitch:0,riding:true,footDown:0});model.root.updateMatrixWorld(true);
 const head=new Box3().setFromObject(model.root.getObjectByName('explorer-head')!,true);expect(head.max.y).toBeGreaterThan(1.83);
 for(const height of [1.83,2.3]){
  const b=new Bicycle(new Scene(),road());cleanup.push(()=>b.dispose());b.restore({position:{x:120,y:16,z:175},heading:0,riding:true});b.setRiding(true);
  b.setObstacleProvider(()=>[{minX:118,maxX:122,minY:16+height,maxY:16+height+.15,minZ:171,maxZ:171.2,standable:false}]);b.setInput(1);
  for(let i=0;i<180;i++)b.update(1/60);
  if(height<2){expect(b.position.z,`head is ${head.max.y}m high`).toBeGreaterThan(171.3);expect(b.viewState.blocked).toContain('头');}
  else expect(b.position.z).toBeLessThan(169);
 }
});
it('contains the actual rider head geometry when pedalling, putting a foot down, banking and climbing',()=>{
 const model=bicycleModel();cleanup.push(()=>model.dispose());
 for(const footDown of [0,1])for(const pitch of [-.18,.18])for(const steer of [-.3,0,.3]){
  model.update(0,{phase:1,wheelAngle:1,speed:8,steer,pitch,riding:true,footDown});model.root.updateMatrixWorld(true);
  const q=new Quaternion().setFromEuler(new Euler(pitch,0,0,'YXZ'));
  const head=orientedCollisionBounds({x:0,y:0,z:0},q,{x:1,y:1,z:1});bicycleRiderBounds({x:0,y:0,z:0},q,steer,8,head);
  const body=orientedCollisionBounds({x:0,y:.96,z:0},q,{x:.31,y:.77,z:.96});
  model.root.getObjectByName('explorer-head')!.traverse(part=>{if(!(part instanceof Mesh))return;if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();const b=part.geometry.boundingBox!;
   for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
    const p=new Vector3(x,y,z).applyMatrix4(part.matrixWorld);expect(head.obb!.containsPoint(p)||body.obb!.containsPoint(p),JSON.stringify({footDown,pitch,steer,p})).toBe(true);
   }
  });
 }
});
it('drives through the empty corner of a physically restored parked wreck without relocation or changing authority',async()=>{
 const world=road(),scene=new Scene(),art=new StreetArt(scene,world,new BuildingRegistry(),{people:false});cleanup.push(()=>art.dispose());
 const material=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});cleanup.push(()=>material.dispose(),()=>physics.dispose());
 const state={id:18,position:{x:120,y:16.675,z:170},rotation:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}};
 art.syncTraffic([state]);const obstacle=art.vehicleObstacles.find(b=>b.trafficId===18)!;physics.restoreTraffic([state]);physics.syncActorObstacles([obstacle]);
 const car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>car.dispose());car.restore({position:{x:122.8,y:16.85,z:167},heading:0,speed:0});
 car.setObstacleProvider(()=>[obstacle]);car.setDriving(true);expect(car.position.x).toBeCloseTo(122.8,3);expect(car.position.z).toBeCloseTo(167,3);car.setInput({throttle:1});
 const camera=new PerspectiveCamera();for(let i=0;i<180;i++){car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);}
 expect(car.position.x).toBeCloseTo(122.8,2);expect(car.position.z).toBeLessThan(162);expect(car.snapshot().rigidBody).toBeUndefined();
});
