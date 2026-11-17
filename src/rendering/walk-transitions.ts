import {BoxGeometry,BufferGeometry,Color,Float32BufferAttribute,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Quaternion,Scene,Vector3} from 'three';
import {surfaceHeightAt,type SceneObstacle} from '../input/scene-collisions';
import {EXPLORATION_SITES} from '../world/exploration-sites';
import {Material,palette} from '../world/palette';
import {REGION_ROADS,sampleRegionalRoad} from '../world/region-layout';
import {regionalHeightAt} from '../world/region-terrain';
import type {Vector3Like,VoxelWorld} from '../world/voxel';
import {surfaceFinish} from './surface-finish';
import {FOREST_WALK} from '../gameplay/coast-signals';
import {BAY_STOPS,BAY_BEACH_WALK} from '../gameplay/south-bay';
import {shorelineAt} from '../world/generate';
import {NAVIGATION_LINES} from '../gameplay/navigation';
import {finishRoadSurfaces,roadSurfaceMaterial} from './road-surface-style';
import {ChunkDependents} from '../world/chunk-dependents';

type Cell={x:number;y:number;z:number;material:number};
type Transition={cell:Cell;anchors:Cell[];bounds:SceneObstacle[];active:boolean;indices:Array<{batch:Batch;index:number;matrix:Matrix4}>;road?:{mesh:Mesh;start:number;positions:number[]}};
type Batch={mesh:InstancedMesh;material:MeshStandardMaterial};
type Pending={transition:Transition;bounds:SceneObstacle;material:number};
const subdivisions=5,unit=1/subdivisions;
const key=(x:number,z:number)=>`${x},${z}`;
const distanceToSegment=(x:number,z:number,a:{x:number;z:number},b:{x:number;z:number})=>{
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
  return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
};

/** Visible 20cm treads on paths and the old town's terraced shore.
 * Ordinary grass, cliffs, walls and furniture never acquire a climbing allowance.
 * The source voxels remain untouched, so saved destruction stays authoritative.
 */
export class WalkTransitions {
  private readonly geometry=new BoxGeometry(1,1,1);
  private readonly batches:Batch[]=[];
  private readonly roads:Mesh<BufferGeometry,MeshStandardMaterial>[]=[];
  private readonly transitions:Transition[]=[];
  private readonly dependents=new ChunkDependents<Transition>();
  private readonly spatial=new Map<string,Transition[]>();
  private readonly columns=new Map<string,Transition>();
  private readonly zero=new Matrix4().makeScale(0,0,0);

