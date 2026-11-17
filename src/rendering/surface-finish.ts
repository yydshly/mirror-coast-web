import {DataTexture,LinearFilter,RepeatWrapping,RGBAFormat,type Material,type MeshStandardMaterial} from 'three';

// One shared, deterministic lookup replaces eight trigonometric hashes per
// value-noise sample. G stores the next Z slice of R, including wrapped edges.
const noiseSize=256,noiseBytes=new Uint8Array(noiseSize*noiseSize*4),values=new Uint8Array(noiseSize*noiseSize);
let noiseSeed=48271;
for(let i=0;i<values.length;i++){noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;values[i]=noiseSeed>>>24;}
for(let y=0;y<noiseSize;y++)for(let x=0;x<noiseSize;x++){const i=(x+y*noiseSize)*4;noiseBytes[i]=values[x+y*noiseSize];noiseBytes[i+1]=values[((x+37)&255)+((y+239)&255)*noiseSize];noiseBytes[i+3]=255;}
const finishNoise=new DataTexture(noiseBytes,noiseSize,noiseSize,RGBAFormat);
finishNoise.name='shared-material-value-noise';finishNoise.wrapS=finishNoise.wrapT=RepeatWrapping;finishNoise.magFilter=finishNoise.minFilter=LinearFilter;finishNoise.generateMipmaps=false;finishNoise.needsUpdate=true;
const surfaceTextures=new WeakMap<Material,DataTexture>();
export const surfaceFinishTexture=(material:Material)=>surfaceTextures.get(material);

/** Metre-scaled detail follows each part, including rotated/scaled instances. */
export function surfaceFinish<T extends MeshStandardMaterial>(material:T,kind:'wood'|'stone'|'sand'|'paint'|'rubber'|'fabric'):T{
  surfaceTextures.set(material,finishNoise);
  const previous=material.onBeforeCompile.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    previous(shader,renderer);
    shader.uniforms.uFinishNoise={value:finishNoise};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
varying vec3 vFinishMetres;
varying vec3 vFinishAxis;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vec3 finishScale=vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));
#ifdef USE_INSTANCING
finishScale*=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
#endif
vFinishMetres=position*finishScale;
vFinishAxis=finishScale;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 vFinishMetres;
varying vec3 vFinishAxis;
uniform sampler2D uFinishNoise;
float finishNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);vec2 uv=i.xy+vec2(37.,239.)*i.z+f.xy;vec2 slices=texture2D(uFinishNoise,(uv+.5)/256.).rg;return mix(slices.r,slices.g,f.z);}`);
    const detail=kind==='wood'?`
vec3 grain=vFinishAxis.x>=max(vFinishAxis.y,vFinishAxis.z)?vFinishMetres.xyz:(vFinishAxis.y>=vFinishAxis.z?vFinishMetres.yxz:vFinishMetres.zxy);
float fibre=sin(grain.y*157.0+grain.z*173.0+sin(grain.x*5.3)*1.1+finishNoise(grain*vec3(1.4,9.0,9.0))*2.0);
float finishVariation=(fibre*.035+(finishNoise(grain*vec3(.8,7.0,7.0))-.5)*.12)*finishFade;`:
      kind==='fabric'?`float finishVariation=(sin(vFinishMetres.x*840.0)*sin(vFinishMetres.y*760.0)*.018+(finishNoise(vFinishMetres*52.0)-.5)*.055)*finishFade;`:
      kind==='sand'?`float finishVariation=(finishNoise(vFinishMetres*52.0)-.5)*.14*finishFade+(finishNoise(vFinishMetres*2.1)-.5)*.055;`:
      kind==='stone'?`float finishVariation=(finishNoise(vFinishMetres*38.0)-.5)*.12*finishFade+(finishNoise(vFinishMetres*2.1)-.5)*.035;`:
      kind==='rubber'?`float finishVariation=(finishNoise(vFinishMetres*75.0)-.5)*.055*finishFade;`:
      `float finishVariation=(finishNoise(vFinishMetres*24.0)-.5)*.025*finishFade;`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float finishFade=1.0-smoothstep(.015,.07,length(fwidth(vFinishMetres)));
${detail}
diffuseColor.rgb*=1.0+finishVariation;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+finishVariation*.3,.08,1.0);');
  };
  material.customProgramCacheKey=()=>`coast-finish-${kind}-2`;
  return material;
}
