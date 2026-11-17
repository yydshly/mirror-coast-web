import {BoxGeometry,BufferGeometry,Group,Mesh,MeshStandardMaterial,Scene,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {orientedCollisionBounds,type SceneObstacle} from '../input/scene-collisions';
import type {VoxelWorld} from '../world/voxel';
import {BOAT_LANDINGS} from '../route/boat-route';
import {surfaceFinish} from './surface-finish';

/** Three modest timber landings connect existing dry footing to the same low
 * deck height. Piles terminate in the real seabed; steps stay below 20cm. */
export class BoatLandings{
 readonly obstacles:SceneObstacle[]=[];private root=new Group();private cube=new BoxGeometry();private geometries:BufferGeometry[]=[this.cube];
 private wood=surfaceFinish(new MeshStandardMaterial({color:'#988361',roughness:.94}),'wood');private frame=new MeshStandardMaterial({color:'#536b69',roughness:.72});private rubber=new MeshStandardMaterial({color:'#293534',roughness:.92});private lamp=new MeshStandardMaterial({color:'#dfc28a',emissive:'#f4b764',emissiveIntensity:.25,roughness:.8});
 constructor(scene:Scene,private world:VoxelWorld){this.root.name='coastal-boat-landings';scene.add(this.root);for(const landing of BOAT_LANDINGS)this.create(landing);this.batch();}
 private box(m:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number,solid=false,standable=false){const mesh=new Mesh(this.cube,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;this.root.add(mesh);if(solid)this.obstacles.push({minX:x-sx/2,maxX:x+sx/2,minY:y-sy/2,maxY:y+sy/2,minZ:z-sz/2,maxZ:z+sz/2,standable,vaultable:false});return mesh;}
 private bed(x:number,z:number){for(let y=14;y>=0;y--)if(this.world.getVoxel(Math.floor(x),y,Math.floor(z)))return y+1;return 0;}
 private create(l:typeof BOAT_LANDINGS[number]){
  const end=l.z+l.flat+l.run,low=12.75,steps=Math.max(4,Math.ceil(Math.abs(l.landY-low)/.2)),step=l.run/steps;
  if(l.flat)this.box(this.wood,l.x,l.landY-.10,l.z+l.flat/2,2.4,.20,l.flat,true,true);
  for(let i=0;i<steps;i++){const z=l.z+l.flat+(i+.5)*step,top=l.landY+(low-l.landY)*(i+.5)/steps;this.box(this.wood,l.x,top-.085,z,2.4,.17,step+.015,true,true);}
  this.box(this.wood,l.x,low-.11,(end+l.endZ)/2,2.4,.22,l.endZ-end+.2,true,true);
  for(let z=l.z+.5;z<l.endZ;z+=2.5){const t=Math.max(0,Math.min(1,(z-l.z-l.flat)/l.run)),top=l.landY+(low-l.landY)*t;
   for(const side of [-1,1]){
    const x=l.x+side*1.05,base=Math.min(top-.2,this.bed(x,z)),height=top-base+.75;this.box(this.frame,x,base+height/2,z,.15,height,.15,true,false);
    // The last two metres stay open on both sides for safe boarding.
    if(z+2.5<l.endZ-2){const nextZ=z+2.5,nextT=Math.max(0,Math.min(1,(nextZ-l.z-l.flat)/l.run)),nextTop=l.landY+(low-l.landY)*nextT,a=new Vector3(l.x+side*1.05,top+.74,z),b=new Vector3(l.x+side*1.05,nextTop+.74,nextZ),delta=b.clone().sub(a),length=delta.length(),rail=this.box(this.frame,0,0,0,.055,length,.055);rail.position.copy(a).add(b).multiplyScalar(.5);rail.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.normalize());const bounds=orientedCollisionBounds(rail.position,rail.quaternion,{x:.0275,y:length/2,z:.0275});bounds.standable=false;bounds.vaultable=false;this.obstacles.push(bounds);}
   }
  }
  for(const side of [-1,1]){this.box(this.rubber,l.x+side*1.24,12.46,l.endZ-1,.10,.4,.56,true,false);this.box(this.frame,l.x+side*.85,12.87,l.endZ-.35,.32,.07,.06);}
  this.box(this.frame,l.x-1.05,13.2,l.endZ-.45,.12,.9,.12,true,false);this.box(this.lamp,l.x-1.05,13.68,l.endZ-.45,.21,.13,.21);
 }
 private batch(){for(const material of [this.wood,this.frame,this.rubber,this.lamp]){const meshes=this.root.children.filter((o):o is Mesh=>o instanceof Mesh&&o.material===material),parts=meshes.map(o=>{o.updateMatrix();return o.geometry.toNonIndexed().applyMatrix4(o.matrix);}),g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());meshes.forEach(m=>m.removeFromParent());this.geometries.push(g);const mesh=new Mesh(g,material);mesh.castShadow=mesh.receiveShadow=true;this.root.add(mesh);}}
 update(night:number){this.lamp.emissiveIntensity=.15+night*1.8;}
 dispose(){this.root.removeFromParent();this.geometries.forEach(g=>g.dispose());[this.wood,this.frame,this.rubber,this.lamp].forEach(m=>m.dispose());}
}
