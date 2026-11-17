import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {WorldPersistence,type PlayerState} from '../src/persistence/storage';
const instances:WorldPersistence[]=[];
beforeEach(()=>vi.stubGlobal('indexedDB',new IDBFactory()));afterEach(()=>{instances.forEach(p=>p.dispose());instances.length=0;vi.unstubAllGlobals();});
function create(){const p=new WorldPersistence({worldVersion:'bicycle-test',seed:48271});instances.push(p);return p;}
const pose=():PlayerState=>({position:{x:140,y:17.68,z:169.8},rotation:{x:0,y:-1.5,z:0},mode:'fly',bicycle:{position:{x:140,y:16,z:169.8},heading:-1.5,riding:true}});
it('preserves bicycle location and riding resume separately from the caller and exported snapshot',async()=>{const p=create(),value=pose(),expected=structuredClone(value);p.setPlayer(value,17.2);value.bicycle!.position.x=200;await p.flush();const restored=await create().load();expect(restored!.player).toEqual(expected);restored!.player!.bicycle!.position.x=44;expect(JSON.parse(await p.exportSave()).player).toEqual(expected);});
it('rejects an invalid bicycle import without replacing the saved journey',async()=>{const p=create();p.setPlayer(pose(),17.2);await p.flush();const before=JSON.parse(await p.exportSave()),invalid=structuredClone(before);invalid.player.bicycle.heading='bad';await expect(p.importSave(JSON.stringify(invalid))).rejects.toThrow('自行车');const after=JSON.parse(await p.exportSave());expect(after.player).toEqual(before.player);});
