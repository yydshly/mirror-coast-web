import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, CylinderGeometry,
  DoubleSide, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, RingGeometry, Shape, SphereGeometry, Vector3,SpotLight,
} from 'three';
import {createCabin} from './cabin';
import {MAIN_ROTOR} from './helicopter-collision';

export type HelicopterModel = { root: Group; airframe: Group; mainRotor: Group; tailRotor: Group; rotorBlur: Mesh; tailBlur: Mesh; lamps: Mesh[];updateCabin:(dt:number,occupied:boolean,controls:{pitch:number;roll:number;yaw:number;lift:number;speed?:number;altitude?:number;rpm?:number})=>void;updateLights:(engine:boolean,time:number,landing:boolean)=>void;updateRotorAppearance: (rpm: number) => void; dispose: () => void };

export function createHelicopterModel(): HelicopterModel {
  const root = new Group(); root.name = 'coast-helicopter';
  const airframe = new Group(); root.add(airframe);
  const red = new MeshPhysicalMaterial({ color: '#bc302b', roughness: .33, metalness: .17, clearcoat: .65, clearcoatRoughness: .22 });
  const black = new MeshStandardMaterial({ color: '#172426', metalness: .55, roughness: .35 });
  const white = new MeshStandardMaterial({ color: '#ede4cd', roughness: .47, metalness: .2 });
  const glass = new MeshPhysicalMaterial({color:'#a1c3c5',roughness:.18,metalness:0,clearcoat:.35,transparent:true,opacity:.22,depthWrite:false,side:DoubleSide,forceSinglePass:true});
  const metal = new MeshStandardMaterial({ color: '#8b9693', metalness: .85, roughness: .3 });
  // Carbon blades are deliberately unlit: bright environment probes must not
  // wash their small, rapidly moving silhouette into the sky or ocean.
  const blade = new MeshBasicMaterial({ color: '#101d20', transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
  const bladeTip = new MeshBasicMaterial({ color: '#eee3ca', transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
  const blurMaterial = new MeshBasicMaterial({ color: '#17262a', transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, depthTest: true, toneMapped: false, forceSinglePass: true });
  const sweepMaterial = new MeshBasicMaterial({ color: '#142327', transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, depthTest: true, toneMapped: false, forceSinglePass: true });
  const materials = [red, black, white, glass, metal, blade, bladeTip, blurMaterial, sweepMaterial];

  const box = (parent: Group, dimensions: [number, number, number], position: [number, number, number], material: MeshStandardMaterial | MeshBasicMaterial = red) => {
    const mesh = new Mesh(new BoxGeometry(...dimensions), material);
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const rod = (parent: Group, start: Vector3, end: Vector3, radius: number, material: MeshStandardMaterial | MeshPhysicalMaterial) => {
    const delta = end.clone().sub(start);
    const mesh = new Mesh(new CylinderGeometry(radius, radius, delta.length(), 8), material);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const panel = (points: number[], material: MeshPhysicalMaterial) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, material);mesh.name='helicopter-cabin-glass';mesh.renderOrder=2;airframe.add(mesh);return mesh;
  };

  const outline = new Shape();
  outline.moveTo(-1.8, -.45); outline.lineTo(-1.9, .14); outline.lineTo(-.75, .14);
  outline.lineTo(.9, .14); outline.lineTo(2.18, .22); outline.lineTo(2.18, -.35);
  outline.lineTo(1.05, -.7); outline.lineTo(-1.0, -.7); outline.closePath();
  const fuselageGeometry = new ExtrudeGeometry(outline, { depth: .10, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 1, steps: 1 });
  fuselageGeometry.translate(0,0,-.05);fuselageGeometry.rotateY(Math.PI/2);
  for(const side of [-1,1]){const fuselage=new Mesh(fuselageGeometry,red);fuselage.name='helicopter-hollow-side-body';fuselage.position.x=side*.90;fuselage.castShadow=fuselage.receiveShadow=true;airframe.add(fuselage);}
  box(airframe,[1.78,.09,2.7],[0,-.70,-.03]);
  box(airframe,[1.78,.40,.38],[0,-.01,-1.99]);
  const rearOutline=new Shape();rearOutline.moveTo(-1.8,-.45);rearOutline.lineTo(-1.9,.45);rearOutline.lineTo(-.75,1.08);rearOutline.lineTo(-.75,-.7);rearOutline.closePath();
  const rearGeometry=new ExtrudeGeometry(rearOutline,{depth:1.8,bevelEnabled:false});rearGeometry.translate(0,0,-.9);rearGeometry.rotateY(Math.PI/2);const rearBody=new Mesh(rearGeometry,red);rearBody.name='helicopter-rear-engine-body';rearBody.castShadow=rearBody.receiveShadow=true;airframe.add(rearBody);
  box(airframe,[1.80,.08,1.60],[0,1.04,-.05]);
  // Transparent panes close a hollow cockpit, supported by real canopy spars.
  panel([-.79, .25, -2.24, .79, .25, -2.24, .78, 1.065, -.87, -.78, 1.065, -.87], glass);
  rod(airframe, new Vector3(0, .25, -2.26), new Vector3(0, 1.08, -.88), .035, red);
  rod(airframe,new Vector3(-.82,1.06,-.87),new Vector3(.82,1.06,-.87),.04,red);
  for (const side of [-1, 1]) {
    const x = side * .97,upper=side*.89;
    panel([x,.15,-1.85,upper,.98,-.72,upper,.98,.72,x,.15,.85],glass);
    rod(airframe,new Vector3(side*.94,.14,-1.86),new Vector3(side*.88,1.03,-.84),.04,red);
    rod(airframe,new Vector3(side*.94,.14,.84),new Vector3(side*.88,1.03,.74),.04,red);
    box(airframe, [.045, .075, 2.7], [side * 1.015, -.3, -.2], white);
    rod(airframe, new Vector3(side * 1.04, -.15, .93), new Vector3(side * 1.04, .78, .93), .018, black);
    box(airframe, [.055, .045, .23], [side * 1.06, .02, .6], metal);
    // Skids are thin tubes at human scale, including raised front ends.
    rod(airframe, new Vector3(side * 1.16, -1.36, -2.25), new Vector3(side * 1.16, -1.36, 2.3), .055, black);
    rod(airframe, new Vector3(side * 1.16, -1.36, -2.25), new Vector3(side * 1.16, -1.03, -2.65), .055, black);
    for (const z of [-1.15, 1.0]) rod(airframe, new Vector3(side * .7, -.48, z), new Vector3(side * 1.16, -1.32, z), .047, metal);
    box(airframe,[.28,.045,.55],[side*1.04,-.84,.02],metal);
  }
  const cabin=createCabin('helicopter');airframe.add(cabin.root);
  const tail = new Mesh(new CylinderGeometry(.075, .27, 3.9, 5), red);
  tail.rotation.x = Math.PI / 2; tail.position.set(0, .11, 3.15); tail.castShadow = true; airframe.add(tail);
  box(airframe, [.23, .055, 2.7], [0, .25, 3.25], white);
  const finShape = new Shape(); finShape.moveTo(4.55, -.1); finShape.lineTo(5.48, .18); finShape.lineTo(5.25, 1.7); finShape.lineTo(4.78, 1.1); finShape.closePath();
  const finGeometry = new ExtrudeGeometry(finShape, { depth: .13, bevelEnabled: false });
  finGeometry.translate(0, 0, -.065); finGeometry.rotateY(-Math.PI / 2);
  const fin = new Mesh(finGeometry, red); fin.castShadow = true; airframe.add(fin);
  box(airframe, [2.4, .08, .65], [0, .22, 4.28], red);
  box(airframe, [.2, .1, .65], [-1.1, .23, 4.28], white);
  box(airframe, [.2, .1, .65], [1.1, .23, 4.28], white);
  rod(airframe, new Vector3(0, .8, -.2), new Vector3(0, 1.83, -.2), .11, metal);
  box(airframe, [.72, .25, .8], [0, 1.1, .35], black);

  const mainRotor = new Group(); mainRotor.position.copy(MAIN_ROTOR.center); airframe.add(mainRotor);
  for (let i = 0; i < 4; i++) {
    const arm = new Group(); arm.rotation.y = i * Math.PI / 2; mainRotor.add(arm);
    box(arm, [.22, .035, 4.7], [0, 0, -2.45], blade).renderOrder = 41;
    box(arm, [.22, .04, .4], [0, 0, -4.52], bladeTip).renderOrder = 41;
  }
  const rotorBlur = new Mesh(new CircleGeometry(4.85, 64), blurMaterial);
  rotorBlur.rotation.x = -Math.PI / 2; rotorBlur.position.copy(mainRotor.position); airframe.add(rotorBlur);
  rotorBlur.renderOrder = 40; rotorBlur.frustumCulled = false;
  // Two partial tip sweeps preserve a moving silhouette without a solid black disc.
  for (const angle of [0, Math.PI]) {
    const sweep = new Mesh(new RingGeometry(2.6, 4.83, 36, 1, angle, Math.PI * .54), sweepMaterial);
    sweep.rotation.x = -Math.PI / 2; sweep.position.y = .018; sweep.renderOrder = 42; mainRotor.add(sweep);
  }
  const tailRotor = new Group(); tailRotor.position.set(-.26, .65, 5.1); airframe.add(tailRotor);
  for (let i = 0; i < 2; i++) {
    const tailBlade = box(tailRotor, [.04, 1.55, .12], [0, 0, 0], blade); tailBlade.rotation.x = i * Math.PI / 2; tailBlade.renderOrder = 41;
  }
  const tailBlur = new Mesh(new CircleGeometry(.81, 32), blurMaterial.clone());
  tailBlur.rotation.y = Math.PI / 2; tailBlur.position.copy(tailRotor.position); airframe.add(tailBlur);
  tailBlur.renderOrder = 40; tailBlur.frustumCulled = false;
  materials.push(tailBlur.material as MeshBasicMaterial);
  const lamps: Mesh[] = [];
  for (const [x, color] of [[-1.07, '#ef5a3b'], [1.07, '#7acb8f']] as const) {
    const material = new MeshBasicMaterial({ color }); materials.push(material);
    const lamp = new Mesh(new SphereGeometry(.085, 8, 6), material);lamp.name=x<0?'helicopter-port-red':'helicopter-starboard-green'; lamp.position.set(x, .05, .9); airframe.add(lamp); lamps.push(lamp);
  }
  const beaconMaterial = new MeshBasicMaterial({ color: '#f28156' }); materials.push(beaconMaterial);
  const beacon = new Mesh(new SphereGeometry(.06, 8, 6), beaconMaterial); beacon.position.set(0, 1.38, 5.0); airframe.add(beacon); lamps.push(beacon);
  beacon.name='helicopter-red-beacon';
  for(const [name,position]of [['helicopter-aft-white',[0,.16,5.24]],['helicopter-white-strobe',[0,1.25,.55]]]as const){const material=new MeshBasicMaterial({color:'#fff5dc'});materials.push(material);const light=new Mesh(new SphereGeometry(.075,8,6),material);light.name=name;light.position.set(position[0],position[1],position[2]);airframe.add(light);lamps.push(light);}
  const landingLight=new SpotLight('#fff2d6',0,38,.48,.65,2);landingLight.name='helicopter-landing-light';landingLight.position.set(0,-.45,-1.7);landingLight.target.position.set(0,-8,-15);airframe.add(landingLight,landingLight.target);
  return {
    root, airframe, mainRotor, tailRotor, rotorBlur, tailBlur, lamps,
    updateCabin:(dt,occupied,controls)=>cabin.update(dt,occupied,controls),
    updateLights:(engine,time,landing)=>{lamps[0].visible=lamps[1].visible=lamps[3].visible=engine;lamps[2].visible=engine&&time%1.1<.16;const pulse=time%1.2;lamps[4].visible=engine&&(pulse<.065||pulse>.14&&pulse<.205);landingLight.intensity=engine&&landing?280:0;},
    updateRotorAppearance: (rpm) => {
      const ramp = Math.max(0, Math.min(1, (rpm - .3) / .55));
      const blur = ramp * ramp * (3 - 2 * ramp);
      mainRotor.visible = true; tailRotor.visible = true;
      blade.opacity = 1 - blur * .58;
      bladeTip.opacity = 1 - blur * .45;
      blurMaterial.opacity = blur * .24;
      (tailBlur.material as MeshBasicMaterial).opacity = blur * .3;
      sweepMaterial.opacity = blur * .16;
      mainRotor.traverse(object => { if (object instanceof Mesh) object.castShadow = object.material !== sweepMaterial && rpm < .7; });
      tailRotor.traverse(object => { if (object instanceof Mesh) object.castShadow = rpm < .7; });
    },
    dispose: () => {
      cabin.dispose();
      const geometries=new Set<BufferGeometry>();root.traverse(object=>{if(object instanceof Mesh)geometries.add(object.geometry);});geometries.forEach(g=>g.dispose());
      for (const material of new Set(materials)) material.dispose();
      root.removeFromParent();
    },
  };
}
