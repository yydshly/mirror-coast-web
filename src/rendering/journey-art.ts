import {BoxGeometry,CanvasTexture,Group,Mesh,MeshStandardMaterial,PlaneGeometry,Scene,SRGBColorSpace} from 'three';
import type {VoxelWorld} from '../world/voxel';
import type {SceneObstacle} from '../input/scene-collisions';
export class JourneyArt{
 readonly obstacles:SceneObstacle[]=[];private entries:{root:Group;x:number;y:number;z:number;bounds?:SceneObstacle[]}[]=[];
 constructor(scene:Scene,private world:VoxelWorld){
  const wood=new MeshStandardMaterial({color:'#897253',roughness:.95}),dark=new MeshStandardMaterial({color:'#304d4c',roughness:.9}),box=new BoxGeometry(1,1,1);
  const put=(g:Group,m:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const mesh=new Mesh(box,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;g.add(mesh);return mesh;};
  for(const [x,z,line,sub]of [[138,169,'沿海一日 →','海堤散步 · 看海长椅'],[179,170,'看海长椅 →','绕到座位前 · E 坐下'],[258,170,'潮线沙滩 ↓','沿木踏步下行 · 原路返回'],[262,178,'潮线记录','漂流木旁 · E 记录海岸'],[248,169,'海岸公路 →','旅行车 · 东港 · 南湾'],[351,170,'东港 · 欢迎步行']] as const){
   const y=this.ground(x,z);if(y===null)continue;const root=new Group();root.position.set(x,y,z);put(root,wood,0,.72,0,.09,1.44,.09);put(root,dark,0,1.32,0,1.85,.65,.09);
   const c=document.createElement('canvas');c.width=768;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#304d4c';ctx.fillRect(0,0,768,256);ctx.strokeStyle='#c4b78d';ctx.lineWidth=3;ctx.strokeRect(16,16,736,224);ctx.textAlign='center';ctx.fillStyle='#f0e4c7';ctx.font='bold 48px sans-serif';ctx.fillText(line,384,110);ctx.font='28px sans-serif';ctx.fillText(sub??'停车下车 · 继续步行探索',384,182);const texture=new CanvasTexture(c);texture.colorSpace=SRGBColorSpace;
   const face=new Mesh(new PlaneGeometry(1.82,.62),new MeshStandardMaterial({map:texture,roughness:1}));face.position.set(0,1.32,.048);root.add(face);const back=face.clone();back.position.z=-.048;back.rotation.y=Math.PI;root.add(back);scene.add(root);const bounds={minX:x-.93,maxX:x+.93,minY:y+1,maxY:y+1.66,minZ:z-.08,maxZ:z+.08,standable:false};this.entries.push({root,x,y:y-1,z,bounds:[bounds,{minX:x-.045,maxX:x+.045,minY:y,maxY:y+1.44,minZ:z-.045,maxZ:z+.045,standable:false}]});
  }
  const y=this.ground(261,181);if(y!==null){const root=new Group();root.position.set(261,y,181);put(root,wood,0,.12,0,1.7,.2,.19).rotation.y=.38;put(root,wood,.4,.16,0,.16,.15,.55).rotation.y=-.25;scene.add(root);this.entries.push({root,x:260,y:y-1,z:180.8});}this.update();
 }
 private ground(x:number,z:number){for(let y=19;y>=12;y--)if(this.world.getVoxel(x,y,z)&&!this.world.getVoxel(x,y+1,z)&&!this.world.getVoxel(x,y+2,z))return y+1;return null;}
 update(){this.obstacles.length=0;for(const e of this.entries){e.root.visible=!!this.world.getVoxel(e.x,e.y,e.z);if(e.root.visible&&e.bounds)this.obstacles.push(...e.bounds);}}
}
