import {describe,it,expect} from 'vitest';
import {Box3,Group,Scene,Vector3} from 'three';
import {bicycleModel} from '../src/vehicles/bicycle-model';
import {Bicycle} from '../src/vehicles/bicycle';
import {VoxelWorld} from '../src/world/voxel';

const pos=(root:Group,name:string)=>root.getObjectByName(name)!.getWorldPosition(new Vector3());
function flat(){const w=new VoxelWorld();for(let x=100;x<180;x++)for(let z=145;z<190;z++)w.setVoxel(x,15,z,1,false);return w;}

describe('visible bicycle contact, not just matching animation phases',()=>{
 it('keeps both rendered boot soles on the actual freely turning platforms through complete cycles, banks and steering',()=>{
  const bike=bicycleModel();let maximum=0;
  for(const speed of [.5,4,8])for(const sign of [-1,0,1])for(let frame=0;frame<36;frame++){
    bike.update(1/60,{phase:frame*Math.PI/18,wheelAngle:frame,speed,steer:sign*.48/(1+speed*.12),pitch:.06,riding:true,footDown:0});bike.root.updateMatrixWorld(true);
    for(const side of ['left','right']){
      const sole=pos(bike.root,`explorer-${side}-sole-contact`),pedal=pos(bike.root,`bicycle-${side}-pedal-top`);maximum=Math.max(maximum,sole.distanceTo(pedal));
      expect(pos(bike.root,`bicycle-${side}-crank-spindle`).distanceTo(pos(bike.root,`bicycle-${side}-pedal`))).toBeLessThan(.0001);
      const elbow=bike.root.getObjectByName(`explorer-${side}-elbow`)!,hand=elbow.children.find(c=>c instanceof Group)!;
      expect(Math.abs(elbow.parent!.rotation.z)).toBeLessThanOrEqual(Math.PI/2+.0001);
      expect(elbow.getWorldPosition(new Vector3()).y).toBeLessThan(elbow.parent!.getWorldPosition(new Vector3()).y+.03);
      const palm=hand.localToWorld(new Vector3(0,-.054,-.009));expect(palm.distanceTo(pos(bike.root,`bicycle-${side}-grip`))).toBeLessThan(.012);
    }
    for(const side of ['front','rear'])expect(pos(bike.root,`bicycle-${side}-wheel`).distanceTo(pos(bike.root,`bicycle-${side}-axle`))).toBeLessThan(.0001);
    expect(pos(bike.root,'bicycle-head-fixed').distanceTo(pos(bike.root,'bicycle-head-steering'))).toBeLessThan(.0001);
  }
  expect(maximum).toBeLessThan(.004);bike.dispose();
 });
 it('parks on its deployed stand with tyres touching the floor, then retracts it without a ground spike',()=>{
  const bike=bicycleModel();bike.update(0,{phase:1,wheelAngle:1,speed:0,steer:0,pitch:0,riding:false,footDown:1,groundAt:()=>0});bike.root.updateMatrixWorld(true);
  expect(bike.standDeployed).toBe(true);expect(pos(bike.root,'bicycle-kickstand-ground-contact').y).toBeCloseTo(0,4);
  for(const name of ['bicycle-front-wheel','bicycle-rear-wheel']){const bounds=new Box3().setFromObject(bike.root.getObjectByName(name)!,true);expect(Math.abs(bounds.min.y)).toBeLessThan(.008);}
  for(let i=0;i<90;i++)bike.update(1/60,{phase:1,wheelAngle:1,speed:0,steer:0,pitch:0,riding:true,footDown:1,groundAt:()=>0});bike.root.updateMatrixWorld(true);
  expect(bike.standDeployed).toBe(false);expect(pos(bike.root,'bicycle-kickstand-ground-contact').y).toBeGreaterThan(.20);expect(pos(bike.root,'explorer-left-sole-contact').y).toBeCloseTo(0,3);bike.dispose();
 });
 it('freewheels without continuing to pedal, then brakes before a dismount instead of teleporting to a stop',()=>{
  const bike=new Bicycle(new Scene(),flat());bike.setRiding(true);bike.setInput(1);for(let i=0;i<220;i++)bike.update(1/60);
  bike.setInput(0);for(let i=0;i<50;i++)bike.update(1/60);const before=bike.viewState;
  for(let i=0;i<20;i++)bike.update(1/60);const coast=bike.viewState;
  expect(coast.wheelAngle).not.toBeCloseTo(before.wheelAngle,2);expect(coast.phase).toBeCloseTo(before.phase,2);expect(coast.pedaling).toBe(false);
  bike.setInput(1);for(let i=0;i<100;i++)bike.update(1/60);const speed=bike.viewState.speed;bike.requestDismount();expect(bike.dismountReady).toBe(false);bike.update(1/60);expect(bike.viewState.speed).toBeGreaterThan(speed-.3);
  for(let i=0;i<150;i++)bike.update(1/60);expect(bike.dismountReady).toBe(true);expect(bike.canPark).toBe(true);bike.dispose();
 });
});
