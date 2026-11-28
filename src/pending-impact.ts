// Read-only dispatch assessment. Never reconciles, repairs or reclassifies an operation.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {canonical,digest,pathKey,readJson,type Store,type Operation,type Session} from './storage.js';
import {fileIdentity,isolationState,maintenanceGuard,ownedProject} from './isolation.js';
import {probeProcess,sameProcess,validProcessIdentity,type ProcessProbe} from './lease-process.js';
import {replySchema} from './contracts.js';
import {residentPendingScope} from './resident-pending.js';
import {earlyOpenCandidate,type EarlyOpenProof,type ContinuedOpen} from './resident-early-open.js';

interface File {path:string;key:string;realPath?:string;fileId?:string|null;missing?:boolean;[key:string]:unknown;}
export interface PendingImpact {operationId:string;requestId:string;scope:'global'|'project';reason:string;projectId?:string;files:File[];basis?:string;earlyProof?:EarlyOpenProof;continuedBy?:ContinuedOpen;}
export interface PendingContext {owned?:ReadonlySet<string>;running?:ReadonlySet<string>;exclude?:string;probe?:ProcessProbe;}
const fail=(message:string):never=>{throw Error(message);};
const same=(a:File,b:File)=>a.key===b.key||!!a.realPath&&!!b.realPath&&pathKey(a.realPath)===pathKey(b.realPath)||!!a.fileId&&a.fileId===b.fileId;
const inside=(root:string,p:string)=>pathKey(p).startsWith(pathKey(root)+path.sep.toLowerCase());
const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(s);
const creationStages=['native-create','initialize-cycle20ms','initialize-installed-placeholder','verify-native-preset','save-native-initialization','close-native-initialization','publish-exclusive','guard-published-target','reopen-specified-path','verify-reopened-preset','close-specified-path'];

