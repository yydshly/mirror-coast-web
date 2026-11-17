import { afterEach, describe, expect, it } from 'vitest';
import { Box3,Group,MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { CollapsePhysics } from '../src/destruction/physics';
import { CoastalCar } from '../src/vehicles/coastal-car';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()));

function road(): VoxelWorld {
  const world = new VoxelWorld({ minX: -64, maxX: 768, minZ: 0, maxZ: 256 });
  for (let z = 150; z <= 179; z++) for (let x = -40; x <= 730; x++) world.setVoxel(x, 15, z, Material.Road);
  return world;
}

async function setup(world = road()) {
  const scene = new Scene(), material = new MeshStandardMaterial(); cleanup.push(() => material.dispose());
  const physics = await CollapsePhysics.create(scene, material, { onStateChange: () => {} }); cleanup.push(() => physics.dispose());
  const car = CoastalCar.create(scene, physics, world, { onNotice: () => {} }); cleanup.push(() => car.dispose());
  const camera = new PerspectiveCamera(58, 16 / 9, .1, 1500);
  const simulate = (seconds: number) => {
    for (let frame = 0; frame < seconds * 60; frame++) { car.beforePhysics(1 / 60); physics.update(1 / 60); car.afterPhysics(1 / 60, camera); }
  };
  return { car, physics, scene, camera, simulate };
}

