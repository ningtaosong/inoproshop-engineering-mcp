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
  try {await file.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await file.sync();}
  finally {await file.close();}
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
  await publish(mode+'-intent.json',{operationId,mode,project,expectedDisk,sha256:await sha(script),guardSha256:await sha(path.join(repo,'scripts','probes','library_placeholder_clear_guard.py')),bridgeSha256:await sha(path.join(fixed,'bridge','worker.py')),time:now()});
  const stdout=await open(path.join(root,mode+'-stdout.txt'),'wx');
  const stderr=await open(path.join(root,mode+'-stderr.txt'),'wx');
  try {
    const child=spawn(executable,['--profile="InoProShop(V1.9.1.6)"','--runscript="'+script+'"'],{
      cwd:path.dirname(executable),windowsHide:true,windowsVerbatimArguments:true,
      env:{...process.env,INOPRO_CLEAR_ROOT:root,INOPRO_CLEAR_FIXED:fixed,INOPRO_CLEAR_MODE:mode},
      stdio:['ignore',stdout.fd,stderr.fd]
    });
    dispatched=true;
    const exit=new Promise(resolve=>{
      child.once('error',error=>resolve({error:error.message}));
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    const birth=await probeProcess(child.pid);
    await publish(mode+'-start.json',{operationId,mode,pid:child.pid,birth,time:now()});
    let timer;
    const ended=await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),240000);})]);
    clearTimeout(timer);
    if(ended.timeout){child.unref();await publish(mode+'-unconfirmed.json',{operationId,stage:'native-exit',pid:child.pid,birth,time:now()});}
    else await publish(mode+'-exit.json',{operationId,pid:child.pid,...ended,time:now()});
    if(ended.code!==0||birth.state!=='running')throw Error('Native completion could not be confirmed; retain evidence and lease');
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
  } finally {await stdout.close();await stderr.close();}
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
  if(prepared.saveCount!==1||prepared.fixtureMutationCount!==2||prepared.clearDispatchCount!==0)
    throw Error('Fixture preparation not confirmed');
  const baseline=await nativePass('baseline',prepared.diskAfterClose);
  if(baseline.saveCount!==0||baseline.clearDispatchCount!==0||baseline.diskAfterClose!==prepared.diskAfterClose)
    throw Error('Saved baseline verification failed');
  const write=await nativePass('clear',baseline.diskAfterClose);
  if(write.saveCount!==1||write.clearDispatchCount!==1)throw Error('Single clear/save not confirmed');
  const verify=await nativePass('verify',write.diskAfterClose);
  if(verify.saveCount!==0||verify.clearDispatchCount!==0||verify.diskAfterClose!==write.diskAfterClose)
    throw Error('Saved version changed during verification');
  const births=[prepared,baseline,write,verify].map(r=>r.engine.creationUtcTicks);
  if(new Set(births).size!==4)throw Error('Four independent native processes not confirmed');
  await publish('probe-succeeded.json',{operationId,project,savedDiskSha256:verify.diskAfterClose,time:now(),
    clearDispatchCount:1,preparationSaveCount:1,formalSaveCount:1,independentProcesses:4});

} catch(error) {
  await publish('probe-stopped.json',{operationId,uncertain:dispatched,error:error.message,time:now()});
  throw error;
} finally {
  if(!dispatched) {
    await store.release();
    await publish('lease-released.json',{operationId,ownerPid:process.pid,time:now()});
  }
}
