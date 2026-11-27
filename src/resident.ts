import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {DomainError,replySchema,type Reply} from './contracts.js';
import {digest,codeHash,pathKey,readJson} from './storage.js';
import {exclusiveJson,errorDetails} from './exit-journal.js';
import {probeProcess,sameProcess,type ProcessIdentity,type ProcessProbe} from './lease-process.js';
import type {BridgeRequest,Config} from './adapter.js';
import {verifyResidentBuild} from './resident-build.js';
import {residentDisk,verifySavedAcceptance} from './resident-saved.js';

const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
export const residentHash=(v:unknown)=>digest(stable(v));
export const residentVersion=(dependencies:unknown,diskHash:string,acceptedBaseline?:string)=>residentHash({dependencies,diskHash,...(acceptedBaseline?{acceptedBaseline}:{})});
async function publishQueue(file:string,value:unknown){const tmp=file+'.publishing';await exclusiveJson(tmp,value);if(await fs.access(file).then(()=>true,()=>false))throw Error('Resident request already published');await fs.rename(tmp,file);}
const equal=(a:unknown,b:unknown)=>stable(a)===stable(b);
const uuid=(v:any)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
export function residentDependencies(s:any) {
 if(!s||typeof s.projectPath!=='string'||!Number.isSafeInteger(s.thread)||s.thread<=0||!Array.isArray(s.applications)||!s.nodes||!s.openedProjects||!Number.isSafeInteger(s.projectHandle)||s.projectHandle<0)throw Error('Resident state incomplete');
 const opened=Object.values(s.openedProjects) as any[],owned=s.openedProjects[String(s.projectHandle)];
 for(const [key,r] of Object.entries<any>(s.openedProjects))if(!r||!Number.isSafeInteger(r.handle)||r.handle<0||String(r.handle)!==key||typeof r.primary!=='boolean'||typeof r.library!=='boolean'||typeof r.path!=='string')throw Error('Malformed open-project ownership');
 if(!owned||!owned.primary||owned.library||pathKey(owned.path)!==pathKey(s.projectPath)||opened.some(r=>r!==owned&&(r.primary||!r.library)))throw Error('Owned project evidence differs');
 const selected=new Set<string>();
 for(const [id,r] of Object.entries<any>(s.nodes)){
  if(!uuid(id)||r.objectId!==id||!uuid(r.nativeTypeId)||!Array.isArray(r.path)||r.path.some((p:any)=>typeof p!=='string')||!['declaration','implementation'].every(k=>r[k]===null||typeof r[k]==='string')||!Array.isArray(r.embeddedObjectTypes)||r.embeddedObjectTypes.some((x:any)=>!uuid(x))||!(r.parentId===null||uuid(r.parentId))||!(r.applicationId===null||uuid(r.applicationId)))throw Error('Incomplete native object identity/source');
  if(r.applicationId!==null||r.declaration!==null||r.implementation!==null||r.embeddedObjectTypes.length||'taskFields'in r||'directLibraries'in r)selected.add(id);
 }
 for(let id of [...selected]){const seen=new Set<string>();while(id!==null){if(!s.nodes[id]||seen.has(id))throw Error('Missing/cyclic ancestry');seen.add(id);selected.add(id);id=s.nodes[id].parentId;}}
 if(new Set(s.applications).size!==s.applications.length||s.applications.some((id:any)=>!uuid(id)||!s.nodes[id]))throw Error('Application coverage differs');
 return {scheme:'resident-st-implementation-v1',projectPath:s.projectPath,projectHandle:s.projectHandle,thread:s.thread,applications:s.applications,nodes:Object.fromEntries([...selected].map(id=>[id,s.nodes[id]]))};
}

