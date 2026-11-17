export type RecordingSource='scene'|'page';
export type RecordingOptions={source:RecordingSource;seconds:number;frameRate:number;audio:boolean;countdown:number;signal?:AbortSignal;onState?:(phase:'selecting'|'countdown'|'recording',seconds:number,hasAudio:boolean)=>void};
const cancelled=()=>new DOMException('已取消录制。','AbortError');
const stopTracks=(stream:MediaStream)=>stream.getTracks().forEach(t=>t.stop());

export function recordingMimeType(audio:boolean):string|undefined{
 return(audio?['video/mp4','video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm']:['video/mp4','video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm']).find(t=>MediaRecorder.isTypeSupported(t));
}

/** Real composited HTML + WebGL. The browser owns the surface picker. */
export async function recordClip(canvas:HTMLCanvasElement,options:RecordingOptions):Promise<Blob>{
 if(typeof MediaRecorder==='undefined')throw new Error('此浏览器不支持视频录制。');
 if(options.signal?.aborted)throw cancelled();
 const fps=Math.max(24,Math.min(60,options.frameRate)),duration=Math.max(1,Math.min(180,options.seconds||180));
 let stream:MediaStream;
 if(options.source==='page'){
  if(!navigator.mediaDevices?.getDisplayMedia)throw new Error('此浏览器无法录制页面，请改用纯场景录制，或使用支持标签页录屏的桌面浏览器。');
  options.onState?.('selecting',0,false);
  stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:{ideal:fps,max:fps}},audio:options.audio,preferCurrentTab:true,selfBrowserSurface:'include',systemAudio:'exclude',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'} as DisplayMediaStreamOptions);
  const surface=stream.getVideoTracks()[0]?.getSettings().displaySurface;
  if(surface&&surface!=='browser'){stopTracks(stream);throw new Error('请选择当前游戏标签页，以便录到页面文字与界面。');}
 }else{
  if(!canvas.captureStream)throw new Error('此浏览器不支持场景画布录制。');
  stream=canvas.captureStream(fps);
 }
 if(options.signal?.aborted){stopTracks(stream);throw cancelled();}
 if(!stream.getVideoTracks().length){stopTracks(stream);throw new Error('没有获取到视频轨道。');}
 const hasAudio=stream.getAudioTracks().length>0;
 try{
  for(let count=Math.min(5,Math.max(0,Math.floor(options.countdown)));count>0;count--){
   options.onState?.('countdown',count,hasAudio);
   await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(cancelled());};const timer=setTimeout(()=>{options.signal?.removeEventListener('abort',abort);resolve();},1000);options.signal?.addEventListener('abort',abort,{once:true});});
   if(options.signal?.aborted)throw cancelled();
  }
  if(stream.getVideoTracks()[0].readyState==='ended')throw cancelled();
  const mime=recordingMimeType(hasAudio),recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:fps>30?8_000_000:5_000_000});
  return await new Promise<Blob>((resolve,reject)=>{
   const chunks:BlobPart[]=[];let interval:ReturnType<typeof setInterval>|undefined,timer:ReturnType<typeof setTimeout>|undefined;const started=performance.now();
   const finish=()=>{if(recorder.state!=='inactive')recorder.stop();};
   const cleanup=()=>{clearTimeout(timer);clearInterval(interval);options.signal?.removeEventListener('abort',finish);for(const track of stream.getVideoTracks())track.removeEventListener('ended',finish);stopTracks(stream);};
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   recorder.onstop=()=>{cleanup();if(chunks.length)resolve(new Blob(chunks,{type:recorder.mimeType||mime||'video/webm'}));else reject(new Error('没有录到有效画面，请保持当前游戏标签页运行后重试。'));};
   recorder.onerror=()=>{cleanup();reject(new Error('录制中断，未生成完整视频。'));};
   options.signal?.addEventListener('abort',finish,{once:true});for(const track of stream.getVideoTracks())track.addEventListener('ended',finish,{once:true});
   try{recorder.start(1000);options.onState?.('recording',0,hasAudio);interval=setInterval(()=>options.onState?.('recording',Math.floor((performance.now()-started)/1000),hasAudio),250);timer=setTimeout(finish,duration*1000);}catch(error){cleanup();reject(error);}
  });
 }finally{stopTracks(stream);}
}

export function recordFlight(canvas:HTMLCanvasElement,seconds=20,frameRate=24):Promise<Blob>{return recordClip(canvas,{source:'scene',seconds,frameRate,audio:false,countdown:0});}
