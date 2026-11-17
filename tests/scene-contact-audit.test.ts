import {beforeAll,afterAll,it,expect} from 'vitest';
import {Scene,Vector3,MeshStandardMaterial,PerspectiveCamera} from 'three';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {StreetArt} from '../src/rendering/street-art';
import {NeighborhoodDetail} from '../src/rendering/neighborhood-detail';
import {CoastalArt} from '../src/rendering/coastal-art';
import {RegionArt} from '../src/rendering/region-art';
import {partCollisionBounds,type SceneObstacle} from '../src/input/scene-collisions';
import {VoxelWalker} from '../src/input/walk';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {CollapsePhysics} from '../src/destruction/physics';
import {collectNearbyObstacles} from '../src/input/scene-collisions';
import {WalkingCamera,cameraSphereClear} from '../src/input/walk-camera';

let base:ReturnType<typeof generateWorld>,scene:Scene,street:StreetArt,detail:NeighborhoodDetail,coast:CoastalArt,region:RegionArt;
beforeAll(()=>{base=generateWorld();addHarborQuarter(base.world,base.buildings);addRegionalTerrain(base.world);addRegionalDistricts(base.world,base.buildings);scene=new Scene();street=new StreetArt(scene,base.world,base.buildings,{people:false});detail=new NeighborhoodDetail(scene,base.world,base.buildings);coast=new CoastalArt(scene,base.world,base.buildings,{facades:false,headlands:false});region=new RegionArt(scene,base.world);});
afterAll(()=>{street.dispose();detail.dispose();coast.dispose();region.dispose();});

// Diagnostic survey, not a claim that every decorative surface must be solid.
// Candidate gaps are inspected against the actual visual and actor movement.
it('surveys supported near-ground rendered parts against the actual scene collision',async()=>{
 const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env?.MIRROR_CONTACT_AUDIT;
 if(env!=='before'&&env!=='after')return;
 const grid=new Map<string,SceneObstacle[]>();
 for(const b of [...street.obstacles,...detail.obstacles,...coast.obstacles,...region.obstacles]){
  if(b.minY>20||b.maxY<15.8)continue;
  for(let z=Math.floor(b.minZ/4);z<=Math.floor(b.maxZ/4);z++)for(let x=Math.floor(b.minX/4);x<=Math.floor(b.maxX/4);x++){const k=`${x},${z}`,a=grid.get(k);if(a)a.push(b);else grid.set(k,[b]);}
 }
 const point=new Vector3(),gaps:unknown[]=[];let surveyed=0;
 for(const [source,art] of [['street',street],['detail',detail],['coast',coast],['region',region]] as const)for(const p of art.decorationParts()){
  if(p.anchors.some(a=>!base.world.getVoxel(a.x,a.y,a.z)))continue;
  const b=partCollisionBounds(p.geometry,p.matrix),o=b.obb!;
  if(o.center.x<0||o.center.x>256||o.center.z<0||o.center.z>256||b.minY<16.05||b.minY>19.1||b.maxY>24||Math.max(o.halfSize.x,o.halfSize.z)<.18)continue;
  const mats=Array.isArray(p.material)?p.material:[p.material];if(mats.some(m=>m.transparent&&m.opacity<.5))continue;
  let missing=0;
  for(const [x,y,z]of [[0,0,0],[.9,0,0],[-.9,0,0],[0,0,.9],[0,0,-.9],[0,.9,0]]){
   point.set(x*o.halfSize.x,y*o.halfSize.y,z*o.halfSize.z).applyMatrix3(o.rotation).add(o.center);
   if(base.world.getVoxel(Math.floor(point.x),Math.floor(point.y),Math.floor(point.z)))continue;
   if(!(grid.get(`${Math.floor(point.x/4)},${Math.floor(point.z/4)}`)??[]).some(b=>point.x>=b.minX-.015&&point.x<=b.maxX+.015&&point.y>=b.minY-.015&&point.y<=b.maxY+.015&&point.z>=b.minZ-.015&&point.z<=b.maxZ+.015&&(!b.obb||b.obb.containsPoint(point))))missing++;
  }
  surveyed++;if(missing)gaps.push({source,geometry:p.geometry.type,center:{...o.center},half:{...o.halfSize},missing,anchors:p.anchors});
 }
 const moduleName='node:fs',fs=await import(moduleName) as {writeFileSync:(p:string,s:string)=>void};fs.writeFileSync(`artifacts/scene-contact-audit/coverage-${env}.json`,JSON.stringify({surveyed,gapCount:gaps.length,gaps},null,2));expect(surveyed).toBeGreaterThan(1000);
});

