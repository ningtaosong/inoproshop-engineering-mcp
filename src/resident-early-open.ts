// Only a completed first inspect which failed before its snapshot. Never a
// recovery/reconcile, memory reconnect or modification of the original unknown.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {canonical,digest,pathKey,type Operation,type Session,type Store} from './storage.js';
import {residentHash,verifyResidentResult} from './resident.js';
import {validProcessIdentity,probeProcess,type ProcessProbe} from './lease-process.js';
import {verifyHistoricalClosedResident,sameClosedResidentProof} from './resident-reopen.js';
import {replySchema} from './contracts.js';
const eq=(a:unknown,b:unknown)=>residentHash(a)===residentHash(b);
const fail=(s:string):never=>{throw Error('Resident early open: '+s);};
export interface EarlyOpenProof {operationId:string;requestId:string;launchId:string;projectId:string;sessionId:string;projectPath:string;fileId:string;diskHash:string;requestHash:string;resultHash:string;ownershipHash:string;nativeExitHash:string;nativeExitAt:string;serviceShutdownHash:string;ownershipBasis?:'native-public-record'|'legacy-fixed-control-flow';ownershipInference?:Record<string,unknown>;predecessorOperationIds?:string[];}
export interface ContinuedOpen {operationId:string;projectId:string;sessionId:string;}
export const earlyOpenCandidate=(op:Operation)=>op.resident===true&&op.tool==='project_open'&&op.status==='unknown'&&op.args.sessionMode==='resident'&&!op.project?.lastStateOperationId;

export function earlyOwnership(req:any,result:any,row:any,intent:any,native:any){
 const e=result?.data?.residentEvidence,first=result?.data?.firstError,raw=row?.raw;
 if(req.command!=='inspect'||req.sequence!==1||result.status!=='unknown'||first?.phase!=='initial-snapshot'||first.dispatched!==false||
  result.data.recoverableRejection!==false||!eq(result.data.secondaryErrors,[])||['saved','reopened','closed'].some(k=>result.data[k]!==false)||
  row?.scheme!=='resident-public-ownership-v1'||row.ordinal!==1||row.operationId!==req.operationId||row.requestId!==req.requestId||row.launchId!==req.launchId||row.sequence!==1||
  row.requestHash!==residentHash(req)||!eq(row.processIdentity,native)||pathKey(row.projectPath??'')!==pathKey(req.projectPath)||row.scriptHash!==intent.scriptHash||row.coreHash!==intent.coreHash||
  !eq(row.attempts,{open:1,read:1,replace:0,build:0})||!eq(row.nativeValidation,{passed:true,error:null})||
  !eq(e?.ownershipRecords,[{name:'ownership-0001.json',sha256:residentHash(row)}])||!raw||!eq(raw.readErrors,[])||
  !Number.isSafeInteger(row.projectHandle)||row.projectHandle<0||!Array.isArray(raw.all)||raw.all.length===0)fail('first readonly ownership/phase binding incomplete');
 const owned=raw.returned;
 if(!owned||!eq(owned,raw.primary)||owned.handle!==row.projectHandle||owned.library!==false||owned.primary!==true||pathKey(owned.path??'')!==pathKey(req.projectPath))fail('owned native project differs');
 const handles=new Set<number>();let count=0;
 for(const p of raw.all){
  if(!p||!Number.isSafeInteger(p.handle)||p.handle<0||handles.has(p.handle)||typeof p.path!=='string'||typeof p.primary!=='boolean'||typeof p.library!=='boolean')fail('open project coverage invalid');
  handles.add(p.handle);
  if(p.handle===owned.handle){if(!eq(p,owned))fail('owned open-list row differs');count++;}
  else if(p.primary!==false||p.library!==true)fail('foreign engineering project present');
 }
 if(count!==1)fail('owned project missing');
 return residentHash(row);
}

