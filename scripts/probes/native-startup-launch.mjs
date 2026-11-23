// One no-project native launch. Registry/lease protection is reused unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Store} from 'file:///D:/InoPro-Fixed/0.36.0-da87ac1d553a/dist/storage.js';
import {probeProcess,observeLeaseOwner} from 'file:///D:/InoPro-Fixed/0.36.0-da87ac1d553a/dist/lease-process.js';
import {isolationState,maintenanceGuard} from 'file:///D:/InoPro-Fixed/0.36.0-da87ac1d553a/dist/isolation.js';
import {observeProbe,closeProbeHandles} from './probe-exit-observer.mjs';

const root=process.argv[2],data='D:/InoPro/.local/dsh-phase4-repair-20261028-A1';
assert(process.platform==='win32'&&/^D:\\InoPro-ProbeStartup-\d{8}-\d{6}$/i.test(root??''),'Dedicated new diagnostic folder required');
assert.equal(await fs.realpath(root),root);
const directory=path.dirname(fileURLToPath(import.meta.url));
const script=path.join(directory,'native-startup-smoke.py');
const exe='D:\\InProShop\\CODESYS\\Common\\InoProShop.exe';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=async file=>sha(await fs.readFile(file));
async function publish(name,value){
  const f=await fs.open(path.join(root,name),'wx');
  let first=null;
  try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}catch(e){first=e;throw e;}finally{await closeProbeHandles([f],first);}
}
const store=new Store(data);
async function check(label){
  await maintenanceGuard();
  const state=await isolationState(store),ops=await store.operations();
  const isolated=new Set(state.own.flatMap(x=>x.plan.operationIds));
  assert(!ops.some(x=>x.status==='running'||x.status==='unknown'&&!isolated.has(x.operationId)),'Unisolated pending engineering operation');
  const command="$p=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match 'InoProShop|DeepSeek Harness' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'dist[\\\\/]server\\.js|library-placeholder-clear-launch')});ConvertTo-Json -InputObject @($p|Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath)";
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8'});
  const processes=JSON.parse(stdout.trim());assert.equal(processes.length,0,'Active service, IDE or Desktop');
  const raw=await fs.readFile(path.join(data,'service.lock')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const lease=raw?JSON.parse(raw.toString('utf8')):null,owner=lease?await observeLeaseOwner(lease):{state:'absent'};
  if(label==='before-acquire')assert(['stale','absent'].includes(owner.state),'Lease owner is active or unconfirmed');
  await publish('exclusive-'+label+'.json',{processes,leaseSha256:raw?sha(raw):null,lease,owner,unknownCount:ops.filter(x=>x.status==='unknown').length,
    independentOriginalUnknown:'96060196-cd1b-4a03-97ed-92e6785d5350 remains unknown; no original project/request replay',scope:'no project; service lease only'});
}

await check('before-acquire');
assert.equal((await fs.stat(exe)).isFile(),true);
const version=(await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"(Get-Item -LiteralPath 'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe').VersionInfo.FileVersion"],{windowsHide:true,encoding:'utf8'})).stdout.trim();
assert.equal(version,'1.9.1.6');
const operationId=randomUUID(),launchId=randomUUID(),scriptSha256=await hash(script);
const argv=['--profile="InoProShop(V1.9.1.6)"','--runscript="'+script+'"'];
const binding={operationId,launchId,scriptSha256};
const intent={...binding,exe,exeSha256:await hash(exe),argv,cwd:path.dirname(exe),version,
  helperSha256:await hash(path.join(directory,'probe_startup_trace.py')),observerSha256:await hash(path.join(directory,'probe-exit-observer.mjs')),
  dataDir:data,resultFile:path.join(root,'startup-result.json'),noProject:true,businessMs:240000,graceMs:60000,
  suppliedEnvironment:{INOPRO_TRACE_ROOT:root,INOPRO_TRACE_MODE:'startup',INOPRO_TRACE_OPERATION:operationId,INOPRO_TRACE_LAUNCH:launchId,INOPRO_TRACE_SCRIPT_SHA:scriptSha256},
  inheritedEnvironment:'inherited but neither dumped nor changed; no credentials recorded',time:new Date().toISOString()};
await publish('launch-intent.json',intent); // one intent prevents replay of this diagnostic
let launched=false,confirmed=false;
try{
  await store.acquire(); // no source path: never acquires/releases the sealed project's lock
  await check('held');await publish('lease-acquired.json',{ownerPid:process.pid,dataDir:data,sourceLeaseRequested:false});
  assert.equal(await hash(script),scriptSha256);
  const out=await fs.open(path.join(root,'native-stdout.txt'),'wx'),err=await fs.open(path.join(root,'native-stderr.txt'),'wx');
  let streamError=null;
  try{
    const child=spawn(exe,argv,{cwd:path.dirname(exe),windowsHide:true,windowsVerbatimArguments:true,env:{...process.env,...intent.suppliedEnvironment},stdio:['ignore',out.fd,err.fd]});
    launched=true;
    const observed=await observeProbe(child,{binding,birth:probeProcess(child.pid),publish:(name,v)=>publish(name+'.json',v),resultFile:intent.resultFile,businessMs:240000,graceMs:60000});
    assert.equal(observed.status,'succeeded','Startup completion uncertain; stop, preserve bounded observations, no retry');
    const result=observed.result.value;
    assert.equal(result.noProject,true);assert.equal(result.message,'无工程启动取证：主线程往返完成。');
    for(const n of ['projectCalls','placeholderCalls','compileCalls','saveCalls'])assert.equal(result[n],0);
    const names=(await fs.readdir(root)).filter(n=>/^startup-trace-\d+\.json$/.test(n)).sort();
    const events=await Promise.all(names.map(async n=>JSON.parse(await fs.readFile(path.join(root,n),'utf8'))));
    const stages=events.map(e=>e.stage);
    for(const stage of ['process-identity','necessary-modules-complete','primary-thread-entered','primary-thread-returned','result-publication-complete','exit-requested'])assert(stages.includes(stage),'Missing '+stage);
    assert(!stages.includes('failure'),'Native recorder reported a failure');
    for(const e of events.filter(x=>x.stage!=='necessary-modules-start')){
      assert.equal(e.binding.creationUtcTicks,observed.birth.identity.startId);assert.equal(e.binding.launchId,launchId);
    }
    await publish('startup-verification.json',{status:'succeeded',binding,stages,process:observed.birth,exit:observed.exit,resultSha256:observed.result.sha256,
      noProject:true,originalUnknownUnchanged:true,meaning:'Only this new no-project startup and evidence chain; not placeholder clearing or original prepare success'});
    confirmed=true;
  }catch(error){streamError=error;throw error;}finally{await closeProbeHandles([out,err],streamError);}
}catch(error){
  try{await publish('startup-stopped.json',{status:launched?'unknown':'not-dispatched',primaryException:{name:error.name,message:error.message,stack:error.stack},binding});}
  catch(logger){process.stderr.write(JSON.stringify({primaryException:error.message,loggerException:logger.message})+'\n');}
  throw error;
}finally{
  if(!launched||confirmed){await store.release();await publish('lease-released.json',{ownerPid:process.pid,onlyOwnLease:true,originalSourceLockUntouched:true,time:new Date().toISOString()});}
}
