import {afterEach,expect,it} from 'vitest';
import {CylinderGeometry,Mesh,MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
const dispose:Array<()=>void>=[];afterEach(()=>dispose.splice(0).reverse().forEach(f=>f()));
function buriedVertices(scene:Scene,world:VoxelWorld):number{
 let buried=0;scene.updateMatrixWorld(true);
 scene.getObjectByName('coastal-road-car')!.traverse(o=>{if(!(o instanceof Mesh))return;const tyre=o.geometry instanceof CylinderGeometry&&o.geometry.parameters.radiusTop===.39;if(!tyre&&o.name!=='car-bonnet')return;const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const v=new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld),x=Math.floor(v.x),y=Math.floor(v.y),z=Math.floor(v.z);if(!world.getVoxel(x,y,z))continue;let depth=Infinity;for(const [dx,dy,dz,d]of [[-1,0,0,v.x-x],[1,0,0,x+1-v.x],[0,-1,0,v.y-y],[0,1,0,y+1-v.y],[0,0,-1,v.z-z],[0,0,1,z+1-v.z]])if(!world.getVoxel(x+dx,y+dy,z+dz))depth=Math.min(depth,d);if(depth>.02)buried++;}});
 return buried;
}
it.each([{reverse:false,steer:0},{reverse:true,steer:0},{reverse:false,steer:-.4},{reverse:true,steer:.4}])('keeps tyre sides and the bonnet out of a grass shelf for $reverse / $steer',async({reverse,steer})=>{
 const world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256});for(let x=245;x<315;x++)for(let z=145;z<180;z++)world.setVoxel(x,15,z,Material.Road,false);
 for(let x=274;x<286;x++)for(let z=165;z<180;z++)for(let y=16;y<=17;y++)world.setVoxel(x,y,z,Material.Grass,false);
 const scene=new Scene(),mat=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}}),camera=new PerspectiveCamera(),car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});dispose.push(()=>mat.dispose(),()=>physics.dispose(),()=>car.dispose());
 car.restore({position:{x:266,y:16.85,z:164},heading:reverse?Math.PI/2:-Math.PI/2,speed:0});car.setDriving(true);car.setInput({throttle:reverse?-1:1,steer});let buried=0;
 for(let frame=0;frame<360;frame++){
  car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);
  if(frame%12!==0)continue;buried+=buriedVertices(scene,world);
 }
 expect(buried,JSON.stringify(car.snapshot())).toBe(0);expect(car.snapshot().position.y).toBeGreaterThan(16.5);
});
it.each([false,true])('recovers a parked save already embedded in a grass ledge before simulating: dynamic=$0',async(dynamic)=>{
 const world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256});for(let x=245;x<315;x++)for(let z=145;z<180;z++)world.setVoxel(x,15,z,Material.Road,false);
 for(let x=274;x<286;x++)for(let z=165;z<180;z++)for(let y=16;y<=17;y++)world.setVoxel(x,y,z,Material.Grass,false);
 const scene=new Scene(),mat=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}}),notices:string[]=[],car=CoastalCar.create(scene,physics,world,{onNotice:m=>notices.push(m)});dispose.push(()=>mat.dispose(),()=>physics.dispose(),()=>car.dispose());
 const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-Math.PI/2);
 car.restore({position:{x:274.2,y:16.85,z:164.1},heading:-Math.PI/2,speed:0,...dynamic?{rigidBody:{rotation,linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}}:{}});
 car.beforePhysics(1/60);
 expect(car.position.distanceTo(new Vector3(274.2,16.85,164.1))).toBeGreaterThan(.2);expect(buriedVertices(scene,world)).toBe(0);expect(car.snapshot().rigidBody).toBeUndefined();expect(car.viewState.driving).toBe(false);expect(notices.some(n=>n.includes('存档中的汽车'))).toBe(true);
 const p=car.snapshot().position;car.beforePhysics(1/60);expect(car.snapshot().position).toEqual(p);
});
it('keeps a valid overturned save on the road instead of applying upright road rescue',async()=>{
 const world=new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256});for(let x=245;x<315;x++)for(let z=145;z<180;z++)world.setVoxel(x,15,z,Material.Road,false);
 const scene=new Scene(),mat=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}}),car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});dispose.push(()=>mat.dispose(),()=>physics.dispose(),()=>car.dispose());
 const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2),position={x:266,y:17.15,z:164};
 car.restore({position,heading:0,speed:0,rigidBody:{rotation,linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}});car.beforePhysics(1/60);
 expect(car.snapshot().position).toEqual(position);expect(car.viewState.overturned).toBe(true);expect(car.snapshot().rigidBody).toBeDefined();
});
