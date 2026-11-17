import {expect,it} from 'vitest';
import {Mesh,Scene,Vector3} from 'three';
import {Bicycle} from '../src/vehicles/bicycle';
import {BICYCLE_RIG as R} from '../src/vehicles/bicycle-rig';
import {bicycleModel} from '../src/vehicles/bicycle-model';
import {VoxelWorld} from '../src/world/voxel';
function ledge(){const world=new VoxelWorld();for(let x=100;x<150;x++)for(let z=155;z<185;z++){world.setVoxel(x,15,z,1,false);if(x>=124)world.setVoxel(x,16,z,1,false);}return world;}
function buriedTyreVertices(scene:Scene,world:VoxelWorld){let buried=0;scene.updateMatrixWorld(true);for(const name of ['bicycle-front-wheel','bicycle-rear-wheel'])scene.getObjectByName(name)!.traverse(o=>{if(!(o instanceof Mesh)||o.geometry.type!=='BufferGeometry'&&o.geometry.type!=='TorusGeometry')return;const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const v=new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);if(world.getVoxel(Math.floor(v.x),Math.floor(v.y+.009),Math.floor(v.z)))buried++;}});return buried;}
it('keeps complete tyres out of a one-metre ledge while approaching in either travel direction and braking',()=>{
 for(const reverse of [false,true]){const world=ledge(),scene=new Scene(),bike=new Bicycle(scene,world);bike.restore({position:{x:120,y:16,z:170},heading:reverse?Math.PI/2:-Math.PI/2,riding:true});bike.setRiding(true);bike.setInput(reverse?-1:1);
  for(let i=0;i<360;i++){bike.update(1/60);if(i%20===0)expect(buriedTyreVertices(scene,world)).toBe(0);}
  expect(bike.position.x).toBeLessThan(123.1);expect(bike.viewState.speed).toBe(0);expect(bike.viewState.blocked).not.toBe('');bike.dispose();
 }
});
it('repairs an imported bicycle straddling the ledge locally instead of averaging its wheels through the ground',()=>{
 const world=ledge(),scene=new Scene(),bike=new Bicycle(scene,world);bike.restore({position:{x:124.2,y:17,z:170},heading:-Math.PI/2,riding:false});bike.update(1/60);
 expect(bike.position.distanceTo(new Vector3(124.2,17,170))).toBeLessThan(2);expect(buriedTyreVertices(scene,world)).toBe(0);expect(bike.canPark).toBe(true);bike.dispose();
});
it('mounts the fixed-length stand on the left chainstay, keeps the pad behind the cranks, and folds clear of the rear spokes',()=>{
 const bike=bicycleModel();
 for(const riding of [false,true])for(let i=0;i<120;i++){
  bike.update(1/60,{phase:0,wheelAngle:0,speed:0,steer:0,pitch:0,riding,footDown:1,groundAt:()=>0});bike.root.updateMatrixWorld(true);
  const hinge=bike.root.getObjectByName('bicycle-kickstand-hinge')!.getWorldPosition(new Vector3()),foot=bike.root.getObjectByName('bicycle-kickstand-foot')!.getWorldPosition(new Vector3());expect(hinge.distanceTo(foot)).toBeCloseTo(R.standLength,5);
 }
 const foot=bike.root.getObjectByName('bicycle-kickstand-foot')!.getWorldPosition(new Vector3());expect(foot.x).toBeLessThan(-.11);expect(foot.y).toBeGreaterThan(.25);expect(foot.z).toBeGreaterThan(.7);bike.dispose();
});
