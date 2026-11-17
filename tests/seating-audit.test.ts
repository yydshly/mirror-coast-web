import {it,expect} from 'vitest';
import {Scene,Vector3} from 'three';
import {generateWorld} from '../src/world/generate';
import {addHarborQuarter} from '../src/world/harbor-quarter';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {addExplorationSites} from '../src/world/exploration-sites';
import {addSouthBayLandmarks} from '../src/world/south-bay-landmarks';
import {StreetArt} from '../src/rendering/street-art';
import {CoastalArt} from '../src/rendering/coastal-art';
import {RegionArt} from '../src/rendering/region-art';
import {NeighborhoodDetail} from '../src/rendering/neighborhood-detail';
import {SouthBay} from '../src/rendering/south-bay';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {VoxelWalker} from '../src/input/walk';
import {GroundActions} from '../src/input/ground-actions';
import {collectNearbyObstacles} from '../src/input/scene-collisions';

it('audits entry, seating and exit on every registered seat in the actual connected world',async()=>{
 const base=generateWorld(),scene=new Scene();addHarborQuarter(base.world,base.buildings);addRegionalTerrain(base.world);addRegionalDistricts(base.world,base.buildings);addExplorationSites(base.world,base.buildings);addSouthBayLandmarks(base.world,base.buildings);
 const coast=new CoastalArt(scene,base.world,base.buildings,{facades:false,headlands:false}),street=new StreetArt(scene,base.world,base.buildings,{people:false}),region=new RegionArt(scene,base.world),detail=new NeighborhoodDetail(scene,base.world,base.buildings),bay=new SouthBay(scene,base.world),treads=new WalkTransitions(scene,base.world);
 const groups=[coast.obstacles,street.obstacles,region.obstacles,detail.obstacles,bay.obstacles],seats=[...coast.seats,...street.seats,...region.seats,...bay.seats],report:unknown[]=[],failures:string[]=[];
 try{
  for(const seat of seats){let success=0;const attempts:unknown[]=[],f={x:-Math.sin(seat.yaw),z:-Math.cos(seat.yaw)},side={x:f.z,z:-f.x};
   for(const [u,v]of [[0,.45],[0,.8],[-1.35,0],[1.35,0],[0,-.8]]){
    const start=new Vector3(seat.position.x+side.x*u+f.x*v,seat.floorY,seat.position.z+side.z*u+f.z*v),motor=new VoxelWalker(base.world,start);
    const nearby=[...collectNearbyObstacles(start,groups,8,6),...treads.nearby(start)];motor.setObstacleProvider(()=>nearby);
    const floor=motor.surfaceAt(start.x,start.z,seat.floorY+.32,.65);if(floor===null)continue;start.y=floor;motor.position.copy(start);motor.grounded=true;if(!motor.canOccupy(start))continue;
    const notices:string[]=[],actions=new GroundActions(motor,()=>motor.obstacles,m=>notices.push(m));actions.setSeatProvider(()=>[seat]);const hint=actions.interaction(seat.yaw+Math.PI);
    if(hint?.kind!=='sit'){attempts.push({u,v,status:actions.status});continue;}
    actions.interact(hint,seat.yaw+Math.PI);for(let i=0;i<480&&actions.phase!=='seated';i++)actions.update(1/60);
    if(actions.phase!=='seated'){failures.push(`${seat.id} interrupted: ${u},${v} ${notices}`);continue;}
    if(!actions.stand()){failures.push(`${seat.id} cannot stand: ${u},${v}`);continue;}
    for(let i=0;i<120&&String(actions.phase)!=='standing';i++)actions.update(1/60);
    if(String(actions.phase)!=='standing'||!motor.canOccupy(motor.position)){failures.push(`${seat.id} exit blocked: ${u},${v}`);continue;}
    success++;attempts.push({u,v,start,end:{...motor.position},passed:true});
   }
   if(success<1)failures.push(`${seat.id}: no reachable interaction ${JSON.stringify(attempts)}`);
   report.push({id:seat.id,kind:seat.kind??'bench',position:seat.position,floorY:seat.floorY,yaw:seat.yaw,success,attempts});
  }
  if((globalThis as {process?:{env?:Record<string,string>}}).process?.env?.MIRROR_SEAT_AUDIT){
   const moduleName='node:fs',fs=await import(moduleName) as {mkdirSync:(path:string,options:{recursive:boolean})=>void;writeFileSync:(path:string,text:string)=>void};
   fs.mkdirSync('artifacts/dining-and-facades',{recursive:true});fs.writeFileSync('artifacts/dining-and-facades/seat-audit.json',JSON.stringify({count:seats.length,failures,seats:report},null,2));
  }
  expect(failures).toEqual([]);expect(seats.filter(s=>s.kind==='chair')).toHaveLength(6);expect(seats.length).toBeGreaterThan(18);
 }finally{treads.dispose();detail.dispose();region.dispose();street.dispose();coast.dispose();scene.clear();}
},60000);
