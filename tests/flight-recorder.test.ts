import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {recordClip} from '../src/rendering/flight-recorder';

class Track extends EventTarget{readyState='live';stop=vi.fn(()=>{this.readyState='ended';});constructor(readonly surface='browser'){super();}getSettings(){return{displaySurface:this.surface};}}
class Recorder{
 static instances:Recorder[]=[];static isTypeSupported=()=>true;state='inactive';mimeType:string;onstop:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null;onerror:(()=>void)|null=null;
 constructor(readonly stream:unknown,options:{mimeType:string}){this.mimeType=options.mimeType;Recorder.instances.push(this);}
 start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['real-stream-test-chunk'])});this.onstop?.();}
}
const settings={source:'scene' as const,seconds:20,frameRate:30,audio:false,countdown:0};
function stream(surface='browser',audio=false){const video=new Track(surface),sound=new Track(),value={getVideoTracks:()=>[video],getAudioTracks:()=>audio?[sound]:[],getTracks:()=>audio?[video,sound]:[video]};return{video,sound,value:value as unknown as MediaStream};}
beforeEach(()=>{vi.useFakeTimers();Recorder.instances=[];vi.stubGlobal('MediaRecorder',Recorder);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('recording lifecycle and capture scope',()=>{
 it('stops manually, retains captured data and releases its canvas tracks',async()=>{
  const s=stream(),captureStream=vi.fn(()=>s.value),abort=new AbortController();const result=recordClip({captureStream} as unknown as HTMLCanvasElement,{...settings,signal:abort.signal});await Promise.resolve();
  abort.abort();expect((await result).size).toBeGreaterThan(0);expect(captureStream).toHaveBeenCalledWith(30);expect(s.video.stop).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('cancels the countdown without starting an encoder or leaving tracks live',async()=>{
  const s=stream(),abort=new AbortController(),promise=recordClip({captureStream:()=>s.value} as unknown as HTMLCanvasElement,{...settings,countdown:3,signal:abort.signal});const rejected=expect(promise).rejects.toMatchObject({name:'AbortError'});abort.abort();await rejected;expect(Recorder.instances).toHaveLength(0);expect(s.video.stop).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('requests a browser-owned page picker directly and saves already recorded frames when sharing ends',async()=>{
  const s=stream('browser',true),getDisplayMedia=vi.fn((_options:unknown)=>Promise.resolve(s.value));vi.stubGlobal('navigator',{mediaDevices:{getDisplayMedia}});const promise=recordClip({} as HTMLCanvasElement,{...settings,source:'page',audio:true});
  expect(getDisplayMedia).toHaveBeenCalledOnce();expect(getDisplayMedia.mock.calls[0][0]).toMatchObject({audio:true,preferCurrentTab:true,systemAudio:'exclude'});await Promise.resolve();s.video.dispatchEvent(new Event('ended'));expect((await promise).type).toContain('mp4');expect(s.video.stop).toHaveBeenCalled();expect(s.sound.stop).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('does not silently record a monitor and releases rejected capture tracks',async()=>{
  const s=stream('monitor');vi.stubGlobal('navigator',{mediaDevices:{getDisplayMedia:()=>Promise.resolve(s.value)}});await expect(recordClip({} as HTMLCanvasElement,{...settings,source:'page'})).rejects.toThrow('当前游戏标签页');expect(s.video.stop).toHaveBeenCalled();expect(Recorder.instances).toHaveLength(0);
 });
 it('finishes at the requested time and leaves no clock behind',async()=>{
  const s=stream(),promise=recordClip({captureStream:()=>s.value} as unknown as HTMLCanvasElement,{...settings,seconds:2});await vi.advanceTimersByTimeAsync(2000);expect((await promise).size).toBeGreaterThan(0);expect(vi.getTimerCount()).toBe(0);
 });
});
