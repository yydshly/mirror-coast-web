import {describe,it,expect} from 'vitest';
import {Mesh,Scene} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {TerrainPreview} from '../src/rendering/terrain-preview';
function fixture(){const w=new VoxelWorld({minX:-32,maxX:256,minZ:0,maxZ:32});for(let z=0;z<32;z++)for(let x=-32;x<256;x++)w.setVoxel(x,14,z,3,false);for(let y=15;y<32;y++)for(let x=4;x<8;x++)for(let z=4;z<8;z++)w.setVoxel(x,y,z,9,false);return w;}
describe('render-only distant voxel skyline',()=>{
 it('reuses distance LOD while standing still, but responds to nearby mesh completion, movement and quality changes',()=>{
  const w=fixture(),s=new Scene(),lod=new TerrainPreview(s,w),meshes=new Map([...w.chunks.keys()].map(k=>[k,new Mesh()])),focus={x:16,y:17,z:16};let queries=0,complete=false;
  const ready=()=>{queries++;return complete;},meshAt=(key:string)=>meshes.get(key);
  lod.update(.2,focus,ready,meshAt);const first=queries;
  for(let i=0;i<30;i++)lod.update(.2,focus,ready,meshAt);expect(queries).toBe(first);
  complete=true;lod.hideColumnWhenReady(0,0,w,ready);lod.update(.01,focus,ready,meshAt);expect(meshes.get('0,0,0')!.visible).toBe(true);expect(queries).toBeGreaterThan(first);
  const installed=queries;lod.update(.2,{...focus,x:21},ready,meshAt);expect(queries).toBeGreaterThan(installed);
  const moved=queries;lod.update(.2,{...focus,x:21},ready,meshAt,200);expect(queries).toBeGreaterThan(moved);lod.dispose();
 });
 it('does not re-upload a visible far sector when only its unused detailed mesh becomes ready',()=>{
  const w=fixture(),s=new Scene(),lod=new TerrainPreview(s,w),focus={x:700,y:17,z:16};let ready=false;
  lod.update(.2,focus,()=>ready,()=>undefined);const sectors=s.children[0].children as Mesh[],versions=sectors.map(m=>m.geometry.index!.version),indices=sectors.map(m=>m.geometry.index!.array.slice());
  ready=true;lod.hideColumnWhenReady(7,0,w,()=>ready);lod.update(.01,focus,()=>ready,()=>undefined);
  sectors.forEach((m,i)=>{expect(m.geometry.index!.version).toBe(versions[i]);expect(m.geometry.index!.array).toEqual(indices[i]);});lod.dispose();
 });
 it('retains the actual roof height and color in a few sectors without changing a voxel',()=>{
  const w=fixture(),before=[...w.chunks.values()].map(c=>c.voxels.slice()),s=new Scene(),lod=new TerrainPreview(s,w);let roof=0;s.traverse(o=>{if(o instanceof Mesh){o.geometry.computeBoundingBox();roof=Math.max(roof,o.geometry.boundingBox?.max.y??0);}});expect(roof).toBe(32);expect(lod.diagnostics.sectors).toBeLessThan(lod.diagnostics.columns);[...w.chunks.values()].forEach((c,i)=>expect(c.voxels).toEqual(before[i]));lod.dispose();
 });
 it('keeps the coarse surface until every vertical mesh is ready, then swaps near/far with hysteresis',()=>{
  const w=fixture(),s=new Scene(),lod=new TerrainPreview(s,w),meshes=new Map([...w.chunks.keys()].map(k=>[k,new Mesh()]));let ready=false;
  lod.update(.2,{x:16,y:17,z:16},()=>ready,k=>meshes.get(k));expect(meshes.get('0,0,0')!.visible).toBe(false);expect(lod.diagnostics.detailed).toBe(0);
  ready=true;lod.hideColumnWhenReady(0,0,w,()=>ready);lod.update(.2,{x:16,y:17,z:16},()=>ready,k=>meshes.get(k));expect(meshes.get('0,0,0')!.visible).toBe(true);
  lod.update(.2,{x:700,y:17,z:16},()=>ready,k=>meshes.get(k));expect(meshes.get('0,0,0')!.visible).toBe(false);expect(lod.diagnostics.detailed).toBe(0);expect(s.children[0].children.some(o=>o.visible)).toBe(true);lod.dispose();
 });
 it('rebuilds an excavated skyline from saved/current voxels instead of resurrecting a removed building',()=>{
  const w=fixture(),s=new Scene(),lod=new TerrainPreview(s,w),edits=[];for(let y=15;y<32;y++)for(let x=4;x<8;x++)for(let z=4;z<8;z++)edits.push({x,y,z,material:0});const keys=w.applyEdits(edits);lod.invalidate(keys);
  for(let i=0;i<4;i++)lod.update(.2,{x:700,y:17,z:16},()=>true,()=>undefined);let roof=0;s.traverse(o=>{if(o instanceof Mesh){o.geometry.computeBoundingBox();roof=Math.max(roof,o.geometry.boundingBox?.max.y??0);}});expect(roof).toBe(15);expect(lod.diagnostics.dirty).toBe(0);lod.dispose();
 });
});
