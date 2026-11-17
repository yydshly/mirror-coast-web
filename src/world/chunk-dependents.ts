import type {Vector3Like} from './voxel';

/** Reverse lookup for immutable decoration anchors. Edits query dependents,
 * rather than scanning every window, road cap and furniture part in the world. */
export class ChunkDependents<T>{
  private readonly chunks=new Map<string,Set<T>>();
  add(value:T,cells:Iterable<Vector3Like>):void{
    for(const p of cells){
      const key=`${p.x>>5},${p.y>>5},${p.z>>5}`;
      let values=this.chunks.get(key);if(!values){values=new Set();this.chunks.set(key,values);}
      values.add(value);
    }
  }
  affected(keys:Iterable<string>):Set<T>{
    const result=new Set<T>();
    for(const key of keys)for(const value of this.chunks.get(key)??[])result.add(value);
    return result;
  }
}
