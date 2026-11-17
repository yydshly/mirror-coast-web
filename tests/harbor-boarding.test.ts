import {afterEach,describe,it,expect} from 'vitest';
import {Box3,Group} from 'three';
import {generateWorld} from '../src/world/generate';
import {MooredSailboats,HARBOR_MOORINGS} from '../src/rendering/moored-boats';
import {VoxelWalker,WALK_EYE_HEIGHT} from '../src/input/walk';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).forEach(f=>f()));
function setup(){const {world}=generateWorld(),root=new Group(),boats=new MooredSailboats(root,world);cleanup.push(()=>boats.dispose());return{world,root,boats};}

describe('real harbor boats and boarding',()=>{
 it.each(HARBOR_MOORINGS)('walks down the actual gangway onto $id and returns to the dock',m=>{
  const {world,boats}=setup(),walker=new VoxelWalker(world,{x:m.dockX,y:15,z:m.accessZ});walker.setObstacleProvider(()=>boats.obstacles);const direction=Math.sign(m.x-m.dockX);
  let recovery=false;for(let i=0;i<180;i++){boats.update(1/60);walker.update(1/60,{x:direction,z:0});recovery||=walker.recoveredLastStep;if(Math.abs(walker.position.x-m.x)<.15)break;}
  for(let i=0;i<30;i++){boats.update(1/60);walker.update(1/60,{x:0,z:0});recovery||=walker.recoveredLastStep;}
  expect(recovery).toBe(false);expect(Math.abs(walker.position.x-m.x)).toBeLessThan(.6);expect(walker.position.y).toBeLessThan(13.2);expect(walker.grounded).toBe(true);
  for(let i=0;i<180;i++){boats.update(1/60);walker.update(1/60,{x:-direction,z:0});recovery||=walker.recoveredLastStep;if(Math.abs(walker.position.x-m.dockX)<.15)break;}
  expect(recovery).toBe(false);expect(Math.abs(walker.position.x-m.dockX)).toBeLessThan(.35);expect(walker.position.y).toBeCloseTo(15,3);
 });
 it('jumps from the dock onto the real deck, stays on its heave and reloads a standing pose without falling through',()=>{
  const {world,boats,root}=setup(),m=HARBOR_MOORINGS[0],walker=new VoxelWalker(world,{x:95.6,y:15,z:209.2});walker.setObstacleProvider(()=>boats.obstacles);let landed=false,air=false,recovered=false;
  for(let i=0;i<90;i++){boats.update(1/60);walker.update(1/60,{x:-1,z:0,run:true,jump:i===0});air||=!walker.grounded;recovered||=walker.recoveredLastStep;if(air&&walker.grounded&&walker.position.y<13.3){landed=true;break;}}
  expect(landed,JSON.stringify(walker.position)).toBe(true);expect(recovered).toBe(false);
  for(let i=0;i<600;i++){boats.update(1/60);walker.update(1/60,{x:0,z:0});expect(walker.recoveredLastStep).toBe(false);expect(walker.position.y).toBeCloseTo(boats.diagnostics[0].deck,3);}
  const eye=walker.eyePosition;walker.teleportEye(eye);for(let i=0;i<60;i++){boats.update(1/60);walker.update(1/60,{x:0,z:0});expect(walker.recoveredLastStep).toBe(false);}
  expect(walker.position.y+WALK_EYE_HEIGHT).toBeCloseTo(walker.eyePosition.y,4);
  root.updateMatrixWorld(true);expect(new Box3().setFromObject(root.getObjectByName(m.id)!).min.y).toBeLessThan(12);
 });
 it('does not leave a gangway collision floating after its dock anchorage is destroyed',()=>{
  const {world,boats,root}=setup(),m=HARBOR_MOORINGS[0];world.setVoxel(Math.floor(m.dockX),14,Math.floor(m.accessZ),0);boats.sync();expect(root.getObjectByName(`${m.id}-gangway`)!.visible).toBe(false);expect(boats.diagnostics).toHaveLength(2);
 });
 it.each(HARBOR_MOORINGS)('can enter the return steps from the foredeck of $id without finding a precise point',m=>{
  const {world,boats}=setup(),walker=new VoxelWalker(world,{x:m.x+.25,y:12.9,z:m.accessZ-1.1});walker.setObstacleProvider(()=>boats.obstacles);walker.teleportEye({x:m.x+.25,y:14.6,z:m.accessZ-1.1});
  for(let i=0;i<60;i++){boats.update(1/60);walker.update(1/60,{x:0,z:1});expect(walker.recoveredLastStep).toBe(false);if(walker.position.z>=m.accessZ-.12)break;}
  for(let i=0;i<20;i++){boats.update(1/60);walker.update(1/60,{x:0,z:0});}
  expect(Math.abs(walker.position.z-m.accessZ)).toBeLessThan(.3);
  for(let i=0;i<120;i++){boats.update(1/60);walker.update(1/60,{x:Math.sign(m.dockX-m.x),z:0});expect(walker.recoveredLastStep).toBe(false);if(Math.abs(walker.position.x-m.dockX)<.12)break;}
  expect(walker.position.y).toBeCloseTo(15,3);
 });
});
