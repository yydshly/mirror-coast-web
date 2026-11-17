import {it,expect} from 'vitest';
import {ReturnDeparture} from '../src/vehicles/return-flight';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
function finish(plan:ReturnDeparture){for(let i=0;i<3000&&plan.status==='planning';i++)plan.advance(5);return plan;}
it('uses a low clear coastal corridor instead of always climbing to 112 metres',()=>{
 const plan=finish(new ReturnDeparture({x:200,y:18,z:209},new VoxelWorld(),[],0));expect(plan.status).toBe('ready');expect(plan.altitude).toBe(30);
});
it('includes a single distant voxel column and excludes high terrain outside the swept corridor',()=>{
 const world=new VoxelWorld();world.setVoxel(160,70,209,Material.Rock);world.setVoxel(160,94,230,Material.Rock);
 const plan=finish(new ReturnDeparture({x:200,y:18,z:209},world,[],0));expect(plan.status).toBe('ready');expect(plan.altitude).toBe(80);
});
it('includes distant non-voxel scenery in the return skyline even when it is outside the departure radius',()=>{
 const crane={minX:157,maxX:161,minY:15,maxY:67.5,minZ:207,maxZ:211};
 const plan=finish(new ReturnDeparture({x:200,y:18,z:209},new VoxelWorld(),[],0,[crane]));expect(plan.status).toBe('ready');expect(plan.altitude).toBe(76.5);
});
it('keeps an already safe high flight level without adding a new climb on every resume',()=>{
 const plan=finish(new ReturnDeparture({x:200,y:90,z:209},new VoxelWorld(),[],0));expect(plan.status).toBe('ready');expect(plan.altitude).toBe(90);expect(plan.path).toEqual([]);
});
it('holds when a corridor cannot be overflown within the safe altitude limit',()=>{
 const obstacle={minX:157,maxX:161,minY:15,maxY:145,minZ:207,maxZ:211};
 const plan=finish(new ReturnDeparture({x:200,y:18,z:209},new VoxelWorld(),[],0,[obstacle]));expect(plan.status).toBe('blocked');
});
