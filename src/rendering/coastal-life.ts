import {
  BoxGeometry, Color, DataTexture, DoubleSide, Euler, Group, InstancedMesh,
  LinearFilter, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion,
  RGBAFormat, Scene, Vector3, type BufferGeometry,
} from 'three';
import type {Vector3Like, VoxelWorld} from '../world/voxel';

export const COASTAL_WATER_LEVEL=12;
export const COASTAL_BOAT_ROUTES=[
  {x:158,z:312,rx:82,rz:27,phase:1.1,rate:.0115,color:'#627f7d'},
  {x:580,z:267,rx:70,rz:22,phase:-.45,rate:-.0125,color:'#a36850'},
  {x:-126,z:255,rx:46,rz:20,phase:2.4,rate:.014,color:'#7d858c'},
] as const;
export type CoastalBoatRoute=typeof COASTAL_BOAT_ROUTES[number];
export type CoastalBoatPose={x:number;z:number;heading:number};

/** Closed curves have no endpoint turns, warps or reverse jumps. */
export function coastalBoatPose(route:CoastalBoatRoute,time:number):CoastalBoatPose{
  const a=route.phase+time*route.rate;
  const dx=-Math.sin(a)*route.rx*route.rate,dz=Math.cos(a)*route.rz*route.rate;
  return {x:route.x+Math.cos(a)*route.rx,z:route.z+Math.sin(a)*route.rz,heading:Math.atan2(-dx,-dz)};
}

/** Leave an eighteen metre clear-water margin, including under piers and decks. */
export function isCoastalWaterClear(world:VoxelWorld,pose:CoastalBoatPose):boolean{
  const c=Math.cos(pose.heading),s=Math.sin(pose.heading);
  for(let lx=-2;lx<=2;lx++)for(let lz=-4;lz<=4;lz++){
    const x=Math.floor(pose.x+c*lx+s*lz),z=Math.floor(pose.z-s*lx+c*lz);
    for(let y=11;y<=18;y++)if(world.getVoxel(x,y,z))return false;
  }
  for(const radius of [0,8,18])for(let i=0;i<(radius?8:1);i++){
    const a=i*Math.PI/4,x=Math.floor(pose.x+Math.cos(a)*radius),z=Math.floor(pose.z+Math.sin(a)*radius);
    if(!world.contains(x,11,z))return false;
    for(let y=11;y<=20;y++)if(world.getVoxel(x,y,z))return false;
  }
  return true;
}

type Batch={mesh:InstancedMesh;material:MeshStandardMaterial|MeshBasicMaterial;capacity:number;cursor:number};
type Boat={route:CoastalBoatRoute;time:number;pose:CoastalBoatPose;visible:boolean;moving:boolean};
const FLOCKS=[{x:77,z:281,rx:35,rz:18,y:30},{x:625,z:243,rx:35,rz:20,y:28},{x:-155,z:227,rx:29,rz:18,y:35}] as const;

/** Offshore visual life only; no voxel mutations, new save state or solid actors. */
export class CoastalLife{
  private readonly root=new Group();
  private readonly cube=new BoxGeometry(1,1,1);
  private readonly foamGeometry=new PlaneGeometry(1,1).rotateX(-Math.PI/2);
  private readonly batches=new Map<string,Batch>();
  private readonly parent=new Matrix4();private readonly local=new Matrix4();private readonly composed=new Matrix4();
  private readonly rotation=new Quaternion();private readonly euler=new Euler(0,0,0,'YXZ');
  private readonly position=new Vector3();private readonly scale=new Vector3();private readonly tint=new Color();
  private readonly foam:DataTexture;
  private readonly boats:Boat[];
  private elapsed=0;
  private validate=true;
  private shownBirds=0;private shownBoats=0;

  constructor(scene:Scene,private readonly world:VoxelWorld){
    this.root.name='coastal-life';scene.add(this.root);
    this.foam=this.foamTexture();
    this.batch('gull-white',15*7,'#d8d9cf',.86);
    this.batch('gull-dark',15*5,'#505b5e',.91);
    this.batch('boat-paint',3*12,'#ffffff',.68,.12);
    this.batch('boat-deck',3*7,'#a69c7a',.88);
    this.batch('boat-metal',3*10,'#4c5d60',.6,.35);
    this.batch('boat-glass',3*5,'#23434c',.23,.28);
    const lamps=this.batch('boat-lamps',3*4,'#e3cf9b',.35);
    (lamps.material as MeshStandardMaterial).emissive.set('#f0c078');
    const wakeMaterial=new MeshBasicMaterial({color:'#aabcb8',map:this.foam,transparent:true,opacity:.2,depthWrite:false,side:DoubleSide});
    this.addBatch('boat-wake',3*2,wakeMaterial,this.foamGeometry);
    this.boats=COASTAL_BOAT_ROUTES.map(route=>({route,time:0,pose:coastalBoatPose(route,0),visible:false,moving:true}));
    this.update(0,{x:128,y:20,z:180},0,0);
  }

