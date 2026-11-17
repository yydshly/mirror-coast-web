import {it,expect} from 'vitest';
import {Box3,DoubleSide,Group,Mesh,MeshStandardMaterial,Raycaster,Vector3} from 'three';
import {createBusInterior} from '../src/vehicles/bus-interior';
it('shows seats and seated people through the side windows while keeping the central aisle clear',()=>{
 const parts=createBusInterior(),root=new Group(),materials:MeshStandardMaterial[]=[];
 try{
  for(const p of parts){const m=new MeshStandardMaterial({vertexColors:true,transparent:p.transparent??false,side:DoubleSide});materials.push(m);const mesh=new Mesh(p.geometry,m);mesh.name=p.name;root.add(mesh);}root.updateMatrixWorld(true);
  const cast=(p:Vector3,d:Vector3)=>new Raycaster(p,d).intersectObject(root,true).filter(h=>!(h.object as Mesh).material||(h.object as Mesh).material instanceof MeshStandardMaterial&&!(h.object as Mesh<Mesh['geometry'],MeshStandardMaterial>).material.transparent);
  const seat=cast(new Vector3(3,1.60,1.75),new Vector3(-1,0,0))[0];expect(seat.object.name).toBe('bus-seats');expect(seat.point.x).toBeLessThan(.9);
  const passenger=cast(new Vector3(3,1.63,-.95),new Vector3(-1,0,0))[0];expect(passenger.object.name).toBe('bus-cabin');expect(passenger.point.x).toBeLessThan(.9);
  const aisle=cast(new Vector3(.16,.95,2.05),new Vector3(0,0,-1))[0];expect(aisle.distance).toBeGreaterThan(4.5);
  const bounds=new Box3().setFromObject(root);expect(bounds.max.y).toBeLessThanOrEqual(2.65);expect(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x))).toBeLessThan(1.03);
  expect(parts.length).toBeLessThanOrEqual(6);
 }finally{parts.forEach(p=>p.geometry.dispose());materials.forEach(m=>m.dispose());}
});