// Existing EOF shutdown journal plus confirmed absence of that exact process.
// This is not an invented OS exit code. A shutdown error/signal is never accepted.
export async function closedServiceShutdown(store:Store,identity:any,ideExitAt:string,read:(p:string)=>Promise<any>,beforeStart?:string){
 const root=store.file('service-lifecycle'),matches:any[]=[];
 for(const name of await fs.readdir(root)){
  const dir=path.join(root,name),s=await fs.lstat(dir);
  if(!s.isDirectory()||s.isSymbolicLink())fail('service journal layout invalid');
  const names=(await fs.readdir(dir)).sort();
  if(!names.length)continue;
  const first=await read(path.join(dir,names[0]));
  if(!eq(first?.value?.binding?.processIdentity,identity))continue;
  const rows:any[]=[];
  for(let i=0;i<names.length;i++){
   const record=await read(path.join(dir,names[i])),v=record?.value;
   if(record?.schemaVersion!==1||record.checksum!==digest(canonical(v))||!eq(v.binding,first.value.binding)||v.binding.pid!==identity.pid||v.binding.runId!==name||
    v.ordinal!==i+1||!Number.isFinite(Date.parse(v.observedAt))||names[i]!==String(i+1).padStart(6,'0')+'-'+v.event+'.json')fail('service shutdown journal binding differs');
   rows.push(v);
  }
  const events=rows.map(r=>r.event);
  if(!eq(events,['shutdown-requested','observations-settled','lease-retained','shutdown-completed'])||
   !['stdin-end','stdin-close','transport-close'].includes(rows[0].data?.reason)||Object.hasOwn(rows[0].data,'error')||
   rows[3].data?.errorCount!==0||rows[3].data.operationSuccessNotImplied!==true||Date.parse(rows[1].observedAt)<Date.parse(ideExitAt)||
   rows.some((r,i)=>i>0&&Date.parse(r.observedAt)<Date.parse(rows[i-1].observedAt))||beforeStart!==undefined&&(!Number.isFinite(Date.parse(beforeStart))||Date.parse(rows[3].observedAt)>Date.parse(beforeStart)))fail('normal service shutdown incomplete');
  matches.push(rows);
 }
 if(matches.length!==1)fail('unique normal service shutdown unavailable');
 return residentHash(matches[0]);
}

export function explicitEarlyOpen(tool:string,args:any,proof:EarlyOpenProof){
 return tool==='project_open'&&args.sessionMode==='resident'&&typeof args.projectPath==='string'&&pathKey(args.projectPath)===pathKey(proof.projectPath)&&args.requestId!==proof.requestId;
}