  get diagnostics(){return {birds:this.shownBirds,boats:this.shownBoats,batches:this.batches.size,blockedBoats:this.boats.filter(boat=>!boat.moving).length};}

  sync(_dirtyKeys:Iterable<string>):void{this.validate=true;}

  update(dt:number,focus:Vector3Like,night=0,wetness=0):void{
    const step=Math.max(0,Math.min(.1,dt));this.elapsed+=step;
    for(const b of this.batches.values())b.cursor=0;
    this.shownBirds=0;this.shownBoats=0;
    for(let i=0;i<this.boats.length;i++){
      const boat=this.boats[i],nextTime=boat.time+step,next=coastalBoatPose(boat.route,nextTime);
      if(this.validate)boat.visible=isCoastalWaterClear(this.world,boat.pose);
      boat.moving=boat.visible&&isCoastalWaterClear(this.world,next);
      if(boat.moving){boat.time=nextTime;boat.pose=next;}
      if(!boat.visible||Math.hypot(boat.pose.x-focus.x,boat.pose.z-focus.z)>1400)continue;
      this.drawBoat(boat,i,night,wetness);this.shownBoats++;
    }
    if(night<.92)for(let i=0;i<15;i++){
      const flock=FLOCKS[Math.floor(i/5)],slot=i%5,a=this.elapsed*(.055+slot*.003)+slot*1.12;
      const x=flock.x+Math.cos(a)*flock.rx,z=flock.z+Math.sin(a)*flock.rz;
      if(Math.hypot(x-focus.x,z-focus.z)>650)continue;
      let y=flock.y+Math.sin(a*2+slot)*2.3+slot*.65;
      // Player construction is respected too: the small flock stays above a new mast.
      for(let h=Math.min(95,Math.floor(y+7));h>=Math.floor(y-5);h--)if(this.world.getVoxel(Math.floor(x),h,Math.floor(z))){y=h+3;break;}
      this.drawGull(x,y,z,Math.atan2(Math.sin(a)*flock.rx,-Math.cos(a)*flock.rz),i,a);this.shownBirds++;
    }
    this.validate=false;
    (this.batches.get('boat-lamps')!.material as MeshStandardMaterial).emissiveIntensity=.08+night*.95;
    this.batches.get('boat-wake')!.material.opacity=(.18+wetness*.07)*(1-night*.65);
    for(const batch of this.batches.values()){
      batch.mesh.count=batch.cursor;batch.mesh.instanceMatrix.needsUpdate=true;
      if(batch.mesh.instanceColor)batch.mesh.instanceColor.needsUpdate=true;
    }
  }

  dispose():void{
    this.root.removeFromParent();this.cube.dispose();this.foamGeometry.dispose();this.foam.dispose();
    for(const batch of this.batches.values()){batch.mesh.dispose();batch.material.dispose();}
  }

