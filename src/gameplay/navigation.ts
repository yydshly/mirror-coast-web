import {REGION_BOUNDS,REGION_ROADS,REGION_PLACES} from '../world/region-layout';
import {EXPLORATION_SITES} from '../world/exploration-sites';
import {FOREST_WALK,OUTER_STOPS} from './coast-signals';
import {BAY_STOPS,BAY_BEACH_WALK} from './south-bay';
import {BOAT_LANDINGS} from '../route/boat-route';

export type MapPoint={x:number;z:number};
export type NavigationMode='walk'|'car'|'helicopter'|'fly'|'bicycle'|'boat';
export type Destination={id:string;name:string;shortName:string;position:MapPoint;kind:'district'|'activity'|'vehicle';description:string;access:string;approach?:MapPoint;trail?:readonly MapPoint[]};
const notes:Record<string,[string,string,string]>={
 'east-port':['东港','逛货运码头、厂房与集装箱街区。','驾车沿东港大道前往，到港区后停车步行。'],
 'hill-neighborhood':['山麓','沿台地住宅和院落散步，回望旧城。','沿山麓观景公路上行，在社区环路停车后步行。'],
 'west-village':['西岸社区','穿过白墙海街与坡地民居，继续前往海岬。','沿西岸海岬公路，转入白墙海街；可步行或驾车。'],
 'west-cape':['西岸海岬','在海岬看海，沿木阶下行寻找旧航标。','驾车沿西岸海岬公路到尽头，再走海侧木阶。'],
 'south-bay':['南湾','沿沙滩和潮汐栈道探索，寻找搁浅救援船。','沿南湾海岸路驾车到沙滩入口，再步行上栈道。'],
 'ridge-lookout':['北岭','登上高处俯瞰城市、港口和整片海湾。','沿山麓观景公路盘山上行，急弯减速。'],
 'forest-road':['松林','沿松林山道行进，在木阶入口寻找电台瞭望台。','驾车沿松林山道到尽头，再步行登木阶。'],
};
const harborTrail=[{x:108,z:164},{x:108,z:202},{x:100,z:205},{x:100,z:214},{x:64.5,z:214},{x:64.5,z:232},{x:16,z:232}];
export const MAP_DESTINATIONS:readonly Destination[]=[
 {id:'helipad',name:'码头停机坪',shortName:'停机坪',position:{x:108,z:209},kind:'district',description:'直升机自动返航的降落点。',access:'H 自动返航：安全离场、爬升回航、进近降落；飞行按键可接管，落地后 F 下机。'},
 {id:'bicycle',name:'海岸自行车',shortName:'自行车',position:{x:114,z:169.8},kind:'vehicle',description:'沿海岸慢骑，遇到台阶或步道可以停稳下车继续探索。',access:'靠近自行车按 E 骑行，W 蹬车、Space 刹车，F / E 下车。'},
 ...OUTER_STOPS.map(p=>({...p,kind:'district' as const})),
 ...BAY_STOPS.map(p=>({...p,kind:'activity' as const})),
 {id:'port-arrival',name:'东港 · 海岸路入口',shortName:'东港入口',position:{x:356,z:164},kind:'district',description:'驶出旧城后，货运厂房和港区进入视野。在海岸路边停稳，下车步行，沿海一日在这里接上自由探索。',access:'从旧城向东沿南湾海岸路行驶，到入口减速停车，Esc 下车。继续向北可逛东港，向东可到南湾。'},
 {id:'coast-rest',name:'海堤长椅 · 港口眺望',shortName:'看海',position:{x:183,z:172.8},kind:'district',description:'沿海侧人行道散步，坐下看船只经过港口。',access:'绕过长椅一侧到座位前，按 E 坐下。',approach:{x:180,z:169.5},trail:[{x:180,z:169.5},{x:180,z:172.8},{x:183,z:172.8}]},
 {id:'city-beach',name:'旧城东岸 · 潮线沙滩',shortName:'潮线',position:{x:260,z:180.8},kind:'activity',description:'从海堤东端木踏步走下沙滩，看看潮线留下的漂流木。沿海一日途中可在此记录海岸。',access:'沿人行道向东，在栏杆尽头绕行，走木踏步下沙滩，按 E 记录潮线；原路返回路边旅行车。',approach:{x:258,z:164},trail:[{x:258,z:164},{x:260,z:170},{x:260,z:180.8}]},
 {id:'seafront',name:'滨海长椅 · 看海',shortName:'长椅',position:{x:61,z:172.8},kind:'district',description:'坐在海边长椅上看海，起身后沿滨海步道散步。面向有安全落点的低栏，还能扶栏翻越。',access:'绕到长椅前，面向座位按 E 坐下；坐着可环视，E / Space 起身，C 切换视角。',approach:{x:61,z:164},trail:[{x:61,z:164},{x:59,z:170.2},{x:59,z:172.8},{x:61,z:172.8}]},
 {id:'old-city',name:'旧城商店街',shortName:'旧城',position:{x:135.5,z:159.5},kind:'district',description:'逛商店街、雨夜窄巷和海风公园，也可以在地面试着挖除与爆破。',access:'适合步行；按 C 切换视角，1 / 2 / 3 切换观察、挖除与爆破。'},
 {id:'harbor',name:'渔港木屋街',shortName:'渔港',position:{x:16,z:232},kind:'district',description:'逛木栈街，进入海盐面包房和港口食堂，看看近岸船只。',access:'沿码头与连接栈桥步行。汽车停在滨海大道，木栈区域适合步行。',approach:harborTrail[0],trail:harborTrail},
 {id:'harbor-log',name:'渔港西栈桥 · 航路记录',shortName:'清障通路',position:{x:-10,z:232.5},kind:'activity',description:'木箱挡住了一条支栈桥。清出两格宽的通路，走到海边查看记录，接着去南湾与西岬。重新进入后，清出的路和航标的变化都会保留。',access:'2 挖除，瞄准木箱点击；保留脚下木板，1 返回观察。走到记录台附近按 E。3 爆破会损坏栈桥，请自行选择。',approach:harborTrail[0],trail:[...harborTrail,{x:8,z:232.5},{x:-10,z:232.5}]},
 ...REGION_PLACES.map(p=>({id:p.id,name:p.name,shortName:notes[p.id][0],position:p.position,kind:'district' as const,description:notes[p.id][1],access:notes[p.id][2]})),
 ...EXPLORATION_SITES.map(p=>({id:p.id,name:p.title,shortName:p.id==='forest-radio'?'电台':p.id==='tidal-rescue'?'救援船':'旧航标',position:p.position,kind:'activity' as const,description:p.description,access:`${p.actionHint}：停车后沿绿色虚线步行，靠近装置按 E 调查。`,approach:p.approach,trail:[...p.route,p.position]})),
 ...BOAT_LANDINGS.map(l=>({id:l.id,name:l.name,shortName:l.shortName,position:{x:l.x,z:l.endZ-1},kind:'district' as const,description:'低位木栈桥连接现有岸上道路与可航行水面。可在这里靠泊、下船步行，或从岸边再次出航。',access:'靠近栈桥一侧，提前松开 W、Space 减速。停稳后 F / E 上岸；步行到船旁按 E 驾驶。',approach:{x:l.x,z:l.z},trail:[{x:l.x,z:l.z},{x:l.x,z:l.endZ-1}]})),
 {id:'boat',name:'海岸小艇',shortName:'小艇',position:{x:119.7,z:224.8},kind:'vehicle',description:'一艘可驾驶的小型动力艇。码头、南湾和西岬有低位靠泊栈桥，可以下船接着探索。',access:'在码头小艇栈桥走下木阶，到船旁按 E；也可点击顶部「小艇」。W / S 航行与倒航，A / D 操舵，Space 减速，靠岸停稳后 F 上岸。',approach:{x:116,z:214.5},trail:[{x:116,z:214.5},{x:116,z:225}]},
 {id:'car',name:'旅行车',shortName:'汽车',position:{x:248,z:164},kind:'vehicle',description:'找到当前停放的旅行车，接着沿道路探索外围。',access:'步行到车旁按 E 接管；也可使用顶部「汽车」。W/S 前进与倒车，A/D 转向。'},
 {id:'helicopter',name:'直升机',shortName:'直升机',position:{x:108,z:209},kind:'vehicle',description:'找到直升机，自由飞行，或开启近岸自动导览。',access:'到机旁按 E 接管；也可点击顶部「直升机」。Space 上升，Shift 下降。',approach:{x:108,z:164},trail:[{x:108,z:164},{x:108,z:209}]},
];
export const destinationById=(id:string)=>MAP_DESTINATIONS.find(p=>p.id===id);
export function mapProjection(p:MapPoint){return{x:p.x-REGION_BOUNDS.minX,y:p.z-REGION_BOUNDS.minZ};}
export function mapMarker(p:MapPoint){const q=mapProjection(p);return{x:Math.max(16,Math.min(1008,q.x)),y:Math.max(16,Math.min(752,q.y)),outside:q.x<0||q.x>1024||q.y<0||q.y>768};}
export type NavigationLine={id:string;kind:'road'|'foot';points:readonly MapPoint[]};
export const NAVIGATION_LINES:readonly NavigationLine[]=[
 ...BAY_STOPS.map(p=>({id:p.id,kind:'foot' as const,points:p.trail})),
 {id:'forest-glade',kind:'foot',points:FOREST_WALK},
 {id:'bay-beach-walk',kind:'foot',points:BAY_BEACH_WALK},
 {id:'beach-return',kind:'foot',points:[{x:258,z:164},{x:260,z:170}]},
 ...[130,176,222].map(x=>({id:`promenade-crossing-${x}`,kind:'foot' as const,points:[{x,z:164},{x,z:169.5}]})),
 {id:'promenade',kind:'foot',points:[{x:38,z:169.5},{x:258,z:169.5},{x:260,z:170},{x:260,z:180.8}]},
 {id:'coast-rest',kind:'foot',points:[{x:180,z:169.5},{x:180,z:172.8},{x:183,z:172.8}]},
 {id:'seafront-walk',kind:'foot',points:[{x:61,z:164},{x:59,z:170.2},{x:59,z:172.8},{x:61,z:172.8}]},
 ...REGION_ROADS.map(r=>({id:r.id,kind:'road' as const,points:r.points})),
 ...[35,80,125,164].map(z=>({id:`city-row-${z}`,kind:'road' as const,points:[{x:0,z},{x:256,z}]})),
 ...[38,84,130,176,222].map(x=>({id:`city-column-${x}`,kind:'road' as const,points:[{x,z:0},{x,z:164}]})),
 {id:'harbor-walk',kind:'foot',points:harborTrail},
 {id:'helipad-walk',kind:'foot',points:[{x:108,z:214},{x:108,z:209}]},
 ...EXPLORATION_SITES.map(p=>({id:p.id,kind:'foot' as const,points:[...p.route,p.position]})),
];
const distance=(a:MapPoint,b:MapPoint)=>Math.hypot(a.x-b.x,a.z-b.z);
type Segment={a:MapPoint;b:MapPoint;kind:'road'|'foot';cuts:number[]};
type Edge={a:number;b:number;kind:'road'|'foot';length:number};
const project=(p:MapPoint,a:MapPoint,b:MapPoint)=>{const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l)):0;return{t,point:{x:a.x+t*dx,z:a.z+t*dz}};};

