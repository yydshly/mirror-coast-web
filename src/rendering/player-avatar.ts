import { BufferGeometry, Group, Mesh, MeshStandardMaterial,PlaneGeometry,Vector3,Quaternion,Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {humanBox,humanSleeve,knittedCap} from './human-geometry';
import {surfaceFinish} from './surface-finish';
import {contactShadowMaterial} from '../vehicles/contact-shadow';
import {seatHip,vaultPose,type GroundMotion} from '../input/ground-actions';
import {runningLeg,bootSoleHeight,RUN_CYCLE_METRES} from './running-pose';
import {BICYCLE_RIG,bicyclePedal,bicycleGrip,type BicycleSide} from '../vehicles/bicycle-rig';

type Limb = { upper: Group; lower: Group; end: Group };

/** A 1.77 m coastal walker. Each joint owns merged, matte voxel shapes. */
export class PlayerAvatar {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly upperBody = new Group();
  private readonly head = new Group();
  private readonly arms: Limb[] = [];
  private readonly legs: Limb[] = [];
  private readonly unit = humanBox(.10);
  private readonly torso=humanBox(.16,.88,1);
  private readonly skull=humanBox(.18,.82,1);
  private readonly sleeve=humanSleeve();
  private readonly cap=knittedCap();
  private readonly contactPlane=new PlaneGeometry(1,1).rotateX(-Math.PI/2);
  private readonly contactMaterial=contactShadowMaterial();
  private readonly footShadows:Mesh[]=[];
  private readonly geometries: BufferGeometry[] = [this.unit,this.torso,this.skull,this.sleeve,this.cap,this.contactPlane];
  private readonly materials: MeshStandardMaterial[] = [];
  private stride = 0;
  private swing = 0;
  private running=0;
  private elapsed = 0;
  private previousYaw = 0;
  private turn = 0;

  constructor() {
    this.root.name = 'walking-player';
    for(let i=0;i<2;i++){const shadow=new Mesh(this.contactPlane,this.contactMaterial);shadow.name='explorer-foot-contact';shadow.renderOrder=1;this.root.add(shadow);this.footShadows.push(shadow);}
    this.body.name = 'explorer-body'; this.upperBody.name = 'explorer-upper-body';
    this.root.add(this.body); this.body.add(this.upperBody);
    const material = (color: string, roughness = .9, glow = .006) => {
      const result = new MeshStandardMaterial({ color, roughness, emissive: color, emissiveIntensity: glow });
      this.materials.push(result); return result;
    };
    const jacket = surfaceFinish(material('#386b72'),'fabric'), shoulder = surfaceFinish(material('#879b8e'),'fabric');
    const seam = surfaceFinish(material('#29484d'),'fabric'), trousers = surfaceFinish(material('#4d5758'),'fabric');
    const boot = material('#293b40'), sole = material('#172c32');
    const sand = material('#c6b896', .88, .008), rust = surfaceFinish(material('#ae7850', .92, .008),'fabric');
    const skin = material('#be9473'), skinLight = material('#cda483');
    const hair = material('#423a32'), face = material('#293c3e');
    const add = (parent: Group, m: MeshStandardMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number,geometry:BufferGeometry=this.unit) => {
      const box = new Mesh(geometry, m); box.scale.set(sx, sy, sz); box.position.set(x, y, z);
      parent.add(box); return box;
    };
    // Broad shoulders taper into a short field jacket, instead of a long box torso.
    add(this.upperBody, jacket, .415, .36, .265, 0, 1.225, 0,this.torso);
    add(this.upperBody, jacket, .355, .18, .25, 0, 1.005, .005);
    // The shoulder yoke must sit above the torso top (1.405), not share its
    // entire top plane. Coplanar merged surfaces shimmer when viewed from above.
    add(this.upperBody, shoulder, .41, .09, .25, 0, 1.37, .002);
    add(this.upperBody, seam, .35, .035, .255, 0, .929, .005);
    add(this.upperBody, seam, .016, .395, .015, 0, 1.185, -.129);
    add(this.upperBody, rust, .023, .035, .019, .018, 1.353, -.135);
    for (const side of [-1, 1]) {
      add(this.upperBody, jacket, .105, .10, .027, side * .105, 1.023, -.136);
      add(this.upperBody, seam, .105, .012, .03, side * .105, 1.075, -.139);
      add(this.upperBody, seam, .032, .28, .021, side * .134, 1.25, -.137);
      add(this.upperBody, sand, .035, .023, .024, side * .134, 1.155, -.15);
      add(this.upperBody, seam, .034, .022, .26, side * .134, 1.413, .004);
    }
    add(this.upperBody, sand, .047, .045, .016, -.07, 1.302, -.142);
    // A folded hood hides the neck gap and gives the rear silhouette a collar.
    add(this.upperBody, jacket, .235, .085, .10, 0, 1.448, .102);
    for (const side of [-1, 1]) add(this.upperBody, shoulder, .055, .10, .12, side * .112, 1.45, .045);
    add(this.upperBody, seam, .14, .055, .12, 0, 1.435, -.027);
    add(this.upperBody, skin, .105, .075, .105, 0, 1.469, -.006);
    // The small orange pack has a flap, front pocket, straps and a side flask.
    const pack = new Group(); pack.name = 'explorer-daypack'; this.upperBody.add(pack);
    add(pack, rust, .275, .285, .135, 0, 1.215, .193);
    add(pack, sand, .283, .055, .15, 0, 1.365, .195);
    add(pack, seam, .22, .115, .033, 0, 1.17, .275);
    add(pack, sand, .045, .08, .018, 0, 1.292, .277);
    for (const side of [-1, 1]) add(pack, seam, .022, .22, .019, side * .087, 1.235, .271);
    add(pack, sand, .055, .14, .065, .164, 1.175, .177);
    add(pack, seam, .047, .025, .057, .164, 1.258, .177);
    // A smaller head, visible ears and a short cap brim read as an adult at scale.
    this.head.name = 'explorer-head'; this.head.position.set(0, 1.602, -.006); this.upperBody.add(this.head);
    add(this.head, skin, .245, .25, .235, 0, 0, 0,this.skull);
    add(this.head, hair, .246, .078, .236, 0, .085, .003);
    for (const side of [-1, 1]) {
      add(this.head, skin, .026, .052, .043, side * .131, -.01, .008);
      add(this.head, face, .016, .013, .009, side * .053, .025, -.122);
      add(this.head, hair, .030, .007, .010, side * .053, .049, -.122);
    }
    add(this.head, skinLight, .032, .039, .030, 0, -.008, -.126);
    add(this.head, hair, .033, .006, .009, 0, -.063, -.119);
    add(this.head,seam,.264,.11,.25,0,.109,.003,this.cap);
    add(this.head,seam,.258,.045,.245,0,.071,.003);
    add(this.head,sand,.031,.025,.009,-.071,.075,-.121);
    // Elbows and knees are real joints, so the limbs no longer swing as poles.
    for (const [index, side] of [-1, 1].entries()) {
      const upper = new Group(), lower = new Group(), end = new Group();
      upper.name = `explorer-${index ? 'right' : 'left'}-arm`;
      lower.name = `explorer-${index ? 'right' : 'left'}-elbow`;
      upper.position.set(side * .215, 1.386, 0); lower.position.y = -.24; end.position.y = -.25;
      this.upperBody.add(upper); upper.add(lower); lower.add(end);
      const palm=new Object3D();palm.name=`explorer-${index?'right':'left'}-hand-contact`;palm.position.set(0,-.054,-.009);end.add(palm);
      add(upper, jacket, .138, .24, .18, 0, -.12, 0,this.sleeve);
      add(upper, shoulder, .13, .055, .185, 0, -.035, 0);
      add(lower, jacket, .12, .25, .158, 0, -.125, -.003,this.sleeve);
      add(lower, seam, .117, .04, .163, 0, -.226, -.003);
      add(end, skin, .098, .115, .118, 0, -.054, -.009);
      this.arms.push({ upper, lower, end });
    }
    add(this.body, trousers, .335, .16, .245, 0, .879, .004);
    for (const [index, side] of [-1, 1].entries()) {
      const upper = new Group(), lower = new Group(), end = new Group();
      upper.name = `explorer-${index ? 'right' : 'left'}-leg`;
      lower.name = `explorer-${index ? 'right' : 'left'}-knee`;
      end.name = `explorer-${index ? 'right' : 'left'}-boot`;
      const soleContact=new Object3D();soleContact.name=`explorer-${index?'right':'left'}-sole-contact`;soleContact.position.copy(BICYCLE_RIG.soleContact);end.add(soleContact);
      upper.position.set(side * .095, .88, 0); lower.position.y = -.37; end.position.y = -.36;
      this.body.add(upper); upper.add(lower); lower.add(end);
      add(upper, trousers, .165, .37, .205, 0, -.185, 0,this.sleeve);
      add(upper,trousers,.115,.07,.015,0,-.33,-.106);
      add(lower, trousers, .145, .36, .18, 0, -.18, .003,this.sleeve);
      add(lower,trousers,.145,.05,.185,0,-.328,.003);
      add(end, boot, .167, .13, .285, 0, -.067, -.043);
      add(end, sole, .18, .025, .30, 0, -.1375, -.045);
      add(end, boot, .157, .13, .125, 0, -.03, .027);
      for(const lace of [-.11,-.143])add(end,sand,.065,.005,.008,0,.0005,lace);
      this.legs.push({ upper, lower, end });
    }
    // Static details are batched per material/joint; detail does not mean 100 draw calls.
    this.mergeJoint(this.body);
    this.animate(0, 0, 0, true);
  }

  animate(dt: number, yaw: number, speed: number, grounded: boolean,motion?:GroundMotion): void {
    const delta = Math.max(0, Math.min(.1, dt));
    this.elapsed += delta;
    const runTarget=grounded?Math.max(0,Math.min(1,(speed-3.3)/1.6)):0;
    this.running+=(runTarget-this.running)*(1-Math.exp(-delta*12));
    const cadence=(1-this.running)*4.5/(1+Math.max(0,speed)*.2)+this.running*2*Math.PI/RUN_CYCLE_METRES;
    this.stride+=delta*Math.max(0,speed)*cadence;
    const target = grounded ? Math.min(1, speed / 3.15) : .2;
    this.swing += (target - this.swing) * (1 - Math.exp(-delta * 14));
    const yawDelta = Math.atan2(Math.sin(yaw - this.previousYaw), Math.cos(yaw - this.previousYaw));
    // The physical heading stays authoritative. Only the jacket and head follow
    // a little later, and large spawn/teleport changes do not wind up a turn.
    const turning = delta > 0 && Math.abs(yawDelta) < .8 ? Math.max(-3, Math.min(3, yawDelta / delta)) : 0;
    this.turn += (turning - this.turn) * (1 - Math.exp(-delta * 9));
    this.previousYaw = yaw;
    const run=grounded?this.running*this.swing:0,runHip=.8-.025*Math.cos(this.stride*2),mix=(a:number,b:number)=>a+(b-a)*run;
    let lowestSole = Infinity;
    for (let i = 0; i < 2; i++) {
      const phase = Math.sin(this.stride + i * Math.PI);
      const hip = phase * (.38+Math.min(5.2,speed)*.035) * this.swing;
      const knee = -.035 - Math.max(0, -phase) * (.46+Math.min(5.2,speed)*.055) * this.swing;
      const leg = this.legs[i], arm = this.arms[i];
      leg.upper.rotation.order='XYZ';leg.upper.rotation.y=leg.upper.rotation.z=0;
      leg.end.rotation.y=leg.end.rotation.z=0;arm.upper.rotation.order='XYZ';
      const running=runningLeg(this.stride/(2*Math.PI)+i*.5,runHip);
      leg.upper.rotation.x = grounded ? mix(hip,running.hip) : (i ? -.12 : .18);
      leg.lower.rotation.x = grounded ? mix(knee,running.knee) : -.35;
      if(motion){
        if(motion.sit>.001){const theta=Math.acos(Math.max(-1,Math.min(1,(motion.seatHeight+.075-.51)/.37)))*motion.sit;leg.upper.rotation.x=theta;leg.lower.rotation.x=-theta;}
        else if(motion.vault!==undefined){const pose=vaultPose(motion.vault);leg.upper.rotation.x=pose.upper;leg.lower.rotation.x=pose.lower;}
        else if(!grounded){const falling=Math.max(0,Math.min(1,-motion.verticalSpeed/6));leg.upper.rotation.x=i?-.12+.17*falling:.32-.23*falling;leg.lower.rotation.x=-.62+.47*falling;}
        else if(motion.landing>0){leg.upper.rotation.x+=.58*motion.landing;leg.lower.rotation.x-=1.16*motion.landing;}
      }
      const footPitch=motion?.sit||motion?.vault!==undefined?0:running.pitch*run;
      leg.end.rotation.x = footPitch-leg.upper.rotation.x-leg.lower.rotation.x;
      lowestSole=Math.min(lowestSole,bootSoleHeight(leg.upper.rotation.x,leg.lower.rotation.x,footPitch));
      arm.upper.rotation.x = grounded ? -hip * .73 : -.17;
      arm.upper.rotation.z = (i ? -1 : 1) * (grounded ? .024 : .13);
      arm.lower.rotation.x = grounded ? .10 + Math.max(0, phase) * .15 * this.swing : -.27;
    }
    // Walking stays planted. Running can lift both feet during recovery, while
    // neither boot may sink below the physical feet plane.
    this.body.position.y = grounded ? -lowestSole : 0;
    if(run>0)this.body.position.y=Math.max(-lowestSole,this.body.position.y+(runHip-.88-this.body.position.y)*run);
    if(motion?.sit)this.body.position.y=seatHip(motion.seatHeight,motion.sit)-.88;
    if(motion?.vault!==undefined)this.body.position.y=vaultPose(motion.vault).offset;
    for(let i=0;i<2;i++){
      const leg=this.legs[i],hip=leg.upper.rotation.x,knee=leg.lower.rotation.x;
      const lift=this.body.position.y+bootSoleHeight(hip,knee,hip+knee+leg.end.rotation.x);
      const strength=grounded?Math.max(0,1-lift/.15):0;
      this.footShadows[i].position.set(i?.095:-.095,.012,-.37*Math.sin(hip)-.36*Math.sin(hip+knee)-.045);
      this.footShadows[i].scale.set(.29*strength,1,.36*strength);
    }
    this.body.position.x = grounded ? Math.sin(this.stride * 2) * .005 * this.swing+Math.sin(this.stride)*.008*run : 0;
    this.upperBody.position.y = Math.sin(this.elapsed * 1.65) * .0025;
    this.upperBody.rotation.x = grounded ? -.024*this.swing-.12*run : .025;
    this.upperBody.rotation.y = -.025*this.turn+Math.sin(this.stride)*.04*run;
    this.upperBody.rotation.z = grounded ? Math.sin(this.stride)*(.009*this.swing+.014*run)-this.turn*.005*this.swing : 0;
    this.head.rotation.y = Math.sin(this.elapsed * .42) * .012 + this.turn * .038;
    this.head.rotation.x = Math.sin(this.elapsed * 1.65)*.003+.08*run;
    // Lean around the waist, rather than swinging the whole jacket about the
    // ground. Keep the hands inside the normal body contact envelope.
    this.placeUpperBody();
    if(run>0&&!(motion?.sit||motion?.vault!==undefined))for(let i=0;i<2;i++){
      const arm=this.arms[i],oldUpper=arm.upper.rotation.x,oldLower=arm.lower.rotation.x,pump=Math.cos(this.stride+i*Math.PI);
      this.reach(arm,.06-.17*pump,1.1-.07*pump);
      arm.upper.rotation.x=oldUpper+(arm.upper.rotation.x-oldUpper)*run;arm.lower.rotation.x=oldLower+(arm.lower.rotation.x-oldLower)*run;
      arm.upper.rotation.z=(i?-1:1)*(.024+.035*run);
    }
    if(motion){
      if(motion.sit>.001){
        this.upperBody.rotation.x=-.035*motion.sit;this.upperBody.rotation.y=0;this.placeUpperBody();
        const hip=seatHip(motion.seatHeight,motion.sit),reach=.37*Math.sin(Math.acos(Math.max(-1,Math.min(1,(motion.seatHeight+.075-.51)/.37)))*motion.sit);
        for(const arm of this.arms){const oldUpper=arm.upper.rotation.x,oldLower=arm.lower.rotation.x;this.reach(arm,reach*.6,hip+.035);arm.upper.rotation.x=oldUpper+(arm.upper.rotation.x-oldUpper)*motion.sit;arm.lower.rotation.x=oldLower+(arm.lower.rotation.x-oldLower)*motion.sit;}
        this.head.rotation.y=Math.max(-.65,Math.min(.65,motion.gazeYaw??0));this.head.rotation.x=Math.max(-.35,Math.min(.35,motion.gazePitch??0));
      }
      if(motion.vault!==undefined){
        const plant=1-Math.max(0,Math.min(1,(motion.vault-.18)/.12)),{tuck}=vaultPose(motion.vault);
        this.upperBody.rotation.x=-.10*plant-.23*tuck;
        this.placeUpperBody();
        for(const arm of this.arms){arm.upper.rotation.x=.9*tuck;arm.lower.rotation.x=.4*tuck;if(plant>0){const x=arm.upper.rotation.x,y=arm.lower.rotation.x;this.reach(arm,motion.handForward??.5,(motion.handHeight??1.1)+.04);arm.upper.rotation.x=x+(arm.upper.rotation.x-x)*plant;arm.lower.rotation.x=y+(arm.lower.rotation.x-y)*plant;}}
      }else if(!motion.sit&&grounded){this.upperBody.rotation.x-=.10*motion.landing;this.placeUpperBody();}
    }
    this.root.rotation.y = yaw;
  }

  private placeUpperBody():void{this.upperBody.position.z=-1.03*Math.sin(this.upperBody.rotation.x);this.upperBody.position.y=Math.sin(this.elapsed*1.65)*.0025+1.03*(1-Math.cos(this.upperBody.rotation.x));}

  /** Solve the rendered boot contact onto the very same pedal used by the model. */
  cyclePose(dt:number,phase:number,speed:number,footDown=Math.max(0,1-Math.abs(speed)/.7),steer=0,bank=0,backingPhase=0):void{
    this.animate(dt,0,0,true);
    const down=Math.max(0,Math.min(1,footDown)),smooth=down*down*(3-2*down);
    // Seated pelvis bottom rests on the saddle. At rest, move ahead of the
    // low step-through frame and plant the outside boot, not inside a pedal.
    this.body.position.set(0,.14*(1-smooth)-.06*smooth,.03-.24*smooth);
    this.upperBody.rotation.set(-.43-Math.abs(steer)*.25,steer*.35,0);this.placeUpperBody();this.head.rotation.x=.16;
    for(let i=0;i<2;i++){
      const side=(i?1:-1) as BicycleSide,leg=this.legs[i],pedal=bicyclePedal(side,phase);
      const target=new Vector3(pedal.x,pedal.y+BICYCLE_RIG.pedalTop,pedal.z);
      const plant=i===0?smooth:0;
      if(plant){const x=-.34,ground=new Vector3(x,-x*Math.tan(bank),this.body.position.z-.10);
        if(speed<-.05){const u=((backingPhase/(Math.PI*2))%1+1)%1;if(u<.6)ground.z+=.12-.4*u;else{const t=(u-.6)/.4;ground.z+=-.12+.24*t*t*(3-2*t);ground.y+=.09*Math.sin(t*Math.PI);}}
        target.lerp(ground,plant);target.y+=Math.sin(plant*Math.PI)*.075;}
      const footRotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-bank*plant);
      const soleOffset=new Vector3().copy(BICYCLE_RIG.soleContact).applyQuaternion(footRotation);
      const ankle=target.sub(soleOffset).sub(this.body.position).sub(leg.upper.position);
      const roll=Math.atan2(ankle.x,-ankle.y),dy=-Math.hypot(ankle.x,ankle.y),dz=ankle.z,l1=.37,l2=.36,d=Math.min(.7299,Math.hypot(dy,dz));
      const knee=-Math.acos(Math.max(-1,Math.min(1,(d*d-l1*l1-l2*l2)/(2*l1*l2))));
      leg.upper.rotation.order='ZXY';leg.upper.rotation.set(Math.atan2(-dz,-dy)-Math.atan2(l2*Math.sin(knee),l1+l2*Math.cos(knee)),0,roll);
      leg.lower.rotation.set(knee,0,0);
      leg.end.quaternion.copy(leg.upper.quaternion).multiply(leg.lower.quaternion).invert().multiply(footRotation);
      this.cycleGrip(this.arms[i],bicycleGrip(side,steer));this.footShadows[i].visible=false;
    }
  }

  private cycleGrip(arm:Limb,grip:{x:number;y:number;z:number}):void{
    const target=new Vector3(grip.x,grip.y,grip.z).sub(this.body.position).sub(this.upperBody.position).applyQuaternion(new Quaternion().copy(this.upperBody.quaternion).invert()).sub(arm.upper.position);
    const dx=target.x,dy=target.y,dz=target.z;
    let roll=Math.atan2(dx,-dy);if(roll>Math.PI/2)roll-=Math.PI;else if(roll< -Math.PI/2)roll+=Math.PI;
    const down=-Math.sin(roll)*dx+Math.cos(roll)*dy,l1=.24,l2=Math.hypot(.304,.009),d=Math.min(l1+l2-.0001,Math.hypot(down,dz));
    const elbow=Math.acos(Math.max(-1,Math.min(1,(d*d-l1*l1-l2*l2)/(2*l1*l2))));
    arm.upper.rotation.order='ZXY';arm.upper.rotation.set(Math.atan2(-dz,-down)-Math.atan2(l2*Math.sin(elbow),l1+l2*Math.cos(elbow)),0,roll);
    arm.lower.rotation.set(elbow-Math.atan2(.009,.304),0,0);
  }

  /** Cabin contacts use the actual wheel/lever/pedal transforms, in avatar
   * space. The same adult rig sits in both vehicles, without its daypack. */
  vehiclePose(dt:number,hip:Vector3,hands:readonly Vector3[],feet:readonly Vector3[],lean=-.055):void{
    this.animate(dt,0,0,true);
    this.root.getObjectByName('explorer-daypack')!.visible=false;
    this.body.position.copy(hip);this.body.position.y-=.88;
    this.upperBody.rotation.set(lean,0,0);this.placeUpperBody();
    this.head.rotation.set(.015,0,0);
    for(let i=0;i<2;i++){
      const leg=this.legs[i],ankle=feet[i].clone().sub(new Vector3().copy(BICYCLE_RIG.soleContact)).sub(this.body.position).sub(leg.upper.position);
      const roll=Math.atan2(ankle.x,-ankle.y),dy=-Math.hypot(ankle.x,ankle.y),dz=ankle.z,l1=.37,l2=.36,d=Math.min(.7299,Math.hypot(dy,dz));
      const knee=-Math.acos(Math.max(-1,Math.min(1,(d*d-l1*l1-l2*l2)/(2*l1*l2))));
      leg.upper.rotation.order='ZXY';leg.upper.rotation.set(Math.atan2(-dz,-dy)-Math.atan2(l2*Math.sin(knee),l1+l2*Math.cos(knee)),0,roll);
      leg.lower.rotation.set(knee,0,0);leg.end.quaternion.copy(leg.upper.quaternion).multiply(leg.lower.quaternion).invert();
      this.cycleGrip(this.arms[i],hands[i]);this.footShadows[i].visible=false;
    }
  }

  /** Two-link reach in the arm's sagittal plane, for lap/rail hand contacts. */
  private reach(arm:Limb,forward:number,height:number):void{
    const r=this.upperBody.rotation.x,c=Math.cos(r),s=Math.sin(r),y=height-this.body.position.y-this.upperBody.position.y,z=-forward-this.upperBody.position.z;
    const dy=c*y+s*z-arm.upper.position.y,dz=-s*y+c*z,l1=.24,l2=.30,d=Math.max(.05,Math.min(.539,Math.hypot(dy,dz)));
    const elbow=Math.acos(Math.max(-1,Math.min(1,(d*d-l1*l1-l2*l2)/(2*l1*l2))));
    arm.upper.rotation.x=Math.atan2(-dz,-dy)-Math.atan2(l2*Math.sin(elbow),l1+l2*Math.cos(elbow));arm.lower.rotation.x=elbow;arm.upper.rotation.z=0;
  }

  setOpacity(opacity: number): void {
    const value = Math.max(0, Math.min(1, opacity)), transparent = value < .995;
    this.root.visible = value > .015;
    this.contactMaterial.opacity=.27*value;
    for (const material of this.materials) {
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = value; material.depthWrite = value > .97;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.contactMaterial.dispose();
  }

  private mergeJoint(group: Group): void {
    for (const child of group.children) if (child instanceof Group) this.mergeJoint(child);
    const batches = new Map<MeshStandardMaterial, Mesh[]>();
    for (const child of group.children) if (child instanceof Mesh) {
      const material = child.material as MeshStandardMaterial;
      const batch = batches.get(material) ?? []; batch.push(child); batches.set(material, batch);
    }
    for (const [material, meshes] of batches) {
      const parts = meshes.map(mesh => { mesh.updateMatrix(); const source=mesh.geometry;return (source.index?source.toNonIndexed():source.clone()).applyMatrix4(mesh.matrix); });
      const geometry = mergeGeometries(parts, false)!; parts.forEach(part => part.dispose());
      this.geometries.push(geometry);
      const merged = new Mesh(geometry, material); merged.castShadow = merged.receiveShadow = true;
      for (const mesh of meshes) group.remove(mesh);
      group.add(merged);
    }
  }
}
