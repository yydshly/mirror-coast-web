import type {Vector3Like} from '../world/voxel';
import {Material} from '../world/palette';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const patch=(p:Vector3Like,x:number,z:number,r:number)=>Math.exp(-((p.x-x)**2+(p.z-z)**2)/(r*r));
export function coastalSoundProfile(p:Vector3Like,wetness=0){
 const city=clamp(1-Math.max(0,-p.x,p.x-256)/80)*clamp(1-Math.max(0,-p.z,p.z-174)/85);
 const harbor=patch(p,75,226,95),bay=patch(p,661,169,130),cape=patch(p,-184,126,110);
 const shore=180+Math.sin(p.x*.009)*17+Math.sin(p.x*.021+.7)*10,coast=Math.exp(-(((p.z-shore)/65)**2));
 return{city,harbor,bay,cape,surf:clamp(coast*.7+bay*.4+harbor*.2),wind:clamp(.12+cape*.7+bay*.45+p.y/160+wetness*.22)};
}
/** One opt-in soundscape, crossfaded by place; no microphone or remote assets. */
export class CoastalAmbience{
 private context:AudioContext|undefined;private master:GainNode|undefined;
 private channels=new Map<string,{gain:GainNode;filter:BiquadFilterNode}>();
 private noise:AudioBuffer|undefined;private muted=true;private clock=0;private timer=0;private gullIn=9;
 private lastPosition:Vector3Like|undefined;private stepDistance=0;private state=coastalSoundProfile({x:128,y:16,z:164});
 setEnabled(enabled:boolean){
  this.muted=!enabled;if(!enabled){if(this.master)this.master.gain.setTargetAtTime(0,this.context!.currentTime,.15);return;}
  if(typeof AudioContext==='undefined')return;
  try{
   if(!this.context){
    const c=this.context=new AudioContext();this.master=c.createGain();this.master.gain.value=0;this.master.connect(c.destination);
    this.noise=c.createBuffer(1,c.sampleRate*3,c.sampleRate);const samples=this.noise.getChannelData(0);let smoothed=0;
    for(let i=0;i<samples.length;i++){smoothed=.87*smoothed+.13*(Math.random()*2-1);samples[i]=smoothed*2;}
    for(const [name,type,frequency,rate]of [['surf','lowpass',1400,.83],['wind','bandpass',460,.69],['city','lowpass',180,1],['harbor','bandpass',260,.91]] as const){
     const source=c.createBufferSource();source.buffer=this.noise;source.loop=true;source.playbackRate.value=rate;
     const filter=c.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.Q.value=.65;
     const gain=c.createGain();gain.gain.value=0;source.connect(filter).connect(gain).connect(this.master);source.start();this.channels.set(name,{gain,filter});
    }
   }
   void this.context.resume();this.master!.gain.setTargetAtTime(.30,this.context.currentTime,.4);
  }catch{/* Sound failure never interrupts movement or exploration. */}
 }
 update(dt:number,p:Vector3Like,walking:boolean,material:number,wetness:number,night:number){
  this.clock+=dt;this.timer+=dt;this.state=coastalSoundProfile(p,wetness);
  if(this.lastPosition&&walking&&!this.muted){const d=Math.hypot(p.x-this.lastPosition.x,p.z-this.lastPosition.z);if(d<1)this.stepDistance+=d;else this.stepDistance=0;if(this.stepDistance>.78){this.stepDistance%=.78;this.footstep(material);}}else this.stepDistance=0;
  this.lastPosition={...p};
  if(this.muted||!this.context||this.timer<.1)return;this.timer=0;
  const c=this.context,t=c.currentTime,s=this.state,swell=.65+.23*Math.sin(this.clock*.64)+.12*Math.sin(this.clock*1.13);
  const levels={surf:s.surf*swell*.48,wind:s.wind*(.11+.035*Math.sin(this.clock*.31)),city:s.city*.045*(1-night*.6),harbor:s.harbor*.018};
  for(const [name,level]of Object.entries(levels))this.channels.get(name)!.gain.gain.setTargetAtTime(level,t,.5);
  this.gullIn-=.1;if(this.gullIn<=0){this.gullIn=12+Math.random()*12;if((s.harbor+s.bay+s.cape)>.3&&night<.65)this.gull(Math.max(s.harbor,s.bay,s.cape)*.018);}
 }
 private footstep(material:number){
  if(!this.context||!this.noise||this.context.state!=='running')return;
  const c=this.context,t=c.currentTime,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();source.buffer=this.noise;
  const sand=material===Material.Sand,wood=material===Material.Wood;filter.type='bandpass';filter.frequency.value=sand?1100:wood?260:620;filter.Q.value=wood?1.2:.65;
  gain.gain.setValueAtTime(sand?.085:wood?.12:.09,t);gain.gain.exponentialRampToValueAtTime(.0001,t+(sand?.13:.075));
  source.connect(filter).connect(gain).connect(this.master!);source.start(t,Math.random()*2);source.stop(t+.15);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
 }
 private gull(level:number){
  const c=this.context!,t=c.currentTime,osc=c.createOscillator(),gain=c.createGain();osc.type='sine';osc.frequency.setValueAtTime(970,t);osc.frequency.exponentialRampToValueAtTime(1450,t+.15);osc.frequency.exponentialRampToValueAtTime(750,t+.72);
  gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,level),t+.1);gain.gain.exponentialRampToValueAtTime(.0001,t+.85);osc.connect(gain).connect(this.master!);osc.start();osc.stop(t+.9);osc.onended=()=>{osc.disconnect();gain.disconnect();};
 }
 get diagnostics(){return{enabled:!this.muted,running:this.context?.state==='running',...this.state};}
}
