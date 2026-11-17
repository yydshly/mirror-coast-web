import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Scene,Vector3} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';

const disposals:Array<()=>void>=[];
let regional:VoxelWorld;
beforeAll(()=>{const generated=generateWorld();regional=generated.world;addHarborQuarter(regional,generated.buildings);addRegionalTerrain(regional);addRegionalDistricts(regional,generated.buildings);});
afterEach(()=>disposals.splice(0).reverse().forEach(dispose=>dispose()));
async function setup(world:VoxelWorld){
  const scene=new Scene(),material=new MeshStandardMaterial();disposals.push(()=>material.dispose());
  const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});disposals.push(()=>physics.dispose());
  const car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});disposals.push(()=>car.dispose());
  const camera=new PerspectiveCamera(58,1,.1,1500);
  const simulate=(seconds:number)=>{for(let n=0;n<seconds*60;n++){car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);}};
  return {scene,physics,car,simulate};
}
const trapped={position:{x:518.302,y:16.85,z:162.756},heading:-1.418,speed:0};

describe('explicit nearby-road rescue',()=>{
  it('moves the actual old slope-trapped pose to supported road and permits driving again',async()=>{
    const {car,simulate}=await setup(regional);car.restore(trapped);car.setDriving(true);
    const before=car.snapshot();expect(car.recoverToRoad()).toBe(true);
    const rescued=car.snapshot();
    expect(new Vector3().copy(rescued.position).distanceTo(before.position)).toBeLessThan(25);
    expect(rescued.position.z).toBeGreaterThan(169);
    expect(rescued.heading).toBeCloseTo(-Math.PI/2,4);
    expect(car.viewState.driving).toBe(true);expect(car.viewState.speed).toBe(0);
    expect([Material.Road,Material.Stripe]).toContain(regional.getVoxel(Math.floor(rescued.position.x),Math.round(rescued.position.y-.85)-1,Math.floor(rescued.position.z)));
    car.setInput({throttle:1});simulate(1.5);
    expect(car.position.x).toBeGreaterThan(rescued.position.x+5);expect(car.viewState.blocked).toBe(false);
  });

  it('skips global prop-blocked road and a real parked actor at the next alternative',async()=>{
    const {car,physics,scene}=await setup(regional);car.restore(trapped);car.setDriving(true);
    const blocker=CoastalCar.create(scene,physics,regional,{onNotice:()=>{}});disposals.push(()=>blocker.dispose());
    blocker.restore({position:{x:518.5,y:16.85,z:145.5},heading:-Math.PI/2,speed:0});
    car.setRecoveryObstacleProvider(()=>[{minX:470,maxX:550,minY:13,maxY:30,minZ:165,maxZ:185}]);
    expect(car.recoverToRoad()).toBe(true);
    expect(car.position.z).toBeLessThan(165);
    const pose=car.snapshot(),dx=pose.position.x-blocker.position.x,dz=pose.position.z-blocker.position.z;
    expect(Math.abs(dx)>=4.26||Math.abs(dz)>=1.94).toBe(true);
    expect(car.viewState.driving).toBe(true);
  });

  it('does not engage a parked vehicle when explicitly rescued',async()=>{
    const {car,simulate}=await setup(regional);car.restore(trapped);
    expect(car.recoverToRoad()).toBe(true);const pose=car.snapshot();simulate(1);
    expect(car.viewState.driving).toBe(false);expect(car.snapshot()).toEqual(pose);
  });

  it('keeps pose and mode unchanged when no actual road exists',async()=>{
    const world=new VoxelWorld({minX:0,maxX:512,minZ:0,maxZ:256});
    for(let z=100;z<230;z++)for(let x=160;x<340;x++)world.setVoxel(x,15,z,Material.Grass);
    const {car}=await setup(world);car.setDriving(true);const before=car.snapshot();
    expect(car.recoverToRoad()).toBe(false);expect(car.snapshot()).toEqual(before);expect(car.viewState.driving).toBe(true);
  });

  it('brakes an off-road vehicle in place when the explicit rescue cannot find any road',async()=>{
    const world=new VoxelWorld({minX:0,maxX:512,minZ:0,maxZ:256});
    for(let z=100;z<230;z++)for(let x=160;x<340;x++)world.setVoxel(x,15,z,Material.Grass);
    const {car,simulate}=await setup(world);car.setDriving(true);car.setInput({throttle:1});simulate(1);
    expect(car.viewState.speed).toBeGreaterThan(3);const position=car.position.clone(),heading=car.snapshot().heading;
    expect(car.recoverToRoad()).toBe(false);simulate(.5);
    expect(car.position).toEqual(position);expect(car.snapshot().heading).toBe(heading);expect(car.viewState.speed).toBe(0);expect(car.viewState.driving).toBe(true);
  });

  it('does not teleport to road farther than the eighty-metre rescue radius',async()=>{
    const world=new VoxelWorld({minX:0,maxX:512,minZ:0,maxZ:256});
    for(let z=150;z<179;z++)for(let x=340;x<390;x++)world.setVoxel(x,15,z,Material.Road);
    const {car}=await setup(world);const before=car.snapshot();
    expect(car.recoverToRoad()).toBe(false);expect(car.snapshot()).toEqual(before);
  });
});
