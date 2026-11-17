export type GraphicsRecoveryState={active:boolean;restored:boolean;save:'saving'|'saved'|'error';message:string};
type Options={pause:()=>void;save:()=>Promise<void>;resume:(saved:boolean)=>void;reload:()=>void;change:(state:GraphicsRecoveryState)=>void;timeoutMs?:number};

/** Keep simulation/input paused until an explicit action. Persistence failure
 * never becomes permission to discard the in-memory world by reloading. */
export class GraphicsRecovery{
 private value:GraphicsRecoveryState={active:false,restored:false,save:'saved',message:''};
 private pending:Promise<boolean>|undefined;
 constructor(private options:Options){}
 get active(){return this.value.active;}
 get state():GraphicsRecoveryState{return{...this.value};}
 private emit(){this.options.change(this.state);}
 lost(){
  this.value.active=true;this.value.restored=false;this.options.pause();this.emit();
  if(!this.pending)void this.save();
 }
 restored(){if(!this.value.active)return;this.value.restored=true;this.emit();}
 save():Promise<boolean>{
  if(this.pending)return this.pending;
  this.value.save='saving';this.value.message='正在保存暂停现场…';this.emit();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('保存尚未确认，现场仍保留在内存中。请导出备份，或重试保存。')),this.options.timeoutMs??8000);});
  this.pending=Promise.race([Promise.resolve().then(()=>this.options.save()),timeout]).then(()=>{
   this.value.save='saved';this.value.message='暂停现场已保存到此浏览器。';return true;
  },error=>{
   this.value.save='error';this.value.message=error instanceof Error?error.message:String(error);return false;
  }).finally(()=>{if(timer!==undefined)clearTimeout(timer);this.pending=undefined;this.emit();});
  return this.pending;
 }
 resume():boolean{
  if(!this.value.active||!this.value.restored||this.value.save==='saving')return false;
  const saved=this.value.save==='saved';
  try{this.options.resume(saved);}catch(error){this.value.restored=false;this.value.message=`画面恢复未完成：${error instanceof Error?error.message:String(error)}。请保存后重新加载。`;this.emit();return false;}
  this.value.active=false;this.emit();return true;
 }
 async reload():Promise<boolean>{
  if(!this.value.active||!await this.save())return false;
  this.options.reload();return true;
 }
}
