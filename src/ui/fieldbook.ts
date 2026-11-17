import type {DiscoverySite} from '../gameplay/discoveries';
import {JOURNEY_STEPS,COASTAL_ROUTE_STEPS,COASTAL_DAY_STEPS} from '../gameplay/coastal-journey';
import {BAY_STOPS,type BayNote} from '../gameplay/south-bay';

/** Explicit play/track actions dismiss reading UI without changing gameplay mode. */
export function dismissReadingPanels(fieldbook:{setOpen:(open:boolean)=>void}|undefined,help:{readonly isHelpOpen:boolean;toggleHelp:()=>void}):void{
  fieldbook?.setOpen(false);if(help.isHelpOpen)help.toggleHelp();
}

export class Fieldbook {
  private readonly panel=document.createElement('details');
  private readonly prompt=document.createElement('button');
  private readonly progress:HTMLElement;
  private readonly route:HTMLElement;
  private readonly buttons=new Map<string,HTMLButtonElement>();
  private promptSignature='';
  private lastOpen=false;
  private journeySignature='';
  private baySignature='';
  private coastSignature='';
  constructor(root:HTMLElement,readonly sites:readonly DiscoverySite[],private callbacks:{track:(id:string)=>void;interact:()=>void;onOpen?:()=>void}){
    this.panel.className='mc-fieldbook mc-panel';this.panel.setAttribute('aria-label','海岸探索手记');
    this.panel.innerHTML='<summary><span>海岸手记</span><b data-discovery-count>0 / 3</b><output class="mc-wayfinding" data-wayfinding></output><small>步行靠近装置按 E · J 展开手记</small></summary><div class="mc-fieldbook-body"></div>';
    this.panel.addEventListener('toggle',()=>this.syncOpenState());
    this.progress=this.panel.querySelector('[data-discovery-count]')!;this.route=this.panel.querySelector('[data-wayfinding]')!;
    const body=this.panel.querySelector('.mc-fieldbook-body')!;
    for(const site of sites){
      const button=document.createElement('button');button.dataset.track=site.id;
      const title=document.createElement('b');title.textContent=site.title;
      const note=document.createElement('span');note.textContent=site.description;
      const status=document.createElement('small');status.dataset.discoveryStatus='';
      button.append(title,note,status);button.addEventListener('click',()=>{this.setOpen(false);this.callbacks.track(site.id);});body.append(button);this.buttons.set(site.id,button);
    }
    for(const [id,label]of [['car','找回旅行车'],['helicopter','找回直升机']]){
      const button=document.createElement('button');button.className='mc-find-vehicle';button.textContent=label;button.dataset.track=id;
      button.addEventListener('click',()=>{this.setOpen(false);this.callbacks.track(id);});body.append(button);
    }
    this.prompt.className='mc-interact mc-panel';this.prompt.hidden=true;this.prompt.setAttribute('aria-label','调查附近目标');
    this.prompt.addEventListener('click',()=>this.callbacks.interact());
    for(const element of [this.panel,this.prompt])for(const event of ['pointerdown','pointerup','click'])element.addEventListener(event,e=>e.stopPropagation());
    const ui=root.querySelector('.mc-ui')!;ui.append(this.panel,this.prompt);
  }
  setCompleted(ids:ReadonlySet<string>):void{
    this.progress.textContent=`${ids.size} / ${this.sites.length}`;this.panel.dataset.completed=String(ids.size);
    for(const [id,button]of this.buttons){button.classList.toggle('is-discovered',ids.has(id));button.querySelector('[data-discovery-status]')!.textContent=ids.has(id)?'已记录 · 点击追踪':'未记录 · 点击追踪';}
  }
  setJourney(step:number,active:boolean,route?:'coast-road',experience?:string,hint?:string):void{
    const key=`${step}:${active}:${route}:${experience}:${hint}`;if(key===this.journeySignature)return;this.journeySignature=key;
    let log=this.panel.querySelector<HTMLElement>('[data-journey-log]');if(!log){log=document.createElement('section');log.dataset.journeyLog='';log.className='mc-journey-log';this.panel.querySelector('.mc-fieldbook-body')!.prepend(log);}
    const steps=experience==='coastal-day'?COASTAL_DAY_STEPS:route==='coast-road'?COASTAL_ROUTE_STEPS:JOURNEY_STEPS;
    const title=document.createElement('b');title.textContent=step===6?'沿海之旅 · 足迹已收齐':'沿海之旅 · 旅途足迹';
    const note=document.createElement('p');note.textContent=step===6?(route==='coast-road'?'旧城、码头、南湾与西岬都留在这里。可以在海岬再坐一会，也可以继续前往松林。':'原沿海一日的足迹已保留，可以从路线卡开启旧城到西岬的新旅程。'):step===0&&!active?'从路线卡开启，一路走过旧城、码头、南湾和西岬。':`${active?'正在探索':'暂时停下'}：${hint??steps[step].hint}`;
    const list=document.createElement('ol');for(const stage of steps.slice(0,step)){const item=document.createElement('li');item.textContent=stage.reward;list.append(item);}log.replaceChildren(title,note,list);
  }
  setBay(notes:readonly BayNote[]):void{
    const key=notes.join(',')+'!';if(key===this.baySignature)return;this.baySignature=key;
    let log=this.panel.querySelector<HTMLElement>('[data-bay-log]');if(!log){log=document.createElement('section');log.dataset.bayLog='';log.className='mc-journey-log';this.panel.querySelector('.mc-fieldbook-body')!.prepend(log);}
    const title=document.createElement('b');title.textContent=`南湾 · 风与潮水 ${notes.length} / 3`;
    const intro=document.createElement('p');intro.textContent='放飞风筝、静看潮池、在海蚀门前坐一会。救援船的日志仍在旧栈道尽头。';log.replaceChildren(title,intro);
    BAY_STOPS.forEach((p,i)=>{const button=document.createElement('button');button.textContent=`${notes.includes((['kite','pool','vista'] as const)[i])?'✓ 已留足迹 · ':'○ '}${p.name}`;button.addEventListener('click',()=>{this.setOpen(false);this.callbacks.track(p.id);});log!.append(button);});
  }
  setCoast(state:{logRead:boolean;beaconLinked:boolean},status:string):void{
    const key=JSON.stringify([state,status]);if(key===this.coastSignature)return;this.coastSignature=key;
    let log=this.panel.querySelector<HTMLElement>('[data-coast-log]');if(!log){log=document.createElement('section');log.dataset.coastLog='';log.className='mc-journey-log';this.panel.querySelector('.mc-fieldbook-body')!.prepend(log);}
    const title=document.createElement('b');title.textContent=state.beaconLinked?'航路重连 · 变化已保留':state.logRead?'航路记录 · 西岬 205°':'渔港支栈桥 · 一条可以清出的路';
    const note=document.createElement('p');note.textContent=state.beaconLinked?'西岬航标已锁定，渔港引航灯与海上标灯回应。读档后仍会保持；已清掉的木箱不会重生。':state.logRead?'码头记录：巡岸船从渔港经过南湾，再由西岬航标指引。方位 205°。先去南湾停留，再沿海岸路返回西岬。':'渔港木栈街西端有一条被旧木箱堵住的支栈桥。2 挖除木箱，保留脚下木板；1 返回观察，再靠近海边记录台按 E。';
    const live=document.createElement('small');live.textContent=status==='open'?'现在：支栈桥可以通行。':status==='broken'?'现在：木板有缺口。可在入口按 E 用备用木板补齐。':'现在：木箱仍挡住通路。';
    const button=document.createElement('button');button.textContent=state.beaconLinked?'回渔港查看留下的变化':state.logRead?'追踪西岬航标':'追踪渔港清障通路';button.addEventListener('click',()=>{this.setOpen(false);this.callbacks.track(state.logRead&&!state.beaconLinked?'cape-signal':'harbor-log');});log.replaceChildren(title,note,live,button);
  }
  setRoute(id:string,title:string,distance:number,bearing:string):void{
    this.route.textContent=`${bearing} · ${title} · ${Math.round(distance)} m`;
    this.panel.dataset.tracked=id;
    this.buttons.forEach((button,key)=>button.classList.toggle('is-tracked',id===key));
  }
  setPrompt(label:string|null):void{
    if((label??'')===this.promptSignature)return;this.promptSignature=label??'';
    this.prompt.hidden=!label;this.prompt.textContent=label?`E · ${label}`:'';
  }
  setVisible(visible:boolean):void{this.panel.hidden=!visible;if(!visible)this.prompt.hidden=true;}
  get isOpen():boolean{return this.panel.open;}
  setOpen(open:boolean):void{this.panel.open=open;this.syncOpenState();}
  toggle():void{this.setOpen(!this.panel.open);}
  private syncOpenState():void{const opened=this.panel.open&&!this.lastOpen;this.lastOpen=this.panel.open;if(opened)this.callbacks.onOpen?.();}
  dispose():void{this.panel.remove();this.prompt.remove();}
}
