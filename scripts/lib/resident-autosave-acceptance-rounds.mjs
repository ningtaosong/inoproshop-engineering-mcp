// Acceptance-only controller for the pinned autosave candidate. No native writes,
// compile, recovery, project close or automatic continuation.
import {ResidentAcceptanceRounds} from './resident-acceptance-rounds.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=/^[0-9a-f]{64}$/;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const identityKeys=['objectId','applicationId','path','nativeTypeId','embeddedObjectTypes','language','objectType','hasImplementation'];
function equalFields(a,b,keys){
 for(const key of keys)if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key)||JSON.stringify(a[key])!==JSON.stringify(b[key]))throw Error('Readback missing/different: '+key);
}
export function validateReply(result,name,previous){
 const d=result?.data,e=d?.residentEvidence;
 if(result?.status!=='succeeded')throw Object.assign(Error('MCP did not succeed: '+result?.status),{result});
 if(!uuid.test(result.operationId??'')||!result.requestId||!e||e.requestCompleted!==true||e.ideExitRequested!==false||!uuid.test(e.launchId??'')||!hash.test(e.requestHash??'')||
 !Number.isSafeInteger(e.sequence)||e.sequence<=previous.sequence||!Number.isSafeInteger(e.processIdentity?.pid)||e.processIdentity.pid<=0||!/^\d+$/.test(e.processIdentity?.startId??''))throw Error('Resident process/request completion evidence incomplete');
 const identity=JSON.stringify([e.launchId,e.processIdentity.pid,e.processIdentity.startId]);
 if(previous.identity&&previous.identity!==identity)throw Error('IDE creation instance changed');
 if(!hash.test(d.diskHash??'')||!hash.test(d.residentVersion??'')||!Number.isSafeInteger(d.projectHandle)||typeof d.projectPath!=='string'||
 d.closed!==false||d.reopened!==false||d.closeCalls!==0||d.exitCalls!==0||d.compileCalls!==0)throw Error('Unexpected lifecycle or incomplete evidence');
 if(previous.projectHandle!==undefined&&(d.projectHandle!==previous.projectHandle||d.projectPath!==previous.projectPath))throw Error('Project handle/path changed');
 if(name==='code_apply_change'){
  const r=d.saveReceipt;
  if(d.saved!==true||d.saveCalls!==1||d.memoryModified!==true||d.persistedToProject!==true||d.persistedToWorkingCopy!==false||!r||
   r.scheme!=='resident-confirmed-change-save-v1'||r.beforeDiskHash!==previous.diskHash||r.afterDiskHash!==d.diskHash||r.beforeDiskHash===r.afterDiskHash||
   r.projectHandle!==d.projectHandle||r.projectPath!==d.projectPath||r.reopened!==false||r.requestHash!==e.requestHash||
   ['callHash','returnedHash','firstReadHash','secondReadHash'].some(k=>!hash.test(r[k]??'')))throw Error('Exactly one confirmed autosave receipt required');
 }else if(d.saved!==false||d.saveCalls!==0||d.memoryModified!==false||previous.diskHash&&d.diskHash!==previous.diskHash)throw Error('Read performed save/change or disk version differs');
 return {identity,sequence:e.sequence,diskHash:d.diskHash,projectHandle:d.projectHandle,projectPath:d.projectPath};
}
export class ResidentAutosaveAcceptanceRounds extends ResidentAcceptanceRounds {
 control(){const c=super.control();c.allowed=this.state==='waiting'?(this.target?['edit']:['open']):[];return c;}
 async request(name,args){
  if(!['project_open','object_list','object_read','code_apply_change'].includes(name))throw Error('Tool outside this acceptance');
  let r=await this.call(name,args);const op=r?.operationId,requestId=r?.requestId,deadline=Date.now()+this.timeoutMs;
  while(r?.status==='running'){
   if(!uuid.test(op??'')||!requestId||Date.now()>=deadline)throw Error('Original operation observation unconfirmed');
   await pause(this.pollMs);r=await this.call('operation_status',{operationId:op});
   if(r?.operationId!==op||r?.requestId!==requestId)throw Error('Original operation identity changed');
  }
  if(op&&r?.operationId!==op||args.requestId&&r?.requestId!==args.requestId)throw Error('Request identity changed');
  Object.assign(this,validateReply(r,name,this));return r;
 }
 async open(command){
  if(this.target||typeof command.projectPath!=='string'||typeof command.programName!=='string')throw Error('One explicit target and PROGRAM name required');
  const opened=await this.request('project_open',{requestId:command.id,projectPath:command.projectPath,sessionMode:'resident'}),d=opened.data;
  if(!uuid.test(d.session?.projectId??'')||!uuid.test(d.applicationId??'')||d.projectPath!==command.projectPath)throw Error('Opened target differs');
  this.target={projectId:d.session.projectId,applicationId:d.applicationId,targetKind:'application'};
  const listed=await this.listCurrent();
  const candidates=listed.rows.filter(r=>r.path?.at(-1)===command.programName);
  if(candidates.length!==1)throw Error('PROGRAM name did not resolve uniquely');
  const read=await this.request('object_read',{...this.target,objectId:candidates[0].objectId});
  equalFields(candidates[0],read.data,identityKeys);
  this.lastRead=read.data;return {status:'opened',opened,listed,read,saveCalls:0,compileCalls:0,closeCalls:0};
 }
 async edit(command){
  if(!this.target||!uuid.test(command.objectId??'')||typeof command.beforeImplementation!=='string'||typeof command.afterImplementation!=='string'||command.beforeImplementation===command.afterImplementation)throw Error('Explicit distinct source replacement required');
  const listed=await this.listCurrent(),matches=listed.rows.filter(r=>r.objectId===command.objectId);
  if(matches.length!==1)throw Error('Target identity missing or ambiguous');
  const args={...this.target,objectId:command.objectId},before=await this.request('object_read',args),b=before.data;
  equalFields(matches[0],b,identityKeys);
  if(b.implementation!==command.beforeImplementation||typeof b.declaration!=='string'||!hash.test(b.contentHash??''))throw Error('Actual source differs before dispatch');
  await this.log('write-plan',{commandId:command.id,objectId:b.objectId,before:b.implementation,after:command.afterImplementation,declaration:b.declaration,expectedHash:b.contentHash,expectedResidentVersion:b.residentVersion,diskHash:b.diskHash});
  this.writeAttempted=true;
  const changed=await this.request('code_apply_change',{...args,requestId:command.id,expectedHash:b.contentHash,expectedResidentVersion:b.residentVersion,declaration:b.declaration,implementation:command.afterImplementation});
  const after=await this.request('object_read',args);
  for(const row of [changed.data,after.data]){
   equalFields(b,row,[...identityKeys,'declaration']);
   if(row.implementation!==command.afterImplementation||row.diskHash!==this.diskHash)throw Error('Saved source/file readback differs');
  }
  equalFields(changed.data,after.data,['contentHash','residentVersion','diskHash','projectHandle','projectPath']);
  this.lastRead=after.data;
  return {status:'succeeded',before,changed,after,saveCalls:1,compileCalls:0,closeCalls:0,ideKeptOpen:true};
 }
}
