const clamp=(n:number,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
export const RUN_CYCLE_METRES=2.6;
export const RUN_STANCE=.26;

/** A short grounded stance, heel recovery and forward placement. Positions are
 * relative to the physical actor; they never translate its collision body. */
export function runningLeg(phase:number,hipHeight:number){
 const u=((phase%1)+1)%1,reach=RUN_CYCLE_METRES*RUN_STANCE*.5;
 let forward:number,lift:number,pitch:number;
 if(u<RUN_STANCE){
  const t=u/RUN_STANCE;
  forward=reach-RUN_CYCLE_METRES*u;lift=0;
  pitch=.12*(1-smooth(t/.3))-.45*smooth((t-.55)/.45);
 }else{
  const t=(u-RUN_STANCE)/(1-RUN_STANCE);
  forward=-reach+2*reach*smooth(t)-.16*Math.sin(Math.PI*t);
  lift=Math.max(0,.28*Math.pow(Math.sin(Math.PI*t),1.1)+.10*Math.sin(2*Math.PI*t));
  pitch=-.45+.57*smooth(t);
 }
 const sole=Math.min(-.15*Math.cos(pitch)+.195*Math.sin(pitch),-.15*Math.cos(pitch)-.105*Math.sin(pitch));
 const ankle=-sole+lift,down=hipHeight-ankle,distance=Math.min(.7299,Math.hypot(forward,down));
 const knee=-Math.acos(clamp((distance*distance-.37*.37-.36*.36)/(2*.37*.36),-1,1));
 const hip=Math.atan2(forward,down)-Math.atan2(.36*Math.sin(knee),.37+.36*Math.cos(knee));
 return{hip,knee,pitch,stance:u<RUN_STANCE};
}

export function bootSoleHeight(hip:number,knee:number,pitch:number){
 return .88-.37*Math.cos(hip)-.36*Math.cos(hip+knee)+Math.min(-.15*Math.cos(pitch)+.195*Math.sin(pitch),-.15*Math.cos(pitch)-.105*Math.sin(pitch));
}
