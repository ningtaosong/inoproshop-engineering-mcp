// Fixed two-read diagnostic, not an MCP server or reconnect/daemon framework.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {sha,durable,fingerprint,waitStartupReceipt,validateStartupReceipt} from './native_idle_observer.mjs';
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function ps(code){return JSON.parse(execFileSync(PS,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true,timeout:10000}).replace(/^\uFEFF/,''));}
function processState(pid){return ps(`$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue;if($p){@{state='running';pid=$p.Id;startId=$p.StartTime.ToUniversalTime().Ticks.ToString();path=$p.Path}|ConvertTo-Json -Compress}else{@{state='not-found';pid=${Number(pid)}}|ConvertTo-Json -Compress}`);}
function occupied(){return ps(`$rows=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(InoProShop|CODESYS|DeepSeek Harness|dsh)(\\.exe)?$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match '(dist[\\/]server\\.js|cordis|deepseek-harness)')}|ForEach-Object {@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o')}});ConvertTo-Json -InputObject $rows -Compress`);}
export function request(intent,sequence,previousResultSha256){
  if(![1,2].includes(sequence)||!Array.isArray(intent.requestIds)||intent.requestIds.length!==2||new Set(intent.requestIds).size!==2)throw Error('Two unique request IDs required');
  if(sequence===1?previousResultSha256!==null:!(/^[a-f0-9]{64}$/.test(previousResultSha256)))throw Error('Previous completed result binding required');
  return {schemaVersion:1,command:'empty-project-status',sequence,requestId:intent.requestIds[sequence-1],launchId:intent.launchId,scriptSha256:intent.scriptSha256,previousResultSha256};
}
export function verifyResponse(value,req,start,binding,requestSha256){
  if(!value||value.status!=='read-returned'||value.message!=='已只读确认当前无工程；未关闭IDE'||value.engineeringCalls!==0||value.closeCalls!==0||value.exitCalls!==0)throw Error('Native response incomplete');
  for(const [key,expected] of Object.entries({...binding,pid:start.pid,startId:start.startId}))if(value.binding?.[key]!==expected)throw Error('Native process/request binding differs: '+key);
  if(Object.keys(value.request??{}).length!==Object.keys(req).length||Object.entries(req).some(([key,expected])=>value.request[key]!==expected)||value.requestSha256!==requestSha256)throw Error('Returned request differs');
  const s=value.state;
  if(s?.noProject?.primaryIsNone!==true||s.noProject.openProjectCount!==0||s.noProject.uiPresent!==true||s.startupFramesPresent!==false||s.mainEnabled!==true||!Number.isInteger(s.thread)||!/^\d+$/.test(s.mainHandle)||!s.frameIdentity||!Array.isArray(s.forms)||!Array.isArray(s.stack)||!s.stack.length)throw Error('Native empty primary-thread evidence incomplete');
  const blocked=new Set(['ScriptEngine.plugin|_3S.CoDeSys.ScriptEngine.ScriptExecutor|Execute','ScriptEngine.plugin|_3S.CoDeSys.ScriptEngine.ScriptEngine|OnApplicationReady','Frame.plugin|_3S.CoDeSys.Frame.MainForm|OnLoad']);
  if(s.stack.some(f=>!f.assembly||!f.method||blocked.has([f.assembly,f.type,f.method].join('|')))||s.forms.some(f=>f.visible&&f.modal))throw Error('Startup or modal evidence contradicts response');
  return s;
}
export function sameNativeContext(a,b){
  if(a.thread!==b.thread||a.mainHandle!==b.mainHandle||!isDeepStrictEqual(a.frameIdentity,b.frameIdentity))throw Error('Native context identity differs');
}
export function verifyInstalledFrame(state,expected,readBytes=fs.readFileSync){
  const actual=state?.frameIdentity,proof=state?.frameFileEvidence;
  const full=value=>{if(typeof value!=='string'||!path.win32.isAbsolute(value))throw Error('Frame path is not absolute');return path.win32.normalize(value).toLowerCase();};
  if(!actual||!proof||!expected||!/^[a-f0-9]{64}$/.test(expected.sha256))throw Error('Frame evidence incomplete');
  if(full(actual.path)!==full(expected.path)||actual.mvid!==expected.mvid||actual.type!==expected.type)throw Error('Installed frame identity differs');
  if(proof.actualPath!==actual.path||proof.expectedPath!==expected.path||full(proof.actualFullPath)!==full(actual.path)||full(proof.expectedFullPath)!==full(expected.path)||proof.pathOrdinalIgnoreCaseEqual!==true)throw Error('Frame path evidence differs');
  for(const field of ['actualSha256','installedSha256','expectedSha256'])if(proof[field]!==expected.sha256)throw Error('Frame file evidence differs: '+field);
  if(sha(readBytes(actual.path))!==expected.sha256||sha(readBytes(expected.path))!==expected.sha256)throw Error('Installed frame bytes changed');
}
export function verifyAcceptedResponse(value,req,start,binding,requestSha256,readyState,firstState,frame){
  const state=verifyResponse(value,req,start,binding,requestSha256);
  verifyInstalledFrame(state,frame);
  sameNativeContext(readyState,state);
  if(firstState)sameNativeContext(firstState,state);
  return state;
}
export async function exchangeTwo(intent,io){
  let priorHash=null;
  for(const sequence of [1,2]){
    await io.ensure();
    const req=request(intent,sequence,priorHash);
    await io.send(req);
    const bytes=await io.read(sequence);
    await io.accept(req,bytes); // includes result validation and same live creation identity
    priorHash=sha(bytes);
  }
}

