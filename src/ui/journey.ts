import {COASTAL_ROUTE_STEPS,COASTAL_DAY_STEPS,type CoastalJourney} from '../gameplay/coastal-journey';
export class JourneyPanel{
 private root=document.createElement('section');private signature='';
 private passageStatus='blocked';private logRead=false;
 setPassage(status:string,logRead:boolean){if(status===this.passageStatus&&logRead===this.logRead)return;this.passageStatus=status;this.logRead=logRead;this.signature='';this.update();}
 constructor(parent:HTMLElement,private journey:CoastalJourney,action:()=>void,sound?:()=>void){this.root.className='mc-journey mc-panel';this.root.setAttribute('aria-label','沿海一日游玩路线');this.root.innerHTML='<small>ON FOOT, THEN ON THE ROAD</small><small data-pace></small><b data-title></b><p data-hint></p><div class="mc-journey-stamps"></div><button data-journey-start></button><button data-journey-sound class="mc-journey-sound">开启海岸环境音</button>';this.root.querySelector('[data-journey-start]')!.addEventListener('click',action);const audio=this.root.querySelector<HTMLButtonElement>('[data-journey-sound]')!;audio.hidden=!sound;audio.addEventListener('click',()=>sound?.());for(const type of ['pointerdown','pointerup','click'])this.root.addEventListener(type,e=>e.stopPropagation());parent.querySelector('.mc-ui')!.append(this.root);this.update();}
 setSoundEnabled(enabled:boolean){this.root.querySelector<HTMLButtonElement>('[data-journey-sound]')!.hidden=enabled;}
 update(){const s=this.journey.state,key=JSON.stringify([s,this.journey.chapterHint]);if(key===this.signature)return;this.signature=key;
  const coastal=s.route==='coast-road'||!s.active&&s.step===0,day=s.experience==='coastal-day'||!s.active&&s.step===0,steps=day?COASTAL_DAY_STEPS:coastal?COASTAL_ROUTE_STEPS:this.journey.steps;
  this.root.classList.toggle('is-active',s.active);
  const pace=this.root.querySelector<HTMLElement>('[data-pace]')!;pace.textContent=s.active&&!this.journey.complete&&'pace'in this.journey.chapter?`节奏建议 · ${this.journey.chapter.pace} · 可以慢慢走`:'';pace.hidden=!pace.textContent;
  this.root.querySelector('[data-title]')!.textContent=this.journey.complete?'沿海之旅 · 走过的路已留下':s.active?`${s.step+1} / 6 · ${this.journey.chapter.title}`:'沿海一刻钟 · 从旧城到西岬';
  this.root.querySelector('[data-hint]')!.textContent=this.journey.complete?(s.route==='coast-road'?'坐过的海堤长椅、清出的通路、救援船的日志与回应的航标，串成了一段海岸。世界变化已保存，下次还能回来。':'旧城到东港的原路线已完成，可以开启旧城—码头—南湾—西岬的新旅程。'):s.active&&s.experience&&s.step===1?(this.logRead?'航路记录已保存。回到街口取车，下一站是南湾。':this.passageStatus==='open'?'通路已清出。按 1 返回观察，沿支栈桥走到海边的记录台，靠近按 E。':this.passageStatus==='broken'?'支栈桥木板被破坏。在入口完整木板上按 1，再按 E 补齐缺口；清掉的木箱不会重生。':this.journey.chapterHint):s.active?this.journey.chapterHint:'先逛旧城、坐下看海，在码头清出通路，再去南湾停留，最后到西岬让海上的灯回应。约十五分钟，可随时停下，改变会留下。';
  const stamps=this.root.querySelector('.mc-journey-stamps')!;stamps.replaceChildren(...steps.map((c,i)=>{const e=document.createElement('span');e.textContent=`${i<s.step?'✓':'○'} ${'stamp'in c?c.stamp:['旧城','看海','潮线','上车','公路','东港'][i]}`;e.title=c.reward;return e;}));
  this.root.querySelector('[data-journey-start]')!.textContent=this.journey.complete?(s.experience==='coastal-day'?'继续自由探索':'开启沿海一刻钟'):s.active?'暂停路线':s.step?'继续这段旅程':'从旧城出发';
 }
}
