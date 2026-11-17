import {Vector3} from 'three';
import type {VoxelWorld,Vector3Like,VoxelHit} from '../world/voxel';
import type {CollapsePhysics} from '../destruction/physics';
import type {FragmentHit} from '../destruction/fragment-edit';
export type WorldEditHit=({kind:'terrain'}&VoxelHit)|({kind:'fragment'}&FragmentHit);
/** A single visibility/reach rule for terrain and rotated rubble, including holes. */
export function worldEditTarget(world:VoxelWorld,physics:CollapsePhysics,camera:Vector3Like,direction:Vector3Like,eyes?:Vector3Like,reach=8):WorldEditHit|null{
 const cast=(o:Vector3Like,d:Vector3Like,max:number):WorldEditHit|null=>{
  const terrain=world.raycast(o,d,max),rubble=physics.raycastFragments(o,d,terrain?.distance??max);
  return rubble&&(!terrain||rubble.distance<terrain.distance)?{...rubble,kind:'fragment'}:terrain?{...terrain,kind:'terrain'}:null;
 };
 const boom=eyes?new Vector3().copy(camera).distanceTo(eyes):0,selected=cast(camera,direction,eyes?reach+boom:180);if(!selected||!eyes)return selected;
 const point=new Vector3().copy(camera).addScaledVector(direction,selected.distance+.002),eyeRay=point.sub(eyes),length=eyeRay.length();
 if(length>reach+.002||length<1e-5)return null;eyeRay.divideScalar(length);
 const visible=cast(eyes,eyeRay,length+.02);
 if(!visible||('fragmentId'in visible?visible.fragmentId:undefined)!==('fragmentId'in selected?selected.fragmentId:undefined)||visible.x!==selected.x||visible.y!==selected.y||visible.z!==selected.z)return null;
 return{...selected,distance:visible.distance};
}
