import {BoxGeometry,BufferGeometry,CatmullRomCurve3,CylinderGeometry,Group,Mesh,MeshStandardMaterial,Object3D,PlaneGeometry,Quaternion,TorusGeometry,TubeGeometry,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PlayerAvatar} from '../rendering/player-avatar';
import {contactShadowMaterial} from './contact-shadow';
import {BICYCLE_RIG as R,bicyclePedal,type BicyclePose,type BicycleSide} from './bicycle-rig';

export function bicycleModel(){
  const root=new Group(),lean=new Group(),front=new Group(),crank=new Group(),rider=new PlayerAvatar();
  root.name='rideable-coastal-bicycle';root.rotation.order='YXZ';root.add(lean);lean.add(front,crank,rider.root);
  const cube=new BoxGeometry(1,1,1),cylinder=new CylinderGeometry(1,1,1,8);
  const geometries:BufferGeometry[]=[cube,cylinder,new TorusGeometry(R.wheelRadius-R.tyreTube,R.tyreTube,8,24),new TorusGeometry(.27,.012,6,24)];
  const materials=['#b47a4b','#263b3e','#9ba6a0','#e2d6ac'].map((color,i)=>new MeshStandardMaterial({color,roughness:i===2?.35:.8,metalness:i===2?.65:0}));
  const up=new Vector3(0,1,0),worldPoint=new Vector3(),rotation=new Quaternion();
  const steeringPivot=new Vector3().copy(R.steeringPivot),steeringAxis=new Vector3().copy(R.steeringAxis).normalize();
  const box=(p:Group,x:number,y:number,z:number,sx:number,sy:number,sz:number,m=0)=>{
    const mesh=new Mesh(cube,materials[m]);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;p.add(mesh);return mesh;
  };
  const placeTube=(mesh:Mesh,a:Vector3,b:Vector3,r:number)=>{
    worldPoint.copy(b).sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(up,worldPoint.clone().normalize());mesh.scale.set(r,worldPoint.length(),r);
  };
  const tube=(p:Group,a:Vector3,b:Vector3,r=.021,m=0)=>{
    const mesh=new Mesh(cylinder,materials[m]);placeTube(mesh,a,b,r);mesh.castShadow=true;p.add(mesh);return mesh;
  };
  const wheels:Group[]=[];
  for(const z of [.72,-.76]){
    const wheel=new Group();wheel.name=z<0?'bicycle-front-wheel':'bicycle-rear-wheel';wheel.position.set(0,R.wheelRadius,z);if(z<0)wheel.position.sub(steeringPivot);
    (z<0?front:lean).add(wheel);wheels.push(wheel);
    for(let g=2;g<4;g++){const mesh=new Mesh(geometries[g],materials[g===2?1:2]);mesh.rotation.y=Math.PI/2;mesh.castShadow=true;wheel.add(mesh);}
    for(let i=0;i<8;i++){const a=i*Math.PI/4;tube(wheel,new Vector3(0,Math.cos(a)*.27,Math.sin(a)*.27),new Vector3(0,-Math.cos(a)*.27,-Math.sin(a)*.27),.004,2);}
    tube(wheel,new Vector3(-.075,0,0),new Vector3(.075,0,0),.034,2);
    const discGeometry=new CylinderGeometry(.085,.085,.012,20);discGeometry.rotateZ(Math.PI/2);geometries.push(discGeometry);
    const disc=new Mesh(discGeometry,materials[2]);disc.position.x=-.05;wheel.add(disc);
    if(z>0){const cogGeometry=new TorusGeometry(.045,.007,6,16);cogGeometry.rotateY(Math.PI/2);geometries.push(cogGeometry);const cog=new Mesh(cogGeometry,materials[1]);cog.position.x=.075;wheel.add(cog);}
  }
  front.position.copy(steeringPivot);
  const frame=new Group();frame.name='bicycle-frame';lean.add(frame);
  const a=new Vector3(0,R.crankY,0),b=new Vector3(0,.84,.10),headTop=new Vector3(0,.98,-.61),headBottom=steeringPivot;
  // Distinct low top tube and down tube: neither runs through the tyre or
  // duplicates the same segment. Wheels are held between paired fork ends.
  tube(frame,a,b,.027);tube(frame,headBottom,a,.029);
  tube(frame,new Vector3(0,.70,.07),new Vector3(0,.62,-.22),.022);tube(frame,new Vector3(0,.62,-.22),headTop,.022);
  tube(frame,headBottom,headTop,.038);tube(frame,b,new Vector3(0,.90,.05),.021,2);
  const fixedHead=new Object3D(),steeringHead=new Object3D();fixedHead.name='bicycle-head-fixed';steeringHead.name='bicycle-head-steering';fixedHead.position.copy(headTop);steeringHead.position.copy(headTop).sub(steeringPivot);frame.add(fixedHead);front.add(steeringHead);
  for(const side of [-1,1] as const){
    tube(frame,new Vector3(side*.035,R.crankY,0),new Vector3(side*.06,R.wheelRadius,.72),.014);
    tube(frame,new Vector3(side*.025,.81,.093),new Vector3(side*.06,R.wheelRadius,.72),.014);
    const fork=new Group();fork.name=`bicycle-front-fork-${side===-1?'left':'right'}`;front.add(fork);
    tube(fork,new Vector3(side*.066,.75,-.69).sub(steeringPivot),new Vector3(side*.066,R.wheelRadius,-.76).sub(steeringPivot),.018);
    tube(front,new Vector3(0,.75,-.69).sub(steeringPivot),new Vector3(side*.066,.75,-.69).sub(steeringPivot),.023);
  }
  tube(frame,new Vector3(-.115,R.crankY,0),new Vector3(.115,R.crankY,0),.033,2);
  for(const [name,parent,center]of [['front',front,new Vector3(0,R.wheelRadius,-.76).sub(steeringPivot)],['rear',frame,new Vector3(0,R.wheelRadius,.72)]] as const){const axle=new Object3D();axle.name=`bicycle-${name}-axle`;axle.position.copy(center);parent.add(axle);}
  box(lean,0,R.saddleTop-.0275,.05,.22,.055,.28,1);
  tube(front,headBottom.clone().sub(steeringPivot),headTop.clone().sub(steeringPivot),.022,2);
  tube(front,headTop.clone().sub(steeringPivot),new Vector3(0,1.25,-.52).sub(steeringPivot),.022,2);
  tube(front,new Vector3(-.25,1.25,-.52).sub(steeringPivot),new Vector3(.25,1.25,-.52).sub(steeringPivot),.018,2);
  for(const side of [-1,1] as const){
    const gripPosition=new Vector3(side*.23,1.25,-.52).sub(steeringPivot);
    box(front,gripPosition.x,gripPosition.y,gripPosition.z,.10,.045,.045,1);
    box(front,side*.16,1.23-steeringPivot.y,-.57-steeringPivot.z,.10,.013,.025,2);
    const grip=new Object3D();grip.name=`bicycle-${side===-1?'left':'right'}-grip`;grip.position.copy(gripPosition);front.add(grip);
  }
  box(front,-.08,.405-steeringPivot.y,-.73-steeringPivot.z,.04,.065,.08,1);
  box(frame,-.07,.41,.745,.045,.06,.07,1);
  crank.position.y=R.crankY;
  const pedals:Array<{side:BicycleSide;group:Group}>=[];
  for(const side of [-1,1] as const){
    tube(crank,new Vector3(side*.105,0,0),new Vector3(side*.105,side*R.crankRadius,0),.014,2);
    tube(crank,new Vector3(side*.105,side*R.crankRadius,0),new Vector3(side*.22,side*R.crankRadius,0),.012,2);
    const spindle=new Object3D();spindle.name=`bicycle-${side===-1?'left':'right'}-crank-spindle`;spindle.position.set(side*R.pedalX,side*R.crankRadius,0);crank.add(spindle);
    const platform=new Group();platform.name=`bicycle-${side===-1?'left':'right'}-pedal`;lean.add(platform);pedals.push({side,group:platform});
    box(platform,0,0,0,.16,R.pedalThickness,.105,1);
    for(const z of [-.036,.036])box(platform,0,0,z,.135,R.pedalThickness+.004,.008,2);
    box(platform,side*.081,0,0,.009,.014,.07,3);
    const top=new Object3D();top.name=`bicycle-${side===-1?'left':'right'}-pedal-top`;top.position.y=R.pedalTop;platform.add(top);
  }
  const ringGeometry=new TorusGeometry(.095,.008,6,24);ringGeometry.rotateY(Math.PI/2);geometries.push(ringGeometry);const chainring=new Mesh(ringGeometry,materials[2]);chainring.position.x=.065;crank.add(chainring);
  for(let i=0;i<5;i++){const angle=i*Math.PI*2/5;tube(crank,new Vector3(.065,0,0),new Vector3(.065,Math.cos(angle)*.09,Math.sin(angle)*.09),.008,2);}
  const chainPoints=[new Vector3(.075,R.crankY+.095,0),new Vector3(.075,R.wheelRadius+.045,.72)];
  for(let i=1;i<=12;i++){const angle=i*Math.PI/12;chainPoints.push(new Vector3(.075,R.wheelRadius+.045*Math.cos(angle),.72+.045*Math.sin(angle)));}
  chainPoints.push(new Vector3(.075,R.crankY-.095,0));
  for(let i=1;i<12;i++){const angle=Math.PI+i*Math.PI/12;chainPoints.push(new Vector3(.075,R.crankY+.095*Math.cos(angle),.095*Math.sin(angle)));}
  const chainGeometry=new TubeGeometry(new CatmullRomCurve3(chainPoints,true),64,.004,4,true);geometries.push(chainGeometry);const chain=new Mesh(chainGeometry,materials[1]);chain.name='bicycle-chain';frame.add(chain);
  box(lean,0,1.09,-.6,.09,.08,.07,3);box(lean,0,.66,.83,.09,.06,.035,0);

  const standPivot=new Vector3().copy(R.standPivot),foldedDirection=new Vector3(-.055,-.042,.40).normalize(),foldedTip=standPivot.clone().addScaledVector(foldedDirection,R.standLength);
  const stand=new Group();stand.name='bicycle-kickstand';lean.add(stand);
  const hinge=new Object3D();hinge.name='bicycle-kickstand-hinge';hinge.position.copy(standPivot);stand.add(hinge);
  // The clamp is on the left chainstay, behind the cranks. The folded leg
  // runs outboard of the rear spokes rather than through the drivetrain.
  box(frame,standPivot.x,standPivot.y,standPivot.z,.075,.055,.085,1);
  const standRod=tube(stand,standPivot,foldedTip,.014,2);standRod.userData.movingPart=true;
  const standPad=box(stand,0,0,0,.09,.028,.075,1);standPad.name='bicycle-kickstand-foot';standPad.userData.movingPart=true;
  const standContact=new Object3D();standContact.name='bicycle-kickstand-ground-contact';standContact.position.y=-.5;standPad.add(standContact);
  const shadowGeometry=new PlaneGeometry(1,1).rotateX(-Math.PI/2),shadowMaterial=contactShadowMaterial();geometries.push(shadowGeometry);
  const shadows=[.72,-.76].map(z=>{const mesh=new Mesh(shadowGeometry,shadowMaterial);mesh.position.set(0,.012,z);mesh.scale.set(.22,1,.37);mesh.renderOrder=1;root.add(mesh);return mesh;});

  // Static geometry is merged per joint; the pedals, steering and stand retain
  // their own transforms. Detail need not add dozens of per-spoke draw calls.
  function batch(group:Group){
    for(const child of [...group.children])if(child instanceof Group)batch(child);
    for(const material of materials){
      const parts=group.children.filter((child):child is Mesh=>child instanceof Mesh&&child.material===material&&!child.userData.movingPart);
      if(!parts.length)continue;
      const sources=parts.map(mesh=>{mesh.updateMatrix();return(mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone()).applyMatrix4(mesh.matrix);});
      const geometry=mergeGeometries(sources,false)!;sources.forEach(g=>g.dispose());geometries.push(geometry);
      const mesh=new Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;parts.forEach(p=>p.removeFromParent());group.add(mesh);
    }
  }
  batch(lean);rider.root.visible=false;let park=1,initialized=false;
  return {
    root,
    update(dt:number,p:BicyclePose){
      if(!initialized){park=p.riding?0:1;initialized=true;}
      park+=((p.riding?0:1)-park)*(1-Math.exp(-Math.max(0,dt)*10));
      if(park<.0001)park=0;if(park>.9999)park=1;
      root.rotation.x=p.pitch;
      const bank=park*R.parkLean+(1-park)*Math.max(-.22,Math.min(.22,p.steer*p.speed*.035));
      lean.rotation.z=bank;front.quaternion.setFromAxisAngle(steeringAxis,p.steer);
      for(const wheel of wheels)wheel.rotation.x=-p.wheelAngle;
      crank.rotation.x=Math.PI-p.phase;
      for(const pedal of pedals)pedal.group.position.copy(bicyclePedal(pedal.side,p.phase));
      rider.root.visible=p.riding;if(p.riding)rider.cyclePose(dt,p.phase,p.speed,p.footDown,p.steer,bank,p.backingPhase);
      root.updateMatrixWorld(true);
      const deployed=new Vector3(R.standFootX,-R.standFootX*Math.tan(bank),R.standFootZ);
      worldPoint.copy(deployed);lean.localToWorld(worldPoint);
      const floor=p.groundAt?.(worldPoint.x,worldPoint.z);
      const pivotWorld=lean.localToWorld(standPivot.clone());
      const targetY=floor!==undefined&&floor!==null?floor+.014:worldPoint.y+.014;
      const reach=worldPoint.clone().sub(pivotWorld);reach.y=0;reach.normalize();
      const drop=pivotWorld.y-targetY,horizontal=Math.sqrt(Math.max(0,R.standLength**2-drop**2));
      worldPoint.copy(pivotWorld).addScaledVector(reach,horizontal);worldPoint.y=targetY;lean.worldToLocal(worldPoint);
      const deployedDirection=worldPoint.clone().sub(standPivot).normalize();
      rotation.setFromUnitVectors(foldedDirection,deployedDirection);
      const direction=foldedDirection.clone().applyQuaternion(new Quaternion().identity().slerp(rotation,park));
      standPad.quaternion.identity().slerp(lean.getWorldQuaternion(rotation).invert(),park);
      standPad.position.copy(standPivot).addScaledVector(direction,R.standLength);placeTube(standRod,standPivot,standPad.position,.014);
      shadows.forEach(s=>s.visible=true);
    },
    get standDeployed(){return park>.98;},
    dispose(){root.removeFromParent();rider.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();shadowMaterial.dispose();},
  };
}