  private batch(name:string,capacity:number,color:string,roughness:number,metalness=0):Batch{
    return this.addBatch(name,capacity,new MeshStandardMaterial({color,roughness,metalness}),this.cube);
  }
  private addBatch(name:string,capacity:number,material:MeshStandardMaterial|MeshBasicMaterial,geometry:BufferGeometry):Batch{
    const mesh=new InstancedMesh(geometry,material,capacity);mesh.name=`coastal-life-${name}`;mesh.frustumCulled=false;mesh.receiveShadow=false;mesh.castShadow=false;
    this.root.add(mesh);const batch={mesh,material,capacity,cursor:0};this.batches.set(name,batch);return batch;
  }
  private setParent(x:number,y:number,z:number,yaw:number,pitch=0,roll=0):void{
    this.parent.compose(this.position.set(x,y,z),this.rotation.setFromEuler(this.euler.set(pitch,yaw,roll,'YXZ')),this.scale.set(1,1,1));
  }
  private part(name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,roll=0,color?:string,yaw=0):void{
    const batch=this.batches.get(name)!;
    if(batch.cursor>=batch.capacity)throw new Error(`Coastal instance budget exceeded: ${name}`);
    this.local.compose(this.position.set(x,y,z),this.rotation.setFromEuler(this.euler.set(0,yaw,roll,'YXZ')),this.scale.set(sx,sy,sz));
    this.composed.multiplyMatrices(this.parent,this.local);batch.mesh.setMatrixAt(batch.cursor,this.composed);
    if(color)batch.mesh.setColorAt(batch.cursor,this.tint.set(color));batch.cursor++;
  }
  private drawBoat(boat:Boat,id:number,night:number,wetness:number):void{
    const {x,z,heading}=boat.pose,bob=Math.sin(this.elapsed*.74+id*2.1)*(.055+wetness*.035);
    this.setParent(x,COASTAL_WATER_LEVEL+.11+bob,z,heading,Math.sin(this.elapsed*.57+id)*.009,Math.sin(this.elapsed*.61+id*2)*.019);
    const color=boat.route.color;
    // Stepped, tapered hull reads as a working fishing boat from either shore.
    this.part('boat-paint',0,.12,0,3.05,.65,6.0,0,color);
    this.part('boat-paint',0,.10,-3.15,2.15,.58,.7,0,color);
    this.part('boat-paint',0,.09,-3.68,1.15,.50,.4,0,color);
    this.part('boat-deck',0,.5,.05,2.78,.18,5.65);
    for(const side of [-1,1]){
      this.part('boat-paint',side*1.47,.75,0,.16,.57,5.65,0,color);
      this.part('boat-deck',side*1.48,1.04,0,.20,.09,5.70);
      for(const end of [-1,1])this.part('boat-metal',side*1.58,.52,end*1.9,.15,.40,.37);
    }
    this.part('boat-paint',0,1.36,-.45,2.0,1.5,2.25,0,'#d2d0b8');
    this.part('boat-deck',0,2.18,-.45,2.18,.15,2.43);
    this.part('boat-glass',0,1.63,-1.59,1.67,.59,.035);
    for(const side of [-1,1])this.part('boat-glass',side*1.013,1.64,-.51,.035,.57,1.56);
    this.part('boat-metal',.36,2.62,-.35,.09,.85,.09);
    this.part('boat-metal',.36,2.97,-.35,1.23,.075,.075);
    this.part('boat-lamps',.36,3.12,-.35,.17,.17,.17);
    this.part('boat-deck',-.63,.82,1.88,.78,.49,.68);
    this.part('boat-paint',.55,.85,1.92,.65,.55,.61,0,id%2?'#536e72':'#8b7154');
    this.part('boat-metal',0,.87,2.98,2.45,.10,.10);
    if(night>.05)this.part('boat-lamps',0,1.31,-1.62,.29,.15,.04);
    if(boat.moving){
      this.setParent(x,COASTAL_WATER_LEVEL+.035,z,heading);
      for(const side of [-1,1])this.part('boat-wake',side*1.94,0,6.60,.74,1,8.2,0,undefined,side*.19);
    }
  }
  private drawGull(x:number,y:number,z:number,yaw:number,id:number,a:number):void{
    const glide=Math.sin(this.elapsed*.27+id*1.7)>.05;
    const flap=glide?.04+Math.sin(a*2)*.035:Math.sin(this.elapsed*4.2+id*1.9)*.35;
    this.setParent(x,y,z,yaw,-.025,Math.sin(a)*.085);
    this.part('gull-white',0,0,0,.17,.18,.43);
    this.part('gull-white',0,.10,-.23,.16,.15,.18);
    this.part('gull-dark',0,.085,-.359,.05,.04,.12);
    this.part('gull-white',0,-.018,.25,.23,.045,.19);
    for(const side of [-1,1]){
      const c=Math.cos(flap),s=Math.sin(flap),roll=side*flap;
      this.part('gull-white',side*(.07+c*.27),s*.27,-.005,.58,.055,.23,roll);
      this.part('gull-dark',side*(.07+c*.67),s*.67,.035,.25,.045,.17,roll-side*.10);
    }
  }
  private foamTexture():DataTexture{
    const width=32,height=64,data=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const u=x/(width-1),v=y/(height-1),side=Math.max(0,1-Math.abs(u-.5)*2),tip=Math.sin(Math.PI*v);
      const grain=.72+.28*Math.sin(x*2.7+y*1.9)*Math.sin(y*.73-x*.17),i=(x+y*width)*4;
      data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(255*side**1.4*tip**.7*(.35+.65*v)*grain);
    }
    const texture=new DataTexture(data,width,height,RGBAFormat);texture.magFilter=texture.minFilter=LinearFilter;texture.needsUpdate=true;return texture;
  }
}
