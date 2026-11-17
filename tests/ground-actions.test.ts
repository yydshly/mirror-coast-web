import {describe,expect,it} from 'vitest';
import {Vector3,Quaternion} from 'three';
import {GroundActions,vaultBodyClear,type SeatTarget} from '../src/input/ground-actions';
import {VoxelWalker} from '../src/input/walk';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import type {SceneObstacle} from '../src/input/scene-collisions';
import {orientedCollisionBounds} from '../src/input/scene-collisions';

function fixture(){
 const world=new VoxelWorld();for(let x=4;x<40;x++)for(let z=4;z<40;z++)world.setVoxel(x,15,z,Material.Concrete);
 const motor=new VoxelWalker(world,{x:20,y:16,z:21.05});let obstacles:SceneObstacle[]=[{minX:19.1,maxX:20.9,minY:16.41,maxY:16.53,minZ:19.76,maxZ:20.24},{minX:19.1,maxX:20.9,minY:16.55,maxY:17.1,minZ:19.69,maxZ:19.77,standable:false}];
 motor.setObstacleProvider(()=>obstacles);const notices:string[]=[];let available=true;
 const seat:SeatTarget={id:'coast-bench-20',position:{x:20,y:16.53,z:20.12},floorY:16,yaw:Math.PI,available:()=>available};
 const actions=new GroundActions(motor,()=>obstacles,m=>notices.push(m));actions.setSeatProvider(()=>[seat]);
 const tick=(n:number)=>{for(let i=0;i<n;i++){if(!actions.update(1/60))motor.update(1/60,{x:0,z:0});}};
 return{world,motor,actions,seat,tick,notices,get obstacles(){return obstacles;},set obstacles(value:SceneObstacle[]){obstacles=value;},removeSeat:()=>{available=false;obstacles=[];}};
}
describe('grounded human interactions',()=>{
 it('accepts a front area of the bench, including both sides and oblique approaches',()=>{
  for(const side of [-.65,0,.65])for(const depth of [.65,.95,1.25]){const f=fixture();f.motor.position.set(20+side,16,20.12+depth);f.motor.grounded=true;expect(f.actions.interaction(.2)?.kind,`${side},${depth}`).toBe('sit');}
 });
 it('recognizes the closest legal standing positions and does not require looking at the seat centre',()=>{
  for(const side of [-.65,0,.65])for(const depth of [.415,.48,.6])for(const yaw of [0,Math.PI/2,Math.PI]){
   const f=fixture();f.motor.position.set(20+side,16,20.12+depth);f.motor.grounded=true;
   expect(f.motor.canOccupy(f.motor.position)).toBe(true);const hint=f.actions.interaction(yaw);expect(hint?.kind,`${side},${depth},${yaw}`).toBe('sit');
   expect(f.actions.interact(hint!,yaw)).toBe(true);f.tick(260);expect(f.actions.phase).toBe('seated');
  }
 });
 it('walks around either end from beside or behind a bench instead of requiring a distant front hotspot',()=>{
  for(const [dx,dz]of [[-1.35,0],[1.35,0],[-.7,-.9],[.7,-.9]]){
   const f=fixture();f.motor.position.set(20+dx,16,20.12+dz);f.motor.grounded=true;
   expect(f.motor.canOccupy(f.motor.position)).toBe(true);const hint=f.actions.interaction(0);expect(hint?.kind,`${dx},${dz}`).toBe('sit');
   expect(f.actions.interact(hint!,0)).toBe(true);let last=f.motor.position.clone();
   for(let i=0;i<360;i++){f.tick(1);expect(f.motor.position.distanceTo(last)).toBeLessThan(.15);last=f.motor.position.clone();}
   expect(f.actions.phase,JSON.stringify(f.notices)).toBe('seated');expect(f.actions.stand()).toBe(true);f.tick(50);expect(f.motor.canOccupy(f.motor.position)).toBe(true);
  }
 });
 it('accepts different points along a rail, including standing against it and approaching from farther away',()=>{
  for(const x of [10,20,30])for(const depth of [.35,.6,1.1]){const f=fixture();f.obstacles=[{minX:8,maxX:32,minY:16,maxY:17.1,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}];f.motor.position.set(x,16,25-depth);f.motor.grounded=true;expect(f.actions.interaction(Math.PI+.3)?.kind,`${x},${depth}`).toBe('vault');}
 });
 it('sits on the actual seat, holds a seated collision posture, and rises into clear space',()=>{
  const f=fixture(),hint=f.actions.interaction(0);expect(hint?.kind).toBe('sit');expect(f.actions.interact(hint!,0)).toBe(true);
  f.tick(65);expect(f.actions.phase).toBe('seated');expect(f.motor.position).toEqual(new Vector3(20,16,20.12));expect(f.actions.motion.sit).toBe(1);expect(f.actions.posture?.seatId).toBe(f.seat.id);
  expect(f.actions.stand()).toBe(true);f.tick(45);expect(f.actions.phase).toBe('standing');expect(f.motor.canOccupy(f.motor.position)).toBe(true);expect(f.motor.position.z).toBeCloseTo(21.05,4);
 });
 it('keeps the person seated if every safe exit is blocked, then gets up when it clears',()=>{
  const f=fixture();expect(f.actions.restoreSeat(f.seat.id)).toBe(true);
  const original=f.obstacles;f.obstacles=[...original,{minX:18,maxX:22,minY:16,maxY:19,minZ:20.85,maxZ:22}];
  expect(f.actions.stand()).toBe(false);expect(f.actions.phase).toBe('seated');expect(f.notices.at(-1)).toContain('挡住');
  f.obstacles=original;expect(f.actions.stand()).toBe(true);f.tick(45);expect(f.motor.canOccupy(f.motor.position)).toBe(true);
 });
 it('leaves a removed seat instead of continuing to sit in empty space',()=>{
  const f=fixture();f.actions.restoreSeat(f.seat.id);f.removeSeat();f.tick(60);expect(f.actions.phase).toBe('standing');expect(f.motor.canOccupy(f.motor.position)).toBe(true);
 });
 it('holds the checked posture when a moving obstacle interrupts a rise, then resumes without a teleport',()=>{
  const f=fixture();f.actions.restoreSeat(f.seat.id);expect(f.actions.stand()).toBe(true);f.tick(8);
  const original=f.obstacles,held=f.motor.position.clone();
  f.obstacles=[...original,{minX:19,maxX:21,minY:16,maxY:19,minZ:held.z+.30,maxZ:22}];
  f.tick(30);expect(f.actions.phase).toBe('stand-up');expect(f.actions.status).toContain('等待');expect(f.motor.position.distanceTo(held)).toBeLessThan(.1);expect(f.actions.motion.sit).toBeGreaterThan(.5);
  f.obstacles=original;f.tick(45);expect(f.actions.phase).toBe('standing');expect(f.motor.canOccupy(f.motor.position)).toBe(true);
 });
 it('vaults a marked waist-high rail using a continuously checked path and dry supported landing',()=>{
  const f=fixture();f.obstacles=[{minX:8,maxX:32,minY:16,maxY:17.1,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}];f.motor.position.set(20,16,24.4);f.motor.grounded=true;
  const hint=f.actions.interaction(Math.PI);expect(hint?.kind).toBe('vault');expect(f.actions.interact(hint!,Math.PI)).toBe(true);
  if(hint?.kind!=='vault')throw new Error('Expected rail interaction');
  let last=f.motor.position.clone(),maxRise=0;for(let i=0;i<72;i++){f.tick(1);if(f.actions.motion.vault!==undefined)expect(vaultBodyClear(f.motor,hint.plan,f.actions.motion.vault)).toBe(true);expect(f.motor.position.distanceTo(last)).toBeLessThan(.25);maxRise=Math.max(maxRise,f.motor.position.y-16);last=f.motor.position.clone();}
  expect(maxRise).toBeLessThan(.8);
  expect(f.actions.phase).toBe('standing');expect(f.motor.position.z).toBeGreaterThan(25.5);expect(f.motor.position.y).toBeCloseTo(16,4);
 });
 it('refuses a low rail with water, a deep drop or an overhead obstruction beyond it',()=>{
  for(const problem of ['water','drop','ceiling']){
   const f=fixture();f.obstacles=[{minX:8,maxX:32,minY:16,maxY:17.1,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}];f.motor.position.set(20,16,24.4);f.motor.grounded=true;
   if(problem==='ceiling')for(let x=18;x<23;x++)for(let z=24;z<28;z++)f.world.setVoxel(x,18,z,Material.Concrete);
   else for(let x=18;x<23;x++)for(let z=25;z<28;z++){f.world.setVoxel(x,15,z,Material.Air);if(problem==='water')f.world.setVoxel(x,11,z,Material.Sand);}
   expect(f.actions.interaction(Math.PI),problem).toBeNull();
  }
 });
 it('retreats with the tucked collision posture when the landing is destroyed mid-vault',()=>{
  const f=fixture();f.obstacles=[{minX:8,maxX:32,minY:16,maxY:17.1,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}];f.motor.position.set(20,16,24.4);f.motor.grounded=true;
  const hint=f.actions.interaction(Math.PI)!;expect(f.actions.interact(hint,Math.PI)).toBe(true);f.tick(34);
  const last=f.motor.position.clone();for(let x=18;x<23;x++)for(let z=25;z<28;z++)f.world.setVoxel(x,15,z,Material.Air);
  f.tick(1);expect(f.actions.phase).toBe('vault');expect(f.motor.position.distanceTo(last)).toBeLessThan(.1);expect(f.actions.status).toContain('退回');
  f.tick(75);expect(f.actions.phase).toBe('standing');expect(f.motor.position).toEqual(new Vector3(20,16,24.4));expect(f.motor.canOccupy(f.motor.position)).toBe(true);
 });
 it('does not treat a bench back or an ordinary high wall as a vaultable rail',()=>{
  const f=fixture();f.obstacles=[{minX:19.1,maxX:20.9,minY:16.55,maxY:17.1,minZ:24.94,maxZ:25.06,standable:false}];f.motor.position.set(20,16,24.4);f.motor.grounded=true;
  expect(f.actions.interaction(Math.PI)).toBeNull();f.obstacles[0].vaultable=true;f.obstacles[0].maxY=18;expect(f.actions.interaction(Math.PI)).toBeNull();
 });
 it('vaults a continuous joined rail at its former section seams and can immediately return',()=>{
  for(const x of [12.98,13,13.12,18,23.03]){
   const f=fixture();f.obstacles=Array.from({length:5},(_,i)=>({minX:8+i*5,maxX:13.1+i*5,minY:16,maxY:17.1,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}));f.motor.position.set(x,16,24.4);f.motor.grounded=true;
   for(const yaw of [Math.PI,0]){const hint=f.actions.interaction(yaw);expect(hint?.kind,`${x},${yaw}`).toBe('vault');expect(f.actions.interact(hint!,yaw)).toBe(true);f.tick(70);expect(f.actions.phase).toBe('standing');expect(f.motor.canOccupy(f.motor.position)).toBe(true);}
   expect(f.motor.position.z).toBeLessThan(24.5);
  }
 });
 it('returns over a rail from the lower side of a 60cm grade change, rather than enforcing one-way downhill movement',()=>{
  const f=fixture();f.obstacles=[{minX:8,maxX:32,minY:15.4,maxY:16.9,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}];
  for(let x=8;x<=32;x++)for(let z=25;z<=30;z++){f.world.setVoxel(x,15,z,0);f.world.setVoxel(x,14,z,Material.Concrete);}
  f.obstacles.push({minX:8,maxX:32,minY:15,maxY:15.4,minZ:25.06,maxZ:30});
  f.motor.position.set(20,16,24.4);f.motor.grounded=true;
  for(const yaw of [Math.PI,0]){const hint=f.actions.interaction(yaw);expect(hint?.kind).toBe('vault');expect(f.actions.interact(hint!,yaw)).toBe(true);f.tick(70);expect(f.actions.phase).toBe('standing');expect(f.motor.canOccupy(f.motor.position)).toBe(true);}
  expect(f.motor.position.y).toBeCloseTo(16,3);expect(f.motor.position.z).toBeLessThan(24.5);
 });
 it('supports rotated low fences and an untagged rail-shaped barrier',()=>{
  for(const rotated of [false,true]){
   const f=fixture(),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),rotated?Math.PI/4:0);
   const rail=orientedCollisionBounds({x:20,y:16.55,z:25},q,{x:.06,y:.55,z:5});rail.standable=false;f.obstacles=[rail];
   const n=new Vector3(1,0,0).applyQuaternion(q),start=new Vector3(20,16,25).addScaledVector(n,-.7);f.motor.position.copy(start);f.motor.grounded=true;
   const hint=f.actions.interaction(0);expect(hint?.kind).toBe('vault');expect(f.actions.interact(hint!,0)).toBe(true);f.tick(70);expect(f.actions.phase).toBe('standing');
   expect(f.motor.position.clone().sub(new Vector3(20,16,25)).dot(n)).toBeGreaterThan(.6);
  }
 });
 it('uses the same two-way action on an ordinary low voxel parapet, while retaining a thick wall',()=>{
  const f=fixture();f.obstacles=[];for(let x=8;x<=32;x++)f.world.setVoxel(x,16,25,Material.Trim);
  f.motor.position.set(20,16,24.4);f.motor.grounded=true;
  for(const yaw of [Math.PI,0]){const hint=f.actions.interaction(yaw);expect(hint?.kind).toBe('vault');expect(f.actions.interact(hint!,yaw)).toBe(true);f.tick(75);expect(f.actions.phase).toBe('standing');expect(f.motor.canOccupy(f.motor.position)).toBe(true);}
  for(let x=8;x<=32;x++)f.world.setVoxel(x,16,26,Material.Concrete);
  expect(f.actions.interaction(Math.PI)).toBeNull();
 });
 it('does not offer a one-way drop whose rail would be too high to climb on the return side',()=>{
  const f=fixture();f.obstacles=[{minX:8,maxX:32,minY:15,maxY:17.1,minZ:24.94,maxZ:25.06,vaultable:true,standable:false}];
  for(let x=8;x<=32;x++)for(let z=25;z<30;z++){f.world.setVoxel(x,15,z,0);f.world.setVoxel(x,14,z,Material.Concrete);}
  f.motor.position.set(20,16,24.4);f.motor.grounded=true;
  expect(f.actions.interaction(Math.PI)).toBeNull();expect(f.actions.status).toContain('往返');
 });
 it('reports the real landing speed after a jump and keeps feet on the ground afterwards',()=>{
  const f=fixture();f.obstacles=[];let strongest=0;
  for(let i=0;i<100;i++){f.motor.update(1/60,{x:0,z:0,jump:i<12});strongest=Math.max(strongest,f.motor.landingSpeed);}
  expect(strongest).toBeGreaterThan(5);expect(f.motor.position.y).toBeCloseTo(16,4);expect(f.motor.grounded).toBe(true);
 });
});
