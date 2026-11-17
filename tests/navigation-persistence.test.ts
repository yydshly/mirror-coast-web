import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {WorldPersistence,type SavedWorld} from '../src/persistence/storage';
const instances:WorldPersistence[]=[];
const create=()=>{const p=new WorldPersistence({worldVersion:'mirror-coast-v1',seed:48271});instances.push(p);return p;};
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));
afterEach(()=>{instances.splice(0).forEach(p=>p.dispose());vi.unstubAllGlobals();});
const save:SavedWorld={format:'mirror-coast-save',schemaVersion:1,worldVersion:'mirror-coast-v1',seed:48271,updatedAt:'2026-11-13T00:00:00Z',edits:[{x:24,y:15,z:25,material:0}],player:{position:{x:135,y:17.68,z:159},rotation:{x:0,y:0,z:0},navigationTarget:'tidal-rescue'}};
describe('navigation bookmark compatibility',()=>{
 it('retains southern bay physical activity states and rejects duplicate notes without replacing the save',async()=>{
  const p=create();await p.importSave(JSON.stringify({...save,player:{...save.player,bay:{notes:['kite','pool'],kiteFlying:false}}}));expect((await create().load())?.player?.bay).toEqual({notes:['kite','pool'],kiteFlying:false});
  await expect(p.importSave(JSON.stringify({...save,player:{...save.player,bay:{notes:['kite','kite'],kiteFlying:true}}}))).rejects.toThrow('南湾');expect(JSON.parse(await p.exportSave()).player.bay.kiteFlying).toBe(false);
 });
 it('keeps a paused coastal outing through export and reload and rejects a corrupt stage',async()=>{
  const p=create();await p.importSave(JSON.stringify({...save,player:{...save.player,journey:{step:3,active:false}}}));
  expect((await create().load())?.player?.journey).toEqual({step:3,active:false});
  await expect(p.importSave(JSON.stringify({...save,player:{...save.player,journey:{step:88,active:true}}}))).rejects.toThrow('旅程');
  expect(JSON.parse(await p.exportSave()).player.journey).toEqual({step:3,active:false});
 });
 it('round-trips a seat reference without losing world edits',async()=>{
  const p=create();const seated={...save,player:{...save.player!,posture:{kind:'seated' as const,seatId:'coast-bench-61'}}};await p.importSave(JSON.stringify(seated));
  const exported=JSON.parse(await p.exportSave());expect(exported.player.posture).toEqual(seated.player.posture);expect(exported.edits).toEqual(save.edits);
  expect((await create().load())?.player?.posture?.seatId).toBe('coast-bench-61');
 });
 it('keeps the selected peripheral objective and existing destruction through export and reload',async()=>{
  const p=create();await p.importSave(JSON.stringify(save));
  const restored=await create().load();expect(restored?.player?.navigationTarget).toBe('tidal-rescue');expect(restored?.edits).toEqual(save.edits);
  expect(JSON.parse(await p.exportSave()).player.navigationTarget).toBe('tidal-rescue');
 });
 it('rejects an invalid target without replacing the current world',async()=>{
  const p=create();await p.importSave(JSON.stringify(save));
  await expect(p.importSave(JSON.stringify({...save,player:{...save.player,navigationTarget:'unknown-point'}}))).rejects.toThrow('地图目标');
  expect((await create().load())?.edits).toEqual(save.edits);
 });
});
