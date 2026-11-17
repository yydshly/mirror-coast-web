import type {DecorationPart} from '../destruction/decorations';
import {BoxGeometry,BufferGeometry,CylinderGeometry,Euler,IcosahedronGeometry,InstancedMesh,Matrix4,MeshStandardMaterial,Quaternion,Scene,Vector3} from 'three';
import {decodeWorldIndex,type BuildingRecord,type BuildingRegistry} from '../destruction/buildings';
import {orientedCollisionBounds,partCollisionBounds,type SceneObstacle} from '../input/scene-collisions';
import {findFurnitureFooting,furnitureFootContacts} from '../world/furniture-footing';
import {Material} from '../world/palette';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
import {surfaceFinish} from './surface-finish';
import {humanBox} from './human-geometry';
import {windowGlaze} from './window-glaze';
import {ChunkDependents} from '../world/chunk-dependents';
import {staticDetailGroups} from './static-detail-groups';

type Anchor={x:number;y:number;z:number;material:number};
type Detail={matrix:Matrix4;position:Vector3;anchors:Anchor[];visible:boolean;radius:number};
type Batch={geometry:BufferGeometry;material:MeshStandardMaterial;items:Detail[];mesh?:InstancedMesh};
type SupportGroup={anchors:Anchor[];items:Array<{batch:Batch;item:Detail}>;bounds:SceneObstacle[]};
type Face={nx:number;nz:number;plane:number;exterior:boolean;cells:Map<string,Anchor>};
type Window={face:Face;u:number;bottom:number;width:number;height:number;anchors:Anchor[]};
const cellKey=(x:number,z:number)=>`${x},${z}`;
const glass=(m:number)=>m===Material.Window||m===Material.DarkWindow;
const hash=(value:string)=>{let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};

/** Close-range architectural layers; the existing destructible city stays authoritative. */
export class NeighborhoodDetail{
  readonly obstacles:SceneObstacle[]=[];
  private obstacleSlots=new Map<SceneObstacle,number>();
  readonly groundFootings:Array<{buildingId:string;x:number;y:number;z:number;anchors:Anchor[]}>=[];
  private readonly box=new BoxGeometry(1,1,1);
  private readonly bevel=humanBox(.09);
  private readonly pipe=new CylinderGeometry(.5,.5,1,10);
  private readonly pot=new CylinderGeometry(.24,.17,.40,12);
  private readonly foliage=new IcosahedronGeometry(.5,1);
  private readonly batches:Batch[]=[];
  private readonly materials:MeshStandardMaterial[]=[];
  private readonly bounds:Array<{bounds:SceneObstacle;anchors:Anchor[]}>=[];
  private readonly supportCache=new WeakMap<Anchor[],boolean>();
  private readonly dependents=new ChunkDependents<SupportGroup>();
  private readonly lastFocus=new Vector3(Infinity,Infinity,Infinity);
  private readonly paneNight={value:0};
  private readonly stone=this.mat('#c9bea4',.88,0,'stone');
  private readonly dark=this.mat('#354b4e',.65,.3,'paint');
  private readonly zinc=this.mat('#82918a',.48,.55,'paint');
  private readonly wood=this.mat('#826044',.87,0,'wood');
  private readonly clay=this.mat('#aa7254',.86,0,'stone');
  private readonly soil=this.mat('#4b4c37',1);
  private readonly foliageMats=['#476454','#657b59','#8b9669'].map(c=>this.mat(c,.94));
  private readonly shutters=['#547b76','#496473','#8c6553','#7e8671'].map(c=>this.mat(c,.82,0,'paint'));
  private readonly curtains=['#c4baa0','#b6bdb1','#a69b87'].map(c=>this.mat(c,.95,0,'fabric'));
  private readonly glazing=['#2a454c','#496065','#526b6b'].map(c=>windowGlaze(this.mat(c,.22,.25),this.paneNight));
  private refreshIndex=0;private refreshing=false;
  private windowCount=0;private buildingCount=0;private visibleCount=0;

