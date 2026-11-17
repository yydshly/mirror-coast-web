import {afterEach,describe,expect,it,vi} from 'vitest';
import {Scene,InstancedMesh,Matrix4,Vector3} from 'three';
import {NeighborhoodDetail} from '../src/rendering/neighborhood-detail';
import {BuildingRegistry,worldIndex} from '../src/destruction/buildings';
import {VoxelWorld} from '../src/world/voxel';
import {Material} from '../src/world/palette';
import {VoxelWalker} from '../src/input/walk';

const cleanup:Array<()=>void>=[];
afterEach(()=>cleanup.splice(0).forEach(f=>f()));
function setup(id='city-0'){
  const world=new VoxelWorld(),buildings=new BuildingRegistry(),owned:number[]=[];
  for(let z=4;z<26;z++)for(let x=4;x<26;x++)world.setVoxel(x,15,z,Material.Concrete);
  for(let y=16;y<=22;y++)for(let z=8;z<=16;z++)for(let x=10;x<=19;x++){
    if(x!==10&&x!==19&&z!==8&&z!==16)continue;
    if(z===16&&x>=14&&x<=15&&y<=18)continue;
    const material=z===16&&x>=11&&x<=12&&y>=18&&y<=19?Material.Window:Material.Cream;
    world.setVoxel(x,y,z,material);owned.push(worldIndex(x,y,z));
  }
  for(let x=10;x<=19;x++)for(let z=8;z<=16;z++){world.setVoxel(x,23,z,Material.Roof);owned.push(worldIndex(x,23,z));}
  buildings.add(id,'fixture',15,owned);
  const scene=new Scene(),art=new NeighborhoodDetail(scene,world,buildings);cleanup.push(()=>art.dispose());art.update(0,{x:14,y:18,z:20});
  return{world,buildings,art,scene};
}
describe('grounded, destructible architectural dressing',()=>{
  it('keeps repaired and repacked visible geometry inside its original camera and shadow culling bounds',()=>{
    const {world,art,scene}=setup();art.update(0,{x:700,y:40,z:350});world.setVoxel(11,18,16,0);art.sync(['0,0,0']);world.setVoxel(11,18,16,Material.Window);art.sync(['0,0,0']);art.update(0,{x:14,y:18,z:20});
    let visible=0,overflow=-Infinity;const matrix=new Matrix4(),point=new Vector3();
    for(const mesh of scene.children)if(mesh instanceof InstancedMesh){
      expect(mesh.frustumCulled).toBe(true);expect(mesh.boundingSphere).not.toBeNull();const positions=mesh.geometry.attributes.position;
      for(let i=0;i<mesh.count;i++){visible++;mesh.getMatrixAt(i,matrix);for(let j=0;j<positions.count;j++){point.fromBufferAttribute(positions,j).applyMatrix4(matrix);overflow=Math.max(overflow,point.distanceTo(mesh.boundingSphere!.center)-mesh.boundingSphere!.radius);}}
    }
    expect(visible).toBeGreaterThan(0);expect(overflow).toBeLessThan(.0001);
  });
  it('ignores unrelated edits while restoring visible attachments and collision after a local support repair',()=>{
    const {world,art}=setup(),before=art.diagnostics.visible,bounds=art.obstacles.length,read=vi.spyOn(world,'getVoxel');
    art.sync(['7,0,7']);expect(read).not.toHaveBeenCalled();
    world.setVoxel(11,18,16,0);art.sync(['0,0,0']);expect(art.diagnostics.visible).toBeLessThan(before);expect(art.obstacles.length).toBeLessThan(bounds);
    world.setVoxel(11,18,16,Material.Window);art.sync(['0,0,0']);expect(art.diagnostics.visible).toBe(before);expect(art.obstacles).toHaveLength(bounds);read.mockRestore();
  });
  it('preserves the authoritative voxels, exposes real window detail and supports every pot contact',()=>{
    const {world,buildings,art}=setup();
    const before=[...world.chunks].map(([key,c])=>[key,c.voxels.slice()]as const);
    const fresh=new NeighborhoodDetail(new Scene(),world,buildings);cleanup.push(()=>fresh.dispose());
    expect(fresh.diagnostics.windows).toBe(1);expect(art.diagnostics.visible).toBeGreaterThan(5);
    expect(art.groundFootings).toHaveLength(2);
    for(const f of art.groundFootings)for(const a of f.anchors){expect(a.y+1).toBe(f.y);expect(world.getVoxel(a.x,a.y,a.z)).toBe(a.material);}
    for(const [key,voxels]of before)expect(world.chunks.get(key)!.voxels).toEqual(voxels);
  });
  it('hides window attachments immediately and never regenerates a complete window over a saved hole',()=>{
    const {world,art,buildings}=setup('region-house');const before=art.diagnostics.visible;
    world.setVoxel(11,18,16,0);art.sync(['0,0,0']);
    expect(art.diagnostics.visible).toBeLessThan(before);
    const fresh=new NeighborhoodDetail(new Scene(),world,buildings);cleanup.push(()=>fresh.dispose());
    expect(fresh.diagnostics.windows).toBe(0);
  });
  it('keeps an open doorway walkable while nearby flowerpots and pipework retain physical bounds',()=>{
    const {world,art}=setup(),walker=new VoxelWalker(world,{x:14.5,y:16,z:20});
    walker.setObstacleProvider(()=>art.obstacles);
    for(let i=0;i<180;i++)walker.update(1/60,{x:0,z:-1});
    expect(walker.position.z).toBeLessThan(13);expect(walker.recoveredLastStep).toBe(false);expect(walker.canOccupy(walker.position)).toBe(true);
  });
  it('removes ground props after support loss and keeps their collision independent of visual distance',()=>{
    const {world,art,scene}=setup(),foot=art.groundFootings[0].anchors[0],before=art.obstacles.length;
    art.update(0,{x:700,y:40,z:350});expect(art.diagnostics.visible).toBe(0);expect(art.obstacles).toHaveLength(before);
    const submitted=()=>scene.children.reduce((sum,m)=>sum+(m instanceof InstancedMesh?m.count:0),0);
    expect(submitted()).toBe(0);art.update(0,{x:14,y:18,z:20});expect(submitted()).toBe(art.diagnostics.visible);expect(submitted()).toBeGreaterThan(0);
    world.setVoxel(foot.x,foot.y,foot.z,0);art.sync(['0,0,0']);expect(art.obstacles.length).toBeLessThan(before);
    expect(submitted()).toBe(art.diagnostics.visible);
  });
});
