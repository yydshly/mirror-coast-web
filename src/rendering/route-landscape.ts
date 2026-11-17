import {CylinderGeometry,Group,IcosahedronGeometry,InstancedMesh,Matrix4,MeshStandardMaterial,Quaternion,Vector3,type BufferGeometry,type Scene} from 'three';
import {partCollisionBounds,type SceneObstacle} from '../input/scene-collisions';
import type {DecorationPart} from '../destruction/decorations';
import {NAVIGATION_LINES} from '../gameplay/navigation';
import {Material} from '../world/palette';
import {regionalHeightAt} from '../world/region-terrain';
import {REGION_ROADS,sampleRegionalRoad} from '../world/region-layout';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
import {surfaceFinish} from './surface-finish';

type Part={geometry:BufferGeometry;material:MeshStandardMaterial;matrix:Matrix4;anchors:Vector3Like[];solid?:SceneObstacle;falling:boolean};
type Batch={mesh:InstancedMesh;parts:Part[]};
const segmentDistance=(x:number,z:number,a:{x:number;z:number},b:{x:number;z:number})=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);};
const footways=NAVIGATION_LINES.filter(l=>l.kind==='foot');
const trailClear=(x:number,z:number,r:number)=>!footways.some(l=>l.points.slice(1).some((b,i)=>segmentDistance(x,z,l.points[i],b)<r));

/** Road-scale planting frames the journey. Distant zones have no per-frame
 * instance uploads; editable ground remains the only source of support. */
