import {Color,Float32BufferAttribute,MeshStandardMaterial,Vector3,type BufferGeometry} from 'three';
import {Material,palette} from '../world/palette';
import {sampleRegionalRoad} from '../world/region-layout';
import {regionalSurfaceAt} from '../world/region-terrain';
import {surfaceFinish} from './surface-finish';

/** Paint and shoulder colour follow the road itself, not the voxel cell grid. */
export function roadSurfaceMaterial():MeshStandardMaterial{
 const material=surfaceFinish(new MeshStandardMaterial({color:'#ffffff',roughness:.94,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),'paint');
 const compile=material.onBeforeCompile.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{compile(shader,renderer);
  shader.uniforms.uRoadAsphalt={value:new Color().setRGB(...palette[Material.Road].color)};shader.uniforms.uRoadShoulder={value:new Color().setRGB(...palette[Material.Concrete].color)};shader.uniforms.uRoadMarking={value:new Color().setRGB(...palette[Material.Stripe].color)};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 roadCoord;attribute vec3 roadEdge;varying vec3 vRoadCoord;varying vec3 vRoadEdge;varying float vRoadTop;');
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvRoadCoord=roadCoord;vRoadEdge=roadEdge;vRoadTop=normal.y;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRoadCoord;varying vec3 vRoadEdge;varying float vRoadTop;uniform vec3 uRoadAsphalt;uniform vec3 uRoadShoulder;uniform vec3 uRoadMarking;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float across=abs(vRoadCoord.x),halfRoad=vRoadCoord.z,aa=max(.018,fwidth(vRoadCoord.x));
float paved=1.-smoothstep(halfRoad-aa,halfRoad+aa,across);
vec3 shoulder=mix(uRoadShoulder,vRoadEdge,smoothstep(halfRoad+1.0,halfRoad+2.0,across));
vec3 roadColour=mix(shoulder,uRoadAsphalt,paved);
float edgeLine=1.-smoothstep(.045,.045+aa,abs(across-(halfRoad-.38)));
float dash=step(mod(vRoadCoord.y,9.),3.6),centre=(1.-smoothstep(.065,.065+aa,across))*dash;
float marking=max(edgeLine,centre)*paved*smoothstep(.45,.8,vRoadTop);
diffuseColor.rgb*=mix(roadColour,uRoadMarking,marking);`);
 };
 material.customProgramCacheKey=()=> 'coast-road-paint-1';return material;
}

/** Shared top normals remove the checkerboard lighting while contact triangles
 * stay exactly where the walker, tyres and destruction system expect them. */
export function finishRoadSurfaces(geometries:readonly BufferGeometry[]):void{
 const normals=new Map<string,Vector3>(),coordinates=new Map<string,{coord:number[];edge:number[]}>(),a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3();
 const vertexKey=(x:number,y:number,z:number)=>`${x},${y},${z}`;
 for(const geometry of geometries){const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');for(let i=0;i<p.count;i+=3){if(n.getY(i)<.5)continue;a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);normal.crossVectors(b.sub(a),c.sub(a));for(let j=0;j<3;j++){const key=vertexKey(p.getX(i+j),p.getY(i+j),p.getZ(i+j)),sum=normals.get(key);if(sum)sum.add(normal);else normals.set(key,normal.clone());}}}
 for(const value of normals.values())value.normalize();
 for(const geometry of geometries){const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),road:number[]=[],edge:number[]=[];
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),key=`${x},${z}`;let value=coordinates.get(key);
   if(!value){const r=sampleRegionalRoad(x,z,8);if(r){const distance=Math.max(.01,r.distance),ex=r.x+(x-r.x)/distance*(r.halfWidth+r.shoulder+3),ez=r.z+(z-r.z)/distance*(r.halfWidth+r.shoulder+3),m=regionalSurfaceAt(ex,ez);value={coord:[r.across,r.along,r.halfWidth],edge:palette[m]?.color??palette[Material.Grass].color};}else value={coord:[0,0,4.5],edge:palette[Material.Grass].color};coordinates.set(key,value);}
   road.push(...value.coord);edge.push(...value.edge);if(n.getY(i)>.5){const sum=normals.get(vertexKey(x,p.getY(i),z));if(sum)n.setXYZ(i,sum.x,sum.y,sum.z);}
  }
  geometry.setAttribute('roadCoord',new Float32BufferAttribute(road,3));geometry.setAttribute('roadEdge',new Float32BufferAttribute(edge,3));n.needsUpdate=true;
 }
}
