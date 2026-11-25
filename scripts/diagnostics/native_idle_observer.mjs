// Independent diagnostic only. No engineering service, lease acquisition or reconciliation.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const sha = b => createHash('sha256').update(b).digest('hex');
export function durable(file, value) {
  const fd=fs.openSync(file,'wx');
  try {fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function validateStartupReceipt(receipt,expected) {
  if(!receipt||receipt.error||receipt.launched!==true||receipt.inJob!==false||receipt.flags!=='0x09000200')throw Error('External startup independence evidence unavailable');
  for(const key of ['intentPath','intentSha256','observerPath','observerSha256','nodePath','nodeSha256','launcherPath','launcherSha256','pid'])if(receipt[key]!==expected[key])throw Error('External startup receipt binding differs: '+key);
  if(typeof receipt.startId!=='string'||!/^\d+$/.test(receipt.startId))throw Error('External process creation identity missing');
  if(expected.startId!==undefined&&receipt.startId!==expected.startId)throw Error('External process creation identity changed');
  return receipt;
}
export async function waitStartupReceipt(file,expected,waitMs=5000) {
  const limit=Date.now()+waitMs;
  while(!fs.existsSync(file)&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,20));
  return validateStartupReceipt(JSON.parse(fs.readFileSync(file,'utf8')),expected);
}
export class Observation {
  constructor(record,binding) {this.record=record;this.binding=binding;this.first=null;this.exit=null;this.close=null;this.deadline=false;this.lateDeadline=false;}
  fail(code,detail) {
    const value={code,detail};if(!this.first)this.first=value;
    this.record('observation-error',{first:this.first,current:value});
  }
  businessExpired(){this.deadline=true;this.fail('EXIT_DEADLINE','30 second observation deadline; no further dispatch');}
  lateExpired(){this.lateDeadline=true;this.record('late-observation-expired',{first:this.first,exit:this.exit,close:this.close,preserveObserver:true,preserveChild:true});}
  onExit(code,signal){this.exit={code,signal};this.record('process-exit',{...this.exit,late:this.deadline});if(code!==0||signal!==null)this.fail('ABNORMAL_EXIT',this.exit);}
  onClose(code,signal){this.close={code,signal};this.record('process-close',{...this.close,late:this.deadline});}
}
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
function ps(source) {return JSON.parse(execFileSync(PS,['-NoProfile','-NonInteractive','-Command',source],{encoding:'utf8',windowsHide:true,timeout:10000}).replace(/^\uFEFF/,''));}
function quote(s){return "'"+s.replaceAll("'","''")+"'";}
export function fingerprint(rows) {return rows.map(x=>({path:x.path,exists:fs.existsSync(x.path),sha256:fs.existsSync(x.path)?sha(fs.readFileSync(x.path)):null}));}
function processState(pid){return ps(`$ErrorActionPreference='Stop';$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($null -eq $p){@{state='exited';pid=${pid}}|ConvertTo-Json -Compress}else{@{state='running';pid=$p.Id;startId=$p.StartTime.ToUniversalTime().Ticks.ToString();path=$p.Path}|ConvertTo-Json -Compress}`);}
function occupied(){return ps(`$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(InoProShop|CODESYS|DeepSeek Harness|dsh)(\\.exe)?$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match '(server\\.js|cordis|deepseek-harness)')}|ForEach-Object {@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;creationDate=$_.CreationDate.ToUniversalTime().ToString('o')}});ConvertTo-Json -InputObject $rows -Compress`);}
export function inJob(){return ps(`$ErrorActionPreference='Stop';Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ProbeJobRead { [DllImport("kernel32.dll",SetLastError=true)]public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result); }';$p=Get-Process -Id ${process.pid};$result=$false;if(-not [ProbeJobRead]::IsProcessInJob($p.Handle,[IntPtr]::Zero,[ref]$result)){throw 'Job membership read failed'};@{inJob=$result;pid=$p.Id;startId=$p.StartTime.ToUniversalTime().Ticks.ToString()}|ConvertTo-Json -Compress`);}

export async function launch(intentFile) {
  const intent=JSON.parse(fs.readFileSync(intentFile,'utf8'));
  const root=intent.directory;let ordinal=0,child=null,readLock=null,keepAlive=null,closed=false,watch=null;
  let observerError=null,expectedStart=null,businessTimer=null,lateTimer=null;
  const binding=Object.fromEntries(['operationId','requestId','launchId','requestFingerprint','scriptSha256'].map(k=>[k,intent[k]]));
  const emergency=fs.openSync(path.join(root,'observer-emergency.log'),'wx');
  function raw(stage,fields={}) {durable(path.join(root,`parent-${String(++ordinal).padStart(4,'0')}-${stage}.json`),{utc:new Date().toISOString(),binding,stage,...fields});}
  function record(stage,fields={}) {try{raw(stage,fields);}catch(error){
    if(!observerError)observerError={stage,message:error.message,stack:error.stack};
    try{fs.writeSync(emergency,JSON.stringify({utc:new Date().toISOString(),first:observerError,current:{stage,message:error.message},fields})+'\n');fs.fsyncSync(emergency);}catch(secondary){observerError.loggingError=secondary.message;}
    try{durable(path.join(root,'observer-stop.json'),{binding,reason:'observer evidence failure',first:observerError});}catch{/* first remains sticky; no throw into host cleanup */}
  }}
  const stopAdmission=reason=>{try{durable(path.join(root,'observer-stop.json'),{binding,reason,at:new Date().toISOString()});}catch(error){if(error.code!=='EEXIST')record('stop-publication-error',{message:error.message});}};
  const state=new Observation(record,binding);
  const stopWatch=()=>{if(watch){watch.close();watch=null;}};
  const release=()=>{if(readLock){readLock.stdin.end('\n');readLock=null;}};
  // Never throw out of a post-spawn failure or terminate the child. This referenced
  // interval survives business/late deadlines; its callback reads and writes nothing.
  function preserve(error){stopAdmission('observer failure');state.fail('OBSERVER_FAILURE',{message:error.message,stack:error.stack});if(child&&!closed&&!keepAlive)keepAlive=setInterval(()=>{},60000);}
  process.on('uncaughtException',preserve);process.on('unhandledRejection',preserve);
  process.on('exit',code=>record('observer-runtime-exit',{code,note:'Node runtime callback, not an independent OS exit receipt'}));
  async function finalize() {
    clearTimeout(businessTimer);clearTimeout(lateTimer);stopWatch();
    let result=null,events=[];
    try {
      if(state.exit?.code!==0||state.exit.signal!==null||state.close?.code!==0||state.close.signal!==null)throw Error('Normal exit/close receipts incomplete');
      result=JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8'));
      events=fs.readdirSync(root).filter(n=>/^event-\d+-.+\.json$/.test(n)).sort().map(n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8')));
      if(!expectedStart||result.binding.pid!==child.pid||result.binding.startId!==expectedStart.startId||
        Object.entries(binding).some(([k,v])=>result.binding[k]!==v))throw Error('Native result/process binding differs');
      const named=n=>events.filter(e=>e.stage===n);
      for(const name of ['script-entry','modules-loaded','entry-empty','public-getter-ready','listeners-ready','script-tail','close-dispatch','close-returned','form-closed'])if(named(name).length!==1)throw Error('Incomplete/duplicate native stage: '+name);
      if(named('first-error').length||result.firstError||result.dispatchCount!==1||result.status!=='returned-observation-only')throw Error('Native failure/dispatch evidence differs');
      if(fs.readFileSync(path.join(root,'ide.stderr.log'),'utf8').includes('IDLE_'))throw Error('Native recorder reported an error');
      const dispatch=named('close-dispatch')[0];if(dispatch.noProject.primaryIsNone!==true||dispatch.noProject.openProjectCount!==0)throw Error('Dispatch empty-project check differs');
      const after=fingerprint(intent.protectedFiles);
      record('protected-after',{files:after});
      if(JSON.stringify(after)!==JSON.stringify(intent.protectedFiles))throw Error('Protected file evidence changed');
    }catch(error){state.fail('FINAL_EVIDENCE_INCOMPLETE',{message:error.message,stack:error.stack});}
    record('final-observation',{status:state.first||observerError?'unknown':'observed-normal-exit',first:state.first,observerError,exit:state.exit,close:state.close,result,normalExitOnly:state.exit?.code===0&&state.exit.signal===null,productReadinessProven:false});
    release();if(keepAlive){clearInterval(keepAlive);keepAlive=null;}
    // The read-only lock helper exits on EOF. No process termination/lease mutation.
  }
  try {
    if(intent.scope!=='one-no-project-public-idle-observation'||intent.dataDir!=='D:\\InoPro\\.local\\dsh-phase4-repair-20261028-A1')throw Error('Scope or original data directory differs');
    if(intent.businessMs!==30000||intent.graceMs!==15000)throw Error('Reviewed deadlines differ');
    if(intent.commandGuid!=='caa0ef1f-6563-49ae-b0e0-80095fb233ef')throw Error('Unexpected exit command');
    // Read the immutable external launch receipt BEFORE this Node process spawns
    // a helper. libuv may add Node to its own Job when it first spawns a process.
    const expectedReceipt={intentPath:path.resolve(intentFile),intentSha256:sha(fs.readFileSync(intentFile)),
      observerPath:path.resolve(process.argv[1]),observerSha256:sha(fs.readFileSync(process.argv[1])),
      nodePath:process.execPath,nodeSha256:sha(fs.readFileSync(process.execPath)),
      launcherPath:intent.launcherPath,launcherSha256:intent.launcherSha256,pid:process.pid};
    const receipt=await waitStartupReceipt(intent.startupReceipt,expectedReceipt);
    const self=inJob();validateStartupReceipt(receipt,{...expectedReceipt,startId:self.startId});
    record('observer-identity',{self,externalStartupReceipt:receipt,receiptSha256:sha(fs.readFileSync(intent.startupReceipt)),postHelperJobAttribution:'in-any-job only; libuv self-assignment is an installed-version source explanation, not observed Job handle attribution'});
    for(const row of intent.fixedFiles)if(sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Fixed file changed: '+row.path);
    if(JSON.stringify(fingerprint(intent.protectedFiles))!==JSON.stringify(intent.protectedFiles))throw Error('Protected inputs changed since reviewed intent');
    const services=occupied();record('process-preflight',{services,oldProcesses:intent.oldProcesses.map(x=>({expected:x,current:processState(x.pid)}))});
    if(services.length)throw Error('Active IDE/service/Desktop occupation');
    for(const old of intent.oldProcesses){const current=processState(old.pid);if(current.state==='running'&&current.startId===old.startId)throw Error('Original process instance is still running');}
    const {Store}=await import(pathToFileURL(path.join(intent.fixedProduct,'dist/storage.js')).href);
    const {assessPending}=await import(pathToFileURL(path.join(intent.fixedProduct,'dist/pending-impact.js')).href);
    const {observeLeaseOwner}=await import(pathToFileURL(path.join(intent.fixedProduct,'dist/lease-process.js')).href);
    const pending=await assessPending(new Store(intent.dataDir));
    record('engineering-protection-observed',{globalFrozen:pending.globalFrozen,impacts:pending.impacts.map(x=>({operationId:x.operationId,scope:x.scope,reason:x.reason})),isolationCount:pending.isolation.own.length,engineeringRemainsFrozen:true});
    if(pending.operations.some(op=>['running','queued','pending'].includes(op.status)))throw Error('Unfinished operation requires review');
    const lease=JSON.parse(fs.readFileSync(path.join(intent.dataDir,'service.lock'),'utf8'));
    const owner=await observeLeaseOwner(lease);record('lease-owner-observed',{owner,leaseSha256:sha(fs.readFileSync(path.join(intent.dataDir,'service.lock'))),leaseMutation:false});
    if(owner.state!=='stale')throw Error('Lease owner not confirmed ended');
    // Reuse existing read-only maintenance handle mechanism, not Store.acquire().
    // It denies concurrent write/replacement of these files and never edits a lease.
    readLock=spawn(PS,['-NoProfile','-NonInteractive','-File',intent.readLockScript],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    readLock.on('error',preserve);readLock.on('exit',(code,signal)=>{record('read-lock-exit',{code,signal});if(child&&!closed)preserve(Error('Read-only exclusion handles ended before IDE'));});
    let ready='';await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Read-lock readiness timeout')),10000);readLock.stdout.on('data',chunk=>{ready+=chunk.toString();if(ready.includes('{"ready":true}')){clearTimeout(t);resolve();}});readLock.once('error',reject);readLock.once('exit',()=>{clearTimeout(t);reject(Error('Read-lock ended before ready'));});readLock.stdin.write(JSON.stringify(intent.readLockFiles)+'\n');});
    if(occupied().length)throw Error('Competition appeared immediately before launch');
    if(JSON.stringify(fingerprint(intent.protectedFiles))!==JSON.stringify(intent.protectedFiles))throw Error('Protected inputs changed during preflight');
    record('scope-authority',{registryReadOnly:true,sourceLeaseRequested:false,engineeringRemainsFrozen:true,globalFrozenIsNotNoProjectAuthorization:true,scope:'one empty-IDE diagnostic; not engineering dispatch'});
    if(observerError)throw Error('Pre-spawn evidence publication failed');
    durable(path.join(root,'single-launch-reservation.json'),{binding,at:new Date().toISOString()});
    const stdout=fs.openSync(path.join(root,'ide.stdout.log'),'wx'),stderr=fs.openSync(path.join(root,'ide.stderr.log'),'wx');
    const dispatchDeadline=Date.now()+intent.businessMs;
    durable(path.join(root,'native-admission.json'),{binding,deadlineUtc:new Date(dispatchDeadline).toISOString()});
    child=spawn(intent.exe,intent.argv,{cwd:intent.cwd,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore',stdout,stderr],env:{...process.env,INOPRO_IDLE_INTENT:intentFile}});
    // Synchronous handlers immediately after spawn, before any await/process query.
    child.on('error',error=>{state.fail('SPAWN_ERROR',{message:error.message});});
    child.on('exit',(code,signal)=>state.onExit(code,signal));
    child.on('close',(code,signal)=>{closed=true;state.onClose(code,signal);void finalize().catch(preserve);});
    keepAlive=setInterval(()=>{},60000);
    fs.closeSync(stdout);fs.closeSync(stderr);
    record('spawn',{pid:child.pid,exe:intent.exe,argv:intent.argv,cwd:intent.cwd,listenersAttachedBeforeAwait:true});
    expectedStart=processState(child.pid);record('process-start',{pid:child.pid,process:expectedStart});
    if(expectedStart.state!=='running')state.fail('START_IDENTITY_MISSING',expectedStart);
    // File arrival observation is bounded; after 45s keep only OS exit listeners.
    watch=fs.watch(root,(_,name)=>{if(name==='result.json'&&fs.existsSync(path.join(root,name)))record('result-file-observed',{path:path.join(root,name),late:state.deadline});});
    businessTimer=setTimeout(()=>{stopAdmission('business timeout');state.businessExpired();lateTimer=setTimeout(()=>{state.lateExpired();stopWatch();},intent.graceMs);},Math.max(0,dispatchDeadline-Date.now()));
  } catch(error) {
    state.fail(child?'POST_SPAWN_FAILURE':'PREFLIGHT_STOP',{message:error.message,stack:error.stack});
    if(child&&!closed){stopAdmission('post-spawn failure');if(!keepAlive)keepAlive=setInterval(()=>{},60000);stopWatch();}
    else {release();record('not-launched',{launches:0,reason:state.first});}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await launch(process.argv[2]);
