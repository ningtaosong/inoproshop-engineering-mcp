import {observeProbe,closeProbeHandles} from './probe-exit-observer.mjs';
import {execFile, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {open, readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {promisify} from 'node:util';
import {Store, pathKey} from 'file:///D:/InoPro-Fixed/0.36.0-da87ac1d553a/dist/storage.js';
import {probeProcess} from 'file:///D:/InoPro-Fixed/0.36.0-da87ac1d553a/dist/lease-process.js';
import {assertNotIsolated, isolationState} from 'file:///D:/InoPro-Fixed/0.36.0-da87ac1d553a/dist/isolation.js';

const fixed='D:/InoPro-Fixed/0.36.0-da87ac1d553a';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const script=fileURLToPath(new URL('./library-placeholder-clear-native.py',import.meta.url));
const executable='D:\\InProShop\\CODESYS\\Common\\InoProShop.exe';
const daily='D:\\InoPro\\.local\\dsh-phase4-repair-20261028-A1';
const seed='89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173';
const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const run=promisify(execFile);
const requested=process.argv[2];
if(process.platform!=='win32'||!/^D:\\InoPro-PlaceholderClear-[0-9-]+$/i.test(requested??''))throw Error('Dedicated fixture required');
const root=await realpath(requested);
const project=path.join(root,'engineering','AM610_PlaceholderClear.project');
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const load=async name=>JSON.parse(await readFile(path.join(root,name),'utf8'));
const publish=async(name,value)=>{
  const file=await open(path.join(root,name),'wx');
  let first=null;
  try {await file.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await file.sync();}
  catch(error){first=error;throw error;}
  finally {await closeProbeHandles([file],first);}
};
const now=()=>new Date().toISOString();
const origin=await load('fixture-origin.json');
if(pathKey(root)!==pathKey(requested)||pathKey(await realpath(project))!==pathKey(project)||
   pathKey(origin.project)!==pathKey(project)||origin.seedSha256!==seed||await sha(project)!==seed)
  throw Error('Original approved disposable fixture missing or changed');
const operationId=randomUUID();

async function checkHandoff() {
  const command=[
    "$ErrorActionPreference='Stop'",
    "$owners=@(Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe' OR Name LIKE 'InoProShop%' OR Name='node.exe'\" | Where-Object {$_.Name -ne 'node.exe' -or $_.CommandLine -match 'dist[\\\\/]server\\.js|observe-daily'})",
    "if($owners.Count){throw 'DSH, service or IDE still running'}",
    "(Get-Item -LiteralPath 'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe').VersionInfo.FileVersion"
  ].join('\n');
  const {stdout}=await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:12000});
  if(stdout.trim()!=='1.9.1.6')throw Error('Verified native IDE version not found');
}
async function verifyRegistry(store) {
  const registry=await store.registry();
  if(registry.projects.some(row=>[row.sourcePath,row.workingPath].some(value=>pathKey(value)===pathKey(project))))
    throw Error('Probe path is already registered in daily data');
  const isolation=await isolationState(store);
  const isolated=new Set(isolation.own.flatMap(row=>row.plan.operationIds));
  const ops=await store.operations();
  if(ops.some(row=>row.status==='running'||row.status==='unknown'&&!isolated.has(row.operationId)))
    throw Error('Unresolved operation in daily registration');
  await assertNotIsolated(store,undefined,[project]);
  return {registryVersion:registry.version,registryRevision:registry.revision,unknownIsolated:ops.filter(r=>r.status==='unknown').length};
}

