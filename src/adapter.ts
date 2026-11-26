import {ResidentChannel} from './resident.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {randomUUID} from 'node:crypto';
import {probeProcess,type ProcessProbe} from './lease-process.js';
import {publishProcessEvidence,exitVerdict,evidenceFileHash,type ExecutionBinding,type ProcessStartEvidence,type ExitObservation,type EvidenceWriter} from './process-exit.js';
import { spawn } from 'node:child_process';
import {NORMAL_CLOSE_GUID,normalCloseHashes,normalCloseVerdict} from './normal-close.js';
import { DomainError, type Reply } from './contracts.js';
import { atomicJson, readJson, digest, canonical } from './storage.js';
import {exclusiveJson,errorDetails,diagnosticStderr} from './exit-journal.js';

export interface Config {
  dataDir: string; executable: string; profile: string; noUI: boolean;
  timeoutMs: number; responseWaitMs: number; testMode: boolean; fixture?: string;
}
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function configuration(env = process.env): Config {
  return {
    dataDir:path.resolve(env.INOPRO_DATA_DIR || path.join(ROOT,'.local','service')),
    executable:env.INOPRO_EXE || 'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe',
    profile:env.INOPRO_PROFILE || 'InoProShop(V1.9.1.6)',
    noUI:env.INOPRO_NO_UI==='true', timeoutMs:Number(env.INOPRO_TIMEOUT_MS || 120000),
    responseWaitMs:Number(env.INOPRO_RESPONSE_WAIT_MS || 800),
    testMode:env.INOPRO_TEST_MODE==='fixture',fixture:env.INOPRO_TEST_FIXTURE
  };
}
export type PromptStage = 'initial-open' | 'reopen';
export interface BridgeRequest { operationId: string; requestId?:string; requestFingerprint?:string; command: string; projectPath: string; args: any; fileGuard?:{mode:'direct';expectedDiskHash:string}; promptPolicy?:'library-info-open-stages-v2'; promptStages?:PromptStage[]; }
export interface Adapter {
  execute(request: BridgeRequest, directory: string, onStart: (pid:number,evidence?:ProcessStartEvidence)=>Promise<void>): Promise<Reply>;
  reconcile(directory: string,expected?:ExecutionBinding & {launchId?:string}): Promise<Reply | undefined>;
  waitForObservations?():Promise<void>;
  executeResident?(request:BridgeRequest,directory:string,onStart:(pid:number,launchId:string)=>Promise<void>):Promise<Reply>;
  residentOwned?():boolean;
}
export class IdeAdapter implements Adapter {
  private resident?:ResidentChannel;
  residentOwned(){return this.resident?.owned()??false;}
  executeResident(request:BridgeRequest,directory:string,onStart:(pid:number,launchId:string)=>Promise<void>){
    return (this.resident??=new ResidentChannel(this.config,ROOT)).execute(request,directory,onStart);
  }
  private pending=new Set<Promise<unknown>>();
  private observationFailures=new Map<string,any>();
  constructor(readonly config: Config, private readonly spawnProcess: typeof spawn = spawn,
    private readonly observations:{probe?:ProcessProbe;writeEvidence?:EvidenceWriter;writeDiagnostic?:EvidenceWriter;reportDiagnostic?:(value:unknown)=>unknown}={}) {}
  private track<T>(promise:Promise<T>):Promise<T> {this.pending.add(promise);promise.then(()=>this.pending.delete(promise),()=>this.pending.delete(promise));return promise;}
  async waitForObservations(){while(this.pending.size)await Promise.allSettled([...this.pending]);await this.resident?.observe();}
  async execute(request: BridgeRequest, directory: string, onStart: (pid:number,evidence?:ProcessStartEvidence)=>Promise<void>): Promise<Reply> {
    if(this.residentOwned())throw new DomainError('conflict','RESIDENT_TOOL_NOT_ADAPTED','本服务持有resident工程；禁止启动旧批处理路径');
    return this.track(this.executeObserved(request,directory,onStart));
  }
  private async executeObserved(request: BridgeRequest, directory: string, onStart: (pid:number,evidence?:ProcessStartEvidence)=>Promise<void>): Promise<Reply> {
    if(this.config.noUI)throw new DomainError('unsupported','NORMAL_CLOSE_REQUIRES_UI','公开正常关闭需要已验 UI 宿主；未启动 IDE 或派发工程操作');
    try { await fs.access(this.config.executable); }
    catch { throw new DomainError('unsupported','IDE_MISSING',`未找到 InoProShop：${this.config.executable}`); }
    await fs.mkdir(directory,{recursive:true});
    const requestFile=path.join(directory,'request.json');
    // Hash the JSON representation actually published (optional undefined fields are omitted).
    const persisted=JSON.parse(JSON.stringify({...request,exitEvidenceVersion:1,launchId:randomUUID(),
      normalClosePolicy:{version:1,commandGuid:NORMAL_CLOSE_GUID,
        workerHash:digest(await fs.readFile(path.join(ROOT,'bridge','worker.py'))),
        helperHash:digest(await fs.readFile(path.join(ROOT,'bridge','native_exit.py')))},
      ...(request.promptPolicy==='library-info-open-stages-v2'?{promptDeadlineUtc:new Date(Date.now()+Math.max(0,this.config.timeoutMs-5000)).toISOString()}:{}),
      resultPath:path.join(directory,'result.json'),...(request.command==='new_project'?{ideExecutable:this.config.executable}:{checkpointPath:path.join(directory,'checkpoint.project')})}));
    await atomicJson(requestFile,persisted);
    const option=(name:string,value:string)=> {
      if(/["\r\n]/.test(value)) throw new DomainError('failed','INVALID_LAUNCH_ARGUMENT','启动参数包含不支持的引号或换行');
      return process.platform==='win32'?`--${name}="${value}"`:`--${name}=${value}`;
    };
    // 此 OEM 按 --key="value" 解析原始命令行；Node 将整个 --key=value 加引号的方式会丢失含空格参数。
    const args=[option('profile',this.config.profile),...(this.config.noUI?['--noUI']:[]),option('runscript',path.join(ROOT,'bridge','worker.py'))];
    const stdout=await fs.open(path.join(directory,'stdout.txt'),'a');
    const stderr=await fs.open(path.join(directory,'stderr.txt'),'a');
    let child;
    const launchedAt=new Date().toISOString();
    try { child=this.spawnProcess(this.config.executable,args,{cwd:path.dirname(this.config.executable),shell:false,windowsHide:true,windowsVerbatimArguments:process.platform==='win32',env:{...process.env,INOPRO_BRIDGE_REQUEST:requestFile},stdio:['ignore',stdout.fd,stderr.fd]}); }
    catch(e) {await Promise.allSettled([stdout.close(),stderr.close()]);throw e;}
    let exited=false,startValue:ProcessStartEvidence|undefined,timedOut=false;
    const runtimeReports:Promise<void>[]=[];
    const binding={operationId:request.operationId,requestId:request.requestId??'',requestFingerprint:request.requestFingerprint??'',
      launchId:persisted.launchId,requestHash:digest(canonical(persisted))};
    const publicationFailure=async(stage:string,error:unknown,exit?:ExitObservation)=>{
      const value={binding,pid:child.pid??null,process:startValue?.process??{state:'unconfirmed',reason:'start-evidence-unavailable'},
        observedAt:new Date().toISOString(),stage,timedOut,error:errorDetails(error),...(exit?{observedExit:exit}:{})};
      // Sticky in memory before the first await, including when all writes fail.
      if(!this.observationFailures.has(directory))this.observationFailures.set(directory,value);
      try {await publishProcessEvidence(path.join(directory,stage+'-publication-error.json'),value,this.observations.writeDiagnostic??exclusiveJson);}
      catch(recordError){const diagnostic={kind:'process-evidence-diagnostic-failed',directory,...value,recordError:errorDetails(recordError)};
        try {(this.observations.reportDiagnostic??diagnosticStderr)(diagnostic);}catch(reportError){diagnosticStderr({...diagnostic,reportError:errorDetails(reportError)});}}
    };
    const completion=new Promise<ExitObservation>(resolve=>{
      child.once('error',(e:any)=>{
        if(!child.pid)resolve({state:'spawn-error',code:null,signal:null,observedAt:new Date().toISOString(),error:errorDetails(e)});
        else runtimeReports.push(this.track(publicationFailure('process-runtime',e))); // an error with a PID does not prove exit
      });
      child.once('exit',(code,signal)=>{exited=true;resolve({state:'exited',code,signal:signal??null,observedAt:new Date().toISOString()});});
      child.once('close',(code,signal)=>{if(!exited&&child.pid)resolve({state:'unconfirmed',code:null,signal:null,
        observedAt:new Date().toISOString(),error:{name:'ExitEventMissing',message:'close without exit event; close code='+String(code)+' signal='+String(signal)}});});
    });
    const streamsClosed=Promise.allSettled([stdout.close(),stderr.close()]);
    const start=(async():Promise<ProcessStartEvidence>=>{
      const observation=child.pid?await (this.observations.probe??probeProcess)(child.pid).catch((e:any)=>({state:'unconfirmed' as const,reason:e.message})):
        {state:'unconfirmed' as const,reason:'no-spawned-pid'};
      const process=exited?{state:'unconfirmed' as const,reason:'exited-before-creation-identity-confirmed'}:observation;
      const value:ProcessStartEvidence={binding,
        pid:child.pid??null,process,observedAt:launchedAt};
      startValue=value;
      const closed=await streamsClosed;
      const failed=closed.find(r=>r.status==='rejected');
      if(failed?.status==='rejected')throw failed.reason;
      try {await publishProcessEvidence(path.join(directory,'process-start.json'),value,this.observations.writeEvidence??exclusiveJson);}
      catch(error){await publicationFailure('process-start',error);throw error;}
      return value;
    })();
    // Keep observing after a timeout; never kill or replay the original process.
    const published=this.track(completion.then(async exit=>{
      try {
      const s=await start;
      await Promise.all(runtimeReports);
      await publishProcessEvidence(path.join(directory,'process-exit.json'),{...exit,binding:s.binding,pid:s.pid,
        processIdentity:s.process.state==='running'?s.process.identity:null,startHash:digest(canonical(s)),
        observerFailure:this.observationFailures.get(directory)??null,
        resultHash:await evidenceFileHash(path.join(directory,'result.json')),
        normalCloseHashes:await normalCloseHashes(directory),
        normalCloseStderrHash:await evidenceFileHash(path.join(directory,'stderr.txt')),
        dispatchHash:await evidenceFileHash(path.join(directory,'dispatched.json'))},this.observations.writeEvidence??exclusiveJson);
      return {exit};
      }catch(error:any){await publicationFailure('process-exit',error,exit);return {exit,error};}
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([(async()=>{
        let s:ProcessStartEvidence;
        try {s=await start;}catch(e:any){throw new DomainError('unknown','EXIT_EVIDENCE_PUBLISH_FAILED',e.message);}
        if(child.pid)await onStart(child.pid,s);
        const outcome=await published;
        if(timedOut)throw new DomainError('unknown','IDE_TIMEOUT','原操作已超时，仅发布退出证据，等待显式核对');
        const firstObservation=this.observationFailures.get(directory);
        if(firstObservation?.stage==='process-runtime'&&'error' in outcome)return {
          contractVersion:'1.0.0' as const,operationId:request.operationId,status:'unknown' as const,summary:'进程观察首错及退出证据发布错误分别保留，禁止重放',
          error:{code:'EXIT_OBSERVER_FAILED',message:firstObservation.error.message},
          data:{observationFailure:firstObservation,observedExit:outcome.exit,publicationError:errorDetails(outcome.error),
            priorResult:await readJson(path.join(directory,'result.json')).catch(()=>null)}};
        if('error' in outcome)return {contractVersion:'1.0.0' as const,operationId:request.operationId,status:'unknown' as const,
          summary:'进程退出证据发布失败，保留原操作，禁止重放',
          error:{code:'EXIT_EVIDENCE_PUBLISH_FAILED',message:outcome.error.message},
          data:{observedExit:outcome.exit,publicationError:{message:outcome.error.message,stack:outcome.error.stack},
            priorResult:await readJson(path.join(directory,'result.json')).catch(()=>null)}};
        const result=await this.reconcile(directory);
        if(!result)throw new DomainError('unknown','RESULT_MISSING','IDE 已退出，缺少完整结果，禁止重放');
        if(result.status==='succeeded'&&result.data&&request.command!=='catalog'&&request.command!=='device_catalog'&&
          (request.command!=='new_project'||await fs.access(request.projectPath).then(()=>true,()=>false))) {
          if(result.data.diskHash!==undefined)result.data.workerDiskHash??=result.data.diskHash;
          result.data.diskHash=digest(await fs.readFile(request.projectPath));result.data.postExitDiskHashObserved=true;
          await atomicJson(path.join(directory,'observed-after-exit.json'),result);
        }
        return result;
      })(),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{timedOut=true;reject(new DomainError('unknown','IDE_TIMEOUT','IDE 超时；其操作可能仍在执行，未终止进程。请查询原操作并核对。'));},this.config.timeoutMs);
      })]);
    } finally {if(timer)clearTimeout(timer);}
  }
  async reconcile(directory: string,expected?:ExecutionBinding & {launchId?:string}): Promise<Reply | undefined> {
    const request=await readJson(path.join(directory,'request.json'));
    // Reconstruct from the original bridge file, not a cached successful response.
    const response=await readJson(path.join(directory,'result.json'));
    const previous=await readJson(path.join(directory,'observed-after-exit.json'));
    if(!request&&!response)return;
    if(!request||(response&&response.operationId!==request.operationId))
      throw new DomainError('unknown','RESULT_ID_MISMATCH','桥接结果与原操作不匹配');
    const observationFailure=this.observationFailures.get(directory);
    if(observationFailure?.stage==='process-runtime')return {contractVersion:'1.0.0',operationId:request.operationId,status:'unknown',
      summary:'已观察到进程错误；正常退出不能消除此错误，保留原异常和现场',
      error:{code:'EXIT_OBSERVER_FAILED',message:observationFailure.error.message},
      data:{priorResult:response??null,observationFailure}};
    const verdict=await exitVerdict(directory,request,expected,this.observations.probe);
    const uncertain=(code:string):Reply=>({contractVersion:'1.0.0',operationId:request.operationId,status:'unknown',
      summary:'进程退出证据无法确认整体成功；保留原始结果与现场，不重放',
      error:{code,message:'桥接结果不能替代同一进程实例的正常退出证据'},
      data:{priorResult:response??null,processExitEvidence:verdict,evidenceDirectory:directory}});
    if(!verdict.confirmed)return uncertain(verdict.code);
    const dispatched=await readJson(path.join(directory,'dispatched.json'));
    if(dispatched&&(dispatched.operationId!==request.operationId||(dispatched.pid!==undefined&&dispatched.pid!==verdict.start.pid)))
      return uncertain('DISPATCH_ID_MISMATCH');
    if(!response&&!dispatched&&(verdict.notStarted||verdict.exit.state==='exited'))
      return {contractVersion:'1.0.0',operationId:request.operationId,status:'failed',
        summary:'已确认进程结束且未发布派发标记；工程命令未执行',
        error:{code:'NOT_DISPATCHED',message:'桥接保证发布派发标记后才访问工程；未重放原请求'}};
    if(!verdict.normal)return uncertain('IDE_ABNORMAL_EXIT');
    if(!response)return uncertain('RESULT_MISSING');
    if(!dispatched)return uncertain('DISPATCH_EVIDENCE_MISSING');
    const close=await normalCloseVerdict(directory,request,verdict);
    if(!close.confirmed){const r=uncertain(close.code!);r.data!.normalCloseEvidence=close;return r;}
    if(previous?.operationId===request.operationId&&previous.status==='unknown'&&previous.error?.code==='READ_ONLY_FILE_CHANGED')return previous;
    if(request.command==='clear_placeholder'&&previous?.operationId===request.operationId&&
      previous.status==='unknown'&&previous.error?.code==='CLEAR_SAVED_DISK_CHANGED')return previous;
    if(request.command==='clear_placeholder'&&response.status==='succeeded'){
      const current=digest(await fs.readFile(request.projectPath));
      if(response.data?.diskHash!==current){
        const failed:Reply={contractVersion:'1.0.0',operationId:request.operationId,status:'unknown',
          summary:'占位符清除保存读回与可信退出后的文件不同；保留现场，不恢复或重放',
          error:{code:'CLEAR_SAVED_DISK_CHANGED',message:'Saved clear evidence differs from the post-exit file'},
          data:{priorResult:response,workerDiskHash:response.data?.diskHash,observedDiskHash:current,processExitEvidence:verdict}};
        await atomicJson(path.join(directory,'observed-after-exit.json'),failed);return failed;
      }
      response.data.workerDiskHash=current;response.data.postExitDiskHashObserved=true;
      await atomicJson(path.join(directory,'observed-after-exit.json'),response);
    }
    if(request.command==='new_project'&&response.status==='succeeded') {
      const current=digest(await fs.readFile(request.projectPath));
      if(response.data?.diskHash!==current||response.data?.creationEvidence?.savedDiskHash!==current)
        throw new DomainError('unknown','CREATE_DISK_CHANGED','新建结果与退出后的指定文件不同，保持冻结');
      response.data.postExitDiskHashObserved=true;
      await atomicJson(path.join(directory,'observed-after-exit.json'),response);
    }
    if(['task_create','task_call_append','task_call_replace'].includes(request.command)&&response.status==='succeeded') {
      const current=digest(await fs.readFile(request.projectPath));
      if(response.data?.diskHash!==current||response.data?.savedDiskHash!==current)
        throw new DomainError('unknown','TASK_SAVED_DISK_CHANGED',request.command==='task_create'?
          '任务创建的保存读回与退出后的文件不同，保持冻结':'调用列表的保存读回与退出后的文件不同，保持冻结');
      response.data.workerDiskHash=current;
      response.data.postExitDiskHashObserved=true;
      await atomicJson(path.join(directory,'observed-after-exit.json'),response);
    }
    if(['search','tasks','structure','device','io_mapping','libraries','compare_capture'].includes(request.command) || request.fileGuard&&['inspect','list','read'].includes(request.command)) {
      if(response.status==='unknown'&&response.error?.code==='READ_ONLY_FILE_CHANGED')return response;
      const after=digest(await fs.readFile(request.projectPath)),e=response.data?.readOnlyEvidence;
      const expected=request.fileGuard?.expectedDiskHash??request.args.readDiskHash;
      // A pre-open version conflict is a confirmed rejection, not an uncertain write.
      if(response.status==='conflict'&&response.error?.code==='PROJECT_FILE_CHANGED'&&request.fileGuard)return response;
      if(after!==expected || (response.status==='succeeded' && (!e || e.beforeDiskHash!==expected || e.afterCloseDiskHash!==after || e.unchanged!==true))) {
        const failed:Reply={contractVersion:'1.0.0',operationId:request.operationId,status:'unknown',summary:'只读操作的文件证据不一致，结果不可信，保持冻结',
          error:{code:'READ_ONLY_FILE_CHANGED',message:'未自动保存、恢复或重放；请核对原操作和文件'},data:{priorResult:response,expectedDiskHash:request.args.readDiskHash,observedDiskHash:after}};
        await atomicJson(path.join(directory,'observed-after-exit.json'),failed);return failed;
      }
      if(response.status==='succeeded') {
        response.data.workerDiskHash ??= response.data.diskHash;response.data.diskHash=after;
        response.data.readOnlyEvidence={...e,postExitDiskHash:after};response.data.postExitDiskHashObserved=true;
        await atomicJson(path.join(directory,'observed-after-exit.json'),response);
      }
    }
    return response;
  }
}
