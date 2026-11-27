// Acceptance-only pre-EOF review after an independently authorized normal IDE
// exit. No native/API calls, fake process observations or registry mutation.
// Unlike the pre-autosave helper, each request binds its own saved disk version.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {checkBeforeShutdown} from './resident-acceptance-finish.mjs';

export function advanceSavedVersion({request,result,check,accepted,committed,session,current},hash,policy){
 const equal=(a,b)=>hash(a)===hash(b);
 assert.equal(request.fileIdentity,current.fileIdentity,'Request file identity chain differs');
 assert.equal(request.diskHash,current.diskHash,'Request disk version chain differs');
 if(result.data.saved===false){assert.equal(result.data.diskHash,current.diskHash);assert.equal(check.diskHash,current.diskHash);return current;}
 assert.equal(result.data.saved,true);assert.equal(request.savePolicy,policy);
 assert.equal(accepted?.scheme,policy);assert.equal(accepted.requestHash,hash(request));
 assert.equal(accepted.receiptHash,hash(result.data.saveReceipt));assert(equal(accepted.beforeDisk,request.initialDisk));
 assert.equal(accepted.afterDisk?.diskHash,result.data.diskHash);assert.equal(typeof accepted.afterDisk.fileIdentity,'string');
 assert(accepted.afterDisk.fileIdentity.length>0);assert.equal(check.diskHash,result.data.diskHash);
 assert(equal(committed,{operationId:request.operationId,requestId:request.requestId,projectId:session.projectId,sessionId:session.sessionId,sourceHash:session.sourceHash,diskHash:result.data.diskHash,residentVersion:result.data.residentVersion,receiptHash:hash(result.data.saveReceipt),buildApplicable:false}));
 return {fileIdentity:accepted.afterDisk.fileIdentity,diskHash:accepted.afterDisk.diskHash};
}

export async function readBeforeAutosaveShutdown({fixed,dataDir,expectedLaunchId,authorization,projectCloseDecision}){
 const imp=n=>import(pathToFileURL(path.join(fixed,'dist',n+'.js')).href);
 const {Store,readJson,pathKey}=await imp('storage');
 const {residentHash,verifyResidentResult}=await imp('resident');
 const {probeProcess,validProcessIdentity}=await imp('lease-process');
 const {closedApplicationBinding}=await imp('resident-reopen');
 const {residentDisk}=await imp('resident-saved');const {SAVE_POLICY}=await imp('resident-save');
 const store=new Store(dataDir),session=await store.session(),operations=await store.operations();
 assert.equal(session?.sessionMode,'resident');assert.equal(session.storageMode,'direct');
 assert.equal(operations.filter(o=>['running','queued'].includes(o.status)).length,0);
 const anchor=operations.find(o=>o.operationId===session.lastStateOperationId);
 assert(anchor?.resident&&anchor.status==='succeeded');assert.equal(anchor.project.sessionId,session.sessionId);
 const launchId=anchor.bridge.launchId;assert.equal(launchId,expectedLaunchId);
 const root=store.file('resident/'+launchId);
 const [intent,start,exit,stop,failed]=await Promise.all(['intent.json','process-start.json','process-exit.json','stop.json','first-error.json'].map(n=>readJson(path.join(root,n))));
 const identity=start?.processIdentity;
 assert(validProcessIdentity(identity,anchor.bridge.pid));assert.equal(identity.platform,process.platform);assert.equal(identity.host,os.hostname().toLowerCase());
 assert.equal(start.launchId,launchId);assert.equal(intent.launchId,launchId);assert.equal(pathKey(intent.projectPath),pathKey(session.workingPath));
 assert(exit&&exit.code===0&&exit.signal===null,'Normal native exit is required before client EOF');
 assert(validProcessIdentity(anchor.ownerIdentity,anchor.ownerPid));
 const image=await residentDisk(session.workingPath);assert.equal(image.diskHash,session.diskHash);
 const related=operations.filter(o=>o.resident&&o.project?.projectId===session.projectId&&o.project?.sessionId===session.sessionId);
 assert(related.length>0);const rows=await Promise.all(related.map(async op=>({op,request:await readJson(store.file('ipc/'+op.operationId+'/request.json'))})));
 rows.sort((a,b)=>a.request.sequence-b.request.sequence);
 let current={fileIdentity:intent.originalFileId,diskHash:rows[0].request.diskHash};const chain=[],sequences=[];
 for(const {op,request} of rows){
  assert.equal(op.status,'succeeded');assert.equal(op.bridge.launchId,launchId);
  const ipc=store.file('ipc/'+op.operationId);assert.equal(pathKey(op.bridge.directory),pathKey(ipc));assert.equal(pathKey(await fs.realpath(ipc)),pathKey(ipc));
  const [result,check]=await Promise.all(['result.json','service-verification.json'].map(n=>readJson(path.join(ipc,n))));
  assert.equal(request.operationId,op.operationId);assert.equal(request.requestId,op.requestId);assert.equal(request.requestFingerprint,op.fingerprint);assert.equal(request.launchId,launchId);assert.equal(pathKey(request.projectPath),pathKey(session.workingPath));
  assert(closedApplicationBinding(op,request,result,session));assert.equal(result.status,op.status);
  assert.equal(residentHash(result.data.residentEvidence),residentHash(op.response.data.residentEvidence));
  assert.equal(check.passed,true);assert.equal(check.launchId,launchId);assert.equal(check.sequence,request.sequence);assert.deepEqual(check.processIdentity,identity);
  assert.equal(check.requestHash,residentHash(request));assert.equal(check.resultHash,residentHash(result));
  assert(Number.isFinite(Date.parse(op.finishedAt))&&Date.parse(op.finishedAt)<=Date.parse(exit.at));
  await verifyResidentResult(request,result,ipc,identity);
  const [accepted,committed]=result.data.saved===true?await Promise.all(['saved-channel-accepted','saved-registration-committed'].map(n=>readJson(path.join(ipc,n+'.json')))):[undefined,undefined];
  current=advanceSavedVersion({request,result,check,accepted,committed,session,current},residentHash,SAVE_POLICY);
  if(accepted)chain.push({operationId:op.operationId,acceptedHash:residentHash(accepted),afterDisk:accepted.afterDisk});
  sequences.push(request.sequence);
 }
 return checkBeforeShutdown({authorization,projectCloseDecision,activeOperations:0,launchId,currentDiskHash:image.diskHash,expectedDiskHash:current.diskHash,currentFileId:image.fileIdentity,expectedFileId:current.fileIdentity,ideIdentity:identity,serviceIdentity:anchor.ownerIdentity,ideObservation:await probeProcess(identity.pid),serviceObservation:await probeProcess(anchor.ownerPid),nativeExit:exit,requestCoverageComplete:true,sequences,receiverFailure:failed??null,stopRecord:stop??null,sessionId:session.sessionId,operationIds:rows.map(x=>x.op.operationId),saveVersionChain:chain,phase:'Native IDE already closed; owning service remains alive; production saved reopen proof still required AFTER EOF'});
}
