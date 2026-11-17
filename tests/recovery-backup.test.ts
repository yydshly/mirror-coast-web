import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {WorldPersistence} from '../src/persistence/storage';
let persistence:WorldPersistence;beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());persistence=new WorldPersistence({worldVersion:'recovery-backup-test',seed:48271});});afterEach(()=>{persistence.dispose();vi.unstubAllGlobals();});
it('exports the current memory snapshot without trying another browser write',async()=>{
 await persistence.load();const edit={x:104,y:18,z:152,material:0};persistence.record([edit]);persistence.setPlayer({position:{x:104,y:19.68,z:153},rotation:{x:0,y:1,z:0},mode:'walk'},17.2);
 const flush=vi.spyOn(persistence,'flush').mockRejectedValue(new Error('storage full'));const backup=JSON.parse(persistence.exportMemorySave());expect(flush).not.toHaveBeenCalled();expect(backup.edits).toEqual([edit]);expect(backup.player.position).toEqual({x:104,y:19.68,z:153});expect(backup.timeOfDay).toBe(17.2);
});
it('does not describe an unread existing world as a complete memory backup',async()=>{
 vi.stubGlobal('indexedDB',{open(){throw new Error('database inaccessible');}});await expect(persistence.load()).rejects.toThrow();expect(()=>persistence.exportMemorySave()).toThrow();
});
it.each(['car','helicopter'] as const)('round trips the active %s mode while keeping older saves valid',async activeVehicle=>{
 await persistence.load();persistence.setPlayer({position:{x:104,y:19.68,z:153},rotation:{x:0,y:1,z:0},mode:'fly',activeVehicle},17.2);const backup=persistence.exportMemorySave();await persistence.importSave(backup);expect((await persistence.load())?.player?.activeVehicle).toBe(activeVehicle);
});