describe('connected coastal road driving', () => {
  it('shows independent blinking turn signals, reverse lamps and automatic turn cancellation',async()=>{
    const {car,scene,simulate}=await setup();car.setDriving(true);car.toggleSignal('left');simulate(.1);
    const left=scene.getObjectByName('car-left-rear-indicator') as import('three').Mesh,right=scene.getObjectByName('car-right-rear-indicator') as import('three').Mesh;
    const intensity=(mesh:import('three').Mesh)=>(mesh.material as MeshStandardMaterial).emissiveIntensity;
    expect(intensity(left)).toBeGreaterThan(3);expect(intensity(right)).toBeLessThan(.1);simulate(.5);expect(intensity(left)).toBeLessThan(.1);
    car.toggleSignal('hazard');simulate(.1);expect(intensity(left)).toBeGreaterThan(3);expect(intensity(right)).toBeGreaterThan(3);
    car.toggleSignal('hazard');car.setInput({throttle:-1});simulate(.8);expect(intensity(scene.getObjectByName('car-reverse-light') as import('three').Mesh)).toBeGreaterThan(2);
    car.setInput({brake:true});simulate(.6);car.setInput({throttle:1,steer:1});simulate(.8);expect(car.viewState.signal).toBe('left');
    car.setInput({throttle:1});simulate(1.3);expect(car.viewState.signal).toBe('off');
  });
  it('grounds a restored parked car immediately and keeps all four actual tyres on a graded surface',async()=>{
    const {car,simulate,scene}=await setup();
    car.restore({position:{x:400,y:28,z:164},heading:-Math.PI/2,speed:0});
    expect(car.position.y).toBeCloseTo(16.85,5);
    car.setSurfaceProvider((x)=>16+Math.max(0,(x-390)*.10));simulate(2);
    const root=scene.getObjectByName('coastal-road-car')!,wheels=root.children.filter(o=>o instanceof Group&&o!==root.children[0]);
    expect(wheels).toHaveLength(4);root.updateMatrixWorld(true);
    wheels.forEach((wheel,i)=>{
      const contact=car.wheelContacts[i],floor=16+(contact.x-390)*.1;
      expect(contact.y).toBeCloseTo(floor,5);
      expect(new Box3().setFromObject(wheel,true).min.y).toBeCloseTo(floor,4);
    });
    expect(car.position.x).toBe(400);expect(car.snapshot().heading).toBeCloseTo(-Math.PI/2,6);
  });
  it('settles a parked car after its real supporting ground is lowered instead of leaving it suspended',async()=>{
    const world=road(),{car,simulate}=await setup(world);
    for(let x=244;x<253;x++)for(let z=160;z<169;z++){world.setVoxel(x,15,z,0);world.setVoxel(x,14,z,Material.Concrete);}
    simulate(2);
    expect(car.position.y).toBeCloseTo(15.85,5);expect(car.viewState.grounded).toBe(true);
    expect(car.wheelContacts.every(p=>p.y===15)).toBe(true);
    // A real rigid-body landing may slide by a few centimetres.
    expect(car.position.x).toBeCloseTo(248,1);expect(car.position.z).toBeCloseTo(164,1);
  });
  it.each([false,true])('falls after every wheel loses support, including driving=%s, and lands on actual lower ground',async(driving)=>{
    const world=road(),{car,simulate,scene}=await setup(world);
    car.setDriving(driving);
    for(let x=243;x<254;x++)for(let z=159;z<170;z++){
      world.setVoxel(x,15,z,0);world.setVoxel(x,10,z,Material.Rock);
    }
    simulate(.2);expect(car.position.y).toBeLessThan(16.75);expect(car.position.y).toBeGreaterThan(16.3);
    expect(car.viewState.grounded).toBe(false);
    expect(scene.getObjectByName('car-ground-contact')!.visible).toBe(false);
    simulate(2);expect(car.position.y).toBeCloseTo(11.85,4);expect(car.viewState.grounded).toBe(true);
    expect(car.wheelContacts.every(p=>Math.abs(p.y-11)<.001)).toBe(true);
    expect(scene.getObjectByName('car-ground-contact')!.visible).toBe(true);
  });
  it('keeps falling into a completely empty excavation instead of inventing a support height',async()=>{
    const world=road(),{car,simulate}=await setup(world);
    for(let x=243;x<254;x++)for(let z=159;z<170;z++)world.setVoxel(x,15,z,0);
    simulate(.5);const parkedHeight=car.position.y;
    expect(parkedHeight).toBeLessThan(16);expect(car.viewState.grounded).toBe(false);
    car.setDriving(true);simulate(.5);
    expect(car.position.y).toBeLessThan(parkedHeight-.5);expect(car.viewState.grounded).toBe(false);
  });
  it('uses a real shallow ramp to reach a raised roadway',async()=>{
    // Keep the raised roadway continuous throughout the observation window;
    // driving off its far edge is covered by the separate loss-of-support tests.
    const world=road();for(let z=150;z<=179;z++)for(let x=280;x<=730;x++)world.setVoxel(x,16,z,Material.Concrete);
    const {car,simulate}=await setup(world);
    car.setSurfaceProvider(x=>x>=274&&x<280?16+(x-274)/6:null);
    car.setDriving(true);car.setInput({throttle:1});simulate(6);
    expect(car.position.x).toBeGreaterThan(295);expect(car.position.y,JSON.stringify(car.snapshot())).toBeCloseTo(17.85,4);
  });
  it('holds its brake while reading without leaving the current vehicle mode',async()=>{
    const {car,simulate}=await setup();car.setDriving(true);car.setInput({throttle:1});simulate(3);expect(car.viewState.speed).toBeGreaterThan(10);
    car.releaseControls();simulate(2);expect(car.viewState.driving).toBe(true);expect(car.viewState.speed).toBeCloseTo(0,4);
    const stopped=car.position.x;simulate(1);expect(car.position.x).toBeCloseTo(stopped,4);
    car.setInput({throttle:1});simulate(2);expect(car.position.x).toBeGreaterThan(stopped+5);
  });
  it('normalizes long-running steering angles so snapshots remain valid saves', async () => {
    const {car}=await setup();
    car.restore({position:{x:400,y:16.85,z:164},heading:Math.PI*80+.3,speed:0});
    expect(car.snapshot().heading).toBeCloseTo(.3,6);
    expect(Math.abs(car.snapshot().heading)).toBeLessThanOrEqual(Math.PI);
  });
  it('blocks against parked props/pedestrian bounds and releases them when their live provider changes', async () => {
    const { car, simulate } = await setup();
    let bounds = [{ minX: 283, maxX: 287, minY: 16, maxY: 17.7, minZ: 162, maxZ: 166 }];
    car.setObstacleProvider(() => bounds);
    car.setDriving(true); car.setInput({ throttle: 1 }); simulate(6);
    expect(car.position.x).toBeGreaterThan(280.5);
    expect(car.position.x).toBeLessThan(281);
    expect(car.viewState.blocked).toBe(true);
    const stopped=car.position.x;bounds = []; simulate(4);
    expect(car.position.x).toBeGreaterThan(stopped+20);
  });
  it('drives east through the original 256 m boundary to the outer port without using the rubble budget', async () => {
    const { car, physics, simulate, scene } = await setup();
    car.setDriving(true); car.setInput({ throttle: 1 }); simulate(10);
    expect(car.position.x).toBeGreaterThan(455);
    expect(car.position.x).toBeLessThan(470);
    expect(car.position.z).toBeCloseTo(164, 4);
    expect(car.position.y).toBeCloseTo(16.85, 3);
    expect(car.viewState.speed).toBeGreaterThan(20);
    expect(physics.activeCount).toBe(0);
    expect(scene.getObjectByName('coastal-road-car')).toBeDefined();
    expect(physics.walkObstacles).toHaveLength(3); // Body and two real mirror projections.
  });

  it('stops against authoritative building voxels even before their async collider mesh is installed', async () => {
    const world = road();
    for (let y = 16; y <= 30; y++) for (let z = 150; z <= 179; z++) world.setVoxel(285, y, z, Material.Brick);
    const { car, simulate } = await setup(world);
    car.setDriving(true); car.setInput({ throttle: 1 }); simulate(7);
    expect(car.position.x).toBeLessThan(283);
    expect(car.position.x).toBeGreaterThan(282.5);
    expect(car.viewState.speed).toBe(0);
    expect(car.viewState.blocked).toBe(true);
  });

  it('stops at an ungraded one-metre road ledge instead of lifting the whole car onto it', async () => {
    const world = road();
    for (let z = 150; z <= 179; z++) for (let x = 275; x <= 320; x++) world.setVoxel(x, 16, z, Material.Concrete);
    for (let y = 16; y <= 21; y++) for (let z = 150; z <= 179; z++) world.setVoxel(321, y, z, Material.Rock);
    const { car, simulate } = await setup(world);
    car.setDriving(true); car.setInput({ throttle: 1 }); simulate(8);
    expect(car.position.x).toBeGreaterThan(272.5);
    expect(car.position.x).toBeLessThan(273);
    expect(car.position.y).toBeCloseTo(16.85, 3);
    expect(car.viewState.blocked).toBe(true);
  });

  it('brakes, reverses, and preserves a paused/restored pose instead of rolling away', async () => {
    const { car, simulate } = await setup();
    car.setDriving(true); car.setInput({ throttle: 1 }); simulate(2);
    const moving = car.position.x;
    car.setInput({ throttle: -1 }); simulate(3);
    expect(car.viewState.speed).toBeLessThan(0);
    expect(car.position.x).toBeLessThan(moving + 5);
    car.setDriving(false); const paused = car.snapshot(); simulate(3);
    expect(car.snapshot()).toEqual(paused);
    car.restore({ position: { x: 400, y: 16.85, z: 164 }, heading: -Math.PI / 2, speed: 12 });
    simulate(2);
    expect(car.position.x).toBe(400);
    expect(car.viewState.driving).toBe(false);
    expect(car.viewState.speed).toBe(0);
  });

  it('blocks against a real settled fragment in the shared Rapier world', async () => {
    const { car, physics, simulate } = await setup();
    physics.restore([{ id: 'car-debris', buildingId: 'test', size: { x: 3, y: 3, z: 6 }, voxels: Array.from({length:54},(_,i)=>[i%3,Math.floor(i/18),Math.floor(i/3)%6,Material.Brick] as [number,number,number,number]), position: { x: 285, y: 17.5, z: 164 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, state: 'settled' }]);
    car.setDriving(true); car.setInput({ throttle: 1 });
    let contact=false;for(let i=0;i<420;i++){simulate(1/60);if(car.snapshot().rigidBody){contact=true;break;}}
    expect(contact).toBe(true);expect(car.position.x).toBeLessThan(281.5);expect(car.position.x).toBeGreaterThan(280.5);
    car.releaseControls();simulate(2);expect(car.position.x).toBeLessThan(283.5);
    expect(physics.settledCount).toBe(1);
  });
});
