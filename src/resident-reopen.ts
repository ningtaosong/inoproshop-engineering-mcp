import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DomainError} from './contracts.js';
import {type Store,type Session,readJson,digest,pathKey} from './storage.js';
import {probeProcess,sameProcess,validProcessIdentity,type ProcessProbe} from './lease-process.js';
import {residentHash,verifyResidentCompletion,verifyResidentResult} from './resident.js';
import {SAVE_POLICY} from './resident-save.js';
import {residentDisk} from './resident-saved.js';
const equal=(a:unknown,b:unknown)=>residentHash(a)===residentHash(b);
const uuid=(s:any)=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s);

// project_open permits omitting Application only for the original unambiguous
// selection. Keep that request immutable; its published result and registry
// must agree. All completion/service-verification checks still run below.
export function closedApplicationBinding(op:any,request:any,result:any,s:any){
 if(request?.args?.applicationId===s.applicationId)return true;
 if(!request?.args||Object.hasOwn(request.args,'applicationId')||op.tool!=='project_open'||request.command!=='inspect'||request.sequence!==1||!uuid(s.applicationId))return false;
 const apps=result?.data?.applications;
 return Array.isArray(apps)&&apps.length===1&&apps[0]?.applicationId===s.applicationId&&
  Array.isArray(apps[0].path)&&apps[0].path.length>0&&apps[0].path.every((x:any)=>typeof x==='string'&&x.length>0)&&
  result.data.applicationId===s.applicationId&&op.project&&
  (!Object.hasOwn(op.project,'applicationId')||op.project.applicationId===s.applicationId)&&
  op.response?.data?.session?.applicationId===s.applicationId&&
  op.response.data.session.projectId===s.projectId&&op.response.data.session.sessionId===s.sessionId&&
  equal(apps,op.response.data.session.applications)&&equal(apps,s.applications);
}

