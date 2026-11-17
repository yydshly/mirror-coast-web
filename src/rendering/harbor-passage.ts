import {BoxGeometry,CanvasTexture,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PlaneGeometry,Scene,SRGBColorSpace} from 'three';
import type {SceneObstacle} from '../input/scene-collisions';
import type {HarborPassage} from '../gameplay/harbor-passage';
import type {VoxelWorld} from '../world/voxel';

/** A small working pier, with visible lights answering the distant cape. Static
 * fixtures use shared batches; they disappear with their actual deck support. */
export class HarborPassageArt{
  readonly obstacles:SceneObstacle[]=[];
  private root=new Group();private sections:{root:Group;bounds:SceneObstacle[];x:number;z:number}[]=[];
  private amber=new MeshStandardMaterial({color:'#c78b48',emissive:'#c78b48',emissiveIntensity:.25});
  private green=new MeshStandardMaterial({color:'#99ccb1',emissive:'#77bfa0',emissiveIntensity:0});
  private reply=new Group();private clock=0;
  private open=false;
  constructor(scene:Scene,private world:VoxelWorld,private passage:HarborPassage){
    this.root.name='harbor-passage';scene.add(this.root);
    const cube=new BoxGeometry(1,1,1),iron=new MeshStandardMaterial({color:'#3d5555',roughness:.78}),wood=new MeshStandardMaterial({color:'#7d684d',roughness:.95}),pale=new MeshStandardMaterial({color:'#d9c7a0',roughness:.85});
    const fixture=(x:number,z:number,parts:{m:MeshStandardMaterial;x:number;y:number;z:number;w:number;h:number;d:number;solid?:boolean}[])=>{
      const root=new Group(),bounds:SceneObstacle[]=[];root.position.set(x,15,z);this.root.add(root);
      for(const material of new Set(parts.map(p=>p.m))){const list=parts.filter(p=>p.m===material),mesh=new InstancedMesh(cube,material,list.length);list.forEach((p,i)=>{mesh.setMatrixAt(i,new Matrix4().makeScale(p.w,p.h,p.d).setPosition(p.x,p.y,p.z));if(p.solid)bounds.push({minX:x+p.x-p.w/2,maxX:x+p.x+p.w/2,minY:15+p.y-p.h/2,maxY:15+p.y+p.h/2,minZ:z+p.z-p.d/2,maxZ:z+p.z+p.d/2,standable:false});});mesh.castShadow=mesh.receiveShadow=true;mesh.computeBoundingSphere();mesh.matrixAutoUpdate=false;root.add(mesh);}
      this.sections.push({root,bounds,x:Math.floor(x),z:Math.floor(z)});return root;
    };
    // Low rails leave the entrance clear and frame the sea, with no hidden wall.
    for(const z of [229.25,235.25])for(const x of [-12,-6,0,6])fixture(x,z,[{m:iron,x:0,y:.5,z:0,w:.085,h:1,d:.085,solid:true},{m:iron,x:0,y:.94,z:0,w:6,h:.07,d:.07,solid:true},{m:iron,x:0,y:.45,z:0,w:6,h:.035,d:.035}]);
    const desk=fixture(-12,232,[{m:wood,x:0,y:.53,z:.5,w:.8,h:1.06,d:1.5,solid:true},{m:pale,x:.44,y:1.02,z:.5,w:.1,h:.5,d:1.2},{m:iron,x:0,y:2,z:0,w:.09,h:4,d:.09,solid:true},{m:this.amber,x:0,y:3.2,z:0,w:.4,h:.42,d:.4}]);
    const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#e1d3ac';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#406161';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(48,190);ctx.quadraticCurveTo(160,90,235,145);ctx.quadraticCurveTo(300,200,455,55);ctx.stroke();ctx.fillStyle='#304c4c';ctx.font='bold 30px sans-serif';ctx.fillText('COAST WATCH / 205°',30,40);ctx.font='25px sans-serif';ctx.fillText('渔港 → 南湾 → 西岬',30,234);const texture=new CanvasTexture(c);texture.colorSpace=SRGBColorSpace;
    const paper=new Mesh(new PlaneGeometry(1.1,.5),new MeshStandardMaterial({map:texture,roughness:1}));paper.rotation.y=Math.PI/2;paper.position.set(.501,1.02,.5);desk.add(paper);
    for(const x of [-13,0,7])for(const z of [229,235])fixture(x,z,[{m:iron,x:0,y:.6,z:0,w:.14,h:1.2,d:.14,solid:true},{m:this.green,x:0,y:1.24,z:0,w:.24,h:.2,d:.24}]);
    // An offshore patrol boat gives the restored navigation signal a spatial
    // answer. It stays outside the reachable deck; it is not a driveable actor.
    this.reply.name='harbor-signal-reply';this.root.add(this.reply);
    for(const [m,x,y,z,w,h,d]of [[wood,0,0,0,5,.8,13],[pale,0,1.1,-1,3.3,1.8,4],[iron,0,3,-1,.1,2.2,.1],[this.green,0,4.1,-1,.3,.25,.3]] as const){const part=new Mesh(cube,m);part.position.set(x,y,z);part.scale.set(w,h,d);part.castShadow=true;this.reply.add(part);}this.sync();
  }
  sync(){this.open=this.passage.status==='open';this.obstacles.length=0;for(const s of this.sections){s.root.visible=!!this.world.getVoxel(s.x,14,s.z);if(s.root.visible)this.obstacles.push(...s.bounds);}}
  update(dt:number,night:number,signalIntact=true){this.clock+=dt;const linked=this.passage.state.beaconLinked&&signalIntact;
    this.amber.color.set(linked?'#9bc9ab':this.passage.state.logRead?'#dbc587':'#c78b48');this.amber.emissive.copy(this.amber.color);this.amber.emissiveIntensity=.3+night*1.5;
    this.green.color.set(linked?'#99ccb1':this.open?'#d5bc80':'#52665b');this.green.emissive.copy(this.green.color);
    this.green.emissiveIntensity=linked?.7+night*1.8:this.open?.18+night*.5:0;
    this.reply.visible=linked;this.reply.position.set(-34+Math.sin(this.clock*.018)*22,12.4+Math.sin(this.clock*.7)*.08,270);this.reply.rotation.set(0,Math.PI/2+Math.cos(this.clock*.018)*.1,Math.sin(this.clock*.4)*.015);
  }
  get diagnostics(){return{...this.passage.snapshot,status:this.passage.status,replyVisible:this.reply.visible};}
}
