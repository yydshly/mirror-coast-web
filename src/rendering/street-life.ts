import { BoxGeometry, Color, CylinderGeometry, DoubleSide, Euler, Group, InstancedMesh, Matrix4, MeshStandardMaterial,PlaneGeometry, Quaternion, Scene, Vector3, type BufferGeometry } from 'three';
import type { SceneObstacle } from '../input/scene-collisions';
import { SIGNALS, StreetLifeSimulation, signalAnchor, signalPhase, type LifeContext, type LifePerson,type PedestrianSurface } from '../simulation/street-life-sim';
import type { VoxelWorld } from '../world/voxel';
import {carTyreGeometry,carCabinGeometry,carWindscreenGeometry} from '../vehicles/urban-car-geometry';
import {surfaceFinish} from './surface-finish';
import {contactShadowMaterial} from '../vehicles/contact-shadow';
import {humanBox} from './human-geometry';
import {createBusInterior} from '../vehicles/bus-interior';
import {createTrafficBody,createTrafficInterior,createTrafficSteeringWheel,TRAFFIC_CABIN_RIG} from '../vehicles/traffic-interior';

type Batch={mesh:InstancedMesh;material:MeshStandardMaterial;cursor:number;capacity:number};
type PersonMotion={stride:number;swing:number;yaw:number;x:number;z:number};
const CAR_COLORS=['#b8a17b','#466f78','#ab5747','#c8c3ac','#586c57','#d4b556','#536d86','#a8b9b2'];
const COATS=['#536e77','#a77d50','#5c705d','#8e5147','#b0aaa0','#484f67','#8f8760','#52767b'];
const SKINS=['#c49a77','#9b6e51','#d4af8d','#785541'];
const TROUSERS=['#354347','#4e5660','#635c50','#384a58','#5c5351'];
const HAIR=['#3d342e','#65513d','#958f7b','#292f33'];
const TRIMS=['#b6b7a4','#d0b879','#acc4bc','#c5a896'];

