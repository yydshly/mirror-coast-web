export type SignalSite='cape-signal'|'forest-radio';
export class SignalTuning {
 bearing=18;frequency=25;progress=0;holding=false;completed=false;
 constructor(readonly site:SignalSite){}
 get targetBearing(){return this.site==='cape-signal'?57:38;}
 get strength(){const bearing=(this.bearing-this.targetBearing)/(this.site==='cape-signal'?9:15),frequency=this.site==='forest-radio'?(this.frequency-64)/12:0;return Math.exp(-.5*(bearing*bearing+frequency*frequency));}
 get aligned(){return Math.abs(this.bearing-this.targetBearing)<=3&&(this.site==='cape-signal'||Math.abs(this.frequency-64)<=3);}
 update(dt:number){if(this.completed)return false;this.progress=this.holding&&this.aligned?Math.min(1,this.progress+Math.min(.1,Math.max(0,dt))/1.6):Math.max(0,this.progress-dt*2);if(this.progress<1)return false;this.completed=true;this.holding=false;return true;}
}
export const FOREST_WALK=[{x:-90,z:-245},{x:-99,z:-239},{x:-102,z:-231},{x:-99,z:-225},{x:-88,z:-234}] as const;
export const OUTER_STOPS=[{id:'forest-glade',name:'松林 · 苔石林径',shortName:'林径',position:{x:-102,z:-231},approach:FOREST_WALK[0],trail:FOREST_WALK.slice(0,3),description:'蕨叶、苔石和低垂松枝围着一段林间小径。轻声靠近，鸟群会从枝头惊起；停下来，它们会回到林间。',access:'在山道尽头停车，沿林径慢走，再回到木阶登台调试电台。'}] as const;
