import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {ObserverMotor,observerHeading} from '../src/input/observer-motor';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';

function street(){const world=new VoxelWorld();for(let x=0;x<32;x++)for(let z=0;z<32;z++)for(let y=0;y<16;y++)world.setVoxel(x,y,z,Material.Rock);return world;}
describe('safe floating observation camera',()=>{
 it('keeps forward movement horizontal when looking steeply at the ground',()=>{
  const direction=observerHeading({x:0,y:-.99,z:-.1});expect(direction.y).toBe(0);expect(direction.length()).toBeCloseTo(1);
  const world=street(),motor=new ObserverMotor(world),position=new Vector3(16,17.68,24);motor.move(position,direction.multiplyScalar(18));
  expect(position.y).toBe(17.68);expect(position.z).toBeCloseTo(6);
 });
 it('stops continuous descent on the street and on open water',()=>{
  const motor=new ObserverMotor(street()),position=new Vector3(16,20,16);for(let i=0;i<50;i++)motor.move(position,{x:0,y:-1,z:0});
  expect(position.y).toBeGreaterThanOrEqual(16.35);expect(motor.clear(position)).toBe(true);
  const open=new ObserverMotor(new VoxelWorld()),sea=new Vector3(100,15,100);open.move(sea,{x:0,y:-50,z:0});expect(sea.y).toBeGreaterThanOrEqual(12.35);
 });
 it('cannot tunnel through a one-voxel wall even at accelerated flight speed',()=>{
  const world=street();for(let y=16;y<30;y++)for(let z=0;z<32;z++)world.setVoxel(18,y,z,Material.Concrete);
  const motor=new ObserverMotor(world),position=new Vector3(10,18,10);motor.move(position,{x:55,y:0,z:0});expect(position.x).toBeLessThanOrEqual(17.65);expect(motor.clear(position)).toBe(true);
 });
 it('stops at a high stair riser, allows explicit ascent, and keeps the camera outside the step',()=>{
  const world=street();for(let x=16;x<24;x++)for(let z=8;z<24;z++)for(let y=16;y<19;y++)world.setVoxel(x,y,z,Material.Concrete);
  const motor=new ObserverMotor(world),position=new Vector3(12,17.68,16);motor.move(position,{x:10,y:0,z:0});expect(position.x).toBeLessThanOrEqual(15.65);expect(position.y).toBe(17.68);
  motor.move(position,{x:0,y:4,z:0});motor.move(position,{x:6,y:0,z:0});expect(position.x).toBeGreaterThan(20);motor.move(position,{x:0,y:-10,z:0});expect(position.y).toBeGreaterThanOrEqual(19.35);expect(motor.clear(position)).toBe(true);
 });
 it('crosses shallow steps without changing altitude and refuses a step that reaches the lens',()=>{
  const world=street();for(let x=12;x<17;x++)for(let z=4;z<28;z++)world.setVoxel(x,16,z,Material.Concrete);
  for(let x=17;x<24;x++)for(let z=4;z<28;z++)for(let y=16;y<19;y++)world.setVoxel(x,y,z,Material.Concrete);
  const motor=new ObserverMotor(world),position=new Vector3(10,17.68,16);motor.move(position,{x:16,y:0,z:0});expect(position.x).toBeGreaterThan(15);expect(position.x).toBeLessThanOrEqual(16.65);expect(position.y).toBe(17.68);expect(motor.clear(position)).toBe(true);
 });
 it('recovers a legacy underground camera and one inside stairs without editing any voxels',()=>{
  const world=street();for(let y=16;y<19;y++)world.setVoxel(16,y,16,Material.Concrete);
  const before=world.chunks.get('0,0,0')!.voxels.slice(),motor=new ObserverMotor(world),position=new Vector3(16.5,3,16.5);
  expect(motor.recover(position)).toBe(true);expect(position.y).toBeGreaterThanOrEqual(19.35);expect(motor.clear(position)).toBe(true);expect(world.chunks.get('0,0,0')!.voxels).toEqual(before);
 });
 it('slides along a wall without crossing it or inventing a rooftop step',()=>{
  const world=street();for(let y=16;y<40;y++)for(let z=0;z<32;z++)world.setVoxel(16,y,z,Material.Concrete);
  const motor=new ObserverMotor(world),position=new Vector3(15,18,8);motor.move(position,{x:12,y:0,z:8});expect(position.x).toBeLessThan(15.66);expect(position.z).toBeCloseTo(16);expect(position.y).toBe(18);
 });
 it('repairs an explicitly relocated view locally instead of returning to a different district',()=>{
  const motor=new ObserverMotor(street());motor.recover(new Vector3(8,18,8));const position=new Vector3(24,3,24);
  motor.recover(position);expect(position.x).toBe(24);expect(position.z).toBe(24);expect(position.y).toBeGreaterThanOrEqual(16.35);
 });
});
