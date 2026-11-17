import {describe,it,expect,vi,afterEach} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {VoxelWorld,WORLD_VERSION,WORLD_SEED} from '../src/world/voxel';
import {addHarborPassage} from '../src/world/harbor-passage';
import {HarborPassage,validateCoastOuting} from '../src/gameplay/harbor-passage';
import {VoxelWalker} from '../src/input/walk';
import {WorldPersistence} from '../src/persistence/storage';
import {CoastalJourney} from '../src/gameplay/coastal-journey';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {addHarborQuarter} from '../src/world/harbor-quarter';
const bounds={minX:-32,maxX:32,minZ:224,maxZ:256};
function passage(){const w=new VoxelWorld(bounds);addHarborPassage(w);return w;}
function clear(w:VoxelWorld){const edits=[];for(let x=3;x<=5;x++)for(let z=231;z<=232;z++)for(let y=15;y<=16;y++)edits.push({x,y,z,material:0});w.applyEdits(edits);return edits;}
afterEach(()=>vi.unstubAllGlobals());
describe('a persistent route made through the harbor crates',()=>{
 it('builds the side pier after regional terrain has established its negative coordinates',()=>{
  const {world,buildings}=generateWorld();addHarborQuarter(world,buildings);addRegionalTerrain(world);addRegionalDistricts(world,buildings);addHarborPassage(world,buildings);
  const p=new HarborPassage(world);expect(p.status).toBe('blocked');expect(world.getVoxel(-10,14,232)).toBe(13);clear(world);expect(p.status).toBe('open');
 });
 it('blocks a real walker, opens after excavation, and allows walking in both directions',()=>{
  const w=passage(),p=new HarborPassage(w),m=new VoxelWalker(w,{x:7,y:15,z:232});
  for(let i=0;i<100;i++)m.update(1/60,{x:-1,z:0});expect(m.position.x).toBeGreaterThan(6);expect(p.status).toBe('blocked');
  clear(w);expect(p.status).toBe('open');
  for(let i=0;i<360&&m.position.x>-9;i++){m.update(1/60,{x:-1,z:0});expect(m.recoveredLastStep).toBe(false);}expect(m.position.x).toBeLessThan(-8.8);expect(m.position.y).toBeCloseTo(15);
  for(let i=0;i<360&&m.position.x<7;i++){m.update(1/60,{x:1,z:0});expect(m.recoveredLastStep).toBe(false);}expect(m.position.x).toBeGreaterThan(6.8);
 });
 it('does not mistake a narrow slot or a blasted-away deck for a usable path',()=>{
  const w=passage(),p=new HarborPassage(w);for(let x=3;x<=5;x++)for(let y=15;y<=16;y++)w.setVoxel(x,y,231,0);expect(p.status).toBe('blocked');clear(w);expect(p.status).toBe('open');
  for(let z=230;z<=233;z++)w.setVoxel(4,14,z,0);expect(p.status).toBe('broken');w.setVoxel(4,14,231,13);w.setVoxel(4,14,232,13);expect(p.status).toBe('open');
 });
 it('recognizes the physical record table locally and loses the interaction with its support',()=>{
  const w=passage(),p=new HarborPassage(w);clear(w);expect(p.nearLog({x:-9.5,y:15,z:232.5},{x:-9.5,y:16.68,z:232.5})).toBe(true);expect(p.nearLog({x:-7.8,y:15,z:232.5},{x:-7.8,y:16.68,z:232.5})).toBe(false);w.setVoxel(-12,14,232,0);expect(p.nearLog({x:-9.5,y:15,z:232.5},{x:-9.5,y:16.68,z:232.5})).toBe(false);
 });
 it('restores actual missing crates and linked lights without changing other edits, and accepts older saves',async()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());const p=new WorldPersistence({bounds,worldVersion:WORLD_VERSION,seed:WORLD_SEED,slot:'harbor-roundtrip'});await p.load();const w=passage(),s=new HarborPassage(w);expect(s.linkBeacon()).toBe(false);p.record([...clear(w),{x:20,y:8,z:245,material:0}]);s.readLog();s.linkBeacon();p.setPlayer({position:{x:-9,y:16.68,z:232},rotation:{x:0,y:0,z:0},coast:s.snapshot});await p.flush();const exported=await p.exportSave();p.dispose();
  const next=new WorldPersistence({bounds,worldVersion:WORLD_VERSION,seed:WORLD_SEED,slot:'harbor-roundtrip'}),saved=await next.load();const w2=passage();w2.applyEdits(saved!.edits);const restored=new HarborPassage(w2,saved!.player!.coast);expect(restored.status).toBe('open');expect(restored.state).toEqual({logRead:true,beaconLinked:true});expect(saved!.edits).toContainEqual({x:20,y:8,z:245,material:0});expect(JSON.parse(exported).player.coast).toEqual(restored.snapshot);next.dispose();expect(new HarborPassage(w2).state.logRead).toBe(false);expect(()=>validateCoastOuting({logRead:false,beaconLinked:true})).toThrow();
 });
 it('requires the physical log and an operated beacon on the new route, preserving old route progress',()=>{
  const j=new CoastalJourney();j.beginCoastalRoute();j.state.step=1;
  const dwell=(e={})=>{for(let i=0;i<30;i++)j.update(.1,{x:-10,y:15,z:232.5},'walk',undefined,e);};dwell();expect(j.state.step).toBe(1);expect(j.navigationTarget({x:20,y:15,z:232},'walk')).toBe('harbor-log');dwell({harborLog:true});expect(j.state.step).toBe(2);
  j.state.step=4;const tick=(linked:boolean)=>{for(let i=0;i<30;i++)j.update(.1,{x:-187,y:21,z:126.5},'walk',undefined,{discoveries:new Set(['cape-signal']),beaconLinked:linked});};tick(false);expect(j.state.step).toBe(4);tick(true);expect(j.state.step).toBe(5);
  const old=new CoastalJourney();old.restore({step:4,active:true,route:'coast-road'});for(let i=0;i<30;i++)old.update(.1,{x:-187,y:21,z:126.5},'walk',undefined,{discoveries:new Set(['cape-signal'])});expect(old.state.step).toBe(5);
 });
});
