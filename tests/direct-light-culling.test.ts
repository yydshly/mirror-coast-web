import {it,expect} from 'vitest';
import {BoxGeometry,Mesh,MeshBasicMaterial,MeshPhysicalMaterial,MeshStandardMaterial,Scene,ShaderLib,type WebGLRenderer} from 'three';
import {cullInactiveSceneLights,cullInactiveDirectLights} from '../src/rendering/direct-light-culling';

it('preserves each existing material shader and cache identity without wrapping twice',()=>{
 const a=new MeshStandardMaterial(),b=new MeshStandardMaterial();let calls=0;
 a.customProgramCacheKey=()=> 'existing-stone';b.customProgramCacheKey=()=> 'existing-cloth';
 a.onBeforeCompile=shader=>{calls++;shader.fragmentShader=shader.fragmentShader.replace('void main()', '/* preserved surface finish */ void main()');};
 cullInactiveDirectLights(a);const key=a.customProgramCacheKey();cullInactiveDirectLights(a);cullInactiveDirectLights(b);
 expect(a.customProgramCacheKey()).toBe(key);expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
 const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}} as Parameters<MeshStandardMaterial['onBeforeCompile']>[0];
 a.onBeforeCompile(shader,{} as WebGLRenderer);expect(calls).toBe(1);expect(shader.fragmentShader).toContain('preserved surface finish');
 expect(shader.fragmentShader).toContain('getPointLightInfo');expect(shader.fragmentShader).toContain('getSpotLightInfo');expect(shader.fragmentShader).toContain('directLight.visible && any(');
 a.dispose();b.dispose();
});

it('covers hidden and array PBR materials while leaving unlit materials alone',()=>{
 const scene=new Scene(),g=new BoxGeometry(),pbr=new MeshPhysicalMaterial(),unlit=new MeshBasicMaterial(),original=unlit.onBeforeCompile,mesh=new Mesh(g,[pbr,unlit]);mesh.visible=false;scene.add(mesh);
 cullInactiveSceneLights(scene);expect(pbr.customProgramCacheKey()).toContain('coast-direct-light-culling');expect(unlit.onBeforeCompile).toBe(original);
 g.dispose();pbr.dispose();unlit.dispose();
});
