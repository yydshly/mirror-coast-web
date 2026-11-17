import{afterEach,expect,it}from'vitest';import{Scene,Quaternion,Vector3}from'three';
import{Bicycle}from'../src/vehicles/bicycle';import{VoxelWorld}from'../src/world/voxel';import{orientedCollisionBounds,type SceneObstacle}from'../src/input/scene-collisions';
import{generateWorld}from'../src/world/generate';import{StreetArt}from'../src/rendering/street-art';
const bikes:Bicycle[]=[];afterEach(()=>bikes.splice(0).forEach(b=>b.dispose()));
function setup(heading=0){const world=new VoxelWorld();for(let x=100;x<150;x++)for(let z=150;z<195;z++)world.setVoxel(x,15,z,1,false);const bike=new Bicycle(new Scene(),world);bikes.push(bike);bike.restore({position:{x:120,y:16,z:170},heading,riding:true});bike.setRiding(true);return{bike,world};}
function advance(b:Bicycle,n=150){for(let i=0;i<n;i++){b.update(1/60);expect(b.motor.recoveredLastStep).toBe(false);}}
const sideWall:SceneObstacle={minX:120.30,maxX:121.3,minY:16,maxY:20,minZ:155,maxZ:190};
it.each([1,-1])('leaves an existing shallow wall contact with throttle %s without teleporting or changing the wall',throttle=>{
 const{bike}=setup();bike.setObstacleProvider(()=>[sideWall]);bike.setInput(throttle);advance(bike);expect(Math.abs(bike.position.z-170)).toBeGreaterThan(.8);expect(bike.position.x).toBeLessThanOrEqual(120);expect(bike.position.y).toBeCloseTo(16);expect(sideWall.minX).toBe(120.30);
});
it('steers away from the side wall, while steering into it cannot cross the wall',()=>{
 const{bike}=setup();bike.setObstacleProvider(()=>[sideWall]);bike.setInput(1,1);advance(bike,180);expect(bike.position.x).toBeLessThan(119.6);
 const{bike:blocked}=setup();blocked.setObstacleProvider(()=>[sideWall]);blocked.setInput(1,-1);advance(blocked,180);expect(blocked.position.x).toBeLessThanOrEqual(120.001);
});
it('backs out of a corner while retaining the wall in front',()=>{
 const{bike}=setup(),front={minX:115,maxX:121.3,minY:16,maxY:20,minZ:167.9,maxZ:168.9};bike.setObstacleProvider(()=>[sideWall,front]);bike.setInput(1);advance(bike,150);expect(bike.position.z).toBeGreaterThan(169.8);bike.setInput(-1);advance(bike,150);expect(bike.position.z).toBeGreaterThan(171);
});
it.each([1,-1])('retreats along a rotated wall with throttle %s',throttle=>{
 const yaw=Math.PI/4,{bike}=setup(yaw),normal=new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),wall=orientedCollisionBounds(new Vector3(120,18,170).addScaledVector(normal,.80),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw),{x:.5,y:2,z:12});bike.setObstacleProvider(()=>[wall]);bike.setInput(throttle);advance(bike);expect(Math.hypot(bike.position.x-120,bike.position.z-170)).toBeGreaterThan(.8);
});
it('steers away from an intact voxel wall and can retreat after an attempted turn into it',()=>{
 for(const escape of ['turn','reverse']){const{bike,world}=setup();for(let z=151;z<194;z++)for(let y=16;y<20;y++)world.setVoxel(121,y,z,8,false);bike.restore({position:{x:120.7,y:16,z:175},heading:0,riding:true});
  if(escape==='turn'){bike.setInput(1,1);advance(bike,180);expect(bike.position.x).toBeLessThan(120.3);}
  else{bike.setInput(1,-1);advance(bike,120);const z=bike.position.z;bike.setInput(-1);advance(bike,150);expect(bike.position.z-z).toBeGreaterThan(.8);}
 }
});
it('can leave the real old-city window-ledge contact with the complete bicycle footprint',()=>{
 const {world,buildings}=generateWorld(),art=new StreetArt(new Scene(),world,buildings,{people:false}),bike=new Bicycle(new Scene(),world);bikes.push(bike);
 const nearby=art.obstacles.filter(b=>b.maxX>92&&b.minX<97&&b.maxZ>135&&b.minZ<150&&b.minY<18);
 // The sill protrudes to x94.56. Place the handlebars beside its actual
 // outside face, rather than inserting the bicycle 44cm into the sill.
 bike.setObstacleProvider(()=>nearby);bike.restore({position:{x:94.25,y:16,z:145},heading:0,riding:true});bike.setRiding(true);bike.setInput(1,1);advance(bike,180);
 expect(bike.position.x,JSON.stringify({state:bike.viewState})).toBeLessThan(93.8);art.dispose();
},20000);
