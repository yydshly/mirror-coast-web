import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {InstancedMesh,Matrix4,Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {addExplorationSites,EXPLORATION_SITES} from '../src/world/exploration-sites';
import {VoxelWalker} from '../src/input/walk';
import {analyzeStructure,createStructureInput} from '../src/destruction/structure';
import type {VoxelWorld} from '../src/world/voxel';
import type {BuildingRegistry} from '../src/destruction/buildings';
import {ExplorationArt} from '../src/exploration/exploration-art';
import {WalkTransitions} from '../src/rendering/walk-transitions';

let world:VoxelWorld,buildings:BuildingRegistry,before:Map<string,Uint8Array>,ids:string[];
let transitions:WalkTransitions;
const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).forEach(dispose=>dispose()));
beforeAll(()=>{
 const generated=generateWorld();world=generated.world;buildings=generated.buildings;
 addHarborQuarter(world,buildings);addRegionalTerrain(world);addRegionalDistricts(world,buildings);
 before=new Map([...world.chunks].map(([key,chunk])=>[key,chunk.voxels.slice()]));
 ids=addExplorationSites(world,buildings).buildingIds;
 transitions=new WalkTransitions(new Scene(),world);
});
afterAll(()=>transitions.dispose());
describe('additive coastal exploration destinations',()=>{
 it('does not overwrite any existing occupied cell or old-city air',()=>{
   const changed:string[]=[];
   for(const[key,original]of before){const current=world.chunks.get(key)!.voxels;
    const[cx,,cz]=key.split(',').map(Number),core=cx>=0&&cx<8&&cz>=0&&cz<8;
    for(let i=0;i<original.length;i++)if((original[i]||core)&&original[i]!==current[i]){changed.push(`${key}:${i}`);break;}
   }
   expect(changed).toEqual([]);expect(ids).toHaveLength(4);
 });
 it('starts all new registered landmarks fully supported',()=>{
  const unstable:string[]=[];
  for(const id of ids){const result=analyzeStructure(createStructureInput(world,buildings.get(id)!,'exploration-baseline'));if(result.edits.length)unstable.push(`${id}:${result.edits.length}`);}
  expect(unstable).toEqual([]);
 });
 for(const site of EXPLORATION_SITES)it(`can actually walk to ${site.id} and see its intact interaction device`,()=>{
   const art=new ExplorationArt(new Scene(),world);cleanup.push(()=>art.dispose());
   const walker=new VoxelWalker(world,{x:site.approach.x,y:site.approach.y-1.68,z:site.approach.z});
   walker.setObstacleProvider(()=>[...art.obstacles,...transitions.nearby(walker.position)]);
   let recoveries=0;
   for(const point of site.route.slice(1)){
     let reached=false;
     for(let frame=0;frame<60*45;frame++){
       const dx=point.x-walker.position.x,dz=point.z-walker.position.z,d=Math.hypot(dx,dz);
       if(d<.40){reached=true;break;}
       walker.update(1/60,{x:dx/d,z:dz/d});if(walker.recoveredLastStep)recoveries++;
     }
     expect(reached,`${site.id}: stuck at ${JSON.stringify(walker.position)} towards ${JSON.stringify(point)}`).toBe(true);
   }
   for(let i=0;i<60;i++)walker.update(1/60,{x:0,z:0});
   expect(recoveries).toBe(0);expect(walker.grounded).toBe(true);expect(walker.canOccupy(walker.position)).toBe(true);
   const eye=walker.eyePosition,dx=site.position.x-eye.x,dy=site.position.y-eye.y,dz=site.position.z-eye.z,distance=Math.hypot(dx,dy,dz);
   expect(distance).toBeLessThan(3.8);
   const hit=world.raycast(eye,{x:dx/distance,y:dy/distance,z:dz/distance},distance-.05);
   expect(hit,`${site.id} blocked device sightline`).toBeNull();
   expect(site.anchors.every(p=>world.getVoxel(p.x,p.y,p.z))).toBe(true);
   if(site.id==='cape-signal')for(const point of [...site.route].reverse().slice(1)){
     let reached=false;
     for(let frame=0;frame<60*20;frame++){
       const dx=point.x-walker.position.x,dz=point.z-walker.position.z,d=Math.hypot(dx,dz);
       if(d<.4){reached=true;break;}
       walker.update(1/60,{x:dx/d,z:dz/d});
     }
     expect(reached,`cape return: stuck at ${JSON.stringify(walker.position)} towards ${JSON.stringify(point)}`).toBe(true);
   }
 });
 it('opens the rescue box and visibly powers the radio and cape beacon only after discoveries',()=>{
   const scene=new Scene(),art=new ExplorationArt(scene,world);cleanup.push(()=>art.dispose());
   expect(scene.getObjectByName('cape-signal-lamp')!.visible).toBe(false);
   expect(scene.getObjectByName('radio-signal-indicator')!.visible).toBe(false);
   expect(scene.getObjectByName('rescue-box-lid')!.rotation.x).toBe(0);
   art.setCompleted(EXPLORATION_SITES.map(site=>site.id));art.update(.1,1);
   expect(scene.getObjectByName('cape-signal-lamp')!.visible).toBe(true);
   expect(scene.getObjectByName('radio-signal-indicator')!.visible).toBe(true);
   expect(scene.getObjectByName('rescue-box-lid')!.rotation.x).toBeGreaterThan(1);
   expect(scene.children.filter(node=>node.type.endsWith('Light'))).toHaveLength(0);
 });
 it('removes a destroyed device and its collision bounds instead of leaving floating interactive props',()=>{
   const scene=new Scene(),art=new ExplorationArt(scene,world);cleanup.push(()=>art.dispose());
   const anchor=EXPLORATION_SITES[1].anchors[0],material=world.getVoxel(anchor.x,anchor.y,anchor.z),originalBounds=art.obstacles.length;
   world.setVoxel(anchor.x,anchor.y,anchor.z,0);art.sync([]);
   expect(scene.getObjectByName('exploration-device-tidal-rescue')!.visible).toBe(false);
   expect(art.obstacles.length).toBeLessThan(originalBounds);
   world.setVoxel(anchor.x,anchor.y,anchor.z,material);art.sync([]);
   expect(scene.getObjectByName('exploration-device-tidal-rescue')!.visible).toBe(true);
 });
 it('removes field equipment and individual plank seams when their actual support is destroyed',()=>{
   const scene=new Scene(),art=new ExplorationArt(scene,world);cleanup.push(()=>art.dispose());
   const battery=scene.getObjectByName('radio-field-battery')!,planks=scene.getObjectByName('exploration-board-plank-seams') as InstancedMesh;
   const anchors=[{x:-64,y:65,z:-226},{x:657,y:14,z:150}];
   const original=anchors.map(p=>world.getVoxel(p.x,p.y,p.z)),matrix=new Matrix4();
   expect(battery.visible).toBe(true);planks.getMatrixAt(0,matrix);expect(matrix.elements[0]).toBeGreaterThan(2);
   anchors.forEach(p=>world.setVoxel(p.x,p.y,p.z,0));art.sync([]);
   expect(battery.visible).toBe(false);planks.getMatrixAt(0,matrix);expect(matrix.elements[0]).toBe(0);
   anchors.forEach((p,i)=>world.setVoxel(p.x,p.y,p.z,original[i]));art.sync([]);
   expect(battery.visible).toBe(true);planks.getMatrixAt(0,matrix);expect(matrix.elements[0]).toBeGreaterThan(2);
 });
});
