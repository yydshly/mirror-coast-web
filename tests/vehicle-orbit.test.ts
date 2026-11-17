import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VehicleOrbit } from '../src/input/vehicle-orbit';

class FakeCanvas extends EventTarget {
  focus=vi.fn(); requestPointerLock=vi.fn();
  captures=new Set<number>();
  setPointerCapture=vi.fn((id:number)=>this.captures.add(id));
  releasePointerCapture=vi.fn((id:number)=>this.captures.delete(id));
}
class FakeDocument extends EventTarget {
  pointerLockElement: FakeCanvas|null=null;
  exitPointerLock=vi.fn(()=>{this.pointerLockElement=null;});
}
let documentTarget:FakeDocument,windowTarget:EventTarget;
const instances:VehicleOrbit[]=[];
beforeEach(()=>{documentTarget=new FakeDocument();windowTarget=new EventTarget();vi.stubGlobal('document',documentTarget);vi.stubGlobal('window',windowTarget);});
afterEach(()=>{instances.splice(0).forEach(instance=>instance.dispose());vi.unstubAllGlobals();});
function event(target:EventTarget,type:string,fields:Record<string,unknown>={}){
  const result=new Event(type,{cancelable:true});
  Object.assign(result,{pointerId:1,button:0,clientX:100,clientY:100},fields);target.dispatchEvent(result);return result;
}
function setup(){
  const canvas=new FakeCanvas(),orbit=new VehicleOrbit(canvas as unknown as HTMLCanvasElement);instances.push(orbit);
  const simulate=(seconds:number,speed=0)=>{for(let i=0;i<seconds*60;i++)orbit.update(1/60,speed);};
  return {canvas,orbit,simulate};
}

describe('vehicle mouse viewing independent of driving controls',()=>{
  it('lets the large aircraft use a closer cabin view while preserving the default ground-vehicle limit',()=>{
    const orbit=new VehicleOrbit(undefined,{minDistanceScale:.28});instances.push(orbit);orbit.setEnabled(true);
    for(let i=0;i<8;i++)orbit.zoomBy(-400);for(let i=0;i<60;i++)orbit.update(1/60,0);
    expect(orbit.state.distanceScale).toBeCloseTo(.28,4);
  });
  it('releases a reading-panel drag without resetting or disabling the current orbit',()=>{
    const {canvas,orbit,simulate}=setup();orbit.setEnabled(true);event(canvas,'pointerdown');event(documentTarget,'pointermove',{clientX:180});simulate(.5);
    const yaw=orbit.state.yaw;orbit.cancelDrag();expect(orbit.state.dragging).toBe(false);expect(orbit.state.yaw).toBe(yaw);expect(canvas.captures.size).toBe(0);
    event(documentTarget,'pointermove',{clientX:300});simulate(.1);expect(orbit.state.yaw).toBeCloseTo(yaw,2);
    event(canvas,'pointerdown');event(documentTarget,'pointermove',{clientX:30});simulate(.5);expect(orbit.state.yaw).toBeGreaterThan(yaw);
  });
  it('captures left and right drags without requesting lock, and ignores secondary pointers',()=>{
    const {canvas,orbit,simulate}=setup();orbit.setEnabled(true);
    event(canvas,'pointerdown',{pointerId:5});
    event(documentTarget,'pointermove',{pointerId:8,clientX:300});simulate(.2);expect(orbit.state.yaw).toBe(0);
    event(documentTarget,'pointerup',{pointerId:8});expect(orbit.state.dragging).toBe(true);
    event(documentTarget,'pointermove',{pointerId:5,clientX:240,clientY:130});simulate(.5);
    expect(orbit.state.yaw).toBeLessThan(-.69);expect(orbit.state.pitch).toBeGreaterThan(.11);
    event(documentTarget,'pointerup',{pointerId:5});expect(canvas.captures.size).toBe(0);
    event(canvas,'pointerdown',{button:2,pointerId:3});event(documentTarget,'pointermove',{pointerId:3,clientX:50});simulate(.5);
    expect(orbit.state.yaw).toBeGreaterThan(-.46);expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('does not consume canvas gestures, wheel or R outside the current vehicle mode',()=>{
    const {canvas,orbit,simulate}=setup();
    expect(event(canvas,'pointerdown').defaultPrevented).toBe(false);
    expect(event(canvas,'wheel',{deltaY:400}).defaultPrevented).toBe(false);
    expect(event(documentTarget,'keydown',{code:'KeyR'}).defaultPrevented).toBe(false);
    orbit.orbitBy(200,80);orbit.zoomBy(400);simulate(1);
    expect(orbit.state).toEqual({yaw:0,pitch:0,distanceScale:1,dragging:false});
  });

  it('preserves a parked view but gently returns after three seconds of driving',()=>{
    const {orbit,simulate}=setup();orbit.setEnabled(true);orbit.orbitBy(240,90);simulate(1);
    const initial=orbit.state;simulate(8,0);
    expect(orbit.state.yaw).toBeCloseTo(initial.yaw,4);expect(orbit.state.pitch).toBeCloseTo(initial.pitch,4);
    orbit.orbitBy(-10,0);simulate(2.5,12);const held=orbit.state.yaw;
    expect(Math.abs(held)).toBeGreaterThan(1.1);
    simulate(5,12);expect(Math.abs(orbit.state.yaw)).toBeLessThan(.07);expect(Math.abs(orbit.state.pitch)).toBeLessThan(.025);
  });

  it('limits pitch and zoom, permits full azimuth circles, and R smoothly restores default framing',()=>{
    const {canvas,orbit,simulate}=setup();orbit.setEnabled(true);
    for(let n=0;n<12;n++){orbit.orbitBy(240,240);orbit.zoomBy(400);}simulate(1);
    expect(orbit.state.pitch).toBeCloseTo(.85,4);expect(orbit.state.distanceScale).toBeCloseTo(1.8,4);
    expect(Math.abs(orbit.state.yaw)).toBeLessThanOrEqual(Math.PI);
    for(let n=0;n<12;n++){orbit.orbitBy(-240,-240);orbit.zoomBy(-400);}simulate(1);
    expect(orbit.state.pitch).toBeCloseTo(-.2,4);expect(orbit.state.distanceScale).toBeCloseTo(.65,4);
    expect(event(documentTarget,'keydown',{code:'KeyR',repeat:false}).defaultPrevented).toBe(true);
    simulate(1);expect(orbit.state.yaw).toBeCloseTo(0,4);expect(orbit.state.pitch).toBeCloseTo(0,4);expect(orbit.state.distanceScale).toBeCloseTo(1,4);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('releases on cancel, blur and vehicle switches and blocks a late pedestrian pointer lock',()=>{
    const {canvas,orbit}=setup();orbit.setEnabled(true);event(canvas,'pointerdown');
    event(documentTarget,'pointercancel');expect(orbit.state.dragging).toBe(false);
    event(canvas,'pointerdown');event(windowTarget,'blur');expect(orbit.state.dragging).toBe(false);
    event(canvas,'pointerdown');orbit.setEnabled(false);expect(canvas.captures.size).toBe(0);
    orbit.setEnabled(true);documentTarget.pointerLockElement=canvas;documentTarget.dispatchEvent(new Event('pointerlockchange'));
    expect(documentTarget.exitPointerLock).toHaveBeenCalled();
    orbit.dispose();const calls=canvas.setPointerCapture.mock.calls.length;event(canvas,'pointerdown');expect(canvas.setPointerCapture).toHaveBeenCalledTimes(calls);
  });
});
