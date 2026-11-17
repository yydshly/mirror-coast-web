import {describe,it,expect} from 'vitest';
import {Scene} from 'three';
import {CoastalJourney,validateJourney} from '../src/gameplay/coastal-journey';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
describe('a continuous coastal outing',()=>{
 it('requires walking, a real seat, beach interaction, driving, and getting out at the destination',()=>{
  const j=new CoastalJourney();j.restore({step:0,active:true});const tick=(p:{x:number;y:number;z:number},mode:string,seat?:string)=>{for(let i=0;i<20;i++)j.update(.1,p,mode,seat);};
  tick({x:135,y:16,z:159},'fly');expect(j.state.step).toBe(0);tick({x:135,y:16,z:159},'walk');expect(j.state.step).toBe(1);
  tick({x:183,y:16,z:172},'walk');expect(j.state.step).toBe(1);tick({x:61,y:16,z:172},'walk','coast-bench-61');expect(j.state.step).toBe(2);
  expect(j.beachAvailable({x:260,y:14,z:180.8},'walk')).toBe(true);expect(j.beachAvailable({x:260,y:20,z:180.8},'fly')).toBe(false);j.advance();
  tick({x:248,y:16,z:164},'car');expect(j.state.step).toBe(4);tick({x:356,y:16,z:164},'car');expect(j.state.step).toBe(5);tick({x:356,y:16,z:164},'walk');expect(j.complete).toBe(false);for(let i=0;i<20;i++)j.update(.1,{x:356+i*.2,y:16,z:164},'walk');tick({x:360,y:16,z:164},'walk');expect(j.complete).toBe(true);
  expect(validateJourney(j.state)).toEqual(j.state);expect(()=>validateJourney({step:7,active:true})).toThrow();
 });
 it('walks down the actual east-end beach access and back up without jumping or recovery',()=>{
  const {world,buildings}=generateWorld();addRegionalTerrain(world);addRegionalDistricts(world,buildings);const transitions=new WalkTransitions(new Scene(),world);
  const motor=new VoxelWalker(world,{x:260,y:16,z:168});motor.setObstacleProvider(()=>transitions.nearby(motor.position));
  for(let i=0;i<500&&motor.position.z<180.75;i++){motor.update(1/60,{x:0,z:1});expect(motor.recoveredLastStep,JSON.stringify({i,p:motor.position})).toBe(false);}
  for(let i=0;i<45;i++)motor.update(1/60,{x:0,z:0});expect(motor.position.z,JSON.stringify(motor.position)).toBeGreaterThan(180.7);expect(motor.position.y).toBeLessThan(15.8);
  for(let i=0;i<500&&motor.position.z>168.1;i++){motor.update(1/60,{x:0,z:-1});expect(motor.recoveredLastStep,JSON.stringify({i,p:motor.position})).toBe(false);}
  expect(motor.position.z,JSON.stringify(motor.position)).toBeLessThan(171);expect(motor.position.y).toBeGreaterThanOrEqual(15);transitions.dispose();
 },20000);
 it('connects old town, the walking harbor, a road vehicle, a real bay activity and the cape signal, then leaves time to look back',()=>{
  const j=new CoastalJourney();j.restore({step:0,active:true,route:'coast-road'});
  const dwell=(p:{x:number;y:number;z:number},mode:string,seconds=2,evidence={})=>{for(let i=0;i<seconds*10;i++)j.update(.1,p,mode,undefined,evidence);};
  const walk=(x:number,z:number)=>{for(let i=0;i<30;i++)j.update(.1,{x:x+i*.2,y:16,z},'walk');};
  dwell({x:135,y:16,z:159},'fly');expect(j.state.step).toBe(0);walk(132,159);dwell({x:138,y:16,z:159},'walk');expect(j.state.step).toBe(1);
  dwell({x:24,y:15,z:231},'walk');expect(j.state.step).toBe(1);walk(18,231);walk(24,231);dwell({x:30,y:15,z:231},'walk');expect(j.state.step).toBe(2);
  dwell({x:114,y:16,z:169},'bicycle');expect(j.state.step).toBe(3);
  dwell({x:628,y:14,z:161},'walk');expect(j.state.step).toBe(3);dwell({x:628,y:14,z:161},'walk',2,{bayNotes:['kite']});expect(j.state.step).toBe(4);
  expect(j.navigationTarget({x:628,y:14,z:161},'walk')).toBe('bicycle');expect(j.navigationTarget({x:630,y:14,z:143},'bicycle')).toBe('cape-signal');expect(j.navigationTarget({x:-180,y:33,z:90},'walk')).toBe('cape-signal');
  const signal={discoveries:new Set(['cape-signal'])};dwell({x:-187,y:21,z:126.5},'helicopter',2,signal);expect(j.state.step).toBe(4);dwell({x:-187,y:21,z:126.5},'walk',2,signal);expect(j.state.step).toBe(5);
  for(let i=0;i<100;i++)j.update(.1,{x:-180+i*.04,y:33,z:90},'walk');expect(j.complete).toBe(false);dwell({x:-176,y:33,z:90},'walk',8);expect(j.complete).toBe(true);
  expect(validateJourney(j.state)).toEqual(j.state);expect(()=>validateJourney({...j.state,route:'unknown'})).toThrow();
  expect(()=>validateJourney({...j.state,vehicle:'aircraft'})).toThrow();
 });
 it('restores a paused modern route without resetting bay exploration or the legacy journey format',()=>{
  const legacy={step:4,active:false};expect(validateJourney(legacy)).toEqual(legacy);
  const saved={step:3,active:false,route:'coast-road' as const},j=new CoastalJourney();j.restore(saved);j.update(.1,{x:628,y:14,z:161},'walk',undefined,{bayNotes:['pool']});expect(j.state).toEqual(saved);expect(saved.step).toBe(3);
 });
});
