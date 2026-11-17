import {afterEach,expect,it} from 'vitest';
import {Euler,MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene} from 'three';
import {CollapsePhysics} from '../src/destruction/physics';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import type {SceneObstacle} from '../src/input/scene-collisions';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
it.each([14.6,13.9])('restores and drives on a supported incline below the spawn elevation: %s',async height=>{
 const world=new VoxelWorld({minX:0,maxX:512,minZ:0,maxZ:256});
 for(let x=240;x<295;x++)for(let z=148;z<180;z++){for(let y=10;y<13;y++)world.setVoxel(x,y,z,Material.Road);if(x<255)for(let y=13;y<16;y++)world.setVoxel(x,y,z,Material.Road);}
 const top=(x:number)=>height+(270-x)*.25;
 const slope:SceneObstacle={minX:260,maxX:280,minY:top(280)-.01,maxY:top(260)+.01,minZ:148,maxZ:180,surface:[top(260),top(280),top(260),top(280)]};
 const scene=new Scene(),mat=new MeshStandardMaterial(),camera=new PerspectiveCamera(),physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}}),car=CoastalCar.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>mat.dispose(),()=>physics.dispose(),()=>car.dispose());
 car.setSurfaceProvider(x=>x>=260&&x<=280?top(x):null);car.setObstacleProvider(()=>[slope]);
 const q=new Quaternion().setFromEuler(new Euler(Math.atan(.25),Math.PI/2,0,'YXZ'));
 car.restore({position:{x:270,y:height+.85,z:164},heading:Math.PI/2,speed:0,rigidBody:{rotation:q,linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}});car.setDriving(true);
 const run=(s:number)=>{for(let i=0;i<s*60;i++){car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);}};
 run(2);expect(car.viewState.recovering,JSON.stringify(car.snapshot())).toBe(false);
 const start=car.position.clone();car.setInput({throttle:.65});run(2);expect(car.position.x,JSON.stringify(car.snapshot())).toBeLessThan(start.x-4.5);
 expect(car.viewState.overturned).toBe(false);
});
