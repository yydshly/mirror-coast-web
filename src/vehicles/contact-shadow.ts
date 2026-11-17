import {MeshStandardMaterial} from 'three';

/** Cheap near-ground occlusion complements the directional sun shadow. */
export function contactShadowMaterial():MeshStandardMaterial{
  const material=new MeshStandardMaterial({color:'#000000',transparent:true,opacity:.27,depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  material.userData.contactShadow=true;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vContactUv;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvContactUv=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vContactUv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec2 contactP=abs(vContactUv-.5)*2.0;
diffuseColor.a*=(1.0-smoothstep(.55,1.0,contactP.x))*(1.0-smoothstep(.6,1.0,contactP.y));`);
  };
  material.customProgramCacheKey=()=> 'coast-contact-shadow-v1';return material;
}
