import {errorDetails} from './exit-journal.js';

export interface LifecycleActions {
  stopAdmission():void;
  drain():Promise<void>;
  observe():Promise<void>;
  status():Promise<any>;
  release():Promise<void>;
  close():Promise<void>;
  record(event:string,data?:unknown):Promise<void>;
  failed(error:unknown):void;
}
// EOF ends admission, not native execution. A timed-out child still owns an
// observer; the process must outlive it and its evidence writes.
export class ServiceLifecycle {
  private shutdown?:Promise<void>;
  closing=false;
  readonly errors:{stage:string;error:unknown}[]=[];
  constructor(private actions:LifecycleActions) {}
  request(reason:string,error?:unknown):Promise<void> {
    if(this.shutdown)return this.shutdown;
    this.closing=true;
    this.actions.stopAdmission();
    const hold=setInterval(()=>{},1000); // promises/lease files alone do not keep Node alive
    this.shutdown=this.finish(reason,error).finally(()=>clearInterval(hold));
    return this.shutdown;
  }
  private failure(stage:string,error:unknown) {this.errors.push({stage,error});this.actions.failed(error);}
  private async log(event:string,data:unknown={}) {try {await this.actions.record(event,data);}catch(error){this.failure('record:'+event,error);}}
  private async phase(stage:string,run:()=>Promise<unknown>) {
    try {await run();return true;}catch(error){this.failure(stage,error);await this.log('shutdown-error',{stage,error:errorDetails(error)});return false;}
  }
  private async finish(reason:string,error?:unknown) {
    if(error!==undefined)this.failure(reason,error);
    await this.log('shutdown-requested',{reason,...(error===undefined?{}:{error:errorDetails(error)})});
    await this.phase('drain',()=>this.actions.drain());
    // Even if draining failed, never skip the original child/late publication.
    await this.phase('observe',()=>this.actions.observe());
    await this.log('observations-settled');
    let status:any;
    await this.phase('status',async()=>{status=await this.actions.status();});
    const pending=status?.data?.pending;
    if(!this.errors.length&&status?.status==='succeeded'&&status.data?.writeFrozen===false&&Array.isArray(pending)&&pending.length===0)
      await this.phase('release',()=>this.actions.release());
    else await this.log('lease-retained',{reason:'Original release prerequisites not met',status:status?.status??null,
      writeFrozen:status?.data?.writeFrozen??null,pendingCount:Array.isArray(pending)?pending.length:null});
    await this.phase('transport-close',()=>this.actions.close());
    await this.log('shutdown-completed',{errorCount:this.errors.length,operationSuccessNotImplied:true});
  }
}
