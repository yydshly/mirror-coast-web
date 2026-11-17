import {beforeAll,describe,expect,it} from 'vitest';
import {Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {addExplorationSites,EXPLORATION_SITES} from '../src/world/exploration-sites';
import {addOuterLandmarks} from '../src/world/outer-landmarks';
import {OuterCoast} from '../src/rendering/outer-coast';
import {SignalTuning,FOREST_WALK} from '../src/gameplay/coast-signals';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
import {ExplorationArt} from '../src/exploration/exploration-art';
import {analyzeStructure,createStructureInput} from '../src/destruction/structure';
import {visibleFrom} from '../src/gameplay/discoveries';
let base:ReturnType<typeof generateWorld>;
beforeAll(()=>{base=generateWorld();addRegionalTerrain(base.world);addRegionalDistricts(base.world,base.buildings);addExplorationSites(base.world,base.buildings);},30000);
describe('outer coast play and access',()=>{
 it('requires actual tuning and uninterrupted transmission, including after drift',()=>{
  for(const site of ['cape-signal','forest-radio'] as const){const t=new SignalTuning(site);t.holding=true;for(let i=0;i<120;i++)t.update(1/60);expect(t.completed).toBe(false);t.bearing=t.targetBearing;t.frequency=64;for(let i=0;i<60;i++)t.update(1/60);expect(t.progress).toBeGreaterThan(.5);t.bearing+=12;for(let i=0;i<40;i++)t.update(1/60);expect(t.progress).toBe(0);t.bearing=t.targetBearing;for(let i=0;i<120;i++)t.update(1/60);expect(t.completed).toBe(true);expect(t.update(.1)).toBe(false);}
 });
 it('keeps sea stacks additive and starts them structurally stable',()=>{
  const w=base.world,old=new Map<string,number>();for(let x=-227;x<-203;x++)for(let z=171;z<193;z++)for(let y=0;y<32;y++)if(w.getVoxel(x,y,z))old.set(`${x},${y},${z}`,w.getVoxel(x,y,z));expect(addOuterLandmarks(w,base.buildings)).toBeGreaterThan(100);
  for(const [k,m]of old){const [x,y,z]=k.split(',').map(Number);expect(w.getVoxel(x,y,z)).toBe(m);}expect(analyzeStructure(createStructureInput(w,base.buildings.get('region-cape-seastacks')!,'outer')).edits).toHaveLength(0);
 });
 it('makes the quiet wildlife visible from the trail, flushes it on approach and settles it again',()=>{
  const art=new OuterCoast(new Scene(),base.world),p={x:-102,y:regionalHeightAt(-102,-231)+1,z:-231};
  expect(art.diagnostics.birds).toBe(3);
  for(const home of art.diagnostics.perches)expect(visibleFrom(base.world,{...p,y:p.y+1.68},home)).toBe(true);
  for(let i=0;i<120;i++)art.update(1/60,{...p,x:p.x+Math.sin(i)*.03},0);expect(art.diagnostics.flyingBirds).toBeGreaterThan(0);
  for(let i=0;i<900;i++)art.update(1/60,p,0);expect(art.diagnostics.flyingBirds).toBe(0);expect(art.gladeObserved).toBe(true);
 });
 it('walks the woodland loop in both directions with props and terrain, then still reaches the radio',()=>{
  const art=new OuterCoast(new Scene(),base.world),devices=new ExplorationArt(new Scene(),base.world),treads=new WalkTransitions(new Scene(),base.world),a=FOREST_WALK[0],m=new VoxelWalker(base.world,{x:a.x,y:regionalHeightAt(a.x,a.z)+1,z:a.z});m.setObstacleProvider(()=>[...art.obstacles,...devices.obstacles,...treads.nearby(m.position)]);
  const radio=EXPLORATION_SITES[0];
  for(const p of [...FOREST_WALK.slice(1),...FOREST_WALK.slice(0,-1).reverse(),...radio.route.slice(1)]){let reached=false;for(let i=0;i<1800;i++){const dx=p.x-m.position.x,dz=p.z-m.position.z,d=Math.hypot(dx,dz);if(d<.35){reached=true;break;}m.update(1/60,{x:dx/d,z:dz/d});expect(m.recoveredLastStep).toBe(false);}expect(reached,JSON.stringify({p,at:m.position})).toBe(true);}treads.dispose();devices.dispose();
 });
 it('retains cape access and removes scenery collision after actual support loss',()=>{
  const scene=new Scene(),art=new OuterCoast(scene,base.world),devices=new ExplorationArt(scene,base.world),treads=new WalkTransitions(scene,base.world),site=EXPLORATION_SITES[2],m=new VoxelWalker(base.world,{x:site.approach.x,y:site.approach.y-1.68,z:site.approach.z});m.setObstacleProvider(()=>[...art.obstacles,...devices.obstacles,...treads.nearby(m.position)]);
  for(const p of site.route.slice(1)){let reached=false;for(let i=0;i<2000;i++){const dx=p.x-m.position.x,dz=p.z-m.position.z,d=Math.hypot(dx,dz);if(d<.4){reached=true;break;}m.update(1/60,{x:dx/d,z:dz/d});}expect(reached,JSON.stringify(m.position)).toBe(true);}
  // Walk the full arrival court, including the controls and return, rather than
  // only reaching the last route coordinate next to the old bell blockage.
  for(const p of [{x:-191.5,z:126.5},{x:-190,z:128},{x:-188.1,z:127.1},{x:-190,z:128},{x:-191.5,z:126.5},...site.route.slice(0,-1).reverse()]){
    let reached=false;for(let i=0;i<2400;i++){const dx=p.x-m.position.x,dz=p.z-m.position.z,d=Math.hypot(dx,dz);if(d<.4){reached=true;break;}m.update(1/60,{x:dx/d,z:dz/d});expect(m.recoveredLastStep).toBe(false);}expect(reached,JSON.stringify({p,at:m.position})).toBe(true);
  }
  const n=art.obstacles.length,material=base.world.getVoxel(-194,20,130);base.world.setVoxel(-194,20,130,0);art.sync();expect(art.obstacles.length).toBeLessThan(n);base.world.setVoxel(-194,20,130,material);art.sync();treads.dispose();devices.dispose();
 });
});
