import {afterEach,expect,it} from 'vitest';
import {Scene} from 'three';
import {CoastalBoat} from '../src/vehicles/coastal-boat';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {BoatLandings} from '../src/rendering/boat-landings';
import {BOAT_LANDINGS} from '../src/route/boat-route';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {VoxelWalker} from '../src/input/walk';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
function sea(){const w=new VoxelWorld();for(let x=95;x<185;x++)for(let z=90;z<230;z++)w.setVoxel(x,3,z,Material.Sand,false);return w;}
function setup(world=sea()){const scene=new Scene(),boat=new CoastalBoat(scene,world);cleanup.push(()=>boat.dispose());boat.restore({position:{x:140,y:12.08,z:180},heading:0,piloting:true});boat.setPiloting(true);const step=(n:number)=>{for(let i=0;i<n;i++)boat.update(1/60);};return{world,scene,boat,step};}
it('accelerates across water, coasts with inertia, steers, brakes and reverses',()=>{
 const {boat,step}=setup();boat.setInput(1);step(180);expect(boat.position.z).toBeLessThan(170);expect(boat.viewState.speed).toBeGreaterThan(8);const p=boat.position.clone();boat.setInput(0);step(30);expect(boat.position.distanceTo(p)).toBeGreaterThan(1);boat.setInput(1,1);step(60);expect(Math.abs(boat.headingAngle)).toBeGreaterThan(.2);boat.setInput(0,0,true);step(180);expect(Math.abs(boat.viewState.speed)).toBeLessThan(.1);boat.setInput(-1);step(120);expect(boat.viewState.speed).toBeLessThan(-1);
});
it('stops at an actual shallow bank and permits reversing away, rather than crossing onto dry land',()=>{
 const {world,boat,step}=setup();for(let x=95;x<185;x++)for(let z=90;z<155;z++)world.setVoxel(x,11,z,Material.Sand,false);boat.setInput(1);step(300);const z=boat.position.z;expect(z).toBeGreaterThan(157);expect(boat.viewState.status).toContain('水太浅');boat.setInput(-1);step(150);expect(boat.position.z).toBeGreaterThan(z+2);
});
it('blocks an actual quay but travels under a high bridge with enough helm clearance',()=>{
 const {boat,step}=setup();boat.setObstacleProvider(()=>[{minX:136,maxX:144,minY:16,maxY:17,minZ:158,maxZ:168}]);boat.setInput(1);step(240);expect(boat.position.z).toBeLessThan(166);boat.setObstacleProvider(()=>[{minX:130,maxX:150,minY:12.5,maxY:15,minZ:147,maxZ:148}]);step(180);expect(boat.position.z).toBeGreaterThan(150);expect(boat.viewState.status).toContain('障碍');
});
it('has no deep-water dismount and checks real supported dock space for landing',()=>{
 const {boat}=setup();expect(boat.exitPosition(()=>true)).toBeNull();boat.setObstacleProvider(()=>[{minX:136,maxX:138,minY:12.4,maxY:12.75,minZ:176,maxZ:184,standable:true}]);const p=boat.exitPosition(()=>true);expect(p?.y).toBe(12.75);expect(p!.x).toBeLessThan(138);
});
it('G recovers from a trapped shore pose to safe water, clears velocity and permits departure',()=>{
 const {world,boat,step}=setup();for(let x=138;x<142;x++)for(let z=177;z<183;z++)world.setVoxel(x,11,z,Material.Rock,false);expect(boat.recoverNearby()).toBe(true);const p=boat.position.clone();expect(boat.viewState.speed).toBe(0);boat.setInput(1);step(100);expect(boat.position.distanceTo(p),boat.viewState.status).toBeGreaterThan(2);
});
it('keeps a fully enclosed boat in place rather than deleting collisions to rescue it',()=>{
 const {boat}=setup();boat.setObstacleProvider(()=>[{minX:-100,maxX:400,minY:0,maxY:40,minZ:-100,maxZ:500}]);const before=boat.snapshot();expect(boat.recoverNearby()).toBe(false);expect(boat.snapshot()).toEqual(before);
});
it('connects all three real landings to dry footing with walkable steps and clear water berths',()=>{
 const generated=generateWorld(),{world}=generated;addRegionalTerrain(world);addHarborQuarter(world,generated.buildings);const scene=new Scene(),landings=new BoatLandings(scene,world),boat=new CoastalBoat(scene,world);cleanup.push(()=>landings.dispose(),()=>boat.dispose());boat.setObstacleProvider(()=>landings.obstacles);
 for(const l of BOAT_LANDINGS){
  expect(boat.restore({position:{...l.boat,y:12.08},heading:Math.PI,piloting:false}),l.id).toBe(false);
  const walker=new VoxelWalker(world,{x:l.x,y:l.landY,z:l.z});walker.setObstacleProvider(()=>landings.obstacles);for(let i=0;i<800&&walker.position.z<l.endZ-1;i++)walker.update(1/60,{x:0,z:1});expect(walker.position.z,JSON.stringify({id:l.id,p:walker.position,v:walker.velocity,grounded:walker.grounded})).toBeGreaterThan(l.endZ-1.4);expect(walker.position.y,l.id).toBeCloseTo(12.75,2);expect(boat.canBoard(walker.position),l.id).toBe(true);const exit=boat.exitPosition(p=>walker.canOccupy(p));expect(exit,l.id).not.toBeNull();walker.teleportEye({...exit!,y:exit!.y+1.68});const yaw=boat.exitHeading(exit!);for(let i=0;i<800&&walker.position.z>l.z+.8;i++)walker.update(1/60,{x:-Math.sin(yaw),z:-Math.cos(yaw)});expect(walker.position.z,l.id).toBeLessThan(l.z+1);expect(walker.position.y,l.id).toBeGreaterThanOrEqual(l.landY-.25);
 }
},20000);
