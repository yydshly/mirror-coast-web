import {Box3,Group,Matrix4,Mesh,Quaternion,Vector3,type BufferGeometry,type Material,type Scene} from 'three';
import type {CollapsePhysics} from './physics';
import type {VoxelWorld} from '../world/voxel';
import type {Vec3,Quat} from './types';
import {orientedCollisionBounds,type SceneObstacle} from '../input/scene-collisions';

export type DecorationState={id:string;position:Vec3;rotation:Quat;linearVelocity:Vec3;angularVelocity:Vec3;sleeping?:boolean};
export type DecorationPart={geometry:BufferGeometry;material:Material|Material[];matrix:Matrix4;anchors:Vec3[];binding?:string};
type Binding={id:string;parts:DecorationPart[];anchors:Vec3[];chunks:Set<string>;entry?:{group:Group;motion:ReturnType<CollapsePhysics['createDecoration']>;bounds:SceneObstacle[];sleeping?:boolean}};
const chunk=(p:Vec3)=>`${p.x>>5},${p.y>>5},${p.z>>5}`;

/** Original meshes fall together. Source instances remain governed by their anchors. */
export class DecorationPhysics{
 private bindings=new Map<string,Binding>();private dirty=new Set<string>();private byChunk=new Map<string,Set<Binding>>();private active=new Set<Binding>();private obstacleCache:SceneObstacle[]=[];private restored=new Map<string,DecorationState>();
 constructor(private scene:Scene,private world:VoxelWorld,private physics:CollapsePhysics,states:DecorationState[]=[]){for(const s of states)this.restored.set(s.id,s);}
 register(scope:string,parts:DecorationPart[]){
  for(const part of parts){if(!part.anchors.length)continue;
   const id=scope+(part.binding?':'+part.binding:'')+':'+[...new Set(part.anchors.map(a=>`${a.x},${a.y},${a.z}`))].sort().join(';');
   let b=this.bindings.get(id);if(!b){b={id,parts:[],anchors:part.anchors,chunks:new Set(part.anchors.map(chunk))};this.bindings.set(id,b);for(const k of b.chunks){let values=this.byChunk.get(k);if(!values){values=new Set();this.byChunk.set(k,values);}values.add(b);}}b.parts.push(part);
  }
 }
 prepareMaterials():()=>void{
  const group=new Group(),seen=new Set<Material|Material[]>();
  for(const b of this.bindings.values())for(const p of b.parts)if(!seen.has(p.material)){seen.add(p.material);group.add(new Mesh(p.geometry,p.material));}
  this.scene.add(group);return()=>group.removeFromParent();
 }
 invalidate(keys:Iterable<string>){for(const key of keys)this.dirty.add(key);}
 update(accepted:(key:string)=>boolean){
  let created=0,pending=0;let awake=this.diagnostics.awake;const candidates=new Set<Binding>(this.active);for(const k of this.dirty)for(const b of this.byChunk.get(k)??[])candidates.add(b);for(const id of this.restored.keys()){const b=this.bindings.get(id);if(b)candidates.add(b);}
  for(const b of candidates){
   const relevant=this.restored.has(b.id)||[...b.chunks].some(k=>this.dirty.has(k));
   if(!b.entry&&relevant&&b.chunks.size&&[...b.chunks].every(accepted)&&b.anchors.some(a=>!this.world.getVoxel(a.x,a.y,a.z))){
    if(created>=2||awake>=32){pending++;continue;}this.detach(b,this.restored.get(b.id));this.restored.delete(b.id);created++;awake++;
   }
   if(b.entry){const e=b.entry,body=e.motion.body;if(e.sleeping&&body.isSleeping())continue;e.sleeping=body.isSleeping();e.group.position.copy(body.translation());e.group.quaternion.copy(body.rotation());
    e.motion.boxes.forEach((box,i)=>orientedCollisionBounds(new Vector3().copy(box.center).applyQuaternion(e.group.quaternion).add(e.group.position),new Quaternion().copy(e.group.quaternion).multiply(new Quaternion().copy(box.rotation)),box.half,e.bounds[i]));
   }
  }
  // Keep dirty chunks until every newly unsupported binding has been admitted.
  if(!created&&!pending&&[...this.dirty].every(accepted))this.dirty.clear();
 }
 private detach(b:Binding,state?:DecorationState){
  const bounds=new Box3();for(const p of b.parts){p.geometry.computeBoundingBox();bounds.union(p.geometry.boundingBox!.clone().applyMatrix4(p.matrix));}
  const center=bounds.getCenter(new Vector3()),inverse=new Matrix4().makeTranslation(-center.x,-center.y,-center.z),group=new Group();group.name=`fallen-decoration:${b.id}`;
  const boxes:Array<{center:Vec3;half:Vec3;rotation:Quat}>=[];
  for(const p of b.parts){const matrix=new Matrix4().multiplyMatrices(inverse,p.matrix),mesh=new Mesh(p.geometry,p.material);mesh.matrixAutoUpdate=false;mesh.matrix.copy(matrix);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
   const position=new Vector3(),q=new Quaternion(),scale=new Vector3();matrix.decompose(position,q,scale);const bb=p.geometry.boundingBox!,c=bb.getCenter(new Vector3()).multiply(scale).applyQuaternion(q).add(position),half=bb.getSize(new Vector3()).multiply(scale).multiplyScalar(.5);
   boxes.push({center:c,half:{x:Math.max(.015,Math.abs(half.x)),y:Math.max(.015,Math.abs(half.y)),z:Math.max(.015,Math.abs(half.z))},rotation:q});
  }
  const motion=this.physics.createDecoration(state?.position??center,boxes,state),walk=boxes.map(()=>({minX:0,minY:0,minZ:0,maxX:0,maxY:0,maxZ:0,standable:false,physicsManaged:true}));
  group.position.copy(state?.position??center);group.quaternion.copy(state?.rotation??new Quaternion());this.scene.add(group);b.entry={group,motion,bounds:walk};this.active.add(b);this.obstacleCache.push(...walk);
 }
 get obstacles():SceneObstacle[]{return this.obstacleCache;}
 snapshot():DecorationState[]{const states=[...this.restored.values()];for(const b of this.active)if(b.entry){const body=b.entry.motion.body;states.push({id:b.id,position:{...body.translation()},rotation:{...body.rotation()},linearVelocity:{...body.linvel()},angularVelocity:{...body.angvel()},sleeping:body.isSleeping()});}return states;}
 get diagnostics(){let fallen=0,awake=0;for(const b of this.active)if(b.entry){fallen++;if(!b.entry.motion.body.isSleeping())awake++;}return{bindings:this.bindings.size,fallen,awake,pending:this.dirty.size};}
}
