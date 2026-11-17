import {Euler,Quaternion,Vector3} from 'three';
import {orientedCollisionBounds,type SceneObstacle} from '../input/scene-collisions';
import type {Vec3} from '../destruction/types';

const center=new Vector3(),upper=new Quaternion(),bank=new Quaternion(),head=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.16),q=new Quaternion(),axis=new Vector3(0,0,1),euler=new Euler();
/** Follow cyclePose's upper body and cap, including steering lean. The raised
 * cycling pose is required before moving; a planted foot cannot duck a beam.
 * A separate head box avoids inventing a high wall above the front wheel. */
export function bicycleRiderBounds(position:Vec3,rotation:Quaternion,steer:number,speed:number,target:SceneObstacle):void{
 const tilt=-.43-Math.abs(steer)*.25;
 upper.setFromEuler(euler.set(tilt,steer*.35,0,'XYZ'));
 bank.setFromAxisAngle(axis,Math.max(-.22,Math.min(.22,steer*speed*.035)));
 center.set(0,.02,0).applyQuaternion(head).add({x:0,y:1.602,z:-.006}).applyQuaternion(upper);
 center.y+=.14+1.03*(1-Math.cos(tilt));center.z+=.03-1.03*Math.sin(tilt);
 center.applyQuaternion(bank).applyQuaternion(rotation).add(position);
 q.copy(rotation).multiply(bank).multiply(upper).multiply(head);
 orientedCollisionBounds(center,q,{x:.15,y:.17,z:.17},target);
}
