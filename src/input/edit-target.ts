import type { Vector3Like, VoxelHit, VoxelWorld } from '../world/voxel';

/** The crosshair selects; the character's eyes determine reach and line of sight. */
export function walkingEditTarget(world: VoxelWorld, camera: Vector3Like, direction: Vector3Like, eyes: Vector3Like, reach = 8): VoxelHit | null {
  const boom = Math.hypot(camera.x-eyes.x,camera.y-eyes.y,camera.z-eyes.z);
  const selected = world.raycast(camera,direction,reach+boom);
  if(!selected)return null;
  const distance=selected.distance+.002;
  const dx=camera.x+direction.x*distance-eyes.x,dy=camera.y+direction.y*distance-eyes.y,dz=camera.z+direction.z*distance-eyes.z;
  const length=Math.hypot(dx,dy,dz);
  if(length>reach+.002 || length<.00001)return null;
  const visible=world.raycast(eyes,{x:dx/length,y:dy/length,z:dz/length},length+.02);
  if(!visible || visible.x!==selected.x || visible.y!==selected.y || visible.z!==selected.z)return null;
  return {...selected,distance:visible.distance};
}
