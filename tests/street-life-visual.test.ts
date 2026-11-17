import {afterEach,describe,expect,it,vi} from 'vitest';
import {Box3,InstancedMesh,Matrix4,Scene,Vector3,Raycaster,type MeshStandardMaterial} from 'three';
import {StreetLife} from '../src/rendering/street-life';
import {VoxelWorld} from '../src/world/voxel';
import {TRAFFIC_CABIN_RIG} from '../src/vehicles/traffic-interior';

const actors:StreetLife[]=[];
afterEach(()=>{actors.splice(0).forEach(actor=>actor.dispose());vi.restoreAllMocks();});
const context={focus:{x:0,y:16,z:0},night:0,wetness:0,obstacles:[]};
function setup(id=1){
  const scene=new Scene(),life=new StreetLife(scene,new VoxelWorld());actors.push(life);
  // Isolate the visual actor from route/traffic decisions, which have their own
  // real-world tests. The physical feet position is still the only ground input.
  vi.spyOn(life.simulation,'update').mockImplementation(()=>{});
  life.simulation.cars.forEach(car=>car.visible=false);
  life.simulation.people.forEach(person=>person.visible=false);
  const person=life.simulation.people[id];person.visible=true;person.position={x:0,y:16,z:0};person.heading=0;person.speed=0;
  const batch=(name:string)=>scene.getObjectByName(`street-life-${name}`) as InstancedMesh;
  const tick=(wetness=0)=>life.update(1/60,{...context,wetness});
  for(let i=0;i<120;i++)tick();
  return {scene,life,person,batch,tick};
}
function activeMatrices(mesh:InstancedMesh){
  const matrices:Matrix4[]=[];
  for(let i=0;i<mesh.count;i++){
    const matrix=new Matrix4();mesh.getMatrixAt(i,matrix);
    if(Math.abs(matrix.determinant())>1e-10)matrices.push(matrix);
  }
  return matrices;
}
function instanceBounds(mesh:InstancedMesh){
  mesh.geometry.computeBoundingBox();
  return activeMatrices(mesh).map(matrix=>mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
}

describe('close street-life character presentation',()=>{
  it.each(['sedan','van','bus'])('shows a seated driver through the %s windscreen without a solid painted cabin hiding the head',kind=>{
    const {scene,life,batch,tick}=setup(0);life.simulation.people.forEach(p=>p.visible=false);
    const car=life.simulation.cars.find(c=>c.kind===kind)!;car.visible=true;car.position={x:0,y:16,z:0};car.heading=0;tick();
    const height=TRAFFIC_CABIN_RIG[kind as keyof typeof TRAFFIC_CABIN_RIG].headY;
    const ray=new Raycaster(new Vector3(-car.width*.22,16+height,-6),new Vector3(0,0,1));scene.updateMatrixWorld(true);
    const hits=ray.intersectObjects(scene.children,true).filter(h=>h.object instanceof InstancedMesh&&!(h.object.material as MeshStandardMaterial).transparent);
    expect(hits[0]?.object.name).toBe('street-life-skin');expect(batch('driver-wheel').count).toBe(1);
  });
  it('uses circular tyres with real ground contact for moving vehicles',()=>{
    const {life,batch,tick}=setup(0);life.simulation.people.forEach(p=>p.visible=false);
    const car=life.simulation.cars[0];car.visible=true;car.position={x:0,y:16,z:0};car.heading=.6;car.travelled=.7;tick();
    const tyres=batch('car-tyres');expect(tyres.count).toBe(4);expect(tyres.geometry.type).toBe('CylinderGeometry');
    const position=tyres.geometry.getAttribute('position'),point=new Vector3(),matrix=new Matrix4();
    for(let wheel=0;wheel<4;wheel++){
      tyres.getMatrixAt(wheel,matrix);let bottom=Infinity;
      for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(matrix);bottom=Math.min(bottom,point.y);}
      expect(bottom).toBeGreaterThanOrEqual(15.999);expect(bottom).toBeLessThan(16.007);
    }
  });
  it('keeps one level sole on the actor floor through a full stride and settles both legs when stopped',()=>{
    const {person,batch,tick}=setup();let clearance=0;
    for(let frame=0;frame<180;frame++){
      person.speed=1.2;person.position.z-=1.2/60;tick();
      const shoes=instanceBounds(batch('rubber'));
      expect(shoes).toHaveLength(4);
      const feet=[Math.min(shoes[0].min.y,shoes[1].min.y),Math.min(shoes[2].min.y,shoes[3].min.y)];
      expect(Math.min(...feet)).toBeCloseTo(16,5);
      expect(feet.every(y=>y>=15.99999)).toBe(true);
      clearance=Math.max(clearance,...feet.map(y=>y-16));
    }
    expect(clearance).toBeGreaterThan(.025);
    person.speed=0;for(let frame=0;frame<120;frame++)tick();
    const settled=activeMatrices(batch('pants')).map(matrix=>matrix.elements);
    for(let frame=0;frame<120;frame++)tick();
    const later=activeMatrices(batch('pants')).map(matrix=>matrix.elements);
    expect(later.flat().every((value,i)=>Math.abs(value-settled.flat()[i])<1e-6)).toBe(true);
    const soles=instanceBounds(batch('rubber'));
    expect(Math.min(soles[0].min.y,soles[1].min.y)).toBeCloseTo(16,5);
    expect(Math.min(soles[2].min.y,soles[3].min.y)).toBeCloseTo(16,5);
  });

  it('keeps a closed hand on the umbrella shaft throughout walking and covers the head from below',()=>{
    const {person,batch,tick}=setup(1);
    for(let frame=0;frame<90;frame++){
      person.speed=1.3;person.position.z-=1.3/60;tick(1);
      const shaft=instanceBounds(batch('handles'))[0];
      const hands=instanceBounds(batch('skin')).filter(bounds=>{
        const centre=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3());
        return centre.y>17.1&&centre.y<17.4&&size.y<.12;
      });
      expect(hands.some(hand=>hand.intersectsBox(shaft))).toBe(true);
      const head=instanceBounds(batch('skin'))[1],canopy=instanceBounds(batch('umbrellas'))[0];
      expect(canopy.min.y).toBeGreaterThan(head.max.y+.08);
      expect(shaft.max.y).toBeGreaterThan(canopy.min.y);
    }
    expect((batch('umbrellas').material as {side:number}).side).toBe(2);
  });

  it('varies adult silhouettes and clothing without introducing one mesh or light per person',()=>{
    const {scene,life,person,batch,tick}=setup(0),silhouettes=new Set<string>();
    for(let id=0;id<4;id++){
      person.visible=false;life.simulation.people.forEach(p=>p.visible=false);
      const p=life.simulation.people[id];p.visible=true;p.position={x:0,y:16,z:0};p.speed=0;tick();
      const bounds=instanceBounds(batch('coat')).reduce((union,b)=>union.union(b),new Box3());
      const size=bounds.getSize(new Vector3());
      silhouettes.add(`${size.x.toFixed(3)}:${size.y.toFixed(3)}:${activeMatrices(batch('coat')).length}`);
      const skin=instanceBounds(batch('skin')),headSize=skin[1].getSize(new Vector3());
      expect(headSize.y).toBeLessThan(.26);expect(headSize.y).toBeGreaterThan(.23);
      expect(skin[1].max.y).toBeLessThan(17.8);
    }
    expect(silhouettes.size).toBe(4);
    const root=scene.getObjectByName('living-streets')!;
    // Six bus materials, four small-car cabin materials and two hollow bodies
    // are shared by all vehicles. One extra pane batch removes double glazing.
    const interior=root.children.filter(child=>child.name.startsWith('street-life-bus-')||child.name.startsWith('street-life-traffic-'));
    expect(interior).toHaveLength(12);
    expect(root.children.length-interior.length).toBeLessThanOrEqual(27);
    expect(root.children.every(child=>child instanceof InstancedMesh)).toBe(true);
    const busGeometry=interior.filter(child=>child.name.startsWith('street-life-bus-')).map(child=>(child as InstancedMesh).geometry);
    for(const car of life.simulation.cars.filter(c=>c.kind==='bus')){car.visible=true;car.position={x:car.id*3,y:16,z:0};}
    tick();
    for(const mesh of interior.filter(child=>child.name.startsWith('street-life-bus-')))expect((mesh as InstancedMesh).count).toBe(2);
    expect(interior.filter(child=>child.name.startsWith('street-life-bus-')).map(child=>(child as InstancedMesh).geometry)).toEqual(busGeometry);
    expect(root.children.length).toBeLessThanOrEqual(39);
  });
  it.each(['sedan','van','bus'] as const)('puts the %s driver on the cushion with both hands touching the wheel',kind=>{
    const {scene,life,batch,tick}=setup(0);life.simulation.people.forEach(p=>p.visible=false);
    const car=life.simulation.cars.find(c=>c.kind===kind)!;car.visible=true;car.position={x:0,y:16,z:0};car.heading=0;tick();scene.updateMatrixWorld(true);
    const rig=TRAFFIC_CABIN_RIG[kind],wheelMatrix=activeMatrices(batch('driver-wheel'))[0].invert(),hands=activeMatrices(batch('skin')).slice(2);
    expect(hands).toHaveLength(2);
    for(const m of hands){const grip=new Vector3().setFromMatrixPosition(m).applyMatrix4(wheelMatrix);expect(Math.abs(Math.hypot(grip.x,grip.y)-.17)).toBeLessThan(.003);expect(Math.abs(grip.z)).toBeLessThan(.018);}
    const seats=batch(kind==='bus'?'bus-seats':`traffic-${kind}-seats`);
    const cushion=new Raycaster(new Vector3(rig.x,16+rig.hipY+.03,rig.z-.02),new Vector3(0,-1,0)).intersectObject(seats)[0];
    expect(cushion).toBeDefined();expect(16+rig.hipY-cushion.point.y).toBeGreaterThan(.04);expect(16+rig.hipY-cushion.point.y).toBeLessThan(.08);
    if(kind==='van'){
      const innerWall=new Raycaster(new Vector3(rig.x,16+rig.footY+.05,rig.z),new Vector3(0,0,-1)).intersectObject(batch('traffic-van-body'))[0];expect(innerWall).toBeDefined();
      for(const shoe of instanceBounds(batch('rubber')).slice(0,2))expect(shoe.min.z).toBeGreaterThan(innerWall.point.z+.005);
    }
  });
});
