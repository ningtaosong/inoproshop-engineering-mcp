// Offline test orchestration only. Does not change production response or timeout rules.
import {performance} from 'node:perf_hooks';
import {stateSchema} from '../dist/contracts.js';

export async function waitForOperation(call,initial,{timeoutMs=60_000,intervalMs=100,observe=()=>{}}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(intervalMs)||intervalMs<0)throw new TypeError('Invalid test observation budget');
 const started=performance.now();let current=initial;
 observe({phase:'initial',elapsedMs:0,reply:current});
 if(!stateSchema.safeParse(current?.status).success)throw new Error('Invalid initial test operation status');
 if(current?.status!=='running')return current;
 const operationId=current.operationId,requestId=current.requestId;
 if(typeof operationId!=='string'||!operationId)throw new Error('Running test reply lacks original operationId');
 const timeout=()=>Object.assign(new Error('Bounded observation of original test operation expired'),{code:'TEST_OPERATION_WAIT_EXPIRED',operationId,requestId,lastReply:current});
 while(current.status==='running'){
  const remaining=timeoutMs-(performance.now()-started);if(remaining<=0)throw timeout();
  let timer;
  try{current=await Promise.race([
   Promise.resolve().then(()=>call('operation_status',{operationId})),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout()),remaining);})
  ]);}finally{clearTimeout(timer);}
  observe({phase:'poll',elapsedMs:performance.now()-started,reply:current});
  if(current?.operationId!==operationId||(requestId!==undefined&&current?.requestId!==requestId))
   throw Object.assign(new Error('Test observation returned another operation/request identity'),{operationId,requestId,actualReply:current});
  if(!stateSchema.safeParse(current.status).success)throw new Error('Invalid polled test operation status');
  if(current.status!=='running')return current;
  const delay=Math.min(intervalMs,Math.max(0,timeoutMs-(performance.now()-started)));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
 }
 return current;
}

export async function callAndWait(service,tool,args,options){
 return waitForOperation(service.call.bind(service),await service.call(tool,args),options);
}
