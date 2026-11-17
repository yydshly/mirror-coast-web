import {afterAll,beforeAll,expect,it} from 'vitest';
import {InstancedMesh,Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {StreetArt} from '../src/rendering/street-art';
import {Material} from '../src/world/palette';
import {VoxelWalker} from '../src/input/walk';

let generated:ReturnType<typeof generateWorld>,art:StreetArt,scene:Scene,revisions:number[];
beforeAll(()=>{generated=generateWorld();revisions=[...generated.world.chunks.values()].map(c=>c.revision);scene=new Scene();art=new StreetArt(scene,generated.world,generated.buildings,{people:false});});
afterAll(()=>art.dispose());
it('adds walkable roof silhouettes in instanced geometry while preserving the authoritative voxel world',()=>{
 expect([...generated.world.chunks.values()].map(c=>c.revision)).toEqual(revisions);
 const crowns=art.obstacles.filter(b=>b.standable&&b.minY>25&&b.maxX-b.minX>4&&b.maxZ-b.minZ>4);
 expect(crowns.length).toBeGreaterThan(25);
 const roof=crowns.reduce((a,b)=>a.maxY>b.maxY?a:b),p={x:(roof.minX+roof.maxX)/2,y:roof.maxY,z:(roof.minZ+roof.maxZ)/2},walker=new VoxelWalker(generated.world,p);walker.setObstacleProvider(()=>art.obstacles);walker.position.copy(p);walker.grounded=true;
 for(let i=0;i<90;i++)walker.update(1/60,{x:0,z:0});expect(walker.position.y).toBeCloseTo(roof.maxY,3);expect(walker.canOccupy(walker.position)).toBe(true);
 const root=scene.getObjectByName('street-life-and-architectural-character')!;
 expect(root.children.filter(c=>c instanceof InstancedMesh).length).toBeLessThan(200);
});
it('removes the actual new roof colliders when their voxel support is destroyed',()=>{
 const building=generated.buildings.all.find(b=>b.id==='city-building-001')!,b=building.bounds;
 const crowns=art.obstacles.filter(o=>o.standable&&o.minX>=b.minX&&o.maxX<=b.maxX+1&&o.minZ>=b.minZ&&o.maxZ<=b.maxZ+1&&o.minY>b.maxY-4&&o.maxX-o.minX>4&&o.maxZ-o.minZ>4);expect(crowns.length).toBeGreaterThan(0);
 const edits=[];for(let x=b.minX;x<=b.maxX;x++)for(let z=b.minZ;z<=b.maxZ;z++)for(let y=b.maxY-5;y<=b.maxY;y++)edits.push({x,y,z,material:Material.Air});
 art.sync(generated.world.applyEdits(edits));for(const roof of crowns)expect(art.obstacles.includes(roof)).toBe(false);
});
it('exposes a centre blast through a roof addition and keeps it exposed when rebuilt from the save',()=>{
 const base=generateWorld(),initial=new StreetArt(new Scene(),base.world,base.buildings,{people:false});
 const building=base.buildings.all.find(b=>b.id==='city-building-028')!,b=building.bounds;
 const crowns=initial.obstacles.filter(o=>o.standable&&o.minX>b.minX&&o.maxX<b.maxX+1&&o.minZ>b.minZ&&o.maxZ<b.maxZ+1&&o.minY>b.maxY-4&&o.maxX-o.minX>4&&o.maxZ-o.minZ>4);
 expect(crowns.length).toBeGreaterThan(0);
 const roof=crowns[0],x=Math.floor((roof.minX+roof.maxX)/2),z=Math.floor((roof.minZ+roof.maxZ)/2);
 let y=Math.floor(roof.minY)-1;while(y>b.minY&&!base.world.getVoxel(x,y,z))y--;
 initial.sync(base.world.applyEdits([{x,y,z,material:Material.Air}]));
 for(const crown of crowns)expect(initial.obstacles.includes(crown)).toBe(false);
 initial.dispose();const rebuilt=new StreetArt(new Scene(),base.world,base.buildings,{people:false});
 try{for(const crown of crowns)expect(rebuilt.obstacles.some(o=>o.minX===crown.minX&&o.minY===crown.minY&&o.minZ===crown.minZ&&o.maxX===crown.maxX&&o.maxY===crown.maxY&&o.maxZ===crown.maxZ)).toBe(false);}finally{rebuilt.dispose();}
});
it.each([Material.Air,Material.Brick])('does not cover a saved floor-band edit of material %i with new plaster',material=>{
 const base=generateWorld(),first=new StreetArt(new Scene(),base.world,base.buildings,{people:false});
 const isCoat=(p:ReturnType<StreetArt['decorationParts']>[number])=>!Array.isArray(p.material)&&p.material.name==='facade-plaster-coat';
 const original=first.decorationParts().find(isCoat)!;expect(original).toBeDefined();const anchor=original.anchors[0];base.world.setVoxel(anchor.x,anchor.y,anchor.z,material);first.dispose();
 const rebuilt=new StreetArt(new Scene(),base.world,base.buildings,{people:false});try{expect(rebuilt.decorationParts().filter(isCoat).some(p=>p.matrix.equals(original.matrix))).toBe(false);expect(base.world.getVoxel(anchor.x,anchor.y,anchor.z)).toBe(material);}finally{rebuilt.dispose();}
});
