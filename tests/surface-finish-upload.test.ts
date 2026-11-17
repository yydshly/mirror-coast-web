import {expect,it,vi} from 'vitest';
import {BoxGeometry,Mesh,MeshStandardMaterial,Scene,type WebGLRenderer} from 'three';
import {surfaceFinish,surfaceFinishTexture} from '../src/rendering/surface-finish';
import {GpuWarmup} from '../src/rendering/gpu-warmup';
it('uploads one shared material-noise texture before play without putting image data into cloned material metadata',async()=>{
 const a=surfaceFinish(new MeshStandardMaterial(),'wood'),b=surfaceFinish(new MeshStandardMaterial(),'stone'),scene=new Scene(),geometry=new BoxGeometry();scene.add(new Mesh(geometry,a),new Mesh(geometry,b));
 const renderer={initTexture:vi.fn()} as unknown as WebGLRenderer,warmup=new GpuWarmup(renderer);
 try{await warmup.textures(scene);expect(renderer.initTexture).toHaveBeenCalledTimes(1);expect(surfaceFinishTexture(a)).toBe(surfaceFinishTexture(b));expect(surfaceFinishTexture(a)?.image.width).toBe(256);expect(JSON.stringify(a.clone().userData).length).toBeLessThan(100);}finally{warmup.dispose();geometry.dispose();a.dispose();b.dispose();}
});
