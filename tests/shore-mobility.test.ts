import {afterEach,expect,it} from 'vitest';
import {MeshStandardMaterial,PerspectiveCamera,Scene,Mesh,ShaderMaterial} from 'three';
import {VoxelWalker} from '../src/input/walk';
import {Bicycle} from '../src/vehicles/bicycle';
import {Helicopter} from '../src/vehicles/helicopter';
import {helicopterExit} from '../src/vehicles/helicopter-access';
import {CollapsePhysics} from '../src/destruction/physics';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain,regionalHeightAt} from '../src/world/region-terrain';
import {GroundActions} from '../src/input/ground-actions';
import {Environment} from '../src/rendering/environment';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(f=>f()));
function beach(floor=12){const world=new VoxelWorld();for(let x=100;x<180;x++)for(let z=130;z<210;z++)world.setVoxel(x,floor-1,z,Material.Sand,false);return world;}
function bikeAt(world=beach()){
 const bike=new Bicycle(new Scene(),world);cleanup.push(()=>bike.dispose());bike.restore({position:{x:140,y:12,z:180},heading:0,riding:true});bike.setRiding(true);
 const step=(n:number)=>{for(let i=0;i<n;i++)bike.update(1/60);};return{bike,step};
}
it('walks along waterline sand without repeatedly recovering from imaginary water',()=>{
 const walker=new VoxelWalker(beach(),{x:140,y:12,z:180});let recovered=false;
 for(let i=0;i<180;i++){walker.update(1/60,{x:1,z:0});recovered ||= walker.recoveredLastStep;}
 expect(recovered).toBe(false);expect(walker.position.x).toBeGreaterThan(148);expect(walker.position.y).toBeCloseTo(12,3);
});
it('returns a walker from actual deep water to revalidated shore footing',()=>{
 const world=beach(),walker=new VoxelWalker(world,{x:140,y:12,z:180});
 for(let x=100;x<180;x++)for(let z=130;z<170;z++){world.setVoxel(x,11,z,0,false);world.setVoxel(x,5,z,Material.Sand,false);}
 let recovered=false;for(let i=0;i<400;i++){walker.update(1/60,{x:0,z:-1});if(walker.recoveredLastStep){recovered=true;break;}}
 expect(recovered).toBe(true);expect(walker.position.y).toBeCloseTo(12,3);expect(walker.position.z).toBeGreaterThanOrEqual(170);expect(walker.grounded).toBe(true);
});
it('does not repeatedly restore a walker onto an excavated last shore footing',()=>{
 const world=beach(),walker=new VoxelWalker(world,{x:140,y:12,z:180});
 for(let x=100;x<180;x++)for(let z=130;z<210;z++)world.setVoxel(x,11,z,0,false);
 for(let x=244;x<253;x++)for(let z=160;z<169;z++)world.setVoxel(x,12,z,Material.Road,false);
 let recovered=false;for(let i=0;i<180;i++){walker.update(1/60,{x:0,z:0});recovered ||= walker.recoveredLastStep;}
 expect(recovered).toBe(true);expect(walker.grounded).toBe(true);expect(walker.position.y).toBe(13);expect(walker.position.x).toBeGreaterThan(240);expect(walker.canOccupy(walker.position)).toBe(true);
});
it('keeps a valid low shore exit on the sand instead of snapping onto the helicopter rotor above it',()=>{
 const walker=new VoxelWalker(beach(13),{x:140,y:13,z:180});walker.setObstacleProvider(()=>[{minX:138,maxX:143,minY:16.2,maxY:16.5,minZ:177,maxZ:183}]);
 walker.teleportEye({x:140,y:14.68,z:180});expect(walker.position.y).toBe(13);expect(walker.grounded).toBe(true);expect(walker.canOccupy(walker.position)).toBe(true);
});
it('rides, parks, dismounts and explicitly recovers on flat waterline sand',()=>{
 const {bike,step}=bikeAt();bike.setInput(1);step(150);expect(bike.position.z,JSON.stringify(bike.viewState)).toBeLessThan(174);expect(bike.viewState.blocked).toBe('');
 bike.setInput(0,0,true);step(90);expect(bike.canPark).toBe(true);expect(bike.exitPosition(p=>bike.motor.canOccupy(p))).not.toBeNull();expect(bike.recoverNearby()).toBe(true);
});
it('identifies deep water in front of a bicycle and lets the rider reverse away',()=>{
 const world=beach();for(let x=100;x<180;x++)for(let z=130;z<165;z++){world.setVoxel(x,11,z,0,false);world.setVoxel(x,5,z,Material.Sand,false);}
 const {bike,step}=bikeAt(world);bike.setInput(1);step(240);const edge=bike.position.z;expect(bike.viewState.blocked).toContain('深水');expect(edge).toBeGreaterThan(165);
 bike.setInput(-1);step(150);expect(bike.position.z).toBeGreaterThan(edge+1);expect(bike.viewState.blocked).toBe('');
});
it('recovers a bicycle from the real South Bay seabed beyond the local shore radius',()=>{
 const {world}=generateWorld();addRegionalTerrain(world);const {bike,step}=bikeAt(world);
 bike.position.set(700,regionalHeightAt(700,240)+1,240);const source=bike.position.clone();expect(bike.recoverNearby()).toBe(true);expect(bike.position.y).toBeGreaterThanOrEqual(12);expect(bike.position.distanceTo(source)).toBeGreaterThan(32);
 const start=bike.position.clone();bike.setInput(1);step(120);expect(bike.position.distanceTo(start),JSON.stringify(bike.viewState)).toBeGreaterThan(2);
},20000);
it('allows vaulting both ways onto supported waterline ground while rejecting submerged landings',()=>{
 const world=beach(),walker=new VoxelWalker(world,{x:140,y:12,z:179.4});const rail={minX:130,maxX:150,minY:12,maxY:13.1,minZ:179.94,maxZ:180.06,vaultable:true,standable:false};walker.setObstacleProvider(()=>[rail]);const actions=new GroundActions(walker,()=>[rail],()=>{});
 expect(actions.interaction(Math.PI)?.kind).toBe('vault');
 walker.position.z=180.6;expect(actions.interaction(0)?.kind).toBe('vault');
 for(let x=100;x<180;x++)for(let z=130;z<180;z++)world.setVoxel(x,11,z,0,false);expect(actions.interaction(0)?.kind).not.toBe('vault');
});
async function aircraft(world:VoxelWorld,p={x:140,y:13.46,z:180}){
 const m=new MeshStandardMaterial(),scene=new Scene(),physics=await CollapsePhysics.create(scene,m,{onStateChange:()=>{}});cleanup.push(()=>m.dispose(),()=>physics.dispose());
 const heli=Helicopter.create(scene,physics,world,{onNotice:()=>{}});cleanup.push(()=>heli.dispose());heli.restore({position:p,rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0},engineOn:true,routeIndex:0});
 const camera=new PerspectiveCamera(),step=(n:number)=>{for(let i=0;i<n;i++){heli.beforePhysics(1/60);physics.update(1/60);heli.afterPhysics(1/60,camera);}};return{heli,step};
}
it('does not describe hovering over or submerged in the sea as grounded',async()=>{
 const {heli}=await aircraft(beach(5));expect(heli.viewState.grounded).toBe(false);heli.restore({...heli.snapshot(),position:{x:140,y:3,z:180}});expect(heli.viewState.grounded).toBe(false);
});
it('lets an old deeply submerged aircraft recover to clear air above the sea and keep flying',async()=>{
 const {heli,step}=await aircraft(beach(1),{x:140,y:2.6,z:180});heli.setPiloting(true);expect(heli.recoverNearby()).toBe(true);const p=heli.position.clone();expect(p.y).toBeGreaterThan(15);
 heli.setInput({pitch:1,lift:0});step(120);expect(heli.position.distanceTo(p)).toBeGreaterThan(2);expect(heli.position.y).toBeGreaterThan(15);
});
it('allows exiting a landed helicopter onto dry waterline sand, never onto the seabed',()=>{
 const world=beach(),canStand=(p:{x:number;y:number;z:number})=>new VoxelWalker(world,p).canOccupy(p);
 expect(helicopterExit(world,{x:140,y:13.46,z:180},0,canStand)).not.toBeNull();expect(helicopterExit(beach(5),{x:140,y:6.46,z:180},0,()=>true)).toBeNull();
});
it('feeds the sea the same exact column-top heights as walking, including fresh shoreline excavation',()=>{
 const world=beach(),scene=new Scene(),environment=new Environment(scene);cleanup.push(()=>environment.dispose());environment.setTerrain(world);
 const sea=scene.getObjectByName('coastal-water-surface')! as Mesh<never,ShaderMaterial>,texture=sea.material.uniforms.uTerrain.value;
 const index=140+180*256;expect(texture.image.data[index]).toBe(12);world.setVoxel(140,11,180,0,false);world.setVoxel(140,5,180,Material.Sand,false);environment.setTerrain(world,['4,0,5']);expect(texture.image.data[index]).toBe(6);
});
