import {afterEach,describe,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Scene,Vector3} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {CAR_FORWARD_SPEED} from '../src/vehicles/driving-tuning';

const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).reverse().forEach(dispose=>dispose()));
async function setup(){
  const world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256});
  for(let x=200;x<720;x++)for(let z=148;z<182;z++)world.setVoxel(x,15,z,Material.Road);
  const scene=new Scene(),material=new MeshStandardMaterial(),camera=new PerspectiveCamera(58,16/9,.1,1500);
  cleanup.push(()=>material.dispose());
  const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});cleanup.push(()=>physics.dispose());
  const car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>car.dispose());
  const root=scene.getObjectByName('coastal-road-car')!;
  const frame=(dt:number)=>{car.beforePhysics(dt);physics.update(dt);car.afterPhysics(dt,camera);};
  car.setDriving(true);car.setInput({throttle:1});
  for(let i=0;i<300;i++)frame(1/60);
  return{car,physics,root,camera,frame,world};
}

describe('car motion at display rates different from the physics clock',()=>{
  it.each([90,100,120,144])('renders continuous cruise at %i Hz while the save follows authoritative physics',async(hz)=>{
    const {car,root,camera,frame}=await setup();
    const velocities:number[]=[],relative=new Vector3(),previousProjection=new Vector3();let repeatedPhysics=0,maxScreenJump=0;
    for(let i=0;i<hz*2;i++){
      const rendered=root.position.x,physical=car.position.x;
      frame(1/hz);
      if(i<3)continue;
      velocities.push((root.position.x-rendered)*hz);
      expect(root.quaternion.toArray().every(Number.isFinite)).toBe(true);
      if(Math.abs(car.position.x-physical)<.00001)repeatedPhysics++;
      expect(car.snapshot().position.x).toBe(car.position.x);
      expect(root.position.x).toBeLessThanOrEqual(car.position.x+.0001);
      expect(car.position.x-root.position.x).toBeLessThan(CAR_FORWARD_SPEED/60+.015);
      camera.updateMatrixWorld();relative.copy(root.position).project(camera);
      if(i>4)maxScreenJump=Math.max(maxScreenJump,relative.distanceTo(previousProjection));
      previousProjection.copy(relative);
    }
    expect(repeatedPhysics).toBeGreaterThan(0);
    expect(Math.min(...velocities)).toBeGreaterThan(CAR_FORWARD_SPEED-.2);
    expect(Math.max(...velocities)).toBeLessThan(CAR_FORWARD_SPEED+.2);
    expect(maxScreenJump).toBeLessThan(.01);
  });
  it('keeps render speed continuous through frames with zero, one and several physics steps',async()=>{
    const {root,frame}=await setup();const pattern=[1/144,1/144,1/20,1/100,1/90,1/120];
    for(let i=0;i<180;i++){
      const dt=pattern[i%pattern.length],before=root.position.x;frame(dt);
      if(i>5)expect((root.position.x-before)/dt).toBeCloseTo(CAR_FORWARD_SPEED,1);
    }
  });
  it('resets visual history on restore and never coasts through a physical wall after stopping',async()=>{
    const {car,root,frame,world}=await setup();
    car.restore({position:{x:400,y:16.85,z:164},heading:-Math.PI/2,speed:0});
    frame(1/144);expect(root.position.x).toBeCloseTo(400,5);
    for(let z=148;z<182;z++)for(let y=16;y<21;y++)world.setVoxel(412,y,z,Material.Brick);
    car.setDriving(true);car.setInput({throttle:1});
    for(let i=0;i<600;i++){frame(1/144);expect(root.position.x).toBeLessThan(410);}
    expect(car.viewState.blocked).toBe(true);
    expect(root.position.x).toBeCloseTo(car.snapshot().position.x,4);
  });
  it('turns continuously across the heading wrap without a long camera rotation',async()=>{
    const {car,root,camera,frame}=await setup();
    car.restore({position:{x:400,y:16.85,z:164},heading:Math.PI-.03,speed:0});
    car.setDriving(true);car.setInput({throttle:1,steer:1});let wrapped=false;
    for(let i=0;i<144;i++){
      const heading=car.snapshot().heading,rotation=root.quaternion.clone(),cam=camera.position.clone();frame(1/144);
      if(Math.abs(car.snapshot().heading-heading)>6)wrapped=true;
      expect(root.quaternion.toArray().every(Number.isFinite)).toBe(true);
      expect(root.quaternion.angleTo(rotation)).toBeLessThan(.03);
      if(i>0)expect(camera.position.distanceTo(cam)).toBeLessThan(.2);
    }
    expect(wrapped).toBe(true);
  });
});
