import {BoxGeometry,Group,Mesh,MeshStandardMaterial,IcosahedronGeometry,CylinderGeometry,SphereGeometry,DoubleSide,PlaneGeometry,InstancedMesh,Matrix4,Vector3,Quaternion,Scene,PointLight} from 'three';
import {Material} from '../world/palette';
import type {VoxelWorld,Vector3Like} from '../world/voxel';
import {regionalHeightAt} from '../world/region-terrain';
import {visibleFrom} from '../gameplay/discoveries';
import {FOREST_WALK} from '../gameplay/coast-signals';
import type {SceneObstacle} from '../input/scene-collisions';
import {surfaceFinish} from './surface-finish';
type Detail={root:Group;anchors:Vector3Like[];bounds:SceneObstacle[]};
/** Wind-shaped headland and a shaded, quiet forest floor; real ground is authoritative. */
export class OuterCoast {
 readonly obstacles:SceneObstacle[]=[];private root=new Group();private details:Detail[]=[];private cube=new BoxGeometry(1,1,1);private rock=new IcosahedronGeometry(1,0);private clock=0;
 private wood=surfaceFinish(new MeshStandardMaterial({color:'#665c43',roughness:1}),'wood');private moss=new MeshStandardMaterial({color:'#566c4d',roughness:1});private stone=surfaceFinish(new MeshStandardMaterial({color:'#6b756c',roughness:1}),'stone');private copper=new MeshStandardMaterial({color:'#ab7045',roughness:.65,metalness:.35});
 private buoy=new Group();private lamp=new MeshStandardMaterial({color:'#82ceb8',emissive:'#5fc3af',emissiveIntensity:.5});private bell=new Group();private bellSupport:Detail|undefined;private bellSwing=0;
 private birds:{root:Group;home:Vector3;phase:number;flight:number;wings:Mesh[]}[]=[];private lastFocus=new Vector3(Infinity,0,Infinity);private quiet=0;private lanterns:PointLight[]=[];
 private plants:{anchor:Vector3Like;matrix:Matrix4}[]=[];private fernMesh:InstancedMesh|undefined;
 constructor(scene:Scene,private world:VoxelWorld){this.root.name='cape-and-forest-atmosphere';scene.add(this.root);this.cape();this.forest();this.sync();}
 get gladeObserved(){return this.quiet>4&&Math.hypot(this.lastFocus.x+102,this.lastFocus.z+231)<5;}
 get diagnostics(){return{ferns:this.plants.length,birds:this.birds.length,flyingBirds:this.birds.filter(b=>b.flight>.3).length,perches:this.birds.map(b=>b.home),bellSwing:this.bellSwing};}
 private floor(x:number,z:number){const expected=regionalHeightAt(x,z);for(let y=Math.min(91,expected+2);y>=Math.max(12,expected-2);y--){const m=this.world.getVoxel(Math.floor(x),y,Math.floor(z));if([Material.Grass,Material.Rock,Material.Sand,Material.Wood,Material.Concrete].includes(m as never)&&!this.world.getVoxel(Math.floor(x),y+1,Math.floor(z))&&!this.world.getVoxel(Math.floor(x),y+2,Math.floor(z)))return y+1;}return null;}
 private detail(x:number,z:number):Detail|null{const y=this.floor(x,z);if(y===null)return null;const root=new Group();root.position.set(x,y,z);this.root.add(root);const d={root,anchors:[{x:Math.floor(x),y:y-1,z:Math.floor(z)}],bounds:[]};this.details.push(d);return d;}
 private box(g:Group,m:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number){const mesh=new Mesh(this.cube,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;g.add(mesh);return mesh;}
 private branch(g:Group,a:Vector3,b:Vector3,r:number){const delta=b.clone().sub(a),mesh=this.box(g,this.wood,0,0,0,r,delta.length(),r);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.normalize());}
 private bound(d:Detail,x:number,y:number,z:number,sx:number,sy:number,sz:number){const p=d.root.position;d.bounds.push({minX:p.x+x-sx/2,maxX:p.x+x+sx/2,minY:p.y+y-sy/2,maxY:p.y+y+sy/2,minZ:p.z+z-sz/2,maxZ:p.z+z+sz/2,standable:false});}
 private cape(){
  for(const [x,z]of [[-198,112],[-202,130],[-174,139]]){const d=this.detail(x,z);if(!d)continue;
   this.branch(d.root,new Vector3(0,0,0),new Vector3(1.2,3.5,.25),.28);this.branch(d.root,new Vector3(1.2,3.5,.25),new Vector3(4,4.7,.5),.20);this.bound(d,.6,1.8,.1,1.6,3.6,.65);
   for(let i=0;i<6;i++){const leaf=new Mesh(this.rock,this.moss);leaf.position.set(1+i*.52,3.9+Math.sin(i*.7)*.7,(i%2-.5)*.8);leaf.scale.set(1.5,.55,1);leaf.castShadow=true;d.root.add(leaf);}
  }
  // A fixed inspection bell at the open side of the service court.
  const d:Detail={root:new Group(),anchors:[{x:-194,y:20,z:130}],bounds:[]};d.root.position.set(-193.2,21,130);this.root.add(d.root);this.details.push(d);this.bellSupport=d;
  for(const x of [-.6,.6]){this.box(d.root,this.wood,x,1.05,0,.1,2.1,.1);this.bound(d,x,1.05,0,.12,2.1,.12);}this.box(d.root,this.wood,0,2.1,0,1.4,.13,.15);
  this.bell.position.set(0,1.97,0);d.root.add(this.bell);const bell=new Mesh(new CylinderGeometry(.16,.36,.48,12,1,true),this.copper);bell.position.y=-.32;this.bell.add(bell);this.box(this.bell,this.wood,0,-.65,0,.035,.8,.035);
  this.root.add(this.buoy);this.buoy.position.set(-216,12.4,194);this.box(this.buoy,this.wood,0,0,0,1.7,.35,1.7);this.box(this.buoy,this.copper,0,1.1,0,.13,2.2,.13);this.box(this.buoy,this.lamp,0,2.3,0,.5,.5,.5);
 }
 private audio:AudioContext|undefined;
 ringBell(audible=false){if(!this.bellSupport?.root.visible)return;this.bellSwing=1;if(audible&&typeof AudioContext!=='undefined'){try{this.audio??=new AudioContext();void this.audio.resume();const now=this.audio.currentTime;for(const [f,v]of [[440,.10],[887,.055],[1306,.025]]){const tone=this.audio.createOscillator(),gain=this.audio.createGain();tone.frequency.value=f;tone.type='sine';gain.gain.setValueAtTime(v,now);gain.gain.exponentialRampToValueAtTime(.0001,now+2.8);tone.connect(gain).connect(this.audio.destination);tone.start(now);tone.stop(now+2.9);tone.onended=()=>{tone.disconnect();gain.disconnect();};}}catch{/* Sound is optional; the bell animation stays playable. */}}}
 bellNear(p:Vector3Like){return !!this.bellSupport?.root.visible&&Math.hypot(p.x+193.2,p.z-130)<2&&Math.abs(p.y-21)<1;}
 private forest(){
  for(const [x,z,h]of [[-110,-236,7],[-108,-219,8],[-96,-217,6],[-106,-247,8],[-114,-228,7]]){const d=this.detail(x,z);if(!d)continue;this.branch(d.root,new Vector3(),new Vector3(.25,h,0),.26);this.bound(d,.12,h/2,0,.5,h,.5);for(let level=0;level<4;level++)for(let side=0;side<3;side++){const a=side*2.1+level*.6,r=1.4-level*.25,leaf=new Mesh(this.rock,this.moss);leaf.position.set(Math.cos(a)*r*.6,h-3+level*.85,Math.sin(a)*r*.6);leaf.scale.set(r,.8,r*.8);leaf.castShadow=true;d.root.add(leaf);}}
  const fernMaterial=new MeshStandardMaterial({color:'#537956',roughness:1,side:DoubleSide}),fern=new PlaneGeometry(.3,1);fern.translate(0,.5,0);fernMaterial.onBeforeCompile=s=>{s.uniforms.uForestTime={value:0};this.fernWind=s.uniforms.uForestTime;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float uForestTime;').replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x+=sin(uForestTime+instanceMatrix[3].x)*position.y*.035;');};
  for(let i=0;i<230;i++){const x=-116+(i*17.127)%42,z=-252+(i*13.729)%55,y=this.floor(x,z);if(y===null)continue;const nearTrail=FOREST_WALK.some(p=>Math.hypot(p.x-x,p.z-z)<2);if(nearTrail)continue;
   for(let j=0;j<5;j++){const m=new Matrix4().compose(new Vector3(x,y,z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),j*1.256+i),new Vector3(.6,.35+(i%5)*.08,.65));m.multiply(new Matrix4().makeRotationZ((j%2?1:-1)*.45));this.plants.push({anchor:{x:Math.floor(x),y:y-1,z:Math.floor(z)},matrix:m});}
  }
  this.fernMesh=new InstancedMesh(fern,fernMaterial,this.plants.length);this.fernMesh.name='forest-ferns';this.fernMesh.frustumCulled=false;this.fernMesh.receiveShadow=true;this.root.add(this.fernMesh);
  for(const [x,z]of [[-105,-233],[-97,-224],[-112,-241],[-98,-248]]){const d=this.detail(x,z);if(!d)continue;const mesh=new Mesh(this.rock,this.stone);mesh.position.y=.4;mesh.scale.set(1.1,.7,.85);d.root.add(mesh);this.bound(d,0,.4,0,1.8,.8,1.5);const moss=new Mesh(this.rock,this.moss);moss.position.set(-.2,.7,0);moss.scale.set(.8,.18,.65);d.root.add(moss);
   for(let i=0;i<5;i++){const dx=1+i*.12,floor=this.floor(x+dx,z+.4);if(floor===null)continue;const offset=floor-d.root.position.y;this.box(d.root,this.wood,dx,offset+.10,.4,.035,.2,.035);const cap=new Mesh(new CylinderGeometry(.06,.12,.06,7),this.copper);cap.position.set(dx,offset+.22,.4);d.root.add(cap);}
  }
  const watching={x:-102,y:regionalHeightAt(-102,-231)+2.68,z:-231};
  const perches:Array<{x:number;z:number}>=[];
  for(let dz=-6;dz<=6;dz+=1.5)for(let dx=-6;dx<=6;dx+=1.5){const x=-102+dx,z=-231+dz,y=this.floor(x,z),distance=Math.hypot(dx,dz);if(y===null||distance<2.5||distance>6||Math.abs(y-watching.y+1.68)>2||!visibleFrom(this.world,watching,{x,y:y+1.1,z})||perches.some(p=>Math.hypot(p.x-x,p.z-z)<3))continue;
   const onPath=FOREST_WALK.slice(1).some((b,i)=>{const a=FOREST_WALK[i],vx=b.x-a.x,vz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*vx+(z-a.z)*vz)/(vx*vx+vz*vz)));return Math.hypot(x-a.x-vx*t,z-a.z-vz*t)<1;});if(onPath)continue;
   perches.push({x,z});if(perches.length>=3)break;
  }
  for(const {x,z}of perches.slice(0,3)){const d=this.detail(x,z);if(!d)continue;const perch=new Vector3(x+.4,d.root.position.y+1.1,z+.15);this.branch(d.root,new Vector3(0,0,0),new Vector3(.4,1,.15),.16);this.bound(d,.2,.5,.07,.65,1,.35);const root=new Group();this.root.add(root);const feather=new MeshStandardMaterial({color:'#63756a',roughness:1}),breast=new MeshStandardMaterial({color:'#c7b58b',roughness:1}),body=new Mesh(new SphereGeometry(1,10,7),feather);body.scale.set(.12,.13,.20);body.castShadow=true;root.add(body);const head=new Mesh(body.geometry,breast);head.position.set(0,.12,-.15);head.scale.set(.085,.085,.085);root.add(head);this.box(root,this.copper,0,.11,-.25,.04,.035,.09);for(const side of [-1,1])this.box(root,this.wood,side*.045,-.13,-.02,.025,.04,.10);const wings:Mesh[]=[];for(const side of [-1,1]){const wing=new Mesh(body.geometry,feather);wing.position.set(side*.12,.01,0);wing.scale.set(.045,.10,.17);root.add(wing);wings.push(wing);}this.birds.push({root,home:perch,phase:this.birds.length*2,flight:0,wings});}
  // Sparse amber lanterns mark the actual stair approach, without lighting the whole wood.
  for(const [x,z]of [[-88.5,-235],[-99.5,-238]]){const d=this.detail(x,z);if(!d)continue;this.box(d.root,this.wood,0,.6,0,.08,1.2,.08);this.box(d.root,new MeshStandardMaterial({color:'#d8ba78',emissive:'#d69c44',emissiveIntensity:.4}),0,1.24,0,.22,.25,.22);const light=new PointLight('#e2b873',0,6,2);light.position.y=1.3;d.root.add(light);this.lanterns.push(light);this.bound(d,0,.68,0,.25,1.4,.25);}
 }
 private fernWind:{value:unknown}|undefined;
 sync(){this.obstacles.length=0;for(const d of this.details){d.root.visible=d.anchors.every(p=>!!this.world.getVoxel(p.x,p.y,p.z));if(d.root.visible)this.obstacles.push(...d.bounds);}if(this.fernMesh){const zero=new Matrix4().makeScale(0,0,0);this.plants.forEach((p,i)=>this.fernMesh!.setMatrixAt(i,this.world.getVoxel(p.anchor.x,p.anchor.y,p.anchor.z)?p.matrix:zero));this.fernMesh.instanceMatrix.needsUpdate=true;}}
 update(dt:number,p:Vector3Like,night:number,capeActive=false){this.clock+=Math.min(.1,dt);if(this.fernWind)this.fernWind.value=this.clock;this.quiet=Math.hypot(p.x-this.lastFocus.x,p.z-this.lastFocus.z)<.01?this.quiet+dt:0;this.lastFocus.copy(p);this.bellSwing=Math.max(0,this.bellSwing-dt*.18);this.bell.rotation.z=Math.sin(this.clock*5)*this.bellSwing*.65;this.buoy.position.y=12.4+Math.sin(this.clock*.8)*.08;this.buoy.rotation.z=Math.sin(this.clock*.6)*.035;this.lamp.emissiveIntensity=capeActive?1.4+night*2+(Math.sin(this.clock*4)>.7?1.5:0):.5+night;this.lamp.color.set(capeActive?'#9cdec5':'#82b3b8');for(const l of this.lanterns)l.intensity=night*3;
  for(const b of this.birds){const near=Math.hypot(p.x-b.home.x,p.z-b.home.z)<7;const desired=near&&this.quiet<4?1:0;b.flight+=(desired-b.flight)*(1-Math.exp(-dt*.8));b.root.position.copy(b.home).add(new Vector3(Math.sin(this.clock*.8+b.phase)*5*b.flight,3.8*b.flight,Math.cos(this.clock*.8+b.phase)*4*b.flight));b.root.rotation.y=b.flight>.1?this.clock*.8+b.phase:b.phase+Math.sin(this.clock*.3)*.15;for(const [i,wing]of b.wings.entries())wing.rotation.z=Math.sin(this.clock*12)*.9*b.flight*(i?1:-1);b.root.visible=!!this.world.getVoxel(Math.floor(b.home.x-.4),Math.round(b.home.y-1.1)-1,Math.floor(b.home.z-.15));}
 }
}