const ST_PART='3b83b776-fb25-43b8-99f2-3c507c9143fc',VAR_DECL_PART='a9ed5b7e-75c5-4651-af16-d2c27e98cb94';
// Declaration metadata may accompany ST. Raw arrays still participate in strict evidence/version checks.
const supportedStParts=(parts:unknown)=>equal(parts,[ST_PART])||equal(parts,[VAR_DECL_PART,ST_PART])||equal(parts,[ST_PART,VAR_DECL_PART]);
export function residentObject(state:any,oid:string,aid:string){
 const r=state.nodes[oid];
 if(!r||r.applicationId!==aid||r.parentId!==aid||!state.applications.includes(aid)||r.nativeTypeId!=='6f9dac99-8de1-4efc-8465-68ac443b7d08'||!supportedStParts(r.embeddedObjectTypes)||typeof r.declaration!=='string'||typeof r.implementation!=='string'||Object.values<any>(state.nodes).some(n=>n.parentId===oid))throw Error('Not a supported root ST POU');
 const m=/^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(r.declaration);if(!m||m[2].toLowerCase()!==r.path.at(-1).toLowerCase())throw Error('POU declaration/name differs');
 return {objectId:oid,applicationId:aid,path:r.path,nativeTypeId:r.nativeTypeId,embeddedObjectTypes:r.embeddedObjectTypes,language:'ST',objectType:m[1].toUpperCase()==='FUNCTION_BLOCK'?'function_block':'st_pou',hasImplementation:true,declaration:r.declaration,implementation:r.implementation,contentHash:codeHash(r.declaration,r.implementation)};
}
// Stable completion envelope. Closed-session proofs validate the original
// producer's bound service verification, not today's business classification.
export async function verifyResidentCompletion(request:any,result:Reply,directory:string,identity:ProcessIdentity) {
 const data=result.data as any,e=data?.residentEvidence,completed=await readJson(path.join(directory,'completed.json'));
 if(result.operationId!==request.operationId||result.requestId!==request.requestId||e?.requestHash!==residentHash(request)||e?.launchId!==request.launchId||e?.sequence!==request.sequence||!equal(e?.processIdentity,{pid:identity.pid,startId:identity.startId})||e?.requestCompleted!==true||e?.ideExitRequested!==false||!equal(completed,{launchId:request.launchId,sequence:request.sequence,processIdentity:e.processIdentity,requestHash:e.requestHash,resultHash:residentHash(result)}))throw Error('Resident completion/request/instance binding differs');
 if(result.status!=='succeeded'){if(data?.recoverableRejection===true&&(result.status!=='conflict'||data.firstError?.dispatched!==false||data.secondaryErrors?.length!==0||await readJson(path.join(directory,'dispatch.json'))))throw Error('Unproven zero-dispatch rejection');return;}
 if(data.saved!==false||data.closed!==false||data.reopened!==false||['saveCalls','closeCalls','exitCalls'].some(k=>data[k]!==0)||data.compileCalls!==(request.command==='build'?1:0)||data.sessionMode!=='resident')throw Error('Resident lifecycle evidence differs');
}
export async function verifyResidentResult(request:any,result:Reply,directory:string,identity:ProcessIdentity) {
 await verifyResidentCompletion(request,result,directory,identity);
 if(result.status!=='succeeded')return;
 const data=result.data as any;
 const before=await readJson(path.join(directory,'before.json'));if(pathKey(before?.state?.projectPath??'')!==pathKey(request.projectPath))throw Error('Snapshot belongs to another project');const deps=residentDependencies(before?.state),version=residentVersion(deps,before.diskHash,request.acceptedBaseline);
 if(before.diskHash!==request.diskHash)throw Error('Disk changed between dispatch and native read');
 let final=before.state,finalDeps=deps,baseline=request.acceptedBaseline;
 if(request.command==='accept_saved')baseline=await verifySavedAcceptance(request,data,directory,before);
 if(request.command==='build'){final=await verifyResidentBuild(request,data,directory,before,version);finalDeps=residentDependencies(final);}
 if(request.command==='change'){
  const a=request.args,target=deps.nodes[a.objectId];
  if(!target||a.expectedResidentVersion!==version||codeHash(target.declaration,target.implementation)!==a.expectedHash||a.declaration!==target.declaration||typeof a.implementation!=='string')throw Error('Change preconditions differ');
  const checkpoint=await readJson(path.join(directory,'checkpoint.json')),pre=await readJson(path.join(directory,'predispatch.json')),after=await readJson(path.join(directory,'after.json')),check=await readJson(path.join(directory,'verification.json')),dispatch=await readJson(path.join(directory,'dispatch.json'));
  if(!equal(checkpoint,{request,state:before.state,diskHash:before.diskHash,residentVersion:version})||!equal(residentDependencies(pre?.state),deps)||pre.diskHash!==before.diskHash||!equal(dispatch,{operationId:request.operationId,requestId:request.requestId,action:'replace-implementation'}))throw Error('Checkpoint/predispatch evidence differs');
  const expected=structuredClone(deps);expected.nodes[a.objectId].implementation=a.implementation;final=after?.state;finalDeps=residentDependencies(final);
  if(after.diskHash!==before.diskHash||!equal(expected,finalDeps)||!equal(check,{equal:true,expected,actual:finalDeps})||data.memoryModified!==true||data.persistedToProject!==false)throw Error('Written state preservation differs');
 }
 if(data.snapshot!==residentHash(finalDeps)||data.residentVersion!==residentVersion(finalDeps,before.diskHash,baseline)||data.diskHash!==before.diskHash||data.projectHandle!==final.projectHandle)throw Error('Result state/version differs');
 const applications=before.state.applications.map((id:string)=>({applicationId:id,path:before.state.nodes[id].path}));
 const aid=request.args.applicationId??(applications.length===1?applications[0].applicationId:undefined);
 if(!aid||data.applicationId!==aid||!equal(data.applications,applications))throw Error('Application identity differs');
 if(['read','change'].includes(request.command)){const obj=residentObject(final,request.args.objectId,aid);for(const [k,v] of Object.entries(obj))if(!equal(data[k],v))throw Error('Object result differs: '+k);}
 if(request.command==='list'){
  const rows:any[]=[],excluded:any[]=[];for(const id of Object.keys(before.state.nodes).sort()){const r=before.state.nodes[id];if(r.applicationId!==aid)continue;try{rows.push(residentObject(before.state,id,aid));}catch{excluded.push({objectId:id,path:r.path});}}
  if(!Array.isArray(data.excluded)||!equal(data.excluded.map((r:any)=>({objectId:r.objectId,path:r.path})),excluded)||data.excluded.some((r:any)=>typeof r.reason!=='string'||!r.reason))throw Error('Excluded object coverage differs');
  const offset=request.args.offset??0,limit=request.args.limit??50,selected=rows.slice(offset,offset+limit).map(({declaration,implementation,...r})=>r);
  if((offset&&!request.args.expectedResidentVersion)||(request.args.expectedResidentVersion&&request.args.expectedResidentVersion!==version)||!equal(data.objects,selected)||data.total!==rows.length||data.complete!==true||data.nextOffset!==(offset+selected.length<rows.length?offset+selected.length:null))throw Error('List coverage/pagination differs');
 }

}

