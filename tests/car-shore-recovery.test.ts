import {afterEach,beforeAll,expect,it} from 'vitest';
import {DoubleSide,FogExp2,MeshStandardMaterial,PerspectiveCamera,Scene} from 'three';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {CollapsePhysics} from '../src/destruction/physics';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {Environment} from '../src/rendering/environment';
import {Sky} from 'three/addons/objects/Sky.js';
import {carFeedback} from '../src/vehicles/vehicle-feedback';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
function sand(floor=12){const world=new VoxelWorld();for(let x=100;x<180;x++)for(let z=130;z<210;z++)for(let y=0;y<floor;y++)world.setVoxel(x,y,z,Material.Sand,false);return world;}
async function carAt(world:VoxelWorld,position={x:140,y:12.85,z:180}){
 const scene=new Scene(),m=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,m,{onStateChange:()=>{}});cleanup.push(()=>m.dispose(),()=>physics.dispose());
 const car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>car.dispose());car.restore({position,heading:0,speed:0});car.setDriving(true);const camera=new PerspectiveCamera();
 const step=(n:number)=>{for(let i=0;i<n;i++){car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);}};return{car,step,camera};
}
it('drives across flat sand at the waterline instead of inventing a step',async()=>{
 const {car,step}=await carAt(sand());car.setInput({throttle:1});step(120);expect(car.position.z,JSON.stringify(car.viewState)).toBeLessThan(176);expect(car.viewState.blocked).toBe(false);expect(car.position.y).toBeCloseTo(12.85,3);
});
it('stops before genuinely deep water, identifies water, and allows reversing back onto the beach',async()=>{
 const world=sand();for(let x=100;x<180;x++)for(let z=130;z<165;z++)world.setVoxel(x,11,z,0,false);
 const {car,step}=await carAt(world);car.setInput({throttle:1});step(200);const edge=car.position.z;
 expect(edge).toBeGreaterThan(166);expect(car.viewState.blockage).toBe('water');expect(carFeedback(car.viewState).status).toContain('深水');car.setInput({throttle:-1});step(120);expect(car.position.z).toBeGreaterThan(edge+2);
});
let region:VoxelWorld;beforeAll(()=>{region=generateWorld().world;addRegionalTerrain(region);});
it('rescues a real South Bay seabed save beyond the old road radius, then permits driving',async()=>{
 const source={x:700,y:regionalHeightAt(700,240)+1.85,z:240},{car,step}=await carAt(region,source);car.setInput({throttle:1});step(60);
 expect(car.viewState.blockage).toBe('water');expect(carFeedback(car.viewState).status).toContain('G');expect(car.recoverToRoad()).toBe(false);
 expect(car.recoverNearby()).toBe(true);const rescued=car.position.clone();expect(rescued.y-.85).toBeGreaterThanOrEqual(12);expect(rescued.distanceTo(source)).toBeGreaterThan(80);
 car.setInput({throttle:1});step(100);expect(car.position.distanceTo(rescued)).toBeGreaterThan(2);expect(car.viewState.blocked).toBe(false);
},20000);
it('can recover on stable open sand without demanding a paved road',async()=>{
 const {car,step}=await carAt(sand(13),{x:140,y:13.85,z:180});expect(car.recoverToRoad()).toBe(false);expect(car.recoverNearby()).toBe(true);car.setInput({throttle:1});step(100);expect(car.position.z).toBeLessThan(177);
});
it('keeps a submerged car in place if no safe shore or actual road exists',async()=>{
 const {car}=await carAt(sand(7),{x:140,y:7.85,z:180}),before=car.snapshot();expect(car.recoverNearby()).toBe(false);expect(car.snapshot()).toEqual(before);
});
it('shows the underside of the sea and underwater atmosphere, then restores the air view',()=>{
 const scene=new Scene(),environment=new Environment(scene);cleanup.push(()=>environment.dispose());const water=scene.getObjectByName('coastal-water-surface')! as any;
 expect(water.material.side).toBe(DoubleSide);const above=(scene.fog as FogExp2).density;
 environment.setCameraPosition({y:8});expect(environment.isUnderwater).toBe(true);expect((scene.fog as FogExp2).density).toBeGreaterThan(.02);expect(scene.children.find(child=>child instanceof Sky)!.visible).toBe(false);
 environment.setCameraPosition({y:20});expect(environment.isUnderwater).toBe(false);expect((scene.fog as FogExp2).density).toBeCloseTo(above,6);
});
