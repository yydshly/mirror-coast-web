import type { Quat, Vec3 } from '../destruction/types';
import {Box3,Ray,Vector3,Quaternion,Matrix3,Matrix4,Triangle,type BufferGeometry} from 'three';
import {OBB} from 'three/addons/math/OBB.js';

/** Shared by the character and camera; bounds use actual world metres. */
export type SurfaceMotion={frame:number;delta:Vec3};
export type SceneObstacle = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; standable?: boolean;vaultable?:boolean;physicsManaged?:boolean;pedestrianId?:number;bicycle?:boolean;trafficId?:number;trafficKind?:'sedan'|'van'|'bus';trafficVelocity?:Vec3;trafficHeading?:number;trafficHalfSize?:Vec3;obb?:OBB;motion?:SurfaceMotion;surface?:readonly [number,number,number,number];hull?:Float32Array };

/** Existing actor contacts may slide apart, but may never deepen or cross the
 * other actor's centre. Callers restrict this exception to people/bicycles. */
export function contactSeparates(before:SceneObstacle,after:SceneObstacle,other:SceneObstacle,margin=0):boolean{
 const area=(b:SceneObstacle)=>Math.max(0,Math.min(b.maxX,other.maxX+margin)-Math.max(b.minX,other.minX-margin))*Math.max(0,Math.min(b.maxZ,other.maxZ+margin)-Math.max(b.minZ,other.minZ-margin));
 const old=area(before);if(old<=0||area(after)>old+1e-8)return false;
 const ox=(other.minX+other.maxX)/2,oz=(other.minZ+other.maxZ)/2;
 const distance=(b:SceneObstacle)=>((b.minX+b.maxX)/2-ox)**2+((b.minZ+b.maxZ)/2-oz)**2;
 return distance(after)>distance(before)+1e-10;
}

/** Same diagonal and heights as the road's two visible triangles. */
export function surfaceHeightAt(b:SceneObstacle,x:number,z:number):number{
 const h=b.surface;if(!h)return b.maxY;
 const u=Math.max(0,Math.min(1,(x-b.minX)/(b.maxX-b.minX))),v=Math.max(0,Math.min(1,(z-b.minZ)/(b.maxZ-b.minZ)));
 return u+v<=1?h[0]+u*(h[1]-h[0])+v*(h[2]-h[0]):h[3]+(1-v)*(h[1]-h[3])+(1-u)*(h[2]-h[3]);
}
/** Exact triangle/box contact for a pitched chassis above a graded road. A
 * road's highest point must not turn its entire broad box into a solid wall. */
export function surfaceIntersectsBox(surface:SceneObstacle,box:SceneObstacle):boolean{
 if(!surface.surface)return obstaclesIntersect(surface,box);
 if(box.maxX<=surface.minX||box.minX>=surface.maxX||box.maxZ<=surface.minZ||box.minZ>=surface.maxZ)return false;
 const h=surface.surface,points=[new Vector3(surface.minX,h[0],surface.minZ),new Vector3(surface.maxX,h[1],surface.minZ),new Vector3(surface.minX,h[2],surface.maxZ),new Vector3(surface.maxX,h[3],surface.maxZ)],bounds=new Box3();
 if(box.obb){const inverse=new Matrix3().copy(box.obb.rotation).transpose();for(const p of points)p.sub(box.obb.center).applyMatrix3(inverse);bounds.min.copy(box.obb.halfSize).multiplyScalar(-1);bounds.max.copy(box.obb.halfSize);}else{bounds.min.set(box.minX,box.minY,box.minZ);bounds.max.set(box.maxX,box.maxY,box.maxZ);}
 return bounds.intersectsTriangle(new Triangle(points[0],points[2],points[1]))||bounds.intersectsTriangle(new Triangle(points[1],points[2],points[3]));
}
function surfaceMaximum(b:SceneObstacle,minX:number,maxX:number,minZ:number,maxZ:number):number{
 let top=Math.max(surfaceHeightAt(b,minX,minZ),surfaceHeightAt(b,maxX,minZ),surfaceHeightAt(b,minX,maxZ),surfaceHeightAt(b,maxX,maxZ));
 // A rectangle can cross the diagonal ridge without containing either of its
 // ends. Include the clipped ridge endpoints, not only the rectangle corners.
 const x0=Math.max(b.minX,minX),x1=Math.min(b.maxX,maxX),z0=Math.max(b.minZ,minZ),z1=Math.min(b.maxZ,maxZ),width=b.maxX-b.minX,depth=b.maxZ-b.minZ;
 for(const x of [x0,x1]){const z=b.minZ+(1-(x-b.minX)/width)*depth;if(z>=z0&&z<=z1)top=Math.max(top,surfaceHeightAt(b,x,z));}
 for(const z of [z0,z1]){const x=b.minX+(1-(z-b.minZ)/depth)*width;if(x>=x0&&x<=x1)top=Math.max(top,surfaceHeightAt(b,x,z));}
 return top;
}

