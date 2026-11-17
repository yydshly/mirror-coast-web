import {MAP_DESTINATIONS,NAVIGATION_LINES,CoastalNavigation,destinationById,mapProjection,mapMarker,type MapPoint,type NavigationMode} from '../gameplay/navigation';
import {REGION_BOUNDS,REGION_DISTRICTS} from '../world/region-layout';
import {COAST_ROUTE} from '../route/coast-route';
import {Material} from '../world/palette';
import type {VoxelWorld} from '../world/voxel';
import {MINIMAP_ZOOMS,minimapViewport} from './map-viewport';

export type MapSnapshot={position:MapPoint;bearing:number;mode:NavigationMode;target:string;completed:ReadonlySet<string>;car?:MapPoint;bicycle?:MapPoint;helicopter?:MapPoint;tourIndex?:number;autotouring:boolean};
const svgPoints=(points:readonly MapPoint[])=>points.map(p=>{const q=mapProjection(p);return`${q.x},${q.y}`;}).join(' ');
const meters=(n:number)=>n>=1000?`${(n/1000).toFixed(1)} km`:`${Math.round(n)} m`;
const pointDistance=(a:MapPoint,b:MapPoint)=>Math.hypot(a.x-b.x,a.z-b.z);

/** A north-up overview stays visible; its modal is for selecting a real destination. */
export class RegionMap {
 private readonly dialog=document.createElement('dialog');
 private readonly navigation=new CoastalNavigation();
 private readonly svgs:SVGSVGElement[];
 private snapshot:MapSnapshot|undefined;
 private selected='harbor';
 private routeKey='';
 private routeDistance=0;
 private compact=false;
 private collapsed=false;
 private zoomIndex=0;
 constructor(private root:HTMLElement,private callbacks:{open:()=>void;journal:()=>void;navigate:(id:string,drive:boolean)=>void}){
  root.setAttribute('aria-label','区域缩略地图');
  root.innerHTML=`<button class="mc-minimap-restore" data-map-restore aria-label="展开小地图" hidden>⌖ 地图 · 展开</button><div class="mc-minimap-heading"><b>缩略地图</b><div><button data-map-size aria-label="缩小小地图" title="切换紧凑尺寸">↘</button><button data-map-open aria-label="展开区域地图">全图 <kbd>M</kbd></button><button data-map-collapse aria-label="收起小地图" title="收起地图">−</button></div></div>
   <button class="mc-map-preview" data-map-open aria-label="打开区域地图，选择探索地点">${this.svg(false)}</button>
   <div class="mc-minimap-controls"><button data-map-zoom-out aria-label="缩小地图视野">−</button><button data-map-zoom-reset aria-label="显示全域地图">全域</button><button data-map-zoom-in aria-label="放大地图视野">+</button><button data-map-journal aria-label="打开海岸手记">手记 <kbd>J</kbd></button></div>
   <div class="mc-minimap-location"><span data-map-location>正在定位</span><span>北向上 ↑</span></div>
   <button class="mc-map-target" data-map-open><b data-map-target-title>选择探索目标</b><small data-map-target-note>打开全图，查看哪里能去、能做什么。</small></button>`;
  this.dialog.className='mc-map-dialog mc-panel';this.dialog.setAttribute('aria-labelledby','mc-map-title');
  this.dialog.innerHTML=`<header><div><small>LIGHTHOUSE BAY · EXPLORE</small><h2 id="mc-map-title">这一片海岸，都可以抵达。</h2><p>点选地点查看玩法，设为目标后沿地图路线探索。地图保持北向上。</p></div><button data-map-close aria-label="关闭区域地图">×</button></header>
   <div class="mc-map-layout"><div class="mc-map-overview">${this.svg(true)}<div class="mc-map-legend"><span>➤ 你的位置 / 视向</span><span class="map-legend-goal">◆ 探索点</span><span class="map-legend-car">▣ 汽车</span><span class="map-legend-heli">✚ 直升机</span><span>— 公路 · ┄ 步行支路</span></div><p data-map-current>正在定位</p></div>
   <aside><div class="mc-map-place-card"><small data-map-kind>探索地点</small><h3 data-map-place-title></h3><p data-map-description></p><p class="mc-map-access" data-map-access></p><output data-map-distance></output><button data-map-track>设为目标，沿路探索</button><button data-map-drive>驾驶旅行车前往</button></div>
    <div class="mc-map-destinations" aria-label="可探索地点">${MAP_DESTINATIONS.map(p=>`<button data-map-select="${p.id}" aria-label="选择${p.name}"><span>${p.kind==='activity'?'◆':p.kind==='vehicle'?'■':'·'}</span>${p.name}<small data-map-completed="${p.id}"></small></button>`).join('')}</div></aside></div>`;
  root.parentElement!.append(this.dialog);
  this.svgs=[root.querySelector('svg')!,this.dialog.querySelector('svg')!];
  try{const prefs=JSON.parse(localStorage.getItem('mirror-coast-map-ui-v1')??'{}');this.compact=prefs.compact===true;this.collapsed=prefs.collapsed===true;this.zoomIndex=Number.isInteger(prefs.zoomIndex)?Math.max(0,Math.min(MINIMAP_ZOOMS.length-1,prefs.zoomIndex)):0;}catch{/* Map controls remain usable without preference storage. */}
  root.querySelector('[data-map-size]')!.addEventListener('click',()=>{this.compact=!this.compact;this.applyMapPreferences();});
  root.querySelector('[data-map-collapse]')!.addEventListener('click',()=>{this.collapsed=true;this.applyMapPreferences();root.querySelector<HTMLButtonElement>('[data-map-restore]')!.focus();});
  root.querySelector('[data-map-restore]')!.addEventListener('click',()=>{this.collapsed=false;this.applyMapPreferences();root.querySelector<HTMLButtonElement>('[data-map-collapse]')!.focus();});
  root.querySelector('[data-map-zoom-in]')!.addEventListener('click',()=>{this.zoomIndex=Math.min(MINIMAP_ZOOMS.length-1,this.zoomIndex+1);this.applyMapPreferences();});
  root.querySelector('[data-map-zoom-out]')!.addEventListener('click',()=>{this.zoomIndex=Math.max(0,this.zoomIndex-1);this.applyMapPreferences();});
  root.querySelector('[data-map-zoom-reset]')!.addEventListener('click',()=>{this.zoomIndex=0;this.applyMapPreferences();});
  this.applyMapPreferences(false);
  root.querySelectorAll('[data-map-open]').forEach(b=>b.addEventListener('click',()=>this.open()));
  root.querySelector('[data-map-journal]')!.addEventListener('click',()=>this.callbacks.journal());
  this.dialog.querySelector('[data-map-close]')!.addEventListener('click',()=>this.close());
  this.dialog.querySelector('[data-map-track]')!.addEventListener('click',()=>this.navigate(false));
  this.dialog.querySelector('[data-map-drive]')!.addEventListener('click',()=>this.navigate(true));
  this.dialog.querySelectorAll<HTMLElement>('[data-map-select]').forEach(b=>b.addEventListener('click',()=>this.select(b.dataset.mapSelect!)));
  this.dialog.querySelectorAll<SVGElement>('[data-map-poi]').forEach(p=>{
   p.addEventListener('click',()=>this.select(p.dataset.mapPoi!));
   p.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.select(p.dataset.mapPoi!);}});
  });
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  for(const element of [root,this.dialog])for(const type of ['pointerdown','pointerup','click','wheel'])element.addEventListener(type,event=>event.stopPropagation());
  this.select(this.selected);
 }
 private applyMapPreferences(persist=true):void{
  this.root.classList.toggle('is-compact',this.compact);this.root.classList.toggle('is-collapsed',this.collapsed);
  this.root.querySelector<HTMLButtonElement>('[data-map-restore]')!.hidden=!this.collapsed;
  const size=this.root.querySelector<HTMLButtonElement>('[data-map-size]')!;size.setAttribute('aria-label',this.compact?'恢复小地图尺寸':'缩小小地图');size.textContent=this.compact?'↗':'↘';
  this.root.querySelector<HTMLButtonElement>('[data-map-zoom-out]')!.disabled=this.zoomIndex===0;this.root.querySelector<HTMLButtonElement>('[data-map-zoom-in]')!.disabled=this.zoomIndex===MINIMAP_ZOOMS.length-1;
  this.root.querySelector('[data-map-zoom-reset]')!.textContent=this.zoomIndex?`${MINIMAP_ZOOMS[this.zoomIndex]}×`:'全域';
  this.root.dataset.zoom=String(MINIMAP_ZOOMS[this.zoomIndex]);this.updateViewport();
  if(persist)try{localStorage.setItem('mirror-coast-map-ui-v1',JSON.stringify({compact:this.compact,collapsed:this.collapsed,zoomIndex:this.zoomIndex}));}catch{/* Preference failure never interrupts exploration. */}
 }
 private updateViewport():void{const marker=mapMarker(this.snapshot?.position??{x:128,z:128});this.svgs[0].setAttribute('viewBox',minimapViewport(marker.x,marker.y,MINIMAP_ZOOMS[this.zoomIndex]));this.svgs[0].querySelector('.mc-map-compass')!.setAttribute('visibility',this.zoomIndex?'hidden':'visible');}
 private svg(interactive:boolean):string{
  const labels=[['旧城',128,108],['西岸',-141,43],['山麓住宅',139,-161],['东港',426,49],['南湾',645,96],['北岭',290,-327],['松林',-133,-281]] as const;
  return`<svg viewBox="0 0 1024 768" role="${interactive?'group':'img'}" aria-label="灯塔湾完整区域：海岸、城市、外围道路、探索点与当前位置">
   <rect width="1024" height="768" fill="#244a56"/><image data-map-terrain width="1024" height="768" preserveAspectRatio="none" style="image-rendering:pixelated"/>
   ${REGION_DISTRICTS.filter(d=>d.kind!=='hills').map(d=>{const q=mapProjection({x:d.minX,z:d.minZ});return`<rect x="${q.x}" y="${q.y}" width="${d.maxX-d.minX}" height="${d.maxZ-d.minZ}" fill="#cdd1ae0c" stroke="#ced9bd35" stroke-width="2" rx="8"/>`;}).join('')}
   ${NAVIGATION_LINES.map(l=>`<polyline points="${svgPoints(l.points)}" fill="none" stroke="${l.kind==='road'?'#c1b69b':'#a6c7a4'}" stroke-width="${l.kind==='road'?7:5}" ${l.kind==='foot'?'stroke-dasharray="9 8"':''} stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
   <polyline data-map-air points="${svgPoints(COAST_ROUTE.map(p=>p.position))}" fill="none" stroke="#dda884" stroke-width="5" stroke-dasharray="12 12" opacity=".8" visibility="hidden"/>
   <polyline data-map-route points="" fill="none" stroke="#f5cf81" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
   <polyline data-map-lastmile points="" fill="none" stroke="#b6e2ad" stroke-width="8" stroke-dasharray="9 10" stroke-linecap="round"/>
   <g class="mc-map-region-labels">${labels.map(([label,x,z])=>{const p=mapProjection({x,z});return`<text x="${p.x}" y="${p.y}">${label}</text>`;}).join('')}</g>
   ${MAP_DESTINATIONS.map(p=>{const q=mapProjection(p.position);return`<g data-map-poi="${p.id}" data-map-category="${p.kind}" transform="translate(${q.x} ${q.y})" ${interactive?`role="button" tabindex="0" aria-label="地图选择${p.name}"`:''}><title>${p.name}</title><circle r="24" fill="transparent"/><circle class="map-poi-ring" r="19" fill="none" stroke="#f4d58f" stroke-width="5" visibility="hidden"/>${p.kind==='activity'?'<path class="map-poi-symbol" d="M0 -12 12 0 0 12 -12 0Z"/>':p.id==='car'?'<path class="map-poi-symbol map-car" d="M-10 -15H10V15H-10Z M-8 -6H8 M-8 7H8"/>':p.id==='helicopter'?'<path class="map-poi-symbol map-heli" d="M-17 -9H17 M0 -14V17 M-8 -4H8V10H-8Z"/>':'<circle class="map-poi-symbol" r="7"/>'}</g>`;}).join('')}
   <g data-map-player transform="translate(256 384)"><circle r="25" fill="#fff1c433"/><path d="M0 -22 14 16 0 8 -14 16Z" fill="#fff9df" stroke="#193b3f" stroke-width="5"/></g>
   <g class="mc-map-compass"><path d="M973 73V24L961 42M973 24 985 42" fill="none" stroke="#f4ecd7" stroke-width="4"/><text x="973" y="102" text-anchor="middle">N</text><path d="M48 716H148M48 709V723M148 709V723" stroke="#e7e1c9" stroke-width="4"/><text x="98" y="700" text-anchor="middle">100 m</text></g>
  </svg>`;
 }
 setTerrain(world:VoxelWorld):void{
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;
  const context=canvas.getContext('2d');if(!context)return;const image=context.createImageData(128,96);
  for(let z=0;z<96;z++)for(let x=0;x<128;x++){
   const wx=REGION_BOUNDS.minX+x*8+4,wz=REGION_BOUNDS.minZ+z*8+4;let top=-1,material=0;
   for(let y=95;y>=0;y--){material=world.getVoxel(wx,y,wz);if(material){top=y;break;}}
   const shade=Math.min(26,Math.max(0,top-16)*.45);let color:number[];
   if(top<12)color=top>6?[43,82,92]:[35,69,83];
   else if(material===Material.Sand)color=[163,151,112];
   else if([Material.Road,Material.Stripe,Material.Concrete].some(m=>m===material))color=[108,116,105];
   else if(material===Material.Wood&&wz>174)color=[148,129,95];
   else if([Material.Grass,Material.Dirt,Material.Rock,Material.Leaves].some(m=>m===material))color=[75+shade,103+shade,84+shade];
   else color=[133,140,118];
   const i=(z*128+x)*4;image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=255;
  }
  context.putImageData(image,0,0);const url=canvas.toDataURL('image/png');
  for(const svg of this.svgs)svg.querySelector('[data-map-terrain]')!.setAttribute('href',url);
 }
 get isOpen(){return this.dialog.open;}
 open():void{this.callbacks.open();if(!this.dialog.open)this.dialog.showModal();if(this.snapshot){this.selected=this.snapshot.target;this.routeKey='';this.update(this.snapshot);}this.dialog.querySelector<HTMLButtonElement>('[data-map-track]')!.focus();}
 close():void{if(!this.dialog.open)return;this.dialog.close();this.root.querySelector<HTMLButtonElement>('[data-map-open]')!.focus();this.routeKey='';}
 toggle():void{if(this.isOpen)this.close();else this.open();}
 private navigate(drive:boolean):void{const id=this.selected;this.close();this.callbacks.navigate(id,drive);}
 private select(id:string):void{if(!destinationById(id))return;this.selected=id;this.routeKey='';if(this.snapshot)this.update(this.snapshot);}
 private position(id:string):MapPoint{return id==='bicycle'?this.snapshot?.bicycle??destinationById(id)!.position:id==='car'?this.snapshot?.car??destinationById(id)!.position:id==='helicopter'?this.snapshot?.helicopter??destinationById(id)!.position:destinationById(id)!.position;}
 update(snapshot:MapSnapshot):void{
  this.snapshot=snapshot;
  this.updateViewport();
  const marker=mapMarker(snapshot.position),goal=destinationById(this.isOpen?this.selected:snapshot.target)??destinationById('harbor')!,position=this.position(goal.id);
  for(const svg of this.svgs){
   svg.querySelector('[data-map-player]')!.setAttribute('transform',`translate(${marker.x} ${marker.y}) rotate(${snapshot.bearing*180/Math.PI})`);
   svg.querySelector('[data-map-air]')!.setAttribute('visibility',snapshot.tourIndex===undefined?'hidden':'visible');
   for(const p of MAP_DESTINATIONS){const element=svg.querySelector<SVGElement>(`[data-map-poi="${p.id}"]`)!;
    if(p.kind==='vehicle'){const q=mapMarker(this.position(p.id));element.setAttribute('transform',`translate(${q.x} ${q.y})`);element.setAttribute('visibility',snapshot.mode===p.id?'hidden':'visible');}
    element.classList.toggle('is-completed',snapshot.completed.has(p.id));element.querySelector('.map-poi-ring')!.setAttribute('visibility',p.id===goal.id?'visible':'hidden');
   }
  }
  const district=REGION_DISTRICTS.find(d=>snapshot.position.x>=d.minX&&snapshot.position.x<d.maxX&&snapshot.position.z>=d.minZ&&snapshot.position.z<d.maxZ);
  const location=marker.outside?'区域外 · 箭头位于地图边缘':district?.name??'近岸与连接道路';
  this.root.querySelector('[data-map-location]')!.textContent=location;
  this.dialog.querySelector('[data-map-current]')!.textContent=`你在${location} · X ${Math.round(snapshot.position.x)} / Z ${Math.round(snapshot.position.z)} · ${({walk:'步行',car:'驾驶汽车',helicopter:'直升机',fly:'自由镜头',bicycle:'自行车骑行'} as const)[snapshot.mode]}`;
  const key=`${Math.round(snapshot.position.x/4)},${Math.round(snapshot.position.z/4)},${Math.round(position.x/4)},${Math.round(position.z/4)},${snapshot.mode},${goal.id}`;
  if(key!==this.routeKey){
   this.routeKey=key;
   const aerial=snapshot.mode==='fly'||snapshot.mode==='helicopter',roadVehicle=snapshot.mode==='car'||snapshot.mode==='bicycle',route=aerial?null:this.navigation.route(snapshot.position,roadVehicle&&goal.approach?goal.approach:position,roadVehicle);
   this.routeDistance=route?.distance??pointDistance(snapshot.position,position);
   for(const svg of this.svgs){const line=svg.querySelector('[data-map-route]')!;line.setAttribute('points',svgPoints(route?.points??[snapshot.position,position]));line.setAttribute('stroke-dasharray',aerial||!route?'7 12':'');svg.querySelector('[data-map-lastmile]')!.setAttribute('points',!aerial&&goal.trail?svgPoints(goal.trail):'');}
  }
  const onFoot=(snapshot.mode==='car'||snapshot.mode==='bicycle')&&goal.trail,arrived=pointDistance(snapshot.position,position)<12;
  const walkDistance=goal.trail?.slice(1).reduce((sum,p,i)=>sum+pointDistance(p,goal.trail![i]),0)??0,atApproach=!!onFoot&&!!goal.approach&&pointDistance(snapshot.position,goal.approach)<12;
  this.root.querySelector('[data-map-target-title]')!.textContent=snapshot.autotouring?`导览 · ${COAST_ROUTE[snapshot.tourIndex??0].name}`:atApproach?`已到入口 · ${goal.shortName}`:`${arrived?'已靠近':'目标'} · ${goal.shortName}`;
  this.root.querySelector('[data-map-target-note]')!.textContent=snapshot.autotouring?'橙色虚线为近岸航线 · M 查看外围':atApproach?`刹停后按 F 下车 · 继续步行约 ${meters(walkDistance)}`:onFoot?`${snapshot.mode==='bicycle'?'骑行':'驾车'}约 ${meters(this.routeDistance)} · 步行约 ${meters(walkDistance)}`:`${snapshot.mode==='fly'||snapshot.mode==='helicopter'?'方向参考':'沿路约'} ${meters(this.routeDistance)} · M 查看玩法`;
  this.dialog.querySelector('[data-map-kind]')!.textContent=goal.kind==='activity'?(snapshot.completed.has(goal.id)?'探索记录 · 已完成':'探索记录 · 靠近按 E 调查'):goal.kind==='vehicle'?'当前载具位置':'区域与玩法';
  this.dialog.querySelector('[data-map-place-title]')!.textContent=goal.name;
  this.dialog.querySelector('[data-map-description]')!.textContent=goal.description;
  this.dialog.querySelector('[data-map-access]')!.textContent=goal.access;
  this.dialog.querySelector('[data-map-distance]')!.textContent=onFoot?`驾车参考路线约 ${meters(this.routeDistance)} + 步行约 ${meters(walkDistance)}；停车后沿绿色虚线前往。`:`${snapshot.mode==='fly'||snapshot.mode==='helicopter'?'直线方向参考':'道路参考路线'} · 约 ${meters(this.routeDistance)}`;
  this.dialog.querySelector<HTMLButtonElement>('[data-map-drive]')!.hidden=goal.kind==='vehicle'||goal.id==='old-city';
  this.dialog.querySelectorAll<HTMLElement>('[data-map-select]').forEach(b=>{b.classList.toggle('is-selected',b.dataset.mapSelect===goal.id);b.setAttribute('aria-pressed',String(b.dataset.mapSelect===goal.id));});
  for(const p of MAP_DESTINATIONS){const state=this.dialog.querySelector(`[data-map-completed="${p.id}"]`)!;state.textContent=snapshot.completed.has(p.id)?'已记录':'';}
  this.root.dataset.target=snapshot.target;this.root.dataset.position=JSON.stringify(snapshot.position);this.root.dataset.mode=snapshot.mode;this.root.dataset.bearing=String(snapshot.bearing);
 }
 dispose():void{this.dialog.remove();}
}
