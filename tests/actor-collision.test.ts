import {afterEach,describe,expect,it} from 'vitest';
import {MeshStandardMaterial,Scene} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
async function setup(){
  const material=new MeshStandardMaterial();cleanup.push(()=>material.dispose());
  const physics=await CollapsePhysics.create(new Scene(),material,{onStateChange:()=>{}});cleanup.push(()=>physics.dispose());
  const car=physics.createGroundVehicle({x:30,y:16.85,z:30},()=>{});cleanup.push(()=>car.dispose());car.setActive(true);
  return {physics,car,step:()=>physics.update(1/60),rotation:{x:0,y:0,z:0,w:1}};
}
describe('shared traffic and pedestrian collision',()=>{
  it('blocks a managed vehicle without consuming rubble budget or making AI see its own collider',async()=>{
    const {physics,car,step,rotation}=await setup();
    physics.syncActorObstacles([{minX:19,maxX:21,minY:16,maxY:18,minZ:18,maxZ:22,standable:false}]);step();
    expect(car.canOccupy({x:20,y:16.85,z:20},rotation)).toBe(false);
    expect(physics.activeCount).toBe(0);expect(physics.walkObstacles).toHaveLength(3);
  });
  it('moves or disables a live actor without leaving its old invisible wall',async()=>{
    const {physics,car,step,rotation}=await setup();
    physics.syncActorObstacles([{minX:19,maxX:21,minY:16,maxY:18,minZ:18,maxZ:22}]);step();
    physics.syncActorObstacles([{minX:39,maxX:41,minY:16,maxY:18,minZ:18,maxZ:22}]);step();
    expect(car.canOccupy({x:20,y:16.85,z:20},rotation)).toBe(true);
    expect(car.canOccupy({x:40,y:16.85,z:20},rotation)).toBe(false);
    physics.syncActorObstacles([{minX:0,maxX:0,minY:0,maxY:-1,minZ:0,maxZ:0}]);step();
    expect(car.canOccupy({x:40,y:16.85,z:20},rotation)).toBe(true);
    physics.syncActorObstacles([]);step();expect(physics.activeCount).toBe(0);
  });
});