  constructor(scene:Scene,private readonly world:VoxelWorld){
    const candidates=new Set<string>(),trails=new Set<string>(),shore=new Set<string>();
    const addBand=(a:{x:number;z:number},b:{x:number;z:number},radius:number,trail=false)=>{
      for(let z=Math.floor(Math.min(a.z,b.z)-radius);z<=Math.ceil(Math.max(a.z,b.z)+radius);z++)for(let x=Math.floor(Math.min(a.x,b.x)-radius);x<=Math.ceil(Math.max(a.x,b.x)+radius);x++){
        if(world.contains(x,15,z)&&distanceToSegment(x+.5,z+.5,a,b)<=radius){candidates.add(key(x,z));if(trail)trails.add(key(x,z));}
      }
    };
    for(const road of REGION_ROADS)for(let i=1;i<road.points.length;i++)addBand(road.points[i-1],road.points[i],road.halfWidth+road.shoulder+.2);
    const harborWalk=NAVIGATION_LINES.find(line=>line.id==='harbor-walk')!;
    for(let i=1;i<harborWalk.points.length;i++)addBand(harborWalk.points[i-1],harborWalk.points[i],1.8);
    addBand({x:260,z:168},{x:260,z:183},1.6,true);
    // These broad sand terraces read as stairs from every approach. Subdivide
    // their actual visible surface, rather than letting the body climb 1m walls.
    for(let x=0;x<256;x++)for(let z=174;z<=shorelineAt(x);z++){
      const k=key(x,z);candidates.add(k);shore.add(k);
    }
    for(const site of EXPLORATION_SITES)for(let i=1;i<site.route.length;i++)addBand(site.route[i-1],site.route[i],2.2,true);
    for(const site of BAY_STOPS)for(let i=1;i<site.trail.length;i++)addBand(site.trail[i-1],site.trail[i],1.6,true);
    for(let i=1;i<BAY_BEACH_WALK.length;i++)addBand(BAY_BEACH_WALK[i-1],BAY_BEACH_WALK[i],1.6,true);
    for(let i=1;i<FOREST_WALK.length;i++)addBand(FOREST_WALK[i-1],FOREST_WALK[i],1.5,true);
    // The original harbor deck is one metre lower than the shop floors.
    for(const z of [227,237])for(const x of [17,36,55])addBand({x,z:z-2},{x,z:z+2},2);
    const cache=new Map<string,Cell|null>(),pavedCells=new Map<string,{roadId:string;along:number}>();
    const floorAt=(x:number,z:number):Cell|null=>{
      const k=key(x,z);if(cache.has(k))return cache.get(k)!;
      if(!candidates.has(k)){cache.set(k,null);return null;}
      const road=sampleRegionalRoad(x+.5,z+.5,7),onRoad=!!road&&road.distance<=road.halfWidth+road.shoulder+.2;
      let found:Cell|null=null;
      for(let y=92;y>=12;y--){
        const m=world.getVoxel(x,y,z);
        const paved=onRoad&&y===regionalHeightAt(x,z)&&(m===Material.Road||m===Material.Stripe||m===Material.Concrete);
        const capeCourt=x>=-194&&x<=-182&&z>=121&&z<=131&&m===Material.Concrete;
        const trailGround=trails.has(k)&&(y===regionalHeightAt(x,z)||x>=258&&x<=262&&z>=166&&z<=196||capeCourt)&&(m===Material.Grass||m===Material.Sand||m===Material.Rock||m===Material.Concrete);
        const shoreGround=shore.has(k)&&(y===regionalHeightAt(x,z)&&m===Material.Sand||z===174&&(m===Material.Trim||m===Material.Concrete));
        if(!paved&&!trailGround&&!shoreGround&&m!==Material.Wood)continue;
        if(world.getVoxel(x,y+1,z)||world.getVoxel(x,y+2,z)||world.getVoxel(x,y+3,z))continue;
        found={x,y,z,material:m};if(paved&&road)pavedCells.set(k,road);break;
      }
      cache.set(k,found);return found;
    };
    // Grade the entire cape stair by distance along its route. Overlapping
    // 3m-wide voxel landings otherwise make a tall riser at the hairpin.
    const capeRoute=EXPLORATION_SITES.find(site=>site.id==='cape-signal')!.route;
    const capeSamples:Array<{x:number;z:number;along:number;top:number;anchor:Cell|null}>=[];
    let capeLength=0;
    for(let i=1;i<capeRoute.length;i++){
      const a=capeRoute[i-1],b=capeRoute[i],length=Math.hypot(b.x-a.x,b.z-a.z),count=Math.ceil(length*4);
      for(let j=0;j<=count;j++){
        const x=a.x+(b.x-a.x)*j/count,z=a.z+(b.z-a.z)*j/count;
        let top=0,anchor:Cell|null=null;
        for(const dz of [-.8,0,.8])for(const dx of [-.8,0,.8]){const c=floorAt(Math.floor(x+dx),Math.floor(z+dz));if(c&&c.y+1>top){top=c.y+1;anchor=c;}}
        capeSamples.push({x,z,along:capeLength+length*j/count,top,anchor});
      }
      capeLength+=length;
    }
    const capeGrade=capeSamples.map(p=>capeSamples.reduce((best,q)=>{const top=q.top-Math.abs(q.along-p.along)*.4;return top>best.top?{top,anchor:q.anchor}:best;},{top:0,anchor:null as Cell|null}));
    // A shared corner field prevents independent cells making a new vertical
    // ledge at the next voxel. The road approach is long enough for a wheelbase;
    // nearby trail and doorway corners join this exact same surface.
    const vertices=new Map<string,{height:number;anchors:Cell[]}>();
    const vertex=(x:number,z:number)=>{
      const k=key(x,z),cached=vertices.get(k);if(cached)return cached;
      let height=0;const anchors:Cell[]=[];
      for(let dz=-1;dz<=0;dz++)for(let dx=-1;dx<=0;dx++){
        const cell=floorAt(x+dx,z+dz);if(cell){height=Math.max(height,cell.y+1);anchors.push(cell);}
      }
      const targetRoad=sampleRegionalRoad(x,z,7);
      for(let dz=-4;dz<=3;dz++)for(let dx=-4;dx<=3;dx++){
        const cell=floorAt(x+dx,z+dz);if(!cell)continue;const sourceRoad=pavedCells.get(key(cell.x,cell.z));
        if(!targetRoad||!sourceRoad||targetRoad.roadId!==sourceRoad.roadId||Math.abs(targetRoad.along-sourceRoad.along)>4.5)continue;
        const distance=Math.hypot(Math.max(dx,-dx-1,0),Math.max(dz,-dz-1,0));if(distance>4)continue;
        const top=cell.y+1-distance/4;
        if(top>height){height=top;anchors.push(cell);}
      }
      if(x>=-193&&x<=-169&&z>=87&&z<=130){
        let nearest=-1,distance=Infinity;
        capeSamples.forEach((p,i)=>{const d=Math.hypot(p.x-x,p.z-z);if(d<distance){distance=d;nearest=i;}});
        if(distance<=2.3&&capeGrade[nearest].top>height){height=capeGrade[nearest].top;if(capeGrade[nearest].anchor)anchors.push(capeGrade[nearest].anchor!);}
      }
      const value={height,anchors};vertices.set(k,value);return value;
    };
    const pending:Pending[]=[],roadGroups=new Map<string,Array<{transition:Transition;material:number}>>();
    const register=(t:Transition)=>{this.transitions.push(t);this.dependents.add(t,[...t.anchors,...[1,2,3].map(dy=>({...t.cell,y:t.cell.y+dy}))]);this.columns.set(key(t.cell.x,t.cell.z),t);const sk=key(t.cell.x>>4,t.cell.z>>4),bucket=this.spatial.get(sk)??[];bucket.push(t);this.spatial.set(sk,bucket);};
    for(const k of candidates){
      const [x,z]=k.split(',').map(Number),cell=floorAt(x,z);if(!cell)continue;
      const corners=[vertex(x,z),vertex(x+1,z),vertex(x,z+1),vertex(x+1,z+1)];
      const sample=(u:number,v:number)=>corners[0].height*(1-u)*(1-v)+corners[1].height*u*(1-v)+corners[2].height*(1-u)*v+corners[3].height*u*v;
      const anchors=[...new Map([cell,...corners.flatMap(c=>c.anchors)].map(c=>[`${c.x},${c.y},${c.z}`,c])).values()];
      if(pavedCells.has(k)){
        // The source grid remains editable. A continuous, supported cap replaces
        // hundreds of little road steps, with exactly the same contact surface.
        const surface=corners.map(c=>Math.max(cell.y+1,c.height)+.008) as [number,number,number,number];
        const bounds:SceneObstacle={minX:x,maxX:x+1,minZ:z,maxZ:z+1,minY:cell.y+.99,maxY:Math.max(...surface),surface,standable:true,vaultable:false};
        const transition:Transition={cell,anchors,bounds:[bounds],active:true,indices:[]};register(transition);
        const groupKey=`${x>>6},${z>>6}`,group=roadGroups.get(groupKey)??[];group.push({transition,material:cell.material});roadGroups.set(groupKey,group);continue;
      }
      const levels=Array.from({length:25},(_,i)=>{
        const ix=i%5,iz=Math.floor(i/5);
        const height=Math.max(...[ix*unit,(ix+1)*unit].flatMap(u=>[iz*unit,(iz+1)*unit].map(v=>sample(u,v))));
        return Math.max(0,Math.ceil((height-cell.y-1)*5-.0001));
      });
      if(levels.every(h=>!h))continue;
      const transition:Transition={cell,anchors,bounds:[],active:true,indices:[]};
      const make=(ix:number,iz:number,width:number,depth:number,height:number)=>{
        const bounds:SceneObstacle={minX:x+ix*unit,maxX:x+(ix+width)*unit,minY:cell.y+1,maxY:cell.y+1+height,minZ:z+iz*unit,maxZ:z+(iz+depth)*unit,standable:true,vaultable:false};
        const material=shore.has(k)?Material.Sand:[Material.Grass,Material.Sand,Material.Rock].includes(cell.material as never)?Material.Wood:cell.material;
        transition.bounds.push(bounds);pending.push({transition,bounds,material});
      };
      const used=new Uint8Array(25);
      for(let iz=0;iz<5;iz++)for(let ix=0;ix<5;ix++){
        const index=ix+iz*5;if(used[index])continue;const height=levels[index];let width=1,depth=1;
        if(height===0){used[index]=1;continue;}
        while(ix+width<5&&!used[index+width]&&levels[index+width]===height)width++;
        while(iz+depth<5&&Array.from({length:width},(_,i)=>ix+i+(iz+depth)*5).every(i=>!used[i]&&levels[i]===height))depth++;
        for(let dz=0;dz<depth;dz++)for(let dx=0;dx<width;dx++)used[ix+dx+(iz+dz)*5]=1;
        make(ix,iz,width,depth,height*unit);
      }
      register(transition);
    }
    for(const entries of roadGroups.values()){
      const positions:number[]=[],geometry=new BufferGeometry(),material=roadSurfaceMaterial();
      const mesh=new Mesh(geometry,material);mesh.name='continuous-coast-road';mesh.receiveShadow=true;
      for(const {transition:t}of entries){
        const b=t.bounds[0],h=b.surface!,base=b.minY,vertices=[[b.minX,h[0],b.minZ],[b.maxX,h[1],b.minZ],[b.minX,h[2],b.maxZ],[b.maxX,h[3],b.maxZ],[b.minX,base,b.minZ],[b.maxX,base,b.minZ],[b.minX,base,b.maxZ],[b.maxX,base,b.maxZ]];
        const indices=[0,2,1,1,2,3,0,1,4,1,5,4,1,3,5,3,7,5,3,2,7,2,6,7,2,0,6,0,4,6];
        const values=indices.flatMap(i=>vertices[i]);t.road={mesh,start:positions.length,positions:values};positions.push(...values);
      }
      geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();scene.add(mesh);this.roads.push(mesh);
    }
    finishRoadSurfaces(this.roads.map(mesh=>mesh.geometry));
    this.updateRoadWalls();
    const groups=new Map<string,Pending[]>();for(const p of pending){const k=`${p.transition.cell.x>>6},${p.transition.cell.z>>6},${p.material}`,group=groups.get(k)??[];group.push(p);groups.set(k,group);}
    for(const entries of groups.values()){
      const id=entries[0].material,material=new MeshStandardMaterial({color:new Color().setRGB(...palette[id].color),roughness:.9});
      surfaceFinish(material,id===Material.Sand?'sand':id===Material.Wood?'wood':'stone');
      const mesh=new InstancedMesh(this.geometry,material,entries.length);mesh.name=`walkable-treads-${palette[id].name}`;mesh.receiveShadow=true;
      const batch={mesh,material};this.batches.push(batch);scene.add(mesh);
      entries.forEach(({transition,bounds:b},index)=>{
        const matrix=new Matrix4().compose(new Vector3((b.minX+b.maxX)/2,(b.minY+b.maxY)/2,(b.minZ+b.maxZ)/2),new Quaternion(),new Vector3(b.maxX-b.minX,b.maxY-b.minY,b.maxZ-b.minZ));
        mesh.setMatrixAt(index,matrix);transition.indices.push({batch,index,matrix});
      });
      mesh.computeBoundingSphere();
    }
  }

