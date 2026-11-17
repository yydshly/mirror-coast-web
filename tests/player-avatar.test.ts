import { afterEach,describe,expect,it } from 'vitest';
import { Box3,Mesh,MeshStandardMaterial,Vector3 } from 'three';
import { PlayerAvatar } from '../src/rendering/player-avatar';

const avatars:PlayerAvatar[]=[];
afterEach(()=>avatars.splice(0).forEach(avatar=>avatar.dispose()));
function create(){const avatar=new PlayerAvatar();avatars.push(avatar);return avatar;}

describe('adult-scale coastal explorer',()=>{
  it('runs with bent elbows, recovering heels, a quiet lean and a planted stance instead of skating',()=>{
    const avatar=create();avatar.root.position.set(10,16,20);
    for(let frame=0;frame<180;frame++)avatar.animate(1/60,0,5.2,true);
    const previous=new Map<string,Vector3>(),contact=new Map<string,boolean>();let planted=0,flights=0,kneeMin=0,elbowMin=Infinity;
    for(let frame=0;frame<150;frame++){
      avatar.root.position.z-=5.2/60;avatar.animate(1/60,0,5.2,true);avatar.root.updateMatrixWorld(true);
      let airborne=true;
      for(const side of ['left','right']){
        const boot=avatar.root.getObjectByName(`explorer-${side}-boot`)!,bounds=new Box3().setFromObject(boot),ankle=boot.getWorldPosition(new Vector3()),onFloor=Math.abs(bounds.min.y-16)<.0002;
        expect(bounds.min.y).toBeGreaterThanOrEqual(15.9999);if(onFloor)airborne=false;
        if(onFloor&&contact.get(side)){expect(Math.abs(ankle.z-previous.get(side)!.z)).toBeLessThan(.008);planted++;}
        previous.set(side,ankle);contact.set(side,onFloor);
        kneeMin=Math.min(kneeMin,avatar.root.getObjectByName(`explorer-${side}-knee`)!.rotation.x);
        elbowMin=Math.min(elbowMin,avatar.root.getObjectByName(`explorer-${side}-elbow`)!.rotation.x);
      }
      if(airborne)flights++;
      const lean=avatar.root.getObjectByName('explorer-upper-body')!.rotation.x;expect(lean).toBeLessThan(-.10);expect(lean).toBeGreaterThan(-.18);
    }
    expect(planted).toBeGreaterThan(35);expect(flights).toBeGreaterThan(15);expect(kneeMin).toBeLessThan(-1.6);expect(elbowMin).toBeGreaterThan(.8);
    for(let frame=0;frame<120;frame++)avatar.animate(1/60,0,0,true);
    avatar.root.updateMatrixWorld(true);for(const side of ['left','right'])expect(new Box3().setFromObject(avatar.root.getObjectByName(`explorer-${side}-boot`)!).min.y).toBeCloseTo(16,4);
  });
  it('places a seated pelvis on a 53cm bench while both soles stay on the ground',()=>{
    const avatar=create();avatar.root.position.set(10,16,20);
    avatar.animate(1/60,Math.PI,0,true,{sit:1,seatHeight:.53,landing:0,verticalSpeed:0,gazeYaw:.5,gazePitch:.2});avatar.root.updateMatrixWorld(true);
    for(const side of ['left','right']){const boot=new Box3().setFromObject(avatar.root.getObjectByName(`explorer-${side}-boot`)!);expect(boot.min.y).toBeCloseTo(16,4);}
    expect(avatar.root.getObjectByName('explorer-body')!.position.y+.799).toBeCloseTo(.524,3);
    expect(avatar.root.getObjectByName('explorer-head')!.rotation.y).toBeCloseTo(.5,4);
    expect(avatar.root.rotation.y).toBe(Math.PI);
  });
  it('fits the physical adult height with a smaller head, broad jacket and soles at the feet plane',()=>{
    const avatar=create();avatar.root.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(avatar.root),size=bounds.getSize(new Vector3());
    const head=new Box3().setFromObject(avatar.root.getObjectByName('explorer-head')!).getSize(new Vector3());
    expect(size.y).toBeGreaterThan(1.72);expect(size.y).toBeLessThan(1.8);
    expect(size.x).toBeGreaterThan(.5);expect(size.x).toBeLessThan(.64);
    expect(head.x).toBeLessThan(.30);expect(head.y).toBeLessThan(.30);
    expect(bounds.min.y).toBeCloseTo(0,5);
    expect(avatar.root.getObjectByName('explorer-daypack')).toBeDefined();
  });

  it('articulates knees and elbows while one flat boot stays planted and root follows only the physical actor',()=>{
    const avatar=create();avatar.root.position.set(10,16,20);
    const start=avatar.root.position.clone();
    let kneeMin=Infinity,kneeMax=-Infinity;
    for(let frame=0;frame<180;frame++){
      avatar.animate(1/60,.7,3.15,true);avatar.root.updateMatrixWorld(true);
      const feet=['left','right'].map(side=>new Box3().setFromObject(avatar.root.getObjectByName(`explorer-${side}-boot`)!));
      expect(Math.min(...feet.map(foot=>foot.min.y))).toBeCloseTo(16,4);
      expect(feet.every(foot=>foot.min.y>=15.9999)).toBe(true);
      const knee=avatar.root.getObjectByName('explorer-left-knee')!.rotation.x;
      kneeMin=Math.min(kneeMin,knee);kneeMax=Math.max(kneeMax,knee);
      expect(avatar.root.position).toEqual(start);
    }
    expect(kneeMax-kneeMin).toBeGreaterThan(.35);
    expect(Math.abs(avatar.root.getObjectByName('explorer-left-elbow')!.rotation.x)).toBeGreaterThan(.05);
  });

  it('merges decorative detail within each joint and uses opaque material until the camera requires a fade',()=>{
    const avatar=create();let meshes=0;
    const materials=new Set<MeshStandardMaterial>();
    avatar.root.traverse(object=>{if(object instanceof Mesh){const material=object.material as MeshStandardMaterial;if(!material.userData.contactShadow){meshes++;materials.add(material);}}});
    expect(meshes).toBeLessThanOrEqual(48);
    expect([...materials].every(material=>!material.transparent&&material.depthWrite)).toBe(true);
    avatar.setOpacity(.4);
    expect([...materials].every(material=>material.transparent&&material.opacity===.4&&!material.depthWrite)).toBe(true);
    avatar.setOpacity(0);expect(avatar.root.visible).toBe(false);
    avatar.setOpacity(1);
    expect(avatar.root.visible).toBe(true);
    expect([...materials].every(material=>!material.transparent&&material.opacity===1&&material.depthWrite)).toBe(true);
  });

  it('gives the upper body a bounded turning response while physical feet and heading remain authoritative',()=>{
    const avatar=create();avatar.root.position.set(8,16,12);
    const upper=avatar.root.getObjectByName('explorer-upper-body')!,head=avatar.root.getObjectByName('explorer-head')!;
    for(let frame=1;frame<=90;frame++){
      const yaw=frame*.015;avatar.animate(1/60,yaw,2.8,true);avatar.root.updateMatrixWorld(true);
      expect(avatar.root.rotation.y).toBe(yaw);
      expect(avatar.root.position).toEqual(new Vector3(8,16,12));
      expect(Math.abs(upper.rotation.y)).toBeLessThan(.08);
      const feet=['left','right'].map(side=>new Box3().setFromObject(avatar.root.getObjectByName(`explorer-${side}-boot`)!));
      expect(Math.min(...feet.map(foot=>foot.min.y))).toBeCloseTo(16,4);
    }
    expect(upper.rotation.y).toBeLessThan(-.015);expect(head.rotation.y).toBeGreaterThan(.025);
    for(let frame=0;frame<180;frame++)avatar.animate(1/60,1.35,0,true);
    expect(Math.abs(upper.rotation.y)).toBeLessThan(1e-6);
    expect(Math.abs(upper.rotation.x)).toBeLessThan(1e-6);
    expect(Math.abs(head.rotation.y)).toBeLessThan(.013);
  });
});
