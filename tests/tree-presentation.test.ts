import {expect,it} from 'vitest';
import {Scene,Mesh,Raycaster,Vector3} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {Material as M} from '../src/world/palette';
import {BuildingRegistry,decodeWorldIndex} from '../src/destruction/buildings';
import {registerNaturalTrees} from '../src/destruction/natural-support';
import {TerrainPreview} from '../src/rendering/terrain-preview';
import {TreePreview} from '../src/rendering/tree-preview';
import {canopyGeometry} from '../src/rendering/canopy-geometry';

function fixture(){
 const world=new VoxelWorld({minX:0,maxX:32,minZ:0,maxZ:32}),buildings=new BuildingRegistry();
 for(let x=0;x<32;x++)for(let z=0;z<32;z++){world.setVoxel(x,13,z,M.Dirt,false);world.setVoxel(x,14,z,M.Grass,false);}
 for(let y=15;y<=21;y++)world.setVoxel(5,y,5,M.Wood,false);
 for(let y=20;y<=24;y++)for(let x=3;x<=7;x++)for(let z=3;z<=7;z++)if(world.getVoxel(x,y,z)!==M.Wood)world.setVoxel(x,y,z,M.Leaves,false);
 return{world,buildings};
}
it('reshapes the original box canopy into supported clusters without changing tree identity or soil',()=>{
 const {world,buildings}=fixture();world.setVoxel(8,18,5,M.Dirt,false);world.setVoxel(8,19,5,M.Grass,false);world.setVoxel(4,22,5,M.Grass,false);world.setVoxel(24,20,24,M.Leaves,false);
 registerNaturalTrees(world,buildings,true);const tree=buildings.all[0];expect(tree.id).toBe('tree-5-15-5');expect(world.getVoxel(8,19,5)).toBe(M.Grass);expect(buildings.findAt(8,19,5)).toBeUndefined();
 const leaves=[...tree.indices].map(decodeWorldIndex).filter(p=>world.getVoxel(p.x,p.y,p.z)===M.Leaves);
 expect(world.getVoxel(4,22,5)).not.toBe(M.Grass);expect(world.getVoxel(24,20,24)).toBe(M.Air);
 expect([...tree.indices].map(decodeWorldIndex).every(p=>[M.Air,M.Wood,M.Leaves].includes(world.getVoxel(p.x,p.y,p.z)as never))).toBe(true);
 expect(leaves.length).toBeGreaterThan(12);expect(leaves.length).toBeLessThan(100);
 const widths=[20,21,22,23,24].map(y=>leaves.filter(p=>p.y===y).length);expect(new Set(widths).size).toBeGreaterThan(2);
 const owned=new Set(tree.indices),seen=new Set<number>(),queue=[tree.indices[0]];
 for(let i=0;i<queue.length;i++){const n=queue[i];if(seen.has(n)||!owned.has(n))continue;const p=decodeWorldIndex(n);if(!world.getVoxel(p.x,p.y,p.z))continue;seen.add(n);for(const d of [1,-1,2048,-2048,2048*2048,-2048*2048])queue.push(n+d);}
 expect(seen.size).toBe([...tree.indices].map(decodeWorldIndex).filter(p=>!!world.getVoxel(p.x,p.y,p.z)).length);
});
it('leaves air below the distant crown, retains a thin trunk and does not add a tree draw call',()=>{
 const {world,buildings}=fixture();registerNaturalTrees(world,buildings,true);const scene=new Scene(),lod=new TerrainPreview(scene,world,buildings);scene.updateMatrixWorld(true);
 const meshes:Mesh[]=[];scene.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});
 expect(meshes.length).toBe(lod.diagnostics.sectors);
 const underCrown=new Raycaster(new Vector3(0,18.5,4.3),new Vector3(1,0,0),0,8);expect(underCrown.intersectObjects(meshes)).toHaveLength(0);
 const stem=new Raycaster(new Vector3(0,18.5,5.5),new Vector3(1,0,0),0,8);expect(stem.intersectObjects(meshes)[0]?.distance).toBeCloseTo(5);
 const preview=new TreePreview(world,buildings),leaves=preview.boxes(0,0).filter(b=>b.material===M.Leaves);expect(leaves.every(b=>b.minY>=20)).toBe(true);expect(leaves.length).toBeLessThan(24);lod.dispose();
});
it('preserves a cut in the distant trunk and removes felled foliage after invalidation and reload',()=>{
 const {world,buildings}=fixture();registerNaturalTrees(world,buildings,true);world.applyEdits([{x:5,y:18,z:5,material:0}]);
 const scene=new Scene(),lod=new TerrainPreview(scene,world,buildings);scene.updateMatrixWorld(true);const meshes:Mesh[]=[];scene.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});
 expect(new Raycaster(new Vector3(0,18.5,5.5),new Vector3(1,0,0),0,8).intersectObjects(meshes)).toHaveLength(0);
 const saved=[...buildings.all[0].indices].map(i=>({...decodeWorldIndex(i),material:0})),dirty=world.applyEdits(saved);lod.invalidate(dirty);lod.update(.2,{x:700,y:17,z:16},()=>false,()=>undefined);
 expect(new TreePreview(world,buildings).boxes(0,0)).toHaveLength(0);
 const reloaded=fixture();registerNaturalTrees(reloaded.world,reloaded.buildings,true);reloaded.world.applyEdits(saved);expect(new TreePreview(reloaded.world,reloaded.buildings).boxes(0,0)).toHaveLength(0);lod.dispose();
});
it('uses a bounded shared canopy mesh rather than adding expensive leaf geometry',()=>{
 const g=canopyGeometry();g.computeBoundingBox();expect(g.getAttribute('position').count).toBeLessThanOrEqual(60);expect(g.boundingBox!.getSize(new Vector3()).toArray()).toEqual([1,1,1]);g.dispose();
});
it('gives conifers a connected green tip instead of a floating leaf or exposed timber cap',()=>{
 const world=new VoxelWorld({minX:0,maxX:32,minZ:0,maxZ:32}),buildings=new BuildingRegistry();
 world.setVoxel(16,14,16,M.Grass,false);for(let y=15;y<=23;y++)world.setVoxel(16,y,16,M.Wood,false);
 for(let y=17;y<=25;y++){const r=Math.max(0,Math.min(3,Math.floor((26-y)/2)));for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)if((dx||dz)&&Math.abs(dx)+Math.abs(dz)<=r+1)world.setVoxel(16+dx,y,16+dz,y%4?M.Leaves:M.Grass,false);}
 world.setVoxel(16,25,16,M.Leaves,false);registerNaturalTrees(world,buildings,true);
 const cells=[...buildings.all[0].indices].map(decodeWorldIndex).filter(p=>!!world.getVoxel(p.x,p.y,p.z)),top=Math.max(...cells.map(p=>p.y));
 expect(top).toBe(23);expect(cells.filter(p=>p.y===top)).toHaveLength(1);expect(world.getVoxel(16,top,16)).toBe(M.Leaves);expect(world.getVoxel(16,top-1,16)).toBe(M.Wood);
});
