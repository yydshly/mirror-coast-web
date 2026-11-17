import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Scene} from 'three';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {CollapsePhysics} from '../src/destruction/physics';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
function road(){const w=new VoxelWorld();for(let x=220;x<256;x++)for(let z=145;z<185;z++)for(let y=0;y<=15;y++)w.setVoxel(x,y,z,y===15?Material.Road:Material.Rock);return w;}
async function setup(world:VoxelWorld){
 const scene=new Scene(),material=new MeshStandardMaterial(),camera=new PerspectiveCamera();cleanup.push(()=>material.dispose());
 const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});cleanup.push(()=>physics.dispose());
 const notices:string[]=[],car=CoastalCar.create(scene,physics,world,{onNotice:m=>notices.push(m)});cleanup.push(()=>car.dispose());
 const frame=()=>{car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);};
 return{car,physics,frame,notices,simulate:(seconds:number)=>{for(let i=0;i<seconds*60;i++)frame();}};
}
describe('driveability at walls and graded roads',()=>{
 it('lets a car accelerate after engaging an old save whose rear is embedded in a wall',async()=>{
  const world=road();for(let y=16;y<26;y++)for(let z=154;z<175;z++)world.setVoxel(235,y,z,Material.Cream);
  const {car,simulate}=await setup(world);car.restore({position:{x:237.8,y:16.85,z:164},heading:-Math.PI/2,speed:0});car.setDriving(true);
  const engaged=car.position.clone();car.setInput({throttle:1});simulate(1.4);
  expect(car.position.distanceTo(engaged),JSON.stringify(car.snapshot())).toBeGreaterThan(3);expect(car.viewState.blocked).toBe(false);
 });
 it('can pull backwards away from a real impact instead of endlessly requesting reverse',async()=>{
  const world=road();for(let y=16;y<26;y++)for(let z=145;z<185;z++)world.setVoxel(249,y,z,Material.Cream);
  const {car,simulate}=await setup(world);car.restore({position:{x:235,y:16.85,z:164},heading:-Math.PI/2,speed:0});car.setDriving(true);car.setInput({throttle:1});simulate(4);
  car.setInput({brake:true});simulate(2);
  const contact=car.position.clone();car.setInput({throttle:-1});simulate(3);
  expect(car.position.x,JSON.stringify(car.snapshot())).toBeLessThan(contact.x-1);expect(car.viewState.speed).toBeLessThan(-.3);
 });
});

let world:VoxelWorld,transitions:WalkTransitions;
beforeAll(()=>{const generated=generateWorld();world=generated.world;addHarborQuarter(world,generated.buildings);addRegionalTerrain(world);addRegionalDistricts(world,generated.buildings);transitions=new WalkTransitions(new Scene(),world);});
describe('the real west-village road steps',()=>{
 it('lets a walker climb the visible west-village approach without jumping or recovery',()=>{
  const walker=new VoxelWalker(world,{x:-82,y:regionalHeightAt(-82,95)+1,z:95});walker.setObstacleProvider(()=>transitions.nearby(walker.position));let recovered=false;
  for(let i=0;i<60*16;i++){walker.update(1/60,{x:-.9578,z:-.2873});recovered||=walker.recoveredLastStep;}
  expect(walker.position.x,JSON.stringify(walker.position)).toBeLessThan(-120);expect(walker.position.y).toBeGreaterThan(25);expect(recovered).toBe(false);
 });
 it('lets a car climb the actual graded approach and drive back down it',async()=>{
  const {car,frame}=await setup(world);car.setSurfaceProvider((x,z,max)=>transitions.heightAt(x,z,max));car.setObstacleProvider(()=>transitions.nearby(car.position));
  const heading=Math.atan2(.9578,.2873);car.restore({position:{x:-82,y:regionalHeightAt(-82,95)+1.85,z:95},heading,speed:0});car.setDriving(true);
  for(let i=0;i<60*20;i++){car.setInput({throttle:car.viewState.speed<4?.7:0,brake:car.viewState.speed>5});frame();if(car.position.x<-128)break;}
  expect(car.position.x,JSON.stringify(car.snapshot())).toBeLessThan(-120);const top=car.position.clone();car.setInput({throttle:-1});for(let i=0;i<60*6;i++)frame();
  expect(car.position.x,JSON.stringify(car.snapshot())).toBeGreaterThan(top.x+8);
 });
});
