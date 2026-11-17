import { decodeWorldIndex, worldIndex, type BuildingRegistry } from '../destruction/buildings';
import { Material as M } from './palette';
import { regionalHeightAt } from './region-terrain';
import { sampleRegionalRoad } from './region-layout';
import type { Vector3Like, VoxelWorld } from './voxel';

export type ExplorationId = 'forest-radio' | 'tidal-rescue' | 'cape-signal';
export type ExplorationSite = {
  id: ExplorationId; title: string; description: string; actionHint: string; completedText: string;
  approach: Vector3Like; position: Vector3Like; lookAt: Vector3Like;
  anchors: readonly Vector3Like[]; route: readonly {x:number;z:number}[];
};
const eye = (x:number,z:number) => ({x,y:regionalHeightAt(x,z)+2.68,z});

export const EXPLORATION_SITES: readonly ExplorationSite[] = [
  {
    id:'forest-radio',title:'松林无线电瞭望站',description:'沿着松林山道尽头的木阶登上瞭望台。海岸信号已经中断，平台上还留着一台需要调频和调整天线的旧电台。',
    actionHint:'调频、转动天线并发送呼叫',completedText:'电台重新接通。接收到巡岸船的回应。下台后可以原路回到旅行车，沿山路继续前往北岭。',
    approach:eye(-90,-245),position:{x:-65.12,y:67.45,z:-224.5},lookAt:{x:-65,y:69,z:-224},
    anchors:[{x:-65,y:67,z:-225}],
    route:[{x:-90,z:-245},{x:-88,z:-234},{x:-87.5,z:-224.5},{x:-67.5,z:-224.5}],
  },
  {
    id:'tidal-rescue',title:'南湾潮汐救援点',description:'沙滩尽头，一条旧栈道伸向搁浅的救援船。绕过断桅，在船旁的防水箱里寻找记录。',
    actionHint:'打开防水救援箱',completedText:'救援箱里是一份完整的海岸巡航日志：松林电台与西岸旧航标曾共同引导船只归港。',
    approach:eye(650,139),position:{x:657.5,y:15.48,z:186.08},lookAt:{x:663,y:16,z:184},
    anchors:[{x:657,y:14,z:186}],
    route:[{x:650,z:139},{x:657.5,z:149.5},{x:657.5,z:183.5}],
  },
  {
    id:'cape-signal',title:'西岬旧航标站',description:'从海岬公路尽头沿着海侧木阶下行，绕过白墙民居，在岩岸低处找到旧航标的控制台。',
    actionHint:'转动透镜，对准海上标灯',completedText:'旧航标重新点亮。站在平台外缘可以望见港口与城市，双礁之间的标灯已收到信号。回公路取车后，可前往松林山道。',
    approach:eye(-180,90),position:{x:-187.12,y:21.65,z:126.5},lookAt:{x:-184,y:29,z:124},
    anchors:[{x:-187,y:21,z:126}],
    route:[{x:-180,z:90},{x:-173,z:104},{x:-173,z:115},{x:-189.5,z:121},{x:-189.5,z:126.5}],
  },
] as const;

export type ExplorationSummary = {buildingIds:string[];addedVoxels:number};

