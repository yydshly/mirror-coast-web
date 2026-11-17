type FailureKind='graphics'|'startup';
type FailureOptions={kind:FailureKind;error:unknown;contextMessage?:string};

/** Startup can fail before the 3D scene exists. This page needs no renderer,
 * storage initialization, telemetry or automatic browser/system changes. */
export function showStartupFailure(root:HTMLElement,{kind,error,contextMessage}:FailureOptions):void{
 const graphics=kind==='graphics',message=error instanceof Error?error.message:String(error);
 const report=[`Mirror Coast · ${graphics?'WebGL 2 初始化失败':'启动失败'}`,message,contextMessage].filter(Boolean).join('\n');
 const app=document.querySelector<HTMLElement>('#app'),canvas=document.querySelector<HTMLCanvasElement>('#world');
 if(app){app.dataset.startup='failed';delete app.dataset.ready;}
 if(canvas)canvas.hidden=true;
 root.classList.remove('is-presentation');root.replaceChildren();
 const panel=document.createElement('section');panel.className='mc-startup-error';panel.setAttribute('aria-labelledby','startup-error-heading');
 panel.innerHTML=`<div class="mc-startup-card">
  <header><a href="./" aria-label="镜海首页">MIRROR COAST<span>.</span></a><small>海岸还在这里，先恢复画面。</small></header>
  <p class="mc-startup-label">${graphics?'图形渲染尚未启动':'城市尚未启动'}</p>
  <h1 id="startup-error-heading" tabindex="-1">${graphics?'浏览器暂时无法显示这座城市':'城市启动遇到了问题'}</h1>
  <p>${graphics?'网页已加载，但浏览器未能创建 WebGL 2 图形环境。图形加速关闭、GPU 进程崩溃或驱动限制都可能导致这种情况。':'请先重新加载页面。如果仍然失败，可以展开下方错误详情，以便继续排查。'}</p>
  <div class="mc-startup-save"><b>保留你的世界</b><span>${graphics?'此次失败发生在游戏存档读取之前。无需清理站点数据，也无需重置世界。':'此恢复页面不会清理或重置你的游戏存档。'}</span></div>
  <div class="mc-startup-actions"><button type="button" data-retry>重新尝试加载</button><button type="button" data-copy>复制错误信息</button></div>
  <p class="mc-startup-feedback" role="status" aria-live="polite"></p>
  ${graphics?`<section class="mc-startup-guide" aria-labelledby="startup-guide-heading"><h2 id="startup-guide-heading">仍然没有画面时</h2><ol>
   <li><b>确认图形加速已开启</b><p>Edge：地址栏输入 <code>edge://settings/system</code>；Chrome：<code>chrome://settings/system</code>。开启“在可用时使用图形加速”。</p></li>
   <li><b>保存其他网页内容，再完整重启浏览器</b><p>Edge 可输入 <code>edge://restart</code>，Chrome 使用 <code>chrome://restart</code>。这会重新加载该浏览器的全部标签页；只关窗口可能仍有后台进程。</p></li>
   <li><b>开关开启，也可能是图形进程异常</b><p>在 <code>edge://gpu</code> 或 <code>chrome://gpu</code> 查看 WebGL 状态。若仍显示 Disabled，请提供“Graphics Feature Status”和“Problems Detected”两段，以便继续排查驱动、浏览器限制或启动参数。</p></li>
  </ol><p class="mc-startup-note">网页只能重新尝试加载，无法自行解除浏览器对 WebGL 的禁用，也不会替你重启浏览器。</p></section>`:''}
  <details><summary>查看错误详情</summary><textarea readonly aria-label="启动错误信息" spellcheck="false"></textarea></details>
 </div>`;
 const details=panel.querySelector('details')!,reportBox=panel.querySelector('textarea')!,feedback=panel.querySelector<HTMLElement>('[role="status"]')!;
 panel.querySelector<HTMLAnchorElement>('header a')!.href=location.href;
 reportBox.value=report;
 panel.querySelector('[data-retry]')!.addEventListener('click',()=>location.reload());
 panel.querySelector('[data-copy]')!.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(report);feedback.textContent='错误信息已复制。包含启动错误，不包含游戏存档。';}
  catch{details.open=true;reportBox.focus();reportBox.select();feedback.textContent='浏览器未允许自动复制，错误信息已选中，可手动复制。';}
 });
 root.append(panel);panel.querySelector<HTMLElement>('h1')!.focus();
}
