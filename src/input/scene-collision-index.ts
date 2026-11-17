import type {Vec3} from '../destruction/types';
import type {SceneObstacle} from './scene-collisions';
type Entry={keys:string[];seen:number;bounds:number[]};

/** Static scenery is indexed until terrain/support changes. Boats, traffic and
 * rigid bodies keep live bounds; rendering distance never removes collisions. */
export class SceneCollisionIndex {
  private cells=new Map<string,SceneObstacle[]>();
  readonly moving:SceneObstacle[]=[];
  private staticCount=0;
  private rebuilds=0;
  private visited=0;
  private entries=new Map<SceneObstacle,Entry>();
  private generation=0;
  constructor(private readonly cellSize=16){}
  rebuild(groups:readonly (readonly SceneObstacle[])[]):void{
    this.moving.length=0;this.staticCount=0;this.rebuilds++;const generation=++this.generation;
    for(const group of groups)for(const b of group){
      let entry=this.entries.get(b);if(entry?.seen===generation)continue;
      if(!entry){entry={keys:[],seen:generation,bounds:[]};this.entries.set(b,entry);}else entry.seen=generation;
      const moving=!!(b.motion||b.physicsManaged||b.trafficId!==undefined),valid=b.maxY>b.minY&&b.maxX>=b.minX&&b.maxZ>=b.minZ;
      if(moving||!valid){this.removeCells(b,entry);if(moving)this.moving.push(b);continue;}
      this.staticCount++;
      const old=entry.bounds;
      if(entry.keys.length&&old[0]===b.minX&&old[1]===b.maxX&&old[2]===b.minY&&old[3]===b.maxY&&old[4]===b.minZ&&old[5]===b.maxZ)continue;
      this.removeCells(b,entry);entry.bounds=[b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ];
      for(let z=Math.floor(b.minZ/this.cellSize);z<=Math.floor(b.maxZ/this.cellSize);z++)for(let x=Math.floor(b.minX/this.cellSize);x<=Math.floor(b.maxX/this.cellSize);x++){
        const key=`${x},${z}`,bucket=this.cells.get(key);if(bucket)bucket.push(b);else this.cells.set(key,[b]);
        entry.keys.push(key);
      }
    }
    // Most edits remove a few window/prop bounds. Preserve every unaffected
    // bucket rather than allocating the whole city's index again after a blast.
    for(const[b,entry]of this.entries)if(entry.seen!==generation){this.removeCells(b,entry);this.entries.delete(b);}
  }
  private removeCells(b:SceneObstacle,entry:Entry):void{
    for(const key of entry.keys){const bucket=this.cells.get(key);if(!bucket)continue;const index=bucket.indexOf(b);if(index>=0){bucket[index]=bucket[bucket.length-1];bucket.pop();}if(!bucket.length)this.cells.delete(key);}
    entry.keys.length=0;
  }
  query(center:Vec3,radius=16,verticalRadius=Infinity,live:readonly (readonly SceneObstacle[])[]=[]):SceneObstacle[]{
    const found:SceneObstacle[]=[],seen=new Set<SceneObstacle>();this.visited=0;
    const visit=(b:SceneObstacle)=>{
      if(seen.has(b))return;seen.add(b);this.visited++;
      if(b.maxY>b.minY&&b.maxX>=center.x-radius&&b.minX<=center.x+radius&&b.maxZ>=center.z-radius&&b.minZ<=center.z+radius&&b.maxY>=center.y-verticalRadius&&b.minY<=center.y+verticalRadius)found.push(b);
    };
    for(let z=Math.floor((center.z-radius)/this.cellSize);z<=Math.floor((center.z+radius)/this.cellSize);z++)for(let x=Math.floor((center.x-radius)/this.cellSize);x<=Math.floor((center.x+radius)/this.cellSize);x++)for(const b of this.cells.get(`${x},${z}`)??[])visit(b);
    for(const b of this.moving)visit(b);
    for(const group of live)for(const b of group)visit(b);
    return found;
  }
  get diagnostics(){return{static:this.staticCount,moving:this.moving.length,cells:this.cells.size,rebuilds:this.rebuilds,lastVisited:this.visited};}
}
