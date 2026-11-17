import type {Vec3} from '../destruction/types';

/** Explicit roadside/aircraft assistance only. A bounded search must never
 * turn ordinary contact into noclip, reset the world, or guess an unsafe pose. */
export function findLocalRecovery<T>(origin:Vec3,heading:number,resolve:(candidate:Vec3)=>T|null,heights:readonly number[]=[0]):T|null{
  for(const radius of [0,1,2,4,6,10]){
    for(let direction=0;direction<(radius?8:1);direction++){
      const angle=heading+direction*Math.PI/4;
      for(const dy of heights){
        if(!radius&&!dy)continue;
        const result=resolve({x:origin.x+Math.sin(angle)*radius,y:origin.y+dy,z:origin.z+Math.cos(angle)*radius});
        if(result!==null)return result;
      }
    }
  }
  return null;
}

/** Waiting at rest or a hidden tab is not a stuck vehicle. Ordinary contact
 * keeps its collision; sustained attempted travel only offers assistance. */
export class VehicleStallWatch{
  private anchor:Vec3|undefined;
  private seconds=0;
  get stuck(){return this.seconds>=2;}
  reset(){this.anchor=undefined;this.seconds=0;}
  update(dt:number,position:Vec3,trying:boolean,blocked:boolean):void{
    if(!trying||!blocked||dt<=0||dt>.25){this.reset();return;}
    if(!this.anchor||Math.hypot(position.x-this.anchor.x,position.y-this.anchor.y,position.z-this.anchor.z)>.35){
      this.anchor={...position};this.seconds=0;
    }
    this.seconds+=dt;
  }
}
