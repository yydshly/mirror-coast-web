import {BoxGeometry,BufferGeometry,CylinderGeometry,Group,Mesh,MeshStandardMaterial,Object3D,TorusGeometry,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PlayerAvatar} from '../rendering/player-avatar';
import {humanBox} from '../rendering/human-geometry';
import {surfaceFinish} from '../rendering/surface-finish';

/** Shared small interior, without an extra render pass or cabin lights. */
export function createCabin(kind:'car'|'helicopter'){
 const root=new Group();root.name=`${kind}-interior`;
 const unit=new BoxGeometry(1,1,1),soft=humanBox(.13),rodGeometry=new CylinderGeometry(1,1,1,8),ring=new TorusGeometry(.19,.018,8,24),disc=new CylinderGeometry(1,1,.02,24).rotateX(Math.PI/2),bezel=new TorusGeometry(1,.09,6,24);
 const geometries:BufferGeometry[]=[unit,soft,rodGeometry,ring,disc,bezel];
 const trim=new MeshStandardMaterial({color:'#253a3c',roughness:.88}),seat=new MeshStandardMaterial({color:'#667d76',roughness:.94}),metal=new MeshStandardMaterial({color:'#8faaa5',roughness:.45,metalness:.45}),dial=new MeshStandardMaterial({color:'#92bcb0',roughness:.7,emissive:'#537f72',emissiveIntensity:.35}),belt=new MeshStandardMaterial({color:'#bbaa82',roughness:.9});
 const seatBase=new MeshStandardMaterial({color:'#30464a',roughness:.96}),insert=surfaceFinish(new MeshStandardMaterial({color:kind==='car'?'#82958b':'#8d9c94',roughness:.97}),'fabric'),door=new MeshStandardMaterial({color:'#586b66',roughness:.92}),face=new MeshStandardMaterial({color:'#172e33',roughness:.72,emissive:'#152d30',emissiveIntensity:.10}),ivory=new MeshStandardMaterial({color:'#d8d6bc',roughness:.8}),needlePaint=new MeshStandardMaterial({color:'#d6a273',roughness:.65}),carpet=surfaceFinish(new MeshStandardMaterial({color:'#3d5050',roughness:1}),'fabric');
 const materials=[trim,seat,metal,dial,belt,seatBase,insert,door,face,ivory,needlePaint,carpet];
 const box=(p:Group,name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,m=trim,rounded=false)=>{const mesh=new Mesh(rounded?soft:unit,m);mesh.name=name;mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=false;mesh.receiveShadow=true;p.add(mesh);return mesh;};
 const rod=(p:Group,a:Vector3,b:Vector3,r=.018,m=metal)=>{const mesh=new Mesh(rodGeometry,m),delta=b.clone().sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.clone().normalize());mesh.scale.set(r,delta.length(),r);p.add(mesh);return mesh;};
 const contact=(p:Group,name:string,x:number,y:number,z:number)=>{const a=new Object3D();a.name=name;a.position.set(x,y,z);p.add(a);return a;};
 const pilot=kind==='helicopter',driverX=pilot?.43:-.43,driverZ=pilot?-.08:.18,hipY=pilot?-.12:-.19;
 box(root,`${kind}-cabin-floor`,0,pilot?-.69:-.71,pilot?-.08:.12,1.68,.06,pilot?2.4:2.65,carpet);
 for(const x of [-.43,.43]){
  const chair=new Group();chair.name=`${kind}-${x===driverX?'driver':'passenger'}-seat`;root.add(chair);
  box(chair,'seat-cushion',x,hipY-.12,driverZ,.53,.14,.50,seatBase,true);
  box(chair,'seat-cushion-insert',x,hipY-.055,driverZ-.02,.41,.045,.41,insert,true);
  box(chair,'seat-back',x,hipY+.21,driverZ+.28,.51,.65,.125,seat,true).rotation.x=.10;
  box(chair,'seat-back-insert',x,hipY+.23,driverZ+.205,.39,.47,.027,insert,true).rotation.x=.10;
  box(chair,'seat-headrest',x,hipY+.60,driverZ+.30,.31,.20,.13,insert,true);
  for(const side of [-1,1]){box(chair,'seat-side-bolster',x+side*.224,hipY-.065,driverZ,.055,.11,.43,seat,true);box(chair,'seat-piping',x+side*.204,hipY-.027,driverZ,.012,.009,.34,belt);}
  for(const side of [-1,1])rod(chair,new Vector3(x+side*.16,hipY-.4,driverZ-.1),new Vector3(x+side*.16,hipY-.14,driverZ+.14),.016);
 }
 if(!pilot){box(root,'rear-seat-cushion',0,-.31,1.05,1.42,.12,.40,seat);box(root,'rear-seat-back',0,-.05,1.31,1.42,.52,.1,seat);box(root,'center-tunnel',0,-.55,-.02,.16,.27,1.1);}
 for(const side of [-1,1]){
  box(root,'inner-door-panel',side*.835,-.26,pilot?.02:.34,.045,.61,pilot?1.35:1.78,door,true);
  box(root,'door-armrest',side*.785,-.12,pilot?.02:.10,.12,.08,.45,seatBase,true);
  box(root,'door-handle-inset',side*.805,.015,pilot?-.22:-.18,.020,.055,.18,trim,true);
  box(root,'door-pull',side*.788,.012,pilot?-.22:-.18,.018,.018,.13,metal);
 }
 const dashboard=new Group();dashboard.name=`${kind}-dashboard`;root.add(dashboard);
 box(dashboard,'dashboard-shell',0,pilot?-.07:.06,pilot?-1.08:-.80,1.55,.22,.32,trim,true);
 box(dashboard,'dashboard-upper-pad',0,pilot?.07:.18,pilot?-1.09:-.82,1.54,.055,.31,seatBase,true);
 const gaugeX=pilot?.43:-.43,gaugeZ=pilot?-.906:-.626;
 const needles:Group[]=[];
 for(let i=0;i<(pilot?3:1);i++){
  const x=gaugeX+(pilot?(i-1)*.145:0),y=pilot?-.01:.095,r=pilot?.051:.067;
  const rim=new Mesh(bezel,metal);rim.position.set(x,y,gaugeZ+.012);rim.scale.setScalar(r);dashboard.add(rim);
  const plate=new Mesh(disc,face);plate.position.set(x,y,gaugeZ+.014);plate.scale.set(r,r,.6);dashboard.add(plate);
  for(let k=0;k<=10;k++){const a=3.927-k*4.712/10;box(dashboard,'instrument-tick',x+Math.cos(a)*r*.79,y+Math.sin(a)*r*.79,gaugeZ+.023,.0025,r*.16,.003,ivory).rotation.z=a-Math.PI/2;}
  const needle=new Group();needle.name=`${kind}-instrument-needle-${i}`;needle.position.set(x,y,gaugeZ+.029);dashboard.add(needle);rod(needle,new Vector3(),new Vector3(r*.73,0,0),.0028,needlePaint);needles.push(needle);
 }
 if(!pilot)for(const side of [-1,1]){const x=gaugeX+side*.18;box(dashboard,'dashboard-vent',x,.095,gaugeZ,.11,.065,.025,face,true);for(let j=0;j<3;j++)box(dashboard,'vent-slat',x,.075+j*.018,gaugeZ+.017,.09,.005,.009,metal);}
 box(dashboard,'center-screen-surround',pilot?-.27:.15,pilot?-.01:.095,gaugeZ,.28,.17,.032,face,true);
 box(dashboard,'center-console-screen',pilot?-.27:.15,pilot?-.01:.095,gaugeZ+.020,.23,.13,.012,dial);
 for(let i=0;i<3;i++)box(dashboard,'screen-display-line',pilot?-.30:.12,(pilot?-.045:.065)+i*.027,gaugeZ+.028,.12-i*.022,.006,.003,ivory);
 for(let i=0;i<3;i++)box(dashboard,'console-switch',pilot?-.42+i*.13:.03+i*.13,pilot?-.15:-.045,gaugeZ+.02,.042,.025,.023,metal);
 const steering=new Group();steering.name=pilot?'helicopter-cyclic':'car-steering-wheel';root.add(steering);
 const collective=new Group();collective.name='helicopter-collective';root.add(collective);
 let leftHand:Object3D,rightHand:Object3D;
 if(!pilot){
  const column=new Group();column.name='car-steering-column';column.position.set(driverX,.15,-.30);column.rotation.x=-.37;root.add(column);column.add(steering);
  const rim=new Mesh(ring,trim);steering.add(rim);
  for(const a of [-Math.PI/2,Math.PI/6,Math.PI*5/6])rod(steering,new Vector3(),new Vector3(Math.cos(a)*.17,Math.sin(a)*.17,0),.012);
  box(steering,'steering-hub',0,0,.008,.09,.075,.045);
  rod(root,new Vector3(driverX,-.025,-.74),new Vector3(driverX,.15,-.30),.025,trim);
  leftHand=contact(steering,'car-left-wheel-grip',-.18,0,.01);rightHand=contact(steering,'car-right-wheel-grip',.18,0,.01);
  rod(root,new Vector3(.08,-.43,-.22),new Vector3(.08,-.16,-.25),.018);box(root,'gear-selector',.08,-.14,-.25,.055,.05,.065);
  box(root,'handbrake',.08,-.27,.17,.045,.05,.25);
 }else{
  steering.position.set(driverX+.06,-.55,-.38);box(root,'cyclic-pedestal',driverX+.06,-.61,-.38,.10,.17,.10);rod(steering,new Vector3(),new Vector3(0,.64,0),.019,trim);
  box(steering,'cyclic-grip',0,.65,0,.055,.11,.07);rightHand=contact(steering,'helicopter-cyclic-grip',0,.65,.01);
  collective.position.set(.06,-.43,.20);rod(collective,new Vector3(),new Vector3(0,.4,-.2),.025,trim);box(collective,'collective-grip',0,.4,-.2,.06,.055,.13);
  leftHand=contact(collective,'helicopter-collective-grip',0,.4,-.2);
 }
 const pedals:Group[]=[],soles:Object3D[]=[];
 for(let i=0;i<2;i++){
  const x=driverX+(i?.105:-.105),z=pilot?-.64:(i?-.42:-.36),y=pilot?-.65:-.68;
  const pedal=new Group();pedal.name=`${kind}-${i?'right':'left'}-pedal`;pedal.position.set(x,y,z);root.add(pedal);pedals.push(pedal);
  box(pedal,'pedal-pad',0,-.025,0,.13,.04,.20);soles.push(contact(pedal,`${kind}-${i?'right':'left'}-pedal-contact`,0,0,0));
 }
 const driver=new PlayerAvatar();driver.root.name=`${kind}-driver`;driver.root.position.set(driverX,0,driverZ);root.add(driver.root);driver.root.visible=false;
 // The shoulder belt belongs to the seated body; it never remains floating
 // in an empty seat. Keep it separate from the avatar's reusable walking rig.
 rod(driver.root,new Vector3(-.15,hipY+.47,-.12),new Vector3(.15,hipY+.02,-.14),.018,belt);
 const hip=new Vector3(0,hipY,0),hands=[new Vector3(),new Vector3()],feet=[new Vector3(),new Vector3()];
 let active=false;
 const update=(dt:number,occupied:boolean,controls:{steer?:number;throttle?:number;brake?:boolean;pitch?:number;roll?:number;yaw?:number;lift?:number;speed?:number;altitude?:number;rpm?:number}={})=>{
  driver.root.visible=occupied;
  const values=pilot?[Math.abs(controls.speed??0)/32,(controls.altitude??0)/100,controls.rpm??0]:[Math.abs(controls.speed??0)/32];
  needles.forEach((n,i)=>{n.rotation.z=3.927-Math.max(0,Math.min(1,values[i]))*4.712;});
  if(!pilot){steering.rotation.z=(controls.steer??0)*2.2;pedals[1].rotation.x=(controls.throttle??0)>0?-.10:0;pedals[0].rotation.x=controls.brake?-.12:0;}
  else{steering.rotation.x=-(controls.pitch??0)*.13;steering.rotation.z=-(controls.roll??0)*.13;collective.rotation.x=-.10+(controls.lift??0)*.22;pedals.forEach((p,i)=>p.position.z=-.64+(i?1:-1)*(controls.yaw??0)*.055);}
  if(!occupied){active=false;return;}
  root.updateWorldMatrix(true,true);driver.root.updateWorldMatrix(true,false);
  [leftHand,rightHand].forEach((grip,i)=>{grip.getWorldPosition(hands[i]);driver.root.worldToLocal(hands[i]);});
  soles.forEach((sole,i)=>{sole.getWorldPosition(feet[i]);driver.root.worldToLocal(feet[i]);});
  driver.vehiclePose(dt,hip,hands,feet,pilot?-.03:-.055);active=true;
 };
 // Merge stationary parts per material within each joint; controls and named
 // contact frames retain their separate transforms.
 const batch=(p:Group)=>{for(const child of [...p.children])if(child instanceof Group&&child!==driver.root)batch(child);for(const material of materials){const meshes=p.children.filter((m):m is Mesh=>m instanceof Mesh&&m.material===material);if(meshes.length<2)continue;const parts=meshes.map(m=>{m.updateMatrix();return(m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone()).applyMatrix4(m.matrix);}),geometry=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());geometries.push(geometry);const mesh=new Mesh(geometry,material);mesh.castShadow=false;mesh.receiveShadow=true;meshes.forEach(m=>m.removeFromParent());p.add(mesh);}};
 batch(root);
 return{root,driver:driver.root,update,get active(){return active;},dispose:()=>{driver.dispose();root.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
