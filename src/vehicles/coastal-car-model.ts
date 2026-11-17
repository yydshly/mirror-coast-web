import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Shape, SpotLight,Vector3 } from 'three';
import {createCabin} from './cabin';
import {contactShadowMaterial} from './contact-shadow';
import type {CarSignal} from './driving-tuning';

export function createCoastalCarModel() {
  const root = new Group(); root.name = 'coastal-road-car';
  const shell = new Group(); root.add(shell);
  const body = new MeshPhysicalMaterial({ color: '#4b8581', roughness: .34, metalness: .18, clearcoat: .75, clearcoatRoughness: .2 });
  const roof = new MeshStandardMaterial({ color: '#e6d8b9', roughness: .5, metalness: .15 });
  const glass = new MeshPhysicalMaterial({ color: '#a1c3c5', roughness: .18, metalness: 0, clearcoat: .35, transparent:true,opacity:.22,depthWrite:false,side:DoubleSide,forceSinglePass:true });
  const black = new MeshStandardMaterial({ color: '#152126', roughness: .87 });
  const chrome = new MeshStandardMaterial({ color: '#afbbb5', roughness: .35, metalness: .85 });
  const lamp = new MeshStandardMaterial({ color: '#fff0cc', emissive: '#ffe9bb', emissiveIntensity: .8, roughness: .3 });
  const brake = new MeshStandardMaterial({ color: '#a2362d', emissive: '#b9402e', emissiveIntensity: .3, roughness: .4 });
  const leftSignal=new MeshStandardMaterial({color:'#dd8b25',emissive:'#ff9e26',emissiveIntensity:.03,roughness:.4}),rightSignal=leftSignal.clone();
  const reverseLamp=new MeshStandardMaterial({color:'#e5e6d6',emissive:'#fff7dc',emissiveIntensity:.03,roughness:.4});
  const materials = [body, roof, glass, black, chrome, lamp, brake,leftSignal,rightSignal,reverseLamp];
  const headlight=new SpotLight('#fff0cd',0,54,.48,.72,2);
  headlight.name='coastal-car-headlights';headlight.position.set(0,.12,-2.32);
  headlight.target.position.set(0,-.8,-27);shell.add(headlight,headlight.target);
  const boxGeometry = new BoxGeometry(1, 1, 1);
  const geometries: BufferGeometry[] = [boxGeometry];
  const shadowGeometry=new BufferGeometry();
  shadowGeometry.setAttribute('position',new BufferAttribute(new Float32Array([-1.1,-.838,-1.65,-1.1,-.838,1.65,1.1,-.838,-1.65,1.1,-.838,1.65]),3));
  shadowGeometry.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,0,1,1,0,1,1]),2));
  shadowGeometry.setIndex([0,1,2,2,1,3]);shadowGeometry.computeVertexNormals();geometries.push(shadowGeometry);
  const shadowMaterial=contactShadowMaterial();materials.push(shadowMaterial);
  const contactShadow=new Mesh(shadowGeometry,shadowMaterial);contactShadow.name='car-ground-contact';contactShadow.renderOrder=1;root.add(contactShadow);
  const box = (parent: Group, m: MeshStandardMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(boxGeometry, m); mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const panel = (points: number[], m: MeshStandardMaterial) => {
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals(); geometries.push(geometry);
    const mesh = new Mesh(geometry, m);mesh.name='car-cabin-glass';mesh.renderOrder=2;shell.add(mesh);
  };
  const beam=(a:Vector3,b:Vector3,width=.065)=>{const delta=b.clone().sub(a),mesh=box(shell,body,width,delta.length(),width,0,0,0);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.normalize());};
  // An angular estate-car profile: long bonnet, raked windscreen and short hatch.
  const profile = new Shape();
  profile.moveTo(-2.2, -.36); profile.lineTo(-2.2, .05); profile.lineTo(-1.65, .2);
  profile.lineTo(-1.33, .17); profile.lineTo(.55, .17); profile.lineTo(1.18, .22);
  profile.lineTo(2.12, .12); profile.lineTo(2.24, -.1); profile.lineTo(2.15, -.36);
  // Wheel arches cut into the shell instead of mounting tyres on its sides.
  const archAngle=Math.asin(.08/.44);
  for(const axle of [1.43,-1.43]){
    profile.lineTo(axle+Math.sqrt(.44**2-.08**2),-.36);
    profile.absarc(axle,-.28,.44,-archAngle,Math.PI+archAngle,false);
  }
  profile.lineTo(-2.2,-.36);profile.closePath();
  const shellGeometry = new ExtrudeGeometry(profile, { depth: .09, bevelEnabled: true, bevelThickness: .018, bevelSize: .018, bevelSegments: 1, steps: 1 });
  shellGeometry.translate(0,0,-.045);shellGeometry.rotateY(Math.PI/2);geometries.push(shellGeometry);
  for(const side of [-1,1]){const skin=new Mesh(shellGeometry,body);skin.position.x=side*.85;skin.name='car-hollow-side-body';skin.castShadow=skin.receiveShadow=true;shell.add(skin);}
  box(shell,body,1.70,.46,.92,0,-.075,-1.73).name='car-bonnet';
  box(shell,body,1.70,.40,.53,0,-.10,1.91).name='car-rear-body';
  box(shell, roof, 1.7, .085, 1.94, 0, .81, .39);
  // Thin pillars surround real openings. Glass no longer hides a solid cabin.
  panel([-.83,.22,-1.22,.83,.22,-1.22,.79,.75,-.55,-.79,.75,-.55],glass);
  panel([-.83,.19,1.64,.83,.19,1.64,.79,.74,1.32,-.79,.74,1.32],glass);
  box(shell,body,1.7,.065,.065,0,.76,-.55);box(shell,body,1.7,.065,.065,0,.75,1.32);
  for (const side of [-1, 1]) {
    const x = side * .915,upper=side*.83;
    panel([x,.21,-1.10,upper,.75,-.53,upper,.75,.23,x,.21,.23],glass);
    panel([x,.21,.31,upper,.75,.31,upper,.73,1.27,x,.21,1.55],glass);
    beam(new Vector3(side*.89,.20,-1.22),new Vector3(side*.82,.77,-.55));
    beam(new Vector3(side*.89,.19,1.64),new Vector3(side*.82,.76,1.32));
    beam(new Vector3(side*.90,.18,.27),new Vector3(side*.83,.77,.27),.075);
    box(shell, chrome, .045, .045, 2.54, x, .15, .28);
    box(shell, chrome, .045, .04, .25, side * .925, .02, -.06);
    for(const z of [-1.08,.27,1.55])box(shell,black,.012,.45,.018,side*.916,-.06,z);
    box(shell, body, .20, .14, .24, side * 1.035, .26, -.81);
    box(shell, black, .11, .11, .17, side * 1.04, .27, -.83);
    box(shell, chrome, .035, .04, 1.45, side * .57, .9, .35);
    for (const z of [-1.0, 1.05]) box(shell, black, .08, .11, .14, side * .57, .84, z);
  }
  const cabin=createCabin('car');shell.add(cabin.root);
  box(shell, black, 1.67, .16, .09, 0, -.23, -2.25);
  box(shell, chrome, 1.72, .055, .06, 0, -.16, -2.30);
  box(shell, black, .56, .15, .035, 0, -.07, -2.302);
  for (const side of [-1, 1]) {
    box(shell, lamp, .40, .20, .055, side * .60, .04, -2.242);
    box(shell, brake, .18, .30, .045, side * .73, .01, 2.244);
    const signal=side<0?leftSignal:rightSignal;
    box(shell,signal,.15,.09,.065,side*.86,.085,-2.244).name=side<0?'car-left-front-indicator':'car-right-front-indicator';
    box(shell,signal,.18,.09,.055,side*.73,.115,2.27).name=side<0?'car-left-rear-indicator':'car-right-rear-indicator';
    box(shell,signal,.025,.045,.095,side*1.093,.27,-.86);
    box(shell,reverseLamp,.18,.07,.055,side*.73,-.055,2.27).name='car-reverse-light';
    box(shell, chrome, .34, .035, .06, side * .6, -.11, -2.29);
  }
  box(shell, black, 1.72, .17, .09, 0, -.23, 2.25);
  box(shell, roof, .48, .12, .04, 0, -.05, 2.305);
  const tireGeometry = new CylinderGeometry(.39, .39, .23, 16); tireGeometry.rotateZ(Math.PI / 2); geometries.push(tireGeometry);
  const hubGeometry = new CylinderGeometry(.21, .21, .242, 12); hubGeometry.rotateZ(Math.PI / 2); geometries.push(hubGeometry);
  const wheels: Array<{ steering: Group; rolling: Group; front: boolean }> = [];
  for (const x of [-.95, .95]) for (const z of [-1.43, 1.43]) {
    // Suspension belongs to the running gear, not the pitched body shell.
    const steering = new Group(); steering.position.set(x, -.46, z); root.add(steering);
    const rolling = new Group(); steering.add(rolling);
    const tire = new Mesh(tireGeometry, black), hub = new Mesh(hubGeometry, chrome); rolling.add(tire, hub);
    tire.castShadow = hub.castShadow = true;
    wheels.push({ steering, rolling, front: z < 0 });
    box(shell, black, .12, .10, .88, x * .92, -.14, z);
  }
  return {
    root, shell,
    updateCabin:(dt:number,occupied:boolean,throttle:number,braking:boolean,speed=0)=>cabin.update(dt,occupied,{steer:wheels.find(w=>w.front)!.steering.rotation.y,throttle,brake:braking,speed}),
    setGrounded:(grounded:boolean)=>{contactShadow.visible=grounded;},
    setWheelHeights: (heights: readonly number[]) => {
      const positions=shadowGeometry.getAttribute('position');
      wheels.forEach((wheel,i)=>{wheel.steering.position.y=heights[i];positions.setY(i,heights[i]-.39+.012);});
      positions.needsUpdate=true;shadowGeometry.computeBoundingSphere();
    },
    setNight: (night:number,driving:boolean)=>{
      const strength=Math.max(0,Math.min(1,night*1.7));
      headlight.intensity=driving?strength*900:0;
      lamp.emissiveIntensity=.6+strength*(driving?3.4:.15);
    },
    update: (dt: number, speed: number, steer: number, braking: boolean,lights?:{signal:CarSignal;lit:boolean;reversing:boolean}) => {
      for (const wheel of wheels) { wheel.rolling.rotation.x += speed * dt / .39; if (wheel.front) wheel.steering.rotation.y = steer*.62/(1+speed*speed/100); }
      brake.emissiveIntensity = braking ? 2.6 : .35;
      leftSignal.emissiveIntensity=lights?.lit&&(lights.signal==='left'||lights.signal==='hazard')?3.5:.03;
      rightSignal.emissiveIntensity=lights?.lit&&(lights.signal==='right'||lights.signal==='hazard')?3.5:.03;
      reverseLamp.emissiveIntensity=lights?.reversing?2.2:.03;
    },
    dispose: () => { cabin.dispose();root.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); },
  };
}