it('drives into real window projections from all four directions and reverses clear',async()=>{
 const points=[{id:'south',x:51,z:25.11,yaw:0,axis:'z',sign:1,face:22.44},{id:'north',x:71,z:3.89,yaw:Math.PI,axis:'z',sign:-1,face:6.56},{id:'east',x:77.11,z:17,yaw:Math.PI/2,axis:'x',sign:1,face:74.44},{id:'west',x:45.89,z:9,yaw:-Math.PI/2,axis:'x',sign:-1,face:48.56}] as const;
 const mat=new MeshStandardMaterial(),physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}}),camera=new PerspectiveCamera(),report=[];
 try{for(const p of points){const car=CoastalCar.create(scene,physics,base.world,{onNotice:()=>{}});try{
  const nearby=collectNearbyObstacles({x:p.x,y:16.85,z:p.z},[street.obstacles,detail.obstacles,coast.obstacles,region.obstacles],20,8);car.setObstacleProvider(()=>nearby);car.restore({position:{x:p.x,y:16.85,z:p.z},heading:p.yaw,speed:0});car.setDriving(true);
  expect(Math.hypot(car.position.x-p.x,car.position.z-p.z),p.id+' entry must not require rescue').toBeLessThan(.01);car.setInput({throttle:1});
  let nearest=Infinity;const step=()=>{car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);};
  for(let i=0;i<150;i++){step();nearest=Math.min(nearest,p.sign*(car.position[p.axis]-p.face));}
  expect(nearest,p.id).toBeGreaterThan(1.8);const stopped=car.position.clone();car.setInput({throttle:-1});for(let i=0;i<120;i++)step();
  expect(p.sign*(car.position[p.axis]-stopped[p.axis]),p.id+' reverse exit '+JSON.stringify(car.snapshot())).toBeGreaterThan(.5);report.push({...p,nearest,stopped,end:{...car.position}});
 }finally{car.dispose();}}
 const env=(globalThis as {process?:{env?:Record<string,string>}}).process?.env?.MIRROR_CONTACT_AUDIT;if(env){const moduleName='node:fs',fs=await import(moduleName) as {writeFileSync:(p:string,s:string)=>void};fs.writeFileSync('artifacts/scene-contact-audit/car-facades.json',JSON.stringify(report,null,2));}
 }finally{physics.dispose();mat.dispose();}
});

it('keeps table approaches and actual chair backs solid throughout both shop rooms',()=>{
 const cases=[{name:'bakery table',x:22.1,z:222.7,vx:0,vz:1,limit:223.78},{name:'canteen table',x:22,z:238.6,vx:0,vz:1,limit:239.68},{name:'bakery chair rear',x:19.8,z:224.5,vx:1,vz:0,limit:20.49},{name:'canteen chair rear',x:24.35,z:243,vx:-1,vz:0,limit:23.79}];
 for(const p of cases){const motor=new VoxelWalker(base.world,{x:p.x,y:16,z:p.z}),nearby=collectNearbyObstacles(motor.position,[street.obstacles,detail.obstacles],12,5);motor.setObstacleProvider(()=>nearby);expect(motor.canOccupy(motor.position),p.name+' valid start').toBe(true);for(let i=0;i<120;i++){motor.update(1/60,{x:p.vx,z:p.vz});expect(motor.recoveredLastStep,p.name+' continuous approach').toBe(false);}expect(motor.canOccupy(motor.position),p.name).toBe(true);if(p.vz)expect(motor.position.z,p.name).toBeLessThan(p.limit+.01);else expect(p.vx*(motor.position.x-p.limit),p.name+JSON.stringify(motor.position)).toBeLessThan(.01);}
});

it('chooses a clear entry view when a passerby blocks the real park bench camera',()=>{
 const seat=street.seats.find(s=>s.id==='street-bench-17.8-29.3')!,nearby=collectNearbyObstacles(seat.position,[street.obstacles,detail.obstacles,coast.obstacles],16,8),passerby={minX:17.525,maxX:18.075,minY:16,maxY:17.76,minZ:27.525,maxZ:28.075,standable:false};nearby.push(passerby);
 const view=new WalkingCamera(scene,base.world,()=>nearby),camera=new PerspectiveCamera(),feet=new Vector3(seat.position.x,seat.floorY,seat.position.z);
 try{const yaw=view.seatCameraYaw(seat);expect(Math.abs(yaw-seat.yaw)).toBeGreaterThan(.5);for(let i=0;i<60;i++)view.update(1/60,camera,feet,yaw,-.03,0,true,{sit:1,seatHeight:seat.position.y-seat.floorY,bodyYaw:seat.yaw,landing:0,verticalSpeed:0});expect(camera.position.distanceTo(feet)).toBeGreaterThan(2.8);expect(cameraSphereClear(base.world,camera.position,nearby)).toBe(true);view.setMode('first');expect(view.seatCameraYaw(seat)).toBe(seat.yaw);}finally{view.dispose();}
});
