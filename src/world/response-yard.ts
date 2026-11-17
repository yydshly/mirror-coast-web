import {Scene,Quaternion,Vector3,BoxGeometry,Mesh,MeshStandardMaterial,Matrix4} from 'three';
import type {DecorationPart} from '../destruction/decorations';
import {VoxelWorld} from './voxel';
import {Material as M} from './palette';
import {BuildingRegistry,worldIndex} from '../destruction/buildings';
import {createCoastalCarModel} from '../vehicles/coastal-car-model';
import type {TrafficBodyState} from '../destruction/physics';
import type {SceneObstacle} from '../input/scene-collisions';

export const RESPONSE_YARD_VERSION='mirror-coast-response-yard-v3';
export const YARD_FOOTINGS=[{x:100,z:132},{x:109,z:132},{x:100,z:141},{x:109,z:141}];
export const YARD_CAR={x:65,y:16.85,z:163.65};
export const YARD_TARGET={x:148,y:16.85,z:164};
export function generateResponseYard(){
 const world=new VoxelWorld(),buildings=new BuildingRegistry(),owned:number[]=[];
 const box=(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,m:number,capture=false)=>{
  for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){world.setVoxel(x,y,z,m,false);if(capture&&m)owned.push(worldIndex(x,y,z));}
 };
 box(0,0,0,255,15,219,M.Rock);box(0,15,0,255,15,219,M.Grass);
 box(28,15,159,226,15,170,M.Road);for(let x=30;x<224;x+=9)box(x,15,166,x+3,15,166,M.Stripe);
 for(const p of YARD_FOOTINGS)box(p.x,16,p.z,p.x,19,p.z,M.Rock);
 box(100,20,132,109,20,141,M.Concrete,true);
 for(let y=21;y<=27;y++)for(let z=132;z<=141;z++)for(let x=100;x<=109;x++)if(x===100||x===109||z===132||z===141){
  const window=y>=23&&y<=25&&(x===100||x===109?z%5<2:x%5<2);box(x,y,z,x,y,z,window?M.Window:M.Cream,true);
 }
 box(100,28,132,109,28,141,M.Terracotta,true);buildings.add('yard-foundation-house','四角地基试验屋',20,owned);
 for(const x of [59,72]){box(x,16,156,x,17,156,M.Terracotta);box(x,18,156,x,18,156,M.Cream);}
 // A real soil undercut, rooted tree and articulated bench use the city systems.
 for(let x=130;x<=142;x++)for(let z=126;z<=140;z++){const h=Math.max(0,5-Math.floor(Math.hypot(x-136,z-133)*.55));if(h){box(x,16,z,x,15+h,z,M.Dirt);box(x,15+h,z,x,15+h,z,M.Grass);}}
 box(122,16,130,122,22,130,M.Wood);
 for(let y=20;y<=26;y++)for(let z=126;z<=134;z++)for(let x=118;x<=126;x++)if(((x-122)/3.9)**2+((z-130)/3.3)**2+((y-23)/3.6)**2<1&&world.getVoxel(x,y,z)!==M.Wood)box(x,y,z,x,y,z,M.Leaves);
 for(const chunk of world.chunks.values())chunk.revision=1;
 return{world,buildings,spawn:{x:120,y:27,z:153},lookAt:{x:104.5,y:22,z:136.5},buildingCount:1};
}

export class ResponseYardProps{
 readonly parts:DecorationPart[]=[];private meshes:Mesh[]=[];private geometry=new BoxGeometry(1,1,1);private materials=[new MeshStandardMaterial({color:'#856043',roughness:.85}),new MeshStandardMaterial({color:'#344d53',roughness:.65,metalness:.3})];
 readonly anchors=[{x:118,y:15,z:142},{x:120,y:15,z:142}];
 constructor(scene:Scene){const part=(x:number,y:number,z:number,sx:number,sy:number,sz:number,m=0)=>{const matrix=new Matrix4().makeScale(sx,sy,sz).setPosition(x,y,z),material=this.materials[m],mesh=new Mesh(this.geometry,material);mesh.matrixAutoUpdate=false;mesh.matrix.copy(matrix);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);this.meshes.push(mesh);this.parts.push({geometry:this.geometry,material,matrix,anchors:this.anchors});};
  for(let slat=0;slat<4;slat++)part(119.5,16.49,142.5+(slat-1.5)*.13,2.6,.11,.11);
  for(let slat=0;slat<3;slat++)part(119.5,16.72+slat*.17,142.20,2.6,.12,.09);
  for(const x of [118.5,120.5]){part(x,16.22,142.5,.09,.44,.48,1);part(x,16.72,142.2,.07,.86,.07,1);}
 }
 sync(world:VoxelWorld){const visible=this.anchors.every(a=>world.getVoxel(a.x,a.y,a.z));for(const mesh of this.meshes)mesh.visible=visible;}
}

/** Uses the same car geometry and shared traffic-body collision path as the city. */
export class ResponseYardTarget{
 readonly obstacles:SceneObstacle[]=[{minX:YARD_TARGET.x-2.13,maxX:YARD_TARGET.x+2.13,minY:16,maxY:17.7,minZ:163.03,maxZ:164.97,trafficId:0}];
 private model=createCoastalCarModel();private base=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
 constructor(scene:Scene){scene.add(this.model.root);this.model.root.position.copy(YARD_TARGET);this.model.root.quaternion.copy(this.base);this.model.shell.position.y=-.18;}
 update(states:readonly TrafficBodyState[]){const state=states.find(s=>s.id===0);if(!state)return;this.model.root.position.copy(state.position);this.model.root.quaternion.copy(state.rotation).multiply(this.base);this.model.setGrounded(false);}
 dispose(){this.model.dispose();}
}
