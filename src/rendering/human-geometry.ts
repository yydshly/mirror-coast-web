import {CylinderGeometry,SphereGeometry} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Shared small chamfers preserve the block-world silhouette without razor edges. */
export function humanBox(radius=.12,bottomWidth=1,topWidth=1){
  const geometry=new RoundedBoxGeometry(1,1,1,1,radius),positions=geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++){
    const t=positions.getY(i)+.5;positions.setX(i,positions.getX(i)*(bottomWidth+(topWidth-bottomWidth)*t));
  }
  geometry.computeVertexNormals();return geometry;
}
export function humanSleeve(){return new CylinderGeometry(.5,.44,1,8);}
export function knittedCap(){
  const geometry=new SphereGeometry(.5,12,6,0,Math.PI*2,0,Math.PI/2),positions=geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++)positions.setY(i,positions.getY(i)*2-.5);
  geometry.computeVertexNormals();return geometry;
}
