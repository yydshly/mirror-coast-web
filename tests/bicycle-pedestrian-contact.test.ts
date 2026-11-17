import {describe,it,expect} from 'vitest';
import {Scene,Quaternion} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {Bicycle} from '../src/vehicles/bicycle';
import {orientedCollisionBounds,type SceneObstacle} from '../src/input/scene-collisions';
import {StreetLifeSimulation} from '../src/simulation/street-life-sim';
function flat(){const w=new VoxelWorld();for(let x=100;x<150;x++)for(let z=150;z<190;z++)w.setVoxel(x,15,z,1,false);return w;}
function bike(){const b=new Bicycle(new Scene(),flat());b.restore({position:{x:120,y:16,z:170},heading:0,riding:true});b.setRiding(true);return b;}
function advance(b:Bicycle,n:number){for(let i=0;i<n;i++){b.update(1/60);expect(b.motor.recoveredLastStep).toBe(false);}}
describe('a cyclist and pedestrian must be able to separate',()=>{
 it.each([1,-1])('slides out of an existing side contact using throttle %s without moving the pedestrian or teleporting the bicycle',throttle=>{
  const b=bike(),ped:SceneObstacle={minX:120.27,maxX:120.82,minY:16,maxY:17.76,minZ:169.725,maxZ:170.275,standable:false,pedestrianId:1};b.setObstacleProvider(()=>[ped]);b.setInput(throttle);advance(b,150);expect(Math.abs(b.position.z-170)).toBeGreaterThan(.8);expect(ped.minX).toBe(120.27);expect(b.position.y).toBeCloseTo(16);b.dispose();
 });
 it('blocks motion deeper into a person but allows backing out of the same contact',()=>{
  const b=bike(),ped:SceneObstacle={minX:119.725,maxX:120.275,minY:16,maxY:17.76,minZ:168.525,maxZ:169.075,standable:false,pedestrianId:2};b.setObstacleProvider(()=>[ped]);b.setInput(1);advance(b,100);expect(b.position.z).toBeCloseTo(170,3);expect(b.viewState.blocked).toContain('行人');b.setInput(-1);advance(b,120);expect(b.position.z).toBeGreaterThan(171);b.dispose();
 });
 it('still stops before a new pedestrian and keeps static props solid',()=>{
  const b=bike();b.setObstacleProvider(()=>[{minX:119.725,maxX:120.275,minY:16,maxY:17.76,minZ:166.225,maxZ:166.775,standable:false,pedestrianId:3}]);b.setInput(1);advance(b,240);expect(b.position.z).toBeGreaterThan(167.7);b.dispose();
  const post=bike();post.setObstacleProvider(()=>[{minX:119.725,maxX:120.275,minY:16,maxY:18,minZ:166.225,maxZ:166.775,standable:false}]);post.setInput(1);advance(post,240);expect(post.position.z).toBeGreaterThan(167.7);expect(post.viewState.blocked).toContain('受阻');post.dispose();
 });
 it('lets a pedestrian walk away from an overlapping bicycle, while blocking the direction into it',()=>{
  const w=flat(),sim=new StreetLifeSimulation(w,{cars:0}),p=sim.people[0];sim.people.splice(1);Object.assign(p,{a:{x:118,z:170},b:{x:122,z:170},progress:.5,direction:-1,position:{x:120,y:16,z:170},wait:0,crossing:false,committed:false,retreating:false,blockedFor:0});
  const obstacle=orientedCollisionBounds({x:119.6,y:16.96,z:170},new Quaternion(),{x:.34,y:.93,z:1.02});obstacle.bicycle=true;obstacle.standable=false;
  const context={focus:p.position,player:{position:{x:119.6,y:16,z:170},radius:.55},night:0,wetness:0,obstacles:[],dynamicObstacles:[obstacle]};
  for(let i=0;i<25;i++)sim.update(1/30,context);expect(p.position.x).toBeCloseTo(120,3);p.direction=1;
  for(let i=0;i<30;i++)sim.update(1/30,context);expect(p.position.x).toBeGreaterThan(120.6);expect(p.position.y).toBe(16);
 });
});