/** Authored road/footway graph. This is a route reference, not voxel pathfinding. */
export class CoastalNavigation {
 readonly nodes:MapPoint[]=[];
 readonly edges:Edge[]=[];
 constructor(lines:readonly NavigationLine[]=NAVIGATION_LINES){
  const segments:Segment[]=[];
  for(const l of lines)for(let i=1;i<l.points.length;i++)if(distance(l.points[i-1],l.points[i])>.01)segments.push({a:l.points[i-1],b:l.points[i],kind:l.kind,cuts:[0,1]});
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
   const s=segments[i],t=segments[j],dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,ex=t.b.x-t.a.x,ez=t.b.z-t.a.z,det=dx*ez-dz*ex;
   if(Math.abs(det)>1e-8){const x=t.a.x-s.a.x,z=t.a.z-s.a.z,u=(x*ez-z*ex)/det,v=(x*dz-z*dx)/det;if(u>=0&&u<=1&&v>=0&&v<=1){s.cuts.push(u);t.cuts.push(v);}}
   for(const [p,other]of [[s.a,t],[s.b,t],[t.a,s],[t.b,s]] as const){const q=project(p,other.a,other.b);if(distance(p,q.point)<.01)other.cuts.push(q.t);}
  }
  const ids=new Map<string,number>();
  const node=(p:MapPoint)=>{const key=`${p.x.toFixed(4)},${p.z.toFixed(4)}`;let id=ids.get(key);if(id===undefined){id=this.nodes.length;ids.set(key,id);this.nodes.push(p);}return id;};
  for(const s of segments){const cuts=[...new Set(s.cuts.map(v=>Math.round(v*1e8)/1e8))].sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){
   const a=node({x:s.a.x+(s.b.x-s.a.x)*cuts[i-1],z:s.a.z+(s.b.z-s.a.z)*cuts[i-1]}),b=node({x:s.a.x+(s.b.x-s.a.x)*cuts[i],z:s.a.z+(s.b.z-s.a.z)*cuts[i]});
   if(a!==b)this.edges.push({a,b,kind:s.kind,length:distance(this.nodes[a],this.nodes[b])});
  }}
 }
 route(start:MapPoint,end:MapPoint,driving=false):{points:MapPoint[];distance:number;lead:number}|null{
  const edges=this.edges.filter(e=>!driving||e.kind==='road');
  const nearest=(p:MapPoint)=>edges.map(edge=>({edge,...project(p,this.nodes[edge.a],this.nodes[edge.b])})).sort((a,b)=>distance(p,a.point)-distance(p,b.point))[0];
  const s=nearest(start),t=nearest(end);if(!s||!t)return null;
  const costs=this.nodes.map(()=>Infinity),previous=this.nodes.map(()=>-1),pending=new Set(this.nodes.map((_,i)=>i));
  for(const id of [s.edge.a,s.edge.b])costs[id]=distance(s.point,this.nodes[id]);
  while(pending.size){let best=-1,cost=Infinity;for(const id of pending)if(costs[id]<cost){best=id;cost=costs[id];}if(best<0)break;pending.delete(best);
   for(const e of edges){const next=e.a===best?e.b:e.b===best?e.a:-1;if(next<0||!pending.has(next))continue;const value=cost+e.length;if(value<costs[next]){costs[next]=value;previous[next]=best;}}
  }
  const finish=[t.edge.a,t.edge.b].sort((a,b)=>(costs[a]+distance(this.nodes[a],t.point))-(costs[b]+distance(this.nodes[b],t.point)))[0];
  if(!Number.isFinite(costs[finish]))return null;
  let points:MapPoint[];
  if(s.edge===t.edge&&distance(s.point,t.point)<=costs[finish]+distance(this.nodes[finish],t.point))points=[s.point,t.point];
  else{const chain:MapPoint[]=[];let at=finish;while(at>=0){chain.unshift(this.nodes[at]);at=previous[at];}points=[s.point,...chain,t.point];}
  const lead=distance(start,s.point);points=[start,...points,end];
  return{points,distance:points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0),lead};
 }
}
