import {expect,it} from 'vitest';
import {InstancedMesh,Matrix4,Quaternion,Raycaster,Scene,Vector3} from 'three';
import {generateWorld} from '../src/world/generate';
import {StreetArt} from '../src/rendering/street-art';
it('shows interior seats and a steering wheel through every parked car and keeps all parts attached after a crash',()=>{
 const {world,buildings}=generateWorld(),scene=new Scene(),art=new StreetArt(scene,world,buildings,{people:false});
 try{
  const seats=scene.getObjectByName('parked-traffic-sedan-seats') as InstancedMesh,trim=scene.getObjectByName('parked-traffic-sedan-trim') as InstancedMesh,wheels=scene.getObjectByName('parked-traffic-steering-wheel') as InstancedMesh;
  const cars=art.propFootings.filter(f=>f.kind==='car');expect(cars).toHaveLength(6);expect(seats.count).toBe(6);expect(wheels.count).toBe(6);
  const before:Matrix4[]=[];
  for(let i=0;i<cars.length;i++){
   const matrix=new Matrix4();seats.getMatrixAt(i,matrix);before.push(matrix.clone());
   const origin=new Vector3(.385,1.0,-.10).applyMatrix4(matrix),direction=new Vector3(-1,0,0).transformDirection(matrix);
   const hit=new Raycaster(origin,direction).intersectObject(seats)[0];expect(hit).toBeDefined();expect(hit.instanceId).toBe(i);
   const glassRay=new Raycaster(new Vector3(-.385,1.19,-4).applyMatrix4(matrix),new Vector3(0,0,1).transformDirection(matrix));scene.updateMatrixWorld(true);
   const hits=glassRay.intersectObject(scene,true).filter(h=>h.object instanceof InstancedMesh&&!(h.object.material as {transparent?:boolean}).transparent);
   expect(hits[0]?.object.name).toBe('parked-traffic-sedan-seats');
  }
  const car=cars[0],q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.5),position={x:car.x+5,y:car.y+.675,z:car.z};
  art.syncTraffic([{id:18,position,rotation:{x:q.x,y:q.y,z:q.z,w:q.w},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}]);
  const moved=new Matrix4();seats.getMatrixAt(0,moved);expect(new Vector3().setFromMatrixPosition(moved).x).toBeCloseTo(car.x+5,4);
  for(const mesh of [trim,wheels]){const m=new Matrix4();mesh.getMatrixAt(0,m);expect(new Vector3().setFromMatrixPosition(m).distanceTo(new Vector3().setFromMatrixPosition(moved))).toBeLessThan(1.2);}
  for(let i=1;i<cars.length;i++){const m=new Matrix4();seats.getMatrixAt(i,m);expect(m.equals(before[i])).toBe(true);}
 }finally{art.dispose();}
});
