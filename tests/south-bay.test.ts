import {beforeAll,describe,expect,it} from 'vitest';
import {Scene,PointLight} from 'three';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {addExplorationSites} from '../src/world/exploration-sites';
import {addSouthBayLandmarks} from '../src/world/south-bay-landmarks';
import {SouthBay} from '../src/rendering/south-bay';
import {BAY_STOPS,BAY_BEACH_WALK,validateBay} from '../src/gameplay/south-bay';
import {analyzeStructure,createStructureInput} from '../src/destruction/structure';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
import {GroundActions} from '../src/input/ground-actions';
let base:ReturnType<typeof generateWorld>;
beforeAll(()=>{base=generateWorld();addRegionalTerrain(base.world);addRegionalDistricts(base.world,base.buildings);addExplorationSites(base.world,base.buildings);},30000);
describe('a living southern bay',()=>{
 it('keeps the same light slot and world position when the bay crosses the old-city distance-culling boundary',()=>{
  const scene=new Scene(),art=new SouthBay(scene,base.world),lights=()=>{const list:PointLight[]=[];scene.traverseVisible(o=>{if(o instanceof PointLight)list.push(o);});return list;};
  art.update(.016,{x:147,y:16,z:166},1);const near=lights();expect(near).toHaveLength(1);const position=near[0].position.clone();expect(near[0].intensity).toBe(5);
  art.update(.016,{x:108,y:16,z:172},1);expect(lights()).toEqual(near);expect(near[0].position).toEqual(position);
  art.update(.016,{x:628,y:16,z:157},0);expect(lights()).toEqual(near);expect(near[0].intensity).toBe(0);
 });
 it('offers sitting from the mapped sea-arch overlook arrival',()=>{
  const treads=new WalkTransitions(new Scene(),base.world),art=new SouthBay(new Scene(),base.world),arrival=BAY_STOPS[2].trail.at(-1)!,start=BAY_STOPS[2].trail.at(-2)!,motor=new VoxelWalker(base.world,{x:start.x,y:15,z:start.z});motor.setObstacleProvider(()=>[...treads.nearby(motor.position),...art.obstacles]);
  for(let i=0;i<600;i++){const dx=arrival.x-motor.position.x,dz=arrival.z-motor.position.z,d=Math.hypot(dx,dz);if(d<.15)break;motor.update(1/60,{x:dx/d,z:dz/d});}for(let i=0;i<30;i++)motor.update(1/60,{x:0,z:0});
  const actions=new GroundActions(motor,()=>motor.obstacles);actions.setSeatProvider(()=>art.seats);
  const action=actions.interaction(Math.PI);expect(action?.kind,JSON.stringify({seats:art.seats,at:motor.position,grounded:motor.grounded,status:actions.status})).toBe('sit');if(!action)throw new Error('No mapped sitting interaction');expect(actions.interact(action,Math.PI)).toBe(true);for(let i=0;i<240;i++)actions.update(1/60);expect(actions.phase).toBe('seated');expect(actions.stand()).toBe(true);for(let i=0;i<120;i++)actions.update(1/60);expect(actions.phase).toBe('standing');expect(motor.canOccupy(motor.position)).toBe(true);treads.dispose();
 });
 it('adds real rock scenery without overwriting any existing cell',()=>{
  const {world,buildings}=base,old=new Map<number,number>();for(let z=207;z<=223;z++)for(let x=701;x<=727;x++)for(let y=0;y<40;y++){const m=world.getVoxel(x,y,z);if(m)old.set(x+1024*(z+384)+1024*768*y,m);}
  expect(addSouthBayLandmarks(world,buildings)).toBeGreaterThan(1000);
  for(const [key,m]of old){const y=Math.floor(key/(1024*768)),r=key-y*1024*768,z=Math.floor(r/1024)-384,x=r%1024;expect(world.getVoxel(x,y,z)).toBe(m);}
  expect(world.getVoxel(714,20,215)).toBe(0);expect(world.getVoxel(714,29,215)).not.toBe(0);
  expect(analyzeStructure(createStructureInput(world,buildings.get('region-south-bay-sea-arch')!,'bay-rock-baseline')).edits).toHaveLength(0);
 });
 it('animates launching/reeling, the crab response, and a supported sitting place',()=>{
  const art=new SouthBay(new Scene(),base.world);expect(art.seats.length).toBe(1);expect(art.diagnostics.plants).toBeGreaterThan(300);
  const low=art.diagnostics.kiteHeight;art.interact('kite');for(let i=0;i<300;i++)art.update(1/60,{x:628,y:14,z:157},0);expect(art.diagnostics.kiteHeight-low).toBeGreaterThan(14);art.interact('kite');for(let i=0;i<300;i++)art.update(1/60,{x:628,y:14,z:157},0);expect(art.diagnostics.kiteHeight-low).toBeLessThan(.2);
  art.interact('pool');for(let i=0;i<180;i++)art.update(1/60,{x:694,y:14,z:166},0);expect(art.diagnostics.visibleCrabs).toBe(0);
  for(let i=0;i<140;i++)art.update(1/60,{x:701,y:14,z:165},0,'south-bay-overlook');expect(art.snapshot.notes).toEqual(['kite','pool','vista']);expect(validateBay(art.snapshot)).toEqual(art.snapshot);expect(()=>validateBay({notes:['kite','kite'],kiteFlying:true})).toThrow();
 });
 it('walks each road-to-beach approach with real terrain, treads and prop collision',()=>{
  const treads=new WalkTransitions(new Scene(),base.world),art=new SouthBay(new Scene(),base.world);
  for(const stop of BAY_STOPS){const a=stop.trail[0],motor=new VoxelWalker(base.world,{x:a.x,y:regionalHeightAt(a.x,a.z)+1,z:a.z});motor.setObstacleProvider(()=>[...treads.nearby(motor.position),...art.obstacles]);
   for(const target of stop.trail.slice(1)){for(let i=0;i<1800;i++){const dx=target.x-motor.position.x,dz=target.z-motor.position.z,d=Math.hypot(dx,dz);if(d<(target===stop.trail.at(-1)?2:.15))break;motor.update(1/60,{x:dx/d,z:dz/d});expect(motor.recoveredLastStep).toBe(false);}expect(Math.hypot(target.x-motor.position.x,target.z-motor.position.z),stop.id+JSON.stringify(motor.position)).toBeLessThan(2.1);}
  }treads.dispose();
 },30000);
 it('connects camp, boardwalk and the viewing seat around the pool and bench collision',()=>{
  const treads=new WalkTransitions(new Scene(),base.world),art=new SouthBay(new Scene(),base.world),a=BAY_BEACH_WALK[0],motor=new VoxelWalker(base.world,{x:a.x,y:regionalHeightAt(a.x,a.z)+1,z:a.z});motor.setObstacleProvider(()=>[...treads.nearby(motor.position),...art.obstacles]);
  for(const p of [...BAY_BEACH_WALK.slice(1),...BAY_BEACH_WALK.slice(0,-1).reverse()]){let reached=false;for(let i=0;i<1800;i++){const dx=p.x-motor.position.x,dz=p.z-motor.position.z,d=Math.hypot(dx,dz);if(d<.2){reached=true;break;}motor.update(1/60,{x:dx/d,z:dz/d});expect(motor.recoveredLastStep).toBe(false);}expect(reached,JSON.stringify({p,at:motor.position})).toBe(true);}treads.dispose();
 },30000);
});
