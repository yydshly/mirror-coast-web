import {BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,PlaneGeometry,DoubleSide,Vector3,Line,LineBasicMaterial,InstancedMesh,Matrix4,ConeGeometry,CylinderGeometry,PointLight,CircleGeometry,ShaderMaterial,Scene} from 'three';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
import {Material} from '../world/palette';
import {regionalHeightAt} from '../world/region-terrain';
import {sampleRegionalRoad} from '../world/region-layout';
import {findFurnitureFooting,furnitureFootContacts} from '../world/furniture-footing';
import type {SceneObstacle} from '../input/scene-collisions';
import type {SeatTarget} from '../input/ground-actions';
import {validateBay,type BayState,type BayNote} from '../gameplay/south-bay';
import {surfaceFinish} from './surface-finish';

type Supported={root:Group;anchors:Vector3Like[];bounds:SceneObstacle[]};
type Target={id:'kite'|'pool';position:Vector3;support:Supported};
export class SouthBay{
 readonly obstacles:SceneObstacle[]=[];readonly seats:SeatTarget[]=[];
 private root=new Group();private supports:Supported[]=[];private targets:Target[]=[];
 private state:BayState;private clock=0;private flight=0;private inspect=0;private lookTime=0;
 private lastFocus=new Vector3(Infinity,0,Infinity);private stillTime=0;
 private readonly cube=new BoxGeometry(1,1,1);private readonly wind={value:0};private readonly poolNight={value:0};
 private kite=new Group();private kiteHome=new Vector3();private reelOrigin=new Vector3();private kiteSupported:Supported|undefined;
 private tether=new Line(new BufferGeometry().setAttribute('position',new Float32BufferAttribute(new Float32Array(33*3),3)),new LineBasicMaterial({color:'#bcb694',transparent:true,opacity:.75}));
 private campLight:PointLight|undefined;private poolSupport:Supported|undefined;private crabs:{root:Group;angle:number;home:Vector3;retreat:number}[]=[];
 private plants:{anchor:Vector3Like;matrix:Matrix4}[]=[];private plantMesh:InstancedMesh|undefined;
 private readonly wood=surfaceFinish(new MeshStandardMaterial({color:'#8b7553',roughness:.95}),'wood');
 private readonly stone=surfaceFinish(new MeshStandardMaterial({color:'#646c64',roughness:.98}),'stone');
 private readonly rope=new MeshStandardMaterial({color:'#b2a17c',roughness:1});
 private readonly rust=new MeshStandardMaterial({color:'#b8623b',roughness:.85});
 constructor(scene:Scene,private world:VoxelWorld,saved:BayState={notes:[],kiteFlying:false}){
  this.state=validateBay(saved);this.root.name='south-bay-living-shore';scene.add(this.root);this.flight=this.state.kiteFlying?1:0;
  this.camp();this.pool();this.overlook();this.dunes();this.root.add(this.kite,this.tether);
  // Keep the light slot stable when the distant bay models are culled. A
  // changing light count recompiles PBR programs while walking through town.
  if(this.campLight)scene.attach(this.campLight);
  this.sync();this.update(0,{x:650,y:16,z:139},0);
 }
 get snapshot():BayState{return{notes:[...this.state.notes],kiteFlying:this.state.kiteFlying};}
 get diagnostics(){return{plants:this.plants.length,crabs:this.crabs.length,visibleCrabs:this.crabs.filter(c=>c.root.visible).length,seats:this.seats.length,kiteHeight:this.kite.position.y,flying:this.state.kiteFlying,notes:this.state.notes};}
 private ground(x:number,z:number){for(let y=32;y>=12;y--){const m=this.world.getVoxel(Math.floor(x),y,Math.floor(z));if([Material.Sand,Material.Grass,Material.Rock].includes(m as never)&&!this.world.getVoxel(Math.floor(x),y+1,Math.floor(z))&&!this.world.getVoxel(Math.floor(x),y+2,Math.floor(z)))return y+1;}return null;}
 private box(g:Group,m:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number){const mesh=new Mesh(this.cube,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;g.add(mesh);return mesh;}
 private supported(x:number,z:number):Supported|null{const y=this.ground(x,z);if(y===null)return null;const root=new Group();root.position.set(x,y,z);this.root.add(root);const s={root,anchors:[{x:Math.floor(x),y:y-1,z:Math.floor(z)}],bounds:[] as SceneObstacle[]};this.supports.push(s);return s;}
 private bound(s:Supported,x:number,y:number,z:number,sx:number,sy:number,sz:number,standable=true){const p=s.root.position;s.bounds.push({minX:p.x+x-sx/2,maxX:p.x+x+sx/2,minY:p.y+y-sy/2,maxY:p.y+y+sy/2,minZ:p.z+z-sz/2,maxZ:p.z+z+sz/2,standable});}
 private note(id:BayNote){if(this.state.notes.includes(id))return false;this.state.notes.push(id);return true;}
 interaction(p:Vector3Like){return this.targets.filter(t=>t.support.root.visible&&Math.hypot(t.position.x-p.x,t.position.z-p.z)<2.8&&Math.abs(t.position.y-p.y)<1.6).sort((a,b)=>a.position.distanceTo(p)-b.position.distanceTo(p))[0];}
 label(id:string){return id==='kite'?(this.state.kiteFlying?'收回风筝 · 帆布营地':'放飞风筝 · 迎着海风'): '静看潮池 · 看沙蟹退回石缝';}
 interact(id:string){
  if(id==='kite'){this.state.kiteFlying=!this.state.kiteFlying;this.note('kite');return this.state.kiteFlying?'线轴松开，风筝正在顺着海风升起。抬头看看；再按 E 可以收回来。':'风筝正在收回营地，旅途足迹仍保留。';}
  this.inspect=9;this.note('pool');return '停下脚步，沙蟹先退回石缝，片刻会重新探出。潮池里映着天空，傍晚会有淡淡微光。';
 }
 sync(){this.obstacles.length=0;for(const s of this.supports){s.root.visible=s.anchors.every(p=>!!this.world.getVoxel(p.x,p.y,p.z));if(s.root.visible)this.obstacles.push(...s.bounds);}if(this.plantMesh){const zero=new Matrix4().makeScale(0,0,0);this.plants.forEach((p,i)=>this.plantMesh!.setMatrixAt(i,this.world.getVoxel(p.anchor.x,p.anchor.y,p.anchor.z)?p.matrix:zero));this.plantMesh.instanceMatrix.needsUpdate=true;}}
 update(dt:number,focus:Vector3Like,night:number,seatedId?:string){
  this.root.visible=Math.hypot(focus.x-660,focus.z-160)<520;
  this.stillTime=Math.hypot(focus.x-this.lastFocus.x,focus.z-this.lastFocus.z)<.005?this.stillTime+dt:0;this.lastFocus.copy(focus);
  this.clock+=Math.min(.1,Math.max(0,dt));this.wind.value=this.clock;this.inspect=Math.max(0,this.inspect-dt);this.poolNight.value=night;
  const active=!!this.kiteSupported?.root.visible;this.flight+=(Number(active&&this.state.kiteFlying)-this.flight)*(1-Math.exp(-dt*1.2));
  this.kite.visible=active;this.tether.visible=active&&this.flight>.015;
  const f=this.flight;this.kite.position.copy(this.kiteHome).add(new Vector3(-7*f+Math.sin(this.clock*.65)*1.5*f,16*f+Math.sin(this.clock*.9)*.6*f,12*f+Math.cos(this.clock*.47)*1.4*f));this.kite.rotation.set(-Math.PI/2*(1-f)-.29*f,Math.sin(this.clock*.38)*.25,.15+Math.sin(this.clock*.8)*.2*f);
  const attr=this.tether.geometry.getAttribute('position');for(let i=0;i<33;i++){const u=i/32;attr.setXYZ(i,this.reelOrigin.x+(this.kite.position.x-this.reelOrigin.x)*u,this.reelOrigin.y+(this.kite.position.y-this.reelOrigin.y)*u-Math.sin(u*Math.PI)*2*f,this.reelOrigin.z+(this.kite.position.z-this.reelOrigin.z)*u);}attr.needsUpdate=true;this.tether.geometry.computeBoundingSphere();
  if(this.campLight)this.campLight.intensity=this.kiteSupported?.root.visible?night*5:0;
  for(const c of this.crabs){const distance=Math.hypot(focus.x-c.home.x,focus.z-c.home.z),target=distance<1.2||distance<2.5&&this.stillTime<(this.inspect>0?1.2:2.5)?1:0;c.retreat+=(target-c.retreat)*(1-Math.exp(-dt*2));c.root.position.copy(c.home).add(new Vector3(Math.cos(c.angle)*c.retreat*.65,0,Math.sin(c.angle)*c.retreat*.65));c.root.rotation.y=c.angle+Math.sin(this.clock*5+c.angle)*.03*(1-c.retreat);c.root.visible=!!this.poolSupport?.root.visible&&c.retreat<.94;}
  this.lookTime=seatedId==='south-bay-overlook'?this.lookTime+dt:0;if(this.lookTime>2)this.note('vista');
 }
 private camp(){
  const s=this.supported(628,157);if(!s)return;this.kiteSupported=s;const g=s.root,p=g.position;const feet=[[-3,-2],[-3,2],[3,-2],[3,2]];let roof=p.y+3.2;
  for(const [x,z]of feet){const floor=this.ground(p.x+x,p.z+z);if(floor===null){g.visible=false;return;}roof=Math.max(roof,floor+2.8);s.anchors.push({x:Math.floor(p.x+x),y:floor-1,z:Math.floor(p.z+z)});}
  for(const [x,z]of feet){const floor=this.ground(p.x+x,p.z+z)!;this.box(g,this.wood,x,(roof+floor)/2-p.y,z,.1,roof-floor,.1);this.bound(s,x,(roof+floor)/2-p.y,z,.12,roof-floor,.12,false);}
  const geo=new PlaneGeometry(6.5,4.6,8,6);geo.rotateX(-Math.PI/2);const pos=geo.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setY(i,.28*Math.cos(pos.getX(i)*.48)-.12*Math.abs(pos.getZ(i)));geo.computeVertexNormals();
  const fabric=surfaceFinish(new MeshStandardMaterial({color:'#d6c39b',roughness:1,side:DoubleSide}),'fabric');fabric.onBeforeCompile=shader=>{shader.uniforms.uBayTime=this.wind;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uBayTime;').replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y+=sin(position.x*1.3+uBayTime*1.7)*sin(position.z*1.2+uBayTime)*.045;');};
  const sail=new Mesh(geo,fabric);sail.position.y=roof-p.y;sail.castShadow=sail.receiveShadow=true;g.add(sail);this.bound(s,0,roof-p.y,0,6.5,.5,4.6,false);
  const footing=findFurnitureFooting(this.world,629,161.5,0,furnitureFootContacts([{x:0,z:0}],.26,.24),regionalHeightAt(629,161)+1,3);
  if(!footing)return;
  const reel=this.supported(footing.x,footing.z)!;reel.anchors=footing.anchors;reel.root.position.y=footing.y;this.kiteSupported=reel;
  this.box(reel.root,this.rust,0,.24,0,.55,.48,.48);this.bound(reel,0,.24,0,.55,.48,.48);
  for(const x of [-.16,.16]){const disk=new Mesh(new CylinderGeometry(.25,.25,.05,16),this.wood);disk.rotation.z=Math.PI/2;disk.position.set(x,.69,0);reel.root.add(disk);}const cord=new Mesh(new CylinderGeometry(.15,.15,.28,16),this.rope);cord.rotation.z=Math.PI/2;cord.position.y=.69;reel.root.add(cord);
  this.targets.push({id:'kite',position:reel.root.position.clone(),support:reel});this.kiteHome.set(footing.x+1.2,footing.y+.12,footing.z+1);this.reelOrigin.set(footing.x,footing.y+.69,footing.z);
  const diamond=new BufferGeometry();diamond.setAttribute('position',new Float32BufferAttribute([0,.95,0,-.65,0,0,0,-.8,0,.65,0,0,0,0,.14],3));diamond.setIndex([0,1,4,1,2,4,2,3,4,3,0,4]);diamond.computeVertexNormals();this.kite.add(new Mesh(diamond,new MeshStandardMaterial({color:'#c96d43',side:DoubleSide,roughness:.9})));this.box(this.kite,this.wood,0,.05,.025,.025,1.78,.025);this.box(this.kite,this.wood,0,0,.025,1.28,.025,.025);
  for(let i=0;i<5;i++){const tail=this.box(this.kite,i%2?this.rope:this.rust,Math.sin(i)*.08,-1-i*.2,0,.16,.1,.015);tail.rotation.z=i*.4;}
  this.box(g,this.wood,0,roof-p.y-.35,0,.025,.7,.025);this.box(g,new MeshStandardMaterial({color:'#e8c58c',emissive:'#f3b85f',emissiveIntensity:.4}),0,roof-p.y-.76,0,.20,.28,.20);this.campLight=new PointLight('#efbe7f',0,9,2);this.campLight.position.set(0,roof-p.y-.8,0);g.add(this.campLight);
 }
 private pool(){
  const s=this.supported(694,166);if(!s)return;this.poolSupport=s;const g=s.root;g.name='south-bay-tidepool';
  const basin=new Mesh(new CircleGeometry(1.25,18),new MeshStandardMaterial({color:'#3e514a',roughness:.8}));basin.rotation.x=-Math.PI/2;basin.position.y=.04;g.add(basin);
  const mat=new ShaderMaterial({transparent:true,depthWrite:false,side:DoubleSide,uniforms:{time:this.wind,night:this.poolNight},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;uniform float time;uniform float night;void main(){float d=length(vUv-.5);float w=sin(d*68.-time*1.5)*.035+sin((vUv.x+vUv.y)*45.+time)*.025;vec3 c=mix(vec3(.19,.43,.43),vec3(.16,.62,.54),night*.55)+w;gl_FragColor=vec4(c,.74*smoothstep(.5,.45,d));}'});
  const water=new Mesh(new CircleGeometry(1.18,24),mat);water.rotation.x=-Math.PI/2;water.position.y=.12;g.add(water);
  for(let i=0;i<14;i++){const a=i*Math.PI*2/14,x=Math.cos(a)*1.3,z=Math.sin(a)*1.3;const rock=this.box(g,this.stone,x,.16,z,.5,.32,.4);rock.rotation.y=a;this.bound(s,x,.16,z,.5,.32,.4);}
  for(let i=0;i<5;i++){const root=new Group(),home=new Vector3(g.position.x+Math.cos(i*1.8)*.9,g.position.y+.165,g.position.z+Math.sin(i*1.8)*.9);this.root.add(root);this.box(root,this.rust,0,.055,0,.18,.1,.13);for(const side of [-1,1]){for(let l=0;l<3;l++)this.box(root,this.rust,side*.13,.03,-.065+l*.055,.13,.025,.018).rotation.y=side*(l-1)*.4;this.box(root,this.rust,side*.12,.07,-.13,.065,.045,.08);}this.box(g,this.stone,Math.cos(i*1.8)*.9,.09,Math.sin(i*1.8)*.9,.27,.18,.23);this.crabs.push({root,home,angle:i*1.8,retreat:0});}
  this.targets.push({id:'pool',position:g.position.clone(),support:s});
 }
 private overlook(){
  const f=findFurnitureFooting(this.world,701,165,0,furnitureFootContacts([{x:-.7,z:0},{x:.7,z:0}],.04,.18),regionalHeightAt(701,165)+1,3);if(!f)return;
  const g=new Group();g.position.set(f.x,f.y,f.z);this.root.add(g);const s={root:g,anchors:f.anchors,bounds:[] as SceneObstacle[]};this.supports.push(s);
  for(let i=0;i<4;i++)this.box(g,this.wood,0,.47,(i-1.5)*.12,1.85,.12,.1);for(let i=0;i<3;i++)this.box(g,this.wood,0,.65+i*.17,-.23,1.85,.13,.08);for(const x of [-.7,.7])this.box(g,this.stone,x,.2,0,.12,.4,.44);
  this.bound(s,0,.47,0,1.85,.12,.48);this.bound(s,0,.84,-.23,1.85,.55,.08,false);
  this.seats.push({id:'south-bay-overlook',position:{x:f.x,y:f.y+.53,z:f.z+.12},floorY:f.y,yaw:Math.PI,available:()=>g.visible});
 }
 private dunes(){
  const geo=new ConeGeometry(.085,.65,3),mat=new MeshStandardMaterial({color:'#858c59',roughness:1,side:DoubleSide});mat.onBeforeCompile=shader=>{shader.uniforms.uBayTime=this.wind;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uBayTime;').replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x+=sin(uBayTime*1.4+instanceMatrix[3].x*.2)*max(0.,position.y+.325)*.14;');};
  for(let i=0;i<420;i++){const x=602+((i*73.173)%134),z=149+((i*13.741)%34),y=this.ground(x,z),road=sampleRegionalRoad(x,z,9);if(y===null||y>19||road&&road.distance<8||Math.hypot(x-628,z-157)<5||Math.hypot(x-694,z-166)<4||Math.hypot(x-701,z-165)<3||Math.abs(x-657.5)<3)continue;
   for(let blade=0;blade<4;blade++){const scale=.6+((i*3+blade)%7)*.13,m=new Matrix4().makeRotationZ((blade-1.5)*.17);m.scale(new Vector3(scale,scale,scale));m.setPosition(x+Math.sin(blade*2)*.2,y+.325*scale,z+Math.cos(blade*2)*.2);this.plants.push({anchor:{x:Math.floor(x),y:y-1,z:Math.floor(z)},matrix:m});}
  }
  this.plantMesh=new InstancedMesh(geo,mat,this.plants.length);this.plantMesh.name='south-bay-wind-dunes';this.plantMesh.frustumCulled=false;this.root.add(this.plantMesh);
 }
}
