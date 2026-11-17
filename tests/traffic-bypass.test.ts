import {expect,it} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {VoxelWorld} from '../src/world/voxel';import {Material} from '../src/world/palette';
import {StreetLifeSimulation,sampleRoute,TRAFFIC_ROUTES,SIGNALS,signalAnchor,type LifeContext} from '../src/simulation/street-life-sim';
import {trafficBoundsOverlap} from '../src/simulation/traffic-bypass';
function setup(blockOtherLane=false){
 const world=new VoxelWorld();for(let x=30;x<240;x++)for(let z=75;z<89;z++)world.setVoxel(x,15,z,z<85?Material.Road:Material.Concrete,false);
 for(const signal of SIGNALS){const p=signalAnchor(signal);world.setVoxel(p.x,15,p.z,0,false);}
 const sim=new StreetLifeSimulation(world,{cars:2,people:false}),car=sim.cars[0],wreck=sim.cars[1];car.distance=50;const initial=sampleRoute(car.route,car.distance);Object.assign(car.position,initial);car.heading=initial.heading;
 const p=sampleRoute(car.route,car.distance+19),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.heading);
 const context:LifeContext={focus:{x:100,y:18,z:82},night:0,wetness:0,obstacles:blockOtherLane?[{minX:p.x-12,maxX:p.x+15,minY:16,maxY:20,minZ:75,maxZ:81}]:[],trafficPhysics:[{id:wreck.id,position:{x:p.x,y:16+wreck.height/2,z:p.z},rotation:q,linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}]};
 return{world,sim,car,wreck,context,initial};
}
it('smoothly passes a stationary wreck on real asphalt and merges back without moving the wreck',()=>{
 const {sim,car,wreck,context,initial}=setup();let detoured=false,maxOffset=0,maxStep=0,previous={...car.position};
 for(let i=0;i<30*22;i++){sim.update(1/30,context);detoured||=!!car.bypass;maxOffset=Math.max(maxOffset,Math.abs(car.position.z-initial.z));maxStep=Math.max(maxStep,Math.hypot(car.position.x-previous.x,car.position.z-previous.z));previous={...car.position};expect(trafficBoundsOverlap(car.bounds,wreck.bounds)).toBe(false);}
 expect(detoured).toBe(true);expect(maxOffset).toBeGreaterThan(2);expect(maxStep).toBeLessThan(.23);expect(car.travelled).toBeGreaterThan(42);expect(Math.abs(car.position.z-initial.z)).toBeLessThan(.05);expect(wreck.physicsRotation).toBeDefined();
});
it('holds an approaching opposite-lane car outside the reserved passage, then releases both cars',()=>{
 const {sim,car,context}=setup(),template=car,route=TRAFFIC_ROUTES[1],targetX=car.position.x+47;
 let distance=0,best=Infinity;for(let d=0;d<route.length;d+=.25){const p=sampleRoute(route,d),error=Math.hypot(p.x-targetX,p.z-78);if(error<best){best=error;distance=d;}}
 const p=sampleRoute(route,distance),opponent={...template,id:2,route,distance,position:{x:p.x,y:16,z:p.z},heading:p.heading,speed:5,travelled:0,bounds:{...template.bounds},bypass:undefined};sim.cars.push(opponent);sim.obstacles.push(opponent.bounds);
 let bypass=false,waiting=false;for(let i=0;i<30*30;i++){sim.update(1/30,context);bypass||=!!car.bypass;waiting||=opponent.waiting;expect(trafficBoundsOverlap(car.bounds,opponent.bounds)).toBe(false);}
 expect(bypass).toBe(true);expect(waiting).toBe(true);expect(car.travelled).toBeGreaterThan(45);expect(opponent.travelled).toBeGreaterThan(25);
});
it('waits when the usable lane is blocked and does not bypass over concrete sidewalk',()=>{
 const {sim,car,context}=setup(true);for(let i=0;i<30*18;i++)sim.update(1/30,context);
 expect(car.bypass).toBeUndefined();expect(car.travelled).toBeLessThan(18);expect(car.speed).toBe(0);expect(car.position.z).toBeCloseTo(82);
});
it('rejects a bypass over a freshly excavated opposite lane before meshes catch up',()=>{
 const {world,sim,car,context}=setup();for(let x=75;x<130;x++)for(let z=75;z<81;z++)world.setVoxel(x,15,z,0,false);
 for(let i=0;i<30*18;i++)sim.update(1/30,context);expect(car.bypass).toBeUndefined();expect(car.travelled).toBeLessThan(18);expect(car.speed).toBe(0);
});
