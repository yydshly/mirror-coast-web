import type{SceneObstacle}from'../input/scene-collisions';

/** A small wall reaction for an existing/adjacent contact. The travel must be
 * tangent or outward; a new frontal impact never gets pushed through a wall. */
export function bicycleWallCorrection(before:SceneObstacle,next:SceneObstacle,wall:SceneObstacle,travel:{x:number;z:number}):{x:number;z:number}|null{
  const center=(b:SceneObstacle)=>b.obb?.center??{x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2};
  const radius=(b:SceneObstacle,x:number,z:number)=>{
    if(!b.obb)return Math.abs(x)*(b.maxX-b.minX)/2+Math.abs(z)*(b.maxZ-b.minZ)/2;
    const e=b.obb.rotation.elements,h=b.obb.halfSize;
    return Math.abs(x*e[0]+z*e[2])*h.x+Math.abs(x*e[3]+z*e[5])*h.y+Math.abs(x*e[6]+z*e[8])*h.z;
  };
  const a=center(before),b=center(wall),axes=[{x:1,z:0},{x:0,z:1}];
  for(const box of [before,wall])if(box.obb){const e=box.obb.rotation.elements;for(const i of [0,6]){const length=Math.hypot(e[i],e[i+2]);if(length>.9)axes.push({x:e[i]/length,z:e[i+2]/length});}}
  let gap=-Infinity,nx=0,nz=0;
  for(const axis of axes){const dot=(a.x-b.x)*axis.x+(a.z-b.z)*axis.z,sign=dot<0?-1:1,current=Math.abs(dot)-radius(before,axis.x,axis.z)-radius(wall,axis.x,axis.z);if(current>gap){gap=current;nx=axis.x*sign;nz=axis.z*sign;}}
  if(gap<-.035||gap>.015||travel.x*nx+travel.z*nz< -1e-8)return null;
  const p=center(next),remaining=(p.x-b.x)*nx+(p.z-b.z)*nz-radius(next,nx,nz)-radius(wall,nx,nz),amount=.008-remaining;
  if(amount<=0||amount>.04)return null;
  return{x:nx*amount,z:nz*amount};
}
