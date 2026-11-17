import {it,expect} from 'vitest';
import {CoastalJourney,validateJourney} from '../src/gameplay/coastal-journey';
const city={x:135,y:16,z:159},bay={x:657.5,y:15,z:184};
function dwell(j:CoastalJourney,p=city,seat?:string,evidence={},seconds=2){for(let i=0;i<seconds*10;i++)j.update(.1,p,'walk',seat,evidence);}
it('requires an actual coast seat after the old-city stroll and resumes that approach from a save',()=>{
 const j=new CoastalJourney();j.beginCoastalRoute();for(let i=0;i<24;i++)j.update(.1,{...city,x:132+i*.2},'walk');
 expect(j.state.step).toBe(0);expect(j.state.stroll).toBe(true);expect(j.navigationTarget(city,'walk')).toBe('seafront');
 const restored=new CoastalJourney();restored.restore(validateJourney(j.state));dwell(restored,{x:61,y:16,z:172},'park-bench-61');expect(restored.state.step).toBe(0);
 dwell(restored,{x:61,y:16,z:172},'coast-bench-61');expect(restored.state.step).toBe(1);
 const other=new CoastalJourney();other.restore({...j.state});dwell(other,{x:183,y:16,z:172},'coast-bench-183');expect(other.state.step).toBe(1);
});
it('connects a bay activity to the real rescue log before pointing back to the parked vehicle',()=>{
 const j=new CoastalJourney();j.beginCoastalRoute();j.state.step=3;
 dwell(j,bay,undefined,{bayNotes:['kite']});expect(j.state.step).toBe(3);expect(j.navigationTarget(bay,'walk')).toBe('tidal-rescue');
 dwell(j,bay,undefined,{discoveries:new Set(['tidal-rescue'])});expect(j.state.step).toBe(3);
 dwell(j,bay,undefined,{bayNotes:['pool'],discoveries:new Set(['tidal-rescue'])});expect(j.state.step).toBe(4);expect(j.navigationTarget(bay,'walk')).toBe('car');
});
it('keeps itinerary stop tracking active and permits either road vehicle',()=>{
 const j=new CoastalJourney();j.beginCoastalRoute();j.state.step=2;
 expect(j.trackStop('bicycle')).toBe(true);expect(j.state.active).toBe(true);expect(j.navigationTarget(city,'walk')).toBe('bicycle');
 j.state.step=3;expect(j.trackStop('bay-pools')).toBe(true);expect(j.navigationTarget(bay,'walk')).toBe('bay-pools');
 expect(j.trackStop('forest-radio')).toBe(false);j.state.step=4;expect(j.navigationTarget(bay,'walk')).toBe('bicycle');
});
it('retains earlier itinerary formats without adding seat or rescue requirements',()=>{
 const j=new CoastalJourney();j.restore({step:3,active:true,route:'coast-road',experience:'harbor-signal'});dwell(j,bay,undefined,{bayNotes:['kite']});expect(j.state.step).toBe(4);
 expect(validateJourney({step:4,active:false})).toEqual({step:4,active:false});expect(()=>validateJourney({step:0,active:true,route:'coast-road',stroll:true})).toThrow();
});
