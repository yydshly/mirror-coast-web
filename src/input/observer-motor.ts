import {Vector3} from 'three';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
import type {SceneObstacle} from './scene-collisions';
import {cameraSphereClear} from './walk-camera';

/** A floating observation camera has no gravity, but never enters solid scenery. */
export class ObserverMotor{
 readonly radius=.35;
 private lastSafe:Vector3|undefined;
 private candidate=new Vector3();
 constructor(private world:VoxelWorld,private obstacles:()=>readonly SceneObstacle[]=()=>[],private surfaceFloor=12){}
 clear(position:Vector3Like){return position.y>=this.surfaceFloor+this.radius&&cameraSphereClear(this.world,position,this.obstacles(),this.radius);}
 recover(position:Vector3,reusePrevious=false):boolean{
  if(this.clear(position)){this.lastSafe??=position.clone();if(!reusePrevious)this.lastSafe.copy(position);return false;}
  if(reusePrevious&&this.lastSafe&&this.clear(this.lastSafe)){position.copy(this.lastSafe);return true;}
  this.candidate.copy(position);this.candidate.y=Math.max(position.y,this.surfaceFloor+this.radius+.001);
  // Used for legacy underground saves or a newly fallen object overlapping the
  // lens. Normal movement stops at surfaces instead of jumping onto roofs.
  for(;this.candidate.y<=900;this.candidate.y+=.25)if(this.clear(this.candidate)){this.candidate.y+=1.33;if(!this.clear(this.candidate))this.candidate.y-=1.33;position.copy(this.candidate);this.lastSafe=position.clone();return true;}
  return false;
 }
 move(position:Vector3,delta:Vector3Like):{x:boolean;y:boolean;z:boolean}{
  this.recover(position,true);const blocked={x:false,y:false,z:false};
  const steps=Math.max(1,Math.ceil(Math.max(Math.abs(delta.x),Math.abs(delta.y),Math.abs(delta.z))/.16));
  for(let i=0;i<steps;i++)for(const axis of ['x','z','y'] as const){
   if(!delta[axis]||blocked[axis])continue;
   this.candidate.copy(position);this.candidate[axis]+=delta[axis]/steps;
   if(this.clear(this.candidate))position.copy(this.candidate);else blocked[axis]=true;
  }
  if(this.clear(position)){this.lastSafe??=position.clone();this.lastSafe.copy(position);}return blocked;
 }
}

/** Looking down changes the picture, not the height of W/S movement. */
export function observerHeading(direction:Vector3Like,target=new Vector3()):Vector3{
 return target.set(direction.x,0,direction.z).normalize();
}
