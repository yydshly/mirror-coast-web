import type {MeshStandardMaterial} from 'three';
type Shader=Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

/** Material IDs survive greedy meshing and debris generation; paint never turns into brick. */
export function voxelSurfaceFinish(shader:Shader):void{
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute float surfaceId;
varying float vSurfaceId;
varying vec3 vFinishNormal;`);
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vSurfaceId=surfaceId;
vFinishNormal=normalize(mat3(modelMatrix)*normal);`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying float vSurfaceId;
varying vec3 vFinishNormal;
float surfaceIs(float id){return 1.0-step(.1,abs(vSurfaceId-id));}
float surfaceGrain(vec3 p){p=fract(floor(p)*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float surfaceNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(surfaceGrain(i),surfaceGrain(i+vec3(1,0,0)),f.x),mix(surfaceGrain(i+vec3(0,1,0)),surfaceGrain(i+vec3(1,1,0)),f.x),f.y),mix(mix(surfaceGrain(i+vec3(0,0,1)),surfaceGrain(i+vec3(1,0,1)),f.x),mix(surfaceGrain(i+vec3(0,1,1)),surfaceGrain(i+vec3(1,1,1)),f.x),f.y),f.z);}
float surfaceJoint(float p,float width){float edge=min(fract(p),1.0-fract(p));return 1.0-smoothstep(width,width+max(fwidth(p),.001),edge);}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec3 surfaceP=vCoastWorld;
float closeFinish=1.0-smoothstep(.02,.12,length(fwidth(surfaceP)));
float aggregate=(surfaceGrain(surfaceP*55.0)-.5)*closeFinish;
float coarse=surfaceGrain(surfaceP*3.0)-.5;
float stone=surfaceIs(1.0),asphalt=surfaceIs(5.0),paving=surfaceIs(15.0);
float sand=surfaceIs(4.0),earth=surfaceIs(2.0),grass=surfaceIs(3.0);
float plaster=surfaceIs(7.0)+surfaceIs(9.0)+surfaceIs(16.0)+surfaceIs(19.0);
diffuseColor.rgb*=1.0+aggregate*(asphalt*.15+paving*.09+plaster*.055+stone*.06)+coarse*stone*.05;
// Sand reads as granular shore; exposed earth/rock keep their own strata on
// crater walls. Broad, low-contrast variation avoids a repeated square grid.
float groundPatch=0.;
if(sand+earth+grass>.5)groundPatch=surfaceNoise(surfaceP*.7)-.5;
// Broad wind-dried and greener patches give whole slopes a readable scale;
// fine grain alone left distant ground looking like one flat painted slab.
float landscapePatch=.5;
if(sand+grass>.5)landscapePatch=surfaceNoise(vec3(surfaceP.x*.045,0.,surfaceP.z*.045));
diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*mix(vec3(.82,.92,.86),vec3(1.13,1.06,.84),landscapePatch),grass*.62);
diffuseColor.rgb*=1.0+sand*(landscapePatch-.5)*.11;
float ripple=sin(surfaceP.x*6.8+surfaceP.z*2.4+sin(surfaceP.z*.9)*.7);
float strata=sin(surfaceP.y*8.0+sin(surfaceP.x*.7)*.8+sin(surfaceP.z*.9)*.6);
diffuseColor.rgb*=1.0+sand*(aggregate*.18+groundPatch*.07+ripple*.025*closeFinish)
  +earth*(aggregate*.16+groundPatch*.10+strata*.045)
  +grass*(aggregate*.10+groundPatch*.12);
diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.94,.89,.82),earth*(1.0-abs(vFinishNormal.y))*.22);
float canopy=surfaceIs(14.0);
float leafPatch=surfaceGrain(floor(surfaceP*1.7));
float leafFine=surfaceGrain(floor(surfaceP*13.0));
diffuseColor.rgb*=1.0+canopy*((leafPatch-.5)*.28+(leafFine-.5)*.18*closeFinish);
diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.08,1.06,.91),canopy*step(.68,leafPatch)*.45);
vec2 wallUV=abs(vFinishNormal.z)>.5?surfaceP.xy:surfaceP.zy;
float row=floor(wallUV.y/.16);
float mortar=max(surfaceJoint(wallUV.y/.16,.018),surfaceJoint(wallUV.x/.38+mod(row,2.0)*.5,.012));
float brick=surfaceIs(8.0)*(1.0-step(.5,abs(vFinishNormal.y)))*closeFinish;
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.27,.25,.21),mortar*brick*.58);
vec2 timberUV=abs(vFinishNormal.y)>.5?surfaceP.xz:vec2(surfaceP.y,abs(vFinishNormal.z)>.5?surfaceP.x:surfaceP.z);
float timber=surfaceIs(13.0),fibre=sin(timberUV.y*137.0+sin(timberUV.x*5.0)*1.3);
float plank=surfaceJoint(timberUV.y/.18,.012);
diffuseColor.rgb*=1.0+timber*closeFinish*(fibre*.035-plank*.14);
float roofing=surfaceIs(10.0)+surfaceIs(20.0);
float tile=max(surfaceJoint(surfaceP.x/.48,.01),surfaceJoint(surfaceP.z/.72,.012));
diffuseColor.rgb*=1.0-roofing*tile*.12*closeFinish;
diffuseColor.rgb*=1.0+surfaceIs(20.0)*sin(surfaceP.x/.48*6.28318)*.055*closeFinish;`);
}
