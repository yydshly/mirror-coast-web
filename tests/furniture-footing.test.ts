import {beforeAll,describe,expect,it} from 'vitest';
import {Scene,InstancedMesh,Matrix4} from 'three';
import {findFurnitureFooting,furnitureFootContacts} from '../src/world/furniture-footing';
import {Material} from '../src/world/palette';
import {VoxelWorld} from '../src/world/voxel';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {RegionArt} from '../src/rendering/region-art';
import {StreetArt} from '../src/rendering/street-art';
import {CoastalArt} from '../src/rendering/coastal-art';
import {BuildingRegistry} from '../src/destruction/buildings';
import {VoxelWalker,WALK_EYE_HEIGHT} from '../src/input/walk';

const legs=furnitureFootContacts([{x:-.69,z:0},{x:.69,z:0}],.035,.215);
let world:VoxelWorld;
beforeAll(()=>{const base=generateWorld();world=base.world;addHarborQuarter(world,base.buildings);addRegionalTerrain(world);addRegionalDistricts(world,base.buildings);});

describe('furniture actually rests on every foot',()=>{
  it('audits every promenade bench and every parked car, bicycle and bin on its complete ground footprint',()=>{
    const coast=new CoastalArt(new Scene(),world,new BuildingRegistry(),{facades:false,headlands:false}),street=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false});
    expect(coast.benchFootings).toHaveLength(6);expect(street.propFootings.filter(f=>f.kind==='car')).toHaveLength(6);
    expect(street.propFootings.filter(f=>f.kind==='bicycle')).toHaveLength(5);expect(street.propFootings.filter(f=>f.kind==='bin')).toHaveLength(6);
    for(const item of [...coast.benchFootings,...street.propFootings])for(const a of item.anchors){expect(world.getVoxel(a.x,a.y,a.z)).not.toBe(0);expect(a.y+1).toBe(item.y);expect(world.getVoxel(a.x,a.y+1,a.z)).toBe(0);}
    coast.dispose();street.dispose();
  });
  it('hides initially unsupported decoration even when its anchor chunk does not exist at all',()=>{
    const empty=new VoxelWorld(),scene=new Scene(),coast=new CoastalArt(scene,empty,new BuildingRegistry(),{facades:false,headlands:false}),street=new StreetArt(scene,empty,new BuildingRegistry(),{people:false}),region=new RegionArt(scene,empty);
    const matrix=new Matrix4();let visibleInstances=0;
    scene.traverse(object=>{if(object instanceof InstancedMesh)for(let i=0;i<object.count;i++){object.getMatrixAt(i,matrix);if(Math.abs(matrix.determinant())>1e-8)visibleInstances++;}});
    expect(visibleInstances).toBe(0);expect([...coast.obstacles,...street.obstacles,...region.obstacles]).toHaveLength(0);
    coast.dispose();street.dispose();region.dispose();
  });
  it('rejects a bench spanning a one-metre drop and finds a flat nearby position',()=>{
    const patch=new VoxelWorld();
    for(let x=12;x<=28;x++)for(let z=12;z<=28;z++)patch.setVoxel(x,x<20?14:15,z,Material.Sand);
    expect(findFurnitureFooting(patch,20,20,0,legs,16)).toBeNull();
    const placed=findFurnitureFooting(patch,20,20,0,legs,16,2)!;
    expect(placed).not.toBeNull();expect(Math.hypot(placed.x-20,placed.z-20)).toBeLessThanOrEqual(3);
    for(const foot of placed.anchors){expect(foot.y+1).toBe(placed.y);expect(patch.getVoxel(foot.x,foot.y,foot.z)).toBe(Material.Sand);}
  });

  it('places all four regional benches, including the southern beach, on supported level feet',()=>{
    const art=new RegionArt(new Scene(),world);
    expect(art.benchFootings).toHaveLength(4);
    for(const bench of art.benchFootings)for(const anchor of bench.anchors){
      expect(world.getVoxel(anchor.x,anchor.y,anchor.z)).not.toBe(0);expect(anchor.y+1).toBe(bench.y);
      expect(world.getVoxel(anchor.x,anchor.y+1,anchor.z)).toBe(0);
    }
    const beach=art.benchFootings.find(b=>b.x>600)!;expect(Math.hypot(beach.x-650,beach.z-151)).toBeLessThan(6);
    art.dispose();
  });

  it('removes the complete bench and its collision when one actual foot loses support',()=>{
    const art=new RegionArt(new Scene(),world),bench=art.benchFootings.find(b=>b.x>600)!;
    const foot=bench.anchors[0],m=world.getVoxel(foot.x,foot.y,foot.z),before=art.obstacles.length;
    world.setVoxel(foot.x,foot.y,foot.z,0);art.sync([`${foot.x>>5},${foot.y>>5},${foot.z>>5}`]);
    expect(art.obstacles.length).toBeLessThan(before);
    world.setVoxel(foot.x,foot.y,foot.z,m);art.dispose();
  });

  it('gives each indoor chair its own floor anchors rather than the table centre',()=>{
    const art=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false});
    const chairs=art.furnitureFootings.filter(f=>f.kind==='chair');expect(chairs).toHaveLength(6);
    for(const chair of chairs)for(const anchor of chair.anchors){
      expect(anchor.y+1).toBe(chair.y);expect(world.getVoxel(anchor.x,anchor.y,anchor.z)).not.toBe(0);
      const actualFeet=new Set([-.1975,-.1425,.1425,.1975].flatMap(dx=>[-.2075,-.1525,.1525,.2075].map(dz=>`${Math.floor(chair.x+dx)},${Math.floor(chair.z+dz)}`)));
      expect(actualFeet.has(`${anchor.x},${anchor.z}`)).toBe(true);
    }
    art.dispose();
  });

  it('supports a character on the actual bench seat instead of an invisible box at backrest height',()=>{
    const art=new RegionArt(new Scene(),world),bench=art.benchFootings.find(b=>b.x>600)!;
    const walker=new VoxelWalker(world,{x:bench.x,y:bench.y,z:bench.z-.8});
    walker.setObstacleProvider(()=>art.obstacles);
    walker.teleportEye({x:bench.x,y:bench.y+.51+WALK_EYE_HEIGHT,z:bench.z-.2});
    for(let frame=0;frame<60;frame++)walker.update(1/60,{x:0,z:0});
    expect(walker.position.y).toBeCloseTo(bench.y+.51,3);expect(walker.grounded).toBe(true);
    art.dispose();
  });

  it('does not regenerate an indoor chair in mid-air above a previously saved hole',()=>{
    const art=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false});
    const chair=art.furnitureFootings.find(f=>f.kind==='chair')!,changed:Array<{x:number;y:number;z:number;material:number}>=[];
    for(const foot of chair.anchors)for(let y=12;y<=foot.y;y++){
      const material=world.getVoxel(foot.x,y,foot.z);if(material){changed.push({x:foot.x,y,z:foot.z,material});world.setVoxel(foot.x,y,foot.z,0);}
    }
    const fresh=new StreetArt(new Scene(),world,new BuildingRegistry(),{people:false});
    expect(fresh.furnitureFootings.some(f=>f.kind==='chair'&&f.x===chair.x&&f.z===chair.z)).toBe(false);
    for(const edit of changed)world.setVoxel(edit.x,edit.y,edit.z,edit.material);
    fresh.dispose();art.dispose();
  });
});
