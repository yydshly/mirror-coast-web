import {it,expect} from 'vitest';
import {MeshStandardMaterial,Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {RouteLandscape} from '../src/rendering/route-landscape';
import {CollapsePhysics} from '../src/destruction/physics';

it('makes a real roadside crown collidable and releases it when its actual ground support is dug out',async()=>{
 const {world}=generateWorld(),scene=new Scene(),art=new RouteLandscape(scene,world),material=new MeshStandardMaterial();
 const physics=await CollapsePhysics.create(scene,material,{onStateChange:()=>{}});
 try{
  const crown=art.obstacles.find(b=>b.hull)!;expect(crown).toBeDefined();
  const position={x:(crown.minX+crown.maxX)/2,y:(crown.minY+crown.maxY)/2-1.87,z:(crown.minZ+crown.maxZ)/2+.2},q={x:0,y:0,z:0,w:1};
  const aircraft=physics.createVehicle(position,()=>{});
  try{
   expect(aircraft.clearAt(position,q)).toBe(true);aircraft.syncProps([crown]);expect(aircraft.clearAt(position,q)).toBe(false);
   const part=art.decorationParts().find(p=>p.geometry.name==='leaf-cluster'&&Math.abs(p.matrix.elements[12]-position.x)<.01&&Math.abs(p.matrix.elements[14]-(position.z-.2))<.01)!;
   expect(part).toBeDefined();for(const a of part.anchors)world.setVoxel(a.x,a.y,a.z,0);art.sync();expect(art.obstacles.includes(crown)).toBe(false);
   aircraft.syncProps(art.obstacles.includes(crown)?[crown]:[]);expect(aircraft.clearAt(position,q)).toBe(true);
  }finally{aircraft.dispose();}
 }finally{physics.dispose();art.dispose();material.dispose();}
});
