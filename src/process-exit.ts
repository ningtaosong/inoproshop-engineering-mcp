// Service-owned observations. A result file or absent PID is not exit-code evidence.
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {atomicJson,readJson,canonical,digest} from './storage.js';
import {sameProcess,validProcessIdentity,probeProcess,type ProcessProbe,type ProcessObservation} from './lease-process.js';
export interface ExecutionBinding {operationId:string;requestId:string;requestFingerprint:string;}
export interface LaunchBinding extends ExecutionBinding {launchId:string;requestHash:string;}
export interface ProcessStartEvidence {binding:LaunchBinding;pid:number|null;process:ProcessObservation;observedAt:string;}
export interface ExitObservation {state:'exited'|'spawn-error'|'unconfirmed';code:number|null;signal:string|null;observedAt:string;error?:{name:string;message:string;code?:string};}
export type EvidenceWriter=(file:string,value:unknown)=>Promise<void>;
export async function publishProcessEvidence(file:string,value:unknown,write:EvidenceWriter=atomicJson) {
  await write(file,{schemaVersion:1,checksum:digest(canonical(value)),value});
}
export async function evidenceFileHash(file:string):Promise<string|null> {
  try{return digest(await fs.readFile(file));}catch(e:any){if(e.code==='ENOENT')return null;throw e;}
}
async function evidence(file:string) {
  const envelope=await readJson(file);
  if(envelope===undefined)return undefined;
  if(envelope.schemaVersion!==1||envelope.checksum!==digest(canonical(envelope.value)))throw Error('checksum or schema mismatch');
  return envelope.value;
}
export async function exitVerdict(directory:string,request:any,expected?:ExecutionBinding & {launchId?:string},probe:ProcessProbe=probeProcess) {
  const fail=(code:string,details:any={})=>({confirmed:false as const,code,...details});
  let start:any,exit:any;
  try {
    start=await evidence(path.join(directory,'process-start.json'));
    exit=await evidence(path.join(directory,'process-exit.json'));
    // New append-only diagnostics do not replace a receipt, and a receipt cannot
    // silently overrule a known publication/runtime failure on restart.
    for(const stage of ['process-start','process-exit','process-runtime']) {
      const failure=await evidence(path.join(directory,stage+'-publication-error.json'));
      if(failure){const b=failure.binding;
        if(!b||b.operationId!==request.operationId||b.requestId!==request.requestId||b.requestFingerprint!==request.requestFingerprint||
          b.launchId!==request.launchId||b.requestHash!==digest(canonical(request)))return fail('EXIT_EVIDENCE_MISMATCH',{failure});
        return fail('EXIT_EVIDENCE_PUBLISH_FAILED',{failure,start:start??null,exit:exit??null});
      }
    }
  } catch(e:any) {return fail('EXIT_EVIDENCE_INVALID',{reason:e.message});}
  if(!start)return fail('EXIT_EVIDENCE_MISSING',{start:null,exit:exit??null});
  const b=start.binding;
  if(request.exitEvidenceVersion!==1||!b||b.operationId!==request.operationId||
    b.requestId!==request.requestId||b.requestFingerprint!==request.requestFingerprint||
    !b.requestId||!b.requestFingerprint||b.launchId!==request.launchId||
    b.requestHash!==digest(canonical(request))||
    (start.pid!==null&&(!Number.isInteger(start.pid)||start.pid<=0))||
    !Number.isFinite(Date.parse(start.observedAt))||
    (expected&&(b.operationId!==expected.operationId||b.requestId!==expected.requestId||
      b.requestFingerprint!==expected.requestFingerprint||(expected.launchId&&b.launchId!==expected.launchId))))
    return fail('EXIT_EVIDENCE_MISMATCH',{start,exit:exit??null});
  if(!exit&&start.process?.state==='running'&&validProcessIdentity(start.process.identity,start.pid)){
    const current=await probe(start.pid).catch((e:any)=>({state:'unconfirmed' as const,reason:e.message}));
    if(current.state==='running'&&sameProcess(start.process.identity,current.identity))return fail('IDE_STILL_RUNNING',{start,current});
    if(current.state!=='exited')return fail('EXIT_IDENTITY_UNCONFIRMED',{start,current});
  }
  if(!exit)return fail('EXIT_EVIDENCE_MISSING',{start,exit:null});
  if(canonical(exit.binding)!==canonical(b)||exit.startHash!==digest(canonical(start))||exit.pid!==start.pid||
    !Number.isFinite(Date.parse(exit.observedAt))||Date.parse(exit.observedAt)<Date.parse(start.observedAt))
    return fail('EXIT_EVIDENCE_MISMATCH',{start,exit});
  // A clean OS exit does not erase an earlier observer error. Kept in the normal
  // receipt too so a failed supplemental diagnostic cannot disappear on restart.
  if(exit.observerFailure!==undefined&&exit.observerFailure!==null)
    return fail('EXIT_OBSERVER_FAILED',{start,exit,observationFailure:exit.observerFailure});
  if(exit.resultHash!==await evidenceFileHash(path.join(directory,'result.json'))||
    exit.dispatchHash!==await evidenceFileHash(path.join(directory,'dispatched.json')))
    return fail('EXIT_FILES_CHANGED',{start,exit});
  if(exit.state==='spawn-error'&&start.pid===null&&exit.code===null&&exit.signal===null&&exit.error)
    return {confirmed:true as const,normal:false,notStarted:true,start,exit};
  if(start.process?.state!=='running'||!validProcessIdentity(start.process.identity,start.pid)||
    !validProcessIdentity(exit.processIdentity,start.pid)||!sameProcess(start.process.identity,exit.processIdentity))
    return fail('EXIT_IDENTITY_UNCONFIRMED',{start,exit});
  if(exit.state!=='exited'||(exit.code!==null&&!Number.isInteger(exit.code))||
    (exit.signal!==null&&(typeof exit.signal!=='string'||!exit.signal))||
    (exit.code===null&&exit.signal===null))
    return fail('EXIT_STATUS_UNCONFIRMED',{start,exit});
  return {confirmed:true as const,normal:exit.code===0&&exit.signal===null,notStarted:false,start,exit};
}
