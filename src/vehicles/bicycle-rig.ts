import type {Vector3Like} from '../world/voxel';

/** All coordinates are metres in the bicycle's unbanked local frame. */
export const BICYCLE_RIG = {
  wheelRadius: .34,
  tyreTube: .037,
  crankY: .39,
  crankRadius: .16,
  pedalX: .175,
  pedalThickness: .03,
  pedalTop: .017,
  saddleTop: .94,
  parkLean: .13,
  standPivot: {x:-.075,y:.362,z:.40},
  standLength: .415,
  standFootX: -.30,
  standFootZ: .53,
  soleContact: {x: 0, y: -.15, z: -.10},
  steeringPivot: {x:0,y:.78,z:-.68},
  steeringAxis: {x:0,y:.20,z:.07},
} as const;

export type BicycleSide = -1 | 1;

/** The actual platform, not an independent leg-animation sine wave. */
export function bicyclePedal(side:BicycleSide, phase:number):Vector3Like {
  const a = phase + (side === -1 ? 0 : Math.PI);
  return {x:side*BICYCLE_RIG.pedalX,
    y:BICYCLE_RIG.crankY+Math.cos(a)*BICYCLE_RIG.crankRadius,
    z:-Math.sin(a)*BICYCLE_RIG.crankRadius};
}

export function bicycleGrip(side:BicycleSide, steer:number):Vector3Like {
  const pivot=BICYCLE_RIG.steeringPivot,axis=BICYCLE_RIG.steeringAxis,length=Math.hypot(axis.y,axis.z),ky=axis.y/length,kz=axis.z/length;
  const x=side*.23,y=1.25-pivot.y,z=-.52-pivot.z,c=Math.cos(steer),s=Math.sin(steer),dot=ky*y+kz*z;
  return{x:pivot.x+x*c+(ky*z-kz*y)*s,y:pivot.y+y*c+kz*x*s+ky*dot*(1-c),z:pivot.z+z*c-ky*x*s+kz*dot*(1-c)};
}

export type BicyclePose = {
  phase:number;
  wheelAngle:number;
  speed:number;
  steer:number;
  pitch:number;
  riding:boolean;
  /** Left boot goes to the road only after coming to a stop. */
  footDown:number;
  backingPhase?:number;
  groundAt?:(x:number,z:number)=>number|null;
};
