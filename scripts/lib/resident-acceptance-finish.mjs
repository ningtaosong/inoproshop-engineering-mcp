// Acceptance-only shutdown sequencing. Never closes an IDE, kills a process,
// mutates the registry or fakes a process observation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

export function checkBeforeShutdown(p) {
 assert.ok(p&&p.authorization&&p.projectCloseDecision,'Explicit close decision required');
 assert.equal(p.activeOperations,0,'Operation remains active');
 assert.equal(p.currentDiskHash,p.expectedDiskHash,'Disk changed');
 assert.equal(p.currentFileId,p.expectedFileId,'File identity changed');
 assert.equal(p.nativeExit.launchId,p.launchId,'Exit launch differs');
 assert.deepEqual(p.nativeExit.processIdentity,p.ideIdentity,'Exit identity differs');
 assert.equal(p.nativeExit.pid,p.ideIdentity.pid,'Exit PID differs');
 assert.equal(p.nativeExit.code,0,'IDE did not exit normally');
 assert.equal(p.nativeExit.signal,null,'IDE signal evidence differs');
 assert.ok(Number.isFinite(Date.parse(p.nativeExit.at)),'Exit time missing');
 assert.equal(p.ideObservation.state,'exited','IDE still alive or unconfirmed');
 assert.equal(p.serviceObservation.state,'running','Owning service not running');
 assert.deepEqual(p.serviceObservation.identity,p.serviceIdentity,'Owning service changed');
 assert.equal(p.requestCoverageComplete,true,'Request coverage incomplete');
 assert.ok(Number.isSafeInteger(p.nativeExit.lastSequence)&&p.nativeExit.lastSequence>0);
 assert.deepEqual(p.sequences,[...Array(p.nativeExit.lastSequence)].map((_,i)=>i+1),'Sequence coverage differs');
 assert.equal(p.receiverFailure,null,'Receiver failure');
 assert.equal(p.stopRecord,null,'Receiver stop record');
 return p;
}

export async function readBeforeShutdown({fixed,dataDir,expectedLaunchId,authorization,projectCloseDecision}) {
 const imp=n=>import(pathToFileURL(path.join(fixed,'dist',n+'.js')).href);
 const {Store,readJson,digest,pathKey}=await imp('storage');
 const {probeProcess,validProcessIdentity}=await imp('lease-process');
 const {residentHash,verifyResidentCompletion}=await imp('resident');
 const store=new Store(dataDir),s=await store.session(),operations=await store.operations();
 assert.equal(s?.sessionMode,'resident');assert.equal(s.storageMode,'direct');
 assert.equal(operations.filter(o=>['running','queued'].includes(o.status)).length,0);
 const anchor=operations.find(o=>o.operationId===s.lastStateOperationId);
 assert.ok(anchor?.resident&&anchor.status==='succeeded');
 assert.equal(anchor.project.projectId,s.projectId);assert.equal(anchor.project.sessionId,s.sessionId);
 const launchId=anchor.bridge.launchId;assert.equal(launchId,expectedLaunchId);
 const directory=store.file('resident/'+launchId);
 const [intent,start,exit,stop,failed]=await Promise.all(['intent.json','process-start.json','process-exit.json','stop.json','first-error.json'].map(n=>readJson(path.join(directory,n))));
 const identity=start?.processIdentity;
 assert.ok(validProcessIdentity(identity,anchor.bridge.pid));assert.equal(identity.platform,process.platform);assert.equal(identity.host,os.hostname().toLowerCase());
 assert.equal(start.launchId,launchId);assert.equal(intent.launchId,launchId);assert.equal(pathKey(intent.projectPath),pathKey(s.workingPath));
 assert.ok(validProcessIdentity(anchor.ownerIdentity,anchor.ownerPid));
 const stat=await fs.stat(s.workingPath,{bigint:true}),fileId=`${stat.dev}:${stat.ino}`,diskHash=digest(await fs.readFile(s.workingPath));
 const related=operations.filter(o=>o.resident&&o.project?.projectId===s.projectId&&o.project?.sessionId===s.sessionId);
 assert.ok(related.length);const sequences=[];
 for(const op of related){
  assert.equal(op.bridge?.launchId,launchId);assert.ok(['succeeded','conflict'].includes(op.status));
  const ipc=store.file('ipc/'+op.operationId);assert.equal(pathKey(op.bridge.directory),pathKey(ipc));
  const [request,result,check]=await Promise.all(['request.json','result.json','service-verification.json'].map(n=>readJson(path.join(ipc,n))));
  assert.equal(request.operationId,op.operationId);assert.equal(request.requestId,op.requestId);assert.equal(request.requestFingerprint,op.fingerprint);
  assert.equal(request.launchId,launchId);assert.equal(request.fileIdentity,fileId);assert.equal(request.diskHash,diskHash);assert.equal(pathKey(request.projectPath),pathKey(s.workingPath));
  checkSelectedApplication(request,result,op,s.applicationId,s.applications);
  assert.equal(result.status,op.status);assert.equal(residentHash(result.data.residentEvidence),residentHash(op.response.data.residentEvidence));
  assert.equal(check.passed,true);assert.equal(check.launchId,launchId);assert.equal(check.sequence,request.sequence);assert.deepEqual(check.processIdentity,identity);
  assert.equal(check.requestHash,residentHash(request));assert.equal(check.resultHash,residentHash(result));
  await verifyResidentCompletion(request,result,ipc,identity);
  if(op.status==='conflict'){assert.equal(result.data.recoverableRejection,true);assert.equal(result.data.firstError.dispatched,false);assert.deepEqual(result.data.secondaryErrors,[]);}
  assert.ok(Number.isFinite(Date.parse(op.finishedAt))&&Date.parse(op.finishedAt)<=Date.parse(exit?.at));sequences.push(request.sequence);
 }
 sequences.sort((a,b)=>a-b);
 const ideObservation=await probeProcess(identity.pid);
 // A reused PID is not accepted by this narrow maintenance gate.
 return checkBeforeShutdown({authorization,projectCloseDecision,activeOperations:0,launchId,
  currentDiskHash:diskHash,expectedDiskHash:s.diskHash,currentFileId:fileId,expectedFileId:intent.originalFileId,
  ideIdentity:identity,serviceIdentity:anchor.ownerIdentity,ideObservation,serviceObservation:await probeProcess(anchor.ownerPid),
  nativeExit:exit,requestCoverageComplete:true,sequences,receiverFailure:failed??null,stopRecord:stop??null,
  sessionId:s.sessionId,operationIds:related.map(o=>o.operationId),phase:'IDE closed; owning service intentionally still running'});
}