// Read-only proof for an EXPLICIT fresh open of unchanged saved bytes. This
// neither reconnects to memory nor resets a previous operation/session record.
export async function verifyClosedResident(store:Store,s:Session,newOperationId:string,probe:ProcessProbe=probeProcess){
 const refuse=(message:string)=>new DomainError('conflict','RESIDENT_RECONNECT_UNSUPPORTED',message);
 try{
  if(s.sessionMode!=='resident'||s.storageMode!=='direct'||!s.lastStateOperationId||!s.diskHash)throw refuse('Missing prior resident registration');
  const operations=await store.operations(),anchor=operations.find(o=>o.operationId===s.lastStateOperationId);
  if(!anchor?.resident||anchor.status!=='succeeded'||anchor.project?.projectId!==s.projectId||anchor.project?.sessionId!==s.sessionId||!uuid(anchor.bridge?.launchId))throw refuse('Prior session anchor differs');
  const launchId=anchor.bridge!.launchId!,directory=store.file('resident/'+launchId);
  const [intent,start,exit,stop,failed]=await Promise.all(['intent.json','process-start.json','process-exit.json','stop.json','first-error.json'].map(n=>readJson(path.join(directory,n))));
  const identity=start?.processIdentity;
  if(!validProcessIdentity(identity,anchor.bridge?.pid??-1)||identity.platform!==process.platform||identity.host!==os.hostname().toLowerCase()||start.launchId!==launchId||intent?.launchId!==launchId||pathKey(intent?.projectPath??'')!==pathKey(s.workingPath)||
   !exit||exit.launchId!==launchId||exit.pid!==identity.pid||!equal(exit.processIdentity,identity)||exit.code!==0||exit.signal!==null||!Number.isSafeInteger(exit.lastSequence)||exit.lastSequence<1||!Number.isFinite(Date.parse(exit.at))||stop||failed)throw refuse('Prior normal exit/identity evidence incomplete');
  if(!validProcessIdentity(anchor.ownerIdentity,anchor.ownerPid??-1))throw refuse('Prior service creation identity missing');
  for(const owner of [identity,anchor.ownerIdentity]){
   const observed=await probe(owner.pid);
   if(observed.state==='unconfirmed'||observed.state==='running'&&(!validProcessIdentity(observed.identity,owner.pid)||sameProcess(observed.identity,owner)))throw refuse('Prior IDE/service remains alive or cannot be ruled out');
  }
  const image=await residentDisk(s.workingPath),{fileIdentity,diskHash}=image;
  if(diskHash!==s.diskHash)throw refuse('Saved file version changed');
  const related=operations.filter(o=>o.operationId!==newOperationId&&o.resident&&o.project?.projectId===s.projectId&&o.project?.sessionId===s.sessionId);
  if(!related.length||related.some(o=>o.bridge?.launchId!==launchId||!['succeeded','conflict'].includes(o.status)))throw refuse('Current prior session has unresolved or different launch evidence');
  const sequences:number[]=[],chain:any[]=[];
  const ordered=await Promise.all(related.map(async op=>({op,request:await readJson(store.file('ipc/'+op.operationId+'/request.json'))})));
  ordered.sort((a,b)=>(a.request?.sequence??-1)-(b.request?.sequence??-1));
  let currentFile=intent.originalFileId,currentHash=ordered[0]?.request?.diskHash;
  if(typeof currentFile!=='string'||typeof currentHash!=='string'||!/^[a-f0-9]{64}$/.test(currentHash))throw refuse('Initial saved version missing');
  for(const {op} of ordered){
   const ipc=store.file('ipc/'+op.operationId);
   if(pathKey(op.bridge?.directory??'')!==pathKey(ipc))throw refuse('IPC path differs');
   const [request,result,check]=await Promise.all(['request.json','result.json','service-verification.json'].map(n=>readJson(path.join(ipc,n))));
   if(!request||request.operationId!==op.operationId||request.requestId!==op.requestId||request.requestFingerprint!==op.fingerprint||request.launchId!==launchId||request.fileIdentity!==currentFile||request.diskHash!==currentHash||pathKey(request.projectPath)!==pathKey(s.workingPath)||
    !closedApplicationBinding(op,request,result,s)||!result||result.status!==op.status||!equal(result.data?.residentEvidence,op.response?.data?.residentEvidence)||
    check?.passed!==true||check.launchId!==launchId||check.sequence!==request.sequence||!equal(check.processIdentity,identity)||check.requestHash!==residentHash(request)||check.resultHash!==residentHash(result))throw refuse('Prior request/result/verification binding differs');
   // The immutable original service-verification above binds these exact bytes.
   // Do not reclassify an old successful list using a newer supported-object rule.
   await verifyResidentCompletion(request,result,ipc,identity);
   if(op.status==='conflict'&&(result.data?.recoverableRejection!==true||result.data?.firstError?.dispatched!==false||result.data?.secondaryErrors?.length!==0))throw refuse('Prior conflict is not proven zero-dispatch');
   if(Date.parse(op.finishedAt??'')>Date.parse(exit.at)||!Number.isFinite(Date.parse(op.finishedAt??'')))throw refuse('Exit precedes completion');
   if(result.status==='succeeded'&&result.data?.saved===true){
    if(request.savePolicy!==SAVE_POLICY)throw refuse('Unrecognized save producer');
    await verifyResidentResult(request,result,ipc,identity);
    const [accepted,committed]=await Promise.all(['saved-channel-accepted','saved-registration-committed'].map(n=>readJson(path.join(ipc,n+'.json'))));
    if(accepted?.scheme!==SAVE_POLICY||accepted.requestHash!==residentHash(request)||accepted.receiptHash!==residentHash(result.data.saveReceipt)||!equal(accepted.beforeDisk,request.initialDisk)||accepted.afterDisk?.diskHash!==result.data.diskHash||typeof accepted.afterDisk?.fileIdentity!=='string'||
     !equal(committed,{operationId:op.operationId,requestId:op.requestId,projectId:s.projectId,sessionId:s.sessionId,sourceHash:s.sourceHash,diskHash:result.data.diskHash,residentVersion:result.data.residentVersion,receiptHash:residentHash(result.data.saveReceipt),buildApplicable:false})||check.diskHash!==result.data.diskHash)throw refuse('Own-save version transition receipt incomplete');
    chain.push({operationId:op.operationId,requestHash:residentHash(request),acceptedHash:residentHash(accepted),beforeDisk:accepted.beforeDisk,afterDisk:accepted.afterDisk});
    currentFile=accepted.afterDisk.fileIdentity;currentHash=accepted.afterDisk.diskHash;
   }
   sequences.push(request.sequence);
  }
  sequences.sort((a,b)=>a-b);
  if(sequences.length!==exit.lastSequence||sequences.some((n,i)=>n!==i+1))throw refuse('Prior session request coverage incomplete or duplicated');
  if(currentFile!==fileIdentity||currentHash!==diskHash)throw refuse('Saved version chain does not reach current file');
  return {saveVersionChain:chain,priorSessionId:s.sessionId,priorLaunchId:launchId,anchorOperationId:anchor.operationId,operationIds:related.map(o=>o.operationId),processIdentity:identity,exit,fileIdentity,diskHash,
   semantics:'explicit fresh open of verified saved version chain; not memory reconnect or prior result recovery'};
 }catch(error){if(error instanceof DomainError)throw error;throw refuse('Prior resident reopen proof unavailable: '+(error as Error).message);}
}
