import {BoxGeometry,BufferAttribute,BufferGeometry,CylinderGeometry,DoubleSide,ExtrudeGeometry,Group,Line,LineBasicMaterial,Mesh,MeshStandardMaterial,PlaneGeometry,Quaternion,Shape,Vector3,type Material as ThreeMaterial} from 'three';
import {orientedCollisionBounds,type SceneObstacle,type SurfaceMotion} from '../input/scene-collisions';
import type {VoxelWorld} from '../world/voxel';
import {surfaceFinish} from './surface-finish';

export const HARBOR_MOORINGS=[{id:'west-sailboat',x:92.3,z:208.2,yaw:.12,dockX:95.04,accessZ:210.3,color:'#a75b46'},{id:'east-sailboat',x:126.6,z:210,yaw:-.12,dockX:123.96,accessZ:212.1,color:'#4d7180'}]as const;
type Part={bounds:SceneObstacle;center:Vector3;half:Vector3};
type Boat={group:Group;parts:Part[];motion:SurfaceMotion;base:number;phase:number};
type Access={group:Group;bounds:SceneObstacle[];original:Array<{minY:number;maxY:number}>;anchors:Array<{x:number;y:number;z:number}>};

/** Small moored vessels: the rendered deck and collision share one heave pose.
 * Fixed, stepped gangways bridge the real dock height; no boarding teleport. */
