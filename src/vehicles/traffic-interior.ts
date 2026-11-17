import {BoxGeometry,BufferGeometry,Color,CylinderGeometry,ExtrudeGeometry,Float32BufferAttribute,Matrix4,Quaternion,Shape,TorusGeometry,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {humanBox} from '../rendering/human-geometry';

export type TrafficKind='sedan'|'van'|'bus';
/** Metres above the tyre contact plane. Seats and people use the same frame. */
export const TRAFFIC_CABIN_RIG={
 sedan:{x:-.385,z:-.26,hipY:.64,headY:1.19,wheelY:.935,wheelZ:-.59,wheelPitch:-.36,wheelRadius:.15,footY:.28,footZ:-.76},
 van:{x:-.385,z:-1.14,hipY:1.12,headY:1.70,wheelY:1.43,wheelZ:-1.52,wheelPitch:-.30,wheelRadius:.17,footY:.64,footZ:-1.64},
 bus:{x:-.44,z:-2.30,hipY:1.30,headY:1.93,wheelY:1.65,wheelZ:-2.59,wheelPitch:-.30,wheelRadius:.17,footY:.80,footZ:-2.66},
} as const;
export type TrafficInteriorPart={name:string;geometry:BufferGeometry;roughness:number};

/** Static interior baked into two shared material batches per body type. */
export function createTrafficInterior(kind:'sedan'|'van'):TrafficInteriorPart[]{
 const rig=TRAFFIC_CABIN_RIG[kind],van=kind==='van',buckets:{trim:BufferGeometry[];seats:BufferGeometry[]}={trim:[],seats:[]};
 const cube=new BoxGeometry(1,1,1),pad=humanBox(.10),disc=new CylinderGeometry(1,1,.01,20).rotateX(Math.PI/2),rod=new CylinderGeometry(1,1,1,8),q=new Quaternion(),matrix=new Matrix4(),tint=new Color();
 const add=(bucket:keyof typeof buckets,g:BufferGeometry,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,pitch=0)=>{
  const part=g.index?g.toNonIndexed():g.clone();part.applyMatrix4(matrix.compose(new Vector3(x,y,z),q.setFromAxisAngle(new Vector3(1,0,0),pitch),new Vector3(sx,sy,sz)));
  tint.set(color);const colors=new Float32Array(part.getAttribute('position').count*3);for(let i=0;i<colors.length;i+=3){colors[i]=tint.r;colors[i+1]=tint.g;colors[i+2]=tint.b;}part.setAttribute('color',new Float32BufferAttribute(colors,3));buckets[bucket].push(part);
 };
 const box=(bucket:keyof typeof buckets,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,soft=false,pitch=0)=>add(bucket,soft?pad:cube,color,x,y,z,sx,sy,sz,pitch);
 const dark='#293c40',cloth=van?'#6b8175':'#617c82',insert=van?'#9ca994':'#92a8a3',warm='#c7b68e';
 const floorY=van?.57:.25;
 box('trim','#404e4e',0,floorY,van?-1.18:.12,1.58,.05,van?1.12:1.92);
 for(const x of [-.385,.385]){
  box('seats',dark,x,rig.hipY-.13,rig.z-.035,.48,.11,.43,true);
  box('seats',cloth,x,rig.hipY-.078,rig.z-.045,.38,.028,.35,true);
  box('seats',cloth,x,rig.hipY+.22,rig.z+.16,.46,.49,.105,true,.09);
  box('seats',insert,x,rig.hipY+.22,rig.z+.099,.34,.34,.026,true,.09);
  box('seats',cloth,x,rig.hipY+.53,rig.z+.20,.29,.14,.105,true);
  for(const side of [-1,1]){
   box('seats',cloth,x+side*.212,rig.hipY-.07,rig.z-.035,.045,.10,.36,true);
   box('seats',warm,x+side*.193,rig.hipY-.015,rig.z-.035,.009,.009,.30);
   box('trim',dark,x+side*.15,(floorY+rig.hipY-.20)/2,rig.z+.05,.035,rig.hipY-.20-floorY,.22);
  }
 }
 if(!van){
  box('seats',cloth,0,.52,.67,1.36,.11,.37,true);box('seats',cloth,0,.85,.94,1.36,.52,.10,true,.08);
  for(const x of [-.43,0,.43])box('seats',insert,x,1.15,.975,.24,.13,.09,true);
 }else{
  box('trim','#a9afa0',0,1.31,-.76,1.57,1.45,.05);
  box('trim',dark,0,1.68,-.792,.60,.31,.015);
  for(const x of [-.19,0,.19])box('trim','#879b96',x,1.68,-.803,.008,.27,.009);
 }
 const dashY=van?1.285:.815,dashZ=van?-1.69:-.705,faceZ=dashZ+(van?.125:.075),dashDepth=van?.24:.14;
 box('trim',dark,0,dashY,dashZ,1.52,van?.19:.13,dashDepth,true);
 box('trim','#4a5c5b',0,dashY+(van?.105:.075),dashZ,1.51,.035,dashDepth,true);
 for(const x of [rig.x-.065,rig.x+.065]){
  add('trim',disc,'#162c31',x,dashY+.015,faceZ,.052,.052,1);
  for(let i=0;i<7;i++){const a=3.9-i*.75;box('trim','#c5c8ae',x+Math.cos(a)*.04,dashY+.015+Math.sin(a)*.04,faceZ+.008,.005,.008,.003);}
  box('trim','#c49c71',x+.012,dashY+.025,faceZ+.009,.032,.004,.003);
 }
 for(const x of [-.67,.62]){box('trim','#152d32',x,dashY,faceZ,.13,.07,.012,true);for(let k=0;k<3;k++)box('trim','#92a39c',x,dashY-.021+k*.021,faceZ+.009,.11,.005,.005);}
 box('trim','#182e32',.18,dashY-.005,faceZ,.25,.10,.014,true);box('trim','#7d9b8e',.18,dashY+.012,faceZ+.01,.19,.038,.006);
 for(const x of [.10,.18,.26])box('trim','#bcbba4',x,dashY-.029,faceZ+.014,.025,.013,.009);
 for(const side of [-1,1]){
  box('trim','#687a72',side*.776,rig.hipY+.04,rig.z+.02,.032,van?.52:.31,van?.84:.72,true);
  box('trim',dark,side*.726,rig.hipY+.13,rig.z+.035,.105,.055,.27,true);
  box('trim','#b3bab0',side*.747,rig.hipY+.23,rig.z-.15,.028,.023,.13);
  // Empty seats keep their belts along the door pillar, not across thin air.
  box('trim','#6f6957',side*.723,rig.hipY+.26,rig.z+.20,.023,.46,.014);
  box('trim',dark,side*.856,van?.99:.64,rig.z+.43,.006,van?.27:.32,.009);
  box('trim','#abb9ac',side*.861,van?1.02:.71,rig.z+.12,.008,.026,.13);
 }
 box('trim',dark,0,rig.hipY-.20,rig.z-.04,.18,.18,.57,true);
 add('trim',rod,'#8b9b94',.045,rig.hipY+.015,rig.z-.15,.013,.17,.013,-.18);
 box('trim',dark,.045,rig.hipY+.105,rig.z-.165,.055,.045,.065,true);
 box('trim','#445758',0,van?1.99:1.30,van?-1.67:-.46,.21,.07,.045,true);
 box('trim',dark,0,van?2.035:1.345,van?-1.67:-.46,.014,.04,.014);
 for(const s of [-1,1])box('trim',dark,rig.x+s*.095,rig.footY-.015,rig.footZ,.12,.025,.17,true);
 // Column ends behind the instrument face, leaving the wheel rim clear.
 add('trim',rod,dark,rig.x,rig.wheelY-.07,rig.wheelZ-.09,.018,.22,.018,.80);
 const parts=(['trim','seats'] as const).map(bucket=>{const geometry=mergeGeometries(buckets[bucket],false)!;geometry.name=`traffic-${kind}-${bucket}`;buckets[bucket].forEach(g=>g.dispose());return{name:geometry.name,geometry,roughness:bucket==='seats'?.94:.78};});
 [cube,pad,disc,rod].forEach(g=>g.dispose());return parts;
}

export function createTrafficSteeringWheel():BufferGeometry{
 const parts:BufferGeometry[]=[new TorusGeometry(.17,.014,6,20).toNonIndexed()];
 for(const angle of [-Math.PI/2,Math.PI/6,Math.PI*5/6]){const g=new BoxGeometry(.16,.014,.015).toNonIndexed();g.translate(.08,0,0).rotateZ(angle);parts.push(g);}
 parts.push(new CylinderGeometry(.041,.041,.03,12).rotateX(Math.PI/2).toNonIndexed());
 const geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());geometry.name='traffic-steering-wheel';return geometry;
}

