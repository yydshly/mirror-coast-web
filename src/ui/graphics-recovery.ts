import type {GraphicsRecoveryState} from '../rendering/graphics-recovery';
type Actions={resume:()=>void;reload:()=>void;save:()=>void;backup:()=>Promise<void>};

/** A separate overlay leaves the original game DOM and its mode intact. */
export class GraphicsRecoveryPanel{
 private panel:HTMLElement;private saveText:HTMLElement;private status:HTMLElement;private resumeButton:HTMLButtonElement;private reloadButton:HTMLButtonElement;
 constructor(actions:Actions){
  this.panel=document.createElement('section');this.panel.className='mc-startup-error mc-graphics-recovery';this.panel.setAttribute('aria-labelledby','graphics-recovery-title');
  this.panel.innerHTML=`<div class="mc-startup-card"><header><b>MIRROR COAST.</b><small>现场保留，等待画面恢复。</small></header>
   <p class="mc-startup-label">游玩中的图形中断</p><h1 id="graphics-recovery-title" tabindex="-1">画面暂时中断，世界已暂停</h1>
   <p>人物、载具和世界模拟已暂停。驾驶、骑行或坐下的状态会保留；浏览器恢复图形后，再点击继续。</p>
   <div class="mc-startup-save"><b data-save-title>正在保存暂停现场</b><span data-save-message></span></div>
   <p data-gpu-status role="status" aria-live="polite"></p>
   <div class="mc-startup-actions"><button type="button" data-resume disabled>等待图形恢复</button><button type="button" data-reload>保存后重新加载</button></div>
   <div class="mc-recovery-secondary"><button type="button" data-save>重试保存</button><button type="button" data-backup>导出现场备份</button></div>
   <p class="mc-startup-feedback" data-feedback role="status" aria-live="polite"></p>
   <details><summary>图形一直未恢复时怎么办</summary><p>先确认现场保存成功，或导出备份，再重新加载当前页面。网页不能自行解除浏览器对 WebGL 的禁用。</p><p>若仍失败，确认图形加速开启；保存其他网页内容后，Edge 可输入 <code>edge://restart</code>，Chrome 使用 <code>chrome://restart</code> 完整重启。这会重新加载该浏览器的全部标签页。</p><p>在 <code>edge://gpu</code> 或 <code>chrome://gpu</code> 查看 WebGL 状态。不要清理站点数据或重置世界。</p></details>
  </div>`;
  this.saveText=this.panel.querySelector('[data-save-message]')!;this.status=this.panel.querySelector('[data-gpu-status]')!;
  this.resumeButton=this.panel.querySelector('[data-resume]')!;this.reloadButton=this.panel.querySelector('[data-reload]')!;
  this.resumeButton.addEventListener('click',actions.resume);this.reloadButton.addEventListener('click',actions.reload);this.panel.querySelector('[data-save]')!.addEventListener('click',actions.save);
  this.panel.querySelector('[data-backup]')!.addEventListener('click',async()=>{const feedback=this.panel.querySelector<HTMLElement>('[data-feedback]')!;try{await actions.backup();feedback.textContent='现场备份已导出；若本地保存失败，请妥善保留该文件。';}catch(error){feedback.textContent=`备份未能导出：${error instanceof Error?error.message:String(error)}`;}});
  document.body.append(this.panel);this.panel.querySelector<HTMLElement>('h1')!.focus();
 }
 update(state:GraphicsRecoveryState){
  this.panel.dataset.saveState=state.save;this.panel.dataset.contextState=state.restored?'restored':'lost';
  this.panel.querySelector('[data-save-title]')!.textContent=state.save==='saved'?'现场已保存':state.save==='saving'?'正在保存暂停现场':'保存未成功，请保留当前页面';
  this.saveText.textContent=state.message;
  this.status.textContent=state.restored?'图形环境已恢复。点击下方按钮继续，世界不会自动推进。':'浏览器尚未恢复图形环境。可以等待恢复，或在保存成功后重新加载。';
  this.resumeButton.disabled=!state.restored||state.save==='saving';this.resumeButton.textContent=state.restored?'恢复画面，继续游玩':'等待图形恢复';
  this.reloadButton.disabled=state.save==='saving';this.reloadButton.textContent=state.save==='error'?'重试保存后重新加载':'保存后重新加载';
  this.panel.querySelector<HTMLButtonElement>('[data-save]')!.disabled=state.save==='saving';
 }
 dispose(){this.panel.remove();}
}
