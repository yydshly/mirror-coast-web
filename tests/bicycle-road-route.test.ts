import {it,expect} from 'vitest';
import {Scene} from 'three';
import {generateWorld} from '../src/world/generate';
import {addRegionalTerrain} from '../src/world/region-terrain';
import {addRegionalDistricts} from '../src/world/region-districts';
import {WalkTransitions} from '../src/rendering/walk-transitions';
import {Bicycle} from '../src/vehicles/bicycle';

it('continues through the actual south-bay downhill where the live journey stopped',()=>{
 const {world,buildings}=generateWorld();addRegionalTerrain(world);addRegionalDistricts(world,buildings);
 const transitions=new WalkTransitions(new Scene(),world),bike=new Bicycle(new Scene(),world);
 bike.setObstacleProvider(()=>transitions.nearby(bike.position,12));bike.restore({position:{x:557.7908793681368,y:15,z:163.00431032627748},heading:-1.1754065462329275,riding:true});bike.setRiding(true);bike.setInput(1);
 for(let i=0;i<180;i++)bike.update(1/60);
 expect(bike.position.x,JSON.stringify({position:bike.position,state:bike.viewState,ground:[-.74,0,.74].map(d=>transitions.heightAt(bike.position.x+d*.92,bike.position.z-d*.38,bike.position.y+2))})).toBeGreaterThan(565);
 expect(bike.motor.recoveredLastStep).toBe(false);bike.dispose();transitions.dispose();
},20000);
it('explains a motor contact at the south-bay dune instead of silently accepting throttle',()=>{
 const {world,buildings}=generateWorld();addRegionalTerrain(world);addRegionalDistricts(world,buildings);
 const transitions=new WalkTransitions(new Scene(),world),bike=new Bicycle(new Scene(),world);
 bike.setObstacleProvider(()=>transitions.nearby(bike.position,12));bike.restore({position:{x:638.7837,y:14,z:153.1373},heading:-3.02168,riding:true});bike.setRiding(true);bike.setInput(1);
 for(let i=0;i<150;i++)bike.update(1/60);
 expect(bike.viewState.blocked).toMatch(/受阻|坡坎/);expect(bike.viewState.speed).toBe(0);
 bike.dispose();transitions.dispose();
},20000);
it('climbs the actual west-village junction without requiring both wheels to share the center height',()=>{
 const {world,buildings}=generateWorld();addRegionalTerrain(world);addRegionalDistricts(world,buildings);
 const transitions=new WalkTransitions(new Scene(),world),bike=new Bicycle(new Scene(),world);
 bike.setObstacleProvider(()=>transitions.nearby(bike.position,12));bike.restore({position:{x:-66.50827313286737,y:19.4,z:148.95773772708264},heading:-5.119799320638436,riding:true});bike.setRiding(true);bike.setInput(1);
 for(let i=0;i<180;i++)bike.update(1/60);
 expect(bike.position.x,JSON.stringify({position:bike.position,state:bike.viewState})).toBeLessThan(-74);
 expect(bike.motor.recoveredLastStep).toBe(false);bike.dispose();transitions.dispose();
},20000);
