import {BoxGeometry,Group,Mesh,InstancedMesh,Matrix4,MeshStandardMaterial,Scene,Vector3} from 'three';
import type {BuildingRegistry} from '../destruction/buildings';
import type {VoxelWorld} from '../world/voxel';
import type {SceneObstacle} from '../input/scene-collisions';
type Entry={group:Group;anchors:Array<{x:number;y:number;z:number}>;bounds:SceneObstacle[];center:Vector3;open:boolean};
/** Legible closed city entrances; existing harbor doorways stay genuinely open. */
export class BuildingEntrances{
 readonly obstacles:SceneObstacle[]=[];private root=new Group();private geometry=new BoxGeometry(1,1,1);private materials=['#36565b','#b9b8a4','#243b43','#bf9f65','#83664b'].map(color=>new MeshStandardMaterial({color,roughness:.78}));private entries:Entry[]=[];
 private batches:Array<{mesh:InstancedMesh;parts:Array<{entry:Entry;matrix:Matrix4}>}>=[];private zero=new Matrix4().makeScale(0,0,0);
 constructor(scene:Scene,private world:VoxelWorld,registry:BuildingRegistry){scene.add(this.root);this.root.name='building-entrances';for(const b of registry.all){if(b.id.startsWith('city-building-')){const x0=b.bounds.minX+1,x1=b.bounds.maxX-1,z=b.bounds.maxZ-1,x=Math.floor((x0+x1)/2)+1,y=b.foundationY;this.entry(x,y,z+1.018,1,false,[{x:x-1,y,z},{x,y:y+1,z},{x,y:y+2,z}]);}}
  for(let row=0;row<2;row++)for(let col=0;col<3;col++){const x=[12,31,50][col]+5,z=row?237:228;this.entry(x,16,z+(row?-.018:.018),row?-1:1,true,[{x:x-2,y:18,z:row?237:227},{x:x+1,y:18,z:row?237:227}]);}
  for(const material of this.materials){const parts:Array<{entry:Entry;matrix:Matrix4}>=[];for(const entry of this.entries)for(const child of [...entry.group.children])if(child instanceof Mesh&&child.material===material){child.updateMatrix();parts.push({entry,matrix:child.matrix.clone()});child.removeFromParent();}if(!parts.length)continue;const mesh=new InstancedMesh(this.geometry,material,parts.length);mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;this.root.add(mesh);this.batches.push({mesh,parts});}this.sync();}
 private entry(x:number,y:number,z:number,n:number,open:boolean,anchors:Entry['anchors']){const group=new Group();group.name=open?'open-harbor-doorway':'closed-city-door';this.root.add(group);const bounds:SceneObstacle[]=[];
  const part=(dx:number,dy:number,dz:number,sx:number,sy:number,sz:number,m:number)=>{const p=new Vector3(x+dx,y+dy,z+n*dz),mesh=new Mesh(this.geometry,this.materials[m]);mesh.position.copy(p);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);bounds.push({minX:p.x-sx/2,maxX:p.x+sx/2,minY:p.y-sy/2,maxY:p.y+sy/2,minZ:p.z-sz/2,maxZ:p.z+sz/2,standable:false,vaultable:false});};
  for(const side of [-1,1])part(side*1.035,1.42,.025,.10,2.84,.12,open?4:1);part(0,2.87,.025,2.17,.12,.12,open?4:1);
  if(!open){part(0,1.39,.016,1.94,2.74,.045,0);for(const side of [-1,1]){part(side*.49,1.78,.050,.83,1.63,.018,2);part(side*.49,.46,.055,.83,.59,.025,4);part(side*.09,1.16,.085,.035,.32,.045,3);}part(0,2.98,.055,.46,.13,.05,3);}
  this.entries.push({group,bounds,anchors,center:new Vector3(x,y+1.2,z+n*1.0),open});}
 sync(){this.obstacles.length=0;for(const e of this.entries){e.group.visible=e.anchors.every(a=>!!this.world.getVoxel(a.x,a.y,a.z));if(e.group.visible)this.obstacles.push(...e.bounds);}for(const b of this.batches){b.parts.forEach((p,i)=>b.mesh.setMatrixAt(i,p.entry.group.visible?p.matrix:this.zero));b.mesh.instanceMatrix.needsUpdate=true;}}
 near(p:{x:number;y:number;z:number}){return this.entries.find(e=>!e.open&&e.group.visible&&Math.abs(p.y-(e.center.y-1.2))<.6&&Math.hypot(p.x-e.center.x,p.z-e.center.z)<1.7);}
 get diagnostics(){return{closed:this.entries.filter(e=>!e.open&&e.group.visible).length,open:this.entries.filter(e=>e.open&&e.group.visible).length};}
 dispose(){this.root.removeFromParent();this.geometry.dispose();this.materials.forEach(m=>m.dispose());}
}
