import {expect,it} from 'vitest';
import {Frustum,InstancedMesh,Matrix4,PerspectiveCamera,Scene,Vector3} from 'three';
import {generateWorld} from '../src/world/generate';
import {StreetArt} from '../src/rendering/street-art';

it('culls distant architectural instances while preserving parked-car slots and destructible detail support',()=>{
 const {world,buildings}=generateWorld(),scene=new Scene(),art=new StreetArt(scene,world,buildings,{people:false});
 try{
  const meshes:InstancedMesh[]=[];scene.traverse(o=>{if(o instanceof InstancedMesh)meshes.push(o);});
  const camera=new PerspectiveCamera(52,1.6,.08,6500);camera.position.set(130,19,162);camera.lookAt(new Vector3(185,18,162));camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);
  const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const total=meshes.reduce((n,m)=>n+m.count,0),submitted=meshes.filter(m=>!m.frustumCulled||frustum.intersectsObject(m)).reduce((n,m)=>n+m.count,0);
  expect(total).toBeGreaterThan(1000);expect(submitted,JSON.stringify({total,submitted})).toBeLessThan(total*.7);
  const matrix=new Matrix4(),active=()=>meshes.reduce((n,m)=>{for(let i=0;i<m.count;i++){m.getMatrixAt(i,matrix);if(Math.abs(matrix.determinant())>1e-10)n++;}return n;},0);
  const before=active(),anchor=art.decorationParts().find(p=>p.anchors[0].y>17)!.anchors[0];world.setVoxel(anchor.x,anchor.y,anchor.z,0);art.sync([`${anchor.x>>5},${anchor.y>>5},${anchor.z>>5}`]);
  expect(active()).toBeLessThan(before);
  const seats=scene.getObjectByName('parked-traffic-sedan-seats') as InstancedMesh;expect(seats.count).toBe(6);expect(seats.frustumCulled).toBe(false);
 }finally{art.dispose();}
});