  constructor(private scene:Scene,private world:VoxelWorld,registry:BuildingRegistry){
    for(const building of registry.all){
      if(building.id.startsWith('tree-')||building.id.startsWith('exploration-')||building.id.startsWith('explore-')||building.id==='city-lighthouse')continue;
      // Ground-reaching glass is an entrance, not a window for a sill/shutters.
      const windows=this.windows(building).filter(w=>!w.anchors.some(a=>a.y===building.foundationY));if(windows.length)this.buildingCount++;
      const regional=building.id.startsWith('region-'),seed=hash(building.id);
      for(let i=0;i<windows.length;i++)this.window(building,windows[i],seed+i*31,regional);
      const facades=[...new Set(windows.filter(w=>w.face.exterior).map(w=>w.face))];
      for(const face of facades.slice(0,3))this.drainpipe(building,face,windows.filter(w=>w.face===face));
      if(seed%3===0)this.roofVent(building,seed);
      // Carefully spaced shop pots, outside the door bay and the public road.
      if(!regional&&!building.id.startsWith('harbor-')&&building.bounds.maxZ<156&&seed%3===0)this.shopPlanters(building);
    }
    const sectors=this.batches.flatMap(batch=>staticDetailGroups(batch.items,item=>item.matrix).map(items=>({geometry:batch.geometry,material:batch.material,items} as Batch)));
    this.batches.length=0;this.batches.push(...sectors);
    for(const batch of this.batches){
      const mesh=new InstancedMesh(batch.geometry,batch.material,batch.items.length);mesh.name='neighborhood-close-detail';
      mesh.castShadow=mesh.receiveShadow=true;batch.mesh=mesh;this.scene.add(mesh);
      // The bound includes every supported/hidden slot before live packing.
      // Camera movement and repaired windows can safely reveal any item later.
      batch.items.forEach((item,i)=>mesh.setMatrixAt(i,item.matrix));mesh.computeBoundingSphere();
      mesh.count=0;
    }
    const groups=new Map<Anchor[],SupportGroup>();
    const group=(anchors:Anchor[])=>{let g=groups.get(anchors);if(!g){g={anchors,items:[],bounds:[]};groups.set(anchors,g);this.dependents.add(g,anchors);}return g;};
    for(const batch of this.batches)for(const item of batch.items)group(item.anchors).items.push({batch,item});
    for(const b of this.bounds)group(b.anchors).bounds.push(b.bounds);
    this.sync([]);
  }
  get diagnostics(){return{buildings:this.buildingCount,windows:this.windowCount,planters:this.groundFootings.length,instances:this.batches.reduce((n,b)=>n+b.items.length,0),visible:this.visibleCount,submitted:this.batches.reduce((n,b)=>n+(b.mesh?.count??0),0),batches:this.batches.length};}
  private mat(color:string,roughness:number,metalness=0,finish?:Parameters<typeof surfaceFinish>[1]){
    const m=new MeshStandardMaterial({color,roughness,metalness});if(finish)surfaceFinish(m,finish);this.materials.push(m);return m;
  }
  private supported(anchors:Anchor[]){let supported=this.supportCache.get(anchors);if(supported===undefined){supported=anchors.every(a=>this.world.getVoxel(a.x,a.y,a.z)===a.material);this.supportCache.set(anchors,supported);}return supported;}
  private anchors(cells:readonly Vector3Like[]):Anchor[]{return cells.map(c=>({...c,material:this.world.getVoxel(c.x,c.y,c.z)}));}
  private part(position:Vector3Like,size:Vector3Like,material:MeshStandardMaterial,anchors:Anchor[],yaw=0,geometry:BufferGeometry=this.box,radius=105,pitch=0){
    let batch=this.batches.find(b=>b.geometry===geometry&&b.material===material);
    if(!batch){batch={geometry,material,items:[]};this.batches.push(batch);}
    const p=new Vector3().copy(position),rotation=new Quaternion().setFromEuler(new Euler(pitch,yaw,0,'YXZ'));
    batch.items.push({matrix:new Matrix4().compose(p,rotation,new Vector3().copy(size)),position:p,anchors,visible:false,radius});
  }
  private point(face:Face,u:number,y:number,depth:number){return new Vector3(face.nx*(face.plane+depth)+face.nz*u,y,face.nz*(face.plane+depth)-face.nx*u);}
  private facePart(face:Face,u:number,y:number,depth:number,sx:number,sy:number,sz:number,m:MeshStandardMaterial,anchors:Anchor[],geometry:BufferGeometry=this.box){
    const position=this.point(face,u,y,depth),yaw=Math.atan2(face.nx,face.nz);
    this.part(position,{x:sx,y:sy,z:sz},m,anchors,yaw,geometry);
    if(!(m.transparent&&m.opacity<.5)&&!this.curtains.includes(m))this.bounds.push({anchors,bounds:partCollisionBounds(geometry,new Matrix4().compose(position,new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw),new Vector3(sx,sy,sz)))});
  }
  private solid(position:Vector3Like,size:Vector3Like,anchors:Anchor[],yaw=0){
    this.bounds.push({bounds:{...orientedCollisionBounds(position,{x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},{x:size.x/2,y:size.y/2,z:size.z/2}),standable:false},anchors});
  }
  private windows(building:BuildingRecord):Window[]{
    const faces=new Map<string,Face>(),b=building.bounds,cx=(b.minX+b.maxX+1)/2,cz=(b.minZ+b.maxZ+1)/2;
    for(const index of building.indices){
      const p=decodeWorldIndex(index),m=this.world.getVoxel(p.x,p.y,p.z);if(!glass(m)||p.y>building.foundationY+30)continue;
      for(const [nx,nz]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const exterior=nx*(p.x+.5-cx)+nz*(p.z+.5-cz)>0;
        if((!exterior&&!building.id.startsWith('region-')&&!building.id.startsWith('harbor-'))||this.world.getVoxel(p.x+nx,p.y,p.z+nz))continue;
        const plane=nx*(p.x+.5)+nz*(p.z+.5)+.5,key=`${nx},${nz},${plane}`;
        let face=faces.get(key);if(!face){face={nx,nz,plane,exterior,cells:new Map()};faces.set(key,face);}
        face.cells.set(cellKey(Math.floor(nz*(p.x+.5)-nx*(p.z+.5)),p.y),{...p,material:m});
      }
    }
    const windows:Window[]=[];
    for(const face of faces.values()){
      const visited=new Set<string>();
      for(const key of face.cells.keys()){
        if(visited.has(key))continue;const stack=[key],anchors:Anchor[]=[];let loU=Infinity,hiU=-Infinity,loY=Infinity,hiY=-Infinity;
        while(stack.length){const k=stack.pop()!;if(visited.has(k)||!face.cells.has(k))continue;visited.add(k);
          const [u,y]=k.split(',').map(Number);loU=Math.min(loU,u);hiU=Math.max(hiU,u);loY=Math.min(loY,y);hiY=Math.max(hiY,y);anchors.push(face.cells.get(k)!);
          for(const [du,dy]of [[1,0],[-1,0],[0,1],[0,-1]])stack.push(cellKey(u+du,y+dy));
        }
        const width=hiU-loU+1,height=hiY-loY+1;
        // A damaged pane exposes its thin side edges. Those are not new
        // facade windows and must never acquire a fresh frame on reload.
        if(width<2||height<2||height>4||width>36||anchors.length<width*height*.9)continue;
        windows.push({face,u:(loU+hiU+1)/2,bottom:loY,width,height,anchors});
      }
    }
    return windows;
  }
  private window(building:BuildingRecord,w:Window,seed:number,regional:boolean){
    const {face,u,bottom:y,width:width,height:h,anchors}=w;this.windowCount++;
    const trim=regional&&building.bounds.minX<0?this.shutters[1]:seed%3===0?this.wood:this.stone;
    if(!face.exterior){
      for(const side of [-1,1]){
        this.facePart(face,u+side*width/2,y+h/2,.035,.065,h+.1,.10,this.wood,anchors,this.bevel);
        this.facePart(face,u,y+h/2+side*h/2,.035,width+.1,.065,.10,this.wood,anchors,this.bevel);
        if(width<=4)this.facePart(face,u+side*width*.36,y+h*.54,.09,width*.18,h*.85,.025,this.curtains[seed%3],anchors);
      }
      this.facePart(face,u,y+h/2,.08,.045,h,.07,this.wood,anchors);
      this.facePart(face,u,y-.06,.13,width+.16,.10,.30,this.wood,anchors,this.bevel);
      return;
    }
    if(regional){
      const glassMat=this.glazing[seed%this.glazing.length];
      this.facePart(face,u,y+h/2,.016,width-.10,h-.10,.025,glassMat,anchors);
      for(const edge of [-1,1]){
        this.facePart(face,u+edge*width/2,y+h/2,.045,.065,h+.12,.12,trim,anchors,this.bevel);
        this.facePart(face,u,y+h/2+edge*h/2,.045,width+.12,.065,.12,trim,anchors,this.bevel);
      }
      for(let bar=2;bar<width;bar+=2)this.facePart(face,u-width/2+bar,y+h/2,.09,.045,h,.08,this.dark,anchors);
      this.facePart(face,u,y+h*.58,.09,width,.045,.08,this.dark,anchors);
    }
    if(width>5)return;
    const style=hash(building.id)%4;
    // Side-street homes have closed louvres, townhouses have slender balcony rails;
    // industrial blocks retain broad unadorned glazing. Each change has wall anchors.
    if(y>building.foundationY+4&&width<=3&&style===1&&seed%4===0){
      const paint=this.shutters[hash(building.id)%4];
      for(const side of [-1,1])this.facePart(face,u+side*width*.245,y+h/2,.18,width*.48,h-.04,.10,paint,anchors,this.bevel);
      for(let row=.15;row<h-.10;row+=.25)this.facePart(face,u,y+row,.24,width-.10,.025,.035,this.dark,anchors);
    }else if(y>building.foundationY+4&&width<=3&&style===2&&seed%3===0){
      this.facePart(face,u,y+.74,.34,width+.28,.055,.055,this.dark,anchors);
      for(let bar=-width/2;bar<=width/2;bar+=.29)this.facePart(face,u+bar,y+.36,.34,.028,.74,.04,this.dark,anchors);
      this.facePart(face,u,y-.05,.25,width+.32,.10,.42,this.stone,anchors,this.bevel);
    }
    if(style===3&&y+h>building.bounds.maxY-6)this.facePart(face,u,y+h+.16,.16,width+.38,.12,.30,this.stone,anchors,this.bevel);

    // Upper storeys have curtains; ground-floor displays keep their sightlines.
    if(y>building.foundationY+3&&seed%3!==0){
      const curtain=this.curtains[seed%3];
      for(const side of [-1,1]){
        this.facePart(face,u+side*width*.34,y+h*.54,.105,width*.22,h*.85,.018,curtain,anchors);
        for(let fold=0;fold<3;fold++)this.facePart(face,u+side*width*.34+(fold-1)*width*.055,y+h*.54,.12,.012,h*.85,.016,this.stone,anchors);
      }
    }
    if(y<building.foundationY+2)return;
    this.facePart(face,u,y-.09,.18,width+.22,.12,.42,this.stone,anchors,this.bevel);
    if(regional&&width<=3&&seed%3!==1){
      const paint=this.shutters[seed%4];
      for(const side of [-1,1]){
        const su=u+side*(width/2+.23);
        this.facePart(face,su,y+h/2,.075,.34,h-.02,.12,paint,anchors,this.bevel);
        for(let louvre=.18;louvre<h-.08;louvre+=.22)this.facePart(face,su,y+louvre,.145,.29,.035,.055,this.dark,anchors);
      }
    }
    if(seed%5!==0||width>3)return;
    const boxWidth=Math.min(1.4,width*.78),depth=.36,by=y-.18,yaw=Math.atan2(face.nx,face.nz);
    this.facePart(face,u,by-.10,.32,boxWidth,.07,depth,this.clay,anchors);
    for(const edge of [-1,1])this.facePart(face,u,by,.32+edge*.16,boxWidth,.22,.04,this.clay,anchors,this.bevel);
    for(const edge of [-1,1])this.facePart(face,u+edge*(boxWidth/2-.02),by,.32,.04,.22,.36,this.clay,anchors);
    this.facePart(face,u,by+.06,.32,boxWidth-.08,.035,.27,this.soil,anchors);
    for(let i=0;i<6;i++){
      const p=this.point(face,u+(i-2.5)*boxWidth/6,by+.20+(i%2)*.06,.33);
      this.part(p,{x:.26,y:.26,z:.28},this.foliageMats[i%3],anchors,yaw,this.foliage,100);
    }
    for(const side of [-1,1])this.facePart(face,u+side*boxWidth*.34,by-.14,.18,.045,.18,.35,this.dark,anchors);
    this.solid(this.point(face,u,by,.32),{x:boxWidth,y:.28,z:.4},anchors,yaw);
  }
  private drainpipe(building:BuildingRecord,face:Face,windows:Window[]){
    const min=Math.min(...windows.map(w=>w.u-w.width/2)),max=Math.max(...windows.map(w=>w.u+w.width/2)),u=min-.65;
    const centre=this.point(face,Math.floor(u)+.5,0,-.5),x=Math.floor(centre.x),z=Math.floor(centre.z);
    let top=building.foundationY;
    for(let y=building.bounds.maxY;y>building.foundationY+3;y--)if(this.world.getVoxel(x,y,z)){top=y;break;}
    if(top<=building.foundationY+3)return;
    const lower=building.foundationY+1.22,upper=top+.85;
    const a=this.anchors([{x,y:top,z},{x,y:Math.floor(lower+1),z}]);if(a.some(c=>!c.material))return;
    this.facePart(face,u,(lower+upper)/2,.14,.085,upper-lower,.085,this.zinc,a,this.pipe);
    for(let y=lower+.35;y<upper;y+=2.8)this.facePart(face,u,y,.08,.17,.055,.20,this.dark,a,this.bevel);
    this.facePart(face,(min+max)/2,upper,.12,max-min+1.25,.075,.13,this.zinc,a,this.bevel);
    this.solid(this.point(face,u,(lower+upper)/2,.14),{x:.13,y:upper-lower,z:.21},a,Math.atan2(face.nx,face.nz));
  }
  private roofVent(building:BuildingRecord,seed:number){
    const b=building.bounds,x=Math.floor((b.minX+b.maxX)/2),z=Math.floor((b.minZ+b.maxZ)/2);let y=b.maxY;
    while(y>building.foundationY&&!([Material.Roof,Material.Terracotta].includes(this.world.getVoxel(x,y,z) as never)))y--;
    if(y<=building.foundationY)return;
    const footing=findFurnitureFooting(this.world,x+.5,z+.5,0,furnitureFootContacts([{x:0,z:0}],.24,.24),y+1);
    if(!footing)return;const anchors=this.anchors(footing.anchors),position={x:footing.x,y:footing.y+.40,z:footing.z};
    this.part(position,{x:.18,y:.8,z:.18},seed%2?this.clay:this.zinc,anchors,0,this.pipe,190);
    this.part({...position,y:footing.y+.81},{x:.42,y:.08,z:.42},this.zinc,anchors,0,this.bevel,190);
    this.solid(position,{x:.22,y:.8,z:.22},anchors);
  }
  private shopPlanters(building:BuildingRecord){
    const b=building.bounds;
    for(const x of [b.minX+1.2,b.maxX-.2]){
      const footing=findFurnitureFooting(this.world,x,b.maxZ+1.65,0,furnitureFootContacts([{x:0,z:0}],.24,.24),building.foundationY+1);
      if(!footing)continue;const anchors=this.anchors(footing.anchors),{x:px,y,z}=footing;
      if(this.world.getVoxel(Math.floor(px),y,Math.floor(z))||this.world.getVoxel(Math.floor(px),y+1,Math.floor(z)))continue;
      this.groundFootings.push({buildingId:building.id,...footing,anchors});
      this.part({x:px,y:y+.2,z},{x:1,y:1,z:1},this.clay,anchors,0,this.pot);
      this.part({x:px,y:y+.37,z},{x:.40,y:.04,z:.40},this.soil,anchors,0,this.pipe);
      this.part({x:px,y:y+.72,z},{x:.06,y:.78,z:.06},this.wood,anchors,0,this.pipe);
      for(const [dx,dy,dz,sx,sy,sz]of [[-.17,1.08,.04,.47,.48,.42],[.17,1.28,-.02,.46,.50,.40],[0,1.51,.02,.45,.47,.43],[.06,1.03,-.16,.43,.42,.39]]){
        this.part({x:px+dx,y:y+dy,z:z+dz},{x:sx,y:sy,z:sz},this.foliageMats[Math.abs(Math.round(dy*9))%3],anchors,0,this.foliage,100);
      }
      this.solid({x:px,y:y+.20,z},{x:.48,y:.4,z:.48},anchors);
      this.solid({x:px,y:y+1.14,z},{x:.66,y:1.25,z:.65},anchors);
    }
  }
  update(_dt:number,focus:Vector3Like,night=0){
    this.paneNight.value=night;
    this.glazing.forEach((m,i)=>{m.emissive.set(i?'#d4b489':'#759698');m.emissiveIntensity=night*(i?.24:.04);});
    if(this.lastFocus.distanceToSquared(focus)>=25){this.lastFocus.copy(focus);if(!this.refreshing)this.refreshIndex=0;this.refreshing=true;}
    if(this.refreshing)this.refresh(_dt===0?Infinity:2);
  }
  private refresh(budget=Infinity){
    const started=performance.now();const support=new Map<Anchor[],boolean>();
    for(;this.refreshIndex<this.batches.length;this.refreshIndex++){const batch=this.batches[this.refreshIndex];let changed=false;
      batch.items.forEach(item=>{
        const near=item.position.distanceToSquared(this.lastFocus)<item.radius*item.radius;
        if(near&&!support.has(item.anchors))support.set(item.anchors,this.supported(item.anchors));
        const visible=near&&support.get(item.anchors)===true;
        if(visible===item.visible)return;this.visibleCount+=visible?1:-1;item.visible=visible;changed=true;
      });
      if(changed)this.pack(batch);
      if(performance.now()-started>budget){this.refreshIndex++;break;}
    }
    this.refreshing=this.refreshIndex<this.batches.length;
  }
  /** Zero-sized matrices still run all vertex/shadow shaders. Submit only the
   * live prefix, preserving each item's independent support/collision identity. */
  private pack(batch:Batch){
    if(!batch.mesh)return;let count=0;
    for(const item of batch.items)if(item.visible)batch.mesh.setMatrixAt(count++,item.matrix);
    batch.mesh.count=count;batch.mesh.instanceMatrix.needsUpdate=true;
  }
  sync(dirtyKeys:Iterable<string>){
    const dirty=new Set(dirtyKeys);
    if(!dirty.size){this.obstacles.length=0;this.obstacleSlots.clear();for(const b of this.bounds)if(this.supported(b.anchors)){this.obstacleSlots.set(b.bounds,this.obstacles.length);this.obstacles.push(b.bounds);}this.refreshIndex=0;this.refresh();return;}
    const changed=new Set<Batch>();
    for(const group of this.dependents.affected(dirty)){
      const before=this.supported(group.anchors);this.supportCache.delete(group.anchors);const supported=this.supported(group.anchors);
      if(before!==supported)for(const b of group.bounds){
        const slot=this.obstacleSlots.get(b);
        if(supported){if(slot===undefined){this.obstacleSlots.set(b,this.obstacles.length);this.obstacles.push(b);}}
        else if(slot!==undefined){const last=this.obstacles.pop()!;this.obstacleSlots.delete(b);if(slot<this.obstacles.length){this.obstacles[slot]=last;this.obstacleSlots.set(last,slot);}}
      }
      for(const {batch,item}of group.items){const visible=supported&&item.position.distanceToSquared(this.lastFocus)<item.radius*item.radius;if(visible!==item.visible){item.visible=visible;this.visibleCount+=visible?1:-1;changed.add(batch);}}
    }
    for(const batch of changed)this.pack(batch);
  }
  decorationParts():DecorationPart[]{return this.batches.flatMap(b=>b.items.map(d=>({geometry:b.geometry,material:b.material,matrix:d.matrix,anchors:d.anchors})));}
  dispose(){for(const batch of this.batches){batch.mesh?.removeFromParent();batch.mesh?.dispose();}for(const g of [this.box,this.bevel,this.pipe,this.pot,this.foliage])g.dispose();for(const m of this.materials)m.dispose();}
}
