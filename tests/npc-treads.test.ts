import {it,expect} from 'vitest';
import {Scene,InstancedMesh,Matrix4} from 'three';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {StreetLife} from '../src/rendering/street-life';
import {StreetLifeSimulation} from '../src/simulation/street-life-sim';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {regionalHeightAt} from '../src/world/region-terrain';

it('places real NPCs on the visible fine steps, including their rendered shoes and live body bounds',async()=>{
 const base=generateWorld();addHarborQuarter(base.world,base.buildings);addRegionalTerrain(base.world);addRegionalDistricts(base.world,base.buildings);
 const scene=new Scene(),treads=new WalkTransitions(scene,base.world),legacy=new StreetLifeSimulation(base.world,{cars:0}),life=new StreetLife(scene,base.world,{surfaceAt:(x,z,max)=>treads.heightAt(x,z,max)}),report=[];
 try{
  for(const p of life.simulation.people){
   if(!p.visible)continue;const old=legacy.people[p.id],top=treads.heightAt(p.position.x,p.position.z,p.position.y+1.1);
   if(top!==null){expect(p.position.y,`NPC ${p.id}`).toBeGreaterThanOrEqual(top-.001);if(p.position.y-old.position.y>.1)report.push({id:p.id,position:{...p.position},oldPosition:{...old.position},visibleTop:top});}
  }
  expect(report.length).toBeGreaterThan(0);
  const probe=new StreetLifeSimulation(base.world,{cars:0,surfaceAt:(x,z,max)=>treads.heightAt(x,z,max)}),west=probe.people.find(p=>p.a.x===-59&&p.a.z===108)!;
  for(let n=0;n<=32;n++){
   const z=108+n,raw=regionalHeightAt(-59,z)+1;west.position={x:-59,y:raw,z};west.progress=n/32;west.wait=1;west.visible=true;
   probe.update(1/30,{focus:west.position,night:0,wetness:0,obstacles:[]});
   const top=treads.heightAt(-59,z,raw+1.05);if(top!==null&&top>raw+.1&&west.visible){expect(west.position.y).toBeGreaterThanOrEqual(top-.001);report.push({id:west.id,position:{...west.position},oldPosition:{x:-59,y:raw,z},visibleTop:top});}
  }
  // Observe actual meshes on the same surfaces as their simulation, not just a
  // root-coordinate assertion while their legs remain hidden in the treads.
  const context={focus:{x:-60,y:24,z:130},night:0,wetness:0,obstacles:[]};
  for(let frame=0;frame<90;frame++)life.update(1/30,context);
  const shoes=scene.getObjectByName('street-life-rubber') as InstancedMesh,matrix=new Matrix4();shoes.geometry.computeBoundingBox();
  // Vehicle trim now includes cabin seats as well as bumpers. Pedestrian
  // boots occupy the final four parts per actor in this shared batch.
  const pedestrians=life.renderedPeople;expect(pedestrians.length).toBeGreaterThan(0);const carShoeParts=shoes.count-pedestrians.length*4;
  for(let n=0;n<pedestrians.length;n++){const p=pedestrians[n];let lowest=Infinity;for(let i=0;i<4;i++){shoes.getMatrixAt(carShoeParts+n*4+i,matrix);lowest=Math.min(lowest,shoes.geometry.boundingBox!.clone().applyMatrix4(matrix).min.y);}expect(lowest,`NPC ${p.id} shoes`).toBeCloseTo(p.position.y,4);expect(p.bounds.minY).toBeCloseTo(p.position.y,5);const top=treads.heightAt(p.position.x,p.position.z,p.position.y+1.1);if(top!==null)expect(lowest,`NPC ${p.id} visible tread`).toBeGreaterThanOrEqual(top-.001);}
  const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env?.MIRROR_NPC_AUDIT;if(env){const mod='node:fs',fs=await import(mod) as {writeFileSync:(p:string,t:string)=>void};fs.writeFileSync('artifacts/run-and-npc/npc-treads.json',JSON.stringify(report,null,2));}
 }finally{life.dispose();treads.dispose();}
},30000);

it('raises an actor already embedded in a new tread, but blocks advancing onto an ungraded high ledge',()=>{
 const world=new VoxelWorld();for(let x=0;x<60;x++)for(let z=160;z<175;z++)world.setVoxel(x,15,z,Material.Concrete);
 const sim=new StreetLifeSimulation(world,{cars:0,surfaceAt:(x,_z)=>x>=18?16.8:16}),p=sim.people[0];p.position={x:17,y:16,z:170.5};p.a={x:17,z:170.5};p.b={x:24,z:170.5};p.progress=0;p.direction=1;p.wait=0;p.pace=1;
 const ctx={focus:p.position,night:0,wetness:0,obstacles:[]};for(let i=0;i<60;i++)sim.update(1/30,ctx);expect(p.position.x).toBeLessThan(18);expect(p.position.y).toBe(16);
 p.position.x=20;p.position.y=16;p.progress=3/7;p.wait=1;sim.update(1/30,ctx);expect(p.position.y).toBe(16.8);expect(p.bounds.minY).toBe(16.8);
});