/** Hollow lower body: the floor, hood and thin skins never fill the seats. */
export function createTrafficBody(kind:'sedan'|'van'):BufferGeometry{
 const van=kind==='van',length=van?4.8:4.05,parts:BufferGeometry[]=[];
 for(const side of [-1,1]){
  const shape=new Shape();shape.moveTo(-length/2,.30);shape.lineTo(-length/2,.81);shape.lineTo(length/2,.81);shape.lineTo(length/2,.30);
  for(const z of [length*.32,-length*.32]){shape.lineTo(z+.355,.30);shape.absarc(z,.30,.355,0,Math.PI,false);}shape.lineTo(-length/2,.30);shape.closePath();
  const g=new ExtrudeGeometry(shape,{depth:.05,bevelEnabled:false});g.translate(0,0,-.025).rotateY(-Math.PI/2).translate(side*.828,0,0);parts.push(g);
 }
 const box=(x:number,y:number,z:number,sx:number,sy:number,sz:number)=>parts.push(new BoxGeometry(sx,sy,sz).toNonIndexed().translate(x,y,z));
 if(!van){box(0,.625,-1.48,1.65,.32,1.09);box(0,.61,1.56,1.65,.29,.92);}else{
  box(0,.58,-2.12,1.65,.34,.54);box(0,.94,-1.80,1.66,.42,.055);
  for(const side of [-1,1])box(side*.828,.975,-1.31,.05,.33,1.10);
 }
 box(0,.29,0,1.59,.07,length*.96);
 const geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());geometry.name=`traffic-${kind}-body`;return geometry;
}
