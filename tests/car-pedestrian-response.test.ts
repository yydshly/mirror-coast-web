import {afterEach,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Scene,Vector3} from 'three';
import {CollapsePhysics,type PedestrianImpact} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {StreetLifeSimulation,type LifeContext} from '../src/simulation/street-life-sim';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
async function setup(options:{reverse?:boolean;side?:number;slow?:boolean;dynamic?:boolean}={}){
 const world=new VoxelWorld();for(let x=60;x<180;x++)for(let z=100;z<220;z++)world.setVoxel(x,15,z,Material.Road,false);
 const sim=new StreetLifeSimulation(world,{cars:0}),person=sim.people[0];sim.people.splice(1);sim.pedestrianObstacles.splice(1);
 Object.assign(person,{a:{x:110,z:170},b:{x:140,z:170},progress:1/3,direction:1,position:{x:120+(options.side??0),y:16,z:170},heading:-Math.PI/2,wait:1000,speed:0,visible:true});
 const events:PedestrianImpact[]=[],material=new MeshStandardMaterial(),scene=new Scene();let car:CoastalCar;
 const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{},onPedestrianImpact:e=>{events.push(e);car?.pedestrianImpact();},pedestrianRecovery:(id,p)=>sim.pedestrianRecoveryPosition(id,p),onPedestrianRecovered:(id,p)=>sim.pedestrianRecovered(id,p)});cleanup.push(()=>material.dispose(),()=>physics.dispose());
 car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>car.dispose());
 const z=options.reverse?167.1:options.slow?172.9:180;
 car.restore({position:{x:120,y:16.85,z},heading:0,speed:0,...options.dynamic?{rigidBody:{rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:-14},angularVelocity:{x:0,y:0,z:0}}}:{}});
 const context=():LifeContext=>({focus:car.position,vehicle:{position:car.position,heading:car.snapshot().heading,speed:car.viewState.speed},night:0,wetness:0,obstacles:[],dynamicObstacles:physics.walkObstacles,pedestrianPhysics:physics.pedestrianSnapshot()});
 sim.update(1/30,context());car.setObstacleProvider(()=>sim.pedestrianObstacles);physics.syncActorObstacles(sim.pedestrianObstacles);car.setDriving(true);car.setInput({throttle:options.reverse?-1:options.slow?.15:1});
 const camera=new PerspectiveCamera(),phases=new Set<string>();let tipped=false;
 const step=(frames:number)=>{for(let i=0;i<frames;i++){sim.update(1/60,context());physics.syncActorObstacles(sim.pedestrianObstacles);car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);for(const p of physics.pedestrianSnapshot()){phases.add(p.phase);if(p.kind==='fall')tipped||=new Vector3(0,1,0).applyQuaternion(p.rotation).y<.7;expect(p.position.y).toBeGreaterThan(16.15);expect(Math.hypot(p.velocity.x,p.velocity.y,p.velocity.z)).toBeLessThan(32.001);}}};
 return{car,physics,sim,person,events,step,phases,tipped:()=>tipped};
}
it('lets a moving car knock a person down without treating them as a wall, then gets the person up into a continuous walk',async()=>{
 const s=await setup();s.step(200);expect(s.events).toHaveLength(1);expect(s.events[0].kind).toBe('fall');expect(s.car.position.z).toBeLessThan(167);expect(s.car.snapshot().rigidBody).toBeUndefined();expect(s.tipped(),JSON.stringify(s.physics.pedestrianSnapshot())).toBe(true);
 s.car.setInput({throttle:0,brake:true});s.step(550);expect(s.phases).toContain('rise');expect(s.physics.pedestrianSnapshot()).toHaveLength(0);expect(s.person.visible).toBe(true);
 const before={...s.person.position},returning=s.person.rejoining;s.step(60);expect(Math.hypot(s.person.position.x-before.x,s.person.position.z-before.z)).toBeGreaterThan(.25);expect(Math.hypot(s.person.position.x-before.x,s.person.position.z-before.z)).toBeLessThan(2);
 if(returning)expect(Math.abs(s.person.position.z-170)).toBeLessThan(Math.abs(before.z-170));
});
it.each([{slow:true},{reverse:true}])('responds to low-speed and reverse contact without flipping the car: %j',async options=>{
 const s=await setup(options);s.step(130);expect(s.events).toHaveLength(1);expect(s.events[0].kind).toBe('stumble');expect(s.car.snapshot().rigidBody).toBeUndefined();
 s.car.setInput({throttle:0,brake:true});s.step(480);expect(s.physics.pedestrianSnapshot()).toHaveLength(0);
});
it('does not hit a person outside the actual body while passing beside them',async()=>{
 const s=await setup({side:2.4});s.step(180);expect(s.events).toEqual([]);expect(s.car.position.z).toBeLessThan(167);expect(s.person.visible).toBe(true);
});
it('also reacts to a moving rigid-body car and keeps pedestrian bodies out of saved traffic wrecks',async()=>{
 const s=await setup({dynamic:true});s.step(150);expect(s.events).toHaveLength(1);expect(s.events[0].kind).toBe('fall');expect(s.physics.trafficSnapshot()).toEqual([]);expect(s.physics.activeCount).toBe(0);
});
it('does not get up inside a fast car\'s upcoming path between prediction samples',async()=>{
 const s=await setup();s.sim.update(0,{focus:s.car.position,night:0,wetness:0,obstacles:[],vehicle:{position:{x:120,y:16.85,z:187.5},heading:0,speed:25}});
 const target=s.sim.pedestrianRecoveryPosition(0,{x:120,y:16.88,z:170});expect(target).not.toBeNull();expect(Math.abs(target!.x-120)).toBeGreaterThan(1.4);
});
