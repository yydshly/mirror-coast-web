import {afterEach,expect,it,vi} from 'vitest';
import {GraphicsRecovery} from '../src/rendering/graphics-recovery';
afterEach(()=>vi.useRealTimers());
function setup(save:()=>Promise<void>=async()=>{}){
 const options={pause:vi.fn(),save:vi.fn(save),resume:vi.fn(),reload:vi.fn(),change:vi.fn(),timeoutMs:1000};
 return{options,recovery:new GraphicsRecovery(options)};
}
it('freezes immediately, coalesces an in-flight save and requires both restoration and a deliberate resume',async()=>{
 let finish!:()=>void;const {options,recovery}=setup(()=>new Promise<void>(resolve=>{finish=resolve;}));recovery.lost();recovery.lost();const saving=recovery.save();await Promise.resolve();expect(recovery.active).toBe(true);expect(options.save).toHaveBeenCalledTimes(1);expect(recovery.resume()).toBe(false);recovery.restored();expect(recovery.resume()).toBe(false);finish();await saving;expect(recovery.active).toBe(true);expect(options.resume).not.toHaveBeenCalled();expect(recovery.resume()).toBe(true);expect(options.resume).toHaveBeenCalledWith(true);
});
it('does not reload after a failed write, retains the scene and can retry successfully',async()=>{
 let fail=true;const {options,recovery}=setup(async()=>{if(fail)throw new Error('storage full');});recovery.lost();expect(await recovery.reload()).toBe(false);expect(options.reload).not.toHaveBeenCalled();expect(recovery.state).toMatchObject({active:true,save:'error',message:'storage full'});fail=false;expect(await recovery.reload()).toBe(true);expect(options.reload).toHaveBeenCalledTimes(1);
});
it('bounds a hung save and allows recovery of the live scene without claiming persistence succeeded',async()=>{
 vi.useFakeTimers();const {options,recovery}=setup(()=>new Promise(()=>{}));recovery.lost();const saving=recovery.save();await vi.advanceTimersByTimeAsync(1001);expect(await saving).toBe(false);expect(recovery.state.save).toBe('error');expect(options.reload).not.toHaveBeenCalled();recovery.restored();expect(recovery.resume()).toBe(true);expect(options.resume).toHaveBeenCalledWith(false);
});
it('requires restoration again if graphics are lost twice before continuing',async()=>{
 const {recovery}=setup();recovery.lost();await recovery.save();recovery.restored();recovery.lost();await recovery.save();expect(recovery.state.restored).toBe(false);expect(recovery.resume()).toBe(false);recovery.restored();expect(recovery.resume()).toBe(true);
});
it('keeps the world paused if rebuilding graphics resources fails',async()=>{
 const {options,recovery}=setup();options.resume.mockImplementation(()=>{throw new Error('probe upload failed');});recovery.lost();await recovery.save();recovery.restored();expect(recovery.resume()).toBe(false);expect(recovery.state).toMatchObject({active:true,restored:false,save:'saved'});expect(recovery.state.message).toContain('probe upload failed');expect(options.reload).not.toHaveBeenCalled();
});
