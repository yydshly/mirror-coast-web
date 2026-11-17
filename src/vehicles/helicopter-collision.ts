import type {Vec3} from '../destruction/types';

export const MAIN_ROTOR={center:{x:0,y:1.87,z:-.2},radius:4.87,halfHeight:.08};
type AirframePart={center:Vec3;half:Vec3;rotor?:boolean};
/** Model-space envelopes shared by physics, turning clearance and feet.
 * The spinning rotor uses a swept disc, independent of the current blade frame. */
export const HELICOPTER_COLLISION_PARTS:readonly AirframePart[]=[
 {center:{x:0,y:.17,z:-.17},half:{x:1.04,y:.94,z:2.11}},
 {center:{x:0,y:-1.38,z:0},half:{x:1.22,y:.08,z:2.36}},
 {center:MAIN_ROTOR.center,half:{x:MAIN_ROTOR.radius,y:MAIN_ROTOR.halfHeight,z:MAIN_ROTOR.radius},rotor:true},
 {center:{x:0,y:.11,z:3.15},half:{x:.27,y:.27,z:1.95}},
 {center:{x:0,y:.8,z:5.02},half:{x:.09,y:.9,z:.48}},
 {center:{x:0,y:.23,z:4.28},half:{x:1.24,y:.08,z:.35}},
 {center:{x:-.26,y:.65,z:5.1},half:{x:.08,y:.84,z:.84}},
];
