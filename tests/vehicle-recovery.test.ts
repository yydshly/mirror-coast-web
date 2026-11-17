import {afterEach,expect,it,vi} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {CollapsePhysics} from '../src/destruction/physics';
import {Helicopter} from '../src/vehicles/helicopter';
import {Bicycle} from '../src/vehicles/bicycle';
import {FlightSpace} from '../src/vehicles/return-flight';
import {findLocalRecovery,VehicleStallWatch} from '../src/vehicles/recovery';
import {obstaclesIntersect,orientedCollisionBounds,type SceneObstacle} from '../src/input/scene-collisions';
const dispose:Array<()=>void>=[];
afterEach(()=>dispose.splice(0).reverse().forEach(f=>f()));

it('bounds an unsuccessful search without inventing a destination',()=>{
  const resolve=vi.fn(()=>null);
  expect(findLocalRecovery({x:0,y:30,z:0},0,resolve,[0,2,5,9,-2])).toBeNull();
  expect(resolve.mock.calls.length).toBeLessThan(220);
});
it('offers help for sustained attempted travel, resets on progress and ignores background gaps',()=>{
  const watch=new VehicleStallWatch(),p={x:1,y:20,z:1};
  for(let i=0;i<150;i++)watch.update(1/60,p,false,true);
  expect(watch.stuck).toBe(false);
  for(let i=0;i<130;i++)watch.update(1/60,p,true,true);
  expect(watch.stuck).toBe(true);
  watch.update(1/60,{...p,x:2},true,true);expect(watch.stuck).toBe(false);
  watch.update(2,p,true,true);expect(watch.stuck).toBe(false);
});

async function aircraft(props:SceneObstacle[]){
  const scene=new Scene(),world=new VoxelWorld(),material=new MeshStandardMaterial();
  dispose.push(()=>material.dispose());
  const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});dispose.push(()=>physics.dispose());
  const heli=Helicopter.create(scene,physics,world,{onNotice:()=>{},flightObstacles:()=>props});dispose.push(()=>heli.dispose());
  heli.setObstacleProvider(()=>props);
  heli.restore({position:{x:120,y:28,z:170},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});
  const camera=new PerspectiveCamera();
  const run=(seconds:number)=>{for(let i=0;i<seconds*60;i++){heli.beforePhysics(1/60);physics.update(1/60);heli.afterPhysics(1/60,camera);}};
  return{world,heli,run};
}
it('releases an aircraft under an awning beside a facade, then permits real manual flight',async()=>{
  const props:SceneObstacle[]=[
    {minX:120,maxX:126,minY:31,maxY:32,minZ:160,maxZ:180},
    {minX:124,maxX:126,minY:15,maxY:55,minZ:150,maxZ:190},
  ];
  const{world,heli,run}=await aircraft(props);heli.setPiloting(true);heli.setInput({lift:1});run(3);
  expect(heli.position.y).toBeLessThan(30);
  expect(heli.recoverNearby()).toBe(true);
  const point=heli.position.clone(),q=heli.snapshot().rotation;
  expect(new FlightSpace(world,props,0).clear(point)).toBe(true);
  expect(Math.hypot(q.x,q.z)).toBeLessThan(.00001);expect(heli.viewState.autopilot).toBe(false);
  heli.setInput({pitch:1});run(2);expect(heli.position.distanceTo(point)).toBeGreaterThan(2);
  expect(props[0].minY).toBe(31);
});
it('keeps an enclosed aircraft and its saved pose intact when there is no safe destination',async()=>{
  const{heli}=await aircraft([{minX:100,maxX:140,minY:0,maxY:150,minZ:150,maxZ:190}]);
  const before=heli.snapshot();expect(heli.recoverNearby()).toBe(false);expect(heli.snapshot()).toEqual(before);
});
it('keeps a rescued cold-engine aircraft hovering while its rotor finishes spooling',async()=>{
  const{heli,run}=await aircraft([]);
  heli.restore({...heli.snapshot(),engineOn:false});heli.setPiloting(true);
  expect(heli.recoverNearby()).toBe(true);const height=heli.position.y;
  run(1);expect(Math.abs(heli.position.y-height)).toBeLessThan(.3);
});

function bicycle(props:SceneObstacle[]){
  const world=new VoxelWorld();for(let x=104;x<140;x++)for(let z=150;z<190;z++)world.setVoxel(x,15,z,1,false);
  const bike=new Bicycle(new Scene(),world);dispose.push(()=>bike.dispose());
  bike.restore({position:{x:120,y:16,z:170},heading:0,riding:true});bike.setRiding(true);
  bike.setObstacleProvider(()=>props);bike.setRecoveryObstacleProvider(()=>props);
  return{world,bike};
}
it('moves the bicycle and rider clear of a wall and overhead furniture, and riding continues',()=>{
  const props:SceneObstacle[]=[
    {minX:120.25,maxX:122,minY:16,maxY:20,minZ:160,maxZ:180},
    {minX:118,maxX:122,minY:17.85,maxY:18.2,minZ:168,maxZ:172},
  ];
  const{bike}=bicycle(props);expect(bike.recoverNearby()).toBe(true);
  const saved=bike.snapshot(),body=orientedCollisionBounds({x:bike.position.x,y:bike.position.y+1.2,z:bike.position.z},
    new Quaternion().setFromAxisAngle(new Vector3(0,1,0),saved.heading),{x:.4,y:1.16,z:1.1});
  expect(props.some(p=>obstaclesIntersect(body,p))).toBe(false);
  expect(bike.position.y).toBeCloseTo(16);expect(bike.viewState.speed).toBe(0);
  const p=bike.position.clone();bike.setInput(1);for(let i=0;i<90;i++)bike.update(1/60);
  expect(bike.position.distanceTo(p)).toBeGreaterThan(1);expect(props[0].minX).toBe(120.25);
});
it('does not park a bicycle in solid scenery when no valid nearby ground exists',()=>{
  const{bike}=bicycle([{minX:102,maxX:142,minY:16,maxY:22,minZ:148,maxZ:192}]);
  const saved=bike.snapshot();expect(bike.recoverNearby()).toBe(false);expect(bike.snapshot()).toEqual(saved);
});
