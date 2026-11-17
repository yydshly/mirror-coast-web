import {describe,it,expect} from 'vitest';
import {Scene,PerspectiveCamera} from 'three';
import {VoxelWorld} from '../src/world/voxel';
import {WetStreets} from '../src/rendering/wet-streets';
import {AdaptiveResolution} from '../src/rendering/adaptive-resolution';
describe('route render workload',()=>{
 it('does not scan 36,864 reflection cells on dry road crossings, but refreshes when rain becomes visible',()=>{
  const world=new VoxelWorld();let surfaceQueries=0;for(let x=0;x<256;x++)for(let z=0;z<256;z++)world.setVoxel(x,15,z,5,false);
  const wet={value:0},w=new WetStreets(new Scene(),world,wet,()=>{surfaceQueries++;return 16;}),c=new PerspectiveCamera();c.position.set(100,18,100);
  w.update(.016,c);c.position.x+=48;w.update(.016,c);expect(surfaceQueries).toBe(2);
  wet.value=1;w.update(.016,c);expect(surfaceQueries).toBeGreaterThan(30000);const count=surfaceQueries;w.update(.016,c);expect(surfaceQueries).toBe(count+1);
  wet.value=0;w.sync();w.update(.016,c);expect(surfaceQueries).toBe(count+2);wet.value=1;w.update(.016,c);expect(surfaceQueries).toBeGreaterThan(count+30000);w.dispose();
 });
 it('keeps CPU-bound scenes and loading hitches sharp, reducing only sustained GPU-bound resolution within a safe floor',()=>{
  const cpu=new AdaptiveResolution();for(let i=0;i<600;i++)cpu.update(.04,3,30);expect(cpu.scale).toBe(1);
  const gpu=new AdaptiveResolution();for(let i=0;i<700;i++)gpu.update(.04,28,5);expect(gpu.scale).toBe(.8);
  for(let i=0;i<100;i++)gpu.update(1,50,5);expect(gpu.scale).toBe(.8);
  for(let i=0;i<100;i++)gpu.update(.04,28,5,false);expect(gpu.scale).toBe(.8);
  for(let i=0;i<2400;i++)gpu.update(1/60,5,5);expect(gpu.scale).toBe(1);
 });
 it('can recover from sustained severe GPU slowdown instead of ignoring every slow frame forever',()=>{
  const q=new AdaptiveResolution();for(let i=0;i<80;i++)q.update(.2,160,5);expect(q.scale).toBe(.8);
 });
});
