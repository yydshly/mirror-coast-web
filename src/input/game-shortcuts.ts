export type GameShortcutState={ready:boolean;isLab:boolean;helpOpen:boolean;menuOpen?:boolean;tourOpen?:boolean;mapOpen?:boolean;fieldbookOpen:boolean;hasFieldbook:boolean;walking:boolean;piloting:boolean;driving:boolean;cycling?:boolean;observing:boolean};
export type GameShortcutActions={toggleHelp:()=>void;toggleFieldbook:()=>void;closeFieldbook:()=>void;closeMenu?:()=>void;releaseControls:()=>void;escape:()=>void;togglePilot:()=>void;home:()=>void;toggleMap:()=>void;interact:()=>void;record?:()=>void;presentation?:()=>void;exitVehicle?:()=>void;returnToPad?:()=>void};
const movementKeys=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyZ','KeyC','KeyX','Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Digit1','Digit2','Digit3','KeyR','KeyV','KeyH']);

/** Capture-level routing: a consumed interaction must not control a newly entered vehicle. */
export function handleGameShortcut(event:KeyboardEvent,state:GameShortcutState,actions:GameShortcutActions):boolean{
  if(!state.ready)return false;
  const uiFocus=!!(event.target as HTMLElement|null)?.matches?.('input,textarea,select,button,summary,a,[role="button"],[contenteditable="true"]');
  const consume=()=>{event.preventDefault();event.stopImmediatePropagation();};
  if(state.menuOpen){
    if(event.code==='Escape'){consume();actions.closeMenu?.();return true;}
    if(uiFocus)return false;
    if(movementKeys.has(event.code)||['Tab','KeyJ','KeyM','KeyF','KeyV','F8','F9'].includes(event.code)){consume();return true;}
    return false;
  }
  if(event.code==='F9'&&actions.record){consume();if(!event.repeat)actions.record();return true;}
  if(event.code==='F8'&&!state.tourOpen&&!state.helpOpen&&!state.fieldbookOpen&&actions.presentation){consume();if(!event.repeat)actions.presentation();return true;}
  if(state.tourOpen){
    if(event.code==='KeyM'&&state.mapOpen){consume();if(!event.repeat)actions.toggleMap();return true;}
    if(event.code==='Escape'){consume();actions.toggleHelp();actions.releaseControls();return true;}
    // The native modal owns Tab focus and its buttons; game shortcuts must not
    // switch modes or open another overlay while the route is being read.
    if(event.code==='Tab'||uiFocus)return false;
    if(movementKeys.has(event.code)||['KeyJ','KeyM'].includes(event.code)){consume();return true;}
    return false;
  }
  if(event.code==='Tab'){
    consume();if(!event.repeat)actions.toggleHelp();return true;
  }
  if(event.code==='KeyJ'&&state.hasFieldbook&&!state.isLab){
    consume();if(!event.repeat)actions.toggleFieldbook();return true;
  }
  if(event.code==='Escape'){
    consume();
    if(state.helpOpen||state.fieldbookOpen){if(state.helpOpen)actions.toggleHelp();if(state.fieldbookOpen)actions.closeFieldbook();actions.releaseControls();}
    else actions.escape();
    return true;
  }
  if(state.helpOpen||state.fieldbookOpen){
    // Repeated keys that were held before opening cannot re-arm gameplay. UI
    // controls keep their own keyboard behavior; vehicle listeners ignore them.
    if(!uiFocus&&movementKeys.has(event.code)){consume();return true;}
    return false;
  }
  if(event.code==='KeyM'&&!state.isLab&&!(event.target as HTMLElement|null)?.matches?.('input,textarea,select,[contenteditable="true"]')){consume();if(!event.repeat)actions.toggleMap();return true;}
  if(uiFocus||event.repeat||state.isLab)return false;
  if(event.code==='KeyF'&&(state.piloting||state.driving||state.cycling)&&actions.exitVehicle){consume();actions.exitVehicle();return true;}
  if(event.code==='KeyH'&&actions.returnToPad){consume();actions.returnToPad();return true;}
  if(event.code==='KeyE'&&state.cycling&&actions.exitVehicle){consume();actions.exitVehicle();return true;}
  if(event.code==='KeyE'&&state.walking&&!state.piloting&&!state.driving&&state.observing){consume();actions.interact();return true;}
  if(event.code==='KeyV'){consume();actions.togglePilot();return true;}
  if(event.code==='KeyH'&&state.piloting){consume();actions.home();return true;}
  return false;
}
