// Probe infrastructure only. Never dispatches, kills, releases leases or upgrades
// a timeout. Child exit and result publication are independent evidence.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function closeProbeHandles(handles,primary=null,fallback=s=>process.stderr.write(s+'\n')) {
  const errors=(await Promise.allSettled(handles.map(h=>h.close()))).filter(x=>x.status==='rejected').map(x=>x.reason);
  if(errors.length){
    try{fallback(JSON.stringify({kind:'probe-cleanup-failure',primaryException:primary?{name:primary.name,message:primary.message,stack:primary.stack}:null,
      cleanupExceptions:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))}));}catch{}
    if(!primary)throw errors[0];
  }
}

export async function readResult(file) {
  try {const bytes=await readFile(file);return {exists:true,sha256:createHash('sha256').update(bytes).digest('hex'),value:JSON.parse(bytes.toString('utf8'))};}
  catch(error){if(error.code==='ENOENT')return {exists:false};return {exists:true,error:{name:error.name,message:error.message}};}
}

export async function observeProbe(child,{binding,birth,publish,resultFile,businessMs=240000,graceMs=60000,pollMs=200,
  read=()=>readResult(resultFile),sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),fallback=s=>process.stderr.write(s+'\n')}) {
  let exit=null,spawnError=null,timedOut=false,lastResult=null,primary=null;
  const loggerErrors=[];const begin=now();let sequence=0,observationDeadline=begin+businessMs+graceMs;
  const noteError=error=>({name:error.name,message:error.message,stack:error.stack});
  const safe=async(name,value)=>{
    try {await publish(name,{...value,binding,utc:new Date().toISOString()});}
    catch(error){const entry=noteError(error);loggerErrors.push(entry);primary??=entry;
      try{fallback(JSON.stringify({kind:'probe-recorder-failure',primaryException:primary,loggerException:entry,binding}));}catch{}
    }
  };
  child.once('exit',(code,signal)=>{exit={code,signal,observedAt:now(),event:'child-process-exit'};});
  child.once('error',error=>{spawnError=noteError(error);primary??=spawnError;});
  // Observe start before waiting. A missing/mismatched creation identity cannot
  // be repaired by a later result file or a process-name lookup.
  let observedBirth;
  try {observedBirth=await birth;}catch(error){primary??=noteError(error);observedBirth={state:'unconfirmed',error:primary};}
  await safe('process-start',{pid:child.pid,birth:observedBirth,resultFile});
  let resultReceipt=null,exitReceipt=false;
  while(true){
    const elapsed=now()-begin;
    if(!timedOut&&elapsed>=businessMs&&(!exit||exit.observedAt-begin>=businessMs)&&!spawnError){
      timedOut=true;primary??={name:'BusinessTimeout',message:'Business deadline reached; no further dispatch permitted'};
      await safe('business-timeout',{status:'unknown',pid:child.pid,deadlineMs:businessMs,graceMs,primaryException:primary});
    }
    let result;
    try {result=await read();}catch(error){primary??=noteError(error);result={exists:false,error:noteError(error)};}
    const signature=JSON.stringify(result);
    if(result.exists&&signature!==lastResult){
      lastResult=signature;resultReceipt=result;
      await safe('result-observed-'+String(++sequence).padStart(3,'0'),{late:timedOut,result});
    }
    if(exit&&!exitReceipt){exitReceipt=true;await safe('process-exit',{pid:child.pid,...exit,late:timedOut});}
    if(spawnError){await safe('spawn-error',{error:spawnError});break;}
    if(exit&&result.exists)break;
    if(exit&&!timedOut)break; // exited without result: unknown, no replay
    if(timedOut&&now()>=observationDeadline){
      await safe('exit-observation-expired',{pid:child.pid,exitObserved:!!exit,resultObserved:!!resultReceipt,graceMs});
      break;
    }
    if(loggerErrors.length&&!timedOut){
      timedOut=true;
      observationDeadline=now()+graceMs;
      await safe('evidence-recording-stopped',{status:'unknown',primaryException:primary,graceMs});
      // Recording failed; still observe read-only, never continue dispatch.
    }
    await sleep(pollMs);
  }
  const rb=resultReceipt?.value?.traceBinding;
  const identityMatches=observedBirth?.state==='running'&&observedBirth.identity?.pid===child.pid&&
    rb?.pid===child.pid&&rb?.creationUtcTicks===observedBirth.identity.startId&&
    rb?.operationId===binding.operationId&&rb?.launchId===binding.launchId&&rb?.scriptSha256===binding.scriptSha256;
  const normalExit=exit?.code===0&&exit?.signal===null;
  const status=!primary&&!timedOut&&!spawnError&&!loggerErrors.length&&identityMatches&&normalExit&&resultReceipt?.value?.status==='succeeded'?'succeeded':'unknown';
  const outcome={status,timedOut,exit,birth:observedBirth,identityMatches,normalExit,result:resultReceipt,
    primaryException:primary,loggerErrors,noReplay:true};
  await safe('observation-complete',outcome);
  if(loggerErrors.length)outcome.status='unknown';
  if(!exit)child.unref();
  return outcome;
}
