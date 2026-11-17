import {SignalTuning,type SignalSite} from '../gameplay/coast-signals';

/** A native modal owns focus and input while the physical player remains stopped. */
export class SignalConsole {
 private dialog=document.createElement('dialog');private tuning:SignalTuning|undefined;
 private bearing:HTMLInputElement;private frequency:HTMLInputElement;private status:HTMLOutputElement;private meter:HTMLMeterElement;private transmit:HTMLButtonElement;
 constructor(root:HTMLElement,private callbacks:{open:(site:SignalSite)=>void;change:(tuning:SignalTuning)=>void;complete:(site:SignalSite)=>void;close:()=>void}){
  this.dialog.className='mc-signal-console';this.dialog.setAttribute('aria-label','海岸设备调试');
  this.dialog.innerHTML=`<form method="dialog"><div class="mc-signal-heading"><small>COAST WATCH · FIELD EQUIPMENT</small><button aria-label="关闭设备调试" value="close">✕</button></div><h2></h2><p data-instructions></p><div class="mc-signal-scope"><span data-station></span><meter min="0" max="1" value="0" aria-label="信号强度"></meter><output aria-live="polite"></output></div><label data-frequency>接收频率 <b data-frequency-value></b><input type="range" min="0" max="100" step="1" value="25" aria-label="接收频率"></label><label>方向手轮 <b data-bearing-value></b><input type="range" min="0" max="100" step="1" value="18" aria-label="方向手轮"></label><div class="mc-signal-actions"><button type="button" data-transmit>按住 · 确认信号</button><span>保持稳定约 2 秒<br>松开可重新调整 · Esc 返回</span></div></form>`;
  this.bearing=this.dialog.querySelector('[aria-label="方向手轮"]')!;this.frequency=this.dialog.querySelector('[aria-label="接收频率"]')!;this.status=this.dialog.querySelector('output')!;this.meter=this.dialog.querySelector('meter')!;this.transmit=this.dialog.querySelector('[data-transmit]')!;
  for(const input of [this.bearing,this.frequency])input.addEventListener('input',()=>{if(!this.tuning)return;this.tuning.bearing=Number(this.bearing.value);this.tuning.frequency=Number(this.frequency.value);this.callbacks.change(this.tuning);this.render();});
  this.transmit.addEventListener('pointerdown',e=>{e.preventDefault();this.transmit.focus();this.transmit.setPointerCapture(e.pointerId);if(this.tuning)this.tuning.holding=true;});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])this.transmit.addEventListener(event,()=>{if(this.tuning)this.tuning.holding=false;});
  this.transmit.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();if(this.tuning)this.tuning.holding=true;}});
  this.transmit.addEventListener('keyup',()=>{if(this.tuning)this.tuning.holding=false;});
  this.dialog.addEventListener('close',()=>{if(this.tuning)this.tuning.holding=false;this.tuning=undefined;this.callbacks.close();});
  window.addEventListener('blur',()=>{if(this.tuning)this.tuning.holding=false;});root.append(this.dialog);
 }
 get activeSite(){return this.tuning?.site;}
 get isOpen(){return this.dialog.open;}
 open(site:SignalSite){this.callbacks.open(site);this.tuning=new SignalTuning(site);this.bearing.value='18';this.frequency.value='25';const cape=site==='cape-signal';this.dialog.querySelector('h2')!.textContent=cape?'西岬 · 转动航标透镜':'松林 · 寻找海岸呼号';this.dialog.querySelector('[data-instructions]')!.textContent=cape?'转动手轮，让旋转光束指向海上的青色标灯。对准后，按住确认锁定；灯塔会保持转动。':'调频时看表针，转动方向手轮时观察台顶天线。接收最清晰后，按住发送呼叫。';this.dialog.querySelector('[data-station]')!.textContent=cape?'海上标灯方位 205°':'巡岸频道 · 91.84 MHz / 天线 137°';(this.dialog.querySelector('[data-frequency]')! as HTMLElement).hidden=cape;this.transmit.textContent=cape?'按住 · 锁定航标':'按住 · 发送呼叫';this.transmit.disabled=false;this.bearing.disabled=this.frequency.disabled=false;this.render();this.dialog.showModal();this.callbacks.change(this.tuning);}
 update(dt:number){if(!this.tuning)return;if(this.tuning.update(dt)){this.callbacks.complete(this.tuning.site);this.transmit.disabled=true;this.bearing.disabled=this.frequency.disabled=true;this.transmit.textContent='✓ 信号已接通';}this.render();}
 close(){if(this.isOpen)this.dialog.close();}
 private render(){const t=this.tuning;if(!t)return;this.meter.value=t.strength;this.dialog.dataset.site=t.site;this.dialog.dataset.progress=t.progress.toFixed(2);this.dialog.dataset.aligned=String(t.aligned);this.dialog.querySelector('[data-frequency-value]')!.textContent=`${(88+t.frequency*.06).toFixed(2)} MHz`;this.dialog.querySelector('[data-bearing-value]')!.textContent=`${Math.round(t.bearing*3.6)}°`;const text=t.completed?(t.site==='cape-signal'?'航标锁定 · 海上标灯正在回应':'呼号回应 · 海岸信号已经接通'):t.aligned?`信号稳定 · 按住${t.site==='cape-signal'?'锁定':'发送'} ${Math.round(t.progress*100)}%`:`${t.site==='cape-signal'?'光束对准':'接收清晰度'} ${Math.round(t.strength*100)}%`;if(this.status.textContent!==text)this.status.textContent=text;}
}
