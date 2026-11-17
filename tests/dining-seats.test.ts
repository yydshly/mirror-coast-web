import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Scene,Vector3} from 'three';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {BuildingRegistry} from '../src/destruction/buildings';
import {StreetArt} from '../src/rendering/street-art';
import {GroundActions} from '../src/input/ground-actions';
import {VoxelWalker} from '../src/input/walk';

let base:ReturnType<typeof generateWorld>,art:StreetArt;
beforeAll(()=>{base=generateWorld();addHarborQuarter(base.world,base.buildings);art=new StreetArt(new Scene(),base.world,new BuildingRegistry(),{people:false});});
afterAll(()=>art.dispose());
describe('real dining furniture',()=>{
 it('registers every dining chair using the actual supported seat surface',()=>{
  expect(art.seats.filter(s=>s.kind==='chair')).toHaveLength(6);
  for(const s of art.seats.filter(s=>s.kind==='chair')){expect(s.available()).toBe(true);expect(s.position.y-s.floorY).toBeCloseTo(.495,5);}
 });
 it('sits and rises from both sides and the rear of all six real chairs, without passing through a table or chair',()=>{
  for(const seat of art.seats.filter(s=>s.kind==='chair')){
   const f={x:-Math.sin(seat.yaw),z:-Math.cos(seat.yaw)},side={x:f.z,z:-f.x};let checked=0;
   for(const [u,v]of [[-.60,0],[.60,0],[-.85,-.30],[.85,-.30],[0,-.75]]){
    const start=new Vector3(seat.position.x+side.x*u+f.x*v,seat.floorY,seat.position.z+side.z*u+f.z*v);
    const motor=new VoxelWalker(base.world,start);motor.setObstacleProvider(()=>art.obstacles);motor.position.copy(start);motor.grounded=true;
    if(!motor.canOccupy(start))continue;checked++;
    const notices:string[]=[],actions=new GroundActions(motor,()=>art.obstacles,m=>notices.push(m));actions.setSeatProvider(()=>[seat]);
    const hint=actions.interaction(seat.yaw+Math.PI);expect(hint?.kind,`${seat.id}: ${u},${v}, seat=${JSON.stringify(seat)}, status=${actions.status}`).toBe('sit');expect(actions.interact(hint!,seat.yaw+Math.PI)).toBe(true);
    let previous=motor.position.clone();
    for(let i=0;i<360;i++){if(!actions.update(1/60))motor.update(1/60,{x:0,z:0});expect(motor.position.distanceTo(previous)).toBeLessThan(.08);previous=motor.position.clone();}
    expect(actions.phase,`${seat.id},${u},${v}: ${notices}`).toBe('seated');expect(motor.position.distanceTo(new Vector3(seat.position.x,seat.floorY,seat.position.z))).toBeLessThan(.001);
    expect(actions.stand(),seat.id).toBe(true);for(let i=0;i<90;i++){actions.update(1/60);expect(motor.position.distanceTo(previous)).toBeLessThan(.08);previous=motor.position.clone();}
    expect(actions.phase).toBe('standing');expect(motor.canOccupy(motor.position)).toBe(true);
   }
   expect(checked,seat.id).toBeGreaterThanOrEqual(4);
  }
 });
 it('restores every dining seat, selects a side exit and rises after save restoration',()=>{
  for(const seat of art.seats.filter(s=>s.kind==='chair')){
   const motor=new VoxelWalker(base.world,{x:16,y:15,z:232});motor.setObstacleProvider(()=>art.obstacles);
   const actions=new GroundActions(motor,()=>art.obstacles);actions.setSeatProvider(()=>[seat]);expect(actions.restoreSeat(seat.id),seat.id).toBe(true);
   expect(actions.stand()).toBe(true);for(let i=0;i<90;i++)actions.update(1/60);expect(actions.phase).toBe('standing');expect(motor.canOccupy(motor.position)).toBe(true);
  }
 });
});
