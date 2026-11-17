import{expect,it}from'vitest';
import{VoxelWorld}from'../src/world/voxel';
import{StreetLifeSimulation,type LifeContext}from'../src/simulation/street-life-sim';
function fixture(){
 const world=new VoxelWorld();for(let x=4;x<30;x++)for(let z=16;z<25;z++)for(const y of [15,39])world.setVoxel(x,y,z,15,false);
 const sim=new StreetLifeSimulation(world,{cars:0}),p=sim.people[0];sim.people.splice(1);
 const reset=(y=16)=>Object.assign(p,{a:{x:8,z:20},b:{x:18,z:20},progress:.2,direction:1,position:{x:10,y,z:20},wait:0,crossing:false,committed:false,retreating:false,blockedFor:0,pace:1});reset();
 return{sim,p,reset};
}
const run=(s:StreetLifeSimulation,ctx:LifeContext,n=100)=>{for(let i=0;i<n;i++)s.update(1/30,ctx);};
it('reindexes before an actor enters a higher floor, even when the static scene revision has not changed',()=>{
 const{sim,p,reset}=fixture(),wall={minX:12,maxX:12.5,minY:39,maxY:43,minZ:19,maxZ:21},ctx={focus:p.position,night:0,wetness:0,obstacles:[wall],obstacleRevision:4};
 run(sim,ctx);expect(p.position.x).toBeGreaterThan(12);
 reset(40);run(sim,ctx,45);expect(p.position.x).toBeGreaterThan(10.5);expect(p.position.x).toBeLessThan(11.7);expect(p.position.y).toBe(40);
 run(sim,{...ctx,obstacles:[],obstacleRevision:5});expect(p.position.x).toBeGreaterThan(12.5);
});
it('keeps falling live obstacles current when they enter the pedestrian band without a scene revision',()=>{
 const{sim,p}=fixture(),falling={minX:12,maxX:12.5,minY:39,maxY:42,minZ:19,maxZ:21,physicsManaged:true},ctx={focus:p.position,night:0,wetness:0,obstacles:[falling],obstacleRevision:1};
 run(sim,ctx,30);expect(p.position.x).toBeGreaterThan(10.8);falling.minY=16;falling.maxY=18;
 run(sim,ctx,30);expect(p.position.x).toBeLessThan(11.7);falling.minY=0;falling.maxY=-1;
 run(sim,ctx);expect(p.position.x).toBeGreaterThan(12.5);
});
it('retains low contact with a tall static wall whose upper storeys are outside the active height band',()=>{
 const{sim,p}=fixture(),wall={minX:12,maxX:12.5,minY:15,maxY:65,minZ:19,maxZ:21},ctx={focus:p.position,night:0,wetness:0,obstacles:[wall],obstacleRevision:1};
 run(sim,ctx,50);expect(p.position.x).toBeGreaterThan(10.5);expect(p.position.x).toBeLessThan(11.7);
});
