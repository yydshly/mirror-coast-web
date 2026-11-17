import {journeyLabel} from '../persistence/journeys';

/** Opening another journey changes the selected slot, never clears an old one. */
export class JourneyPicker{
 private readonly dialog=document.createElement('dialog');
 private current:string|undefined;
 constructor(root:HTMLElement,private callbacks:{open:()=>void;list:()=>Promise<Array<string|null>>;choose:(slot?:string)=>void;create:()=>void}){
  this.dialog.className='mc-journey-picker mc-panel';this.dialog.setAttribute('aria-labelledby','mc-journey-title');
  this.dialog.innerHTML='<header><h2 id="mc-journey-title">继续，或重新出发。</h2><button data-journey-close aria-label="关闭旅程选择">×</button></header><p>浏览器会恢复当前旅程的位置、破坏和探索进度。新旅程从完整城市与初始位置开始，原进度会保留。</p><b data-journey-current></b><button class="mc-journey-continue" data-journey-close>继续当前旅程</button><button class="mc-journey-new">从头开始 · 保留旧存档</button><label>其他旅程<select aria-label="选择已有旅程"></select></label><button class="mc-journey-switch">切换到所选旅程</button><small role="status" data-journey-note></small>';
  root.append(this.dialog);
  this.dialog.querySelectorAll('[data-journey-close]').forEach(b=>b.addEventListener('click',()=>this.close()));
  this.dialog.querySelector('.mc-journey-new')!.addEventListener('click',()=>this.callbacks.create());
  this.dialog.querySelector('.mc-journey-switch')!.addEventListener('click',()=>{const slot=this.dialog.querySelector('select')!.value;this.callbacks.choose(slot||undefined);});
  this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  for(const type of ['pointerdown','pointerup','click','wheel'])this.dialog.addEventListener(type,e=>e.stopPropagation());
 }
 setCurrent(slot?:string):void{this.current=slot;this.dialog.querySelector('[data-journey-current]')!.textContent=`当前：${journeyLabel(slot)} · 本机自动存档`;}
 get isOpen(){return this.dialog.open;}
 async open():Promise<void>{
  if(this.isOpen)return;this.callbacks.open();this.dialog.showModal();this.dialog.querySelector<HTMLButtonElement>('.mc-journey-continue')!.focus();
  const select=this.dialog.querySelector('select')!,switchButton=this.dialog.querySelector<HTMLButtonElement>('.mc-journey-switch')!,note=this.dialog.querySelector('[data-journey-note]')!;select.replaceChildren();switchButton.disabled=true;note.textContent='正在读取已有旅程…';
  try{const slots=await this.callbacks.list();for(const slot of slots){if((slot??undefined)===this.current)continue;const option=document.createElement('option');option.value=slot??'';option.textContent=journeyLabel(slot);select.append(option);}switchButton.disabled=!select.options.length;select.disabled=!select.options.length;note.textContent=select.options.length?'切换前会保存当前旅程。':'暂时没有其他旅程，新建后可在这里切换。';}
  catch{note.textContent='旅程列表读取失败，原存档未改变。';}
 }
 close():void{if(this.isOpen)this.dialog.close();}
 dispose():void{this.dialog.remove();}
}
