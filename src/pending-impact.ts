// Read-only dispatch assessment. Never reconciles, repairs or reclassifies an operation.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {canonical,digest,pathKey,readJson,type Store,type Operation,type Session} from './storage.js';
import {fileIdentity,isolationState,maintenanceGuard,ownedProject} from './isolation.js';
import {probeProcess,sameProcess,validProcessIdentity,type ProcessProbe} from './lease-process.js';
import {replySchema} from './contracts.js';

interface File {path:string;key:string;realPath?:string;fileId?:string|null;missing?:boolean;[key:string]:unknown;}
export interface PendingImpact {operationId:string;requestId:string;scope:'global'|'project';reason:string;projectId?:string;files:File[];}
export interface PendingContext {owned?:ReadonlySet<string>;running?:ReadonlySet<string>;exclude?:string;probe?:ProcessProbe;}
const fail=(message:string):never=>{throw Error(message);};
const same=(a:File,b:File)=>a.key===b.key||!!a.realPath&&!!b.realPath&&pathKey(a.realPath)===pathKey(b.realPath)||!!a.fileId&&a.fileId===b.fileId;
const inside=(root:string,p:string)=>pathKey(p).startsWith(pathKey(root)+path.sep.toLowerCase());

async function requests(root:string):Promise<string[]> {
 const out:string[]=[];
 for(const entry of await fs.readdir(root,{withFileTypes:true})){
  const p=path.join(root,entry.name);
  if(entry.isSymbolicLink())fail('IPC contains an unconfirmed filesystem alias');
  if(entry.isDirectory())out.push(...await requests(p));else if(entry.name==='request.json')out.push(p);
 }
 return out;
}
async function checkGone(pid:number,identity:any,probe:ProcessProbe) {
 if(!validProcessIdentity(identity,pid)||identity.platform!==process.platform||identity.host!==os.hostname().toLowerCase())fail('process creation identity/domain missing');
 const now=await probe(pid);
 if(now.state==='exited')return;
 if(now.state==='running'&&validProcessIdentity(now.identity,pid)&&now.identity.platform===identity.platform&&now.identity.host===identity.host&&!sameProcess(now.identity,identity))return;
 fail(now.state==='running'?'original process instance still active':'process absence unconfirmed');
}
async function scoped(store:Store,op:Operation,projects:Session[],context:PendingContext):Promise<PendingImpact> {
 const probe=context.probe??probeProcess;
 if(op.fingerprint!==digest(canonical({tool:op.tool,args:op.args})))fail('original request fingerprint mismatch');
 if(op.response&&(!replySchema.safeParse(op.response).success||op.response.status!==op.status||
   op.response.operationId!==op.operationId||op.response.requestId!==op.requestId))fail('operation response binding/status invalid');
 if(!context.owned?.has(op.operationId)){
  const owner=await probe(op.ownerPid);
  if(owner.state!=='exited'){
   const identity=(op as any).ownerIdentity;
   if(!validProcessIdentity(identity,op.ownerPid)||owner.state!=='running'||sameProcess(identity,owner.identity)||
      identity.host!==owner.identity.host||identity.platform!==owner.identity.platform)fail('original service instance active or unconfirmed');
  }
 }
 // Unknown catalog/creation or legacy ownership without sufficient binding stays
 // global. Do not invent a project from the current active pointer.
 const s=ownedProject(op,projects);
 const paths=[s.sourcePath,s.workingPath,s.directPath].filter((p):p is string=>!!p);
 const files=await Promise.all([...new Set(paths)].map(fileIdentity));
 if(files.some(f=>f.missing||!f.fileId||!f.realPath))fail('original project file identity unavailable');
 const recorded=(op as any).dispatchFiles;
 if(recorded!==undefined){
  if(!Array.isArray(recorded)||!recorded.length||recorded.some(f=>!f||typeof f.path!=='string'||!path.isAbsolute(f.path)||
    f.key!==pathKey(f.path)||typeof f.realPath!=='string'||!path.isAbsolute(f.realPath)||typeof f.fileId!=='string'||!/^\d+:\d+$/.test(f.fileId)))fail('dispatch file identity invalid');
  for(const f of recorded)if(!paths.some(p=>pathKey(p)===f.key))fail('dispatch path not in original binding');
  files.push(...recorded);
 }
 const root=store.file('ipc/'+op.operationId),directory=op.bridge?.directory;
 if(!directory||(!inside(root,directory)&&pathKey(directory)!==pathKey(root)))fail('original IPC binding missing');
 if(pathKey(await fs.realpath(root))!==pathKey(root))fail('original IPC root alias');
 const reads=new Map<string,string|null>();
 const read=async(p:string)=>{const bytes=await fs.readFile(p).catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});reads.set(p,bytes===null?null:digest(bytes));return bytes===null?undefined:JSON.parse(bytes.toString('utf8'));};
 const reqFiles=await requests(root);
 if(!reqFiles.length||!reqFiles.some(p=>pathKey(path.dirname(p))===pathKey(directory!)))fail('original launch request missing');
 const launches=new Set<string>();
 for(const p of reqFiles){
  const req=await read(p),dir=path.dirname(p),envelope=await read(path.join(dir,'process-start.json')),start=envelope?.value;
  if(!req||req.operationId!==op.operationId||req.requestId!==op.requestId||req.requestFingerprint!==op.fingerprint||
    req.exitEvidenceVersion!==1||typeof req.launchId!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.launchId)||launches.has(req.launchId)||
    typeof req.projectPath!=='string'||!paths.some(p=>pathKey(p)===pathKey(req.projectPath))||
    pathKey(req.resultPath??'')!==pathKey(path.join(dir,'result.json')))fail('native request binding incomplete');
  launches.add(req.launchId);
  const expected={operationId:op.operationId,requestId:op.requestId,requestFingerprint:op.fingerprint,launchId:req.launchId,requestHash:digest(canonical(req))};
  if(envelope?.schemaVersion!==1||envelope.checksum!==digest(canonical(start))||canonical(start?.binding)!==canonical(expected)||
    start.process?.state!=='running'||!Number.isFinite(Date.parse(start.observedAt)))fail('native process-start evidence invalid');
  if(pathKey(dir)===pathKey(directory!)&&(op.bridge?.launchId!==req.launchId||op.bridge?.pid!==start.pid))fail('operation launch identity mismatch');
  await checkGone(start.pid,start.process.identity,probe);
  const exitEnvelope=await read(path.join(dir,'process-exit.json'));
  if(exitEnvelope!==undefined){const exit=exitEnvelope?.value;
   if(exitEnvelope?.schemaVersion!==1||exitEnvelope.checksum!==digest(canonical(exit))||canonical(exit?.binding)!==canonical(expected)||
      exit.pid!==start.pid||exit.startHash!==digest(canonical(start)))fail('existing process-exit record invalid');
  }
  const result=await read(path.join(dir,'result.json'));
  if(result!==undefined&&(!replySchema.safeParse(result).success||result.operationId!==op.operationId||!['succeeded','failed','unknown','conflict','unsupported'].includes(result.status)))fail('native result record invalid');
 }
 // Read set stability, not a cached permission. Rechecked at admission, queue and
 // every native launch. A late result is observed, never committed here.
 for(const [p,hash] of reads){const bytes=await fs.readFile(p).catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});if((bytes===null?null:digest(bytes))!==hash)fail('IPC changed during assessment');}
 return {operationId:op.operationId,requestId:op.requestId,scope:'project',reason:'original processes ended; outcome remains unknown',projectId:s.projectId,files};
}
export async function assessPending(store:Store,context:PendingContext={}) {
 await maintenanceGuard();
 const registry=await store.registry(),operations=await store.operations(),isolation=await isolationState(store);
 const covered=new Set(isolation.own.flatMap(e=>e.plan.operationIds)),impacts:PendingImpact[]=[];
 for(const op of operations){
  if(op.operationId===context.exclude||covered.has(op.operationId)||!['running','unknown'].includes(op.status))continue;
  if(op.status==='running'&&context.running?.has(op.operationId))continue;
  try {if(operations.filter(o=>o.requestId===op.requestId).length!==1)fail('original request identity ambiguous');impacts.push(await scoped(store,op,registry.projects,context));}
  catch(e:any){impacts.push({operationId:op.operationId,requestId:op.requestId,scope:'global',reason:e.message??String(e),files:[]});}
 }
 // Unrelated accepted/completed calls may update the active pointer or add rows.
 // Only assessed unresolved rows and their ownership bindings must stay stable.
 const current=await store.registry();
 const unresolved=(rows:Operation[])=>rows.filter(o=>o.operationId!==context.exclude&&!covered.has(o.operationId)&&
  (o.status==='unknown'||o.status==='running'&&!context.running?.has(o.operationId)));
 if(canonical(unresolved(await store.operations()))!==canonical(unresolved(operations)))fail('unresolved set changed during assessment');
 const binding=(s:Session)=>({projectId:s.projectId,sessionId:s.sessionId,sourcePath:s.sourcePath,workingPath:s.workingPath,storageMode:s.storageMode,editMode:s.editMode,directPath:s.directPath});
 for(const impact of impacts){
  const old=operations.find(o=>o.operationId===impact.operationId)!;
  if(canonical(await store.operation(old.operationId))!==canonical(old))fail('pending operation changed during assessment');
  const before=registry.projects.find(s=>s.projectId===impact.projectId),after=current.projects.find(s=>s.projectId===impact.projectId);
  if(before&&(!after||canonical(binding(before))!==canonical(binding(after))))fail('pending project binding changed during assessment');
 }
 if(canonical(await isolationState(store))!==canonical(isolation))fail('isolation changed during assessment');
 return {registry,operations,isolation,impacts,globalFrozen:impacts.some(i=>i.scope==='global')};
}
export async function targetFiles(paths:string[]) {
 const out:File[]=[];
 for(const p of [...new Set(paths)]){
  if(!path.isAbsolute(p))fail('absolute target path required');
  const f=await fileIdentity(p);out.push(f);
  if(f.missing){
   let ancestor=path.dirname(p),tail=[path.basename(p)];
   for(;;){try{const real=await fs.realpath(ancestor);out.push({path:p,key:pathKey(p),realPath:path.join(real,...tail)});break;}
    catch(e:any){if(e.code!=='ENOENT')throw e;tail.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)throw e;ancestor=parent;}}
  }else if(!f.fileId||!f.realPath)fail('target file identity unavailable');
 }
 return out;
}
export function related(impacts:PendingImpact[],projectId:string|undefined,files:File[]) {
 return impacts.filter(i=>i.scope==='global'||!!projectId&&i.projectId===projectId||files.some(f=>i.files.some(a=>same(f,a))));
}