/** Shared meshes keep thirty-two jointed people and eighteen moving vehicles inexpensive. */
export class StreetLife{
  readonly simulation:StreetLifeSimulation;
  readonly obstacles:SceneObstacle[];
  readonly pedestrianObstacles:SceneObstacle[];
  readonly signalObstacles:SceneObstacle[]=[];
  private root=new Group();
  private box=new BoxGeometry(1,1,1);
  private umbrella=new CylinderGeometry(0,.66,.23,8);
  private tyre=carTyreGeometry();private hub=carTyreGeometry(.17,.235);
  private cabin=carCabinGeometry(true);private windscreen=carWindscreenGeometry();private driverWheel=createTrafficSteeringWheel();
  private windowPane=new PlaneGeometry(1,1);private sidePane=new PlaneGeometry(1,1).rotateY(Math.PI/2);
  private trafficInteriors=[...createTrafficInterior('sedan'),...createTrafficInterior('van')];
  private trafficBodies={sedan:createTrafficBody('sedan'),van:createTrafficBody('van')};
  private busParts=createBusInterior();
  private contactPlane=new PlaneGeometry(1,1).rotateX(-Math.PI/2);
  private clothShape=humanBox(.14,.91,1);private skinShape=humanBox(.17,.86,1);private hairShape=humanBox(.17);private trouserShape=humanBox(.12,.88,1);private shoeShape=humanBox(.15);
  private batches=new Map<string,Batch>();
  private matrix=new Matrix4();private rotation=new Quaternion();private euler=new Euler(0,0,0,'YXZ');private position=new Vector3();private scale=new Vector3();private color=new Color();
  private peopleMotion:PersonMotion[]=[];
  private physicalCarRotation:Quaternion|null=null;
  private scenery:readonly SceneObstacle[]|undefined;
  private sceneryRevision:number|undefined;
  private simulationScenery:SceneObstacle[]=[];
  readonly renderedPeople:LifePerson[]=[];
  constructor(scene:Scene,private world:VoxelWorld,options:{surfaceAt?:PedestrianSurface;removedTraffic?:readonly number[]}={}){
    this.root.name='living-streets';scene.add(this.root);this.simulation=new StreetLifeSimulation(world,options);
    this.peopleMotion=this.simulation.people.map(p=>({stride:p.phase,swing:0,yaw:p.heading,x:p.position.x,z:p.position.z}));
    this.obstacles=this.simulation.obstacles;this.pedestrianObstacles=this.simulation.pedestrianObstacles;
    const n=this.simulation.cars.length,p=this.simulation.people.length;
    this.batch('car-paint',n*9,'#ffffff',.4,.15);this.batch('car-glass',n*2,'#183c48',.18,.35,undefined,this.windowPane);this.batch('car-side-glass',n*2,'#183c48',.18,.35,undefined,this.sidePane);this.batch('rubber',n*7+p*4,'#1b292c',.9,0,undefined,this.shoeShape);
    this.batch('metal',n*5,'#9faaa5',.44,.65);this.batch('headlights',n*2,'#e6dcc1',.3,0,'#fff0c5');this.batch('brakes',n*2,'#993f32',.35,0,'#ff3e24');
    this.batch('car-tyres',n*4,'#19282b',.95,0,undefined,this.tyre);this.batch('car-hubs',n*4,'#a0afad',.36,.75,undefined,this.hub);
    this.batch('car-cabin',n,'#ffffff',.4,.15,undefined,this.cabin);this.batch('car-windscreen',n,'#183c48',.18,.35,undefined,this.windscreen);
    surfaceFinish(this.batches.get('car-tyres')!.material,'rubber');
    this.batch('car-contact',n,'#000000',1,0,undefined,this.contactPlane);
    const shadow=this.batches.get('car-contact')!;shadow.material.dispose();shadow.material=contactShadowMaterial();shadow.mesh.material=shadow.material;shadow.mesh.castShadow=shadow.mesh.receiveShadow=false;shadow.mesh.renderOrder=1;
    this.batch('person-contact',p*2,'#000000',1,0,undefined,this.contactPlane);
    const feet=this.batches.get('person-contact')!;feet.material.dispose();feet.material=contactShadowMaterial();feet.mesh.material=feet.material;feet.mesh.castShadow=feet.mesh.receiveShadow=false;feet.mesh.renderOrder=1;
    this.batch('coat',p*16+n*9,'#ffffff',.85,0,undefined,this.clothShape);this.batch('skin',p*7+n*4,'#ffffff',.86,0,undefined,this.skinShape);this.batch('hair',p*5+n,'#ffffff',.95,0,undefined,this.hairShape);this.batch('pants',p*4+n*5,'#ffffff',.9,0,undefined,this.trouserShape);this.batch('face',p*3+n*2,'#1c2e34',.9);
    this.batch('driver-wheel',n,'#223437',.9,0,undefined,this.driverWheel);
    for(const p of this.trafficInteriors){this.batch(p.name,n,'#ffffff',p.roughness,0,undefined,p.geometry);const b=this.batches.get(p.name)!;b.material.vertexColors=true;b.mesh.castShadow=false;if(p.name.endsWith('seats'))surfaceFinish(b.material,'fabric');}
    for(const kind of ['sedan','van'] as const)this.batch(`traffic-${kind}-body`,n,'#ffffff',.4,.15,undefined,this.trafficBodies[kind]);
    const buses=Math.max(1,this.simulation.cars.filter(c=>c.kind==='bus').length);
    for(const p of this.busParts){
      this.batch(p.name,buses,'#ffffff',p.roughness,p.metalness,p.emissive,p.geometry);
      const b=this.batches.get(p.name)!;b.material.vertexColors=true;b.mesh.castShadow=p.castShadow;
      if(p.transparent){b.material.transparent=true;b.material.opacity=p.opacity!;b.material.depthWrite=false;b.material.side=DoubleSide;b.material.forceSinglePass=true;b.mesh.renderOrder=2;}
    }
    surfaceFinish(this.batches.get('bus-seats')!.material,'fabric');
    for(const name of ['car-glass','car-side-glass','car-windscreen']){const b=this.batches.get(name)!;b.material.color.set('#a1c3c5');b.material.transparent=true;b.material.opacity=.20;b.material.depthWrite=false;b.material.metalness=0;b.material.side=DoubleSide;b.material.forceSinglePass=true;b.mesh.castShadow=false;b.mesh.renderOrder=2;}
    for(const name of ['coat','pants'])surfaceFinish(this.batches.get(name)!.material,'fabric');
    this.batch('umbrellas',p,'#ffffff',.75,0,undefined,this.umbrella);this.batch('handles',p*2,'#506365',.7,.2);
    this.batches.get('umbrellas')!.material.side=DoubleSide;
    this.batch('signal-post',SIGNALS.length*6,'#45595d',.65,.3);this.batch('signal-box',SIGNALS.length*2,'#253c43',.7);
    for(const axis of ['x','z']){this.batch(`signal-${axis}-red`,SIGNALS.length,'#d76f56',.4,0,'#ff4529');this.batch(`signal-${axis}-green`,SIGNALS.length,'#a4c6a1',.4,0,'#76ffb0');}
    for(const light of SIGNALS)this.signalObstacles.push({minX:light.x+7.1,maxX:light.x+7.3,minY:16,maxY:20.1,minZ:light.z+6.1,maxZ:light.z+6.3});
    this.update(0,{focus:{x:135,y:18,z:164},night:0,wetness:0,obstacles:[]});
  }
  get diagnostics(){return this.simulation.diagnostics;}
  update(dt:number,context:LifeContext):void{
    this.signalObstacles.forEach((b,i)=>{const a=signalAnchor(SIGNALS[i]),supported=!!this.world.getVoxel(a.x,15,a.z);b.minY=supported?16:0;b.maxY=supported?20.1:-1;});
    if(this.scenery!==context.obstacles||this.sceneryRevision!==context.obstacleRevision){this.scenery=context.obstacles;this.sceneryRevision=context.obstacleRevision;this.simulationScenery=[...context.obstacles,...this.signalObstacles];}
    this.simulation.update(dt,{...context,obstacles:this.simulationScenery});
    const delta=Math.min(.1,Math.max(0,dt));
    for(const p of this.simulation.people){
      const motion=this.peopleMotion[p.id],distance=Math.hypot(p.position.x-motion.x,p.position.z-motion.z);
      // Distance, rather than a global clock, keeps the feet in step with the actor.
      if(distance<.5)motion.stride+=distance*4.6;
      motion.x=p.position.x;motion.z=p.position.z;
      const target=p.visible?Math.min(1,p.speed/1.25):0;
      motion.swing+=(target-motion.swing)*(1-Math.exp(-delta*14));
      const turn=Math.atan2(Math.sin(p.heading-motion.yaw),Math.cos(p.heading-motion.yaw));
      motion.yaw+=turn*(1-Math.exp(-delta*12));
    }
    for(const b of this.batches.values())b.cursor=0;
    for(const car of this.simulation.cars){
      if(!car.visible||Math.hypot(car.position.x-context.focus.x,car.position.z-context.focus.z)>Math.max(260,context.focus.y*2))continue;
      const p=this.simulation.renderCar(car),yaw=p.heading,w=car.width,l=car.length,paint=CAR_COLORS[car.id%CAR_COLORS.length];
      this.physicalCarRotation=car.physicsRotation?new Quaternion().copy(car.physicsRotation):null;
      const part=(name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,color?:string)=>this.part(name,p.x,p.y,p.z,yaw,x,y,z,sx,sy,sz,0,color);
      if(!car.physicsRotation)part('car-contact',0,.012,0,w*1.14,1,l*.90);
      if(car.kind!=='bus')part(`traffic-${car.kind}-body`,0,0,0,1,1,1,paint);
      if(car.kind==='bus'){
        for(const b of this.busParts)part(b.name,0,0,0,1,1,1);
      }else if(car.kind==='van'){
        part('car-paint',0,1.39,.68,w*.96,1.23,l*.60,paint);part('car-paint',0,2.08,.10,w*.98,.11,l*.85,'#ded6bd');
        for(const side of [-1,1])part('car-paint',side*w*.46,1.45,-l*.37,.065,1.15,.065,paint);
        part('car-glass',0,1.55,-l*.37,w*.83,.90,1);for(const side of [-1,1])part('car-side-glass',side*w*.475,1.55,-1.28,.85,.90,1);
        part('car-paint',0,1.2,.5,w*.99,.12,l*.52,'#d4b26c');
      }else{
        part('car-cabin',0,1.04,.10,w*.88,.64,l*.50,paint);part('car-paint',0,1.39,.10,w*.88,.07,l*.29,'#c9c8b3');
        part('car-windscreen',0,1.04,.10,w*.88,.64,l*.50);
        part('car-glass',0,1.07,l*.208,w*.77,.28,1);
        for(const side of [-1,1])part('car-side-glass',side*w*.445,1.09,.09,l*.22,.29,1);
      }
      // Small seated silhouettes share the pedestrian batches. Parked scenery
      // remains empty; live traffic visibly has someone operating the vehicle.
      const rig=TRAFFIC_CABIN_RIG[car.kind],driverX=rig.x,headY=rig.headY,driverZ=rig.z;
      const coat=COATS[car.id%COATS.length],skin=SKINS[car.id%SKINS.length];
      part('coat',driverX,rig.hipY+.22,driverZ,.34,.42,.24,coat);
      part('coat',driverX,rig.hipY+.414,driverZ-.01,.36,.045,.25,'#a9b6a5');
      part('skin',driverX,headY-.15,driverZ,.10,.12,.10,skin);
      part('skin',driverX,headY,driverZ,.225,.235,.22,skin);part('hair',driverX,headY+.12,driverZ,.235,.07,.23,HAIR[car.id%HAIR.length]);
      const segment=(name:string,a:Vector3,b:Vector3,width:number,depth:number,color:string)=>{const d=b.clone().sub(a),m=a.clone().add(b).multiplyScalar(.5);this.part(name,p.x,p.y,p.z,yaw,m.x,m.y,m.z,width,d.length(),depth,Math.atan2(d.z,d.y),color,-Math.atan2(d.x,Math.hypot(d.y,d.z)));};
      part('pants',driverX,rig.hipY,driverZ,.30,.13,.24,'#394a50');
      for(const side of [-1,1]){
        const shoulder=new Vector3(driverX+side*.20,rig.hipY+.38,driverZ),elbow=new Vector3(driverX+side*.22,rig.hipY+.16,driverZ-.15),hand=new Vector3(driverX+side*rig.wheelRadius,rig.wheelY,rig.wheelZ+.012);
        segment('coat',shoulder,elbow,.10,.12,coat);segment('coat',elbow,hand,.095,.11,coat);
        part('skin',hand.x,hand.y,hand.z,.085,.09,.08,skin);
        part('face',driverX+side*.05,headY+.02,driverZ-.116,.015,.012,.009);
        const hip=new Vector3(driverX+side*.085,rig.hipY,driverZ-.02),knee=new Vector3(driverX+side*.095,rig.hipY,driverZ-.34),ankle=new Vector3(driverX+side*.095,rig.footY+.12,rig.footZ+.08);
        segment('pants',hip,knee,.13,.13,'#394a50');segment('pants',knee,ankle,.12,.12,'#394a50');part('rubber',ankle.x,rig.footY+.05,rig.footZ,.145,.10,.22,'#26383c');
      }
      const wheelScale=rig.wheelRadius/.17;
      this.part('driver-wheel',p.x,p.y,p.z,yaw,driverX,rig.wheelY,rig.wheelZ,wheelScale,wheelScale,wheelScale,rig.wheelPitch);
      if(car.kind!=='bus'){
        for(const interior of this.trafficInteriors)if(interior.name.startsWith(`traffic-${car.kind}-`))part(interior.name,0,0,0,1,1,1);
      }
      for(const side of [-1,1]){
        for(const end of [-.32,.32]){
          this.part('car-tyres',p.x,p.y,p.z,yaw,side*w*.48,.31,l*end,1,1,1,-car.travelled/.31);
          this.part('car-hubs',p.x,p.y,p.z,yaw,side*w*.48,.31,l*end,1,1,1,-car.travelled/.31);
        }
        part('headlights',side*w*.31,.61,-l*.504,.33,.17,.04);
        part('brakes',side*w*.34,.63,l*.504,.23,.20,.04,car.braking?'#ffffff':'#66352a');
        part('metal',side*w*.54,rig.headY-.24,rig.wheelZ-.12,.13,.16,car.kind==='bus'?.24:.20);
        part('metal',side*w*.495,rig.headY-.27,rig.wheelZ-.11,.10,.035,.035,'#35464a');
      }
      for(const end of [-1,1])part('rubber',0,.27,end*l*.50,w*.9,.12,.12);
      part('metal',0,.44,l*.509,.43,.12,.035);
    }
    this.physicalCarRotation=null;
    this.renderedPeople.length=0;
    for(const p of this.simulation.people)if(p.visible&&Math.hypot(p.position.x-context.focus.x,p.position.z-context.focus.z)<Math.max(150,context.focus.y*2)){this.physicalCarRotation=p.physical?new Quaternion().copy(p.physical.rotation):null;this.person(p,context.wetness);this.renderedPeople.push(p);}
    this.physicalCarRotation=null;
    this.signals();
    this.batches.get('headlights')!.material.emissiveIntensity=.1+context.night*2.1;
    this.batches.get('brakes')!.material.emissiveIntensity=.25+context.night*2.2;
    this.batches.get('bus-lamps')!.material.emissiveIntensity=.25+context.night*1.05;
    // A shared warm cabin fill keeps the seated silhouettes readable at night
    // without attaching shadow-casting point lights to every moving bus.
    for(const [name,color,intensity]of [['bus-cabin','#d7bb84',.24],['bus-seats','#9a9f83',.10],['bus-hardware','#b8a77d',.08]] as const){const m=this.batches.get(name)!.material;m.emissive.set(color);m.emissiveIntensity=context.night*intensity;}
    const signal=signalPhase(this.simulation.elapsed);
    for(const axis of ['x','z']){
      const green=signal===(axis==='x'?'east-west':'north-south');
      this.batches.get(`signal-${axis}-green`)!.material.emissiveIntensity=green?3.5:.02;
      this.batches.get(`signal-${axis}-red`)!.material.emissiveIntensity=green?.02:3.5;
    }
    for(const b of this.batches.values()){
      b.mesh.count=b.cursor;
      // Upload active actors only, rather than every unused capacity slot.
      b.mesh.instanceMatrix.clearUpdateRanges();
      if(b.cursor){b.mesh.instanceMatrix.addUpdateRange(0,b.cursor*16);b.mesh.instanceMatrix.needsUpdate=true;}
      if(b.mesh.instanceColor){b.mesh.instanceColor.clearUpdateRanges();if(b.cursor){b.mesh.instanceColor.addUpdateRange(0,b.cursor*3);b.mesh.instanceColor.needsUpdate=true;}}
    }
  }
  private batch(name:string,capacity:number,color:string,roughness:number,metalness=0,emissive?:string,geometry:BufferGeometry=this.box):void{
    const material=new MeshStandardMaterial({color,roughness,metalness,emissive:emissive??'#000000',emissiveIntensity:.1});
    const mesh=new InstancedMesh(geometry,material,capacity);mesh.name=`street-life-${name}`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;this.root.add(mesh);this.batches.set(name,{mesh,material,cursor:0,capacity});
  }
  private part(name:string,x:number,y:number,z:number,yaw:number,lx:number,ly:number,lz:number,sx:number,sy:number,sz:number,pitch=0,color?:string,roll=0):void{
    const b=this.batches.get(name)!;if(b.cursor>=b.capacity)throw new Error(`Street life batch exceeded: ${name}`);
    const c=Math.cos(yaw),s=Math.sin(yaw);this.position.set(x+c*lx+s*lz,y+ly,z-s*lx+c*lz);
    this.rotation.setFromEuler(this.euler.set(pitch,yaw,roll,'YXZ'));
    if(this.physicalCarRotation){this.position.set(lx,ly,lz).applyQuaternion(this.physicalCarRotation).add({x,y,z});this.rotation.setFromEuler(this.euler.set(pitch,0,roll)).premultiply(this.physicalCarRotation);}
    this.matrix.compose(this.position,this.rotation,this.scale.set(sx,sy,sz));b.mesh.setMatrixAt(b.cursor,this.matrix);
    if(color)b.mesh.setColorAt(b.cursor,this.color.set(color));b.cursor++;
  }
  private person(p:LifePerson,wetness:number):void{
    const {x,y,z}=p.position,motion=this.peopleMotion[p.id],{swing,stride,yaw}=motion;
    const coat=COATS[p.id%COATS.length],skin=SKINS[p.id%SKINS.length],trim=TRIMS[p.id%TRIMS.length],pants=TROUSERS[p.id%TROUSERS.length];
    const style=p.id%4,build=[.965,1,.985,1.01][p.id%4],width=[.385,.405,.42,.415][style],shoulder=width/2+.036;
    const rain=wetness>.15&&p.id%5!==0&&!p.physical;
    const legs=[0,1].map(i=>{
      const phase=stride+i*Math.PI,fall=p.physical?.kind==='fall',hip=fall?.45:Math.sin(phase)*.37*swing,knee=fall?-.85:-.025-Math.max(0,Math.cos(phase))*.63*swing;
      const kneeY=.87-.37*Math.cos(hip),kneeZ=-.37*Math.sin(hip);
      return {hip,knee,kneeY,kneeZ,ankleY:kneeY-.36*Math.cos(hip+knee),ankleZ:kneeZ-.36*Math.sin(hip+knee)};
    });
    const lift=p.physical?0:.14-Math.min(...legs.map(leg=>leg.ankleY));
    const part=(name:string,lx:number,ly:number,lz:number,sx:number,sy:number,sz:number,pitch=0,color?:string)=>this.part(name,x,y,z,yaw,lx*build,(ly+lift)*build,lz*build,sx*build,sy*build,sz*build,pitch,color);
    // Four cuts change the silhouette as well as the colour: field jacket, coat,
    // hoodie and harbour workwear. All use the same instanced material batches.
    part('coat',0,style===1?1.08:1.13,0,width,style===1?.59:.49,.255,0,coat);
    part('coat',0,.87,.004,width*.94,.13,.26,0,coat);
    part('coat',0,1.365,0,width+.014,.07,.26,0,style===3?trim:coat);
    part('coat',0,1.115,-.133,.014,.43,.013,0,trim);
    part('coat',0,1.416,.04,.18,.075,.15,0,coat);
    if(style===2){
      part('coat',0,1.447,.10,.235,.10,.105,0,coat);
      part('coat',0,.99,-.144,.23,.105,.035,0,COATS[(p.id+1)%COATS.length]);
    }else{
      for(const side of [-1,1])part('coat',side*.102,1.035,-.139,.105,.075,.025,0,trim);
    }
    if(style===1)part('coat',0,.975,-.005,width+.006,.032,.272,0,trim);
    if(style===3)for(const side of [-1,1])part('coat',side*.122,1.20,-.139,.042,.33,.02,0,'#d9c888');
    if(p.id%3===0){
      part('coat',0,1.15,.193,.255,.31,.13,0,TRIMS[(p.id+1)%TRIMS.length]);
      for(const side of [-1,1])part('coat',side*.125,1.21,-.143,.025,.35,.018,0,'#334851');
    }
    part('skin',0,1.463,0,.115,.08,.11,0,skin);
    const headWidth=style===2?.232:.24;
    part('skin',0,1.606,-.006,headWidth,.245,.228,0,skin);
    for(const side of [-1,1]){
      part('skin',side*(headWidth/2+.007),1.594,.006,.023,.049,.038,0,skin);
      part('face',side*.054,1.628,-.126,.016,.013,.011);
    }
    part('skin',0,1.596,-.128,.035,.035,.025,0,skin);
    part('face',0,1.548,-.126,.041,.008,.01);
    const hair=HAIR[Math.floor(p.id/4)%HAIR.length];
    part('hair',0,1.731,0,headWidth+.009,.041,.235,0,style===3?trim:hair);
    part('hair',0,1.671,.104,headWidth+.01,style===1?.17:.095,.033,0,hair);
    if(style===3)part('hair',0,1.716,-.143,.25,.018,.091,0,trim);
    else if(style===1)for(const side of [-1,1])part('hair',side*.115,1.64,.063,.026,.17,.13,0,hair);
    else part('hair',-.077,1.702,-.084,.075,.064,.063,0,hair);
    for(let i=0;i<2;i++){
      const side=i?1:-1,leg=legs[i],{hip,knee,kneeY,kneeZ,ankleY,ankleZ}=leg;
      part('pants',side*.097,.87-.185*Math.cos(hip),-.185*Math.sin(hip),.151,.37,.19,hip,pants);
      part('pants',side*.097,kneeY-.18*Math.cos(hip+knee),kneeZ-.18*Math.sin(hip+knee),.14,.36,.17,hip+knee,pants);
      // Counter-rotated soles stay level; the swing knee supplies toe clearance.
      part('rubber',side*.097,ankleY-.063,ankleZ-.035,.17,.123,.275);
      part('rubber',side*.097,ankleY-.1325,ankleZ-.04,.18,.015,.29);
      const contact=Math.max(0,1-(ankleY+lift-.14)*build/.15);
      if(contact>.01&&!p.physical)this.part('person-contact',x,y,z,yaw,side*.097,.012,ankleZ-.04,.29*contact,1,.35*contact);
      const arm=p.physical?(p.physical.kind==='fall'?.9:.45):-hip*.68,elbow=arm+.12;
      let elbowY=1.365-.26*Math.cos(arm),elbowZ=-.26*Math.sin(arm);
      let handY=elbowY-.25*Math.cos(elbow),handZ=elbowZ-.25*Math.sin(elbow),upperPitch=arm,lowerPitch=elbow;
      if(rain&&side===1){
        // Closed fist around the actual shaft. A bent elbow connects it to the
        // shoulder, rather than leaving a free-swinging hand below a floating prop.
        handY=1.25;handZ=-.18;
        const dy=handY-1.365,dz=handZ,d=Math.hypot(dy,dz),along=(.26*.26-.25*.25+d*d)/(2*d),bend=Math.sqrt(.26*.26-along*along);
        elbowY=1.365+dy/d*along+dz/d*bend;elbowZ=dz/d*along-dy/d*bend;
        upperPitch=Math.atan2(-elbowZ,1.365-elbowY);lowerPitch=Math.atan2(elbowZ-handZ,elbowY-handY);
      }
      part('coat',side*shoulder,(1.365+elbowY)/2,elbowZ/2,.115,.26,.16,upperPitch,coat);
      part('coat',side*shoulder,(elbowY+handY)/2,(elbowZ+handZ)/2,.104,.25,.143,lowerPitch,coat);
      part('skin',side*shoulder,handY,handZ,.094,.10,.105,rain&&side===1?0:lowerPitch,skin);
    }
    if(rain){
      part('umbrellas',shoulder,1.98,-.18,1,1,1,0,COATS[(p.id+3)%COATS.length]);
      part('handles',shoulder,1.585,-.18,.023,.79,.023);
      part('handles',shoulder-.029,1.19,-.18,.08,.023,.026);
    }
  }
  private signals():void{
    for(const light of SIGNALS){
      const a=signalAnchor(light);if(!this.world.getVoxel(a.x,15,a.z))continue;
      const x=light.x+7.2,z=light.z+6.2;
      this.part('signal-post',x,16,z,0,0,1.95,0,.10,3.9,.10);
      for(const axis of ['x','z']){
        const yaw=axis==='x'?-Math.PI/2:0;
        this.part('signal-box',x,16,z,yaw,0,3.25,-.13,.24,.73,.18);
        this.part(`signal-${axis}-red`,x,16,z,yaw,0,3.43,-.231,.12,.12,.025);
        this.part(`signal-${axis}-green`,x,16,z,yaw,0,3.08,-.231,.12,.12,.025);
      }
    }
  }
  dispose():void{this.root.removeFromParent();this.box.dispose();this.umbrella.dispose();[this.tyre,this.hub,this.cabin,this.windscreen,this.driverWheel,this.windowPane,this.sidePane,...Object.values(this.trafficBodies),this.contactPlane,this.clothShape,this.skinShape,this.hairShape,this.trouserShape,this.shoeShape].forEach(g=>g.dispose());for(const p of [...this.busParts,...this.trafficInteriors])p.geometry.dispose();for(const b of this.batches.values())b.material.dispose();}
}
