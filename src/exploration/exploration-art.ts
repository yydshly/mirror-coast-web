import {
  AdditiveBlending,BoxGeometry,CanvasTexture,Color,CylinderGeometry,DoubleSide,Group,InstancedMesh,Matrix4,
  Mesh,MeshBasicMaterial,MeshStandardMaterial,PlaneGeometry,Quaternion,Scene,SphereGeometry,Sprite,
  SRGBColorSpace,TorusGeometry,Vector3,type BufferGeometry,type Material,type Texture,
} from 'three';
import type {SceneObstacle} from '../input/scene-collisions';
import {EXPLORATION_SITES,type ExplorationSite} from '../world/exploration-sites';
import {regionalHeightAt} from '../world/region-terrain';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
import {makeBeaconBeam,makeBeaconGlow} from './beacon-light';
import {Material as VoxelMaterial} from '../world/palette';
import type {SignalTuning} from '../gameplay/coast-signals';

type SupportedDetail={group:Group;anchors:readonly Vector3Like[]};
type Device={site:ExplorationSite;group:Group;status:MeshStandardMaterial;lid?:Group;halo?:Mesh;beacon?:Group;beaconAnchor?:Vector3Like;glow?:Sprite};

/** Small interactive surfaces and landmark feedback; terrain/structures stay voxels. */
export class ExplorationArt {
  readonly obstacles:SceneObstacle[]=[];
  private root=new Group();
  private readonly cube=new BoxGeometry(1,1,1);
  private readonly geometries:BufferGeometry[]=[this.cube];
  private readonly materials:Material[]=[];
  private readonly textures:Texture[]=[];
  private readonly devices:Device[]=[];
  private readonly details:SupportedDetail[]=[];
  private readonly supportedBounds:Array<{bounds:SceneObstacle;anchors:readonly Vector3Like[]}>=[];
  private readonly plankBatches:Array<{mesh:InstancedMesh;items:Array<{anchor:Vector3Like;matrix:Matrix4}>}>=[];
  private completed=new Set<string>();
  private clock=0;
  private calibration:SignalTuning|undefined;
  private antenna:Group|undefined;private radioNeedle:Mesh|undefined;
  private readonly iron=this.material('#38515a',.52,.45);
  private readonly pale=this.material('#dbd8b8',.8);
  private readonly orange=this.material('#b85b32',.7);
  private readonly rubber=this.material('#25373a',.93);
  private readonly timber=this.material('#86704e',.88);
  private readonly rope=this.material('#ac9b76',1);
  private readonly seams=this.material('#514c3c',.98);

  constructor(scene:Scene,private world:VoxelWorld){
    this.root.name='coastal-exploration-details';scene.add(this.root);
    for(const site of EXPLORATION_SITES){
      const group=new Group();group.name=`exploration-device-${site.id}`;this.root.add(group);
      const status=this.material('#c57c42',.3,.25);status.emissive=new Color('#c57c42');
      const device:Device={site,group,status};this.devices.push(device);
      if(site.id==='forest-radio')this.radio(device);
      else if(site.id==='tidal-rescue')this.rescue(device);
      else this.signal(device);
    }
    this.sign(-83.7,-237.3,'松林电台 / RADIO','沿木阶登上瞭望台  ↑',.7);
    this.sign(662,151,'潮汐救援点 / RESCUE','沿栈道寻找防水救援箱  ↑',-.25);
    this.sign(-177,108,'西岬旧航标 / SIGNAL','海侧木阶下行  ↓',.25);
    this.stairRails();this.boardwalkRails();this.plankSeams();this.sync([]);this.update(0,0);
  }

  setCompleted(ids:Iterable<string>):void{this.completed=new Set(ids);this.update(0,0);}
  setCalibration(tuning:SignalTuning|undefined):void{this.calibration=tuning;}