// A new operation owns this linkage, never the old unknown or its registration.
// Verify the successful first native read before permitting subsequent requests.
export async function continuedEarlyOpen(store:Store,proof:EarlyOpenProof,projects:Session[],read:(p:string)=>Promise<any>,resolveEarly?:(o:Operation)=>Promise<EarlyOpenProof|undefined>,probe:ProcessProbe=probeProcess,visited:string[]=[]):Promise<ContinuedOpen|undefined>{
 if(visited.length>=16||visited.includes(proof.operationId))fail('successor chain cycle or depth exceeds bound');
 const same=projects.filter(s=>s.projectId===proof.projectId||s.sessionId===proof.sessionId||[s.sourcePath,s.workingPath].some(p=>pathKey(p)===pathKey(proof.projectPath)));
 if(!same.length)return;
 if(same.length!==1)fail('registration ambiguous');
 const s=same[0];
 if(s.sessionMode!=='resident'||s.storageMode!=='direct'||s.editMode!=='direct'||s.sessionId===proof.sessionId||
  [s.workingPath,s.sourcePath,s.directPath??''].some(p=>pathKey(p)!==pathKey(proof.projectPath)))fail('registration has no fresh owned session');
 const operations=await store.operations();
 const rows=operations.filter(o=>o.residentFreshOpen?.priorOperationId===proof.operationId&&o.tool==='project_open'&&o.resident);
 if(rows.length===1&&earlyOpenCandidate(rows[0])&&resolveEarly){
  const next=await resolveEarly(rows[0]);if(!next||!next.predecessorOperationIds?.includes(proof.operationId))fail('failed successor chain proof missing');
  return continuedEarlyOpen(store,next!,projects,read,resolveEarly,probe,[...visited,proof.operationId]);
 }
 if(rows.length!==1)fail('unique successful successor open unavailable');
 const op=rows[0];if(op.status!=='succeeded'||!op.project)fail('successor is not a successful current session');
 const firstSession=op.project!,dir=store.file('ipc/'+op.operationId);
 const [pre,req,result,check,ledger]=await Promise.all(['resident-new-open-precheck.json','request.json','result.json','service-verification.json',store.file('operations/'+op.operationId+'.json')].map(n=>read(path.isAbsolute(n)?n:path.join(dir,n))));
 await read(path.join(dir,'completed.json'));
 await read(path.join(dir,'before.json'));
 const returned=op.response?.data?.session as any;
 const args={...req?.args};delete args.residentLeases;
 if(op.residentFreshOpen!.proofHash!==residentHash(proof)||!eq(pre,{operationId:op.operationId,requestId:op.requestId,proof})||
  op.fingerprint!==digest(canonical({tool:op.tool,args:op.args}))||ledger?.schemaVersion!==1||ledger.checksum!==digest(canonical(op))||!eq(ledger.value,op)||!explicitEarlyOpen(op.tool,op.args,proof)||
  pathKey(op.bridge?.directory??'')!==pathKey(dir)||pathKey(req?.directory??'')!==pathKey(dir)||!eq(args,op.args)||op.bridge?.launchId===proof.launchId||req?.launchId!==op.bridge?.launchId||req.sequence!==1||req.command!=='inspect'||
  req.operationId!==op.operationId||req.requestId!==op.requestId||req.requestFingerprint!==op.fingerprint||req.diskHash!==proof.diskHash||req.fileIdentity!==proof.fileId||pathKey(req.projectPath??'')!==pathKey(proof.projectPath)||
  !replySchema.safeParse(result).success||!replySchema.safeParse(op.response).success||op.response?.status!=='succeeded'||op.response.operationId!==op.operationId||op.response.requestId!==op.requestId||
  !Number.isFinite(Date.parse(op.startedAt))||Date.parse(op.startedAt)<Date.parse(proof.nativeExitAt)||
  result?.status!=='succeeded'||!eq(result.data?.residentEvidence,op.response?.data?.residentEvidence)||
  check?.passed!==true||!validProcessIdentity(check.processIdentity,op.bridge?.pid??-1)||check.launchId!==req.launchId||check.sequence!==1||check.requestHash!==residentHash(req)||check.resultHash!==residentHash(result)||check.diskHash!==proof.diskHash||check.processState!=='running'||check.exitRequiredForRequest!==false||
  returned?.projectId!==firstSession.projectId||returned?.sessionId!==firstSession.sessionId||returned?.diskHash!==proof.diskHash||op.project?.diskHash!==proof.diskHash)fail('successor request/completion differs');
 await verifyResidentResult(req,result,dir,check.processIdentity);
 return followNormalReopens(store,op,returned,s,operations,read,probe);
}


