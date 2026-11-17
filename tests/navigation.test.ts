import {describe,expect,it} from 'vitest';
import {CoastalNavigation,MAP_DESTINATIONS,destinationById,mapProjection,mapMarker} from '../src/gameplay/navigation';
import {REGION_PLACES} from '../src/world/region-layout';

describe('whole-region orientation and connected exploration',()=>{
 it('returns from the tide line to the roadside car without a detour across the city',()=>{const n=new CoastalNavigation();expect(n.route({x:260,z:180.8},{x:248,z:164})!.distance).toBeLessThan(50);expect(n.route({x:135,z:159.5},{x:183,z:172.8})!.distance).toBeLessThan(85);});
 it('projects negative west/north coordinates, the city, and all region corners consistently',()=>{
  expect(mapProjection({x:-256,z:-384})).toEqual({x:0,y:0});
  expect(mapProjection({x:768,z:384})).toEqual({x:1024,y:768});
  expect(mapProjection({x:0,z:0})).toEqual({x:256,y:384});
  expect(mapMarker({x:-300,z:500})).toEqual({x:16,y:752,outside:true});
  for(const p of MAP_DESTINATIONS)expect(mapMarker(p.position).outside,p.id).toBe(false);
 });
 it('connects the city to all seven peripheral places by roads, including road intersections and city seams',()=>{
  const nav=new CoastalNavigation();
  for(const p of REGION_PLACES){
   const route=nav.route({x:248,z:164},p.position,true);
   expect(route,p.id).not.toBeNull();expect(route!.distance,p.id).toBeGreaterThan(Math.hypot(p.position.x-248,p.position.z-164));
   expect(route!.points.at(-1)).toMatchObject({x:p.position.x,z:p.position.z});
  }
 });
 it('uses the actual jetty connector for a walking trip out of the harbor, without driving along it',()=>{
  const nav=new CoastalNavigation(),harbor=destinationById('harbor')!;
  const walk=nav.route(harbor.position,{x:135.5,z:159.5});expect(walk).not.toBeNull();
  expect(walk!.points.some(p=>p.x===64.5&&p.z===214)).toBe(true);
  expect(walk!.points.some(p=>p.x===100&&p.z===214)).toBe(true);
  // The route goes around the parked helicopter, rather than using its pad
  // centre as a footway. Verify the connecting segments, not just waypoints.
  for(let i=1;i<walk!.points.length;i++){
   const a=walk!.points[i-1],b=walk!.points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)*2));
   for(let j=0;j<=n;j++)expect(Math.hypot(a.x+(b.x-a.x)*j/n-108,a.z+(b.z-a.z)*j/n-209)).toBeGreaterThan(5);
  }
  const car=nav.route({x:248,z:164},harbor.approach!,true);expect(car).not.toBeNull();expect(car!.points.every(p=>p.z<=164)).toBe(true);
 });
 it('gives each investigation a road approach, a real walking trail and an explicit activity',()=>{
  const nav=new CoastalNavigation();
  for(const p of MAP_DESTINATIONS.filter(p=>p.kind==='activity')){
   expect(nav.route({x:248,z:164},p.approach!,true),p.id).not.toBeNull();expect(p.trail!.length).toBeGreaterThan(2);
   expect(p.access).toContain('按 E');expect(p.trail!.at(-1)).toMatchObject({x:p.position.x,z:p.position.z});
  }
 });
 it('reports a disconnected road instead of inventing a straight road across the sea',()=>{
  const nav=new CoastalNavigation([{id:'a',kind:'road',points:[{x:0,z:0},{x:10,z:0}]},{id:'b',kind:'road',points:[{x:100,z:100},{x:110,z:100}]}]);
  expect(nav.route({x:5,z:0},{x:105,z:100},true)).toBeNull();
 });
});