export async function launch(intentFile){
  const intent=JSON.parse(fs.readFileSync(intentFile,'utf8')),root=intent.directory;
  const binding=Object.fromEntries(['operationId','requestId','launchId','requestFingerprint','scriptSha256'].map(k=>[k,intent[k]]));
  let ordinal=0,first=null,child=null,locker=null,closed=false,keepAlive=null,osExit=null,deadline=0;
  const emergency=fs.openSync(path.join(root,'parent-emergency.log'),'wx');
  function record(stage,fields={}){
    try{durable(path.join(root,`parent-${String(++ordinal).padStart(4,'0')}-${stage}.json`),{utc:new Date().toISOString(),binding,stage,...fields});}
    catch(error){if(!first)first={stage:'record',message:error.message,stack:error.stack};try{fs.writeSync(emergency,JSON.stringify({first,stage,fields,error:error.message})+'\n');fs.fsyncSync(emergency);}catch(secondary){first.loggingError=secondary.message;}stop('record failure');}
  }
  function stop(reason){try{durable(path.join(root,'observer-stop.json'),{binding,reason,at:new Date().toISOString()});}catch(error){if(error.code!=='EEXIST'){if(!first)first={stage:'stop-publication',message:error.message};}}}
  function failure(stage,error){if(!first)first={stage,message:error.message,stack:error.stack};stop(stage);record('first-failure',{first,current:{stage,message:error.message}});}
  function release(){if(locker){locker.stdin.end('\n');locker=null;}}
  function preserve(error){failure('observer-runtime',error instanceof Error?error:Error(String(error)));if(child&&!closed&&!keepAlive)keepAlive=setInterval(()=>{},60000);}
  process.on('uncaughtException',preserve);process.on('unhandledRejection',preserve);
  process.on('exit',code=>record('observer-runtime-exit',{code,note:'Runtime callback only, not independent OS receipt'}));
  async function waitFile(name,maxMs){
    const limit=Math.min(deadline,Date.now()+maxMs);
    while(Date.now()<limit){
      if(first)throw Error('Observer already stopped');
      if(osExit)throw Error('IDE exited during two-read observation');
      if(fs.readdirSync(root).some(n=>/^native-\d+-first-error\.json$/.test(n)))throw Error('Native first-error published');
      if(fs.existsSync(path.join(root,name)))return fs.readFileSync(path.join(root,name));
      await sleep(100);
    }
    throw Error('Bounded observation expired: '+name);
  }
  try{
    if(intent.scope!=='one-owned-ide-two-empty-status-reads'||intent.dataDir!=='D:\\InoPro\\.local\\dsh-phase4-repair-20261028-A1'||intent.totalMs!==60000||intent.readyMs!==30000||intent.requestMs!==15000||intent.lateMs!==15000)throw Error('Reviewed scope/deadlines differ');
    request(intent,1,null);
    const expected={intentPath:path.resolve(intentFile),intentSha256:sha(fs.readFileSync(intentFile)),observerPath:path.resolve(process.argv[1]),observerSha256:sha(fs.readFileSync(process.argv[1])),nodePath:process.execPath,nodeSha256:sha(fs.readFileSync(process.execPath)),launcherPath:intent.launcherPath,launcherSha256:intent.launcherSha256,pid:process.pid};
    const receipt=await waitStartupReceipt(intent.startupReceipt,expected);
    const self=processState(process.pid);validateStartupReceipt(receipt,{...expected,startId:self.startId});
    record('observer-identity',{self,externalStartupReceipt:receipt});
    for(const row of intent.fixedFiles)if(sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Fixed dependency changed: '+row.path);
    if(JSON.stringify(fingerprint(intent.protectedFiles))!==JSON.stringify(intent.protectedFiles))throw Error('Protected material changed since reviewed intent');
    const services=occupied();record('occupancy',{services});if(services.length)throw Error('Existing IDE/service/Desktop; no takeover');
    const {Store}=await import(pathToFileURL(path.join(intent.fixedProduct,'dist/storage.js')).href);
    const {assessPending}=await import(pathToFileURL(path.join(intent.fixedProduct,'dist/pending-impact.js')).href);
    const {observeLeaseOwner}=await import(pathToFileURL(path.join(intent.fixedProduct,'dist/lease-process.js')).href);
    const pending=await assessPending(new Store(intent.dataDir));
    record('protection-readonly',{globalFrozen:pending.globalFrozen,impacts:pending.impacts.map(x=>({operationId:x.operationId,scope:x.scope,reason:x.reason})),isolationCount:pending.isolation.own.length,engineeringDispatch:false});
    if(pending.operations.some(op=>['running','queued','pending'].includes(op.status)))throw Error('Active operation requires separate handling');
    const lease=JSON.parse(fs.readFileSync(path.join(intent.dataDir,'service.lock'),'utf8'));
    const owner=await observeLeaseOwner(lease);record('lease-observed',{owner,mutated:false});if(owner.state!=='stale')throw Error('Lease owner not confirmed ended');
    locker=spawn(PS,['-NoProfile','-NonInteractive','-File',intent.readLockScript],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    locker.on('error',preserve);locker.on('exit',(code,signal)=>{record('readonly-handles-exit',{code,signal});if(child&&!closed)preserve(Error('Readonly exclusion ended while IDE remains'));});
    await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Readonly handle readiness expired')),10000);locker.stdout.on('data',chunk=>{text+=chunk.toString();if(text.includes('{"ready":true}')){clearTimeout(timer);resolve();}});locker.once('error',reject);locker.once('exit',()=>{clearTimeout(timer);reject(Error('Readonly helper ended'));});locker.stdin.write(JSON.stringify(intent.readLockFiles)+'\n');});
    if(occupied().length||JSON.stringify(fingerprint(intent.protectedFiles))!==JSON.stringify(intent.protectedFiles))throw Error('Pre-launch evidence or occupancy changed');
    if(first)throw Error('Pre-launch evidence recording failed');
    durable(path.join(root,'single-launch-reservation.json'),{binding,utc:new Date().toISOString()});
    deadline=Date.now()+intent.totalMs;
    durable(path.join(root,'native-admission.json'),{launchId:intent.launchId,scriptSha256:intent.scriptSha256,deadlineUtc:new Date(deadline).toISOString()});
    const out=fs.openSync(path.join(root,'ide.stdout.log'),'wx'),err=fs.openSync(path.join(root,'ide.stderr.log'),'wx');
    child=spawn(intent.exe,intent.argv,{cwd:intent.cwd,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore',out,err],env:{...process.env,INOPRO_TWO_READ_INTENT:intentFile}});
    child.on('error',preserve);
    child.on('exit',(code,signal)=>{osExit={code,signal,at:new Date().toISOString()};record('process-exit',osExit);});
    child.on('close',(code,signal)=>{closed=true;record('process-close',{code,signal});release();if(keepAlive){clearInterval(keepAlive);keepAlive=null;}});
    keepAlive=setInterval(()=>{},60000);fs.closeSync(out);fs.closeSync(err);
    const start=processState(child.pid);record('process-start',{start,exe:intent.exe,argv:intent.argv,cwd:intent.cwd});
    if(start.state!=='running'||start.path!==intent.exe)throw Error('Native creation identity unavailable');
    const readyBytes=await waitFile('ready.json',intent.readyMs),ready=JSON.parse(readyBytes);
    if(Object.entries({...binding,pid:start.pid,startId:start.startId}).some(([k,v])=>ready.binding?.[k]!==v)||ready.state?.startupFramesPresent!==false)throw Error('Ready identity/evidence differs');
    verifyInstalledFrame(ready.state,intent.frameIdentity);
    record('ready-observed',{sha256:sha(readyBytes),ready});
    let firstState=null;
    await exchangeTwo(intent,{
      ensure:async()=>{if(first||osExit||Date.now()>=deadline)throw Error('Stopped before next request');},
      send:async req=>{
      const sequence=req.sequence,file=path.join(root,`request-${sequence}.json`);
      // Request 2 is created only after validated result 1 and an alive receipt.
      durable(file,req);record('request-sent',{sequence,request:req,sha256:sha(fs.readFileSync(file))});
      },
      read:sequence=>waitFile(`result-${sequence}.json`,intent.requestMs),
      accept:async(req,bytes)=>{
      const sequence=req.sequence,value=JSON.parse(bytes);
      const state=verifyAcceptedResponse(value,req,start,binding,sha(fs.readFileSync(path.join(root,`request-${sequence}.json`))),ready.state,firstState,intent.frameIdentity);
      if(!firstState)firstState=state;
      const alive=processState(child.pid);
      if(alive.state!=='running'||alive.startId!==start.startId||alive.path!==start.path)throw Error('IDE is not the same live instance after read');
      record('result-accepted',{sequence,resultSha256:sha(bytes),value,alive});
      if(first)throw Error('Result recording failed');
      }
    });
    // A completed second file alone cannot hide a later recorder exception.
    const stopLimit=Math.min(deadline,Date.now()+5000);let receiver=null;
    while(!receiver&&Date.now()<stopLimit){
      const names=fs.readdirSync(root);if(names.some(n=>/^native-\d+-first-error\.json$/.test(n)))throw Error('Native record failure');
      const name=names.find(n=>/^native-\d+-receiver-stopped\.json$/.test(n));
      if(name)receiver=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));else await sleep(100);
    }
    if(!receiver||receiver.completed!==2||receiver.firstError!==null||receiver.ideExitRequested!==false)throw Error('Receiver completion evidence missing');
    if(fs.readFileSync(path.join(root,'ide.stderr.log'),'utf8').includes('TWO_READ_ERROR'))throw Error('Native stderr records failure');
    const after=fingerprint(intent.protectedFiles);record('protected-after',{files:after});
    if(JSON.stringify(after)!==JSON.stringify(intent.protectedFiles))throw Error('Protected bytes changed');
    if(first||osExit)throw Error('Process or observer failed before completion');
    durable(path.join(root,'two-read-result.json'),{status:'two-read-observed',binding,start,results:2,ideRetained:true,observerRetained:true,projectOperations:0,exitRequests:0,onlySameServiceScope:true,reconnectVerified:false});
    record('observation-completed',{resultSha256:sha(fs.readFileSync(path.join(root,'two-read-result.json'))),exitNotRequired:true});
  }catch(error){
    failure(child?'observation':'preflight',error);
    if(child&&!closed){
      // Fixed read-only late window; no new requests and no success promotion.
      await sleep(intent.lateMs??15000);
      record('late-window-ended',{first,osExit,resultFiles:[1,2].map(n=>({sequence:n,exists:fs.existsSync(path.join(root,`result-${n}.json`))})),idePreserved:true});
    }else release();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await launch(process.argv[2]);
