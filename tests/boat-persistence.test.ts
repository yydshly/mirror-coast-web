import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {WorldPersistence,type PlayerState} from '../src/persistence/storage';
const instances:WorldPersistence[]=[];beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));afterEach(()=>{instances.forEach(p=>p.dispose());instances.length=0;vi.unstubAllGlobals();});
const create=()=>{const p=new WorldPersistence({worldVersion:'boat-save-test',seed:48271});instances.push(p);return p;};
const pose=():PlayerState=>({position:{x:120,y:13.76,z:240},rotation:{x:0,y:Math.PI,z:0},mode:'fly',navigationTarget:'boat-cape',boat:{position:{x:120,y:12.08,z:240},heading:Math.PI,piloting:true}});
it('preserves the boat helm, navigation target and deep-water resume with defensive copies',async()=>{
 const p=create(),player=pose(),expected=structuredClone(player);p.setPlayer(player,17.2);player.boat!.position.x=600;await p.flush();const loaded=await create().load();expect(loaded?.player).toEqual(expected);loaded!.player!.boat!.position.x=0;expect(JSON.parse(await p.exportSave()).player).toEqual(expected);
});
it('rejects an invalid boat import without replacing the current world and journey',async()=>{
 const p=create();p.setPlayer(pose(),17.2);await p.flush();const before=JSON.parse(await p.exportSave()),invalid=structuredClone(before);invalid.player.boat.heading='invalid';await expect(p.importSave(JSON.stringify(invalid))).rejects.toThrow('小艇');expect(JSON.parse(await p.exportSave()).player).toEqual(before.player);
});
it('continues accepting existing saves which have no boat field',async()=>{
 const p=create(),player=pose();delete player.boat;p.setPlayer(player,17.2);await p.flush();const save=await p.exportSave(),copy=create();await copy.importSave(save);expect((await copy.load())?.player).toEqual(player);
});
