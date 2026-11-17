import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {WorldPersistence,type PlayerState} from '../src/persistence/storage';
import {discoveryPrompt,validateDiscoveries} from '../src/gameplay/discoveries';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';

const options={worldVersion:'mirror-coast-v1',seed:48271},instances:WorldPersistence[]=[];
const create=()=>{const p=new WorldPersistence(options);instances.push(p);return p;};
const player=():PlayerState=>({position:{x:20,y:17.68,z:20},rotation:{x:0,y:0,z:0},mode:'walk'});
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
afterEach(()=>{instances.splice(0).forEach(p=>p.dispose());vi.unstubAllGlobals();});

describe('persistent coastal discoveries',()=>{
  it('loads legacy players without requiring a journal and retains existing edits',async()=>{
    const p=create();p.record([{x:10,y:15,z:10,material:0}]);p.setPlayer(player());await p.flush();
    const old=await create().load();expect(old?.player?.discoveries).toBeUndefined();expect(old?.edits).toEqual([{x:10,y:15,z:10,material:0}]);
  });
  it('saves progress without aliasing caller, loaded or exported arrays',async()=>{
    const p=create(),state=player();state.discoveries=['forest-radio'];p.setPlayer(state);state.discoveries.push('cape-signal');await p.flush();
    const loaded=await create().load();expect(loaded?.player?.discoveries).toEqual(['forest-radio']);loaded!.player!.discoveries!.push('tidal-rescue');
    expect(JSON.parse(await p.exportSave()).player.discoveries).toEqual(['forest-radio']);
    p.setPlayer({...player(),discoveries:['forest-radio','tidal-rescue']});await p.flush();
    expect((await create().load())?.player?.discoveries).toEqual(['forest-radio','tidal-rescue']);
  });
  it('rejects unknown, duplicate and oversized progress without overwriting a valid save',async()=>{
    const p=create();p.setPlayer({...player(),discoveries:['cape-signal']});await p.flush();
    for(const bad of ['all',['unknown'],['forest-radio','forest-radio'],[null],Array(10).fill('cape-signal')])expect(()=>validateDiscoveries(bad)).toThrow();
    await expect(p.importSave(JSON.stringify({format:'mirror-coast-save',schemaVersion:1,...options,updatedAt:'2026-11-12T00:00:00Z',edits:[],player:{...player(),discoveries:['unknown']}}))).rejects.toThrow();
    expect((await create().load())?.player?.discoveries).toEqual(['cape-signal']);
  });
});
describe('physical exploration interaction',()=>{
  const site={id:'forest-radio',title:'电台',position:{x:20.5,y:18,z:20.5},anchors:[{x:20,y:17,z:20}],description:'天线',actionHint:'接通电台'};
  it('requires a reachable eye-height target and rejects a deck far overhead',()=>{
    const world=new VoxelWorld();world.setVoxel(20,17,20,Material.Wood);
    expect(discoveryPrompt(world,{x:20.5,y:18,z:23},[site])?.intact).toBe(true);
    expect(discoveryPrompt(world,{x:20.5,y:12,z:20.5},[site])).toBeNull();
  });
  it('prevents interacting through a wall but allows recording an actually reached wreck',()=>{
    const world=new VoxelWorld();world.setVoxel(20,17,20,Material.Wood);world.setVoxel(20,18,22,Material.Brick);
    expect(discoveryPrompt(world,{x:20.5,y:18,z:23.5},[site])).toBeNull();
    world.setVoxel(20,18,22,Material.Air);world.setVoxel(20,17,20,Material.Air);
    expect(discoveryPrompt(world,{x:20.5,y:18,z:23.5},[site])?.intact).toBe(false);
  });
});
