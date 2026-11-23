import path from 'node:path';
import {digest} from './storage.js';
import type {Reply} from './contracts.js';

// Transport-only projection. Validation and persisted operation/IPC evidence use
// the complete reply. Only the newly introduced clear result has this shape.
export function placeholderClearDelivery(source:Reply,dataDir:string):Reply {
  const d=source.data as any;
  if(source.status!=='succeeded'||d?.cleared!==true||!d.before?.nativeScope||!d.immediate||!d.after)return source;
  const result:any={};
  for(const key of ['projectId','applicationId','managerId','placeholderReferenceId','changed','cleared','reopened','buildApplicable',
    'beforePlaceholderVersion','placeholderVersion','checkpoint','snapshot','diskHash','workerDiskHash','postExitDiskHashObserved',
    'persistedToProject','persistedToWorkingCopy','editMode','targetBefore','targetImmediate','targetAfter','resolution'])
    if(Object.hasOwn(d,key))result[key]=d[key];
  result.projectPath=d.projectPath??d.before.library.projectPath;
  result.nativeScope=d.before.nativeScope;
  result.configurationVersion=d.after.library.configurationVersion;
  result.preservation={verified:true,referenceCount:d.after.library.references.length,
    sourceObjectCount:d.after.sources.length,applicationTaskInventoryCount:Object.keys(d.after.tasks).length,
    scope:'Complete captured native evidence verified by bridge and service; full inventories/source text not delivered here'};
  result.evidence={operationRecord:path.join(dataDir,'operations',source.operationId!+'.json'),
    ipcDirectory:path.join(dataDir,'ipc',source.operationId!),completeReplySha256:digest(JSON.stringify(source))};
  result.delivery={kind:'placeholder-clear-summary-v1',fullEvidenceRetained:true,maxReplyBytes:16000,
    omitted:['before','immediate','after'],guidance:'Actual target/versions only; full source, library and task snapshots remain in operation/IPC evidence. Repeated request and operation_status return the same summary.'};
  let output={...source,data:result};
  if(Buffer.byteLength(JSON.stringify(output),'utf8')>16000){
    // Exceptional native metadata must not become a false null or empty value.
    // Keep a typed preview with its original digest, while raw values stay on disk.
    const previews:Record<string,unknown>={};
    for(const key of ['targetBefore','targetImmediate','targetAfter','resolution']){
      const raw=JSON.stringify(result[key]);previews[key]={sha256:digest(raw),utf8Bytes:Buffer.byteLength(raw),text:raw.slice(0,512),complete:false};
      delete result[key];
    }
    result.delivery={...result.delivery,omitted:[...result.delivery.omitted,...Object.keys(previews)],fieldPreviews:previews,
      guidance:'Native metadata exceeds the delivery budget; previews are not complete values. Consult retained evidence; do not infer resolution from truncation.'};
    result.resolutionStatus=d.resolution.status;
    output={...source,data:result};
  }
  return output;
}