  sync(_dirtyKeys:Iterable<string>):void{
    const supported=(anchors:readonly Vector3Like[])=>anchors.every(p=>this.world.getVoxel(p.x,p.y,p.z)!==0);
    for(const device of this.devices){
      device.group.visible=supported(device.site.anchors);
      if(device.beacon&&device.beaconAnchor)device.beacon.visible=supported([device.beaconAnchor]);
    }
    for(const detail of this.details)detail.group.visible=supported(detail.anchors);
    const hidden=new Matrix4().makeScale(0,0,0);
    for(const batch of this.plankBatches){
      batch.items.forEach((item,index)=>batch.mesh.setMatrixAt(index,supported([item.anchor])?item.matrix:hidden));
      batch.mesh.instanceMatrix.needsUpdate=true;
    }
    this.obstacles.length=0;
    this.obstacles.push(...this.supportedBounds.filter(detail=>supported(detail.anchors)).map(detail=>detail.bounds));
  }

  update(dt:number,night=0):void{
    this.clock+=Math.max(0,Math.min(.1,dt));
    for(const device of this.devices){
      const calibrating=this.calibration?.site===device.site.id;
      const active=this.completed.has(device.site.id)||calibrating;
      device.status.color.set(active?'#88c2a6':'#c57c42');device.status.emissive.copy(device.status.color);
      device.status.emissiveIntensity=active?.55+night*2.2:.10+night*.18;
      if(device.lid){const target=active?1.35:0;device.lid.rotation.x+=(target-device.lid.rotation.x)*(dt?1-Math.exp(-dt*4):1);}
      if(device.halo){
        device.halo.visible=active&&device.group.visible&&!!device.beacon?.visible;
        const phase=(this.clock*.42)%1;device.halo.scale.setScalar(1+phase*.9);
        (device.halo.material as MeshBasicMaterial).opacity=(1-phase)*(.14+night*.20);
      }
      if(device.beacon){
        const lamp=device.beacon.userData.lamp as Mesh;
        lamp.visible=active&&device.group.visible;
        const beam=device.beacon.userData.beam as Group|undefined;
        if(beam){beam.visible=active&&device.group.visible;
          const locked=device.site.id==='cape-signal'&&this.completed.has('cape-signal');
          beam.rotation.order='YXZ';beam.rotation.y=calibrating?Math.PI/2-this.calibration!.bearing*Math.PI/50:locked?Math.PI/2-57*Math.PI/50:this.clock*.42;
          beam.rotation.z=calibrating||locked?-.285:0;beam.scale.x=calibrating||locked?5:1;
          for(const mesh of beam.children)(mesh as Mesh<BufferGeometry,MeshBasicMaterial>).material.opacity=calibrating||locked?.06+night*.12:.012+night*.085;
        }
        if(device.glow){device.glow.visible=active&&device.group.visible;device.glow.material.opacity=.18+night*.55;}
      }
    }
    if(this.antenna)this.antenna.rotation.y=this.calibration?.site==='forest-radio'?this.calibration.bearing*Math.PI/50:38*Math.PI/50;
    if(this.radioNeedle)this.radioNeedle.rotation.x=(this.calibration?.site==='forest-radio'?this.calibration.strength: Number(this.completed.has('forest-radio')))*1.2-.6;
  }

  dispose():void{
    for(const batch of this.plankBatches)batch.mesh.dispose();
    this.root.removeFromParent();for(const geometry of this.geometries)geometry.dispose();
    for(const material of this.materials)material.dispose();for(const texture of this.textures)texture.dispose();
  }

