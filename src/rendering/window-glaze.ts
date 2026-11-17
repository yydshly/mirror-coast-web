import type {MeshStandardMaterial} from 'three';

/** A restrained sky response gives opaque stylised panes depth without a cubemap pass. */
export function windowGlaze<T extends MeshStandardMaterial>(material:T,night:{value:number}):T{
  const previous=material.onBeforeCompile.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    previous(shader,renderer);shader.uniforms.uPaneNight=night;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPaneWorld;\nvarying vec3 vPaneNormal;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vec4 panePosition=vec4(transformed,1.0);vec3 paneNormal=normal;
#ifdef USE_INSTANCING
panePosition=instanceMatrix*panePosition;paneNormal=mat3(instanceMatrix)*paneNormal;
#endif
vPaneWorld=(modelMatrix*panePosition).xyz;vPaneNormal=normalize(mat3(modelMatrix)*paneNormal);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vPaneWorld;\nvarying vec3 vPaneNormal;\nuniform float uPaneNight;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
vec3 paneV=normalize(cameraPosition-vPaneWorld),paneN=normalize(vPaneNormal),paneR=reflect(-paneV,paneN);
float paneFresnel=.035+.23*pow(1.0-abs(dot(paneV,paneN)),3.0);
vec3 paneSky=mix(vec3(.12,.17,.18),vec3(.31,.40,.44),smoothstep(-.25,.8,paneR.y));
totalEmissiveRadiance+=mix(paneSky,vec3(.009,.016,.025),uPaneNight)*paneFresnel;`);
  };
  material.customProgramCacheKey=()=> 'coast-window-glaze-v1';return material;
}
