import type { VoxelEdit } from '../world/voxel';
import type {VoxelWorld} from '../world/voxel';
import {Material} from '../world/palette';

export type FoundationFooting={root:number;supports:number[]};

export type BuildingBounds = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};

export type BuildingRecord = {
  id: string;
  name: string;
  foundationY: number;
  bounds: BuildingBounds;
  /** Sorted original occupied voxel positions; current material is read from the world. */
  indices: Uint32Array;
  footings?:FoundationFooting[];
};

/** Ownership indices are transient, independent of each world's playable bounds. */
export const WORLD_INDEX_STRIDE = 2048;
export const WORLD_INDEX_OFFSET = 512;
export const worldIndex = (x: number, y: number, z: number): number => x + WORLD_INDEX_OFFSET + WORLD_INDEX_STRIDE * (z + WORLD_INDEX_OFFSET + WORLD_INDEX_STRIDE * y);
export function decodeWorldIndex(index: number): { x: number; y: number; z: number } {
  return { x: index % WORLD_INDEX_STRIDE - WORLD_INDEX_OFFSET, y: Math.floor(index / (WORLD_INDEX_STRIDE * WORLD_INDEX_STRIDE)), z: Math.floor(index / WORLD_INDEX_STRIDE) % WORLD_INDEX_STRIDE - WORLD_INDEX_OFFSET };
}

export class BuildingRegistry {
  readonly all: BuildingRecord[] = [];
  private readonly records = new Map<string, BuildingRecord>();
  private readonly spatial=new Map<string,Set<BuildingRecord>>();
  private readonly groundOwners=new Map<number,Set<BuildingRecord>>();

  /** Capture before applying saved edits. This is metadata, never terrain repair. */
  captureFoundations(world:VoxelWorld):void{
    for(const building of this.all){
      if(building.footings)continue;
      building.footings=captureFoundationFootings(world,building);
      for(const footing of building.footings)for(const index of footing.supports){
        let owners=this.groundOwners.get(index);if(!owners){owners=new Set();this.groundOwners.set(index,owners);}owners.add(building);
      }
    }
  }

  add(id: string, name: string, foundationY: number, positions: Iterable<number>): BuildingRecord {
    if (this.records.has(id)) throw new Error(`Duplicate building ID: ${id}`);
    const values = [...new Set(positions)].sort((a, b) => a - b);
    if (!values.length) throw new Error('A registered building needs occupied voxels.');
    const bounds: BuildingBounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const value of values) {
      const cell = decodeWorldIndex(value);
      bounds.minX = Math.min(bounds.minX, cell.x); bounds.maxX = Math.max(bounds.maxX, cell.x);
      bounds.minY = Math.min(bounds.minY, cell.y); bounds.maxY = Math.max(bounds.maxY, cell.y);
      bounds.minZ = Math.min(bounds.minZ, cell.z); bounds.maxZ = Math.max(bounds.maxZ, cell.z);
    }
    const record = { id, name, foundationY, bounds, indices: new Uint32Array(values) };
    this.all.push(record); this.records.set(id, record);
    for(let x=bounds.minX>>5;x<=bounds.maxX>>5;x++)for(let z=bounds.minZ>>5;z<=bounds.maxZ>>5;z++){const key=`${x},${z}`;let bucket=this.spatial.get(key);if(!bucket){bucket=new Set();this.spatial.set(key,bucket);}bucket.add(record);}
    return record;
  }

  get(id: string): BuildingRecord | undefined { return this.records.get(id); }

  findAt(x: number, y: number, z: number): BuildingRecord | undefined {
    const index = worldIndex(x, y, z);
    for (const building of this.spatial.get(`${x>>5},${z>>5}`)??[]) {
      const b = building.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ || z > b.maxZ) continue;
      let low = 0;
      let high = building.indices.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const value = building.indices[middle];
        if (value === index) return building;
        if (value < index) low = middle + 1;
        else high = middle - 1;
      }
    }
    return undefined;
  }

  affectedBy(edits: Iterable<Pick<VoxelEdit, 'x' | 'y' | 'z'>>): BuildingRecord[] {
    const affected = new Set<BuildingRecord>();
    for (const edit of edits) {
      const building = this.findAt(edit.x, edit.y, edit.z);
      if (building) affected.add(building);
      for(const owner of this.groundOwners.get(worldIndex(edit.x,edit.y,edit.z))??[])affected.add(owner);
    }
    return [...affected];
  }
}

export function captureFoundationFootings(world:VoxelWorld,building:BuildingRecord):FoundationFooting[]{
  const columns=new Map<string,number>(),footings:FoundationFooting[]=[];
  for(const index of building.indices){const p=decodeWorldIndex(index),key=`${p.x},${p.z}`,old=columns.get(key);if(old===undefined||index<old)columns.set(key,index);}
  const terrain=new Set<number>([Material.Rock,Material.Dirt,Material.Grass,Material.Sand,Material.Road,Material.Stripe,Material.Concrete]);
  for(const root of columns.values()){
    const p=decodeWorldIndex(root);if(p.y===0){footings.push({root,supports:[]});continue;}
    if(!world.getVoxel(p.x,p.y-1,p.z))continue;
    const supports:number[]=[];
    // Natural bearing columns include their actual load path. A cave newly dug
    // below a thin ground cap cannot leave the cap acting as an infinite anchor.
    for(let y=p.y-1;y>=0;y--){
      const material=world.getVoxel(p.x,y,p.z);if(!material)break;
      supports.push(worldIndex(p.x,y,p.z));if(!terrain.has(material))break;
    }
    footings.push({root,supports});
  }
  // Raised decks and coastal towers can be founded through a lateral plinth.
  // Record the actual finite bridge-to-ground path, not a permanent root.
  if(!footings.length){
    const owned=new Set(building.indices),seenRoots=new Set<number>();
    for(const root of building.indices){
      const p=decodeWorldIndex(root);if(p.y>building.foundationY+6)continue;
      for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const start=worldIndex(p.x+dx,p.y,p.z+dz);if(owned.has(start)||!world.getVoxel(p.x+dx,p.y,p.z+dz)||seenRoots.has(root))continue;
        const queue=[start],parent=new Map<number,number|null>([[start,null]]);let path:number[]|undefined;
        for(let cursor=0;cursor<queue.length&&cursor<8192&&!path;cursor++){
          const index=queue[cursor],cell=decodeWorldIndex(index),down:number[]=[];let grounded=true;
          for(let y=cell.y;y>=0;y--){const i=worldIndex(cell.x,y,cell.z);if(owned.has(i)||!world.getVoxel(cell.x,y,cell.z)){grounded=false;break;}down.push(i);}
          if(grounded){path=down;let i:number|null=index;while(i!==null){path.push(i);i=parent.get(i)??null;}break;}
          for(const [ox,oy,oz]of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0],[0,1,0]]){
            const x=cell.x+ox,y=cell.y+oy,z=cell.z+oz;if(y<0||y>building.foundationY+6||Math.abs(x-p.x)>64||Math.abs(z-p.z)>64)continue;
            const next=worldIndex(x,y,z);if(owned.has(next)||parent.has(next)||!world.getVoxel(x,y,z))continue;parent.set(next,index);queue.push(next);
          }
        }
        if(path){footings.push({root,supports:[...new Set(path)]});seenRoots.add(root);}
      }
    }
  }
  return footings;
}