  private material(color:string,roughness=.8,metalness=0):MeshStandardMaterial{
    const material=new MeshStandardMaterial({color,roughness,metalness});this.materials.push(material);return material;
  }
  private box(parent:Group,material:Material,x:number,y:number,z:number,sx:number,sy:number,sz:number):Mesh{
    const mesh=new Mesh(this.cube,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  private bar(parent:Group,a:Vector3Like,b:Vector3Like,thickness:number,material:Material):void{
    const delta=new Vector3(b.x-a.x,b.y-a.y,b.z-a.z),length=delta.length();
    const mesh=this.box(parent,material,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,thickness,length,thickness);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));
  }
  private sphere(parent:Group,material:Material,x:number,y:number,z:number,radius:number):Mesh{
    const geometry=new SphereGeometry(radius,10,7);this.geometries.push(geometry);
    const mesh=new Mesh(geometry,material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
  }
  private panelLabel(parent:Group,text:string,x:number,y:number,z:number,width:number,height:number,yaw=0):void{
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;
    const context=canvas.getContext('2d');if(!context)return;
    context.fillStyle='#203c43';context.fillRect(0,0,768,192);context.fillStyle='#ebe1bd';
    context.textAlign='center';context.textBaseline='middle';context.font='600 54px "Microsoft YaHei",sans-serif';context.fillText(text,384,96,710);
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;this.textures.push(texture);
    const material=new MeshStandardMaterial({map:texture,emissiveMap:texture,emissive:'#80928d',emissiveIntensity:.12,roughness:.8,side:DoubleSide});this.materials.push(material);
    const geometry=new PlaneGeometry(width,height);this.geometries.push(geometry);
    const mesh=new Mesh(geometry,material);mesh.position.set(x,y,z);mesh.rotation.y=yaw;parent.add(mesh);
  }

  private radio(device:Device):void{
    const p=device.site.position,g=device.group;
    this.supportedBounds.push({anchors:device.site.anchors,bounds:{minX:p.x-.025,maxX:p.x+.225,minY:p.y-.28,maxY:p.y+.28,minZ:p.z-.37,maxZ:p.z+.37,standable:false}});
    this.box(g,this.iron,p.x+.10,p.y,p.z,.25,.56,.74);
    this.box(g,device.status,p.x-.035,p.y+.07,p.z-.18,.025,.12,.25);
    for(const z of [p.z-.15,p.z+.16])this.box(g,this.rubber,p.x-.046,p.y-.13,z,.035,.11,.10);
    this.panelLabel(g,'COAST RADIO · 05',p.x-.14,p.y+.40,p.z,.85,.20,-Math.PI/2);
    this.box(g,this.rubber,p.x-.04,p.y+.03,p.z+.17,.025,.25,.30);
    for(let i=0;i<4;i++)this.box(g,this.iron,p.x-.057,p.y-.055+i*.055,p.z+.17,.012,.012,.25);
    this.bar(g,{x:p.x+.12,y:p.y+.24,z:p.z+.30},{x:p.x+.12,y:p.y+1.10,z:p.z+.30},.022,this.rubber);
    const receiverGeometry=new TorusGeometry(.11,.022,5,12);this.geometries.push(receiverGeometry);
    const receiver=new Mesh(receiverGeometry,this.rubber);receiver.position.set(p.x-.056,p.y-.26,p.z+.17);receiver.rotation.y=Math.PI/2;g.add(receiver);
    const battery=new Group();battery.name='radio-field-battery';this.root.add(battery);
    const batteryAnchors=[{x:-64,y:65,z:-226}];this.details.push({group:battery,anchors:batteryAnchors});
    this.box(battery,this.rubber,-63.55,66.19,-225.6,.48,.38,.58);
    this.box(battery,this.orange,-63.55,66.20,-225.905,.30,.11,.015);
    this.bar(battery,{x:-63.72,y:66.43,z:-225.6},{x:-63.38,y:66.43,z:-225.6},.045,this.iron);
    this.supportedBounds.push({anchors:batteryAnchors,bounds:{minX:-63.79,maxX:-63.31,minY:66,maxY:66.46,minZ:-225.91,maxZ:-225.31}});
    const board=new Group();board.name='radio-coast-chart';this.root.add(board);this.details.push({group:board,anchors:[{x:-65,y:66,z:-221}]});
    this.box(board,this.timber,-64.6,67.38,-221.04,1.25,.72,.07);
    this.panelLabel(board,'COAST WATCH · 05',-64.6,67.38,-221.085,1.12,.57,Math.PI);
    const beacon=new Group();this.root.add(beacon);device.beacon=beacon;device.beaconAnchor={x:-63,y:79,z:-222};
    const glow=new MeshBasicMaterial({color:'#8ee0bc',transparent:true,opacity:.9});this.materials.push(glow);
    const lamp=this.sphere(beacon,glow,-62.5,80.15,-221.5,.26);beacon.userData.lamp=lamp;
    lamp.name='radio-signal-indicator';
    const antenna=new Group();antenna.position.set(-63.5,77,-221.5);beacon.add(antenna);this.antenna=antenna;
    this.bar(antenna,{x:-1.5,y:0,z:0},{x:1.5,y:0,z:0},.05,this.iron);
    for(const x of [-1.2,0,1.2])this.bar(antenna,{x,y:0,z:-.7},{x,y:0,z:.7},.045,this.iron);
    const meter=new Group();meter.position.set(p.x-.08,p.y+.1,p.z-.17);g.add(meter);
    this.radioNeedle=this.box(meter,this.pale,0,.03,0,.015,.025,.18);
    const geometry=new TorusGeometry(1.15,.025,5,28);this.geometries.push(geometry);
    const waveMaterial=new MeshBasicMaterial({color:'#93d6be',transparent:true,opacity:.2,depthWrite:false,blending:AdditiveBlending});this.materials.push(waveMaterial);
    const wave=new Mesh(geometry,waveMaterial);wave.rotation.x=-Math.PI/2;wave.position.set(-62.5,80.15,-221.5);this.root.add(wave);device.halo=wave;
  }

  private rescue(device:Device):void{
    const g=device.group,x=657.5,z=186.5;
    // An openable hollow case: its log sits below the rim rather than on a solid cube.
    this.box(g,this.orange,x,15.06,z,1.12,.10,.72);
    for(const side of [-1,1]){
      this.box(g,this.orange,x+side*.51,15.40,z,.10,.58,.72);
      this.box(g,this.orange,x,15.40,z+side*.31,.92,.58,.10);
    }
    this.box(g,this.pale,x,15.14,z,.65,.05,.35);
    this.box(g,this.iron,x,15.171,z-.04,.55,.012,.08);
    for(const sx of [-.4,.4])this.box(g,this.pale,x+sx,15.35,z-.375,.06,.65,.035);
    this.box(g,device.status,x,15.40,z-.386,.28,.14,.035);
    const lid=new Group();lid.position.set(x,15.74,z+.34);g.add(lid);device.lid=lid;
    lid.name='rescue-box-lid';
    this.box(lid,this.pale,0,0,-.32,1.18,.13,.76);
    for(const side of [-1,1])this.box(g,this.iron,x+side*.36,15.73,z+.35,.13,.10,.08);
    this.panelLabel(g,'RESCUE LOG',x,15.34,z-.395,.67,.14);
    this.supportedBounds.push({anchors:device.site.anchors,bounds:{minX:x-.58,maxX:x+.58,minY:15,maxY:15.85,minZ:z-.40,maxZ:z+.40}});
    // A life ring and fallen boom identify the salvage route from the beach.
    const ringGeometry=new TorusGeometry(.43,.11,7,18);this.geometries.push(ringGeometry);
    const ring=new Mesh(ringGeometry,this.orange);ring.position.set(664.94,16.05,183.5);ring.rotation.y=-Math.PI/2;this.root.add(ring);
    const ringGroup=new Group();ringGroup.add(ring);this.root.add(ringGroup);this.details.push({group:ringGroup,anchors:[{x:665,y:15,z:183}]});
    for(let i=0;i<4;i++){
      const angle=i*Math.PI/2;
      const band=this.box(ringGroup,this.pale,664.93,16.05+Math.cos(angle)*.43,183.5+Math.sin(angle)*.43,.24,.18,.24);band.rotation.x=-angle;
    }
    this.bar(g,{x:660.2,y:15.2,z:184},{x:662.2,y:15.2,z:186.5},.11,this.timber);
    const deck=new Group();deck.name='rescue-mooring-gear';this.root.add(deck);const anchors=[{x:661,y:14,z:186}];this.details.push({group:deck,anchors});
    const coilGeometry=new TorusGeometry(.38,.032,5,20);this.geometries.push(coilGeometry);
    for(let i=0;i<3;i++){const coil=new Mesh(coilGeometry,this.rope);coil.rotation.x=Math.PI/2;coil.scale.setScalar(1-i*.18);coil.position.set(661.3,15.04+i*.045,186.9);deck.add(coil);}
    this.box(deck,this.iron,661.4,15.07,185.5,.60,.10,.23);
    this.box(deck,this.iron,661.4,15.22,185.5,.08,.26,.08);
    this.box(deck,this.iron,661.4,15.34,185.5,.52,.08,.10);
    this.supportedBounds.push({anchors,bounds:{minX:661.08,maxX:661.72,minY:15,maxY:15.39,minZ:185.35,maxZ:185.65}});
  }

  private signal(device:Device):void{
    const p=device.site.position,g=device.group;
    this.supportedBounds.push({anchors:device.site.anchors,bounds:{minX:p.x-.04,maxX:p.x+.20,minY:p.y-.31,maxY:p.y+.31,minZ:p.z-.325,maxZ:p.z+.325,standable:false}});
    this.box(g,this.iron,p.x+.08,p.y,p.z,.24,.62,.65);
    this.box(g,device.status,p.x-.05,p.y+.08,p.z,.035,.16,.40);
    this.box(g,this.rubber,p.x-.07,p.y-.17,p.z,.06,.12,.12);
    this.panelLabel(g,'CAPE SIGNAL',p.x-.13,p.y+.45,p.z,1.05,.20,-Math.PI/2);
    this.box(g,this.rubber,p.x-.05,p.y-.11,p.z+.22,.023,.16,.16);
    for(let i=0;i<3;i++)this.box(g,this.pale,p.x-.067,p.y-.16+i*.05,p.z+.22,.014,.014,.11);
    const beacon=new Group();this.root.add(beacon);device.beacon=beacon;device.beaconAnchor={x:-184,y:36,z:124};
    const glow=new MeshBasicMaterial({color:'#f8d88e'});this.materials.push(glow);
    const lamp=this.sphere(beacon,glow,-183.5,37.35,124.5,.48);beacon.userData.lamp=lamp;
    lamp.name='cape-signal-lamp';
    const capGeometry=new CylinderGeometry(.78,.85,.13,8);this.geometries.push(capGeometry);
    for(const y of [36.85,38.02]){const cap=new Mesh(capGeometry,this.iron);cap.position.set(-183.5,y,124.5);cap.castShadow=true;beacon.add(cap);}
    for(const dx of [-.55,.55])for(const dz of [-.55,.55])this.box(beacon,this.iron,-183.5+dx,37.43,124.5+dz,.045,1.12,.045);
    const soft=makeBeaconGlow();this.textures.push(soft.texture);this.materials.push(soft.material);
    const halo=new Sprite(soft.material);halo.name='cape-lens-glow';halo.position.copy(lamp.position);halo.scale.set(2.6,2.6,1);beacon.add(halo);device.glow=halo;
    const beam=new Group();beam.position.set(-183.5,37.35,124.5);beacon.add(beam);beacon.userData.beam=beam;
    beam.name='cape-signal-beams';const softBeam=makeBeaconBeam();this.geometries.push(softBeam.geometry);this.materials.push(softBeam.material);this.textures.push(softBeam.texture);
    for(const yaw of [0,Math.PI])for(let i=0;i<3;i++){
      const sheet=new Mesh(softBeam.geometry,softBeam.material);sheet.rotation.set(i*Math.PI/3,yaw,0,'YXZ');sheet.name='cape-tapered-light-sheet';beam.add(sheet);
    }
  }

  private sign(x:number,z:number,title:string,subtitle:string,yaw:number):void{
    const h=regionalHeightAt(x,z),anchors=[{x:Math.floor(x),y:h,z:Math.floor(z)}];
    const group=new Group();this.root.add(group);this.details.push({group,anchors});
    const y=h+1;this.box(group,this.iron,x,y+1.2,z,.10,2.4,.10);
    const board=this.box(group,this.iron,x,y+2.3,z,3.6,1.1,.12);board.rotation.y=yaw;
    const dx=Math.sin(yaw)*.073,dz=Math.cos(yaw)*.073;
    this.panelLabel(group,title,x+dx,y+2.49,z+dz,3.4,.37,yaw);
    this.panelLabel(group,subtitle,x+dx,y+2.08,z+dz,3.4,.29,yaw);
    this.supportedBounds.push({anchors,bounds:{minX:x-.08,maxX:x+.08,minY:y,maxY:y+2.4,minZ:z-.08,maxZ:z+.08}});
  }

  private stairRails():void{
    for(let x=-85;x<=-70;x+=3)for(const z of [-226.07,-222.93]){
      const top=x+133,anchor={x,y:top,z:z< -224? -226:-224};
      const group=new Group();this.root.add(group);this.details.push({group,anchors:[anchor]});
      this.box(group,this.iron,x+.5,top+1.56,z,.07,1.12,.07);
      this.supportedBounds.push({anchors:[anchor],bounds:{minX:x+.45,maxX:x+.55,minY:top+1,maxY:top+2.12,minZ:z-.05,maxZ:z+.05}});
      if(x<-72){
        this.bar(group,{x:x+.5,y:top+2.10,z},{x:x+3.5,y:top+5.10,z},.07,this.iron);
        this.supportedBounds.push({anchors:[anchor],bounds:{minX:x+.45,maxX:x+3.55,minY:top+2.05,maxY:top+5.15,minZ:z-.05,maxZ:z+.05}});
      }
    }
  }

  private plankSeams():void{
    const items:Array<{anchor:Vector3Like;matrix:Matrix4}>=[];
    const line=(x:number,y:number,z:number,sx:number,sz:number,anchor:Vector3Like)=>{
      const matrix=new Matrix4().makeScale(sx,.008,sz);matrix.setPosition(x,y,z);items.push({matrix,anchor});
    };
    for(let z=150;z<=188;z++)line(657.5,15.006,z+.08,2.72,.018,{x:657,y:14,z});
    for(let z=-226;z<=-222;z++)line(-64.5,66.006,z+.08,6.72,.018,{x:-65,y:65,z});
    const mesh=new InstancedMesh(this.cube,this.seams,items.length);mesh.name='exploration-board-plank-seams';mesh.receiveShadow=true;mesh.frustumCulled=false;this.root.add(mesh);this.plankBatches.push({mesh,items});
  }
  private boardwalkRails():void{
    const edits:Array<{x:number;y:number;z:number;material:number}>=[];
    for(let z=164;z<=188;z+=4){
      const complete=[655,656,658,659].every(x=>this.world.getVoxel(x,15,z)===VoxelMaterial.Trim);
      for(const x of [655,656,658,659])if(this.world.getVoxel(x,15,z)===VoxelMaterial.Trim)edits.push({x,y:15,z,material:0});
      if(!complete)continue;
      for(const x of [656.08,658.92]){
        const anchor={x:x<657?656:658,y:14,z},group=new Group();this.root.add(group);this.details.push({group,anchors:[anchor]});
        this.box(group,this.timber,x,15.55,z+.2,.10,1.1,.10);
        this.supportedBounds.push({anchors:[anchor],bounds:{minX:x-.06,maxX:x+.06,minY:15,maxY:16.1,minZ:z+.14,maxZ:z+.26,standable:false}});
        if(z<188){const next={x:anchor.x,y:14,z:z+4};
          const span=new Group();this.root.add(span);this.details.push({group:span,anchors:[anchor,next]});
          for(const y of [15.55,16.04])this.bar(span,{x,y,z:z+.2},{x,y:y-.08,z:z+4.2},.045,this.rope);
          this.supportedBounds.push({anchors:[anchor,next],bounds:{minX:x-.05,maxX:x+.05,minY:15,maxY:16.1,minZ:z+.2,maxZ:z+4.2,standable:false}});
        }
      }
    }
    this.world.applyEdits(edits);
  }
}