  get diagnostics(){return{cells:this.transitions.length,treads:this.transitions.reduce((sum,t)=>sum+t.bounds.length,0),batches:this.batches.length+this.roads.length,roadCells:this.transitions.filter(t=>t.road).length};}

  update(focus:Vector3Like):void{
    for(const {mesh}of this.batches){const s=mesh.boundingSphere;if(s)mesh.visible=Math.hypot(focus.x-s.center.x,focus.z-s.center.z)<s.radius+140;}
    for(const mesh of this.roads){const s=mesh.geometry.boundingSphere;if(s)mesh.visible=Math.hypot(focus.x-s.center.x,focus.z-s.center.z)<s.radius+260;}
  }

  nearby(center:Vector3Like,radius=10):SceneObstacle[]{
    const found:SceneObstacle[]=[];
    for(let z=Math.floor((center.z-radius)/16);z<=Math.floor((center.z+radius)/16);z++)for(let x=Math.floor((center.x-radius)/16);x<=Math.floor((center.x+radius)/16);x++){
      for(const transition of this.spatial.get(key(x,z))??[])if(transition.active&&Math.abs(transition.cell.x-center.x)<=radius+1&&Math.abs(transition.cell.z-center.z)<=radius+1){
        for(const bounds of transition.bounds)if(bounds.minY<center.y+4&&bounds.maxY>center.y-4)found.push(bounds);
      }
    }
    return found;
  }

