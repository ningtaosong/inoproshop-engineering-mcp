// Two explicit external rounds over five fixed steps; not a product/reconnect framework.
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';import {isDeepStrictEqual as eq} from 'node:util';
import {randomUUID} from 'node:crypto';
import {sha,durable,fingerprint,waitStartupReceipt,validateStartupReceipt} from './native_idle_observer.mjs';
import {verifyInstalledFrame,sameNativeContext} from './resident_two_read_observer.mjs';
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const actions=['read','append-comment-1','read','append-comment-2','read'];
const comments=['(* 未保存连续请求：第一处注释 *)','(* 未保存连续请求：第二处注释 *)'];
export function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
export const version=x=>sha(Buffer.from(canonical(x)));
export const editVersion='resident-comment-dependencies-v1';
const nodeFields=['objectId','path','parentId','nativeTypeId','applicationId','declaration','implementation','embeddedObjectTypes'];
function guid(x){if(typeof x!=='string'||!(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x))||x==='00000000-0000-0000-0000-000000000000')throw Error('Invalid native dependency identity');return x;}
export function editingView(s){
 const nodes=s.nodes,aid=guid(s.applicationId),target=guid(s.targetId),h=s.projectHandle;
 if(!nodes||!nodes[aid]||!nodes[target]||!Number.isInteger(h)||h<0||!s.openedProjects||Array.isArray(s.openedProjects))throw Error('Dependency observations missing');
 const rows=Object.entries(s.openedProjects),owned=s.openedProjects[String(h)];
 for(const [key,row] of rows)if(!row||!Number.isInteger(row.handle)||row.handle<0||key!==String(row.handle)||typeof row.path!=='string'||typeof row.primary!=='boolean'||typeof row.library!=='boolean'||(row.handle!==h&&(row.primary||!row.library)))throw Error('Invalid public project classification');
 if(!owned||!owned.primary||owned.library||owned.path.toLowerCase()!==s.projectPath.toLowerCase())throw Error('Owned primary differs');
 const selected=new Set([aid,target]);
 for(const [oid,row] of Object.entries(nodes)){
  if(!row||!nodeFields.every(k=>Object.hasOwn(row,k))||guid(row.objectId)!==oid)throw Error('Incomplete node');guid(row.nativeTypeId);
  if(row.parentId!==null){guid(row.parentId);if(!nodes[row.parentId])throw Error('Object parent missing');}
  if(row.applicationId!==null&&row.applicationId!==aid)throw Error('Unexpected Application');
  if(!Array.isArray(row.path)||!row.path.length||row.path.some(x=>typeof x!=='string'||!x)||['declaration','implementation'].some(k=>row[k]!==null&&typeof row[k]!=='string')||!Array.isArray(row.embeddedObjectTypes))throw Error('Incomplete source/path');
  row.embeddedObjectTypes.forEach(guid);
  if(row.applicationId!==null||row.declaration!==null||row.implementation!==null||row.embeddedObjectTypes.length||Object.keys(row).some(k=>!nodeFields.includes(k))||row.nativeTypeId==='6f9dac99-8de1-4efc-8465-68ac443b7d08')selected.add(oid);
 }
 for(const start of Object.keys(nodes)){const seen=new Set();let id=start;while(id!==null){if(seen.has(id)||!nodes[id])throw Error('Dependency ancestry incomplete/cyclic');seen.add(id);id=nodes[id].parentId;}if(selected.has(start))for(const id of seen)selected.add(id);}
 const state=structuredClone(s);delete state.openedProjects;state.nodes=Object.fromEntries([...selected].map(id=>[id,structuredClone(nodes[id])]));return {versionKind:editVersion,state};
}
export const memoryVersion=s=>version(editingView(s));
export const roundSteps=[[1,2,3],[4,5]];
export function roundWaiting(i,round,identity,previous,prior,readyId=randomUUID()){
 if(!Number.isInteger(round)||round<1||round>2)throw Error('Only two explicit rounds');guid(readyId);
 if(round===1&&(previous!==null||prior!==null))throw Error('Unexpected previous round');
 if(round===2&&(!previous||previous.status!=='round-completed'||previous.round!==1||previous.launchId!==i.launchId||previous.projectPath!==i.projectPath||!eq(previous.processIdentity,identity)||!eq(previous.completedSequences,roundSteps[0])||previous.saved!==false||previous.closed!==false||previous.modifications!==1||!prior||previous.lastStepResultHash!==version(prior)))throw Error('First round completion missing or changed');
 return {schemaVersion:1,status:'awaiting-explicit-round',launchId:i.launchId,round,readyId,projectPath:i.projectPath,processIdentity:identity,previousRoundHash:previous?version(previous):null,previousStepResultHash:prior?version(prior):null,nextSequence:roundSteps[round-1][0]};
}
export function roundSubmission(waiting){return {schemaVersion:1,launchId:waiting.launchId,round:waiting.round,projectPath:waiting.projectPath,processIdentity:waiting.processIdentity,waitingHash:version(waiting),previousRoundHash:waiting.previousRoundHash};}
export function validateRoundSubmission(ticket,waiting){if(!eq(ticket,roundSubmission(waiting)))throw Error('Explicit round submission differs');return ticket;}
export async function runExplicitRounds(i,identity,io){
 let prior=null,previous=null;
 for(let round=1;round<=2;round++){
  const waiting=roundWaiting(i,round,identity,previous,prior);
  await io.publish(`awaiting-round-${round}.json`,waiting);
  // No request timer and no engineering read during user idle. Only a ticket advances.
  const ticket=validateRoundSubmission(await io.waitSubmission(round,waiting),waiting);
  for(const sequence of roundSteps[round-1])prior=await io.perform(sequence,prior,ticket);
  const result={schemaVersion:1,status:'round-completed',launchId:i.launchId,round,projectPath:i.projectPath,processIdentity:identity,submissionHash:version(ticket),completedSequences:roundSteps[round-1],lastStepResultHash:version(prior),memoryVersion:prior.memoryVersion,observationHash:prior.observationHash,modifications:prior.changes,saved:false,closed:false,ideRetained:true,nextRound:round===1?2:null};
  await io.publish(`round-${round}-result.json`,result);previous=result;
 }
 return prior;
}
export function makeRequest(i,n,prior){if(n<1||n>5)throw Error('Fixed sequence');return {schemaVersion:1,sequence:n,requestId:i.requestIds[n-1],operationId:i.operationIds[n-1],launchId:i.launchId,projectPath:i.projectPath,command:actions[n-1],expectedVersion:prior?.memoryVersion??null,previousResultHash:prior?version(prior):null};}
export function verifyResult(v,req,prior,identity,i){
 if(v.status!=='memory-verified'||!eq(v.request,req)||!eq(v.processIdentity,identity)||v.diskHash!==i.diskHash||v.saved!==false||v.reopened!==false||v.saveCalls!==0||v.closeCalls!==0||v.exitCalls!==0)throw Error('Request or lifecycle evidence differs');
 if(!v.state||v.versionKind!==editVersion||v.observationHash!==version(v.state)||v.memoryVersion!==memoryVersion(v.state)||v.state.projectPath!==i.projectPath||!Number.isInteger(v.state.projectHandle)||v.state.projectHandle<0)throw Error('Native project identity/version missing');
 const n=req.sequence,edit=n===2||n===4;
 if(v.changes!==Math.floor(n/2)||v.nativeAttempts.open!==(n===1?1:0)||v.nativeAttempts.replace!==(edit?1:0)||v.nativeAttempts.read!==(edit?3:2))throw Error('Native attempt counts differ');
 if(prior){const wanted=structuredClone(prior.state);if(edit){const t=wanted.nodes[wanted.targetId],old=t.implementation,nl=old.includes('\r\n')?'\r\n':'\n';t.implementation=old+nl+comments[n/2-1]+nl;}if(!eq(editingView(wanted),editingView(v.state)))throw Error('Memory preservation differs');}
 return v;
}
function ps(code){return JSON.parse(execFileSync(PS,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true,timeout:10000}).replace(/^\uFEFF/,''));}
export function processState(pid){return ps(`$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue;if($p){@{state='running';pid=$p.Id;startId=$p.StartTime.ToUniversalTime().Ticks.ToString();path=$p.Path}|ConvertTo-Json -Compress}else{@{state='not-found';pid=${Number(pid)}}|ConvertTo-Json -Compress}`);}
function occupied(){return ps(`$rows=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(InoProShop|CODESYS|DeepSeek Harness|dsh)(\\.exe)?$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match '(dist[\\/]server\\.js|cordis|deepseek-harness)')}|ForEach-Object {@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o')}});ConvertTo-Json -InputObject $rows -Compress`);}
export async function launch(intentFile){
 const i=JSON.parse(fs.readFileSync(intentFile,'utf8')),root=i.directory,binding=Object.fromEntries(['operationId','requestId','launchId','requestFingerprint','scriptSha256'].map(k=>[k,i[k]]));
 let child=null,closed=false,locker=null,store=null,keep=null,first=null,exit=null,ordinal=0,phase='startup';
 const emergency=fs.openSync(path.join(root,'parent-emergency.log'),'wx');
 const stop=reason=>{try{durable(path.join(root,'observer-stop.json'),{binding,reason,at:new Date().toISOString()});}catch(e){if(e.code!=='EEXIST')fs.writeSync(emergency,String(e)+'\n');}};
 function record(stage,fields={}){try{durable(path.join(root,`parent-${String(++ordinal).padStart(4,'0')}-${stage}.json`),{utc:new Date().toISOString(),binding,stage,...fields});}catch(e){if(!first)first={stage:'record',message:e.message,stack:e.stack};fs.writeSync(emergency,JSON.stringify({first,stage,error:e.message})+'\n');fs.fsyncSync(emergency);stop('record-failure');}}
 function failure(stage,e){if(!first)first={stage,message:e.message,stack:e.stack};stop(stage);record('first-failure',{first,current:{stage,message:e.message}});}
 async function release(){if(locker){locker.stdin.end('\n');locker=null;}if(store){await store.release();record('leases-released');store=null;}if(keep){clearInterval(keep);keep=null;}}
 function preserve(e){failure('observer-runtime',e instanceof Error?e:Error(String(e)));if(child&&!closed&&!keep)keep=setInterval(()=>{},60000);}
 process.on('uncaughtException',preserve);process.on('unhandledRejection',preserve);process.on('exit',code=>record('observer-runtime-exit',{code,note:'runtime event, not independent exit receipt'}));
 async function waitFile(name,max){const limit=Date.now()+max;while(Date.now()<limit){if(first||exit)throw Error('Observer/process stopped');if(fs.readdirSync(root).some(n=>/^native-\d+-first-error\.json$/.test(n)))throw Error('Native first failure');if(fs.existsSync(path.join(root,name)))return fs.readFileSync(path.join(root,name));await sleep(100);}throw Error('Bounded wait expired: '+name);}
 try{
  if(i.scope!=='one-owned-project-two-explicit-rounds'||i.dataDir!=='D:\\InoPro\\.local\\dsh-phase4-repair-20261028-A1'||Object.hasOwn(i,'totalMs')||i.idleMs!==null||i.requestMs!==60000||i.readyMs!==45000||i.lateMs!==15000)throw Error('Reviewed scope/deadlines differ');
  if([1,2].some(n=>fs.existsSync(path.join(root,`round-${n}.json`))))throw Error('No prequeued business rounds before startup');
  if(i.requestIds.length!==5||new Set(i.requestIds).size!==5||i.operationIds.length!==5||new Set(i.operationIds).size!==5)throw Error('Five unique identities required');
  const expected={intentPath:path.resolve(intentFile),intentSha256:sha(fs.readFileSync(intentFile)),observerPath:path.resolve(process.argv[1]),observerSha256:sha(fs.readFileSync(process.argv[1])),nodePath:process.execPath,nodeSha256:sha(fs.readFileSync(process.execPath)),launcherPath:i.launcherPath,launcherSha256:i.launcherSha256,pid:process.pid};
  const receipt=await waitStartupReceipt(i.startupReceipt,expected),self=processState(process.pid);validateStartupReceipt(receipt,{...expected,startId:self.startId});record('observer-identity',{self,receipt});
  for(const row of i.fixedFiles)if(sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Fixed dependency changed: '+row.path);
  if(!eq(fingerprint(i.protectedFiles),i.protectedFiles))throw Error('Protected evidence changed');
  const services=occupied();record('occupancy',{services});if(services.length)throw Error('Existing service/IDE, no takeover');
  const {Store}=await import(pathToFileURL(path.join(i.fixedProduct,'dist/storage.js')).href);
  const {assessPending,related,targetFiles}=await import(pathToFileURL(path.join(i.fixedProduct,'dist/pending-impact.js')).href);
  const {fileIdentity,assertNotIsolated}=await import(pathToFileURL(path.join(i.fixedProduct,'dist/isolation.js')).href);
  store=new Store(i.dataDir);
  async function formalGate(){
   await assertNotIsolated(store,undefined,[i.projectPath]);const p=await assessPending(store),r=related(p.impacts,undefined,await targetFiles([i.projectPath]));
   if(p.globalFrozen||r.length)throw Error('Formal pending scope blocks target');
   const f=await fileIdentity(i.projectPath),native={path:f.path,realPath:f.realPath,fileId:f.fileId,sha256:f.sha256};
   if(!eq(native,i.fileIdentity))throw Error('Current project file identity/version changed');
   if(!eq(fingerprint(i.protectedFiles),i.protectedFiles))throw Error('History changed');
   return {globalFrozen:p.globalFrozen,related:r,impacts:p.impacts,isolationCount:p.isolation.own.length};
  }
  record('formal-preflight',await formalGate());
  const leasePath=path.join(i.dataDir,'service.lock'),oldLease=fs.existsSync(leasePath)?fs.readFileSync(leasePath):null;
  await store.acquire(i.projectPath);record('formal-lease-acquired',{serviceLock:leasePath,serviceSha256:sha(fs.readFileSync(leasePath)),sourceLock:store.sourceLock(i.projectPath)});
  if(oldLease){const archived=fs.readdirSync(i.dataDir).filter(n=>n.startsWith('service.lock.stale.')).filter(n=>sha(fs.readFileSync(path.join(i.dataDir,n)))===sha(oldLease));if(!archived.length)throw Error('Original stale lease archive unavailable');record('original-lease-preserved',{sha256:sha(oldLease),archives:archived});}
  const guardFiles=fingerprint([...i.protectedFiles,{path:leasePath},{path:store.sourceLock(i.projectPath)}]);
  locker=spawn(PS,['-NoProfile','-NonInteractive','-File',i.readLockScript],{windowsHide:true,stdio:['pipe','pipe','pipe']});locker.on('error',preserve);locker.on('exit',(code,signal)=>{record('readonly-handles-exit',{code,signal});if(child&&!closed)preserve(Error('History guard handle ended'));});
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Read lock readiness expired')),10000);locker.stdout.on('data',b=>{text+=b;if(text.includes('{"ready":true}')){clearTimeout(timer);resolve();}});locker.once('exit',()=>{clearTimeout(timer);reject(Error('Read lock helper exited'));});locker.stdin.write(JSON.stringify(i.readLockFiles)+'\n');});
  await formalGate();if(occupied().length||first)throw Error('Occupancy/evidence changed before launch');
  durable(path.join(root,'single-launch-reservation.json'),{binding,utc:new Date().toISOString()});
  durable(path.join(root,'native-admission.json'),{launchId:i.launchId,scriptSha256:i.scriptSha256,deadlineUtc:new Date(Date.now()+i.readyMs).toISOString()});
  const out=fs.openSync(path.join(root,'ide.stdout.log'),'wx'),err=fs.openSync(path.join(root,'ide.stderr.log'),'wx');
  child=spawn(i.exe,i.argv,{cwd:i.cwd,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore',out,err],env:{...process.env,INOPRO_RESIDENT_INTENT:intentFile}});fs.closeSync(out);fs.closeSync(err);keep=setInterval(()=>{},60000);
  child.on('error',preserve);child.on('exit',(code,signal)=>{exit={code,signal};record('process-exit',{...exit,phase});});child.on('close',(code,signal)=>{closed=true;record('process-close',{code,signal});release().catch(preserve);});
  const start=processState(child.pid);record('process-start',{start,exe:i.exe,argv:i.argv,cwd:i.cwd});if(start.state!=='running'||start.path!==i.exe)throw Error('Native process identity unavailable');
  const identity={pid:start.pid,startId:start.startId};const ready=JSON.parse(await waitFile('ready.json',i.readyMs));
  if(Object.entries({...binding,...identity}).some(([k,v])=>ready.binding?.[k]!==v)||ready.state?.startupFramesPresent!==false)throw Error('Ready proof differs');verifyInstalledFrame(ready.state,i.frameIdentity);record('ready-observed',{ready});
  const prior=await runExplicitRounds(i,identity,{
   publish:async(name,value)=>{if(first||exit||closed)throw Error('Owner/evidence unavailable before round publication');durable(path.join(root,name),value);record(name.startsWith('awaiting')?'awaiting-explicit-round':'round-completed',{round:value.round,receipt:name});},
   waitSubmission:async(round)=>{
    phase='idle';const file=path.join(root,`round-${round}.json`);
    while(!fs.existsSync(file)){
     if(first||exit||closed||fs.existsSync(path.join(root,'observer-stop.json')))throw Object.assign(Error('Owner unavailable while idle; prior round results retained'),{code:'IDLE_STOPPED'});
     if(fs.readdirSync(root).some(n=>/^native-\d+-first-error\.json$/.test(n)))throw Error('Native first failure while idle');
     if(round===1&&fs.existsSync(path.join(root,'round-2.json')))throw Error('Second round submitted before first completion');
     await sleep(100);
    }
    if(fs.statSync(file).size>16384)throw Error('Round submission exceeds fixed bound');
    return JSON.parse(fs.readFileSync(file,'utf8'));
   },
   perform:async(n,previous,ticket)=>{
   phase='request-'+n;if(first||exit)throw Error('Stopped before next request');
   const current=processState(child.pid);if(current.startId!==start.startId||current.path!==start.path)throw Error('Owned IDE creation identity changed');
   await store.acquire(i.projectPath);const gate=await formalGate();
   if(!eq(fingerprint(guardFiles),guardFiles))throw Error('Current admission files changed');
   durable(path.join(root,`gate-${n}.json`),{...gate,launchId:i.launchId,sequence:n,round:ticket.round,roundSubmissionHash:version(ticket),projectPath:i.projectPath,processIdentity:identity,protectedFiles:guardFiles,deadlineUtc:new Date(Date.now()+i.requestMs).toISOString()});
   const req=makeRequest(i,n,previous);durable(path.join(root,`request-${n}.json`),req);record('request-sent',{sequence:n,request:req,round:ticket.round});
   const bytes=await waitFile(`result-${n}.json`,i.requestMs),value=verifyResult(JSON.parse(bytes),req,previous,identity,i);
   const native=JSON.parse(await waitFile(`native-step-${n}-completed.json`,5000));
   if(native.sequence!==n||native.resultHash!==version(value)||Object.entries({...binding,...identity}).some(([k,v])=>native.binding?.[k]!==v))throw Error('Native step completion evidence missing or changed');
   const alive=processState(child.pid);if(alive.startId!==start.startId||alive.path!==start.path)throw Error('Same IDE no longer alive');
   await formalGate();record('result-accepted',{sequence:n,resultSha256:sha(bytes),memoryVersion:value.memoryVersion,nativeAttempts:value.nativeAttempts,alive});if(first)throw Error('Evidence failed');return value;
   }
  });
  phase='completed-retained';
  let done=null;const until=Date.now()+5000;
  while(!done&&Date.now()<until){const names=fs.readdirSync(root);if(names.some(n=>/^native-\d+-first-error\.json$/.test(n)))throw Error('Native record failure');const n=names.find(n=>/^native-\d+-receiver-stopped\.json$/.test(n));if(n)done=JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));else await sleep(100);}
  if(!done||done.completed!==5||done.firstError!==null||done.sessionError!==null||done.ideExitRequested!==false||fs.readFileSync(path.join(root,'ide.stderr.log'),'utf8').includes('ERROR'))throw Error('Final receiver proof incomplete');
  await formalGate();record('protected-after',{files:fingerprint(i.protectedFiles)});
  durable(path.join(root,'resident-result.json'),{status:'five-request-memory-verified',binding,start,requests:5,openCalls:1,replaceCalls:2,saveCalls:0,compileCalls:0,closeCalls:0,exitCalls:0,mainDiskHash:i.diskHash,lastMemoryVersion:prior.memoryVersion,projectHandle:prior.state.projectHandle,ideRetained:true,projectRetained:true,unsaved:true});record('observation-completed',{resultSha256:sha(fs.readFileSync(path.join(root,'resident-result.json')))});
 }catch(e){if(e.code==='IDLE_STOPPED'){stop('idle-owner-unavailable');record('idle-owner-unavailable',{exit,note:'No pending request; completed round files are not reclassified'});}else failure(child?'observation':'preflight',e);if(child&&!closed){await sleep(i.lateMs??15000);record('late-window-ended',{first,exit,resultFiles:[1,2,3,4,5].filter(n=>fs.existsSync(path.join(root,`result-${n}.json`))),idePreserved:true});}else await release().catch(preserve);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await launch(process.argv[2]);