export class RouteLandscape{
 readonly obstacles:SceneObstacle[]=[];
 private root=new Group();private parts:Part[]=[];private batches:Batch[]=[];
 private trunk=new CylinderGeometry(.13,.22,1,7);private crown=new IcosahedronGeometry(1,0);private grass=new CylinderGeometry(0,.055,.7,3);
 private wood=surfaceFinish(new MeshStandardMaterial({color:'#73614b',roughness:1}),'wood');
 private leaves=[new MeshStandardMaterial({color:'#65735a',roughness:1}),new MeshStandardMaterial({color:'#485d4d',roughness:1}),new MeshStandardMaterial({color:'#828664',roughness:1})];
 private grasses=[new MeshStandardMaterial({color:'#a39c70',roughness:1}),new MeshStandardMaterial({color:'#7e8a62',roughness:1})];
 private wind={value:0};private zero=new Matrix4().makeScale(0,0,0);private trees=0;private plants=0;
 constructor(scene:Scene,private world:VoxelWorld){
  this.root.name='coastal-route-landscape';scene.add(this.root);
  for(const material of [...this.leaves,...this.grasses])material.onBeforeCompile=s=>{s.uniforms.uRouteWind=this.wind;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float uRouteWind;').replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x+=sin(uRouteWind*1.1+instanceMatrix[3].x*.11+instanceMatrix[3].z*.07)*max(0.,position.y+.5)*.045;');};
  // A green edge connects the shops to the broad open waterfront. Crossings,
  // existing doorways and the pier approach retain their clear walking width.
  for(const x of [18,61,106,151,195,241])for(const offset of [-3,3])this.treeAt(x+offset,155.2,4.2+(x%3)*.35,false);
  for(let i=0;i<18;i++){
   const x=280+i*18,z=181+Math.sin(i*.9)*4;
   if(i%3===0)this.treeAt(x,z,3.8+(i%4)*.4,true);
  }
  for(const road of REGION_ROADS.filter(r=>r.id==='east-coast'||r.id==='west-coast')){
   let distance=0;
   for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    for(let along=10;along<length;along+=23){
     const n=Math.floor((distance+along)/23);if(n%5===2)continue;
     const t=along/length,x=a.x+dx*t,z=a.z+dz*t;
     for(const side of [-1,1]){const offset=side*(12+(n%3)*2);this.treeAt(x-dz/length*offset,z+dx/length*offset,5.2+(n%4)*.45,true);if(n%3===0)this.treeAt(x-dz/length*(offset+side*4)-3,z+dx/length*(offset+side*4)+1,3.8,true);}
    }
    distance+=length;
   }
  }
  // Wind-shaped clusters lead around the westward bends and open out at the
  // headland. They stay outside the carriageway and the low coastal stair.
  for(const [x,z]of [[-28,177],[-45,176],[-67,166],[-83,163],[-103,151],[-121,143],[-141,129],[-157,119],[-189,88],[-201,93]]){
   this.treeAt(x,z,4.4+(Math.abs(x)%3)*.55,true);this.treeAt(x-3,z+2,3.5,true);
  }
  // Irregular groves frame three stretches, leaving long sea-facing gaps.
  // This breaks the evenly spaced roadside rhythm without hiding the coast.
  for(const [cx,cz]of [[310,183],[411,182],[545,185],[-47,178],[-119,148]])for(let i=0;i<7;i++){
   const a=i*2.399,r=2+Math.sqrt(i)*2.1;this.treeAt(cx+Math.cos(a)*r,cz+Math.sin(a)*r,3.5+(i%4)*.8,true);
  }
  for(let i=0;i<1400;i++){
   const east=i<900,x=east?277+(i*19.717)%451:-210+(i*17.913)%198,z=east?153+(i*13.231)%40:99+(i*11.371)%76;
   const y=this.floor(x,z);if(y===null||!trailClear(x,z,1.8))continue;
   const road=sampleRegionalRoad(x,z,30);if(road&&road.distance<road.halfWidth+road.shoulder+2)continue;
   // Broad patches and clear gaps read from the road; individual blades alone
   // had left a uniform speckled field in the long coastal view.
   const patch=Math.sin(x*.065+Math.sin(z*.08)*2)+Math.cos(z*.13-x*.025);if(patch<-.35)continue;
   if(x>602&&Math.abs(x-657.5)<4||x>620&&Math.hypot(x-628,z-158)<8||Math.hypot(x-694,z-164)<5)continue;
   const anchors=[{x:Math.floor(x),y:y-1,z:Math.floor(z)}],height=.35+(i%6)*.095+Math.max(0,patch)*.1;
   for(const side of [-1,1])this.add(this.grass,this.grasses[i%2],{x:x+side*.06,y:y+height*.5,z},new Vector3(.8,height/.7,.8),anchors,false,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),side*.18));
   this.plants++;
  }
  // Batch by 64m zone and material. The camera can cull whole stretches of
  // vegetation instead of submitting the entire coast for every street view.
  const groups=new Map<string,Part[]>();
  for(const p of this.parts){const e=p.matrix.elements,key=`${Math.floor(e[12]/64)},${Math.floor(e[14]/64)},${p.geometry.id},${p.material.id}`;const g=groups.get(key);if(g)g.push(p);else groups.set(key,[p]);}
  for(const parts of groups.values()){
   const first=parts[0],mesh=new InstancedMesh(first.geometry,first.material,parts.length);mesh.name='route-landscape-zone';parts.forEach((p,i)=>mesh.setMatrixAt(i,p.matrix));mesh.castShadow=first.falling;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);this.batches.push({mesh,parts});
  }
  this.sync();
 }
 private floor(x:number,z:number):number|null{
  const top=regionalHeightAt(x,z);
  for(let y=Math.min(83,top+1);y>=Math.max(12,top-1);y--){const m=this.world.getVoxel(Math.floor(x),y,Math.floor(z));if((m===Material.Grass||m===Material.Sand)&&!this.world.getVoxel(Math.floor(x),y+1,Math.floor(z)))return y+1;}
  return null;
 }
 private treeAt(x:number,z:number,height:number,lean:boolean){
  const y=this.floor(x,z);if(y===null||y<14||!trailClear(x,z,3.2))return;
  const road=sampleRegionalRoad(x,z,14);if(road&&road.distance<road.halfWidth+road.shoulder+2.4)return;
  for(const dx of [-.2,.2])for(const dz of [-.2,.2])if(this.floor(x+dx,z+dz)!==y)return;
  for(const dx of [-1.8,0,1.8])for(const dz of [-1.8,0,1.8])for(let h=1;h<=height+2;h++)if(this.world.getVoxel(Math.floor(x+dx),Math.floor(y+h),Math.floor(z+dz)))return;
  const anchors=[{x:Math.floor(x),y:y-1,z:Math.floor(z)}],tilt=lean?-.16:-.045,q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),tilt);
  const center=new Vector3(0,height*.45,0).applyQuaternion(q).add(new Vector3(x,y,z));
  this.add(this.trunk,this.wood,center,new Vector3(1,height*.9,1),anchors,true,q);
  for(let i=0;i<3;i++){
   const p=new Vector3((i-1)*.65,height*.72+Math.sin(i*1.7)*.55,i%2?.35:-.35).applyQuaternion(q).add(new Vector3(x,y,z));
   this.add(this.crown,this.leaves[(this.trees+i)%3],p,new Vector3(1.65+(i%2)*.4,lean?.8:1.3,1.45),anchors,true);
  }
  this.trees++;
 }
 private add(geometry:BufferGeometry,material:MeshStandardMaterial,position:Vector3Like,scale:Vector3,anchors:Vector3Like[],falling:boolean,q=new Quaternion()){
  const matrix=new Matrix4().compose(new Vector3().copy(position),q,scale),p:Part={geometry,material,matrix,anchors,falling};
  if(geometry===this.trunk||geometry===this.crown){
   p.solid=partCollisionBounds(geometry,matrix,false);
   if(geometry===this.crown){
    // Preserve the faceted silhouette instead of colliding with empty box corners.
    const vertices=geometry.getAttribute('position'),hull=new Float32Array(vertices.count*3),v=new Vector3();
    const center=new Vector3((p.solid.minX+p.solid.maxX)/2,(p.solid.minY+p.solid.maxY)/2,(p.solid.minZ+p.solid.maxZ)/2);
    for(let i=0;i<vertices.count;i++){v.fromBufferAttribute(vertices,i).applyMatrix4(matrix).sub(center);hull.set([v.x,v.y,v.z],i*3);}
    p.solid.hull=hull;
   }
  }
  this.parts.push(p);
 }
 sync(){this.obstacles.length=0;for(const b of this.batches){b.parts.forEach((p,i)=>{const alive=p.anchors.every(a=>!!this.world.getVoxel(a.x,a.y,a.z));b.mesh.setMatrixAt(i,alive?p.matrix:this.zero);if(alive&&p.solid)this.obstacles.push(p.solid);});b.mesh.instanceMatrix.needsUpdate=true;}}
 update(dt:number,focus:Vector3Like){this.wind.value+=dt;for(const b of this.batches){const e=b.parts[0].matrix.elements;b.mesh.visible=Math.hypot(e[12]-focus.x,e[14]-focus.z)<(b.parts[0].falling?290:170);}}
 decorationParts():DecorationPart[]{return this.parts.filter(p=>p.falling).map(p=>({geometry:p.geometry,material:p.material,matrix:p.matrix,anchors:p.anchors}));}
 get diagnostics(){return{trees:this.trees,plants:this.plants,batches:this.batches.length,visibleBatches:this.batches.filter(b=>b.mesh.visible).length};}
 dispose(){this.root.removeFromParent();for(const g of [this.trunk,this.crown,this.grass])g.dispose();for(const m of [this.wood,...this.leaves,...this.grasses])m.dispose();}
}
