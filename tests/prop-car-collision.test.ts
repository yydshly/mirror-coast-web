import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Quaternion,Scene,Vector3} from 'three';
import {CoastalCar} from '../src/vehicles/coastal-car';
import {CollapsePhysics} from '../src/destruction/physics';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {RegionArt} from '../src/rendering/region-art';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {orientedCollisionBounds,type SceneObstacle} from '../src/input/scene-collisions';
const clean:Array<()=>void>=[];afterEach(()=>clean.splice(0).reverse().forEach(f=>f()));
async function setup(world?:VoxelWorld){
 const w=world??new VoxelWorld({minX:0,maxX:768,minZ:0,maxZ:256});if(!world)for(let x=230;x<330;x++)for(let z=146;z<182;z++)w.setVoxel(x,15,z,Material.Road);
 const scene=new Scene(),mat=new MeshStandardMaterial(),camera=new PerspectiveCamera(),physics=await CollapsePhysics.create(scene,mat,{onStateChange:()=>{}});clean.push(()=>mat.dispose(),()=>physics.dispose());const car=CoastalCar.create(scene,physics,w,{onNotice:()=>{}});clean.push(()=>car.dispose());
 physics.ensureVehicleTerrain(w,{x:280,y:16,z:164});
 const step=()=>{car.beforePhysics(1/60);physics.update(1/60);car.afterPhysics(1/60,camera);};return{world:w,scene,car,physics,simulate:(n:number)=>{for(let i=0;i<n*60;i++)step();},step};
}
describe('visible low props remain solid in both car modes',()=>{
 it('updates and removes the same road surface when its heights change during recovery',async()=>{
  const {physics}=await setup(),vehicle=physics.createGroundVehicle({x:280,y:18,z:164},()=>{});clean.push(()=>vehicle.dispose());vehicle.setActive(true);
  const surface:SceneObstacle={minX:270,maxX:290,minY:16,maxY:16.1,minZ:154,maxZ:174,surface:[16,16,16,16]};
  const distance=()=>vehicle.cameraDistance({x:280,y:22,z:164},{x:0,y:-1,z:0},10);
  vehicle.syncProps([surface]);physics.update(1/60);expect(distance()).toBeCloseTo(5.6,1);
  surface.minY=18;surface.maxY=18.1;surface.surface=[18,18,18,18];vehicle.syncProps([surface]);physics.update(1/60);expect(distance()).toBeCloseTo(3.6,1);
  vehicle.syncProps([]);physics.update(1/60);expect(distance()).toBeCloseTo(5.6,1);
 });
 it.each([
  {name:'17cm roadside post',minZ:163.915,maxZ:164.085,height:1.12},
  {name:'low non-standable rail',minZ:154,maxZ:174,height:1.1},
  {name:'bench back',minZ:163,maxZ:165,height:.75},
 ])('blocks $name through impact promotion instead of discarding its collider',async p=>{
  const {car,simulate,step}=await setup(),obstacle:SceneObstacle={minX:279.915,maxX:280.085,minY:16,maxY:16+p.height,minZ:p.minZ,maxZ:p.maxZ,standable:false};car.setObstacleProvider(()=>[obstacle]);car.setDriving(true);car.setInput({throttle:1});
  let impact=false,maxX=car.position.x;for(let i=0;i<270;i++){step();impact||=!!car.snapshot().rigidBody;maxX=Math.max(maxX,car.position.x);}expect(impact).toBe(true);expect(maxX,JSON.stringify(car.snapshot())).toBeLessThan(280);car.releaseControls();simulate(.5);
 });
 it.each([20,-12])('stops an already dynamic car at a thin post with velocity %i',async velocity=>{
  const {car,step}=await setup(),post:SceneObstacle={minX:279.915,maxX:280.085,minY:16,maxY:17.12,minZ:163.915,maxZ:164.085,standable:false};car.setObstacleProvider(()=>[post]);const east=velocity>0;car.restore({position:{x:east?270:288,y:16.85,z:164},heading:-Math.PI/2,speed:0,rigidBody:{rotation:{x:0,y:-Math.SQRT1_2,z:0,w:Math.SQRT1_2},linearVelocity:{x:velocity,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}});car.setDriving(true);car.setInput({throttle:east?1:-1});
  for(let i=0;i<65;i++){step();expect(east?car.position.x<280:car.position.x>280,JSON.stringify(car.snapshot())).toBe(true);}
 });
 it('uses the actual rotated prop shape, leaving space outside its broad box free',async()=>{
  const {physics,simulate}=await setup(),v=physics.createGroundVehicle({x:277,y:16.85,z:164},()=>{});clean.push(()=>v.dispose());const rail=orientedCollisionBounds({x:281,y:17,z:164},new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),{x:3,y:.5,z:.08});rail.standable=false;v.syncProps([rail]);physics.addFragments([{id:'obb-gap',buildingId:'test',size:{x:1,y:1,z:1},voxels:[[0,0,0,Material.Brick]],position:{x:283,y:21,z:164},rotation:{x:0,y:0,z:0,w:1},state:'falling'}]);simulate(3);expect(physics.snapshot()[0].position.y).toBeCloseTo(16.5,1);
 });
 it('does not freeze a moving actor into a duplicate static prop collider',async()=>{
  const {physics,simulate}=await setup(),v=physics.createGroundVehicle({x:277,y:16.85,z:164},()=>{});clean.push(()=>v.dispose());const actor:SceneObstacle={minX:280,maxX:282,minY:16,maxY:18,minZ:163,maxZ:165};physics.syncActorObstacles([actor]);v.syncProps([actor]);actor.minX+=10;actor.maxX+=10;physics.syncActorObstacles([actor]);simulate(.1);physics.addFragments([{id:'actor-gap',buildingId:'test',size:{x:1,y:1,z:1},voxels:[[0,0,0,Material.Brick]],position:{x:281,y:21,z:164},rotation:{x:0,y:0,z:0,w:1},state:'falling'}]);simulate(3);expect(physics.snapshot()[0].position.y).toBeCloseTo(16.5,1);
 });
 it('keeps the nearby end of a long prop even when its centre is far away',async()=>{
  const {physics}=await setup(),v=physics.createGroundVehicle({x:268,y:16.85,z:164},()=>{});clean.push(()=>v.dispose());v.syncProps([{minX:270,maxX:310,minY:16,maxY:17.1,minZ:163.9,maxZ:164.1,standable:false}]);v.setActive(true);physics.update(1/60);expect(v.cameraDistance({x:270.5,y:20,z:164},{x:0,y:-1,z:0},10)).toBeCloseTo(2.5,1);
 });
});
let regional:ReturnType<typeof generateWorld>;beforeAll(()=>{regional=generateWorld();addRegionalTerrain(regional.world);},30000);
describe('real regional kilometre markers',()=>{
 it('registers all seven visible posts and releases their collision with their ground',()=>{
  const art=new RegionArt(new Scene(),regional.world);clean.push(()=>art.dispose());
  for(const [x,z]of [[302,155],[384,155],[564,165],[620,151],[-112,135],[165,-139],[193,-225]]){const y=regionalHeightAt(x,z)+1,p={x:x+.5,y:y+.5,z:z+.5};expect(art.obstacles.some(b=>b.minX<p.x&&b.maxX>p.x&&b.minZ<p.z&&b.maxZ>p.z&&b.minY<p.y&&b.maxY>p.y),JSON.stringify(p)).toBe(true);}
  const y=regionalHeightAt(302,155),m=regional.world.getVoxel(302,y,155);art.sync(regional.world.applyEdits([{x:302,y,z:155,material:0}]));expect(art.obstacles.some(b=>b.minX<302.5&&b.maxX>302.5&&b.minZ<155.5&&b.maxZ>155.5)).toBe(false);regional.world.setVoxel(302,y,155,m);
 });
 it('actually stops the car at the rendered roadside post in the real regional terrain',async()=>{
  const {car,scene,step}=await setup(regional.world),art=new RegionArt(scene,regional.world);clean.push(()=>art.dispose());car.setObstacleProvider(()=>art.obstacles);car.restore({position:{x:286,y:16.85,z:155.5},heading:-Math.PI/2,speed:0});car.setDriving(true);car.setInput({throttle:1});let maxX=286;for(let i=0;i<240;i++){step();maxX=Math.max(maxX,car.position.x);}expect(maxX,JSON.stringify(car.snapshot())).toBeLessThan(302.5);expect(maxX).toBeGreaterThan(296);
 });
});
