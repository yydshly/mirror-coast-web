import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {WorldPersistence,type SavedWorld} from '../src/persistence/storage';
import type {DecorationState} from '../src/destruction/decorations';
const instances:WorldPersistence[]=[];
const create=()=>{const p=new WorldPersistence({worldVersion:'mirror-coast-v1',seed:48271});instances.push(p);return p;};
const prop=():DecorationState=>({id:'street:10,15,10;11,15,10',position:{x:10,y:12,z:10},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:-2,z:0},angularVelocity:{x:.2,y:0,z:0}});
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));afterEach(()=>{instances.splice(0).forEach(p=>p.dispose());vi.unstubAllGlobals();});
it('persists fallen decoration poses and velocities without changing legacy edits or sharing mutable references',async()=>{
 const p=create(),state=prop();p.record([{x:10,y:15,z:10,material:0}]);p.setPlayer({position:{x:1,y:20,z:3},rotation:{x:0,y:0,z:0},props:[state]},17);
 state.position.y=999;await p.flush();const saved=await create().load();expect(saved?.player?.props?.[0].position.y).toBe(12);expect(saved?.edits).toEqual([{x:10,y:15,z:10,material:0}]);
 const exported=JSON.parse(await p.exportSave()) as SavedWorld;expect(exported.player?.props?.[0].linearVelocity.y).toBe(-2);
});
it('rejects duplicate identities and invalid rotations atomically while preserving the previous save',async()=>{
 const p=create();p.record([{x:10,y:15,z:10,material:0}]);await p.flush();const original=JSON.parse(await p.exportSave());
 const edited={...original,player:{position:{x:1,y:20,z:3},rotation:{x:0,y:0,z:0},props:[prop(),prop()]}};
 await expect(p.importSave(JSON.stringify(edited))).rejects.toThrow('编号');edited.player.props=[{...prop(),rotation:{x:0,y:0,z:0,w:0}}];
 await expect(p.importSave(JSON.stringify(edited))).rejects.toThrow('归一化');expect((await create().load())?.edits).toEqual(original.edits);
});