// This is dispatch impact, NOT creation success or isolation/registration. Like
// registered projects, identify current files and retain any known dispatch IDs;
// missing historical IDs do not invent them or imply unlimited alias coverage.
async function creationFiles(op:Operation,dir:string,read:(p:string)=>Promise<any>):Promise<File[]> {
 const target=op.creation!.projectPath,staging=path.join(dir,'native-initialization'),scratch=path.join(staging,path.basename(target));
 const e=await read(path.join(dir,'creation-evidence.json')),r=await read(path.join(dir,'result.json')),
   factory=await read(path.join(dir,'native-factory.json')),dispatch=await read(path.join(dir,'dispatched.json'));
 if(!e||e.preset!==op.creation!.preset||e.initializationArtifact!==scratch||e.publishedExclusively!==true||e.reopened!==true||e.noBusinessCopy!==true||
   !/^[a-f0-9]{64}$/.test(e.savedDiskHash??'')||canonical(e.stages)!==canonical(creationStages.map(phase=>({phase,status:'succeeded'})))||
   r?.status!=='succeeded'||r.operationId!==op.operationId||r.data?.projectPath!==target||r.data.diskHash!==e.savedDiskHash||canonical(r.data.creationEvidence)!==canonical(e)||
   r.data.lifecycle?.ownedHandleRemaining!==false||r.data.lifecycle.closeUnconfirmed!==false||r.data.lifecycle.saveAttempts!==1||r.data.lifecycle.saveMayHaveOccurred!==true||
   factory?.name!==path.basename(target)||factory.location!==staging||canonical(factory.device)!==canonical({type:4102,id:'10f4 0002',version:'3.5.11.11'})||
   factory.factoryGuid!=='cc393387-a21c-4f68-a3e3-84c36951965d'||factory.factoryType!=='Inovance.InoPro.InoSTObject.STImplementationObjectFactory'||
   factory.wizardSha256!=='7b1fbbf5316171a8ad883614000085b901016ee8abac60efd8524404339fd6ac'||
   dispatch?.operationId!==op.operationId||dispatch.pid!==op.bridge?.pid)fail('creation publication chain incomplete or contradictory');
 for(let i=0;i<creationStages.length;i++){
  const n=String(i+1).padStart(2,'0');
  if(canonical(await read(path.join(dir,'creation-stage-'+n+'-start.json')))!==canonical({phase:creationStages[i],status:'started'})||
    canonical(await read(path.join(dir,'creation-stage-'+n+'-end.json')))!==canonical(e.stages[i]))fail('creation publication stages differ');
 }
 const files:File[]=[];
 const add=async(p:string)=>{
  const f=await fileIdentity(p);
  if(f.missing||!f.fileId||!f.realPath||pathKey(f.realPath)!==pathKey(p))fail('creation file missing or canonical identity differs');
  files.push(f);return f;
 };
 for(const p of [target,scratch])if((await add(p)).sha256!==e.savedDiskHash)fail('created artifact differs from original saved bytes');
 const walk=async(p:string):Promise<void>=>{
  const s=await fs.lstat(p);
  if(s.isSymbolicLink())fail('creation footprint has an unconfirmed alias');
  if(s.isDirectory()){if(pathKey(await fs.realpath(p))!==pathKey(p))fail('creation directory alias');for(const entry of await fs.readdir(p))await walk(path.join(p,entry));}
  else if(s.isFile()){if(!files.some(f=>f.key===pathKey(p)))await add(p);}else fail('creation footprint has unsupported file type');
 };
 await walk(staging);
 // OEM sidecars belong to these two known publication locations. No disk scan.
 const stem=path.basename(target,path.extname(target)).toLowerCase(),base=path.basename(target).toLowerCase();
 for(const entry of await fs.readdir(path.dirname(target))){
  const n=entry.toLowerCase();
  if(n===base||n.startsWith(base+'.')||n===base+'backup'||n.startsWith(stem+'-')&&n.endsWith('.opt')||['data','cppproject'].includes(n))await walk(path.join(path.dirname(target),entry));
 }
 return files;
}

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
 const creating=op.tool==='project_create';
 const c=op.creation;
 if(creating){
  if(op.project||!c||!uuid(c.projectId)||!uuid(c.sessionId)||c.projectId===c.sessionId||c.preset!=='am610-minimal-v1'||
    typeof c.projectPath!=='string'||!path.isAbsolute(c.projectPath)||op.args.projectPath!==c.projectPath||op.args.requestId!==op.requestId||
    !op.activation||!Number.isInteger(op.activation.revision)||op.activation.revision<0||
    projects.some(s=>s.projectId===c.projectId||s.sessionId===c.sessionId||[s.sourcePath,s.workingPath].some(p=>pathKey(p)===pathKey(c.projectPath))))fail('creation reservation missing, ambiguous or registered differently');
  // Require the recorded service creation identity too; never infer it from PID.
  await checkGone(op.ownerPid,op.ownerIdentity,probe);
 }
 // Only the strict early-read proof below may bridge this provisional identity
 // to a new registered session. All other ownership checks retain their rules.
 const s=creating?undefined:ownedProject(op,earlyOpenCandidate(op)?[]:projects);
 const paths=creating?[c!.projectPath]:[s!.sourcePath,s!.workingPath,s!.directPath].filter((p):p is string=>!!p);
 const files:File[]=creating?[]:await Promise.all([...new Set(paths)].map(fileIdentity));
 if(files.some(f=>f.missing||!f.fileId||!f.realPath))fail('original project file identity unavailable');
 const recorded=(op as any).dispatchFiles;
 if(recorded!==undefined){
  if(!Array.isArray(recorded)||!recorded.length||recorded.some(f=>!f||typeof f.path!=='string'||!path.isAbsolute(f.path)||
    f.key!==pathKey(f.path)||typeof f.realPath!=='string'||!path.isAbsolute(f.realPath)||typeof f.fileId!=='string'||!/^\d+:\d+$/.test(f.fileId)))fail('dispatch file identity invalid');
  for(const f of recorded)if(!paths.some(p=>pathKey(p)===f.key))fail('dispatch path not in original binding');
  if(!creating)files.push(...recorded);
 }
 const root=store.file('ipc/'+op.operationId),directory=op.bridge?.directory;
 if(!directory||(!inside(root,directory)&&pathKey(directory)!==pathKey(root)))fail('original IPC binding missing');
 if(pathKey(await fs.realpath(root))!==pathKey(root))fail('original IPC root alias');
 const reads=new Map<string,string|null>();
 const read=async(p:string)=>{const bytes=await fs.readFile(p).catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});const hash=bytes===null?null:digest(bytes);if(reads.has(p)&&reads.get(p)!==hash)fail('IPC changed during assessment');reads.set(p,hash);return bytes===null?undefined:JSON.parse(bytes.toString('utf8'));};
 const reqFiles=await requests(root);
 if(!reqFiles.length||!reqFiles.some(p=>pathKey(path.dirname(p))===pathKey(directory!)))fail('original launch request missing');
 if(creating&&(reqFiles.length!==1||pathKey(directory!)!==pathKey(root)))fail('creation requires one unambiguous original launch');
 let residentBasis:string|undefined;
 let earlyProof:EarlyOpenProof|undefined,continuedBy:ContinuedOpen|undefined;
 let residentRecheck:(()=>Promise<void>)|undefined;
 if(op.resident===true){
  if(creating||reqFiles.length!==1||pathKey(directory!)!==pathKey(root))fail('resident requires one bound operation request');
  const proof=await residentPendingScope(store,op,s!,projects,read,probe);residentBasis=proof.basis;residentRecheck=proof.recheck;earlyProof=proof.earlyProof;continuedBy=proof.continuedBy;
 }
 const launches=new Set<string>();
 for(const p of op.resident===true?[]:reqFiles){
  const req=await read(p),dir=path.dirname(p),envelope=await read(path.join(dir,'process-start.json')),start=envelope?.value;
  if(!req||req.operationId!==op.operationId||req.requestId!==op.requestId||req.requestFingerprint!==op.fingerprint||
    req.exitEvidenceVersion!==1||typeof req.launchId!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.launchId)||launches.has(req.launchId)||
    typeof req.projectPath!=='string'||!paths.some(p=>pathKey(p)===pathKey(req.projectPath))||
    pathKey(req.resultPath??'')!==pathKey(path.join(dir,'result.json')))fail('native request binding incomplete');
  launches.add(req.launchId);
  if(creating&&(req.command!=='new_project'||canonical(req.args)!==canonical({preset:c!.preset})||req.fileGuard!=null))fail('creation native request/preset differs');
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
 if(creating){
  files.push(...await creationFiles(op,directory!,read));
  for(const f of recorded??[])if(!files.some(current=>current.key===f.key&&current.fileId===f.fileId&&pathKey(current.realPath!)===pathKey(f.realPath)))fail('known creation dispatch identity contradicts current file');
 }
 // Read set stability, not a cached permission. Rechecked at admission, queue and
 // every native launch. A late result is observed, never committed here.
 if(residentRecheck)await residentRecheck();
 for(const [p,hash] of reads){const bytes=await fs.readFile(p).catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});if((bytes===null?null:digest(bytes))!==hash)fail('IPC changed during assessment');}
 if(canonical((await requests(root)).sort())!==canonical(reqFiles.sort()))fail('native launch set changed during assessment');
 if(creating&&canonical(await creationFiles(op,directory!,read))!==canonical(files))fail('creation footprint changed during assessment');
 return {operationId:op.operationId,requestId:op.requestId,scope:'project',reason:'original processes ended; outcome remains unknown',projectId:creating?c!.projectId:s!.projectId,files,...(creating?{basis:'creation-publication-chain-v1; current file identities; historical IDs only when recorded'}:residentBasis?{basis:residentBasis}:{}),...(earlyProof?{earlyProof,continuedBy}:{})};
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
  if(impact.continuedBy){
   const old=registry.projects.find(s=>s.projectId===impact.continuedBy!.projectId),now=current.projects.find(s=>s.projectId===impact.continuedBy!.projectId);
   if(!old||!now||canonical(binding(old))!==canonical(binding(now)))fail('fresh resident binding changed during assessment');
  }
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
