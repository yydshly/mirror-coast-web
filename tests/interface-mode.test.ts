import {describe,expect,it} from 'vitest';
import {explorationPresentation} from '../src/ui/interface';

const base={walking:false,piloting:false,driving:false,vehicleAvailable:true,carAvailable:true};
describe('exclusive gameplay panels',()=>{
  it('keeps only one contextual panel through overlapping vehicle/walking transition notifications',()=>{
    const steps=[
      {...base,walking:true},
      {...base,walking:true,piloting:true},
      {...base,piloting:true},
      {...base,piloting:true,driving:true},
      {...base,driving:true},
      {...base,walking:true,driving:true},
      {...base,walking:true},
      {...base},
    ];
    const states=steps.map(explorationPresentation);
    expect(states.map(state=>state.mode)).toEqual(['walk','helicopter','helicopter','car','car','car','walk','fly']);
    for(const state of states)expect([state.street,state.observer,state.car,state.helicopter].filter(Boolean)).toHaveLength(1);
  });
  it('does not let a parked helicopter status update replace the car dashboard',()=>{
    expect(explorationPresentation({...base,driving:true,piloting:false})).toEqual({mode:'car',street:false,observer:false,car:true,helicopter:false});
  });
  it('hides the flight dashboard outside helicopter driving without hiding the current mode panel',()=>{
    for(const state of [base,{...base,walking:true},{...base,driving:true}])expect(explorationPresentation(state).helicopter).toBe(false);
    expect(explorationPresentation({...base,piloting:true}).helicopter).toBe(true);
  });
  it('does not show unavailable vehicle panels or an observation dashboard in the isolated lab',()=>{
    expect(explorationPresentation({...base,vehicleAvailable:false,carAvailable:false,piloting:true,driving:true})).toEqual({mode:'fly',street:false,observer:false,car:false,helicopter:false});
  });
});
