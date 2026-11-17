import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { cameraSphereClear, WalkingCamera, type CameraObstacle } from '../src/input/walk-camera';
import { Material } from '../src/world/palette';
import { VoxelWorld } from '../src/world/voxel';

const dispose: Array<() => void> = [];
afterEach(() => dispose.splice(0).forEach(fn => fn()));

function setup(obstacles: () => readonly CameraObstacle[] = () => []) {
  const scene = new Scene(), world = new VoxelWorld();
  for (let z = 10; z < 35; z++) for (let x = 10; x < 35; x++) world.setVoxel(x, 15, z, Material.Concrete);
  const view = new WalkingCamera(scene, world, obstacles); dispose.push(() => view.dispose());
  const camera = new PerspectiveCamera(64, 16 / 9, .15, 1000);
  const feet = new Vector3(20.5, 16, 20.5);
  return { scene, world, view, camera, feet };
}

describe('body-relative first and third person views', () => {
  it('keeps a seated third-person camera above the real backrest and allows first-person sea viewing',()=>{
    const back={minX:19.5,maxX:21.5,minY:16.565,maxY:17.115,minZ:20.10,maxZ:20.18};
    const {view,camera,feet,world}=setup(()=>[back]);feet.z=20.53;
    const motion={sit:1,seatHeight:.53,bodyYaw:Math.PI,landing:0,verticalSpeed:0};
    for(let i=0;i<60;i++)view.update(1/60,camera,feet,Math.PI,-.03,0,true,motion);
    expect(camera.position.distanceTo(feet)).toBeGreaterThan(3);expect(cameraSphereClear(world,camera.position,[back],.18)).toBe(true);
    view.setMode('first');view.update(1/60,camera,feet,Math.PI,0,0,true,motion);expect(camera.position.y).toBeCloseTo(17.405,3);
  });
  it('orbits a stationary explorer without turning their body and realigns the body when tools aim',()=>{
    const {scene,view,camera,feet}=setup();
    view.update(1/60,camera,feet,0,0,0,true);
    const player=scene.getObjectByName('walking-player')!;
    for(let frame=0;frame<60;frame++)view.update(1/60,camera,feet,(frame+1)/60*Math.PI,0,0,true);
    expect(player.rotation.y).toBeCloseTo(0,6);
    expect(camera.position.z).toBeLessThan(feet.z-4);
    view.setAiming(true);view.update(1/60,camera,feet,Math.PI,0,0,true);
    expect(Math.abs(player.rotation.y)).toBeCloseTo(Math.PI,6);
  });

  it('smoothly faces actual movement independently of camera yaw and initializes teleported poses without a spin',()=>{
    const {scene,view,camera,feet}=setup();
    view.update(1/60,camera,feet,0,0,0,true);
    const player=scene.getObjectByName('walking-player')!;
    feet.x+=.05;view.update(1/60,camera,feet,0,0,3,true);
    expect(player.rotation.y).toBeLessThan(0);expect(player.rotation.y).toBeGreaterThan(-Math.PI/2);
    for(let frame=0;frame<60;frame++){feet.x+=.05;view.update(1/60,camera,feet,0,0,3,true);}
    expect(player.rotation.y).toBeCloseTo(-Math.PI/2,4);
    const stopped=player.rotation.y;
    view.update(1/60,camera,feet,1.1,0,0,true);
    expect(player.rotation.y).toBe(stopped);
    feet.set(70,16,70);view.update(1/60,camera,feet,.8,0,0,true);
    expect(player.rotation.y).toBe(.8);
    view.hide();view.update(1/60,camera,feet,-.4,0,0,true);
    expect(player.rotation.y).toBe(-.4);
  });

  it('aims over the shoulder at a forward wall with a clear centre ray instead of the player or near ground', () => {
    const {scene,world,view,camera,feet}=setup();
    for(let y=16;y<23;y++)for(let x=18;x<24;x++)world.setVoxel(x,y,13,Material.Brick);
    view.setAiming(true);view.update(1/60,camera,feet,0,0,0,true);
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const direction=new Vector3();camera.getWorldDirection(direction);
    const hit=world.raycast(camera.position,direction,14);
    expect(hit?.z).toBe(13);expect(hit?.y).toBe(17);
    const player=scene.getObjectByName('walking-player')!;
    expect(new Raycaster(camera.position,direction,0,14).intersectObject(player,true)).toHaveLength(0);
    const centre=new Vector3(feet.x,feet.y+1.1,feet.z).project(camera);
    expect(centre.x).toBeLessThan(-.12);expect(centre.y).toBeLessThan(-.1);
    const target=new Vector3(feet.x,feet.y+1.68,feet.z-8).project(camera);
    expect(target.x).toBeCloseTo(0,6);expect(target.y).toBeCloseTo(0,6);
  });

  it('keeps the aimed shoulder boom clear around rear/side walls and leaves first person unchanged',()=>{
    const {world,view,camera,feet}=setup();
    for(let y=16;y<23;y++){
      for(let x=20;x<27;x++)world.setVoxel(x,y,22,Material.Brick);
      for(let z=20;z<28;z++)world.setVoxel(22,y,z,Material.Brick);
    }
    view.setAiming(true);
    for(let frame=0;frame<60;frame++){
      view.update(1/60,camera,feet,frame/60*.8,-.1,2,true);
      expect(cameraSphereClear(world,camera.position)).toBe(true);
    }
    view.setMode('first');view.update(1/60,camera,feet,.6,-.15,0,true);
    const position=camera.position.clone(),direction=new Vector3();camera.getWorldDirection(direction);
    view.setAiming(false);view.update(1/60,camera,feet,.6,-.15,0,true);
    expect(camera.position).toEqual(position);
    const nextDirection=new Vector3();camera.getWorldDirection(nextDirection);
    expect(nextDirection.distanceTo(direction)).toBeLessThan(1e-6);
  });

  it('starts behind the actual player and switches view without changing body position or heading', () => {
    const { scene, world, view, camera, feet } = setup();
    const original = feet.clone();
    view.update(1 / 60, camera, feet, 0, 0, 0, true);
    expect(view.mode).toBe('third');
    expect(camera.position.z).toBeGreaterThan(feet.z + 3.5);
    expect(scene.getObjectByName('walking-player')?.visible).toBe(true);
    expect(cameraSphereClear(world, camera.position)).toBe(true);
    view.toggle(); view.update(1 / 60, camera, feet, .6, -.2, 0, true);
    expect(feet).toEqual(original);
    expect(camera.position.x).toBe(feet.x);
    expect(camera.position.y).toBeCloseTo(feet.y + 1.68);
    expect(camera.position.z).toBe(feet.z);
    expect(scene.getObjectByName('walking-player')?.visible).toBe(false);
    const direction = new Vector3(); camera.getWorldDirection(direction);
    expect(direction.x).toBeCloseTo(-Math.sin(.6) * Math.cos(-.2));
    view.toggle(); view.update(1 / 60, camera, feet, .6, -.2, 0, true);
    expect(feet).toEqual(original);
  });

  it('retracts a camera volume in front of a rear wall instead of seeing through it', () => {
    const { world, view, camera, feet } = setup();
    for (let y = 16; y < 24; y++) for (let x = 15; x < 27; x++) world.setVoxel(x, y, 22, Material.Brick);
    view.update(1 / 60, camera, feet, 0, 0, 0, true);
    expect(camera.position.z).toBeGreaterThan(21.2);
    expect(camera.position.z).toBeLessThan(21.82);
    expect(cameraSphereClear(world, camera.position)).toBe(true);
  });

  it('keeps first-person eye smoothing inside the body when stepping down one metre beneath a thin low beam', () => {
    // A point-only collision test can miss a thin beam entirely when a lagging
    // eye remains ABOVE it; the camera must stay inside the actual body as well.
    const beam: CameraObstacle = { minX: 21, minY: 18, minZ: 19, maxX: 25, maxY: 18.1, maxZ: 22 };
    const { world, view, camera, feet } = setup(() => [beam]);
    world.setVoxel(20, 16, 20, Material.Concrete);
    feet.set(20.5, 17, 20.5);
    view.setMode('first');
    view.update(1 / 60, camera, feet, 0, 0, 0, true);
    expect(camera.position.y).toBeCloseTo(18.68);
    feet.set(21.5, 16, 20.5);
    for (let frame = 0; frame < 24; frame++) {
      view.update(1 / 60, camera, feet, 0, 0, 2.8, true);
      expect(camera.position.y).toBeGreaterThanOrEqual(feet.y + 1.25);
      expect(camera.position.y).toBeLessThanOrEqual(feet.y + 1.72);
      expect(cameraSphereClear(world, camera.position, [beam], .085)).toBe(true);
      expect(camera.position.y + .085).toBeLessThan(beam.minY);
    }
  });

  it('keeps the smoothed orbit clear around a corner and under a low ceiling', () => {
    const { world, view, camera, feet } = setup();
    for (let y = 16; y < 23; y++) {
      for (let x = 20; x < 29; x++) world.setVoxel(x, y, 22, Material.Brick);
      for (let z = 20; z < 29; z++) world.setVoxel(22, y, z, Material.Brick);
    }
    for (let z = 19; z < 24; z++) for (let x = 19; x < 24; x++) world.setVoxel(x, 18, z, Material.Roof);
    for (let frame = 0; frame < 90; frame++) {
      const yaw = frame / 90 * Math.PI * .5;
      view.update(1 / 60, camera, feet, yaw, -.1, 2, true);
      expect(cameraSphereClear(world, camera.position)).toBe(true);
      expect(camera.position.y).toBeLessThan(17.82);
    }
  });

  it('uses the live prop provider and lengthens the boom after an obstacle is removed', () => {
    let props: CameraObstacle[] = [{ minX: 19, minY: 16, minZ: 22, maxX: 23, maxY: 20, maxZ: 24 }];
    const { world, view, camera, feet } = setup(() => props);
    view.update(1 / 60, camera, feet, 0, 0, 0, true);
    // A clear side view is preferable to a close-up against this narrow prop.
    expect(camera.position.distanceTo(new Vector3(feet.x,feet.y+1.28,feet.z))).toBeGreaterThan(2.5);
    expect(cameraSphereClear(world, camera.position, props)).toBe(true);
    props = [];
    for (let i = 0; i < 90; i++) view.update(1 / 60, camera, feet, 0, 0, 0, true);
    expect(camera.position.z).toBeGreaterThan(24);
  });

  it('snaps a teleported body to a fresh collision-safe boom without moving through the old scene', () => {
    const { world, view, camera, feet } = setup();
    view.update(1 / 60, camera, feet, 0, 0, 0, true);
    feet.set(70, 16, 70);
    for (let y = 16; y < 24; y++) for (let x = 66; x < 75; x++) world.setVoxel(x, y, 72, Material.Brick);
    view.update(1 / 60, camera, feet, 0, 0, 0, true);
    expect(camera.position.x).toBeGreaterThan(69);
    expect(camera.position.z).toBeLessThan(71.82);
    expect(cameraSphereClear(world, camera.position)).toBe(true);
    view.hide();
  });
});
