import { Ray,Vector3 } from 'three';
import type { Vector3Like, VoxelWorld } from '../world/voxel';
import type { SceneObstacle } from '../input/scene-collisions';

const direction = new Vector3(), right = new Vector3(), up = new Vector3();
const originOffset = new Vector3();
const propRay=new Ray(),propHit=new Vector3();

/** Volume rays protect the camera/near plane even before a terrain collider uploads. */
export function clipVehicleCamera(world: VoxelWorld, origin: Vector3Like, destination: Vector3Like, queryPhysics: (origin: Vector3Like, direction: Vector3Like, distance: number) => number, output: Vector3, props: readonly SceneObstacle[] = []): Vector3 {
  direction.copy(destination).sub(origin);
  const length = direction.length();
  if (length < .00001) return output.copy(origin);
  direction.multiplyScalar(1 / length);
  right.set(direction.z, 0, -direction.x);
  if (right.lengthSq() < .0001) right.set(1, 0, 0); else right.normalize();
  up.crossVectors(direction, right).normalize();
  let distance = length;
  for (const [x, y] of [[0,0], [-.2,0], [.2,0], [0,-.2], [0,.2], [-.14,-.14], [.14,-.14], [-.14,.14], [.14,.14]]) {
    originOffset.copy(origin).addScaledVector(right,x).addScaledVector(up,y);
    distance = Math.min(distance, queryPhysics(originOffset,direction,length));
    const hit = world.raycast(originOffset,direction,length);
    if (hit) distance = Math.min(distance, Math.max(.22,hit.distance-.28));
    for(const prop of props){
      if(prop.maxY<=prop.minY)continue;
      let enter=0,leave=length;
      for(const axis of ['x','y','z'] as const){
        const low=axis==='x'?prop.minX:axis==='y'?prop.minY:prop.minZ,high=axis==='x'?prop.maxX:axis==='y'?prop.maxY:prop.maxZ,d=direction[axis],o=originOffset[axis];
        if(Math.abs(d)<.000001){if(o<low||o>high){leave=-1;break;}}
        else{const a=(low-o)/d,b=(high-o)/d;enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));if(enter>leave)break;}
      }
      if(enter<=leave){
        // A turning vehicle's broad box includes empty corners. Test each
        // volume ray against its real body before pulling the camera inward.
        if(prop.obb){
          if(prop.obb.containsPoint(originOffset))enter=0;
          else{
            propRay.set(originOffset,direction);
            if(!prop.obb.intersectRay(propRay,propHit))continue;
            enter=propHit.distanceTo(originOffset);if(enter>length)continue;
          }
        }
        distance=Math.min(distance,Math.max(.22,enter-.28));
      }
    }
  }
  return output.copy(origin).addScaledVector(direction,Math.max(.22,distance));
}
