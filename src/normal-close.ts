// New launches require public-close receipts in addition to OS exit evidence.
// Historical requests without this policy retain their original exit protocol.
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {readJson,canonical} from './storage.js';
import {evidenceFileHash} from './process-exit.js';
export const NORMAL_CLOSE_GUID='caa0ef1f-6563-49ae-b0e0-80095fb233ef';
export const NORMAL_CLOSE_STAGES=['preflight','queue','queued','callback','dispatch','returned','failed'] as const;
export async function normalCloseHashes(directory:string) {
 const values:Record<string,string|null>={};
 for(const stage of NORMAL_CLOSE_STAGES)values[stage]=await evidenceFileHash(path.join(directory,`normal-close-${stage}.json`));
 return values;
}
export async function normalCloseVerdict(directory:string,request:any,exitVerdict:any) {
 if(request.normalClosePolicy===undefined)return {confirmed:true,legacy:true};
 const fail=(code:string,details:any={})=>({confirmed:false,code,...details});
 try {
  const policy=request.normalClosePolicy;
  if(policy?.version!==1||policy.commandGuid!==NORMAL_CLOSE_GUID||
    !/^[0-9a-f]{64}$/.test(policy.workerHash)||!/^[0-9a-f]{64}$/.test(policy.helperHash))return fail('NORMAL_CLOSE_POLICY_INVALID');
  const hashes=await normalCloseHashes(directory);
  if(canonical(exitVerdict.exit.normalCloseHashes)!==canonical(hashes))return fail('NORMAL_CLOSE_FILES_CHANGED');
  if(exitVerdict.exit.normalCloseStderrHash!==await evidenceFileHash(path.join(directory,'stderr.txt')))return fail('NORMAL_CLOSE_FILES_CHANGED');
  const stderr=await fs.readFile(path.join(directory,'stderr.txt'),'utf8');
  const events:any={};
  for(const stage of NORMAL_CLOSE_STAGES)events[stage]=await readJson(path.join(directory,`normal-close-${stage}.json`));
  if(hashes.failed!==null)return fail('NORMAL_CLOSE_FAILED',{firstFailure:events.failed});
  if(/NORMAL_CLOSE_(FIRST_ERROR|SECONDARY_ERROR|RECORD_ERROR)/.test(stderr))return fail('NORMAL_CLOSE_FAILED',{failureSource:'stderr.txt'});
  if(NORMAL_CLOSE_STAGES.some(stage=>stage!=='failed'&&hashes[stage]===null))return fail('NORMAL_CLOSE_EVIDENCE_MISSING');
  const start=exitVerdict.start,exit=exitVerdict.exit;
  const binding={operationId:request.operationId,requestId:request.requestId,requestFingerprint:request.requestFingerprint,
   launchId:request.launchId,pid:start.pid,startId:start.process.identity.startId,
   requestFileHash:await evidenceFileHash(path.join(directory,'request.json'))};
  for(const stage of NORMAL_CLOSE_STAGES.filter(s=>s!=='failed')) {
   const e=events[stage],utc=Date.parse(e?.utc);
   if(e?.schemaVersion!==1||e.stage!==stage||canonical(e.binding)!==canonical(binding)||
     !Number.isFinite(utc)||utc<Date.parse(start.observedAt)||utc>Date.parse(exit.observedAt))return fail('NORMAL_CLOSE_BINDING_INVALID',{stage});
  }
  for(const stage of ['preflight','queue','callback'])if(canonical(events[stage].noProject)!==canonical({primaryIsNone:true,openProjectCount:0,uiPresent:true}))
   return fail('NORMAL_CLOSE_PROJECTS_UNCONFIRMED',{stage});
  if(canonical(events.preflight.policy)!==canonical(policy)||events.queue.asyncRequested!==true||events.queue.callableKind!=='python-callable'||
    events.dispatch.commandGuid!==NORMAL_CLOSE_GUID||canonical(events.dispatch.arguments)!=='[]'||events.dispatch.dispatchOrdinal!==1||events.returned.dispatchCount!==1)
   return fail('NORMAL_CLOSE_RECEIPT_INVALID');
  const stages=['preflight','queue','callback','dispatch','returned'];
  if(stages.some((s,i)=>i>0&&Date.parse(events[s].utc)<Date.parse(events[stages[i-1]].utc))||Date.parse(events.queued.utc)<Date.parse(events.queue.utc))
   return fail('NORMAL_CLOSE_ORDER_INVALID');
  return {confirmed:true,legacy:false,events};
 }catch(e:any){return fail('NORMAL_CLOSE_EVIDENCE_INVALID',{reason:e.message});}
}
