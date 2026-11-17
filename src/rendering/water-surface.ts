import {SEA_LEVEL} from '../world/sea-level';
const smooth=(a:number,b:number,t:number)=>{const v=Math.max(0,Math.min(1,(t-a)/(b-a)));return v*v*(3-2*v);};
/** Same low-amplitude swell as the sea vertex shader, in world metres. */
export function waterSurfaceHeight(x:number,z:number,time:number,bed=0,rain=0):number{
 const shelter=.25+.75*smooth(.6,4,SEA_LEVEL-bed),edge=1-smooth(750,1100,Math.max(Math.abs(x-128),Math.abs(z-128)));
 return SEA_LEVEL+(Math.sin(x*.1692+z*.0612-time*.58)*.10+Math.sin(x*-.0456+z*.0836+time*.43)*.065)*shelter*edge*(1+rain*.35);
}
