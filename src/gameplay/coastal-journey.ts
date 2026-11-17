import type {Vector3Like} from '../world/voxel';
export type JourneySave={step:number;active:boolean;route?:'coast-road';vehicle?:'bicycle'|'car';experience?:'harbor-signal'|'coastal-day';stroll?:boolean};
export const JOURNEY_STEPS=[
 {target:'old-city',title:'从旧城出发',hint:'步行走到滨海商店街。沿橱窗向海边走，先熟悉这座城。',reward:'旧城 · 海风从街口吹进来了。'},
 {target:'coast-rest',title:'沿海散步，坐下看海',hint:'沿海侧人行道前往长椅；绕到座位前按 E。沿途其他海边长椅也可以。',reward:'看海 · 船只越过港口，城市暂时留在身后。'},
 {target:'city-beach',title:'沿东端步道下沙滩',hint:'起身后向东沿人行道走。海堤尽头绕开栏杆，沿木踏步下到潮线，按 E 记录海岸。',reward:'潮线 · 一段漂流木，带着海水留下的浅色纹路。'},
 {target:'car',title:'回到路边，找到旅行车',hint:'沿同一条踏步返回公路，地图标出旅行车实际位置。到车旁按 E，准备驶出旧城。',reward:'出发 · 海岸公路从这里接上外围。'},
 {target:'port-arrival',title:'沿公路驶往东港',hint:'沿地图金色道路向东。到东港后减速停车，Esc 下车，再步行看看码头。',reward:'东港 · 海风里多了货轮和码头的声音。'},
 {target:'port-arrival',title:'停车后走进东港',hint:'停稳后下车，在码头街区步行。旅程会留在手记里，随后可自由前往南湾或山岭。',reward:'沿海一日完成 · 旧城、海堤、潮线与港区，已经连成你走过的路。'},
] as const;
/** The frozen fifteen-minute slice reuses the existing seats, pier, bay and
 * signal. These are suggested beats, never countdowns or enforced waiting. */
