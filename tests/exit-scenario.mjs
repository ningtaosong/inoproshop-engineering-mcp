import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup} from './helpers.mjs';
import {IdeAdapter} from '../dist/adapter.js';
import {atomicJson,readJson,digest} from '../dist/storage.js';

// Replays the archived succeeded + 0xC000041D combination through the production adapter.
// Synthetic JSON file/process; never opens the archived engineering project.
export async function scenario({code=3221226525,signal=null,command='read',writeResult=true,dispatch=true,probe,writeEvidence,timeoutMs=1000,delay=40,onStart}={}) {
 const env=await setup(),directory=path.join(env.dir,'exit-ipc'),operationId=randomUUID();
 const request={operationId,requestId:'archive-exit-repro',requestFingerprint:'f'.repeat(64),command,projectPath:env.source,args:{}};
 const raw={contractVersion:'1.0.0',operationId,status:'succeeded',summary:'archived success / abnormal exit combination',data:{diskHash:digest(await fs.readFile(env.source)),value:'native read preserved'}};
 const identity={version:1,platform:process.platform,host:'offline-double',pid:12345,startId:'123456789'};
 let kills=0,spawns=0;let child,completion;
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs,noUI:true},()=>{
  spawns++;child=new EventEmitter();child.pid=12345;child.exitCode=null;child.kill=()=>{kills++;};
  completion=new Promise(resolve=>setTimeout(async()=>{
   if(dispatch)await atomicJson(path.join(directory,'dispatched.json'),{operationId,pid:12345});
   if(writeResult)await atomicJson(path.join(directory,'result.json'),raw);
   child.exitCode=code;child.emit('exit',code,signal);resolve();
  },delay));return child;
 },{probe:probe??(async()=>({state:'running',identity})),writeEvidence});
 let start;
 const result=await adapter.execute(request,directory,async(pid,e)=>{start=e;await onStart?.(pid,e);}).catch(e=>({status:e.status,error:{code:e.code,message:e.message}}));
 await completion;
 return {env,directory,request,raw,result,adapter,start,identity,spawns,kills};
}