export class ResidentChannel {
 private originalFileId?:string;
 private acceptedBaseline?:string;private lastVersion?:string;private lastDiskHash?:string;private lastHandle?:number;
 private child?:ChildProcess;private identity?:ProcessIdentity;private root?:string;private launchId?:string;private project?:string;private sequence=0;
 private failure?:unknown;private exited=false;private exitObservation?:Promise<void>;private observationSettled=false;private exitRecord?:any;private busy=false;
 constructor(private config:Config,private productRoot:string,private hooks:{spawn?:typeof spawn;probe?:ProcessProbe;occupancy?:()=>Promise<void>}={}){}
 owned(){return !!this.child;}
 async observe(){if(this.child)await this.exitObservation;}
 async assertReleaseReady(){
  if(!this.child)return;
  const fail=()=>new DomainError('conflict','RESIDENT_LEASE_RETAINED','原IDE正常退出及取证未完整确认；不关闭、保存或释放');
  if(this.busy||this.failure||!this.exited||!this.observationSettled||!this.identity||!this.root||!this.exitRecord)throw fail();
  const [start,exit]=await Promise.all([readJson(path.join(this.root,'process-start.json')),readJson(path.join(this.root,'process-exit.json'))]);
  if(start?.launchId!==this.launchId||!equal(start.processIdentity,this.identity)||!equal(exit,this.exitRecord)||
   exit?.launchId!==this.launchId||exit?.pid!==this.identity.pid||!equal(exit?.processIdentity,this.identity)||exit?.code!==0||exit?.signal!==null||
   exit?.lastSequence!==this.sequence||!Number.isFinite(Date.parse(exit?.at??'')))throw fail();
  // Retain child/ownership: a normal exit permits lease release only during
  // server shutdown, never batch fallback, relaunch or cross-service takeover.
 }
 private async live(){if(this.failure)throw this.failure;if(this.exited||!this.child?.pid||!this.identity)throw new DomainError('unknown','RESIDENT_INSTANCE_LOST','原IDE实例无法确认；不重开或重放');const p=await(this.hooks.probe??probeProcess)(this.child.pid);if(p.state!=='running'||!sameProcess(p.identity,this.identity))throw new DomainError('unknown','RESIDENT_INSTANCE_CHANGED','原IDE创建身份或运行状态不符');}
 private async wait(file:string,deadline:number){for(;;){await this.live();const fail=await readJson(path.join(this.root!,'first-error.json'));if(fail)throw new DomainError('unknown','RESIDENT_NATIVE_ERROR',JSON.stringify(fail));const value=await readJson(file);if(value)return value;if(await readJson(path.join(this.root!,'receiver-stopped.json')))throw new DomainError('unknown','RESIDENT_RECEIVER_STOPPED','原接收器已停止，保留现场');if(Date.now()>=deadline)throw new DomainError('unknown','RESIDENT_TIMEOUT','本次请求超时，停止派发；不关闭或重放');await new Promise(r=>setTimeout(r,50));}}
 private async launch(project:string){
  if(this.config.noUI)throw new DomainError('unsupported','RESIDENT_REQUIRES_UI','此原生主线程入口需要UI宿主；不自动降级');
  if(this.hooks.occupancy)await this.hooks.occupancy();else {
   if(process.platform!=='win32')throw new DomainError('unsupported','RESIDENT_WINDOWS_ONLY','当前限定本机Windows原生接口');
   const r=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-Process -Name InoProShop -ErrorAction SilentlyContinue).Count"],{windowsHide:true});
   if(r.stdout.trim()!=='0')throw new DomainError('conflict','RESIDENT_IDE_BUSY','已有IDE实例，不能接管或并行启动');
  }
  const original=await fs.stat(project,{bigint:true});this.originalFileId=`${original.dev}:${original.ino}`;
  this.launchId=randomUUID();this.root=path.join(this.config.dataDir,'resident',this.launchId);this.project=project;await fs.mkdir(this.root,{recursive:true});
  const corePath=path.join(this.productRoot,'bridge','resident_core.py'),script=path.join(this.productRoot,'bridge','resident_host.py');
  const intent={directory:this.root,projectPath:project,originalFileId:this.originalFileId,launchId:this.launchId,corePath,coreHash:digest(await fs.readFile(corePath)),scriptHash:digest(await fs.readFile(script)),deadlineUtc:new Date(Date.now()+this.config.timeoutMs).toISOString()};
  const intentPath=path.join(this.root,'intent.json');await exclusiveJson(intentPath,intent);
  const option=(k:string,v:string)=>{if(/["\r\n]/.test(v))throw Error('Invalid launch path');return process.platform==='win32'?`--${k}="${v}"`:`--${k}=${v}`;};
  const out=await fs.open(path.join(this.root,'stdout.log'),'wx'),err=await fs.open(path.join(this.root,'stderr.log'),'wx');
  try{this.child=(this.hooks.spawn??spawn)(this.config.executable,[option('profile',this.config.profile),option('runscript',script)],{cwd:path.dirname(this.config.executable),shell:false,windowsHide:true,windowsVerbatimArguments:process.platform==='win32',env:{...process.env,INOPRO_RESIDENT_REQUEST:intentPath},stdio:['ignore',out.fd,err.fd]});}
  catch(e){await Promise.allSettled([out.close(),err.close()]);throw e;}
  // Install handlers synchronously after spawn, before any cleanup await.
  this.exitObservation=new Promise<void>(resolve=>{
   const publications:Promise<void>[]=[];
   const record=(name:string,value:unknown)=>{const pending=exclusiveJson(path.join(this.root!,name),value).catch(e=>{this.failure??=e;});publications.push(pending);return pending;};
   const finish=()=>{void Promise.allSettled(publications).then(()=>{this.observationSettled=true;resolve();});};
   this.child!.once('error',e=>{this.failure??=new DomainError('unknown','RESIDENT_PROCESS_ERROR',e.message);
    record('process-error.json',{launchId:this.launchId,pid:this.child!.pid??null,error:errorDetails(e)});if(!this.child!.pid)finish();});
   this.child!.once('exit',(code,signal)=>{this.exited=true;
    this.exitRecord={launchId:this.launchId,pid:this.child!.pid,processIdentity:this.identity??null,code,signal:signal??null,at:new Date().toISOString(),lastSequence:this.sequence};
    record('process-exit.json',this.exitRecord);finish();});
   this.child!.once('close',()=>{if(!this.exited){this.failure??=new DomainError('unknown','RESIDENT_EXIT_MISSING','close without exit event');
    record('process-close-without-exit.json',{launchId:this.launchId,pid:this.child!.pid??null,processIdentity:this.identity??null,exitCode:null,exitConfirmed:false,error:errorDetails(this.failure)});finish();}});
  });
  const logs=await Promise.allSettled([out.close(),err.close()]);const logError=logs.find(r=>r.status==='rejected');
  if(logError?.status==='rejected'){const first=this.failure??logError.reason;this.failure??=first;try{await exclusiveJson(path.join(this.root!,'log-close-error.json'),{first:errorDetails(first),cleanup:errorDetails(logError.reason)});}catch{};throw first;}
  const observation=this.child.pid?await(this.hooks.probe??probeProcess)(this.child.pid):null;
  if(observation?.state!=='running'||this.exited)throw new DomainError('unknown','RESIDENT_START_MISSING','原生进程创建身份不可确认');
  this.identity=observation.identity;await exclusiveJson(path.join(this.root,'process-start.json'),{launchId:this.launchId,processIdentity:this.identity,entry:script,scriptHash:intent.scriptHash,coreHash:intent.coreHash});
  const ready=await this.wait(path.join(this.root,'ready.json'),Date.now()+this.config.timeoutMs);
  if(ready.launchId!==this.launchId||!equal(ready.processIdentity,{pid:this.identity.pid,startId:this.identity.startId})||ready.state?.startup!==false)throw Error('Native readiness binding differs');
 }
 async execute(request:BridgeRequest,directory:string,onStart:(pid:number,launchId:string)=>Promise<void>):Promise<Reply>{
  if(this.busy)throw new DomainError('conflict','RESIDENT_BUSY','已有串行请求，不能并行派发');this.busy=true;
  try{
   if(!this.child){if(request.command!=='inspect')throw new DomainError('conflict','RESIDENT_NOT_OPEN','需要本服务明确打开resident工程');await this.launch(request.projectPath);}
   if(pathKey(request.projectPath)!==pathKey(this.project!))throw new DomainError('conflict','RESIDENT_PROJECT_SWITCH','当前工程仍保留，首版不切换工程');
   await this.live();await onStart(this.identity!.pid,this.launchId!);await fs.mkdir(directory,{recursive:true});
   const accepting=request.command==='accept_saved';
   if(accepting&&(request.args.userConfirmedSaved!==true||!this.lastVersion||!this.lastDiskHash||request.args.expectedResidentVersion!==this.lastVersion))throw new DomainError('conflict','RESIDENT_SAVED_VERSION_REQUIRED','需要本健康会话上一次成功版本及明确的用户保存声明');
   const candidateDisk=accepting?await residentDisk(request.projectPath):undefined;
   const stat=await fs.stat(request.projectPath,{bigint:true}),diskHash=candidateDisk?.diskHash??digest(await fs.readFile(request.projectPath)),fileIdentity=`${stat.dev}:${stat.ino}`;
   if(!accepting&&fileIdentity!==this.originalFileId)throw new DomainError('conflict','RESIDENT_FILE_REPLACED','原工程文件身份跨请求变化，停止此会话');
   if(candidateDisk&&candidateDisk.fileIdentity!==fileIdentity)throw Error('Saved candidate identity changed before publication');
   const savedBaseline=accepting?{priorFileIdentity:this.originalFileId,priorDiskHash:this.lastDiskHash,priorResidentVersion:this.lastVersion,priorBaselineId:this.acceptedBaseline??null,priorProjectHandle:this.lastHandle,candidateDisk}:undefined;
   const envelope={...request,directory,launchId:this.launchId,sequence:++this.sequence,diskHash,fileIdentity,
    ...(this.acceptedBaseline?{acceptedBaseline:this.acceptedBaseline}:{}),...(savedBaseline?{savedBaseline}:{}),deadlineUtc:new Date(Date.now()+this.config.timeoutMs).toISOString(),leases:request.args.residentLeases};
   if(accepting)await exclusiveJson(path.join(directory,'saved-channel-before.json'),{launchId:this.launchId,processIdentity:this.identity,savedBaseline,requestHash:residentHash(envelope)});
   await exclusiveJson(path.join(directory,'request.json'),envelope);await publishQueue(path.join(this.root!,'request-'+this.sequence+'.json'),envelope);
   const result=replySchema.parse(await this.wait(path.join(directory,'result.json'),Date.now()+this.config.timeoutMs));
   await this.wait(path.join(directory,'completed.json'),Date.now()+this.config.timeoutMs);
   try{await verifyResidentResult(envelope,result,directory,this.identity!);}
   catch(first){
    if(['build','accept_saved'].includes(request.command))try{await exclusiveJson(path.join(directory,'service-verification-failed.json'),{requestHash:residentHash(envelope),resultHash:residentHash(result),firstError:errorDetails(first)});}
    catch(secondary){try{await exclusiveJson(path.join(this.root!,request.command==='build'?'build-verification-publication-error.json':'saved-verification-publication-error.json'),{sequence:this.sequence,firstError:errorDetails(first),publicationError:errorDetails(secondary)});}catch{};}
    throw first;
   }
   await this.live();
   const now=await fs.stat(request.projectPath,{bigint:true});if(`${now.dev}:${now.ino}`!==envelope.fileIdentity||digest(await fs.readFile(request.projectPath))!==diskHash)throw Error('File changed during resident request');
   if(accepting&&!equal(await residentDisk(request.projectPath),candidateDisk))throw Error('Saved candidate changed during acceptance');
   await exclusiveJson(path.join(directory,'service-verification.json'),{passed:true,launchId:this.launchId,sequence:this.sequence,requestHash:residentHash(envelope),resultHash:residentHash(result),processIdentity:this.identity,processState:'running',exitRequiredForRequest:false,diskHash});
   if(result.status==='succeeded'){
    if(accepting){
     const acceptance=result.data?.savedBaselineAcceptance as any;
     await exclusiveJson(path.join(directory,'saved-channel-accepted.json'),{requestHash:residentHash(envelope),acceptanceHash:residentHash(acceptance),oldFileIdentity:this.originalFileId,newFileIdentity:fileIdentity,baselineId:acceptance.baselineId});
     this.originalFileId=fileIdentity;this.acceptedBaseline=acceptance.baselineId;
    }
    this.lastVersion=result.data?.residentVersion as string;this.lastDiskHash=diskHash;this.lastHandle=result.data?.projectHandle as number;
   }
   if(result.status!=='succeeded'&&result.data?.recoverableRejection!==true)this.failure=new DomainError('unknown','RESIDENT_STOPPED','原请求未成功；此会话停止后续派发');return result;
  }catch(e:any){if(this.child){this.failure??=e;try{await exclusiveJson(path.join(this.root!,'stop.json'),{error:errorDetails(e),sequence:this.sequence,save:false,close:false});}catch{};}throw e instanceof DomainError?e:new DomainError('unknown','RESIDENT_EVIDENCE_ERROR',e.message);}
  finally{this.busy=false;}
 }
}