export const COASTAL_DAY_STEPS=[
 {target:'old-city',title:'旧城 · 先坐下来看看海',hint:'先沿橱窗走过旧城街口，再向西走到海堤长椅，靠近座位按 E。看看船只，再出发。',reward:'旧城 · 海风穿过街屋，旅程从一次看海开始。',stamp:'看海',pace:'0–3 分钟'},
 {target:'harbor-log',title:'码头 · 留下一条能走的路',hint:'沿木栈街走到西端支栈桥。2 挖除挡路木箱，保留脚下木板；1 返回观察，走到记录台按 E。',reward:'码头 · 通路清出来了。航路记录上圈着西岬的 205°。',stamp:'通路',pace:'3–6 分钟'},
 {target:'car',title:'海岸路 · 城市渐渐退到身后',hint:'沿海堤取回旅行车，也可以骑自行车。靠近按 E 上车，沿地图道路去南湾，在营地入口停车。',reward:'海岸路 · 沿着海走，南湾从道路转弯处露出来。',stamp:'上路',pace:'6–8 分钟'},
 {target:'bay-camp',title:'南湾 · 风、潮水与船边的日志',hint:'停稳下车，放飞风筝或去潮池停留。然后沿木栈道到救援船旁，按 E 打开防水箱。',reward:'南湾 · 留下一段风与潮水。救援船的日志，把航路接到了西岬。',stamp:'南湾',pace:'8–11 分钟'},
 {target:'cape-signal',title:'西岬 · 对准海上的那盏灯',hint:'取车沿海岸返回旧城，再上西岬公路。尽头停车，沿海侧木阶下行，将透镜对准 205° 并锁定。',reward:'西岬 · 透镜停在 205°，海上的绿灯回应了。',stamp:'回应',pace:'11–14 分钟'},
 {target:'west-cape',title:'回望 · 这次出发留下了变化',hint:'沿木阶回到公路尽头，停下来看看海湾。通路、翻开的日志和航标都会保留，下次还能回来。',reward:'沿海一刻钟完成 · 清出的通路、翻开的日志、对准的航标，已经成为这片海岸的一部分。',stamp:'回望',pace:'14–15 分钟'},
] as const;
export const COASTAL_ROUTE_STEPS=[
 {target:'old-city',title:'旧城 · 从街口走向海风',hint:'沿滨海商店街向海走，先走过街口，再沿地图步行去渔港。整段约十几分钟，可随时停下。',reward:'旧城 · 熟悉的街口，开始有了海风。',stamp:'旧城'},
 {target:'harbor',title:'码头 · 清出通往海边的路',hint:'经过停机坪，沿木栈街走到西端的支栈桥。用 2 挖除挡路木箱，保留脚下木板；走到尽头按 E 查看航路记录。主街始终可以通行。',reward:'码头 · 清出的通路留了下来。航路记录指向南湾与西岬，旧航标的方位是 205°。',stamp:'通路'},
 {target:'bicycle',title:'上路 · 沿海岸驶向南湾',hint:'返回海堤，按地图找回自行车或汽车。靠近按 E 上车，沿南湾海岸路向东。',reward:'海岸路 · 城市渐渐退到身后，风开始变得开阔。',stamp:'上路'},
 {target:'bay-camp',title:'南湾 · 留一段风与潮水',hint:'在营地入口停稳下车。沿沙地走到线轴放飞风筝，或去岩岸静看潮池、坐下看海。',reward:'南湾 · 这一阵风、这一汪潮水，成为沿途的一次停留。',stamp:'南湾'},
 {target:'cape-signal',title:'西岬 · 让海上的灯回应',hint:'回步道取车，沿海岸路返回旧城，再驶上西岬公路。尽头停车，沿木阶下到航标站。参照码头记录的 205° 转动透镜并锁定，观察海上标灯回应。',reward:'西岬 · 航标与渔港的引航灯已经接通。沿木阶回高处，看看这次留下的变化。',stamp:'航标'},
 {target:'west-cape',title:'海岬 · 回望整片海湾',hint:'沿原来的木阶回到海岬公路尽头，在高处停留片刻。想继续走时，白墙海街与松林仍在路的另一侧。',reward:'沿海之旅完成 · 旧城、码头、南湾与西岬，连成了一段真正走过的海岸。',stamp:'回望'},
] as const;
export type JourneyEvidence={bayNotes?:readonly string[];discoveries?:ReadonlySet<string>;harborLog?:boolean;beaconLinked?:boolean};
export function validateJourney(v:unknown):JourneySave{const s=v as JourneySave;if(!s||!Number.isInteger(s.step)||s.step<0||s.step>6||typeof s.active!=='boolean'||s.route!==undefined&&s.route!=='coast-road'||s.vehicle!==undefined&&s.vehicle!=='bicycle'&&s.vehicle!=='car'||s.experience!==undefined&&(!['harbor-signal','coastal-day'].includes(s.experience)||s.route!=='coast-road')||s.stroll!==undefined&&(typeof s.stroll!=='boolean'||s.experience!=='coastal-day'))throw new Error('沿海旅程进度无效。');return{step:s.step,active:s.active,...s.route?{route:s.route}:{},...s.vehicle?{vehicle:s.vehicle}:{},...s.experience?{experience:s.experience}:{},...s.stroll!==undefined?{stroll:s.stroll}:{}};}
export class CoastalJourney{
 state:JourneySave={step:0,active:false,route:'coast-road'};
 private dwell=0;
 private lastWalk:Vector3Like|undefined;private walked=0;
 private evidence:JourneyEvidence={};private navigationChoice:string|undefined;
 get steps(){return this.state.experience==='coastal-day'?COASTAL_DAY_STEPS:this.state.route==='coast-road'?COASTAL_ROUTE_STEPS:JOURNEY_STEPS;}
 get chapter(){return this.steps[this.state.step];}
 get complete(){return this.state.step===6;}
 restore(s:JourneySave){this.state=validateJourney(s);this.dwell=0;this.lastWalk=undefined;this.walked=0;this.navigationChoice=undefined;}
 beginCoastalRoute(){this.restore({step:0,active:true,route:'coast-road',experience:'coastal-day',vehicle:'car'});}
 get chapterHint(){
  if(this.state.experience==='coastal-day'){
   if(this.state.step===0&&this.state.stroll)return '街口已走过。沿海堤向西去看海长椅，绕到座位前按 E；沿途其他海堤长椅也可以。';
   if(this.state.step===3&&this.evidence.bayNotes?.length)return '已经在南湾停留。沿木栈道走到救援船旁的防水箱，靠近按 E，看看那份归港日志。';
  }
  return this.chapter?.hint??'';
 }
 /** Tracking the next stop inside this outing must not silently pause it. */
 trackStop(id:string):boolean{
  if(!this.state.active||this.complete||this.state.route!=='coast-road')return false;
  const allowed=this.state.step===0?['old-city','seafront','coast-rest']:this.state.step===1?['harbor','harbor-log']:this.state.step===2?['car','bicycle']:this.state.step===3?['bay-camp','bay-pools','bay-overlook','tidal-rescue']:this.state.step===4?['car','bicycle','cape-signal']:['west-cape'];
  if(!allowed.includes(id))return false;
  if(id==='car'||id==='bicycle')this.state.vehicle=id;
  this.navigationChoice=id;return true;
 }
 navigationTarget(p:Vector3Like,mode:string):string|undefined{
  if(!this.state.active||this.complete)return;
  if(this.state.experience==='coastal-day'&&this.state.step===0&&this.state.stroll)return this.navigationChoice==='coast-rest'?'coast-rest':'seafront';
  if(this.state.experience==='coastal-day'&&this.state.step===3&&this.evidence.bayNotes?.length)return 'tidal-rescue';
  if(this.state.route==='coast-road'&&this.state.step===4&&mode!=='car'&&mode!=='bicycle'&&Math.hypot(p.x+180,p.z-90)>65)return this.state.vehicle??'bicycle';
  if(this.navigationChoice)return this.navigationChoice;
  if(this.state.experience&&this.state.step===1)return 'harbor-log';
  return this.state.step===2&&this.state.route==='coast-road'?(this.state.vehicle??this.chapter.target):this.chapter.target;
 }
 advance(){if(this.complete)return '';const text=this.chapter.reward;this.state={...this.state,step:this.state.step+1};this.dwell=0;this.walked=0;this.lastWalk=undefined;this.navigationChoice=undefined;return text;}
 update(dt:number,p:Vector3Like,mode:string,seatedId?:string,evidence:JourneyEvidence={}):string{
  this.evidence=evidence;if(!this.state.active||this.complete)return '';
  if(this.state.route==='coast-road')return this.updateCoastal(dt,p,mode,seatedId,evidence);
  if(this.state.step===5&&mode==='walk'){if(this.lastWalk){const d=Math.hypot(p.x-this.lastWalk.x,p.z-this.lastWalk.z);if(d<2)this.walked+=d;}this.lastWalk={...p};}else{this.lastWalk=undefined;this.walked=0;}
  const near=(x:number,z:number,r:number)=>Math.hypot(p.x-x,p.z-z)<r;
  const valid=this.state.step===0?mode==='walk'&&near(135.5,159.5,14):this.state.step===1?mode==='walk'&&!!seatedId?.startsWith('coast-bench-'):this.state.step===3?mode==='car':this.state.step===4?mode==='car'&&near(356,164,24):this.state.step===5?mode==='walk'&&near(356,164,35)&&this.walked>=3:false;
  this.dwell=valid?this.dwell+dt:0;return this.dwell>=1.5?this.advance():'';
 }
 private updateCoastal(dt:number,p:Vector3Like,mode:string,seatedId:string|undefined,evidence:JourneyEvidence):string{
  if(this.state.step===2&&(mode==='car'||mode==='bicycle'))this.state.vehicle=mode;
  let moved=0;if(mode==='walk'&&this.lastWalk){const d=Math.hypot(p.x-this.lastWalk.x,p.z-this.lastWalk.z);if(d<2){this.walked+=d;moved=d;}}else this.walked=0;
  this.lastWalk=mode==='walk'?{...p}:undefined;
  const near=(x:number,z:number,r:number)=>Math.hypot(p.x-x,p.z-z)<r;
  const day=this.state.experience==='coastal-day';
  if(day&&this.state.step===0&&!this.state.stroll&&mode==='walk'&&near(135.5,159.5,20)&&this.walked>3)this.state={...this.state,stroll:true};
  const valid=this.state.step===0?mode==='walk'&&(day?!!this.state.stroll&&!!seatedId?.startsWith('coast-bench-'):near(135.5,159.5,20)&&this.walked>3):
    this.state.step===1?mode==='walk'&&(this.state.experience?!!evidence.harborLog&&near(-10,232.5,7):near(24,231,30)&&this.walked>8):
    this.state.step===2?mode==='bicycle'||mode==='car':
    this.state.step===3?mode==='walk'&&p.x>602&&p.x<725&&p.z>148&&p.z<190&&!!evidence.bayNotes?.length&&(!day||!!evidence.discoveries?.has('tidal-rescue')):
    this.state.step===4?mode==='walk'&&near(-187,126.5,16)&&!!evidence.discoveries?.has('cape-signal')&&(!this.state.experience||!!evidence.beaconLinked):
    mode==='walk'&&p.y>26&&near(-180,90,24)&&moved<.025;
  this.dwell=valid?this.dwell+dt:0;return this.dwell>=(this.state.step===5?7:1.5)?this.advance():'';
 }
 beachAvailable(p:Vector3Like,mode:string){return this.state.route!=='coast-road'&&this.state.active&&this.state.step===2&&mode==='walk'&&p.y<15.8&&Math.hypot(p.x-260,p.z-180.8)<7;}
}