  heightAt(x:number,z:number,maxTop=96):number|null{
    const t=this.columns.get(key(Math.floor(x),Math.floor(z)));if(!t?.active)return null;
    let height:number|null=null;
    for(const b of t.bounds)if(x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ){const top=surfaceHeightAt(b,x,z);if(top<=maxTop+.001)height=Math.max(height??-Infinity,top);}
    return height;
  }

  sync(dirtyKeys:Iterable<string>):void{
    const walls=new Set<string>();
    for(const t of this.dependents.affected(dirtyKeys)){
      const active=t.anchors.every(c=>this.world.getVoxel(c.x,c.y,c.z)===c.material)&&[1,2,3].every(dy=>!this.world.getVoxel(t.cell.x,t.cell.y+dy,t.cell.z));
      if(active===t.active)continue;t.active=active;
      if(t.road){const a=t.road.mesh.geometry.getAttribute('position');for(let i=0;i<t.road.positions.length;i++)a.array[t.road.start+i]=active?t.road.positions[i]:0;a.needsUpdate=true;for(const [dx,dz]of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])walls.add(key(t.cell.x+dx,t.cell.z+dz));}
      for(const entry of t.indices){entry.batch.mesh.setMatrixAt(entry.index,active?entry.matrix:this.zero);entry.batch.mesh.instanceMatrix.needsUpdate=true;}
    }
    if(walls.size)this.updateRoadWalls([...walls].map(k=>this.columns.get(k)).filter((t):t is Transition=>!!t));
  }

  private updateRoadWalls(transitions:readonly Transition[]=this.transitions):void{
    for(const t of transitions){if(!t.road)continue;const a=t.road.mesh.geometry.getAttribute('position');
      // Shared internal faces otherwise fight the neighbouring top surface at
      // grazing angles. Re-expose only the real rim when a cap is destroyed.
      [[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx,dz],side)=>{const neighbour=this.columns.get(key(t.cell.x+dx,t.cell.z+dz)),show=t.active&&(!neighbour?.active||!neighbour.road),offset=18+side*18;for(let i=offset;i<offset+18;i++)a.array[t.road!.start+i]=show?t.road!.positions[i]:0;});a.needsUpdate=true;
    }
  }

  dispose():void{for(const b of this.batches){b.mesh.removeFromParent();b.mesh.dispose();b.material.dispose();}for(const mesh of this.roads){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}this.geometry.dispose();}
}
