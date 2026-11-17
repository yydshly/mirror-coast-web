import {BufferGeometry,Mesh,ShaderMaterial,OrthographicCamera,Scene,WebGLRenderTarget,type WebGLRenderer,Texture,type Material} from 'three';
import {surfaceFinishTexture} from './surface-finish';

/** Upload chunk buffers during their existing installation budget, before a turn
 * exposes hundreds of previously invisible chunks. The pass draws one pixel. */
export class GpuWarmup{
 private scene=new Scene();private target=new WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false});
 // Keep every chunk attribute live in the program. MeshBasicMaterial used only
 // positions/indices, deferring normals/colours/surface uploads until a turn.
 private material=new ShaderMaterial({colorWrite:false,depthWrite:false,depthTest:false,vertexShader:`attribute vec3 color;attribute float glow;attribute float surfaceId;varying vec3 warmValue;void main(){warmValue=color+normal*.01+vec3(glow*.01+surfaceId*.001);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec3 warmValue;void main(){gl_FragColor=vec4(warmValue,1.);}`});
 private placeholder=new BufferGeometry();private mesh=new Mesh(this.placeholder,this.material);
 private camera=new OrthographicCamera(-1,1,1,-1,.1,100);
 constructor(private renderer:WebGLRenderer){this.mesh.frustumCulled=false;this.mesh.matrixAutoUpdate=false;this.scene.add(this.mesh);this.camera.position.set(16,16,40);this.camera.lookAt(16,16,16);}
 geometry(geometry:BufferGeometry){
  const previous=this.renderer.getRenderTarget();this.mesh.geometry=geometry;
  try{this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);}
  finally{this.renderer.setRenderTarget(previous);this.mesh.geometry=this.placeholder;}
 }
 /** Shader compilation alone does not upload a canvas texture. */
 async textures(scene:Scene){
  const textures=new Set<Texture>();scene.traverse(object=>{if(!(object instanceof Mesh))return;for(const material of Array.isArray(object.material)?object.material:[object.material]){for(const value of Object.values(material as Material))if(value instanceof Texture)textures.add(value);const finish=surfaceFinishTexture(material);if(finish)textures.add(finish);}});
  let n=0;for(const texture of textures){this.renderer.initTexture(texture);if(++n%4===0)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
 }
 dispose(){this.placeholder.dispose();this.material.dispose();this.target.dispose();}
}
