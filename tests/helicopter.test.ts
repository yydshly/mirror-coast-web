import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, PerspectiveCamera, Scene,Quaternion,Vector3 } from 'three';
import { CollapsePhysics } from '../src/destruction/physics';
import { Helicopter } from '../src/vehicles/helicopter';
import { generateWorld } from '../src/world/generate';
import { VoxelWorld } from '../src/world/voxel';
import { Material } from '../src/world/palette';
import { createMeshInput, meshChunk } from '../src/world/mesher';
import { COAST_ROUTE, HELICOPTER_SPAWN } from '../src/route/coast-route';
import {helipadClear,helicopterExit} from '../src/vehicles/helicopter-access';

const cleanup: Array<() => void> = [];

it('excludes the returning aircraft itself from pad occupancy while retaining other obstacles',async()=>{const {world}=generateWorld(),{physics,heli}=await setup(world);const all=physics.walkObstacles;expect(heli.ownObstacles.length).toBe(7);expect(helipadClear(world,all)).toBe(false);expect(helipadClear(world,all.filter(b=>!heli.ownObstacles.includes(b)))).toBe(true);expect(helipadClear(world,[{minX:107,maxX:109,minY:15,maxY:18,minZ:208,maxZ:210}])).toBe(false);expect(helicopterExit(world,heli.position,0,()=>true)).not.toBeNull();});
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); });

async function setup(world: VoxelWorld,canLand?:()=>boolean) {
  const scene = new Scene();
  const material = new MeshStandardMaterial({ vertexColors: true }); cleanup.push(() => material.dispose());
  const physics = await CollapsePhysics.create(scene, material, { onStateChange: () => {} }); cleanup.push(() => physics.dispose());
  for (const key of world.chunks.keys()) physics.syncChunk(meshChunk(createMeshInput(world, key)!));
  const notices: string[] = [];
  const heli = Helicopter.create(scene, physics, world, { onNotice: message => notices.push(message),canLand }); cleanup.push(() => heli.dispose());
  const camera = new PerspectiveCamera(52, 16 / 9, .1, 1000);
  const simulate = (seconds: number, perFrame?: () => void) => {
    for (let frame = 0; frame < seconds * 60; frame++) {
      heli.beforePhysics(1 / 60); physics.update(1 / 60); heli.afterPhysics(1 / 60, camera); perFrame?.();
    }
  };
  return { physics, heli, scene, camera, notices, simulate };
}

function simplePad(): VoxelWorld {
  const world = new VoxelWorld();
  for (let z = 190; z <= 230; z++) for (let x = 85; x <= 135; x++) world.setVoxel(x, 14, z, Material.Concrete);
  return world;
}

