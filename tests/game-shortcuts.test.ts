import {describe,expect,it,vi} from 'vitest';
import {handleGameShortcut,type GameShortcutActions,type GameShortcutState} from '../src/input/game-shortcuts';
import {dismissReadingPanels} from '../src/ui/fieldbook';

function setup(overrides:Partial<GameShortcutState>={}){
  const state:GameShortcutState={ready:true,isLab:false,helpOpen:false,fieldbookOpen:false,hasFieldbook:true,walking:true,piloting:false,driving:false,observing:true,...overrides};
  const actions:GameShortcutActions={toggleHelp:vi.fn(()=>{state.helpOpen=!state.helpOpen;}),toggleFieldbook:vi.fn(()=>{state.fieldbookOpen=!state.fieldbookOpen;}),closeFieldbook:vi.fn(()=>{state.fieldbookOpen=false;}),releaseControls:vi.fn(),escape:vi.fn(),togglePilot:vi.fn(),home:vi.fn(),toggleMap:vi.fn(),interact:vi.fn()};
  const target=new EventTarget();target.addEventListener('keydown',event=>handleGameShortcut(event as KeyboardEvent,state,actions));
  const press=(code:string,repeat=false)=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{code,repeat});target.dispatchEvent(event);return event;};
  return {state,actions,target,press};
}
describe('game interaction and overlay shortcut routing',()=>{
  it.each([{cycling:true},{piloting:true},{driving:true},{boating:true}])('offers G recovery in each vehicle and leaves H as return flight',mode=>{
    const {actions,state,press}=setup({...mode,walking:false});actions.recoverVehicle=vi.fn();actions.returnToPad=vi.fn();
    expect(press('KeyG').defaultPrevented).toBe(true);expect(actions.recoverVehicle).toHaveBeenCalledOnce();
    press('KeyG',true);expect(actions.recoverVehicle).toHaveBeenCalledOnce();
    press('KeyH');expect(actions.returnToPad).toHaveBeenCalledOnce();
    state.helpOpen=true;press('KeyG');expect(actions.recoverVehicle).toHaveBeenCalledOnce();
  });
  it('keeps gameplay keys out of the open options menu and closes it with Escape without changing modes',()=>{const {actions,press,target}=setup({menuOpen:true,cycling:true});actions.closeMenu=vi.fn();const downstream=vi.fn();target.addEventListener('keydown',downstream);for(const key of ['KeyW','KeyF','KeyV','Space'])expect(press(key).defaultPrevented).toBe(true);expect(downstream).not.toHaveBeenCalled();press('Escape');expect(actions.closeMenu).toHaveBeenCalledOnce();expect(actions.escape).not.toHaveBeenCalled();expect(actions.togglePilot).not.toHaveBeenCalled();});
  it('routes bicycle dismount and helipad return before any vehicle movement listener',()=>{const {actions,press}=setup({walking:false,cycling:true});actions.exitVehicle=vi.fn();actions.returnToPad=vi.fn();expect(press('KeyE').defaultPrevented).toBe(true);expect(actions.exitVehicle).toHaveBeenCalledOnce();press('KeyF');expect(actions.exitVehicle).toHaveBeenCalledTimes(2);press('KeyH');expect(actions.returnToPad).toHaveBeenCalledOnce();});
  it('handles recording globally without passing F9 into the game, and limits presentation toggling to unobstructed play',()=>{
    const {state,actions,press,target}=setup({tourOpen:true,helpOpen:true});actions.record=vi.fn();actions.presentation=vi.fn();const downstream=vi.fn();target.addEventListener('keydown',downstream);
    expect(press('F9').defaultPrevented).toBe(true);press('F9',true);expect(actions.record).toHaveBeenCalledOnce();expect(downstream).not.toHaveBeenCalled();press('F8');expect(actions.presentation).not.toHaveBeenCalled();
    state.tourOpen=false;state.helpOpen=false;expect(press('F8').defaultPrevented).toBe(true);expect(actions.presentation).toHaveBeenCalledOnce();
  });
  it('closes the expanded map with M, preserves Tab focus, and permits reopening from its button',()=>{
    const {state,actions,press,target}=setup({tourOpen:true,mapOpen:true,helpOpen:true});
    expect(press('Tab').defaultPrevented).toBe(false);expect(actions.toggleHelp).not.toHaveBeenCalled();
    press('KeyM');expect(actions.toggleMap).toHaveBeenCalledOnce();
    state.tourOpen=false;state.mapOpen=false;state.helpOpen=false;Object.assign(target,{matches:(s:string)=>s.includes('button')});
    press('KeyM');expect(actions.toggleMap).toHaveBeenCalledTimes(2);
  });
  it('lets the tour modal own Tab focus and blocks gameplay until Escape closes it',()=>{
    const {state,actions,press,target}=setup({tourOpen:true,helpOpen:true,piloting:true,walking:false});
    expect(press('Tab').defaultPrevented).toBe(false);expect(actions.toggleHelp).not.toHaveBeenCalled();
    const gameplay=vi.fn();target.addEventListener('keydown',gameplay);
    for(const key of ['KeyW','Space','KeyJ','KeyM'])expect(press(key).defaultPrevented).toBe(true);
    expect(gameplay).not.toHaveBeenCalled();expect(actions.toggleFieldbook).not.toHaveBeenCalled();
    press('Escape');expect(state.helpOpen).toBe(false);expect(actions.releaseControls).toHaveBeenCalledOnce();expect(actions.escape).not.toHaveBeenCalled();
  });
  it('dismisses reading panels on explicit resume/track actions so keys are no longer blocked in any mode',()=>{
    for(const mode of ['walk','fly','car','helicopter']){
      const {state,press,target}=setup({walking:mode==='walk',driving:mode==='car',piloting:mode==='helicopter',helpOpen:true,fieldbookOpen:true});
      const downstream=vi.fn();target.addEventListener('keydown',downstream);
      expect(press('KeyW').defaultPrevented).toBe(true);expect(downstream).not.toHaveBeenCalled();
      const closeBook=vi.fn((open:boolean)=>{state.fieldbookOpen=open;}),closeHelp=vi.fn(()=>{state.helpOpen=false;});
      dismissReadingPanels({setOpen:closeBook},{get isHelpOpen(){return state.helpOpen;},toggleHelp:closeHelp});
      expect(closeBook).toHaveBeenCalledWith(false);expect(closeHelp).toHaveBeenCalledOnce();
      expect(press('KeyW').defaultPrevented).toBe(false);expect(downstream).toHaveBeenCalledOnce();
      expect(state.driving).toBe(mode==='car');expect(state.piloting).toBe(mode==='helicopter');expect(state.walking).toBe(mode==='walk');
    }
  });
  it('does not open a closed help panel or require a fieldbook in the isolated lab',()=>{
    const toggleHelp=vi.fn();dismissReadingPanels(undefined,{isHelpOpen:false,toggleHelp});expect(toggleHelp).not.toHaveBeenCalled();
  });
  it('consumes E before newly entered aircraft listeners can treat it as strafe',()=>{
    const {state,actions,target,press}=setup();const strafe=vi.fn();
    actions.interact=vi.fn(()=>{state.walking=false;state.piloting=true;});
    target.addEventListener('keydown',event=>{if(state.piloting&&(event as KeyboardEvent).code==='KeyE')strafe();});
    expect(press('KeyE').defaultPrevented).toBe(true);expect(actions.interact).toHaveBeenCalledOnce();expect(strafe).not.toHaveBeenCalled();
  });
  it('opens and closes Tab help in either vehicle without invoking exit',()=>{
    for(const driving of [true,false]){
      const {state,actions,press}=setup({walking:false,driving,piloting:!driving});
      expect(press('Tab').defaultPrevented).toBe(true);expect(state.helpOpen).toBe(true);
      press('Tab',true);expect(state.helpOpen).toBe(true);
      press('Tab');expect(state.helpOpen).toBe(false);expect(state.driving).toBe(driving);expect(state.piloting).toBe(!driving);expect(actions.escape).not.toHaveBeenCalled();
    }
  });
  it('blocks key repeats and tool hotkeys while the hand is reading an overlay',()=>{
    const {actions,target,press}=setup({fieldbookOpen:true});const gameplay=vi.fn();target.addEventListener('keydown',gameplay);
    for(const code of ['KeyW','KeyE','Space','Digit3','KeyR'])expect(press(code,true).defaultPrevented).toBe(true);
    expect(gameplay).not.toHaveBeenCalled();expect(actions.interact).not.toHaveBeenCalled();
  });
  it('toggles J even while a fieldbook button owns focus',()=>{
    const {state,target,press}=setup();Object.assign(target,{matches:()=>true});
    press('KeyJ');expect(state.fieldbookOpen).toBe(true);press('KeyJ');expect(state.fieldbookOpen).toBe(false);
  });
  it('closes reading panels with Escape and releases input without exiting the selected vehicle',()=>{
    const {state,actions,press}=setup({walking:false,driving:true,helpOpen:true,fieldbookOpen:true});
    press('Escape');expect(state.helpOpen).toBe(false);expect(state.fieldbookOpen).toBe(false);expect(state.driving).toBe(true);expect(actions.releaseControls).toHaveBeenCalledOnce();expect(actions.escape).not.toHaveBeenCalled();
    press('Escape');expect(actions.escape).toHaveBeenCalledOnce();
  });
  it('keeps aircraft E as a flying command and preserves ordinary UI key handling',()=>{
    const {actions,target,press}=setup({walking:false,piloting:true});const downstream=vi.fn();target.addEventListener('keydown',downstream);
    expect(press('KeyE').defaultPrevented).toBe(false);expect(downstream).toHaveBeenCalledOnce();expect(actions.interact).not.toHaveBeenCalled();
    Object.assign(target,{matches:()=>true});expect(press('KeyV').defaultPrevented).toBe(false);expect(actions.togglePilot).not.toHaveBeenCalled();
  });
});
