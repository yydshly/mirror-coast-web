import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { PerspectiveCamera,Scene } from 'three';
import { WalkingController } from '../src/input/walk';
import { WalkingCamera } from '../src/input/walk-camera';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';

class FakeCanvas extends EventTarget {
  focus=vi.fn();
  requestPointerLock=vi.fn(()=>Promise.reject(new Error('Unavailable in remote browser')));
  setPointerCapture=vi.fn();releasePointerCapture=vi.fn();
}
const instances:WalkingController[]=[];
let doc:EventTarget;
beforeEach(()=>{
  doc=Object.assign(new EventTarget(),{pointerLockElement:null,exitPointerLock:vi.fn()});
  vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());
});
afterEach(()=>{instances.splice(0).forEach(c=>c.dispose());vi.unstubAllGlobals();});
function key(code:string,type='keydown') {
  const event=new Event(type,{cancelable:true});Object.assign(event,{code,repeat:false});doc.dispatchEvent(event);
}
function setup(withView=false){
  const world=new VoxelWorld();
  for(let z=24;z<40;z++)for(let x=24;x<40;x++)world.setVoxel(x,15,z,Material.Concrete);
  const scene=new Scene(),camera=new PerspectiveCamera(64,1,.1,1000);
  const view=withView?new WalkingCamera(scene,world):undefined;
  const controller=new WalkingController(camera,new FakeCanvas() as unknown as HTMLCanvasElement,world,{onActiveChange:()=>{},onFallback:()=>{}},view);
  instances.push(controller);controller.teleport({x:31.5,y:17.68,z:31.5});
  const simulate=(frames:number)=>{for(let i=0;i<frames;i++)controller.update(1/60);};
  return {world,scene,controller,simulate};
}
describe('walking input pauses without freezing the physical body',()=>{
  it('falls to lower real ground when voxels are removed while controls are paused',()=>{
    const {world,controller,simulate}=setup();
    for(let z=29;z<34;z++)for(let x=29;x<34;x++){
      world.setVoxel(x,15,z,Material.Air);world.setVoxel(x,12,z,Material.Rock);
    }
    controller.stop();simulate(1);
    expect(controller.isActive).toBe(false);expect(controller.motor.position.y).toBeLessThan(16);
    simulate(120);expect(controller.motor.position.y).toBeCloseTo(13,4);expect(controller.grounded).toBe(true);
  });
  it('keeps falling and landing after Escape is pressed in mid jump',async()=>{
    const {controller,simulate}=setup();await controller.start();
    key('Space');simulate(12);expect(controller.motor.position.y).toBeGreaterThan(16.7);
    const fallingVelocity=controller.motor.velocity.y;
    key('Escape');expect(controller.isActive).toBe(false);expect(controller.motor.velocity.y).toBe(fallingVelocity);simulate(120);
    expect(controller.motor.position.y).toBeCloseTo(16,4);expect(controller.grounded).toBe(true);
  });
  it('does not redraw the disabled avatar when another mode changes the editing tool',()=>{
    const {scene,controller}=setup(true);
    controller.setEnabled(false);controller.setAiming(true);
    expect(scene.getObjectByName('walking-player')?.visible).toBe(false);
  });
});