/** A separately versioned additive layer: not one original terrain/building cell is overwritten. */
export function addExplorationSites(world:VoxelWorld,buildings:BuildingRegistry):ExplorationSummary {
  const ids:string[]=[];let added=0;let owned:Set<number>|undefined;
  const core=(x:number,z:number)=>x>=0&&x<256&&z>=0&&z<256;
  const put=(x:number,y:number,z:number,m:number)=>{
    if(core(x,z)||!world.contains(x,y,z)||world.getVoxel(x,y,z))return;
    const road=sampleRegionalRoad(x+.5,z+.5,7);
    if(road&&road.distance<=road.halfWidth+road.shoulder)return;
    world.setVoxel(x,y,z,m,false);added++;owned?.add(worldIndex(x,y,z));
  };
  const box=(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,m:number)=>{
    for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)put(x,y,z,m);
  };
  const register=(id:string,title:string)=>{
    if(owned?.size){
      let foundation=95;
      for(const value of owned)foundation=Math.min(foundation,decodeWorldIndex(value).y);
      buildings.add(id,title,foundation,owned);ids.push(id);
    }
    owned=undefined;
  };
  const post=(x:number,z:number,top:number,m:number=M.Wood)=>box(x,regionalHeightAt(x,z)+1,z,x,top,z,m);

  // A narrow timber staircase rises from the mountain road to an open trestle
  // tower. Risers connect all steps, but empty space remains under the stair.
  for(let x=-88;x<=-69;x++){
    const y=x+133;
    box(x,y-1,-226,x,y,-224,M.Wood);
    if((x+86)%4===0)for(const z of [-226,-224])post(x,z,y-2);
  }
  owned=new Set();
  box(-68,65,-227,-62,65,-221,M.Wood);
  for(const x of [-68,-62])for(const z of [-227,-221])post(x,z,64);
  // Rail breaks at the west stair landing and the radio console, with clear
  // central standing room instead of furnishing another small interior.
  for(const z of [-227,-221])box(-68,66,z,-62,66,z,M.Trim);
  box(-62,66,-226,-62,66,-222,M.Trim);
  for(const x of [-68,-62])for(const z of [-227,-221])box(x,67,z,x,69,z,M.Wood);
  box(-68,70,-227,-62,70,-221,M.Roof);
  box(-65,66,-225,-65,67,-225,M.Roof);
  box(-63,71,-222,-63,78,-222,M.Roof);
  box(-66,76,-222,-60,76,-222,M.Trim);
  box(-63,74,-225,-63,74,-219,M.Trim);
  put(-63,79,-222,M.Lamp);
  register('explore-forest-radio','松林电台与木阶瞭望台');

  // The southern route follows the beach and then spans the shallow tidal water.
  for(let z=150;z<=188;z++){
    // The landward boardwalk follows existing sand; only its over-water span
    // is a suspended structure, so terrain-supported pieces never pre-detach.
    if(z===177)owned=new Set();
    box(656,14,z,658,14,z,M.Wood);
    if((z-150)%6===0)for(const x of [656,658])post(x,z,13);
    if(z>=163&&z%4===0){
      for(const x of [655,659])post(x,z,15,M.Trim);
      box(655,15,z,656,15,z,M.Trim);box(658,15,z,659,15,z,M.Trim);
    }
  }
  box(654,14,181,663,14,188,M.Wood);
  for(const x of [654,663])for(const z of [181,188])post(x,z,13);
  register('explore-tidal-boardwalk','南湾潮汐栈道');
  owned=new Set();
  // A recognisable open hull: keel, tapered bow, raised stern, broken mast and
  // cabin fragment. The boardwalk runs alongside it rather than through it.
  for(let z=175;z<=187;z++){
    const half=z<178?Math.max(0,z-175):z>185?2:3;
    for(let x=668-half;x<=668+half;x++){
      put(x,13,z,M.Roof);put(x,14,z,M.Wood);
      if(x===668-half||x===668+half){put(x,15,z,M.Red);put(x,16,z,M.Trim);}
    }
  }
  box(667,15,183,669,17,185,M.Cream);
  box(667,18,183,669,18,185,M.Roof);
  put(667,17,182,M.DarkWindow);put(669,17,182,M.DarkWindow);
  box(668,15,179,668,21,179,M.Wood);box(668,21,179,671,21,179,M.Trim);
  register('explore-tidal-wreck','搁浅的南湾救援船');

  // A coastal stair descends around existing houses. Its narrow graded profile
  // never cuts the terrain, the original road or a previous structure.
  const cape=EXPLORATION_SITES[2];
  const samples:Array<{x:number;z:number;y:number}>=[];
  for(let segment=1;segment<cape.route.length;segment++){
    const a=cape.route[segment-1],b=cape.route[segment],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z));
    for(let i=0;i<=n;i++){
      const t=i/n,x=Math.floor(a.x+(b.x-a.x)*t),z=Math.floor(a.z+(b.z-a.z)*t);
      if(samples.at(-1)?.x===x&&samples.at(-1)?.z===z)continue;
      let h=regionalHeightAt(x,z);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)h=Math.max(h,regionalHeightAt(x+dx,z+dz));
      samples.push({x,z,y:h+1});
    }
  }
  for(let i=1;i<samples.length;i++)samples[i].y=Math.max(samples[i].y,samples[i-1].y-1);
  for(let i=samples.length-2;i>=0;i--)samples[i].y=Math.max(samples[i].y,samples[i+1].y-1);
  owned=new Set();
  // Open western arrival court: stairs, bell and controls have their own space.
  // A solid footing connects the extension to the rock rather than floating.
  box(-194,20,121,-182,20,131,M.Concrete);
  for(const x of [-194,-191,-188])for(const z of [121,126,131])post(x,z,19,M.Rock);
  for(const x of [-190,-182])for(const z of [122,129])post(x,z,19,M.Rock);
  // A short octagonal daymark and open service court, not a second house.
  for(let y=21;y<=31;y++)for(let z=122;z<=126;z++)for(let x=-186;x<=-182;x++){
    if((x===-186||x===-182)&&(z===122||z===126))continue;
    if(x>-186&&x<-182&&z>122&&z<126&&y<30)continue;
    put(x,y,z,y>=26&&y<=27?M.Red:M.Cream);
  }
  box(-186,32,122,-182,32,126,M.Roof);
  box(-185,33,123,-183,34,125,M.Window);
  box(-186,35,122,-182,35,126,M.Roof);
  put(-184,36,124,M.Lamp);
  box(-187,21,126,-187,21,126,M.Roof);
  box(-190,21,129,-182,21,129,M.Trim);
  // Low, broken wall fragments leave a viewing edge and a broad entry gap.
  box(-186,21,129,-183,21,129,M.Rock);
  box(-185,22,129,-183,22,129,M.Rock);
  register('explore-cape-signal','西岬旧航标与海岸平台');
  for(const p of samples)for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)box(p.x+dx,p.y-1,p.z+dz,p.x+dx,p.y,p.z+dz,M.Wood);
  return {buildingIds:ids,addedVoxels:added};
}
