import {BoxGeometry,BufferGeometry,CylinderGeometry,ExtrudeGeometry,Group,Mesh,MeshStandardMaterial,Shape,TorusGeometry,Vector3,DoubleSide} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PlayerAvatar} from '../rendering/player-avatar';
import {surfaceFinish} from '../rendering/surface-finish';

export function coastalBoatModel(){
 const root=new Group(),engine=new Group(),wheel=new Group(),rider=new PlayerAvatar();root.name='coastal-motorboat';
 const cube=new BoxGeometry(),geometries=new Set<BufferGeometry>([cube]),materials=new Set<MeshStandardMaterial>();
 const material=(color:string,roughness=.7)=>{const m=new MeshStandardMaterial({color,roughness});materials.add(m);return m;};
 const paint=material('#3e7276',.43),cream=material('#ddd9c6'),rubber=material('#202b2c'),metal=material('#89948c',.35),cushion=material('#cabd99'),wood=surfaceFinish(material('#9b8060'),'wood'),glass=material('#50747b',.23),red=material('#cc5a42');
 glass.transparent=true;glass.opacity=.48;glass.depthWrite=false;glass.side=DoubleSide;metal.metalness=.55;
 const portLamp=material('#d96b4e'),starboardLamp=material('#7cbf9a'),sternLamp=material('#ebe3be');for(const m of [portLamp,starboardLamp,sternLamp]){m.emissive.copy(m.color);m.emissiveIntensity=.15;}
 const box=(parent:Group,m:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number,name?:string)=>{const mesh=new Mesh(cube,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.name=name??'';mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 const rod=(parent:Group,m:MeshStandardMaterial,a:Vector3,b:Vector3,r=.045)=>{const d=b.clone().sub(a),mesh=box(parent,m,0,0,0,r,d.length(),r);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0),d.normalize());return mesh;};
 const shape=new Shape();shape.moveTo(-1.04,2.4);shape.lineTo(1.04,2.4);shape.lineTo(1.15,-1.35);shape.lineTo(.55,-2.45);shape.lineTo(0,-3.1);shape.lineTo(-.55,-2.45);shape.lineTo(-1.15,-1.35);shape.closePath();
 const hullGeometry=new ExtrudeGeometry(shape,{depth:.98,bevelEnabled:false});hullGeometry.rotateX(Math.PI/2);geometries.add(hullGeometry);const hull=new Mesh(hullGeometry,paint);hull.position.y=.55;hull.castShadow=hull.receiveShadow=true;root.add(hull);
 const deckGeometry=new ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false});deckGeometry.rotateX(Math.PI/2);deckGeometry.scale(.91,1,.93);geometries.add(deckGeometry);const deck=new Mesh(deckGeometry,wood);deck.position.y=.60;deck.name='boat-deck';deck.receiveShadow=true;root.add(deck);
 // Layered gunwales, narrow rails and cleats follow the visible hull outline.
 const outline=[[-1.04,2.4],[1.04,2.4],[1.15,-1.35],[.55,-2.45],[0,-3.1],[-.55,-2.45],[-1.15,-1.35],[-1.04,2.4]];
 for(let i=1;i<outline.length;i++){const a=outline[i-1],b=outline[i];rod(root,cream,new Vector3(a[0],.66,a[1]),new Vector3(b[0],.66,b[1]),.10);}
 for(const side of [-1,1]){
  for(const z of [-1.3,.7,2.1]){box(root,metal,side*.99,.87,z,.045,.42,.045);box(root,rubber,side*1.09,.25,z,.09,.18,.30);}
  rod(root,metal,new Vector3(side*.99,1.08,-1.3),new Vector3(side*.99,1.08,2.1),.035);
  for(const z of [-1.8,1.85]){box(root,metal,side*.79,.71,z,.24,.05,.05);box(root,metal,side*.79,.66,z,.05,.09,.05);}
 }
 box(root,cushion,0,.87,1.55,1.65,.18,.55);box(root,cream,0,1.1,1.85,1.77,.47,.10);box(root,cream,0,.70,1.55,1.6,.2,.5);
 box(root,cream,.43,.87,-.05,.52,.35,.58);box(root,cushion,.43,1.07,-.05,.56,.11,.6);box(root,cushion,.43,1.27,.23,.56,.44,.10);
 box(root,cream,.45,1.03,-.91,.68,.81,.44);box(root,rubber,.45,1.44,-.91,.58,.05,.42,'boat-dashboard');
 const gaugeGeometry=new CylinderGeometry(.07,.07,.022,12);gaugeGeometry.rotateX(Math.PI/2);geometries.add(gaugeGeometry);const gauge=new Mesh(gaugeGeometry,rubber);gauge.position.set(.45,1.39,-.668);root.add(gauge);
 for(const x of [.30,.60])box(root,metal,x,1.47,-.82,.065,.025,.06);
 box(root,glass,0,1.48,-1.34,1.83,.56,.025);for(const side of [-1,1]){box(root,metal,side*.94,1.48,-1.34,.035,.60,.045);box(root,side<0?portLamp:starboardLamp,side*.88,1.14,-1.45,.13,.08,.20);}box(root,metal,0,1.78,-1.34,1.92,.04,.04);box(root,metal,0,1.13,2.15,.035,.7,.035);box(root,sternLamp,0,1.5,2.15,.12,.14,.12);
 // Wheel and rider share grip points, rather than independent hand animation.
 wheel.position.set(.45,1.40,-.62);wheel.rotation.x=-.3;root.add(wheel);
 const wheelGeometry=new TorusGeometry(.19,.018,6,16);geometries.add(wheelGeometry);wheel.add(new Mesh(wheelGeometry,rubber));for(const a of [0,2.094,4.189])rod(wheel,metal,new Vector3(),new Vector3(Math.sin(a)*.175,Math.cos(a)*.175,0),.018);
 const grips=[new Group(),new Group()];grips.forEach((g,i)=>{g.position.set(i?.145:-.145,.09,0);wheel.add(g);});
 const lever=new Group();lever.position.set(.87,1.35,-.5);root.add(lever);box(lever,rubber,0,.09,0,.045,.18,.05);
 engine.position.set(0,.15,2.47);root.add(engine);box(engine,rubber,0,.44,0,.67,.73,.48);box(engine,cream,0,.76,0,.55,.12,.39);box(engine,metal,0,-.09,.14,.17,.65,.2);
 const propeller=new Group();propeller.position.set(0,-.34,.25);engine.add(propeller);for(const a of [0,2.094,4.189]){const blade=box(propeller,rubber,Math.sin(a)*.12,Math.cos(a)*.12,0,.10,.25,.025);blade.rotation.z=-a;}
 const lifeRingGeometry=new TorusGeometry(.27,.065,6,16);geometries.add(lifeRingGeometry);const lifeRing=new Mesh(lifeRingGeometry,red);lifeRing.position.set(-.96,1.12,1.4);lifeRing.rotation.y=Math.PI/2;root.add(lifeRing);
 rider.root.position.set(.43,0,-.04);rider.root.name='boat-helmsman';root.add(rider.root);rider.root.visible=false;
 // Static fittings are merged by material. Controls and the reusable rig remain joints.
 for(const m of materials){const meshes=root.children.filter((o):o is Mesh=>o instanceof Mesh&&o.material===m);if(meshes.length<2)continue;const parts=meshes.map(o=>{o.updateMatrix();return(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrix);}),g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());geometries.add(g);meshes.forEach(o=>o.removeFromParent());const batch=new Mesh(g,m);batch.castShadow=batch.receiveShadow=true;root.add(batch);}
 const hands=[new Vector3(),new Vector3()],feet=[new Vector3(-.13,.63,-.54),new Vector3(.13,.63,-.54)],hip=new Vector3(0,1.08,0);
 return{root,update(dt:number,occupied:boolean,speed:number,steer:number,night=0){wheel.rotation.z=steer*1.5;engine.rotation.y=-steer*.42;lever.rotation.x=Math.min(.35,Math.abs(speed)*.035);propeller.rotation.z+=dt*speed*18;for(const m of [portLamp,starboardLamp,sternLamp])m.emissiveIntensity=.1+night*(occupied?2:.7);rider.root.visible=occupied;if(occupied){root.updateWorldMatrix(true,true);grips.forEach((g,i)=>{g.getWorldPosition(hands[i]);rider.root.worldToLocal(hands[i]);});rider.vehiclePose(dt,hip,hands,feet,-.03);}},dispose(){root.removeFromParent();rider.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
