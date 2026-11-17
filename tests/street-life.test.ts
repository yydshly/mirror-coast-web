import {beforeAll,describe,expect,it} from 'vitest';
import {Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {StreetArt} from '../src/rendering/street-art';
import {StreetLife} from '../src/rendering/street-life';
import {CoastalArt} from '../src/rendering/coastal-art';
import {RegionArt} from '../src/rendering/region-art';
import {StreetLifeSimulation,sampleRoute,signalPhase,type LifeContext} from '../src/simulation/street-life-sim';
import {Material} from '../src/world/palette';
import {VoxelWorld} from '../src/world/voxel';
let world:VoxelWorld,props:StreetArt;
const context:LifeContext={focus:{x:135,y:18,z:164},night:0,wetness:0,obstacles:[]};
beforeAll(()=>{const g=generateWorld();world=g.world;addHarborQuarter(world,g.buildings);addRegionalTerrain(world);addRegionalDistricts(world,g.buildings);props=new StreetArt(new Scene(),world,g.buildings,{people:false});});
function run(sim:StreetLifeSimulation,seconds:number,ctx:LifeContext=context){for(let i=0;i<seconds*30;i++)sim.update(1/30,ctx);}
describe('authority-aware street life',()=>{
  it('clears a queue at the waterfront bend after a player blocks the junction and leaves',()=>{
    const sim=new StreetLifeSimulation(world,{people:false});
    run(sim,45,{...context,obstacles:props.obstacles,player:{position:{x:222,y:16,z:161},radius:1.4}});
    const start=sim.cars.map(c=>c.travelled);run(sim,150,{...context,obstacles:props.obstacles});
    expect(sim.cars.filter(c=>c.travelled-start[c.id]<80).map(c=>({id:c.id,p:c.position,speed:c.speed,advance:c.travelled-start[c.id]}))).toEqual([]);
  },30000);
  it('starts eighteen distinct cars on usable real road lanes and thirty-two people',()=>{
    const sim=new StreetLifeSimulation(world);
    expect(sim.cars).toHaveLength(18);expect(sim.people).toHaveLength(32);
    expect(new Set(sim.cars.map(c=>c.kind)).size).toBe(3);
    const invalid=sim.cars.filter(c=>!sim.roadClear(c.position,c.heading,c.width,c.length,c.height));
    expect(invalid.map(c=>`${c.id}:${c.position.x},${c.position.z}`)).toEqual([]);
    expect(sim.people.filter(p=>p.visible).length).toBeGreaterThanOrEqual(29);
  });
  it('runs full real road loops without teleporting, colliding, or getting permanently stuck behind old parked decoration',()=>{
    const sim=new StreetLifeSimulation(world);const handles=sim.obstacles.slice(),pedHandles=sim.pedestrianObstacles.slice();
    run(sim,180,{...context,obstacles:props.obstacles});
    const halfway=sim.cars.map(c=>c.travelled);
    run(sim,180,{...context,obstacles:props.obstacles});
    expect(sim.cars.map(c=>({id:c.id,travelled:Math.round(c.travelled),secondHalf:Math.round(c.travelled-halfway[c.id])})).filter(c=>c.secondHalf<200)).toEqual([]);
    expect(sim.cars.every(c=>c.travelled>c.route.length)).toBe(true);
    expect(sim.cars.filter(c=>c.visible)).toHaveLength(18);
    for(let i=0;i<sim.cars.length;i++)expect(sim.obstacles[i]).toBe(handles[i]);
    for(let i=0;i<sim.people.length;i++)expect(sim.pedestrianObstacles[i]).toBe(pedHandles[i]);
  },45000);
  it('brakes and waits for a player standing in the lane, then resumes after the player leaves',()=>{
    const sim=new StreetLifeSimulation(world,{cars:1,people:false}),car=sim.cars[0];
    car.distance=50;Object.assign(car.position,sampleRoute(car.route,50));car.heading=sampleRoute(car.route,50).heading;
    const ahead=sampleRoute(car.route,car.distance+18);run(sim,10,{...context,player:{position:{...ahead,y:16},radius:.65}});
    const stopped=car.distance;expect(car.speed).toBe(0);expect(car.travelled).toBeLessThan(15);
    run(sim,6);expect(car.distance).toBeGreaterThan(stopped+15);
  });
  it('stops at a newly dug road before its async collider mesh exists',()=>{
    const sim=new StreetLifeSimulation(world,{cars:1,people:false}),car=sim.cars[0];
    car.distance=50;const pose=sampleRoute(car.route,50);Object.assign(car.position,pose);car.heading=pose.heading;
    const hole=sampleRoute(car.route,car.distance+16),edits=[];
    for(let x=Math.floor(hole.x)-2;x<=Math.floor(hole.x)+2;x++)for(let z=Math.floor(hole.z)-2;z<=Math.floor(hole.z)+2;z++)edits.push({x,y:15,z,material:world.getVoxel(x,15,z)});
    for(const e of edits)world.setVoxel(e.x,e.y,e.z,Material.Air);
    run(sim,10);expect(car.speed).toBe(0);expect(car.travelled).toBeLessThan(14);
    for(const e of edits)world.setVoxel(e.x,e.y,e.z,e.material);
    run(sim,6);expect(car.speed).toBeGreaterThan(.5);
  });
  it('stops behind real debris/vehicle bounds rather than driving through it',()=>{
    const sim=new StreetLifeSimulation(world,{cars:1,people:false}),car=sim.cars[0];car.distance=50;const pose=sampleRoute(car.route,50);Object.assign(car.position,pose);car.heading=pose.heading;
    const b=sampleRoute(car.route,car.distance+14),obstacle={minX:b.x-1.4,maxX:b.x+1.4,minY:16,maxY:19,minZ:b.z-2,maxZ:b.z+2};
    run(sim,8,{...context,obstacles:[obstacle]});expect(car.speed).toBe(0);expect(car.travelled).toBeLessThan(12);
    const stopped=car.distance;run(sim,7);expect(car.distance).toBeGreaterThan(stopped+15);
  });
  it('refreshes changed fixed scenery and follows moving obstacles across index cells',()=>{
    const sim=new StreetLifeSimulation(world,{cars:1,people:false}),car=sim.cars[0];car.distance=50;const pose=sampleRoute(car.route,50);Object.assign(car.position,pose);car.heading=pose.heading;
    const p=sampleRoute(car.route,car.distance+14),block={minX:p.x-1.4,maxX:p.x+1.4,minY:16,maxY:19,minZ:p.z-2,maxZ:p.z+2},obstacles=[block];
    run(sim,8,{...context,obstacles,obstacleRevision:0});expect(car.speed).toBe(0);
    const stopped=car.distance;block.minX+=200;block.maxX+=200;
    run(sim,4,{...context,obstacles,obstacleRevision:1});expect(car.distance).toBeGreaterThan(stopped+6);
    const next=sampleRoute(car.route,car.distance+14),moving={minX:next.x-1.4,maxX:next.x+1.4,minY:16,maxY:19,minZ:next.z-2,maxZ:next.z+2};
    run(sim,6,{...context,obstacles,obstacleRevision:1,dynamicObstacles:[moving]});expect(car.speed).toBe(0);
    const again=car.distance;moving.minX+=200;moving.maxX+=200;sim.elapsed=0; // Keep the following junction green while checking release.
    run(sim,4,{...context,obstacles,obstacleRevision:1,dynamicObstacles:[moving]});expect(car.distance).toBeGreaterThan(again+6);
  });
  it('holds crossing pedestrians at red and lets them complete the protected crossing window',()=>{
    const sim=new StreetLifeSimulation(world,{cars:0}),p=sim.people.find(p=>p.crossing)!;
    run(sim,15);expect(p.progress).toBe(0);
    run(sim,26);expect(p.progress).toBeGreaterThan(.6);expect(p.visible).toBe(true);
    expect(signalPhase(35)).toBe('pedestrians');expect(signalPhase(19)).toBe('north-south');
  });
  it('crosses both real junctions with signal poles and all world decoration present, and retreats from a new obstruction',()=>{
    const scene=new Scene(),g=generateWorld();addHarborQuarter(g.world,g.buildings);addRegionalTerrain(g.world);addRegionalDistricts(g.world,g.buildings);
    const coastal=new CoastalArt(scene,g.world,g.buildings,{facades:false,headlands:false}),street=new StreetArt(scene,g.world,g.buildings,{people:false}),regional=new RegionArt(scene,g.world),life=new StreetLife(scene,g.world);
    const all=[...coastal.obstacles,...street.obstacles,...regional.obstacles,...life.signalObstacles],sim=life.simulation;
    const crossers=sim.people.filter(p=>p.crossing);const reached=new Set<number>();
    for(let i=0;i<30*120;i++){sim.update(1/30,{...context,obstacles:all});for(const p of crossers)if(p.progress===1)reached.add(p.id);}
    expect([...reached].sort()).toEqual(crossers.map(p=>p.id));
    const crosser=crossers[0];sim.elapsed=34.1;crosser.progress=0;crosser.direction=1;crosser.wait=0;crosser.committed=false;crosser.retreating=false;crosser.position={x:crosser.a.x,y:16,z:crosser.a.z};
    for(const c of sim.cars){c.visible=false;c.position.x=-1000;c.bounds.minY=0;c.bounds.maxY=-1;}
    const blocked={minX:134,maxX:137,minY:16,maxY:20,minZ:164,maxZ:165};
    run(sim,11,{...context,obstacles:[blocked]});
    expect(crosser.progress).toBe(0);expect(crosser.retreating).toBe(false);
    life.dispose();street.dispose();coastal.dispose();regional.dispose();
  },20000);
  it('renders all shared-instance cars, articulated people, umbrellas and signals within fixed budgets',()=>{
    const scene=new Scene(),life=new StreetLife(scene,world);
    life.update(.1,{...context,wetness:1,night:1});
    expect(scene.getObjectByName('living-streets')).toBeDefined();
    expect(life.diagnostics.cars).toBe(18);expect(life.signalObstacles).toHaveLength(6);
    life.dispose();expect(scene.getObjectByName('living-streets')).toBeUndefined();
  });
});
