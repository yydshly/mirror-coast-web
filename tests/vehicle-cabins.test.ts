import {describe,it,expect} from 'vitest';
import {Box3,Mesh,Raycaster,Vector3,type Object3D,type MeshStandardMaterial} from 'three';
import {createCoastalCarModel} from '../src/vehicles/coastal-car-model';
import {createHelicopterModel} from '../src/vehicles/model';
const point=(root:Object3D,name:string)=>root.getObjectByName(name)!.getWorldPosition(new Vector3());
const belongsTo=(node:Object3D,parent:Object3D):boolean=>node===parent||!!node.parent&&belongsTo(node.parent,parent);
describe('occupied vehicle cabins',()=>{
 it('drives the new needles from actual speed, rotor rpm and altitude inputs',()=>{
  const car=createCoastalCarModel(),heli=createHelicopterModel();
  try{
   car.updateCabin(.016,true,0,false,0);const parked=car.root.getObjectByName('car-instrument-needle-0')!.rotation.z;car.updateCabin(.016,true,.5,false,20);expect(car.root.getObjectByName('car-instrument-needle-0')!.rotation.z).toBeLessThan(parked-2);
   heli.updateCabin(.016,true,{pitch:0,roll:0,yaw:0,lift:0,speed:0,altitude:0,rpm:0});const cold=heli.root.getObjectByName('helicopter-instrument-needle-2')!.rotation.z;heli.updateCabin(.016,true,{pitch:0,roll:0,yaw:0,lift:0,speed:12,altitude:35,rpm:1});expect(heli.root.getObjectByName('helicopter-instrument-needle-2')!.rotation.z).toBeLessThan(cold-4);
  }finally{car.dispose();heli.dispose();}
 });
 it.each(['car','helicopter'] as const)('shows the actual %s driver through its canopy, and empties the seat on exit',kind=>{
  const model=kind==='car'?createCoastalCarModel():createHelicopterModel(),driver=model.root.getObjectByName(`${kind}-driver`)!;
  try{
   expect(driver.visible).toBe(false);
   if(kind==='car')(model as ReturnType<typeof createCoastalCarModel>).updateCabin(.016,true,0,false);
   else(model as ReturnType<typeof createHelicopterModel>).updateCabin(.016,true,{pitch:0,roll:0,yaw:0,lift:0});
   model.root.updateMatrixWorld(true);expect(driver.visible).toBe(true);expect(driver.getObjectByName('explorer-daypack')!.visible).toBe(false);
   const head=driver.getObjectByName('explorer-head')!,headBox=new Box3().setFromObject(head),headCenter=headBox.getCenter(new Vector3());
   const ray=new Raycaster(new Vector3(headCenter.x,headCenter.y,-4),new Vector3(0,0,1));
   const hits=ray.intersectObject(model.root,true).filter(h=>h.object instanceof Mesh&&!(h.object.material as MeshStandardMaterial).transparent);
   expect(hits.length).toBeGreaterThan(0);expect(belongsTo(hits[0].object,driver),'opaque fuselage must not hide the seated head').toBe(true);
   expect(headBox.max.y).toBeLessThan(kind==='car'?.7675:1.0);
   if(kind==='car')(model as ReturnType<typeof createCoastalCarModel>).updateCabin(.016,false,0,false);
   else(model as ReturnType<typeof createHelicopterModel>).updateCabin(.016,false,{pitch:0,roll:0,yaw:0,lift:0});
   expect(driver.visible).toBe(false);
  }finally{model.dispose();}
 });
 it('keeps both car palms on the rotating steering wheel and both soles on the pedals',()=>{
  const model=createCoastalCarModel();
  try{for(const steer of [0,-1,1,.5]){
   model.update(.016,0,steer,false);model.updateCabin(.016,true,1,true);model.root.updateMatrixWorld(true);
   for(const side of ['left','right']){
    expect(point(model.root,`explorer-${side}-hand-contact`).distanceTo(point(model.root,`car-${side}-wheel-grip`)),`${side} palm, steer ${steer}`).toBeLessThan(.02);
    expect(point(model.root,`explorer-${side}-sole-contact`).distanceTo(point(model.root,`car-${side}-pedal-contact`)),`${side} sole`).toBeLessThan(.02);
   }
  }}finally{model.dispose();}
 });
 it('moves the helicopter pilot with cyclic, collective and yaw pedals without detached contacts',()=>{
  const model=createHelicopterModel();
  try{for(const sign of [0,-1,1])for(const roll of [0,-1,1]){
   model.updateCabin(.016,true,{pitch:sign,roll,yaw:sign,lift:sign});model.root.updateMatrixWorld(true);
   expect(point(model.root,'explorer-left-hand-contact').distanceTo(point(model.root,'helicopter-collective-grip'))).toBeLessThan(.02);
   expect(point(model.root,'explorer-right-hand-contact').distanceTo(point(model.root,'helicopter-cyclic-grip'))).toBeLessThan(.02);
   for(const side of ['left','right'])expect(point(model.root,`explorer-${side}-sole-contact`).distanceTo(point(model.root,`helicopter-${side}-pedal-contact`))).toBeLessThan(.02);
  }}finally{model.dispose();}
 });
});
