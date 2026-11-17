import {BoxGeometry,Vector3} from 'three';

/** 54 vertices: softly clipped block clusters, shared by young trees and pots. */
export function canopyGeometry():BoxGeometry{
 const geometry=new BoxGeometry(1,1,1,2,2,2),positions=geometry.getAttribute('position'),p=new Vector3(),rounded=new Vector3();
 for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i);rounded.copy(p).normalize().multiplyScalar(.5);p.lerp(rounded,.40);positions.setXYZ(i,p.x,p.y,p.z);}
 geometry.name='leaf-cluster';geometry.computeVertexNormals();return geometry;
}
