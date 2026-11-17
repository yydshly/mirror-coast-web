import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {StreetArt} from '../src/rendering/street-art';
import {NeighborhoodDetail} from '../src/rendering/neighborhood-detail';
import {VoxelWalker} from '../src/input/walk';
import {collectNearbyObstacles,type SceneObstacle} from '../src/input/scene-collisions';

let base:ReturnType<typeof generateWorld>,art:StreetArt,detail:NeighborhoodDetail;
beforeAll(()=>{base=generateWorld();art=new StreetArt(new Scene(),base.world,base.buildings,{people:false});detail=new NeighborhoodDetail(new Scene(),base.world,base.buildings);});
afterAll(()=>{art.dispose();detail.dispose();});
describe('physical facade dressing',()=>{
 it('stops the real walker outside projecting shop shelves and window sills on all four facade directions',async()=>{
  const candidates=art.obstacles.filter(b=>b.minY>16.8&&b.maxY<18&&b.maxY-b.minY<.2&&Math.max(b.maxX-b.minX,b.maxZ-b.minZ)>1.5);
  const groups=[art.obstacles,detail.obstacles],tested=new Set<string>(),report:unknown[]=[];
  for(const b of candidates){
   const axis=b.maxX-b.minX<b.maxZ-b.minZ?'x':'z',other=axis==='x'?'z':'x';
   for(const sign of [-1,1]){
    const id=axis+sign;if(tested.has(id))continue;
    const center={x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2},start={...center,y:16};start[axis]+=sign*3;
    const nearby=collectNearbyObstacles(start,groups,10,6),motor=new VoxelWalker(base.world,start);motor.setObstacleProvider(()=>nearby);motor.position.copy(start);motor.grounded=true;
    let clear=true;for(let d=3;d>=.8;d-=.12){const p={...start};p[axis]=center[axis]+sign*d;if(!motor.canOccupy(p)){clear=false;break;}}
    if(!clear)continue;
    for(let i=0;i<160;i++)motor.update(1/60,{x:axis==='x'?-sign:0,z:axis==='z'?-sign:0});
    const boundary=sign>0?b[axis==='x'?'maxX':'maxZ']:b[axis==='x'?'minX':'minZ'];
    expect(sign*(motor.position[axis]-boundary)).toBeGreaterThanOrEqual(.289);
    expect(Math.abs(motor.position[other]-center[other])).toBeLessThan(.001);expect(motor.canOccupy(motor.position)).toBe(true);
    expect(Math.abs(motor.position[axis]-center[axis])).toBeLessThan(1.1);tested.add(id);report.push({id,bounds:{minX:b.minX,maxX:b.maxX,minY:b.minY,maxY:b.maxY,minZ:b.minZ,maxZ:b.maxZ},start,end:{...motor.position},yaw:axis==='x'?sign*Math.PI/2:sign===1?0:Math.PI});
   }
   if(tested.size===4)break;
  }
  expect([...tested].sort()).toEqual(['x-1','x1','z-1','z1']);
  if((globalThis as {process?:{env?:Record<string,string>}}).process?.env?.MIRROR_SEAT_AUDIT){const moduleName='node:fs',fs=await import(moduleName) as {writeFileSync:(path:string,text:string)=>void};fs.writeFileSync('artifacts/dining-and-facades/facade-audit.json',JSON.stringify(report,null,2));}
 });
 it('removes projecting facade collision as soon as its actual anchor voxels are removed',()=>{
  const b=art.obstacles.find(b=>b.minY>16.8&&b.maxY<18&&b.maxY-b.minY<.2&&b.maxX-b.minX>1.5)!;expect(b).toBeDefined();
  const edits=[];for(let y=16;y<=20;y++)for(let z=Math.floor(b.minZ)-1;z<=Math.ceil(b.maxZ)+1;z++)for(let x=Math.floor(b.minX)-1;x<=Math.ceil(b.maxX)+1;x++)edits.push({x,y,z,material:0});
  const keys=base.world.applyEdits(edits);art.sync(keys);detail.sync(keys);expect(art.obstacles.includes(b)).toBe(false);
 });
 it('keeps high-storey attachments out of ground movement queries while preserving a tall obstruction that crosses the player',()=>{
  const low:SceneObstacle={minX:2,maxX:4,minY:16,maxY:17,minZ:2,maxZ:4},high={...low,minY:35,maxY:36},pole={...low,minY:0,maxY:45};
  expect(collectNearbyObstacles({x:3,y:16,z:3},[[low,high,pole]],16,8)).toEqual([low,pole]);
 });
});