// Follow only previously proven normal-close/fresh-open records. This never
// adopts memory or changes a historical operation, and is bounded independently
// of the failed-first-read chain above.
async function followNormalReopens(store:Store,first:Operation,initial:Session,current:Session,operations:Operation[],read:(p:string)=>Promise<any>,probe:ProcessProbe):Promise<ContinuedOpen>{
 let prior=first,session=initial;const seen=new Set<string>();
 for(let depth=0;depth<16;depth++){
  if(seen.has(session.sessionId))fail('normal reopen chain cycle');seen.add(session.sessionId);
  if(session.projectId===current.projectId&&session.sessionId===current.sessionId)return {operationId:prior.operationId,projectId:current.projectId,sessionId:current.sessionId};
  const matches:any[]=[];
  for(const candidate of operations.filter(o=>o.resident&&o.tool==='project_open'&&o.status==='succeeded'&&o.project?.projectId===session.projectId&&o.project?.sessionId!==session.sessionId)){
   const pre=await read(store.file('ipc/'+candidate.operationId+'/resident-reopen-precheck.json'));
   if(pre?.priorSessionId===session.sessionId)matches.push({candidate,pre});
  }
  if(matches.length!==1)fail('unique normal reopen successor missing');
  const {candidate,pre}=matches[0],dir=store.file('ipc/'+candidate.operationId);
  const [req,result,check,ledger]=await Promise.all(['request.json','result.json','service-verification.json',store.file('operations/'+candidate.operationId+'.json')].map(n=>read(path.isAbsolute(n)?n:path.join(dir,n))));
  const anchor=operations.find(o=>o.operationId===pre.anchorOperationId),next=result?.data?.session??candidate.response?.data?.session;
  if(!anchor?.project||anchor.project.sessionId!==session.sessionId||pre.operationId!==candidate.operationId||pre.requestId!==candidate.requestId||pre.newSessionId!==candidate.project?.sessionId||pre.priorLaunchId!==prior.bridge?.launchId||
   req?.sequence!==1||req.command!=='inspect'||req.launchId!==candidate.bridge?.launchId||req.launchId===pre.priorLaunchId||req.operationId!==candidate.operationId||req.requestId!==candidate.requestId||req.requestFingerprint!==candidate.fingerprint||candidate.fingerprint!==digest(canonical({tool:candidate.tool,args:candidate.args}))||
   !eq({...req.args,residentLeases:undefined},{...candidate.args,residentLeases:undefined})||!explicitEarlyOpen(candidate.tool,candidate.args,{projectPath:session.workingPath,requestId:prior.requestId} as EarlyOpenProof)||
   req.diskHash!==pre.diskHash||req.fileIdentity!==pre.fileIdentity||pathKey(req.projectPath??'')!==pathKey(session.workingPath)||
   ledger?.schemaVersion!==1||ledger.checksum!==digest(canonical(candidate))||!eq(ledger.value,candidate)||!replySchema.safeParse(candidate.response).success||candidate.response?.status!=='succeeded'||candidate.response.operationId!==candidate.operationId||candidate.response.requestId!==candidate.requestId||result?.status!=='succeeded'||!eq(result.data?.residentEvidence,candidate.response?.data?.residentEvidence)||
   check?.passed!==true||!validProcessIdentity(check.processIdentity,candidate.bridge?.pid??-1)||check.launchId!==req.launchId||check.sequence!==1||check.requestHash!==residentHash(req)||check.resultHash!==residentHash(result)||check.diskHash!==req.diskHash||
   next?.projectId!==session.projectId||next?.sessionId!==pre.newSessionId||next?.diskHash!==req.diskHash||next?.applicationId!==result.data.applicationId||next?.lastStateOperationId!==candidate.operationId||next?.sessionMode!=='resident'||next?.storageMode!=='direct'||[next?.sourcePath,next?.workingPath,next?.directPath].some(p=>typeof p!=='string'||pathKey(p)!==pathKey(session.workingPath))||!Number.isFinite(Date.parse(candidate.startedAt))||Date.parse(candidate.startedAt)<Date.parse(pre.exit?.at??''))fail('normal reopen linkage differs');
  const old={...anchor!.project,lastStateOperationId:anchor!.operationId,diskHash:pre.diskHash,residentVersion:anchor!.response?.data?.residentVersion} as Session;
  const proven=await verifyHistoricalClosedResident(store,old,candidate.operationId,{fileIdentity:req.fileIdentity,diskHash:req.diskHash},probe,read);
  const {operationId,requestId,newSessionId,...recorded}=pre;
  if(!sameClosedResidentProof(recorded,proven))fail('normal reopen precheck no longer matches original proof');
  await read(path.join(dir,'completed.json'));await read(path.join(dir,'before.json'));
  await verifyResidentResult(req,result,dir,check.processIdentity);
  prior=candidate;session=next;
 }
 return fail('normal reopen chain exceeds bound');
}