describe('shared-world helicopter flight', () => {
  it('restores the same responsive manual acceleration after H and releases the old return guidance',async()=>{
    const normal=await setup(simplePad()),returned=await setup(simplePad());const state={position:{x:180,y:70,z:215},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0};
    normal.heli.restore(state);normal.heli.setPiloting(true);returned.heli.restore(state);returned.heli.startReturnHome();normal.heli.setInput({pitch:1});returned.heli.setInput({pitch:1});normal.simulate(1);returned.simulate(1);
    expect(returned.heli.viewState.autopilot).toBe(false);expect(returned.heli.viewState.speed).toBeGreaterThan(9);expect(Math.abs(returned.heli.viewState.speed-normal.heli.viewState.speed)).toBeLessThan(.2);expect(returned.heli.viewState.waypoint).toContain('手动驾驶');
    returned.heli.setInput({pitch:1,yaw:1});const before=returned.heli.snapshot().rotation;returned.simulate(1);const after=returned.heli.snapshot().rotation;expect(new Quaternion().copy(before).angleTo(new Quaternion().copy(after))).toBeGreaterThan(1.1);
  });
  it('restarts the engine and leaves the pad when a forward command follows a completed return',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.restore({position:{x:108,y:16.46,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:false,routeIndex:COAST_ROUTE.length-1,tourStatus:'complete',flightMode:'return'});heli.setPiloting(true);simulate(2);expect(heli.viewState.engineOn).toBe(false);
    heli.setInput({pitch:1});simulate(3);expect(heli.viewState.engineOn).toBe(true);expect(heli.position.y).toBeGreaterThan(18);expect(heli.viewState.speed).toBeGreaterThan(10);expect(heli.viewState.routeComplete).toBe(false);
  });
  it('flies home through climb, cruise, approach and physical landing without changing the pose on request',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.restore({position:{x:200,y:22,z:215},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:2});
    const start=heli.snapshot().position;heli.startReturnHome();expect(heli.snapshot().position).toEqual(start);const phases=new Set<string>();let previous=heli.position.clone(),largest=0;
    for(let i=0;i<160&&!heli.viewState.routeComplete;i++)simulate(1,()=>{phases.add(heli.viewState.returnPhase!);largest=Math.max(largest,previous.distanceTo(heli.position));previous.copy(heli.position);});
    expect(heli.viewState.routeComplete,JSON.stringify(heli.viewState)).toBe(true);expect(heli.viewState.flightMode).toBe('return');expect(phases.has('climb')).toBe(true);expect(phases.has('cruise')).toBe(true);expect(phases.has('approach')).toBe(true);expect(phases.has('landing')).toBe(true);
    expect(largest).toBeLessThan(.7);expect(heli.viewState.grounded).toBe(true);expect(heli.viewState.engineOn).toBe(false);expect(Math.hypot(heli.position.x-108,heli.position.z-209)).toBeLessThan(.65);
  },20000);
  it('brakes a moving aircraft before planning from its actual stopped position',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.restore({position:{x:190,y:58,z:215},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:12,y:0,z:0},engineOn:true,routeIndex:0});heli.startReturnHome();
    expect(heli.viewState.returnPhase).toBe('braking');simulate(1);expect(heli.position.x).toBeGreaterThan(195);expect(heli.viewState.routeComplete).toBe(false);
    for(let i=0;i<160&&!heli.viewState.routeComplete;i++)simulate(1);expect(heli.viewState.routeComplete,JSON.stringify(heli.viewState)).toBe(true);
  },20000);
  it('returns from outside the soft map edge without fighting the manual-flight boundary during its climb',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.restore({position:{x:-40,y:70,z:215},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.startReturnHome();
    for(let i=0;i<160&&!heli.viewState.routeComplete;i++)simulate(1);expect(heli.viewState.routeComplete,JSON.stringify(heli.viewState)).toBe(true);
  },20000);
  it('leaves an overhead roof sideways instead of climbing through it',async()=>{
    const world=simplePad();for(let z=204;z<=214;z++)for(let x=119;x<=131;x++)world.setVoxel(x,25,z,Material.Roof);
    const {heli,simulate}=await setup(world);heli.restore({position:{x:125,y:22,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.startReturnHome();let clearedSideways=false;
    for(let i=0;i<180&&!heli.viewState.routeComplete;i++)simulate(1,()=>{if(Math.abs(heli.position.x-125)>10||Math.abs(heli.position.z-209)>10)clearedSideways=true;if(!clearedSideways)expect(heli.position.y).toBeLessThan(23.4);});
    expect(clearedSideways).toBe(true);expect(heli.viewState.routeComplete,JSON.stringify(heli.viewState)).toBe(true);
  },20000);
  it('holds over the dock if landing is occupied, then continues after it clears',async()=>{
    let clear=false;const {heli,simulate}=await setup(simplePad(),()=>clear);
    heli.restore({position:{x:152,y:55,z:220},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.startReturnHome();
    for(let i=0;i<110&&heli.viewState.returnPhase!=='holding';i++)simulate(1);expect(heli.viewState.returnPhase).toBe('holding');expect(heli.position.y).toBeGreaterThan(29);expect(heli.viewState.routeComplete).toBe(false);
    clear=true;for(let i=0;i<90&&!heli.viewState.routeComplete;i++)simulate(1);expect(heli.viewState.routeComplete).toBe(true);
  },20000);
  it('holds in a closed departure cage and preserves a paused return for manual takeover and reload',async()=>{
    const world=simplePad();for(let y=15;y<=25;y++)for(let z=200;z<=218;z++)for(const x of [117,133])world.setVoxel(x,y,z,Material.Brick);for(let y=15;y<=25;y++)for(let x=117;x<=133;x++)for(const z of [200,218])world.setVoxel(x,y,z,Material.Brick);for(let x=117;x<=133;x++)for(let z=200;z<=218;z++)world.setVoxel(x,25,z,Material.Roof);
    const {heli,simulate}=await setup(world);heli.restore({position:{x:125,y:22,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.startReturnHome();simulate(3);
    expect(heli.viewState.returnPhase).toBe('holding');expect(heli.position.distanceTo({x:125,y:22,z:209})).toBeLessThan(.1);heli.setInput({strafe:1});expect(heli.viewState.autopilot).toBe(false);const saved=heli.snapshot();expect(saved.flightMode).toBe('return');expect(saved.tourStatus).toBe('paused');heli.restore(saved);expect(heli.viewState.flightMode).toBe('return');expect(heli.viewState.tourStatus).toBe('paused');
    heli.startTour();expect(heli.viewState.flightMode).toBe('tour');expect(heli.viewState.routeIndex).toBe(0);
  });
  it('stops the rotor at non-voxel scenery and releases the contact when that scenery is removed',async()=>{
    const {heli,simulate}=await setup(simplePad());
    let props=[{minX:100,maxX:116,minY:27,maxY:38,minZ:195,maxZ:195.08,standable:false}];
    heli.setObstacleProvider(()=>props);heli.restore({position:{x:108,y:30,z:214},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});
    heli.setPiloting(true);heli.setInput({pitch:1});simulate(7);
    expect(heli.position.z).toBeGreaterThan(199.7);expect(heli.position.z).toBeLessThan(201);expect(heli.motionDiagnostics.sceneryColliders).toBe(1);
    props=[];simulate(2);expect(heli.position.z).toBeLessThan(195);expect(heli.motionDiagnostics.sceneryColliders).toBe(0);
  });
  it('collides at the visible tail rotor when reversing toward a wall',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setObstacleProvider(()=>[{minX:100,maxX:116,minY:27,maxY:38,minZ:228,maxZ:228.1}]);
    heli.restore({position:{x:108,y:30,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.setPiloting(true);heli.setInput({pitch:-1});simulate(7);
    expect(heli.position.z).toBeGreaterThan(220);expect(heli.position.z).toBeLessThan(222.5);
  });
  it('keeps high-speed flight out of a thin pole using CCD, including after entering its scenery radius',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setObstacleProvider(()=>[{minX:107.8,maxX:108.2,minY:27,maxY:40,minZ:180,maxZ:180.06}]);
    heli.restore({position:{x:108,y:35,z:215},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:-31},engineOn:true,routeIndex:0});heli.setPiloting(true);heli.setInput({pitch:1});
    let closest=Infinity;simulate(5,()=>closest=Math.min(closest,heli.position.z));expect(closest).toBeGreaterThan(184.5);expect(heli.position.z).toBeLessThan(186);
  });
  it('does not turn the tail through a nearby pole, while the rotor stays above it',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setObstacleProvider(()=>[{minX:113.2,maxX:113.5,minY:30.25,maxY:31.15,minZ:208.8,maxZ:209.2}]);
    heli.restore({position:{x:108,y:30,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.setPiloting(true);heli.setInput({yaw:1});simulate(5);
    const q=heli.snapshot().rotation,yaw=new (Quaternion)().copy(q);const nose=new Vector3(0,0,-1).applyQuaternion(yaw);
    const heading=Math.atan2(-nose.x,-nose.z);expect(heading).toBeGreaterThan(.8);expect(heading).toBeLessThan(1.57);
  });
  it('uses a circular rotor disc rather than a square, and detects scenery updates without stale colliders',async()=>{
    const {physics}=await setup(simplePad()),p={x:108,y:30,z:209},q={x:0,y:0,z:0,w:1},plane=physics.createVehicle(p,()=>{});cleanup.push(()=>plane.dispose());
    const corner={minX:112.5,maxX:112.7,minY:31.8,maxY:31.93,minZ:213.5,maxZ:213.7};plane.syncProps([corner]);expect(plane.clearAt(p,q)).toBe(true);
    Object.assign(corner,{minX:112.1,maxX:112.3,minZ:208.9,maxZ:209.1});plane.syncProps([corner]);expect(plane.clearAt(p,q)).toBe(false);
    plane.syncProps([]);expect(plane.clearAt(p,q)).toBe(true);
  });
  it('corrects an old save already embedded in newly collidable scenery once, with an explicit notice',async()=>{
    const {heli,simulate,notices}=await setup(simplePad());heli.setObstacleProvider(()=>[{minX:107,maxX:109,minY:31,maxY:34,minZ:207,maxZ:211}]);
    heli.restore({position:{x:108,y:30,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:false,routeIndex:0});simulate(.1);
    const corrected=heli.position.clone();expect(corrected.distanceTo({x:108,y:30,z:209})).toBeGreaterThan(.4);expect(corrected.distanceTo({x:108,y:30,z:209})).toBeLessThan(7);
    expect(notices.some(n=>n.includes('旧停机位置'))).toBe(true);simulate(2);expect(heli.position.distanceTo(corrected)).toBeLessThan(.01);
  });
  it('reaches the faster manual cruise and interpolates flight across 144Hz frames without frozen display poses',async()=>{
    const {heli,simulate,physics,scene,camera}=await setup(simplePad());heli.restore({position:{x:108,y:70,z:200},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});heli.setPiloting(true);heli.setInput({pitch:1});simulate(5.5);
    expect(heli.viewState.speed).toBeGreaterThan(30);expect(heli.viewState.speed).toBeLessThan(32.1);const root=scene.getObjectByName('coast-helicopter')!;let repeated=0;
    for(let i=0;i<100;i++){const old=root.position.z,physical=heli.position.z;heli.beforePhysics(1/144);physics.update(1/144);heli.afterPhysics(1/144,camera);if(physical===heli.position.z)repeated++;expect(old-root.position.z).toBeGreaterThan(.20);expect(old-root.position.z).toBeLessThan(.24);}
    expect(repeated).toBeGreaterThan(0);expect(heli.snapshot().position.z).toBe(heli.position.z);
  });
  it('pairs engine state with red/green position lamps, aft white, beacon, strobe and low-altitude landing light',async()=>{
    const {heli,scene,simulate}=await setup(simplePad());simulate(.1);expect(scene.getObjectByName('helicopter-port-red')!.visible).toBe(false);heli.setPiloting(true);simulate(1);
    for(const name of ['helicopter-port-red','helicopter-starboard-green','helicopter-aft-white'])expect(scene.getObjectByName(name)!.visible).toBe(true);
    expect((scene.getObjectByName('helicopter-landing-light') as import('three').SpotLight).intensity).toBeGreaterThan(0);
    let beacon=false,strobe=false;for(let i=0;i<80;i++){simulate(1/60);beacon||=scene.getObjectByName('helicopter-red-beacon')!.visible;strobe||=scene.getObjectByName('helicopter-white-strobe')!.visible;}expect(beacon).toBe(true);expect(strobe).toBe(true);
  });
  it('keeps an automatic tour moving when manual controls are released for a map or journal',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setAutopilot(true);simulate(8);
    const before=heli.position.clone();heli.releaseControls(false);simulate(3);
    expect(heli.viewState.autopilot).toBe(true);expect(heli.position.distanceTo(before)).toBeGreaterThan(2);
    const leg=heli.viewState.routeIndex;heli.setAutopilot(true);expect(heli.viewState.routeIndex).toBe(leg);
  });
  it('freezes physical flight in a background tab, resumes its pose and speed, and respects a subsequent explicit pause',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setAutopilot(true);simulate(10);
    const before=heli.snapshot();expect(heli.suspendForVisibility()).toBe(true);simulate(5);
    expect(heli.snapshot().position).toEqual(before.position);expect(heli.snapshot().linearVelocity).toEqual(before.linearVelocity);expect(heli.snapshot().tourStatus).toBe('active');
    heli.resumeAfterVisibility();simulate(2);expect(heli.position.distanceTo(before.position)).toBeGreaterThan(2);
    heli.setAutopilot(false);expect(heli.suspendForVisibility()).toBe(false);heli.resumeAfterVisibility();expect(heli.viewState.autopilot).toBe(false);
  });
  it('remembers a paused departure leg instead of resetting it to idle on restore',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setAutopilot(true);simulate(2);heli.setAutopilot(false);
    const state=heli.snapshot();expect(state.routeIndex).toBe(0);expect(state.tourStatus).toBe('paused');heli.restore(state);expect(heli.viewState.tourStatus).toBe('paused');expect(heli.viewState.routeComplete).toBe(false);
  });
  it('does not infer a completed return merely from a last-leg aircraft parked somewhere else',async()=>{
    const {heli}=await setup(simplePad());heli.restore({position:{x:125,y:16.46,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:false,routeIndex:COAST_ROUTE.length-1});
    expect(heli.viewState.routeComplete).toBe(false);
  });
  it('keeps a restored landed-tour debrief until an explicit flight command',async()=>{
    const {heli,simulate}=await setup(simplePad());
    heli.restore({position:{x:108,y:16.46,z:209},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:false,routeIndex:COAST_ROUTE.length-1});
    heli.setPiloting(true);simulate(3);
    expect(heli.viewState.tourStatus).toBe('complete');expect(heli.viewState.engineOn).toBe(false);expect(heli.viewState.grounded).toBe(true);
    heli.setInput({lift:1});simulate(4);expect(heli.viewState.tourStatus).toBe('idle');expect(heli.viewState.altitude).toBeGreaterThan(2);
  });
  it('pauses an automatic tour for reading, holds the same leg, and explicitly resumes it',async()=>{
    const {heli,simulate}=await setup(simplePad());
    expect(heli.viewState.tourStatus).toBe('idle');
    heli.setAutopilot(true);simulate(11);
    expect(heli.viewState.tourStatus).toBe('active');
    const leg=heli.viewState.routeIndex;
    heli.releaseControls();simulate(5);
    expect(heli.viewState.tourStatus).toBe('paused');expect(heli.viewState.piloting).toBe(true);
    expect(heli.viewState.routeIndex).toBe(leg);
    const held=heli.position.clone();simulate(3);expect(heli.position.distanceTo(held)).toBeLessThan(.35);
    heli.setAutopilot(true);expect(heli.viewState.routeIndex).toBe(leg);simulate(3);
    expect(heli.viewState.tourStatus).toBe('active');expect(heli.position.distanceTo(held)).toBeGreaterThan(3);
  });
  it('lets a manual flight command pause the tour without losing its checkpoint',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setAutopilot(true);simulate(10);
    const checkpoint=heli.viewState.routeIndex;heli.setInput({strafe:1});simulate(1);
    expect(heli.viewState.autopilot).toBe(false);expect(heli.viewState.tourStatus).toBe('paused');
    expect(heli.viewState.routeIndex).toBe(checkpoint);
    heli.setAutopilot(true);expect(heli.viewState.tourStatus).toBe('active');expect(heli.viewState.routeIndex).toBe(checkpoint);
  });
  it('ignores the held interaction-key repeat after boarding, but accepts a fresh flight command',async()=>{
    const doc=new EventTarget();vi.stubGlobal('document',doc);
    try{
      const {heli,simulate}=await setup(simplePad());heli.setPiloting(true);heli.setInput({lift:1});const initial=heli.position.x;
      const press=(repeat:boolean)=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{code:'KeyE',repeat});doc.dispatchEvent(event);};
      press(true);simulate(3);expect(Math.abs(heli.position.x-initial)).toBeLessThan(.25);
      press(false);simulate(1);expect(heli.position.x).toBeGreaterThan(initial+1);
    }finally{vi.unstubAllGlobals();}
  });
  it('releases reading-panel commands into hover without leaving helicopter mode',async()=>{
    const {heli,simulate}=await setup(simplePad());heli.setPiloting(true);heli.setInput({lift:1,strafe:1});simulate(3);
    heli.releaseControls();simulate(5);
    expect(heli.viewState.piloting).toBe(true);expect(heli.viewState.autopilot).toBe(false);
    const velocity=heli.snapshot().linearVelocity;
    expect(Math.hypot(velocity.x,velocity.z)).toBeLessThan(.25);expect(Math.abs(velocity.y)).toBeLessThan(.3);
  });
  it('spins up, lifts using Rapier forces, hovers, and pauses without falling', async () => {
    const { heli, simulate, physics, scene } = await setup(simplePad());
    expect(heli.viewState.grounded).toBe(true);
    heli.setPiloting(true); simulate(6);
    expect(heli.position.y).toBeGreaterThan(19);
    expect(heli.viewState.rpm).toBeGreaterThan(.98);
    expect(Math.abs(heli.snapshot().linearVelocity.y)).toBeLessThan(.5);
    expect(physics.activeCount).toBe(0);
    expect(scene.getObjectByName('coast-helicopter')).toBeDefined();
    heli.setPiloting(false);
    const paused = heli.snapshot().position;
    simulate(10);
    expect(heli.snapshot().position).toEqual(paused);
    heli.setPiloting(true); heli.setInput({ lift: -1 }); simulate(6);
    expect(heli.viewState.grounded).toBe(true);
    expect(heli.position.y).toBeGreaterThan(16.3);
  });

  it('stops against an actual voxel wall instead of passing through it', async () => {
    const world = simplePad();
    for (let y = 15; y <= 55; y++) for (let x = 80; x <= 138; x++) world.setVoxel(x, y, 188, Material.Brick);
    const { heli, simulate } = await setup(world);
    heli.setPiloting(true); simulate(5);
    heli.setInput({ pitch: 1 }); simulate(9);
    expect(heli.position.z).toBeGreaterThan(192.5);
    expect(heli.position.z).toBeLessThan(202);
  });

  it('restores a saved pose and route checkpoint without immediately dropping the aircraft', async () => {
    const { heli, simulate } = await setup(simplePad());
    const state = {
      position: { x: 122.5, y: 49.25, z: 217.5 }, rotation: { x: 0, y: Math.sin(.3), z: 0, w: Math.cos(.3) },
      linearVelocity: { x: 2, y: -.2, z: 3 }, engineOn: true, routeIndex: 3,
    };
    heli.restore(state); simulate(2);
    expect(heli.snapshot().position).toEqual(state.position);
    expect(heli.snapshot().rotation.y).toBeCloseTo(state.rotation.y, 6);
    expect(heli.snapshot().linearVelocity).toEqual(state.linearVelocity);
    expect(heli.viewState.routeIndex).toBe(3);
    expect(heli.viewState.piloting).toBe(false);
  });

  it('protects an aircraft descending over open water without treating the sea as a landing pad', async () => {
    const { heli, simulate } = await setup(new VoxelWorld());
    heli.restore({ position: { x: 180, y: 23, z: 235 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, linearVelocity: { x: 0, y: 0, z: 0 }, engineOn: true, routeIndex: 0 });
    heli.setPiloting(true); heli.setInput({ lift: -1 }); simulate(9);
    expect(heli.position.y).toBeGreaterThan(14.8);
    expect(heli.position.y).toBeLessThan(18);
    expect(heli.viewState.grounded).toBe(false);
  });

  it('flies the complete coast route and lands on the real wooden dock', async () => {
    const { world } = generateWorld();
    const { heli, simulate, notices } = await setup(world);
    heli.setPiloting(true); heli.setAutopilot(true);
    const visited = new Set<number>();
    for (let block = 0; block < 30 && !heli.viewState.routeComplete; block++) {
      simulate(5, () => visited.add(heli.viewState.routeIndex));
    }
    const state = heli.snapshot();
    expect(heli.viewState.routeComplete, JSON.stringify({ state, view: heli.viewState, notices })).toBe(true);
    expect(visited.size).toBe(COAST_ROUTE.length);
    expect(Math.hypot(state.position.x - HELICOPTER_SPAWN.x, state.position.z - HELICOPTER_SPAWN.z)).toBeLessThan(.8);
    expect(heli.viewState.grounded).toBe(true);
    expect(heli.viewState.autopilot).toBe(false);
    expect(heli.viewState.engineOn).toBe(false);
    expect(heli.viewState.tourStatus).toBe('complete');
    // A manual departure after returning must leave the "landed" HUD state.
    heli.setInput({ lift: 1 }); simulate(4);
    expect(heli.viewState.routeComplete).toBe(false);
    expect(heli.viewState.routeIndex).toBe(0);
    expect(heli.viewState.tourStatus).toBe('idle');
    expect(heli.viewState.altitude).toBeGreaterThan(2);
  }, 20000);
});
