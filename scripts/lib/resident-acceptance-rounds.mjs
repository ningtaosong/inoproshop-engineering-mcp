// Acceptance driver only. Explicit build uses the product MCP; no native API,
// lease repair, automatic continuation, save or IDE close.
import {randomUUID} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=/^[0-9a-f]{64}$/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const details=e=>({name:e?.name??'Error',message:e?.message??String(e),stack:e?.stack});
class RoundEnd extends Error {constructor(result,recoverable=false){super(result.error?.message??result.status);this.result=result;this.recoverable=recoverable;}}
class BeforeWriteConflict extends Error {}
export class ResidentAcceptanceRounds {
 constructor({call,record,finish,observeExit,pollMs=2000,timeoutMs=180000}) {
  Object.assign(this,{call,record,finish,observeExit,pollMs,timeoutMs});this.state='waiting';this.ticket=randomUUID();this.seen=new Map();this.sequence=0;
 }
 control(){return {state:this.state,ticket:this.ticket,project:this.target??null,firstError:this.firstError??null,
  allowed:this.state==='waiting'?['open','edit','build','finish']:this.state==='frozen'?['finish']:this.state==='finish-pending'?['observe-exit']:[]};}
 async log(event,data){await this.record(event,data);}
 async stop(error){this.firstError??=details(error);this.state='frozen';
  try{await this.log('frozen',{firstError:this.firstError,error:details(error)});}catch(secondary){this.recordError??=details(secondary);}
 }
 async submit(command){
  if(!command||!uuid.test(command.id??'')||typeof command.authorization!=='string'||!command.authorization.trim())throw Error('Explicit command ID and authorization reference required');
  if(this.seen.has(command.id)){
   const old=this.seen.get(command.id);if(old.command!==JSON.stringify(command))throw Error('Command ID reused with changed content');return old.result??{status:'running',commandId:command.id};
  }
  if(command.ticket!==this.ticket)throw Error('Stale control ticket; a new explicit submission is required');
  if(!this.control().allowed.includes(command.kind))throw Error('Command not permitted in '+this.state);
  this.seen.set(command.id,{command:JSON.stringify(command)});this.state='running';this.active=command.id;this.writeAttempted=false;
  let result;
  try {
   await this.log('command-accepted',command);
   if(command.kind==='finish'){
    // EOF is a client finish request, never permission to save/close the IDE.
    try{const exit=await this.finish();if(exit?.code!==0||exit?.signal!==null)throw Error('Normal service exit not confirmed');
     result={status:'finished',exit,ideCloseRequested:false};this.state='finished';}
    catch(error){this.cleanupError??=details(error);result={status:'finish-pending',firstCleanupError:this.cleanupError,ideCloseRequested:false};this.state='finish-pending';}
   }else if(command.kind==='observe-exit'){
    const exit=await this.observeExit();this.state=exit?'finished':'finish-pending';
    result={status:exit?'finished-with-prior-error':'finish-pending',exit,firstCleanupError:this.cleanupError,ideCloseRequested:false};
   }else if(command.kind==='open'){result=await this.open(command);this.state='waiting';}
   else if(command.kind==='build'){result=await this.build(command);this.state='waiting';}
   else {result=await this.edit(command);this.state='waiting';}
  } catch(error) {
   const recoverable=!this.writeAttempted&&(error instanceof BeforeWriteConflict||error instanceof RoundEnd&&error.recoverable);
   result={status:recoverable?'round-rejected':'frozen',error:details(error),originalResult:error.result??null,writeAttempted:this.writeAttempted};
   if(recoverable)this.state='waiting';else await this.stop(error);
  }
  // The next command must bind a ticket created AFTER this round, including a
  // successful round. Prequeued continuations cannot authorize themselves.
  this.ticket=randomUUID();this.active=null;
  try{await this.log('command-result',{commandId:command.id,result,control:this.control()});}
  catch(error){await this.stop(error);result={status:'frozen',firstError:this.firstError,recordError:this.recordError??null};}
  this.seen.get(command.id).result=result;return result;
 }
 async request(name,args){
  const started=Date.now();let result=await this.call(name,args),operationId=result?.operationId;
  while(result?.status==='running'){
   if(!uuid.test(operationId??'')||result.operationId!==operationId||Date.now()-started>this.timeoutMs)throw Error('Running evidence/deadline uncertain; original operation retained');
   await pause(this.pollMs);result=await this.call('operation_status',{operationId});
  }
  if(!uuid.test(result?.operationId??'')||!result.requestId||operationId&&operationId!==result.operationId||args.requestId&&args.requestId!==result.requestId)throw Error('Operation/request binding missing or changed');
  const d=result.data,e=d?.residentEvidence;
  // A service-side rejection can precede native dispatch. Preserve it verbatim;
  // absence of a native receipt is NOT proof that a new business round is safe.
  if(result.status!=='succeeded'&&!e)throw new RoundEnd(result,false);
  if(!e||e.requestCompleted!==true||e.ideExitRequested!==false||!uuid.test(e.launchId??'')||!hash.test(e.requestHash??'')||
   !Number.isSafeInteger(e.sequence)||e.sequence<=this.sequence||!Number.isSafeInteger(e.processIdentity?.pid)||e.processIdentity.pid<=0||!/^\d+$/.test(e.processIdentity?.startId??''))throw Error('Resident completion/creation evidence missing or changed');
  const identity=JSON.stringify([e.launchId,e.processIdentity.pid,e.processIdentity.startId]);
  if(this.identity&&this.identity!==identity)throw Error('Resident process changed');this.identity=identity;this.sequence=e.sequence;
  if(d.saved!==false||d.reopened!==false||d.closed!==false)throw Error('Unexpected save/reopen/close or missing evidence');
  if(result.status!=='succeeded'){
   const recoverable=result.status==='conflict'&&d.recoverableRejection===true&&d.firstError?.dispatched===false&&Array.isArray(d.secondaryErrors)&&d.secondaryErrors.length===0;
   throw new RoundEnd(result,recoverable);
  }
  if(!hash.test(d.residentVersion??'')||!hash.test(d.diskHash??'')||[d.saveCalls,d.closeCalls,d.exitCalls].some(n=>n!==0)||d.compileCalls!==(name==='project_build'?1:0))throw Error('Version or explicit-side-effect evidence missing');
  return result;
 }
 async open(command){
  if(this.target)throw new BeforeWriteConflict('Already open; no automatic reopen');
  if(typeof command.projectPath!=='string'||!uuid.test(command.applicationId??''))throw new BeforeWriteConflict('Explicit project and Application required');
  const result=await this.request('project_open',{requestId:command.id,projectPath:command.projectPath,applicationId:command.applicationId,sessionMode:'resident'});
  const d=result.data;if(!uuid.test(d.session?.projectId??'')||d.applicationId!==command.applicationId||d.projectPath!==command.projectPath)throw Error('Opened project binding differs');
  this.target={projectId:d.session.projectId,applicationId:d.applicationId,targetKind:'application'};
  this.diskHash=d.diskHash;return {status:'opened',result};
 }
 async listCurrent(limit=200){
  const rows=[];let offset=0,version,total;
  do{
   // First page is a NEW view, not a continuation of project_open. Never copy
   // its old version. Every later page binds the first page's actual version.
   const args={...this.target,offset,limit,...(offset?{expectedResidentVersion:version}:{})};
   const response=await this.request('object_list',args),d=response.data;
   if(d.diskHash!==this.diskHash)throw new BeforeWriteConflict('Disk version changed');
   if(offset&&d.residentVersion!==version)throw new BeforeWriteConflict('Continuation version changed');
   version??=d.residentVersion;total??=d.total;
   if(d.complete!==true||!Array.isArray(d.objects)||!Number.isSafeInteger(d.total)||d.total<0||total!==d.total)throw Error('Incomplete object coverage');
   rows.push(...d.objects);
   if(rows.some(r=>!uuid.test(r?.objectId??''))||new Set(rows.map(r=>r.objectId.toLowerCase())).size!==rows.length)throw Error('Missing/duplicate object identity');
   const next=d.nextOffset;
   if(next===null){if(rows.length!==total)throw Error('Incomplete final page');break;}
   if(!Number.isSafeInteger(next)||next!==rows.length||next<=offset||next>=total)throw Error('Invalid pagination progress');offset=next;
  }while(true);
  return {rows,version};
 }
 async edit(command){
  if(!this.target||!uuid.test(command.objectId??'')||typeof command.beforeImplementation!=='string'||typeof command.afterImplementation!=='string'||command.beforeImplementation===command.afterImplementation)throw new BeforeWriteConflict('Explicit existing target and distinct exact implementation required');
  if(command.limit!==undefined&&(!Number.isInteger(command.limit)||command.limit<1||command.limit>200))throw new BeforeWriteConflict('Invalid page limit');
  const listed=await this.listCurrent(command.limit),matches=listed.rows.filter(r=>r.objectId.toLowerCase()===command.objectId.toLowerCase());
  if(matches.length!==1)throw new BeforeWriteConflict('Target is not uniquely present in current supported view');
  const args={...this.target,objectId:matches[0].objectId},before=await this.request('object_read',args),d=before.data;
  // Pagination is one view. The following object_read is a separate current
  // snapshot; bind the write to that response, never refresh/retry an old write.
  if(d.diskHash!==this.diskHash||d.implementation!==command.beforeImplementation)throw new BeforeWriteConflict('Current target/source/disk differs; no write dispatched');
  if(d.objectId!==args.objectId||d.applicationId!==this.target.applicationId||typeof d.declaration!=='string'||!hash.test(d.contentHash??''))throw Error('Object read evidence incomplete');
  for(const key of ['objectId','applicationId','path','nativeTypeId','embeddedObjectTypes','language','objectType','hasImplementation']){
   if(!Object.hasOwn(matches[0],key)||!Object.hasOwn(d,key))throw Error('Object identity evidence incomplete: '+key);
   if(JSON.stringify(matches[0][key])!==JSON.stringify(d[key]))throw new BeforeWriteConflict('Located object identity changed: '+key);
  }
  await this.log('write-plan',{commandId:command.id,objectId:d.objectId,declaration:d.declaration,before:d.implementation,after:command.afterImplementation,listedVersion:listed.version,expectedHash:d.contentHash,expectedResidentVersion:d.residentVersion,diskHash:d.diskHash});
  this.writeAttempted=true;
  let changed;
  try{changed=await this.request('code_apply_change',{...args,requestId:command.id,expectedHash:d.contentHash,expectedResidentVersion:d.residentVersion,declaration:d.declaration,implementation:command.afterImplementation});}
  catch(error){if(error instanceof RoundEnd&&error.recoverable)this.writeAttempted=false;throw error;}
  const after=await this.request('object_read',args);
  for(const row of [changed.data,after.data])if(row.objectId!==d.objectId||row.applicationId!==d.applicationId||row.declaration!==d.declaration||row.implementation!==command.afterImplementation||row.diskHash!==this.diskHash)throw Error('Postwrite target/source/disk differs');
  if(after.data.residentVersion!==changed.data.residentVersion||after.data.contentHash!==changed.data.contentHash)throw Error('Postwrite readback version differs');
  this.lastRead=after.data;
  return {status:'succeeded',before,changed,after,saveCalls:0,compileCalls:0,closeCalls:0};
 }
 async build(command){
  if(!this.target||!uuid.test(command.objectId??'')||typeof command.expectedImplementation!=='string'||!this.lastRead)throw new BeforeWriteConflict('Explicit build target and prior accepted readback required');
  const args={...this.target,objectId:command.objectId},before=await this.request('object_read',args),d=before.data;
  const keys=['objectId','applicationId','path','nativeTypeId','embeddedObjectTypes','language','objectType','hasImplementation','declaration','implementation','contentHash','diskHash'];
  const check=(row,expected)=>{
   for(const key of keys)if(!Object.hasOwn(row,key)||!Object.hasOwn(expected,key)||JSON.stringify(row[key])!==JSON.stringify(expected[key]))throw Error('Build readback differs or missing: '+key);
   if(row.objectId!==command.objectId||row.applicationId!==this.target.applicationId||row.implementation!==command.expectedImplementation||row.diskHash!==this.diskHash)throw Error('Build target/source/disk differs');
  };
  check(d,this.lastRead);
  await this.log('build-plan',{commandId:command.id,objectId:d.objectId,expectedResidentVersion:d.residentVersion,diskHash:d.diskHash,contentHash:d.contentHash});
  this.writeAttempted=true; // compilation may change native in-memory metadata
  const built=await this.request('project_build',{...this.target,requestId:command.id,expectedResidentVersion:d.residentVersion}),b=built.data;
  if(b.applicationId!==this.target.applicationId||b.buildInputResidentVersion!==d.residentVersion||b.buildEvidenceScope!=='resident-memory'||b.completed!==true||b.diagnosticsComplete!==true||b.buildPassed!==true||b.errorCount!==0||!Number.isSafeInteger(b.warningCount)||b.warningCount<0||!Array.isArray(b.diagnostics)||b.buildConservation?.passed!==true||b.buildConservation?.sourceUnchanged!==true||b.buildConservation?.taskCallsUnchanged!==true||b.diskHash!==this.diskHash||b.persistedToProject!==false||b.persistedToWorkingCopy!==false)throw Error('Build diagnostics/conservation/memory evidence incomplete or failed');
  const after=await this.request('object_read',args);check(after.data,d);
  if(after.data.residentVersion!==b.residentVersion)throw Error('Independent postbuild memory version differs');
  this.lastRead=after.data;
  return {status:'succeeded',before,built,after,saveCalls:0,compileCalls:1,closeCalls:0};
 }
}
