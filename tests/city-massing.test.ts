import {beforeAll,expect,it} from 'vitest';
import {Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {applyCityMassing} from '../src/world/city-massing';
import {decodeWorldIndex} from '../src/destruction/buildings';
import {StreetArt} from '../src/rendering/street-art';
import {VoxelWalker} from '../src/input/walk';
import {Material} from '../src/world/palette';

let base:ReturnType<typeof generateWorld>,plans:ReturnType<typeof applyCityMassing>,original:Map<number,number>;
beforeAll(()=>{base=generateWorld();original=new Map(base.buildings.all.flatMap(b=>[...b.indices].map(i=>{const p=decodeWorldIndex(i);return[i,base.world.getVoxel(p.x,p.y,p.z)] as const;})));plans=applyCityMassing(base.world,base.buildings);});

it('replaces selected city boxes with coastal terraces, unequal corner wings and a lower pitched warehouse',()=>{
 expect(plans.size).toBeGreaterThanOrEqual(12);expect(new Set([...plans.values()].map(p=>p.kind)).size).toBe(3);
 for(const [id,plan]of plans){
  const b=base.buildings.get(id)!,ground=plan.sections[0];expect(ground.groundFloor).toBe(true);
  expect([ground.x0,ground.x1,ground.z0,ground.z1]).toEqual([b.bounds.minX+1,b.bounds.maxX-1,b.bounds.minZ+1,b.bounds.maxZ-1]);
  if(plan.kind==='coastal-terraces'){expect(plan.sections[1].z1).toBeLessThan(ground.z1-2);expect(plan.sections[1].x1-plan.sections[1].x0).toBeLessThan(ground.x1-ground.x0);}
  if(plan.kind==='dock-warehouse'){expect(ground.height).toBe(6);expect(ground.roof).toBe('gable');}
  for(const index of b.indices){const p=decodeWorldIndex(index);if(p.y===b.foundationY)expect(base.world.getVoxel(p.x,p.y,p.z)).toBe(original.get(index));}
 }
 const wings=[...plans.values()].find(p=>p.kind==='corner-wings'&&p.sections.length===3)!;expect(wings.sections[1].height).toBeGreaterThan(wings.sections[2].height);
});

it('keeps the original ownership footprint so legacy whole-building destruction removes every new solid',()=>{
 for(const [id]of plans){const b=base.buildings.get(id)!;for(let x=b.bounds.minX;x<=b.bounds.maxX;x++)for(let z=b.bounds.minZ;z<=b.bounds.maxZ;z++)for(let y=b.bounds.minY;y<=b.bounds.maxY;y++)if(base.world.getVoxel(x,y,z))expect(base.buildings.findAt(x,y,z)?.id).toBe(id);}
});

it('makes the setback a real walkable terrace with no old upper-wall collision',()=>{
 const scene=new Scene(),art=new StreetArt(scene,base.world,base.buildings,{people:false,massing:plans});
 try{
  const plan=[...plans.values()].find(p=>p.kind==='coastal-terraces'&&p.sections[0].x1-p.sections[0].x0>18)!,s=plan.sections[0];
  const p={x:(s.x0+s.x1+1)/2,y:s.base+s.height+2,z:s.z1-.3};
  const walker=new VoxelWalker(base.world,p);walker.setObstacleProvider(()=>art.obstacles);walker.position.copy(p);walker.grounded=true;
  expect(walker.canOccupy(p)).toBe(true);for(let i=0;i<90;i++)walker.update(1/60,{x:.8,z:0});
  expect(walker.position.y).toBeCloseTo(p.y,2);expect(walker.position.x).toBeGreaterThan(p.x+.5);
 }finally{art.dispose();}
});

it('applies saved edits after the retrofit and does not regrow a previously demolished building on reload',()=>{
 const first=generateWorld(),profile=applyCityMassing(first.world,first.buildings),id=[...profile.keys()][0],b=first.buildings.get(id)!;
 const saved=[...b.indices].map(i=>({...decodeWorldIndex(i),material:Material.Air}));
 first.world.applyEdits(saved);
 const reloaded=generateWorld(),again=applyCityMassing(reloaded.world,reloaded.buildings);reloaded.world.applyEdits(saved);
 expect(again.get(id)).toEqual(profile.get(id));for(const index of b.indices){const p=decodeWorldIndex(index);expect(reloaded.world.getVoxel(p.x,p.y,p.z)).toBe(Material.Air);}
 const paint={x:b.bounds.minX+2,y:b.foundationY+1,z:b.bounds.maxZ-1,material:Material.Brick};
 reloaded.world.applyEdits([paint]);expect(reloaded.world.getVoxel(paint.x,paint.y,paint.z)).toBe(Material.Brick);
});
