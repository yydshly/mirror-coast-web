/** A slow, bounded response to sustained GPU load. CPU stalls/loading and hidden
 * tabs do not lower image quality. Interface text/maps retain native resolution. */
export class AdaptiveResolution{
  scale=1;private duration=0;private frames=0;private frameMs=0;private renderMs=0;private cpuMs=0;private stableFast=0;
  update(dt:number,renderMs:number,cpuMs:number,enabled=true):boolean{
    if(!enabled||dt<=0||dt>.75)return false;
    this.duration+=dt;this.frames++;this.frameMs+=dt*1000;this.renderMs+=renderMs;this.cpuMs+=cpuMs;
    if(this.duration<3)return false;
    const ms=this.frameMs/this.frames,gpuLimited=this.renderMs>this.cpuMs*1.2;
    this.duration=this.frames=this.frameMs=this.renderMs=this.cpuMs=0;
    const before=this.scale;
    if(ms>31&&gpuLimited){this.scale=Math.max(.8,Math.round((this.scale-.05)*100)/100);this.stableFast=0;}
    else if(ms<21){if(++this.stableFast>=3){this.scale=Math.min(1,Math.round((this.scale+.05)*100)/100);this.stableFast=0;}}
    else this.stableFast=0;
    return this.scale!==before;
  }
}
