import {Mesh,MeshStandardMaterial,ShaderChunk,type Scene} from 'three';

// Keep the renderer's light slots and shader variants stable as lamps/headlights
// switch on. A zero contribution must not run the full per-pixel physical BRDF.
// This also skips the BRDF beyond a finite point/spot light's actual range.
const enabledLightBlocks=ShaderChunk.lights_fragment_begin.replace(
 /((pointLight|spotLight|sunLight|directionalLight)\s*=\s*\w+\[\s*i\s*\];)([\s\S]*?\bRE_Direct\s*\(\s*directLight\s*,[^;]+\);)/g,
 (_match,assign,light,body)=>`${assign}\nif ( any( greaterThan( ${light}.color, vec3( 0.0 ) ) ) ) {\n${body}\n}`,
);
const directLights=enabledLightBlocks.replace(
 /\bRE_Direct\s*\(\s*directLight\s*,[^;]+\);/g,
 call=>`if ( directLight.visible && any( greaterThan( directLight.color, vec3( 0.0 ) ) ) ) { ${call} }`,
);
const installed=new WeakSet<MeshStandardMaterial>();

export function cullInactiveDirectLights(material:MeshStandardMaterial):void{
 if(installed.has(material))return;installed.add(material);
 const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous(shader,renderer);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',directLights);
 };
 material.customProgramCacheKey=()=>`${key}|coast-direct-light-culling-v2`;
 material.needsUpdate=true;
}

export function cullInactiveSceneLights(scene:Scene):void{
 scene.traverse(object=>{if(!(object instanceof Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material])
   if(material instanceof MeshStandardMaterial)cullInactiveDirectLights(material);
 });
}
