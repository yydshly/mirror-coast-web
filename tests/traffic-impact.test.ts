import {afterEach,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {VoxelWorld} from '../src/world/voxel';
import {type SceneObstacle} from '../src/input/scene-collisions';
import {trafficMass} from '../src/vehicles/traffic-physics';
import RAPIER from '@dimforge/rapier3d-compat';
const dispose:Array<()=>void>=[];afterEach(()=>dispose.splice(0).reverse().forEach(f=>f()));
async function setup(speed:number,height:number,length:number){
 const scene=new Scene(),world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256}),mat=new MeshStandardMaterial(),camera=new PerspectiveCamera();for(let x=245;x<315;x++)for(let z=140;z<188;z++)world.setVoxel(x,15,z,1,false);
 const physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}}),car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});dispose.push(()=>mat.dispose(),()=>physics.dispose(),()=>car.dispose());physics.ensureVehicleTerrain(world,{x:280,y:17,z:164},24);
 const target:SceneObstacle={minX:279,maxX:281,minY:16,maxY:16+height,minZ:164-length/2,maxZ:164+length/2,trafficId:2,trafficHeading:0,trafficHalfSize:{x:1,y:height/2,z:length/2},trafficVelocity:{x:0,y:0,z:0}};
 car.restore({position:{x:276.5-speed*speed/12-.5,y:16.85,z:164},heading:-Math.PI/2,speed:0});physics.syncActorObstacles([target]);car.setObstacleProvider(()=>[target]);car.setDriving(true);car.setInput({throttle:1});
 const frame=()=>{physics.syncActorObstacles([target]);car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);};return{physics,car,frame};
}
it.each([3,8,18])('records a %i m/s broadside impact against a bus without changing physical authority',async speed=>{
 const {physics,car,frame}=await setup(speed,2.65,6.4);let minimumUp=1,hit=false,maxRise=0;
 for(let i=0;i<480;i++){car.setInput({throttle:hit?0:car.viewState.speed<speed?1:0});frame();const bus=physics.trafficSnapshot()[0];if(bus){hit=true;minimumUp=Math.min(minimumUp,new Vector3(0,1,0).applyQuaternion(new Quaternion().copy(bus.rotation)).y);maxRise=Math.max(maxRise,bus.position.y-17.325);}}
 console.log('BUS_IMPACT',JSON.stringify({speed,hit,minimumUp,maxRise,car:car.snapshot(),bus:physics.trafficSnapshot()[0]}));expect(hit).toBe(true);if(speed===3)expect(minimumUp).toBeGreaterThan(.8);
});
it('promotes a navigation bus when the player is already in rigid-body mode, then preserves its physical state',async()=>{
 const {physics,car,frame}=await setup(3,2.65,6.4);
 car.restore({position:{x:276.45,y:16.85,z:164},heading:-Math.PI/2,speed:0,rigidBody:{rotation:{x:0,y:-Math.SQRT1_2,z:0,w:Math.SQRT1_2},linearVelocity:{x:3,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}});car.setDriving(true);car.setInput({throttle:0});let touched=false;
 for(let i=0;i<300;i++){frame();touched||=physics.trafficSnapshot().length>0;}
 expect(touched).toBe(true);const state=physics.trafficSnapshot()[0];expect(state.position.x).toBeGreaterThan(280);expect(new Vector3(0,1,0).applyQuaternion(new Quaternion().copy(state.rotation)).y).toBeGreaterThan(.95);
});
it('keeps the heavy bus mass distinct from a sedan and a van',()=>{
 expect(trafficMass({x:1,y:1.325,z:3.2}).mass).toBeGreaterThan(trafficMass({x:.875,y:.725,z:2.025}).mass*4);
 expect(trafficMass({x:.875,y:1.075,z:2.4}).mass).toBeGreaterThan(trafficMass({x:.875,y:.725,z:2.025}).mass);
});
it('hands a secondary crash between traffic bodies to physics instead of keeping the second bus immovable',async()=>{
 const {physics,car}=await setup(3,2.65,6.4),source:SceneObstacle={minX:276.1,maxX:277.9,minY:16,maxY:17.45,minZ:162,maxZ:166,trafficId:1,trafficKind:'sedan',trafficHalfSize:{x:.9,y:.725,z:2},trafficVelocity:{x:6,y:0,z:0},trafficHeading:0},target:SceneObstacle={minX:280,maxX:282,minY:16,maxY:18.65,minZ:160.8,maxZ:167.2,trafficId:2,trafficKind:'bus',trafficHalfSize:{x:1,y:1.325,z:3.2},trafficVelocity:{x:0,y:0,z:0},trafficHeading:0};
 car.dispose();physics.syncActorObstacles([]);physics.syncActorObstacles([source,target]);const probe=physics.createGroundVehicle({x:260,y:16.85,z:164},()=>{});dispose.push(()=>probe.dispose());probe.setActive(true);physics.update(1/60);probe.promoteImpact({x:277,y:16.85,z:164},{x:0,y:0,z:0,w:1},{x:0,y:0,z:0});
 for(let i=0;i<300;i++){physics.syncActorObstacles([source,target]);physics.update(1/60);}
 expect(physics.trafficSnapshot().map(s=>s.id).sort()).toEqual([1,2]);
});
it('separates a restored overlapping pair of overturned vehicles without launching them or retaining an embedded body',async()=>{
 const {physics,car}=await setup(3,2.65,6.4),q={x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2},zero={x:0,y:0,z:0},target:SceneObstacle={minX:279,maxX:281,minY:16,maxY:18.65,minZ:160.8,maxZ:167.2,trafficId:2,trafficKind:'bus',trafficHalfSize:{x:1,y:1.325,z:3.2},trafficHeading:0};
 car.dispose();
 // Replace the prior kinematic actor with the saved wreck on the next sync.
 physics.syncActorObstacles([]);physics.restoreTraffic([{id:2,position:{x:280,y:17.325,z:164},rotation:q,linearVelocity:zero,angularVelocity:zero}]);physics.syncActorObstacles([target]);
 const player=physics.createGroundVehicle({x:279.3,y:17.3,z:164},()=>{});dispose.push(()=>player.dispose());player.body.setRotation(q,false);player.setDynamic(true,zero);let peak=0;
 for(let i=0;i<480;i++){physics.update(1/60);const v=player.body.linvel();peak=Math.max(peak,Math.hypot(v.x,v.y,v.z));}
 const bus=physics.trafficSnapshot()[0],centre=new Vector3(0,.1125,0).applyQuaternion(new Quaternion().copy(bus.rotation)).add(bus.position),shape=new RAPIER.Cuboid(.99,1.325-.1575,3.2*.99);let penetration=0;
 for(let i=0;i<player.body.numColliders();i++){const hit=player.body.collider(i).contactShape(shape,centre,bus.rotation,0);if(hit)penetration=Math.min(penetration,hit.distance);}
 expect(penetration,JSON.stringify({bus,player:player.body.translation(),peak})).toBeGreaterThan(-.025);expect(peak).toBeLessThan(12);expect(player.body.translation().y).toBeGreaterThan(15.5);
});
