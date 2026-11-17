import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,type Scene} from 'three';
import {palette,Material as M} from '../world/palette';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
type Column={cx:number;cz:number;keys:string[];detailed:boolean;ready:boolean;start:number;end:number};
type Tile={key:string;mesh:Mesh;columns:Column[];indices:Uint32Array;dirty:boolean};
type Sample={height:number;material:number;side:number};

/** Real four-metre voxels retain the distant skyline, rather than drawing every
 * full-resolution chunk. Only rendering changes: terrain and colliders remain
 * authoritative. Near columns swap together after every vertical mesh is ready. */
export class TerrainPreview{
  private root=new Group();private columns=new Map<string,Column>();private tiles=new Map<string,Tile>();
  private material=new MeshStandardMaterial({vertexColors:true,roughness:1});private samples=new Map<string,Sample>();private clock=Infinity;
  private readyDirty=true;private tilesDirty=false;private lastFocus={x:Infinity,y:Infinity,z:Infinity};private lastDetailDistance=-1;
  constructor(scene:Scene,private world:VoxelWorld){
    this.root.name='coastal-distant-voxels';scene.add(this.root);
    for(const chunk of world.chunks.values()){
      const key=`${chunk.cx},${chunk.cz}`;let c=this.columns.get(key);if(!c){c={cx:chunk.cx,cz:chunk.cz,keys:[],detailed:false,ready:false,start:0,end:0};this.columns.set(key,c);}c.keys.push(chunk.key);
    }
    const groups=new Map<string,Column[]>();for(const c of this.columns.values()){const key=`${Math.floor(c.cx/4)},${Math.floor(c.cz/4)}`;const list=groups.get(key);if(list)list.push(c);else groups.set(key,[c]);}
    for(const [key,columns]of groups){const tile:Tile={key,columns,mesh:new Mesh(new BufferGeometry(),this.material),indices:new Uint32Array(),dirty:false};tile.mesh.name='distant-voxel-sector';tile.mesh.matrixAutoUpdate=false;tile.mesh.receiveShadow=true;this.root.add(tile.mesh);this.tiles.set(key,tile);this.rebuild(tile);}
  }
  private sample(x:number,z:number):Sample{
    const key=`${x},${z}`,old=this.samples.get(key);if(old)return old;
    const c=this.columns.get(`${x>>5},${z>>5}`);let best:Sample={height:0,material:0,side:0};
    if(c){const top=Math.max(...c.keys.map(k=>Number(k.split(',')[1])))*32+31;
      for(const dx of [1,3])for(const dz of [1,3])for(let y=top;y>=0;y--){const m=this.world.getVoxel(x+dx,y,z+dz);if(!m)continue;
        if(y+1>best.height){const under=this.world.getVoxel(x+dx,Math.max(0,y-3),z+dz);best={height:y+1,material:m,side:m===M.Roof||m===M.Terracotta?(under&&under!==M.Roof&&under!==M.Terracotta?under:M.Cream):m};}break;
      }
    }
    this.samples.set(key,best);return best;
  }
  private rebuild(tile:Tile):void{
    const positions:number[]=[],colors:number[]=[],indices:number[]=[];
    const quad=(points:number[][],material:number)=>{const color=palette[material]?.color??palette[M.Rock].color,base=positions.length/3;for(const p of points){positions.push(...p);colors.push(...color);}indices.push(base,base+1,base+2,base,base+2,base+3);};
    for(const c of tile.columns){c.start=indices.length;
      for(let z=c.cz*32;z<(c.cz+1)*32;z+=4)for(let x=c.cx*32;x<(c.cx+1)*32;x+=4){const s=this.sample(x,z),h=s.height;if(h<=12)continue;
        quad([[x,h,z],[x,h,z+4],[x+4,h,z+4],[x+4,h,z]],s.material);
        // Skirts at 32m column borders close height differences at LOD joins.
        const left=x%32===0?0:this.sample(x-4,z).height,right=(x+4)%32===0?0:this.sample(x+4,z).height;
        const back=z%32===0?0:this.sample(x,z-4).height,front=(z+4)%32===0?0:this.sample(x,z+4).height;
        if(h>left)quad([[x,left,z],[x,left,z+4],[x,h,z+4],[x,h,z]],s.side);
        if(h>right)quad([[x+4,right,z+4],[x+4,right,z],[x+4,h,z],[x+4,h,z+4]],s.side);
        if(h>back)quad([[x+4,back,z],[x,back,z],[x,h,z],[x+4,h,z]],s.side);
        if(h>front)quad([[x,front,z+4],[x+4,front,z+4],[x+4,h,z+4],[x,h,z+4]],s.side);
      }c.end=indices.length;
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();tile.indices=new Uint32Array(indices);
    tile.mesh.geometry.dispose();tile.mesh.geometry=geometry;tile.dirty=false;
    for(const c of tile.columns)if(c.detailed&&c.ready)geometry.index!.array.fill(0,c.start,c.end);
  }
  hideColumnWhenReady(cx:number,cz:number,_world:VoxelWorld,_ready:(key:string)=>boolean){
    // Far mesh completion cannot affect the current picture. Reconsider it
    // when approaching; nearby completion must reveal the column immediately.
    if(this.columns.get(`${cx},${cz}`)?.detailed){this.readyDirty=true;this.clock=Infinity;}
  }
  invalidate(keys:Iterable<string>):void{
    for(const key of keys){const [cx,,cz]=key.split(',').map(Number);
      for(let z=cz*32-4;z<cz*32+36;z+=4)for(let x=cx*32-4;x<cx*32+36;x+=4)this.samples.delete(`${x},${z}`);
      for(const dx of [-1,0,1])for(const dz of [-1,0,1]){const t=this.tiles.get(`${Math.floor((cx+dx)/4)},${Math.floor((cz+dz)/4)}`);if(t)t.dirty=true;}
    }this.clock=Infinity;this.readyDirty=true;this.tilesDirty=true;
  }
  update(dt:number,focus:Vector3Like,ready:(key:string)=>boolean,meshAt:(key:string)=>Mesh|undefined,detailDistance=320):void{
    this.clock+=dt;if(this.clock<.15)return;this.clock=0;
    // Four metres is well inside the existing 16m LOD hysteresis. Camera yaw
    // alone does not change distance LOD, and must not scan every world column.
    const moved=(focus.x-this.lastFocus.x)**2+(focus.y-this.lastFocus.y)**2+(focus.z-this.lastFocus.z)**2>=16;
    if(!moved&&!this.readyDirty&&!this.tilesDirty&&detailDistance===this.lastDetailDistance)return;
    const dirty=[...this.tiles.values()].find(t=>t.dirty);if(dirty)this.rebuild(dirty);
    this.tilesDirty=[...this.tiles.values()].some(t=>t.dirty);this.readyDirty=false;this.lastFocus={...focus};this.lastDetailDistance=detailDistance;
    const range=Math.max(144,detailDistance-focus.y*.5);
    for(const tile of this.tiles.values()){
      const index=tile.mesh.geometry.index!;let changed=false,allDetailed=true;
      for(const c of tile.columns){const distance=Math.hypot(c.cx*32+16-focus.x,c.cz*32+16-focus.z),near=distance<range+(c.detailed?16:-16),current=c.keys.every(ready),detailed=near&&current;
        // A far column becoming ready does not change a single visible index.
        // Only upload the columns that actually switch near/far representation.
        if(detailed!==(c.detailed&&c.ready)){
          if(detailed)index.array.fill(0,c.start,c.end);else index.array.set(tile.indices.subarray(c.start,c.end),c.start);
          index.addUpdateRange(c.start,c.end-c.start);changed=true;
        }
        c.detailed=near;c.ready=current;
        for(const key of c.keys){const mesh=meshAt(key);if(mesh)mesh.visible=detailed;}
        if(!detailed)allDetailed=false;
      }
      if(changed)index.needsUpdate=true;tile.mesh.visible=!allDetailed;
    }
  }
  get diagnostics(){return{sectors:this.tiles.size,columns:this.columns.size,detailed:[...this.columns.values()].filter(c=>c.detailed&&c.ready).length,dirty:[...this.tiles.values()].filter(t=>t.dirty).length};}
  dispose(){this.root.removeFromParent();for(const t of this.tiles.values())t.mesh.geometry.dispose();this.material.dispose();}
}
