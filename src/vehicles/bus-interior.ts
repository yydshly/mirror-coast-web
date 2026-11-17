import {BoxGeometry,BufferGeometry,Color,CylinderGeometry,ExtrudeGeometry,Float32BufferAttribute,Matrix4,PlaneGeometry,Quaternion,Shape,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {humanBox} from '../rendering/human-geometry';

type Name='bus-body'|'bus-cabin'|'bus-seats'|'bus-hardware'|'bus-glass'|'bus-lamps';
export type BusPart={name:Name;geometry:BufferGeometry;roughness:number;metalness:number;transparent?:boolean;opacity?:number;emissive?:string;castShadow:boolean};
/** Fixed 2 x 6.4 m coastal midi-bus: 2+1 seats, two right-side door bays.
 * Bake the static cabin once instead of uploading every seat on every frame. */
export function createBusInterior():BusPart[]{
 const buckets=new Map<Name,BufferGeometry[]>();
 const unit=new BoxGeometry(1,1,1),padding=humanBox(.12),rod=new CylinderGeometry(1,1,1,8),pane=new PlaneGeometry(1,1);
 const white=new Color(),matrix=new Matrix4(),rotation=new Quaternion();
 const add=(name:Name,geometry:BufferGeometry,color:string,position:Vector3,scale=new Vector3(1,1,1),q=new Quaternion())=>{
  const g=geometry.index?geometry.toNonIndexed():geometry.clone();g.applyMatrix4(matrix.compose(position,q,scale));
  white.set(color);const colors=new Float32Array(g.getAttribute('position').count*3);for(let i=0;i<colors.length;i+=3){colors[i]=white.r;colors[i+1]=white.g;colors[i+2]=white.b;}g.setAttribute('color',new Float32BufferAttribute(colors,3));
  const list=buckets.get(name);if(list)list.push(g);else buckets.set(name,[g]);
 };
 const box=(name:Name,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,soft=false,pitch=0)=>add(name,soft?padding:unit,color,new Vector3(x,y,z),new Vector3(sx,sy,sz),rotation.setFromAxisAngle(new Vector3(1,0,0),pitch));
 const bar=(color:string,a:Vector3,b:Vector3,r=.022)=>{const d=b.clone().sub(a);add('bus-hardware',rod,color,a.clone().add(b).multiplyScalar(.5),new Vector3(r,d.length(),r),new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d.normalize()));};
 const glass=(x:number,y:number,z:number,width:number,height:number,yaw:number)=>add('bus-glass',pane,'#a4babe',new Vector3(x,y,z),new Vector3(width,height,1),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw));
 const cream='#d7d3ba',sage='#527c78',dark='#24383b',fabric='#52717a',insert='#779292',rail='#cab775';

 // Thin skins surround an open volume; wheel arches do not fill the cabin.
 for(const side of [-1,1]){
  const outline=new Shape();outline.moveTo(-3.16,.31);outline.lineTo(-3.16,1.36);
  if(side>0){for(const [a,b]of [[-2.96,-1.75],[.30,1.34]]){outline.lineTo(a,1.36);outline.lineTo(a,.78);outline.lineTo(b,.78);outline.lineTo(b,1.36);}}
  outline.lineTo(3.16,1.36);outline.lineTo(3.16,.31);
  for(const axle of [2.048,-2.048]){outline.lineTo(axle+.42,.31);outline.absarc(axle,.31,.42,0,Math.PI,false);}
  outline.lineTo(-3.16,.31);outline.closePath();
  const skin=new ExtrudeGeometry(outline,{depth:.055,bevelEnabled:false});skin.translate(0,0,-.0275);skin.rotateY(-Math.PI/2);add('bus-body',skin,'#a96552',new Vector3(side*.965,0,0));skin.dispose();
  box('bus-body',sage,side*.968,1.29,0,.065,.15,6.30);
  box('bus-hardware',dark,side*.994,1.405,0,.021,.052,6.27);
  box('bus-hardware',dark,side*.994,2.285,0,.021,.055,6.27);
  // Window columns have inset rubber seals, separate from the outer paint.
  for(const z of [-3.12,-2.08,-1.04,0,1.04,2.08,3.12])box('bus-body',sage,side*.972,1.85,z,.070,.90,.07);
  for(const z of [-2.60,-1.56,-.52,.52,1.56,2.60])glass(side*.989,1.845,z,.94,.82,side*Math.PI/2);
  box('bus-cabin','#b4b8a7',side*.913,1.10,0,.045,.49,6.15);
  box('bus-cabin','#818b82',side*.89,1.36,0,.09,.065,6.14);
  box('bus-body',cream,side*.96,2.36,0,.08,.12,6.30);
 }
 box('bus-cabin','#404c4d',0,.72,0,1.85,.10,6.15);
 box('bus-cabin','#69716a',.14,.777,.38,.50,.014,4.32);
 box('bus-body',cream,0,2.48,0,1.99,.18,6.35,true);
 box('bus-cabin','#c7c4ad',0,2.375,0,1.83,.025,6.15);
 for(const side of [-1,1])box('bus-lamps','#f6dfb1',side*.61,2.354,.14,.045,.018,5.52);
 box('bus-body',sage,0,1.03,-3.16,1.94,.65,.07);box('bus-body',sage,0,1.11,3.16,1.94,.50,.07);
 box('bus-hardware',dark,0,1.38,-3.18,1.92,.055,.025);box('bus-hardware',dark,0,2.29,-3.18,1.92,.06,.025);
 glass(0,1.84,-3.188,1.78,.83,Math.PI);glass(0,1.85,3.188,1.78,.83,0);
 for(const z of [-3.17,3.17])for(const x of [-.93,0,.93])box('bus-body',sage,x,1.84,z,.055,.87,.045);
 box('bus-body',cream,0,2.38,-3.15,1.93,.14,.085);
 for(const side of [-1,1])box('bus-cabin','#465656',side*.73,.91,2.05,.39,.27,.86,true);

 // Right-side doors: visible step wells and a continuous clear aisle.
 for(const [front,rear]of [[-2.96,-1.75],[.30,1.34]]){
  const z=(front+rear)/2,width=rear-front;
  box('bus-cabin','#2b3e41',.69,.70,z,.47,.05,width-.08);
  box('bus-cabin','#8d8b71',.80,.49,z,.26,.06,width-.08);
  box('bus-hardware','#d8ba61',.933,.54,z,.025,.04,width-.08);
  for(const edge of [front,rear])box('bus-hardware',dark,.995,1.56,edge,.025,1.56,.035);
  box('bus-hardware',dark,.996,1.56,z,.024,1.56,.035);
  box('bus-hardware',dark,.997,.92,z,.024,.27,width-.05);
  bar(rail,new Vector3(.70,.79,rear+.08),new Vector3(.70,2.31,rear+.08));
 }

 const chair=(x:number,z:number,width=.36,backBench=false)=>{
  box('bus-seats',dark,x,1.15,z,width+.015,.13,.47,true);
  box('bus-seats',fabric,x,1.19,z-.015,width,.10,.43,true);
  box('bus-seats',fabric,x,1.53,z+.23,width,.62,.10,true,.10);
  box('bus-seats',insert,x,1.53,z+.162,width-.075,.43,.022,true,.10);
  box('bus-seats',dark,x,1.89,z+.265,width-.055,.075,.055,true);
  if(!backBench)bar('#586869',new Vector3(x,.78,z+.05),new Vector3(x,1.10,z+.05),.03);
 };
 for(const z of [-1.05,-.20,.65,1.50])for(const x of [-.67,-.28])chair(x,z);
 for(const z of [-.90,1.50])chair(.61,z,.41);
 for(const x of [-.60,0,.60])chair(x,2.48,.51,true);
 box('bus-cabin','#6c7771',0,.98,2.52,1.80,.36,.62);

 // Driver station and guard partition leave the entrance on the right open.
 chair(-.44,-2.30,.46);box('bus-cabin',dark,-.38,1.50,-2.88,1.12,.29,.40,true);
 box('bus-cabin','#142a2f',-.44,1.64,-2.656,.45,.12,.018);
 for(const x of [-.57,-.44,-.31])box('bus-lamps','#b0c8b7',x,1.65,-2.643,.07,.065,.008);
 box('bus-cabin','#b1b5a5',-.50,1.24,-1.87,.88,.91,.065);
 bar(rail,new Vector3(.02,.79,-1.81),new Vector3(.02,2.31,-1.81));
 for(const x of [-.10,.38])bar(rail,new Vector3(x,2.30,-1.62),new Vector3(x,2.30,2.44));
 for(const z of [-1.46,.24,1.94])bar(rail,new Vector3(-.10,1.22,z),new Vector3(-.10,2.30,z));
 for(const x of [-.535,-.345])box('bus-cabin','#263a3d',x,.785,-2.66,.13,.025,.18,true);

 // A few seated passengers give depth through the windows, without adding
 // skinned meshes or simulating another crowd inside every bus.
 const passenger=(x:number,z:number,coat:string,skin:string)=>{
  box('bus-cabin',coat,x,1.52,z-.01,.32,.42,.24,true);
  box('bus-cabin',skin,x,1.82,z-.04,.22,.24,.22,true);
  box('bus-cabin','#4a4136',x,1.953,z-.04,.235,.055,.23,true);
  for(const s of [-1,1]){
   box('bus-cabin',coat,x+s*.185,1.49,z-.05,.10,.33,.12,true);
   box('bus-cabin',skin,x+s*.13,1.30,z-.19,.08,.08,.10,true);
   box('bus-cabin','#3b4b51',x+s*.09,1.25,z-.12,.13,.13,.39,true);
   box('bus-cabin','#3b4b51',x+s*.09,1.01,z-.28,.12,.36,.12,true);
   box('bus-cabin','#263a3d',x+s*.09,.83,z-.35,.15,.10,.24,true);
  }
 };
 passenger(-.67,-1.05,'#a78d5a','#c59e7b');passenger(.61,-.90,'#677c70','#936b52');passenger(-.28,1.50,'#657784','#c3a07d');passenger(.60,2.48,'#a37262','#a78166');
 const definitions:Array<Omit<BusPart,'geometry'>>=[
  {name:'bus-body',roughness:.49,metalness:.12,castShadow:true},
  {name:'bus-cabin',roughness:.86,metalness:0,castShadow:false},
  {name:'bus-seats',roughness:.94,metalness:0,castShadow:false},
  {name:'bus-hardware',roughness:.53,metalness:.35,castShadow:false},
  {name:'bus-glass',roughness:.13,metalness:.03,transparent:true,opacity:.24,castShadow:false},
  {name:'bus-lamps',roughness:.6,metalness:0,emissive:'#dfc48f',castShadow:false},
 ];
 const result=definitions.map(d=>{const list=buckets.get(d.name)!,geometry=mergeGeometries(list,false)!;list.forEach(g=>g.dispose());return{...d,geometry};});
 [unit,padding,rod,pane].forEach(g=>g.dispose());return result;
}
