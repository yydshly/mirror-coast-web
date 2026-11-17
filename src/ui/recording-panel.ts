import type {RecordingSource} from '../rendering/flight-recorder';
import {controlGuide,MODE_NAMES,type ControlMode} from '../input/control-guide';
export type ClipSettings={source:RecordingSource;seconds:number;frameRate:number;audio:boolean;countdown:number;title:string;description:string;guide:boolean};

export class RecordingPanel{
 private readonly dialog=document.createElement('dialog');
 private readonly status=document.createElement('div');
 private readonly caption=document.createElement('section');
 private mode:ControlMode='fly';
 private active=false;
 private captionKey='';
 private clipURL:string|undefined;
 private settings:ClipSettings|undefined;
 constructor(root:HTMLElement,private callbacks:{open:()=>void;start:(settings:ClipSettings)=>void;stop:()=>void}){
  this.dialog.className='mc-recorder-dialog mc-panel';this.dialog.setAttribute('aria-labelledby','mc-recorder-title');
  this.dialog.innerHTML='<header><div><small>IN-ENGINE · LOCAL RECORDING</small><h2 id="mc-recorder-title">把这段体验录下来。</h2></div><button data-rec-close aria-label="关闭录制设置">×</button></header><div class="mc-rec-source"><label><input type="radio" name="recording-source" value="page" checked>带界面讲解<small>录到当前标签页的文字、地图和操作面板</small></label><label><input type="radio" name="recording-source" value="scene">纯场景<small>只录游戏画面，适合剪辑预告片；不含文字或声音</small></label></div><p data-rec-source-note>开始后，在浏览器选择器中选择当前游戏标签页。</p><div class="mc-rec-options"><label>时长<select data-rec-seconds><option value="20">20 秒</option><option value="60">60 秒</option><option value="120">120 秒</option><option value="180">手动停止（最长 3 分钟）</option></select></label><label>帧率<select data-rec-fps><option value="30">30 FPS · 推荐</option><option value="60">60 FPS · 性能充足时</option></select></label><label>准备时间<select data-rec-countdown><option value="3">倒计时 3 秒</option><option value="0">立即开始</option></select></label></div><fieldset data-rec-annotations><legend>讲解内容（可选）</legend><label>标题<input data-rec-title maxlength="60" placeholder="例如：海岸驾驶 · 碰撞与倒车脱离"></label><label>文字介绍<textarea data-rec-description maxlength="240" rows="2" placeholder="填写这段画面要展示的内容，随页面一起录下。"></textarea></label><label class="mc-rec-check"><input type="checkbox" data-rec-guide checked>显示当前模式的快捷键说明</label><label class="mc-rec-check"><input type="checkbox" data-rec-audio>包含标签页声音（还需在选择器勾选共享音频）</label></fieldset><p class="mc-rec-shortcuts">F9 录制设置 / 停止保存 · F8 收起 / 显示常规界面 · Tab 当前模式操作说明</p><button data-rec-start>开始录制</button><div class="mc-rec-result" hidden><h3>录像预览</h3><video controls playsinline preload="metadata"></video><p data-rec-result-note></p><a data-rec-download>下载录像</a></div><p role="status" data-rec-error></p>';
  this.status.className='mc-record-status';this.status.hidden=true;this.status.innerHTML='<i></i><b data-rec-progress></b><span data-rec-track></span><button>停止并保存 · F9</button>';
  this.caption.className='mc-record-caption';this.caption.hidden=true;this.caption.innerHTML='<h3></h3><p></p><div data-rec-control-guide></div>';
  root.append(this.dialog,this.status,this.caption);
  this.dialog.querySelector('[data-rec-close]')!.addEventListener('click',()=>this.close());
  this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  this.dialog.querySelectorAll<HTMLInputElement>('[name="recording-source"]').forEach(input=>input.addEventListener('change',()=>this.updateSource()));
  this.dialog.querySelector('[data-rec-start]')!.addEventListener('click',()=>{const settings=this.readSettings();this.settings=settings;this.dialog.querySelector('[data-rec-error]')!.textContent='';this.close();this.callbacks.start(settings);});
  const retry=document.createElement('button');retry.className='mc-rec-retry';retry.textContent='调整设置 / 再录一次';this.dialog.querySelector('.mc-rec-result')!.append(retry);retry.addEventListener('click',()=>{this.dialog.scrollTo({top:0,behavior:'smooth'});this.dialog.querySelector<HTMLButtonElement>('[data-rec-start]')!.focus({preventScroll:true});});
  this.status.querySelector('button')!.addEventListener('click',()=>this.callbacks.stop());
  for(const element of [this.dialog,this.status])for(const type of ['pointerdown','pointerup','click','wheel'])element.addEventListener(type,e=>e.stopPropagation());
 }
 private readSettings():ClipSettings{return{source:this.dialog.querySelector<HTMLInputElement>('[name="recording-source"]:checked')!.value as RecordingSource,seconds:Number(this.dialog.querySelector<HTMLSelectElement>('[data-rec-seconds]')!.value),frameRate:Number(this.dialog.querySelector<HTMLSelectElement>('[data-rec-fps]')!.value),countdown:Number(this.dialog.querySelector<HTMLSelectElement>('[data-rec-countdown]')!.value),audio:this.dialog.querySelector<HTMLInputElement>('[data-rec-audio]')!.checked,title:this.dialog.querySelector<HTMLInputElement>('[data-rec-title]')!.value.trim(),description:this.dialog.querySelector<HTMLTextAreaElement>('[data-rec-description]')!.value.trim(),guide:this.dialog.querySelector<HTMLInputElement>('[data-rec-guide]')!.checked};}
 private updateSource():void{const page=this.readSettings().source==='page';this.dialog.querySelector<HTMLFieldSetElement>('[data-rec-annotations]')!.disabled=!page;this.dialog.querySelector('[data-rec-source-note]')!.textContent=page?'在浏览器选择器中选当前游戏标签页；选择范围由你确认。':'直接录制 3D 场景，不会把页面文字、快捷键、地图或声音混进视频。';}
 get isOpen(){return this.dialog.open;}
 open():void{if(this.isOpen)return;this.callbacks.open();this.updateSource();this.dialog.showModal();this.dialog.querySelector<HTMLButtonElement>('[data-rec-start]')!.focus();}
 close():void{if(this.isOpen)this.dialog.close();}
 setMode(mode:ControlMode):void{if(this.mode===mode)return;this.mode=mode;this.updateCaption();}
 private updateCaption():void{
  const s=this.settings;if(!s)return;this.caption.hidden=!this.active||s.source!=='page'||(!s.title&&!s.description&&!s.guide);
  const key=JSON.stringify([this.mode,s.title,s.description,s.guide]);if(key===this.captionKey)return;this.captionKey=key;
  this.caption.querySelector('h3')!.textContent=s.title;this.caption.querySelector('p')!.textContent=s.description;
  this.caption.querySelector('[data-rec-control-guide]')!.textContent=s.guide?`${MODE_NAMES[this.mode]} · ${controlGuide(this.mode).map(c=>`${c.keys} ${c.action}`).join('　·　')}`:'';
 }
 progress(phase:'selecting'|'countdown'|'recording',seconds:number,audio:boolean):void{
  this.active=phase!=='selecting';this.status.hidden=false;this.updateCaption();const s=this.settings;this.status.querySelector('[data-rec-progress]')!.textContent=phase==='selecting'?'等待选择当前标签页':phase==='countdown'?`${seconds} 秒准备 · 点击场景接管`:`REC ${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')} / ${s?.seconds===180?'手动':`${s?.seconds??20}s`}`;
  this.status.querySelector('[data-rec-track]')!.textContent=phase==='selecting'?'尚未开始录制':`${s?.source==='page'?'页面与界面':'纯场景'} · ${audio?'含音轨':'无音轨'}`;this.status.querySelector('button')!.textContent=phase==='recording'?'停止并保存 · F9':'取消 · F9';
 }
 finish(blob?:Blob,error?:string):void{
  this.active=false;this.status.hidden=true;this.caption.hidden=true;
  if(blob){if(this.clipURL)URL.revokeObjectURL(this.clipURL);this.clipURL=URL.createObjectURL(blob);const video=this.dialog.querySelector('video')!;video.src=this.clipURL;const link=this.dialog.querySelector<HTMLAnchorElement>('[data-rec-download]')!;link.href=this.clipURL;link.download=`mirror-coast-${this.settings?.source??'scene'}-${new Date().toISOString().replace(/[:.]/g,'-')}.${blob.type.includes('mp4')?'mp4':'webm'}`;this.dialog.querySelector<HTMLElement>('.mc-rec-result')!.hidden=false;this.dialog.querySelector('[data-rec-result-note]')!.textContent=`${this.settings?.source==='page'?'页面与界面':'纯场景'} · ${(blob.size/1024/1024).toFixed(1)} MB · ${blob.type.includes('mp4')?'MP4':'WebM'} · 点击下载保存在本机。`;this.open();this.dialog.querySelector('.mc-rec-result')!.scrollIntoView({block:'nearest'});link.focus({preventScroll:true});}
  else if(error){this.dialog.querySelector('[data-rec-error]')!.textContent=error;this.open();this.dialog.querySelector('[data-rec-error]')!.scrollIntoView({block:'nearest'});}
 }
 dispose():void{if(this.clipURL)URL.revokeObjectURL(this.clipURL);this.dialog.remove();this.status.remove();this.caption.remove();}
}
