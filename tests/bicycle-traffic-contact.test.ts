import {afterEach,expect,it} from 'vitest';
import {Quaternion,Scene,Vector3} from 'three';
import {Bicycle} from '../src/vehicles/bicycle';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {StreetLifeSimulation,sampleRoute} from '../src/simulation/street-life-sim';
import {obstaclesIntersect,orientedCollisionBounds} from '../src/input/scene-collisions';
import {clipVehicleCamera} from '../src/vehicles/chase-camera';

const bikes:Bicycle[]=[];
afterEach(()=>bikes.splice(0).forEach(b=>b.dispose()));
function flat(){const world=new VoxelWorld();for(let x=30;x<235;x++)for(let z=75;z<180;z++)world.setVoxel(x,15,z,Material.Road,false);return world;}
function van(world:VoxelWorld){
 const sim=new StreetLifeSimulation(world,{cars:2,people:false}),car=sim.cars.find(c=>c.kind==='van')!;
 const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4);
 sim.update(0,{focus:{x:120,y:16,z:169},night:0,wetness:0,obstacles:[],trafficPhysics:[{id:car.id,position:{x:120,y:16+car.height/2,z:169},rotation,linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}]});
 return car.bounds;
}
function rider(world:VoxelWorld,x:number,z:number,heading=0){
 const b=new Bicycle(new Scene(),world);bikes.push(b);b.restore({position:{x,y:16,z},heading,riding:true});b.setRiding(true);return b;
}
function ride(b:Bicycle,throttle:number,frames=150){b.setInput(throttle);for(let i=0;i<frames;i++){b.update(1/60);expect(b.motor.recoveredLastStep,'normal passage must not relocate the bicycle').toBe(false);}}

it.each([168,166.3])('rides forward from z=%s through the empty corner beside an angled van without rescue or moving the van',z=>{
 const world=flat(),obstacle=van(world),before=obstacle.trafficHeading,b=rider(world,122.1,z);
 b.setObstacleProvider(()=>[obstacle]);ride(b,1);
 expect(b.position.z).toBeLessThan(z-4);expect(b.position.x).toBeCloseTo(122.1,3);expect(b.position.y).toBeCloseTo(16,3);
 expect(obstacle.trafficHeading).toBe(before);
});
it('stops at the actual angled body and can back away without crossing it',()=>{
 const world=flat(),obstacle=van(world),b=rider(world,120,174);
 b.setObstacleProvider(()=>[obstacle]);ride(b,1,230);
 const stopped=b.position.z,body=orientedCollisionBounds({x:b.position.x,y:16.96,z:stopped},new Quaternion(),{x:.31,y:.77,z:.96});
 expect(stopped).toBeGreaterThan(170);expect(b.viewState.blocked).toContain('受阻');expect(obstaclesIntersect(body,obstacle)).toBe(false);
 ride(b,-1,120);expect(b.position.z).toBeGreaterThan(stopped+.6);
});
it('keeps a turning traffic car collision box aligned and current, including after accident clearance',()=>{
 const world=flat(),sim=new StreetLifeSimulation(world,{cars:1,people:false}),car=sim.cars[0],pose=sampleRoute(car.route,2);
 car.distance=2;Object.assign(car.position,pose,{y:16});car.heading=pose.heading;
 sim.update(1/30,{focus:car.position,night:0,wetness:0,obstacles:[]});
 expect(car.bounds.obb).toBeDefined();expect(car.bounds.obb!.center.x).toBeCloseTo(car.position.x,5);
 expect(car.bounds.obb!.halfSize.z).toBeCloseTo(car.length/2,5);
 expect(car.bounds.obb!.rotation.elements[8]).toBeCloseTo(Math.cos(car.heading),5);
 expect(sim.clearAccidents(new Set([car.id]),{x:40,y:16,z:82},()=>true).resumed).toBe(1);
 expect(car.bounds.obb!.center.x).toBeCloseTo(car.position.x,5);expect(car.bounds.obb!.center.z).toBeCloseTo(car.position.z,5);
});
it('keeps the camera in an empty rotated corner while still stopping before the actual van',()=>{
 const world=flat(),obstacle=van(world),origin=new Vector3(122.1,17.2,166.3),open=new Vector3(126,17.2,169),into=new Vector3(120,17.2,169);
 const camera=(p:Vector3)=>clipVehicleCamera(world,origin,p,(_o,_d,length)=>length,new Vector3(),[obstacle]);
 expect(camera(open).distanceTo(open)).toBeLessThan(.001);
 expect(camera(into).distanceTo(origin)).toBeLessThan(origin.distanceTo(into)-.5);
});