/** Broad bounds select nearby objects; OBB narrow checks retain rotated openings. */
export function orientedCollisionBounds(position:Vec3,q:Quat,half:Vec3,target?:SceneObstacle):SceneObstacle{
 const bounds=orientedBoxBounds(position,q,half,target);bounds.obb??=new OBB();const box=bounds.obb;
 box.center.copy(position);box.halfSize.copy(half);const n=Math.hypot(q.x,q.y,q.z,q.w)||1,x=q.x/n,y=q.y/n,z=q.z/n,w=q.w/n;
 box.rotation.set(1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y));return bounds;
}
const bodyBox=new Box3(),sample=new Vector3(),nearest=new Vector3(),down=new Ray(new Vector3(),new Vector3(0,-1,0));
export function obstaclesIntersect(a:SceneObstacle,b:SceneObstacle):boolean{
 if(a.maxX<=b.minX||a.minX>=b.maxX||a.maxY<=b.minY||a.minY>=b.maxY||a.maxZ<=b.minZ||a.minZ>=b.maxZ)return false;
 if(a.surface&&b.minY>=surfaceMaximum(a,b.minX,b.maxX,b.minZ,b.maxZ)-.0001)return false;
 if(b.surface&&a.minY>=surfaceMaximum(b,a.minX,a.maxX,a.minZ,a.maxZ)-.0001)return false;
 if(a.obb&&b.obb)return a.obb.intersectsOBB(b.obb,1e-8);
 const plain=a.obb?b:a,oriented=a.obb??b.obb;
 if(!oriented)return true;
 bodyBox.min.set(plain.minX,plain.minY,plain.minZ);bodyBox.max.set(plain.maxX,plain.maxY,plain.maxZ);return oriented.intersectsBox3(bodyBox);
}
export function obstacleIntersectsBody(b:SceneObstacle,p:Vec3,radius:number,height:number):boolean{
 if(p.x+radius<=b.minX||p.x-radius>=b.maxX||p.z+radius<=b.minZ||p.z-radius>=b.maxZ||p.y+height<=b.minY||p.y>=b.maxY)return false;
 if(b.surface)return p.y<surfaceMaximum(b,p.x-radius,p.x+radius,p.z-radius,p.z+radius)-.0001;
 if(!b.obb)return true;
 bodyBox.min.set(p.x-radius+.0001,p.y+.0001,p.z-radius+.0001);bodyBox.max.set(p.x+radius-.0001,p.y+height-.0001,p.z+radius-.0001);return b.obb.intersectsBox3(bodyBox);
}
export function obstacleTopAt(b:SceneObstacle,x:number,z:number,radius:number,maxTop:number):number|null{
 if(b.surface){const top=surfaceMaximum(b,x-radius,x+radius,z-radius,z+radius);return top<=maxTop+.0001?top:null;}
 if(!b.obb)return b.maxY<=maxTop+.0001?b.maxY:null;
 let top:number|null=null;
 for(const [dx,dz]of [[0,0],[radius*.75,0],[-radius*.75,0],[0,radius*.75],[0,-radius*.75]]){
  down.origin.set(x+dx,b.maxY+.02,z+dz);const hit=b.obb.intersectRay(down,sample);if(hit&&hit.y<=maxTop+.0001)top=Math.max(top??-Infinity,hit.y);
 }return top;
}
export function obstacleIntersectsSphere(b:SceneObstacle,p:Vec3,radius:number):boolean{
 if(b.obb){b.obb.clampPoint(sample.copy(p),nearest);return nearest.distanceToSquared(p)<radius*radius;}
 const dx=Math.max(b.minX-p.x,0,p.x-b.maxX),dy=Math.max(b.minY-p.y,0,p.y-b.maxY),dz=Math.max(b.minZ-p.z,0,p.z-b.maxZ);return dx*dx+dy*dy+dz*dz<radius*radius;
}

export function orientedBoxBounds(position: Vec3, rotation: Quat, half: Vec3, target?: SceneObstacle): SceneObstacle {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) || 1;
  const x = rotation.x / length, y = rotation.y / length, z = rotation.z / length, w = rotation.w / length;
  const hx = Math.abs(1 - 2 * (y * y + z * z)) * half.x + Math.abs(2 * (x * y - z * w)) * half.y + Math.abs(2 * (x * z + y * w)) * half.z;
  const hy = Math.abs(2 * (x * y + z * w)) * half.x + Math.abs(1 - 2 * (x * x + z * z)) * half.y + Math.abs(2 * (y * z - x * w)) * half.z;
  const hz = Math.abs(2 * (x * z - y * w)) * half.x + Math.abs(2 * (y * z + x * w)) * half.y + Math.abs(1 - 2 * (x * x + y * y)) * half.z;
  const bounds = target ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  bounds.minX = position.x - hx; bounds.maxX = position.x + hx;
  bounds.minY = position.y - hy; bounds.maxY = position.y + hy;
  bounds.minZ = position.z - hz; bounds.maxZ = position.z + hz;
  return bounds;
}

/** Match a rendered part's actual local geometry, scale and rotation. */
export function partCollisionBounds(geometry:BufferGeometry,matrix:Matrix4,standable=false):SceneObstacle{
 if(!geometry.boundingBox)geometry.computeBoundingBox();
 const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();matrix.decompose(position,rotation,scale);
 const box=geometry.boundingBox!,center=box.getCenter(new Vector3()).multiply(scale).applyQuaternion(rotation).add(position),half=box.getSize(new Vector3()).multiply(scale).multiplyScalar(.5);
 half.set(Math.max(.001,Math.abs(half.x)),Math.max(.001,Math.abs(half.y)),Math.max(.001,Math.abs(half.z)));
 return{...orientedCollisionBounds(center,rotation,half),standable,vaultable:false};
}

/** Gather once per frame, not once per character collision sample. */
export function collectNearbyObstacles(center: Vec3, groups: readonly (readonly SceneObstacle[])[], radius = 16,verticalRadius=Infinity): SceneObstacle[] {
  const found: SceneObstacle[] = [];
  for (const group of groups) for (const bounds of group) {
    if (bounds.maxX >= center.x - radius && bounds.minX <= center.x + radius && bounds.maxZ >= center.z - radius && bounds.minZ <= center.z + radius&&bounds.maxY>=center.y-verticalRadius&&bounds.minY<=center.y+verticalRadius) found.push(bounds);
  }
  return found;
}
