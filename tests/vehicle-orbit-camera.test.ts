import { afterEach, describe, expect, it } from 'vitest';
import { MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { CollapsePhysics } from '../src/destruction/physics';
import { CoastalCar } from '../src/vehicles/coastal-car';
import { Helicopter } from '../src/vehicles/helicopter';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';
import { cameraSphereClear } from '../src/input/walk-camera';

const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(dispose=>dispose()));
async function setup(kind:'car'|'helicopter',wall=false){
  const world=new VoxelWorld({minX:0,maxX:512,minZ:0,maxZ:256});
  for(let z=140;z<240;z++)for(let x=80;x<300;x++)world.setVoxel(x,15,z,Material.Road);
  if(wall){
    if(kind==='car')for(let z=152;z<=178;z++)for(let y=16;y<30;y++)world.setVoxel(243,y,z,Material.Brick);
    else for(let x=85;x<140;x++)for(let y=35;y<60;y++)world.setVoxel(x,y,218,Material.Brick);
  }
  const scene=new Scene(),material=new MeshStandardMaterial();cleanup.push(()=>material.dispose());
  const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});cleanup.push(()=>physics.dispose());
  const camera=new PerspectiveCamera(58,16/9,.15,2000);
  const vehicle=kind==='car'?CoastalCar.create(scene,physics,world,{onNotice:()=>{}}):Helicopter.create(scene,physics,world,{onNotice:()=>{}});
  cleanup.push(()=>vehicle.dispose());
  if(vehicle instanceof CoastalCar)vehicle.setDriving(true);
  else{vehicle.restore({position:{x:110,y:40,z:210},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});vehicle.setPiloting(true);}
  const simulate=(seconds:number,verify?:()=>void)=>{
    for(let i=0;i<seconds*60;i++){vehicle.beforePhysics(1/60);physics.update(1/60);vehicle.afterPhysics(1/60,camera);verify?.();}
  };
  return {world,camera,vehicle,simulate};
}

describe('actual car and aircraft orbit cameras',()=>{
  it('avoids a live traffic/prop box without requiring a Rapier body and extends after it leaves',async()=>{
    const {camera,vehicle,simulate}=await setup('car');
    vehicle.setObstacleProvider(()=>[{minX:242,maxX:244,minY:16,maxY:22,minZ:159,maxZ:169}]);
    simulate(.5);expect(camera.position.x).toBeGreaterThan(244.25);
    vehicle.setObstacleProvider(()=>[]);simulate(2);expect(camera.position.x).toBeLessThan(241);
  });
  it.each(['car','helicopter'] as const)('orbits the %s while its physical heading and position stay unchanged',async kind=>{
    const {vehicle,camera,simulate}=await setup(kind);simulate(.3);
    const pose=vehicle.snapshot(),original=camera.position.clone();
    vehicle.orbitBy(240,90);vehicle.zoomBy(180);simulate(1.5);
    expect(camera.position.distanceTo(original)).toBeGreaterThan(4);
    const current=vehicle.snapshot();
    expect(new Vector3().copy(current.position).distanceTo(pose.position)).toBeLessThan(.02);
    if('heading' in current && 'heading' in pose)expect(current.heading).toBe(pose.heading);
    else if('rotation' in current && 'rotation' in pose)expect(current.rotation).toEqual(pose.rotation);
    vehicle.resetLook();simulate(2);expect(camera.position.distanceTo(original)).toBeLessThan(.08);
  });

  it.each(['car','helicopter'] as const)('protects the %s camera volume from authoritative walls before any collider upload',async kind=>{
    const {world,camera,vehicle,simulate}=await setup(kind,true);
    simulate(.5,()=>expect(cameraSphereClear(world,camera.position,[],.18)).toBe(true));
    if(kind==='car')expect(camera.position.x).toBeGreaterThan(244.18);
    else expect(camera.position.z).toBeLessThan(217.82);
    for(let turn=0;turn<6;turn++){
      vehicle.orbitBy(180,turn%2?50:-50);
      simulate(.3,()=>expect(cameraSphereClear(world,camera.position,[],.18)).toBe(true));
    }
  });
});