export function checkSelectedApplication(request,result,op,applicationId,applications){
 assert.equal(result?.data?.applicationId,applicationId,'Returned Application differs');
 assert.equal(op?.project?.applicationId,applicationId,'Registered Application differs');
 if(request.command==='inspect'&&!Object.hasOwn(request.args,'applicationId')){
  assert.equal(op.tool,'project_open','Only original project_open may omit Application');
  assert.equal(request.sequence,1,'Only initial inspect may select its Application');
  const candidates=result.data.applications;
  assert.ok(Array.isArray(candidates)&&candidates.length===1,'Unique Application list required');
  assert.equal(candidates[0].applicationId,applicationId);
  assert.ok(Array.isArray(candidates[0].path)&&candidates[0].path.length>0&&candidates[0].path.every(x=>typeof x==='string'&&x.length>0));
  assert.deepEqual(candidates,applications,'Session Application list differs');
 }else assert.equal(request.args.applicationId,applicationId,'Requested Application differs');
}

export class AcceptanceFinish {
 constructor({before,shutdown,observeExit,reopenProof,record}){Object.assign(this,{before,shutdown,observeExit,reopenProof,record});this.dispatched=false;this.attempted=false;}
 async run(){
  if(this.attempted)throw Error('Finish already attempted; no repeat shutdown');this.attempted=true;
  try{
   const before=checkBeforeShutdown(await this.before());await this.record('before-shutdown',before);
   this.dispatched=true;await this.shutdown();
   const exit=await this.observeExit();assert.equal(exit?.code,0);assert.equal(exit?.signal,null);
   await this.record('service-exited',exit);
   // Full production reopen proof belongs AFTER the old service exited.
   const proof=await this.reopenProof();await this.record('after-shutdown-reopen-proof',proof);return {exit,proof};
  }catch(error){this.firstError??=error;try{await this.record('finish-failed',{message:error.message,stack:error.stack,dispatched:this.dispatched});}catch(secondary){this.recordError??=secondary;}throw this.firstError;}
 }
}

export async function readAfterShutdown({fixed,dataDir}){
 const {Store}=await import(pathToFileURL(path.join(fixed,'dist/storage.js')).href);
 const {verifyClosedResident}=await import(pathToFileURL(path.join(fixed,'dist/resident-reopen.js')).href);
 const store=new Store(dataDir);return verifyClosedResident(store,await store.session(),randomUUID());
}
