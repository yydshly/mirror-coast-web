import {Vector3} from 'three';

export type BoatPart={center:Vector3;half:Vector3;deck?:boolean;rider?:boolean};
const part=(x:number,y:number,z:number,hx:number,hy:number,hz:number,deck=false):BoatPart=>({center:new Vector3(x,y,z),half:new Vector3(hx,hy,hz),deck});
const width=(z:number)=>z< -2.45?.55*(z+3.1)/.65:z< -1.35?.55+(z+2.45)*.6/1.1:1.15-(z+1.35)*.11/3.75;
// Short bands follow the visible bow taper; a wide bounding rectangle must not
// fill the navigable gaps beside the bow or between a pair of bridge piles.
export const BOAT_HULL:BoatPart[]=Array.from({length:12},(_,i)=>{
 const a=-3.1+i*5.5/12,b=a+5.5/12;
 return part(0,.085,(a+b)/2,Math.max(width(a),width(b))+.025,.515,(b-a)/2+.006,true);
});
export const BOAT_PARTS:BoatPart[]=[...BOAT_HULL,
 part(0,.50,2.49,.36,.43,.29), // outboard, including its steering sweep
 part(0,1.48,-1.34,.97,.33,.05), // full-width windshield and frame
 part(.45,1.05,-.91,.35,.42,.23),
 part(0,1.10,1.85,.89,.24,.06),
 part(-.99,.86,.4,.04,.24,1.75),part(.99,.86,.4,.04,.24,1.75),
 {...part(.43,1.50,-.04,.30,.55,.39),rider:true},
];
