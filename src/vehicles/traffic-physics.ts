import type {Vec3} from '../destruction/types';
export type TrafficKind='sedan'|'van'|'bus';
// Gameplay tuning for the authored vehicles, not a real vehicle specification.
export function trafficMass(half:Vec3,kind?:TrafficKind){
 const type=kind??(half.y>1.2&&Math.max(half.x,half.z)>2.8?'bus':half.y>.9?'van':'sedan');
 return type==='bus'?{mass:6500,comHeight:.82}:type==='van'?{mass:1900,comHeight:.72}:{mass:1150,comHeight:.52};
}
export function boxInertia(mass:number,half:Vec3):Vec3{return{x:mass*(half.y**2+half.z**2)/3,y:mass*(half.x**2+half.z**2)/3,z:mass*(half.x**2+half.y**2)/3};}