let dispatched=false;
async function nativePass(mode,expectedDisk) {
  if(await sha(project)!==expectedDisk)throw Error('Fixture changed before native pass');
  await checkHandoff();
  const launchId=randomUUID(),scriptSha256=await sha(script);
  const argv=['--profile="InoProShop(V1.9.1.6)"','--runscript="'+script+'"'];
  await publish(mode+'-intent.json',{operationId,launchId,mode,project,expectedDisk,sha256:scriptSha256,
    guardSha256:await sha(path.join(repo,'scripts','probes','library_placeholder_clear_guard.py')),
    bridgeSha256:await sha(path.join(fixed,'bridge','worker.py')),
    libraryHelperSha256:await sha(path.join(fixed,'bridge','library_reference.py')),
    recorderSha256:await sha(path.join(repo,'scripts','probes','probe_startup_trace.py')),
    loaderSha256:await sha(path.join(repo,'scripts','probes','probe_fixed_helpers.py')),
    observerSha256:await sha(path.join(repo,'scripts','probes','probe-exit-observer.mjs')),
    executable,executableSha256:await sha(executable),argv,cwd:path.dirname(executable),time:now()});
  const stdout=await open(path.join(root,mode+'-stdout.txt'),'wx');
  const stderr=await open(path.join(root,mode+'-stderr.txt'),'wx');
  let first=null;
  try {
    const child=spawn(executable,argv,{
      cwd:path.dirname(executable),windowsHide:true,windowsVerbatimArguments:true,
      env:{...process.env,INOPRO_CLEAR_ROOT:root,INOPRO_CLEAR_FIXED:fixed,INOPRO_CLEAR_MODE:mode,
        INOPRO_TRACE_ROOT:root,INOPRO_TRACE_MODE:mode,INOPRO_TRACE_OPERATION:operationId,
        INOPRO_TRACE_LAUNCH:launchId,INOPRO_TRACE_SCRIPT_SHA:scriptSha256},
      stdio:['ignore',stdout.fd,stderr.fd]
    });
    dispatched=true;
    const observed=await observeProbe(child,{
      binding:{operationId,launchId,scriptSha256},birth:probeProcess(child.pid),
      resultFile:path.join(root,mode+'-result.json'),publish:(name,value)=>publish(mode+'-'+name+'.json',value),
      businessMs:240000,graceMs:60000
    });
    if(observed.status!=='succeeded')throw Error('Native completion uncertain; original timeout and bounded exit observations retained');
    const birth=observed.birth;
    const result=await load(mode+'-result.json');
    if(result.engine.pid!==child.pid||result.engine.creationUtcTicks!==birth.identity.startId||
       !result.closed||pathKey(result.projectPath)!==pathKey(project)||
       result.diskBefore!==expectedDisk||result.diskAfterClose!==await sha(project))
      throw Error('Native result unconfirmed; read original pass output, no replay');
    if (result.status==='failed'&&!result.fixtureMutationCount&&result.clearDispatchCount===0&&result.diskAfterClose===expectedDisk) {
      dispatched=false;
      throw Error('Read-only preflight stopped before mutation; see original result');
    }
    if(result.status!=='succeeded')throw Error('Native result unconfirmed; retain evidence and lease');
    dispatched=false;
    return result;
  } catch(error){first=error;throw error;} finally {await closeProbeHandles([stdout,stderr],first);}
}

await checkHandoff();
await publish('probe-operation.json',{operationId,project,started:now(),purpose:'clear one own ordinary placeholder application override; public set_redirection(null)'});
const store=new Store(daily);
try {
  const before=await verifyRegistry(store);
  await store.acquire(project);
  const held=await verifyRegistry(store);
  await publish('lease-acquired.json',{operationId,ownerPid:process.pid,before,held,time:now()});
  const prepared=await nativePass('prepare',seed);
  if(prepared.saveCount!==1||prepared.fixtureMutationCount!==2||prepared.clearDispatchCount!==0||prepared.compileCount!==0)
    throw Error('Fixture preparation not confirmed');
  const baseline=await nativePass('baseline',prepared.diskAfterClose);
  if(baseline.saveCount!==0||baseline.clearDispatchCount!==0||baseline.compileCount!==1||baseline.compileCompletedCount!==1||baseline.diskAfterClose!==prepared.diskAfterClose)
    throw Error('Saved baseline verification failed');
  const write=await nativePass('clear',baseline.diskAfterClose);
  if(write.saveCount!==1||write.clearDispatchCount!==1||write.compileCount!==1||write.compileCompletedCount!==1)throw Error('Single clear/save/build not confirmed');
  const verify=await nativePass('verify',write.diskAfterClose);
  if(verify.saveCount!==0||verify.clearDispatchCount!==0||verify.compileCount!==1||verify.compileCompletedCount!==1||verify.diskAfterClose!==write.diskAfterClose)
    throw Error('Saved version changed during verification');
  const births=[prepared,baseline,write,verify].map(r=>r.engine.creationUtcTicks);
  if(new Set(births).size!==4)throw Error('Four independent native processes not confirmed');
  await publish('probe-succeeded.json',{operationId,project,savedDiskSha256:verify.diskAfterClose,time:now(),
    clearDispatchCount:1,preparationSaveCount:1,formalSaveCount:1,preparationCompileCount:1,formalCompileCount:2,independentProcesses:4});

} catch(error) {
  try {await publish('probe-stopped.json',{operationId,uncertain:dispatched,error:error.message,
    primaryException:{name:error.name,message:error.message,stack:error.stack},time:now()});}
  catch(logger){process.stderr.write(JSON.stringify({primaryException:{name:error.name,message:error.message,stack:error.stack},
    loggerException:{name:logger.name,message:logger.message,stack:logger.stack}})+'\n');}
  throw error;
} finally {
  if(!dispatched) {
    await store.release();
    await publish('lease-released.json',{operationId,ownerPid:process.pid,time:now()});
  }
}
