import {describe,it,expect} from 'vitest';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {StreetLifeSimulation,sampleRoute,TRAFFIC_ROUTES,type LifeContext,type LifeCar} from '../src/simulation/street-life-sim';
import {obstaclesIntersect} from '../src/input/scene-collisions';

const context:LifeContext={focus:{x:222,y:17,z:164},night:0,wetness:0,obstacles:[]};
function fixture(){const world=new VoxelWorld();for(let x=25;x<240;x++)for(let z=70;z<175;z++)world.setVoxel(x,15,z,Material.Road,false);return{world,sim:new StreetLifeSimulation(world,{cars:2,people:false})};}
function place(car:LifeCar,route:number,x:number,z:number){car.route=TRAFFIC_ROUTES[route];let best=Infinity;for(let d=0;d<car.route.length;d+=.1){const p=sampleRoute(car.route,d),error=Math.hypot(p.x-x,p.z-z);if(error<best){best=error;car.distance=d;}}const p=sampleRoute(car.route,car.distance);Object.assign(car.position,p);car.heading=p.heading;car.speed=0;car.travelled=0;}
describe('junction traffic admission',()=>{
 it('keeps both opposing straight lanes moving together during the same green window',()=>{
  const {sim}=fixture(),[west,east]=sim.cars;place(west,0,152,162);place(east,1,108,166);west.speed=east.speed=6;
  for(let i=0;i<30*4;i++){sim.update(1/30,context);expect(obstaclesIntersect(west.bounds,east.bounds)).toBe(false);}
  expect(west.travelled).toBeGreaterThan(20);expect(east.travelled).toBeGreaterThan(20);expect(Math.min(west.speed,east.speed)).toBeGreaterThan(5);
 });
 it('restarts the complete queue after the blocked exit clears, without overlap or moving any car to a new lane',()=>{
  const {sim}=fixture(),[head,turning]=sim.cars;place(head,0,220,143);place(turning,1,206,166);
  const followers=[132,121].map((z,i)=>{const car={...head,id:i+2,position:{...head.position},bounds:{...head.bounds}};place(car,0,220,z);sim.cars.push(car);sim.obstacles.push(car.bounds);return car;});
  const hold={...context,player:{position:{x:207,y:16,z:162},radius:1.2}};
  for(let i=0;i<30*18;i++)sim.update(1/30,hold);const before=[head,...followers].map(c=>c.travelled);
  for(let i=0;i<30*22;i++){sim.update(1/30,context);for(const a of sim.cars)for(const b of sim.cars)if(a.id<b.id)expect(obstaclesIntersect(a.bounds,b.bounds)).toBe(false);}
  [head,...followers].forEach((car,i)=>expect(car.travelled-before[i]).toBeGreaterThan(25));
 });
 it('keeps a blocked departure out of the waterfront box and lets the other turn clear, then releases the waiting car',()=>{
  const {sim}=fixture(),[blocked,turning]=sim.cars;place(blocked,0,220,145);place(turning,1,206,166);
  const hold={...context,player:{position:{x:207,y:16,z:162},radius:1.2}};
  for(let i=0;i<30*16;i++){sim.update(1/30,hold);expect(obstaclesIntersect(blocked.bounds,turning.bounds)).toBe(false);}
  expect(turning.travelled).toBeGreaterThan(35);expect(blocked.position.z).toBeLessThan(156);const start=blocked.travelled;
  for(let i=0;i<30*12;i++)sim.update(1/30,context);expect(blocked.travelled-start).toBeGreaterThan(30);
 });
 it('maintains an evenly advancing visual pose between 30 Hz steps without delaying the collision body',()=>{
  const {sim}=fixture(),car=sim.cars[0];sim.cars.splice(1);place(car,0,100,82);car.speed=4;
  const poses:number[]=[],physical:number[]=[];for(let i=0;i<30;i++){sim.update(1/60,context);poses.push(sim.renderCar(car).x);physical.push(car.position.x);}
  const deltas=poses.slice(5).map((p,i)=>p-poses[i+4]);expect(deltas.every(d=>d>.02&&d<.13)).toBe(true);
  expect(physical.some((p,i)=>i>3&&p===physical[i-1])).toBe(true);expect(poses.every((p,i)=>p<=physical[i]+1e-8)).toBe(true);
 });
 it('immediately refreshes cached road clearance after a hole or a new blocking voxel is edited',()=>{
  const {world,sim}=fixture(),p={x:100,z:82};expect(sim.roadClear(p,-Math.PI/2,1.75,4.05,1.45)).toBe(true);
  world.applyEdits([{x:100,y:15,z:82,material:0}]);expect(sim.roadClear(p,-Math.PI/2,1.75,4.05,1.45)).toBe(false);
  world.applyEdits([{x:100,y:15,z:82,material:Material.Road},{x:100,y:16,z:82,material:Material.Wood}]);expect(sim.roadClear(p,-Math.PI/2,1.75,4.05,1.45)).toBe(false);
  world.applyEdits([{x:100,y:16,z:82,material:0}]);expect(sim.roadClear(p,-Math.PI/2,1.75,4.05,1.45)).toBe(true);
 });
});