export class MooredSailboats{
 readonly obstacles:SceneObstacle[]=[];
 private root=new Group();private cube=new BoxGeometry(1,1,1);
 private geometries=new Set<BufferGeometry>([this.cube]);private materials=new Set<ThreeMaterial>();private boats:Boat[]=[];private accesses:Access[]=[];private elapsed=0;private frame=0;
 private rotation=new Quaternion();private center=new Vector3();
 // Empty/laboratory maps have no seabed and should not acquire harbor props.
 // Existing boats remain afloat when a player subsequently breaks the dock.
 constructor(parent:Group,private world:VoxelWorld){this.root.name='boardable-harbor-boats';parent.add(this.root);for(const mooring of HARBOR_MOORINGS)if(world.getVoxel(Math.floor(mooring.x),0,Math.floor(mooring.z)))this.create(mooring);this.update(0);this.sync();}
 private material(color:string,roughness=.8){const m=new MeshStandardMaterial({color,roughness});this.materials.add(m);return m;}
 private box(parent:Group,material:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number){const mesh=new Mesh(this.cube,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;}
 private create(m:typeof HARBOR_MOORINGS[number]):void{
  const group=new Group();group.name=m.id;group.position.set(m.x,12.85,m.z);group.rotation.y=m.yaw;this.root.add(group);
  const boat:Boat={group,parts:[],motion:{frame:0,delta:{x:0,y:0,z:0}},base:12.85,phase:m.x*.1};this.boats.push(boat);
  const addBounds=(x:number,y:number,z:number,sx:number,sy:number,sz:number,standable=true)=>{const bounds:SceneObstacle={minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0,standable,vaultable:false,motion:boat.motion};boat.parts.push({bounds,center:new Vector3(x,y,z),half:new Vector3(sx/2,sy/2,sz/2)});this.obstacles.push(bounds);};
  const paint=this.material(m.color,.66),wood=surfaceFinish(this.material('#95866b'),'wood'),cream=this.material('#d9d5bf'),metal=this.material('#52615d',.65),glass=this.material('#243e4b',.25);glass.metalness=.2;
  const shape=new Shape();shape.moveTo(-1.45,-3);shape.lineTo(1.45,-3);shape.lineTo(1.66,1.8);shape.lineTo(0,3.65);shape.lineTo(-1.66,1.8);shape.closePath();
  const hullGeometry=new ExtrudeGeometry(shape,{depth:1.05,bevelEnabled:false});hullGeometry.rotateX(Math.PI/2);this.geometries.add(hullGeometry);const hull=new Mesh(hullGeometry,paint);hull.castShadow=hull.receiveShadow=true;group.add(hull);
  const deckGeometry=new ExtrudeGeometry(shape,{depth:.04,bevelEnabled:false});deckGeometry.rotateX(Math.PI/2);deckGeometry.scale(.93,1,.96);this.geometries.add(deckGeometry);const deck=new Mesh(deckGeometry,wood);deck.name=`${m.id}-deck`;deck.position.y=.045;deck.castShadow=deck.receiveShadow=true;group.add(deck);
  // Conservative narrow bands stay within the visible taper at the bow.
  const halfWidth=(z:number)=>z<=1.8?1.45+(z+3)/4.8*.21:Math.max(0,1.66*(3.65-z)/1.85);
  for(let from=-2.88;from<3.5;from+=.4){const to=Math.min(3.5,from+.4),half=Math.min(halfWidth(from/.96),halfWidth(to/.96))*.93;addBounds(0,-.35,(from+to)/2,half*2,.79,to-from);}
  this.box(group,cream,0,.475,-.6,.98,.86,1.65);addBounds(0,.475,-.6,.98,.86,1.65);
  this.box(group,wood,0,.93,-.6,1.1,.07,1.78);addBounds(0,.93,-.6,1.1,.07,1.78);
  const windowGeometry=new PlaneGeometry(.76,.29);this.geometries.add(windowGeometry);
  for(const [z,rotation]of [[.239,0],[-1.439,Math.PI]]as const){const pane=new Mesh(windowGeometry,glass);pane.name='boat-separated-window';pane.position.set(0,.64,z);pane.rotation.y=rotation;pane.receiveShadow=false;group.add(pane);}
  for(const side of [-1,1]){const pane=new Mesh(windowGeometry,glass);pane.position.set(side*.504,.64,-.6);pane.rotation.y=side*Math.PI/2;group.add(pane);}
  for(const side of [-1,1]){this.box(group,wood,side*1.39,.1,-.6,.075,.14,4.4);addBounds(side*1.39,.1,-.6,.075,.14,4.4);}
  const mastGeometry=new CylinderGeometry(.035,.05,5.6,8);this.geometries.add(mastGeometry);const mast=new Mesh(mastGeometry,cream);mast.position.set(-.15,2.5,.65);mast.castShadow=true;group.add(mast);addBounds(-.15,2.5,.65,.10,5.6,.10,false);
  const sailGeometry=new BufferGeometry();sailGeometry.setAttribute('position',new BufferAttribute(new Float32Array([-.08,1.15,.68,-.08,4.85,.68,1.78,1.25,.68]),3));sailGeometry.computeVertexNormals();this.geometries.add(sailGeometry);const fabric=this.material('#cccdbd',.96);fabric.side=DoubleSide;const sail=new Mesh(sailGeometry,fabric);sail.castShadow=true;sail.receiveShadow=false;group.add(sail);
  this.gangway(m,wood,metal);
 }
 private gangway(m:typeof HARBOR_MOORINGS[number],wood:MeshStandardMaterial,metal:MeshStandardMaterial):void{
  const group=new Group();group.name=`${m.id}-gangway`;this.root.add(group);const bounds:SceneObstacle[]=[];
  const end=m.x+.1,start=m.dockX,steps=15,run=(end-start)/steps,width=1.12;
  for(let i=0;i<steps;i++){
   const x=start+(i+.5)*run,top=i>=12?12.91:15-(15-12.91)*(i+.5)/12;
   this.box(group,wood,x,top-.07,m.accessZ,Math.abs(run)+.025,.14,width);
   bounds.push({minX:x-Math.abs(run)/2,maxX:x+Math.abs(run)/2,minY:top-.14,maxY:top,minZ:m.accessZ-width/2,maxZ:m.accessZ+width/2,standable:true,vaultable:false});
   if(i%3===0&&i<12)for(const side of [-1,1]){this.box(group,metal,x,top+.33,m.accessZ+side*.64,.035,.66,.035);bounds.push({minX:x-.025,maxX:x+.025,minY:top,maxY:top+.66,minZ:m.accessZ+side*.64-.025,maxZ:m.accessZ+side*.64+.025,standable:false,vaultable:false});}
  }
  // Leave the lower half-metre open: a person can enter from the foredeck
  // without threading between a rail tip and the boat's gunwale.
  const railEnd=end+(start-end)*.22,railEndY=12.91;
  for(const side of [-1,1]){const rail=this.box(group,metal,(start+railEnd)/2,(15+railEndY)/2+.66,m.accessZ+side*.64,Math.hypot(railEnd-start,railEndY-15),.045,.045);rail.rotation.z=Math.atan((railEndY-15)/(railEnd-start));rail.updateMatrixWorld(true);const q=new Quaternion();rail.getWorldQuaternion(q);const b=orientedCollisionBounds(rail.position,q,{x:rail.scale.x/2,y:.0225,z:.0225});b.standable=false;b.vaultable=false;bounds.push(b);}
  this.obstacles.push(...bounds);this.accesses.push({group,bounds,original:bounds.map(b=>({minY:b.minY,maxY:b.maxY})),anchors:[{x:Math.floor(start),y:14,z:Math.floor(m.accessZ)}]});
  const ropeGeometry=new BufferGeometry().setFromPoints([new Vector3(m.x,13.1,m.z-2.5),new Vector3(start,15.05,m.accessZ-1)]);this.geometries.add(ropeGeometry);const ropeMaterial=new LineBasicMaterial({color:'#a89d7f'});this.materials.add(ropeMaterial);group.add(new Line(ropeGeometry,ropeMaterial));
 }
 update(dt:number):void{
  this.elapsed+=Math.max(0,Math.min(.1,dt));this.frame++;
  for(const b of this.boats){const previous=b.group.position.y;b.group.position.y=b.base+Math.sin(this.elapsed*.62+b.phase)*.027;b.motion.delta.y=b.group.position.y-previous;b.motion.frame=this.frame;b.group.updateMatrixWorld(true);this.rotation.copy(b.group.quaternion);for(const p of b.parts)orientedCollisionBounds(this.center.copy(p.center).applyMatrix4(b.group.matrixWorld),this.rotation,p.half,p.bounds);}
 }
 sync():void{for(const a of this.accesses){const active=a.anchors.every(p=>this.world.getVoxel(p.x,p.y,p.z)!==0);a.group.visible=active;a.bounds.forEach((b,i)=>{b.minY=active?a.original[i].minY:0;b.maxY=active?a.original[i].maxY:-1;});}}
 get diagnostics(){return this.boats.map(b=>({id:b.group.name,position:{...b.group.position},deck:b.group.position.y+.045}));}
 boardingHint(p:{x:number;y:number;z:number}):string|undefined{
  for(const b of this.boats)if(Math.abs(p.x-b.group.position.x)<5&&Math.abs(p.z-b.group.position.z)<4.2&&p.y<16){return p.y<13.6?'已登上泊船 · WASD 走动 · 从船头木阶返回码头':'近岸帆船 · 沿扶手木阶上下船，也可 Space 跳上甲板';}
  return undefined;
 }
 dispose():void{this.root.removeFromParent();for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();}
}
