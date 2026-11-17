import {expect,it,vi} from 'vitest';
import {PerspectiveCamera,Scene,WebGLRenderTarget,type WebGLRenderer} from 'three';
import {WetStreets} from '../src/rendering/wet-streets';
import {VoxelWorld} from '../src/world/voxel';
it.each([false,true])('restores the existing render target after reflection preparation, failure=%s',async fail=>{
 const scene=new Scene(),camera=new PerspectiveCamera(),wet=new WetStreets(scene,new VoxelWorld(),{value:0}),previous=new WebGLRenderTarget(2,2);let target:WebGLRenderTarget|null=previous,compiled:WebGLRenderTarget|null=null;
 const renderer={getRenderTarget:()=>target,setRenderTarget:(value:WebGLRenderTarget|null)=>{target=value;},compileAsync:vi.fn(async()=>{compiled=target;if(fail)throw new Error('compile-failed');return new Set();})} as unknown as WebGLRenderer;
 try{
  if(fail)await expect(wet.prewarm(renderer,scene,camera)).rejects.toThrow('compile-failed');else await wet.prewarm(renderer,scene,camera);
  expect(compiled).not.toBeNull();expect(compiled).not.toBe(previous);expect(target).toBe(previous);
 }finally{wet.dispose();previous.dispose();}
});
