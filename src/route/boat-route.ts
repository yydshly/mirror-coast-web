export const BOAT_LANDINGS=[
 {id:'boat-pier',name:'码头小艇栈桥',shortName:'码头靠泊',x:116,z:214.5,landY:15,flat:0,run:9.5,endZ:226,boat:{x:119.7,z:224.8}},
 {id:'boat-bay',name:'南湾沙滩栈桥',shortName:'南湾靠泊',x:700,z:179.5,landY:12,flat:0,run:3.5,endZ:189.5,boat:{x:703.7,z:188}},
 {id:'boat-cape',name:'西岬海风栈桥',shortName:'西岬靠泊',x:-205,z:158,landY:15,flat:6,run:8,endZ:176,boat:{x:-201.3,z:174.5}},
] as const;
export const BOAT_SPAWN={x:119.7,y:12.08,z:224.8};
/** A coastal reference lane. Manual navigation still checks the real shore. */
export const COAST_SEA_LANE=[{x:-201.3,z:174.5},{x:-208,z:216},{x:-150,z:254},{x:110,z:255},{x:275,z:262},{x:480,z:254},{x:650,z:236},{x:703.7,z:188}] as const;
export function seaReferenceRoute(start:{x:number;z:number},end:{x:number;z:number}){
 if(Math.hypot(end.x-start.x,end.z-start.z)<40)return[start,end];
 const nearest=(p:typeof start)=>COAST_SEA_LANE.reduce((best,v,i)=>Math.hypot(v.x-p.x,v.z-p.z)<Math.hypot(COAST_SEA_LANE[best].x-p.x,COAST_SEA_LANE[best].z-p.z)?i:best,0);
 const a=nearest(start),b=nearest(end),points=a<=b?COAST_SEA_LANE.slice(a,b+1):COAST_SEA_LANE.slice(b,a+1).reverse();return[start,...points,end];
}
