import {BoxGeometry,BufferGeometry,Float32BufferAttribute,CylinderGeometry,Matrix4,Quaternion,Vector3} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export function carTyreGeometry(radius=.31,width=.22){
  return new CylinderGeometry(radius,radius,width,16).rotateZ(Math.PI/2);
}
/** Shared trapezoidal cabin with a raked windscreen, front facing local -Z. */
export function carCabinGeometry(open=false){
  if(open){
    const parts:BufferGeometry[]=[];
    const beam=(a:Vector3,b:Vector3,width=.045)=>{const delta=b.clone().sub(a),g=new BoxGeometry(width,delta.length(),width).toNonIndexed(),q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.clone().normalize());g.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(.5),q,new Vector3(1,1,1)));parts.push(g);};
    for(const x of [-.5,.5]){
      beam(new Vector3(x,-.5,-.5),new Vector3(x,.5,-.26));beam(new Vector3(x,-.5,.5),new Vector3(x,.5,.32));
      beam(new Vector3(x,-.5,.02),new Vector3(x,.5,.02),.055);
    }
    const roof=new BoxGeometry(1,.10,.60).toNonIndexed().translate(0,.47,.03);parts.push(roof);
    const g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());return g;
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([
    -.5,-.5,-.5,.5,-.5,-.5,.5,.5,-.26,-.5,.5,-.26,
    -.5,-.5,.5,.5,-.5,.5,.5,.5,.32,-.5,.5,.32,
  ],3));
  geometry.setIndex([0,1,2,0,2,3,5,4,7,5,7,6,4,0,3,4,3,7,1,5,6,1,6,2,3,2,6,3,6,7,4,5,1,4,1,0]);
  const result=geometry.toNonIndexed();geometry.dispose();result.computeVertexNormals();return result;
}
export function carWindscreenGeometry(){
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([-.44,-.36,-.475,.44,-.36,-.475,.44,.39,-.294,-.44,.39,-.294],3));
  g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return g;
}
