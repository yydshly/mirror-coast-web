import {beforeAll,afterAll,expect,it} from 'vitest';
import {Mesh,Raycaster,Scene,Vector3} from 'three';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
import {findCarExit} from '../src/vehicles/car-exit';
import {obstacleIntersectsBody,obstacleTopAt,surfaceHeightAt,type SceneObstacle} from '../src/input/scene-collisions';
let base:ReturnType<typeof generateWorld>,surfaces:WalkTransitions;const scene=new Scene();
beforeAll(()=>{base=generateWorld();addRegionalTerrain(base.world);addRegionalDistricts(base.world,base.buildings);surfaces=new WalkTransitions(scene,base.world);});
afterAll(()=>surfaces.dispose());
it('gets out at the real cape parking pose using the fractional road footing',()=>{
 const p={x:-174.2725830078125,y:33.858001708984375,z:91.36516571044922},walker=new VoxelWalker(base.world,{x:p.x,y:p.y-.85,z:p.z});let nearby=surfaces.nearby(p,12);walker.setObstacleProvider(()=>nearby);
 const feet=findCarExit(base.world,p,1.1145788730948936,position=>{nearby=surfaces.nearby(position,12);return walker.canOccupy(position);},(x,z,maxTop)=>{nearby=surfaces.nearby({x,y:p.y-.85,z},12);return walker.surfaceAt(x,z,maxTop,2.2);});
 expect(feet).not.toBeNull();expect(Math.hypot(feet!.x-p.x,feet!.z-p.z)).toBeLessThan(3.3);expect(walker.canOccupy(feet!)).toBe(true);expect(Math.abs(feet!.y-(p.y-.85))).toBeLessThanOrEqual(1.1);
});
it('has a continuous road height along the real uphill approach instead of twenty-centimetre jumps',()=>{
 let previous:number|undefined,maxChange=0,rise=0;
 for(let t=0;t<=43;t+=.025){const x=-82-t*.9578,z=95-t*.2873,top=surfaces.heightAt(x,z)??regionalHeightAt(x,z)+1;if(previous!==undefined){maxChange=Math.max(maxChange,Math.abs(top-previous));rise+=top-previous;}previous=top;}
 expect(rise).toBeGreaterThan(2);expect(maxChange).toBeLessThan(.045);
});
it('attaches the road to an old ground pose locally without moving the walker sideways',()=>{
 const m=new VoxelWalker(base.world,{x:-90,y:regionalHeightAt(-90,93)+1,z:93}),start=m.position.clone();m.setObstacleProvider(()=>surfaces.nearby(m.position));
 expect(m.position.x).toBe(start.x);expect(m.position.z).toBe(start.z);expect(m.canOccupy(m.position)).toBe(true);
 for(let i=0;i<180;i++){m.update(1/60,{x:-.9578,z:-.2873});expect(m.recoveredLastStep).toBe(false);}
 expect(m.position.x).toBeLessThan(start.x-7);
});
it('removes the visible road cap and support together when its real source voxel is excavated',()=>{
 const b=surfaces.nearby({x:-90,y:25,z:93},12).find(b=>b.surface)!;expect(b).toBeDefined();
 const x=Math.floor(b.minX),z=Math.floor(b.minZ),y=Math.floor(b.minY),mat=base.world.getVoxel(x,y,z),keys=[`${x>>5},${y>>5},${z>>5}`];
 base.world.setVoxel(x,y,z,0);surfaces.sync(keys);expect(surfaces.nearby({x,y:y+1,z},3)).not.toContain(b);expect(surfaces.heightAt(x+.5,z+.5)).toBe(null);
 base.world.setVoxel(x,y,z,mat);surfaces.sync(keys);expect(surfaces.nearby({x,y:y+1,z},3)).toContain(b);
});
it('supports a footprint crossing the road diagonal without embedding it in a hidden ridge',()=>{
 const ridge:SceneObstacle={minX:0,maxX:1,minZ:0,maxZ:1,minY:0,maxY:1,surface:[0,1,1,0],standable:true};
 expect(obstacleTopAt(ridge,.5,.5,.2,2)).toBeCloseTo(1);expect(obstacleIntersectsBody(ridge,{x:.5,y:.95,z:.5},.2,1.8)).toBe(true);expect(obstacleIntersectsBody(ridge,{x:.5,y:1,z:.5},.2,1.8)).toBe(false);
});
it('keeps road lighting continuous at shared top vertices and supplies metre-scaled paint coordinates',()=>{
 const seen=new Map<string,number[]>();let shared=0,sloped=0,invalid=0,maxNormalError=0;
 scene.traverse(object=>{if(!(object instanceof Mesh)||object.name!=='continuous-coast-road')return;const p=object.geometry.getAttribute('position'),n=object.geometry.getAttribute('normal'),road=object.geometry.getAttribute('roadCoord');expect(road.count).toBe(p.count);
  for(let i=0;i<p.count;i++){if(!Number.isFinite(road.getX(i)+road.getY(i)+road.getZ(i)))invalid++;if(n.getY(i)<.5)continue;const key=`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`,normal=[n.getX(i),n.getY(i),n.getZ(i)],old=seen.get(key);if(old){shared++;maxNormalError=Math.max(maxNormalError,Math.hypot(...normal.map((v,j)=>v-old[j])));}else seen.set(key,normal);if(n.getY(i)<.995)sloped++;}
 });expect(shared).toBeGreaterThan(1000);expect(sloped).toBeGreaterThan(100);expect(invalid).toBe(0);expect(maxNormalError).toBeLessThan(1e-5);
});
it('hides internal road walls and exposes the raised rim when neighbouring support is excavated',()=>{
 const center={x:-90,y:25,z:93},before=surfaces.nearby(center,14).filter(b=>b.surface),source=before.find(b=>b.maxY-b.minY>.3)!,x=Math.floor(source.minX),z=Math.floor(source.minZ),y=Math.floor(source.minY),m=base.world.getVoxel(x,y,z),keys=[`${x>>5},${y>>5},${z>>5}`];
 const meshes:Mesh[]=[];scene.traverse(o=>{if(o instanceof Mesh&&o.name==='continuous-coast-road')meshes.push(o);});scene.updateMatrixWorld(true);
 try{
  base.world.setVoxel(x,y,z,0);surfaces.sync(keys);const after=surfaces.nearby(center,16).filter(b=>b.surface),key=(b:SceneObstacle)=>`${b.minX},${b.minZ}`,active=new Set(after.map(key)),removed=new Set(before.filter(b=>!active.has(key(b))).map(key));
  const frontier=after.find(b=>removed.has(`${b.minX-1},${b.minZ}`)&&surfaceHeightAt(b,b.minX,b.minZ+.5)>b.minY+.09);expect(frontier).toBeDefined();
  const b=frontier!,ray=new Raycaster(new Vector3(b.minX-.4,surfaceHeightAt(b,b.minX,b.minZ+.5)-.04,b.minZ+.5),new Vector3(1,0,0),0,.65),wall=()=>ray.intersectObjects(meshes).filter(hit=>(hit.face?.normal.x??0)<-.9);
  expect(wall().length).toBeGreaterThan(0);base.world.setVoxel(x,y,z,m);surfaces.sync(keys);expect(wall()).toHaveLength(0);
 }finally{base.world.setVoxel(x,y,z,m);surfaces.sync(keys);}
});
