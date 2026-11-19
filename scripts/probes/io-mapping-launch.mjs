// One isolated sample, two confirmed IDE lifetimes. This is not a service entry point.
import {execFile, spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {copyFile, lstat, mkdir, open, readFile, readdir, realpath, stat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {promisify, isDeepStrictEqual} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const followup = args[0] === '--scalar-followup';
const fixtureRoot = args[followup ? 1 : 0];
if (process.platform !== 'win32' || !/^D:\\InoPro-S8b-IO-\d{8}-\d{6}$/i.test(fixtureRoot ?? '') ||
    args.length !== (followup ? 2 : 3))
  throw Error('Usage: io-mapping-launch.mjs new-root source.project sha256 | --scalar-followup completed-root');
const original = followup ? JSON.parse(await readFile(path.join(fixtureRoot,'fixture-origin.json'),'utf8')) : null;
const sourceArg = followup ? original.source : args[1];
const expected = followup ? original.sha256 : args[2];
if (!path.isAbsolute(sourceArg) || !/\.project$/i.test(sourceArg) || !/^[0-9a-f]{64}$/.test(expected))
  throw Error('Missing verified source path or SHA-256');
const root = followup ? path.join(fixtureRoot,'scalar-followup') : fixtureRoot;
const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('./io-mapping-native.py', import.meta.url));
const collector = fileURLToPath(new URL('./io_mapping_read.py', import.meta.url));
const fixed = 'C:\\Users\\Administrator\\.codex\\worktrees\\s8a-replace-daily-fixed-033\\InoPro';
const daily = 'D:\\InoPro\\.local\\dsh-phase4-repair-20261028-A1';
const sealed = 'D:\\InoPro-S8a-TaskRemove-20261119-153243340\\engineering\\AM610_S8a_TaskCallRemove.project';
const exe = 'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe';
const ps = path.join(process.env.SystemRoot, 'System32','WindowsPowerShell','v1.0','powershell.exe');
const run = promisify(execFile);
const digest = data => createHash('sha256').update(data).digest('hex');
const sha = async file => digest(await readFile(file));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const loadFixed = name => import(pathToFileURL(path.join(fixed,'dist',name+'.js')));
const {Store, pathKey} = await loadFixed('storage');
const {probeProcess, observeLeaseOwner} = await loadFixed('lease-process');
const {assertNotIsolated, isolationState} = await loadFixed('isolation');
const store = new Store(daily);
const source = await realpath(sourceArg);
const engineering = path.join(fixtureRoot,'engineering');
const project = path.join(engineering,path.basename(source));
const operationId = randomUUID();
const now = () => new Date().toISOString();
const publish = async (name, obj) => {
  const fd = await open(path.join(root,name),'wx');
  try { await fd.writeFile(JSON.stringify(obj,null,2)+'\n'); await fd.sync(); }
  finally { await fd.close(); }
};
const optional = async read => {try {return await read();} catch(e) {if(e.code==='ENOENT')return null;throw e;}};
const identity = async file => {
  const s = await stat(file,{bigint:true});
  if(!s.isFile() || !s.ino)throw Error('File identity unavailable: '+file);
  return s.dev+':'+s.ino;
};
const serviceLock = store.file('service.lock'), projectLock = store.sourceLock(project);
async function leaseView(file) {
  const value = await optional(()=>readJson(file));
  if(value===null)return {present:false};
  const owner = await observeLeaseOwner(value);
  return {present:true,state:owner.state,reason:owner.reason,pid:value.pid,leaseId:value.leaseId};
}
async function owners() {
  const cmd = [
    "$ErrorActionPreference='Stop'",
    "$list=@(Get-CimInstance Win32_Process -Filter \"Name LIKE 'InoProShop%' OR Name='node.exe' OR Name='DeepSeek Harness.exe'\" | Where-Object {$_.Name -ne 'node.exe' -or $_.CommandLine -match '(?i)InoPro.*dist[\\\\/]server\\.js|observe-daily'})",
    "@{fileVersion=(Get-Item -LiteralPath 'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe').VersionInfo.FileVersion; processes=@($list | ForEach-Object {@{pid=$_.ProcessId;name=$_.Name;start=$_.CreationDate.ToUniversalTime().ToString('o')}})} | ConvertTo-Json -Compress"
  ].join('\n');
  const {stdout} = await run(ps,['-NoProfile','-NoLogo','-NonInteractive','-Command',cmd],{windowsHide:true,timeout:15000});
  return JSON.parse(stdout.trim());
}
function confirmHandoff(view) {
  if(view.fileVersion!=='1.9.1.6' || view.processes.some(p=>!/^DeepSeek Harness\.exe$/i.test(p.name)))
    throw Error('IDE identity or existing IDE/service ownership prevents probe');
}
async function checkRegistry() {
  // Refuse a missing daily directory even if the formal Store could initialize it.
  await stat(store.file('registry.json')); await stat(store.file('operations'));
  const reg = await store.registry();
  const ops = await store.operations(), isolation = await isolationState(store);
  const disposed = new Set(isolation.own.flatMap(e=>e.plan.operationIds));
  if(ops.some(o=>o.status==='running' || o.status==='unknown'&&!disposed.has(o.operationId)))
    throw Error('Running or undisposed operation');
  await assertNotIsolated(store,undefined,[source,project]);
  const sourceId = await identity(source);
  if(await identity(sealed)===sourceId)throw Error('Sealed remove probe cannot be used as source');
  for(const item of reg.projects) {
    for(const file of [item.sourcePath,item.workingPath].filter(Boolean)) {
      if(pathKey(file)===pathKey(project))throw Error('Fixture path already registered');
      if(item.projectId===reg.activeProjectId && (pathKey(file)===pathKey(source) ||
        await optional(()=>identity(file))===sourceId))throw Error('Source aliases active project');
    }
  }
  return {unknown:ops.filter(o=>o.status==='unknown').length,isolations:isolation.own.length,
    revision:reg.revision,operations:ops.length,sourceId};
}
async function dirImage(directory) {
  const rows=[];
  async function walk(folder) {
    for(const item of await readdir(folder,{withFileTypes:true})) {
      const file=path.join(folder,item.name);
      if(item.isSymbolicLink())throw Error('Unexpected directory link');
      if(item.isDirectory()){await walk(file);continue;}
      if(!item.isFile())throw Error('Unexpected fixture file type');
      const s=await lstat(file,{bigint:true});
      rows.push({path:path.relative(directory,file),bytes:String(s.size),mtimeNs:String(s.mtimeNs),sha256:await sha(file)});
    }
  }
  await walk(directory);
  return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function validateOriginal() {
  const prior = file => readJson(path.join(fixtureRoot,file+'.json'));
  const complete=await prior('probe-complete'), lease=await prior('lease-final');
  if(pathKey(await realpath(fixtureRoot))!==pathKey(fixtureRoot) ||
    pathKey(original.project)!==pathKey(project) || pathKey(await realpath(project))!==pathKey(project) ||
    await identity(project)!==original.projectFileId || await sha(project)!==expected ||
    !original.operationId || complete.operationId!==original.operationId || lease.operationId!==original.operationId ||
    !complete.sameHandleRawEqual || !complete.independentOpenRawEqual || complete.mainFileSha256!==expected ||
    lease.service.present!==false || lease.fixture.present!==false ||
    complete.first.creationUtcTicks===complete.second.creationUtcTicks)throw Error('Original fixture proof incomplete');
  const hashes={};
  for(const mode of ['first','reopen']) {
    const r=await prior(mode+'-result'), exit=await prior(mode+'-exit-observation'), proc=await prior(mode+'-process');
    const engine=complete[mode==='first'?'first':'second'];
    if([r,exit,proc].some(v=>v.operationId!==original.operationId) || r.status!=='succeeded' ||
      !r.closed || !r.opened || !r.requestedScansReturned || r.passName!==mode || r.saveCalls!==0 || r.compileCalls!==0 ||
      pathKey(r.projectPath)!==pathKey(project) || r.diskBefore!==expected || r.diskAfterClose!==expected ||
      !isDeepStrictEqual(engine,r.engine) || exit.code!==0 || exit.signal!==null || exit.pid!==engine.pid ||
      proc.pid!==engine.pid || proc.birth.state!=='running' || proc.birth.identity.startId!==engine.creationUtcTicks)
      throw Error('Original native proof differs: '+mode);
  }
  const a=await prior('first-A');
  if(!isDeepStrictEqual(a,await prior('first-A2')) || !isDeepStrictEqual(a,await prior('reopen-C')))
    throw Error('Original snapshot evidence no longer agrees');
  for(const file of ['fixture-origin','probe-complete','lease-final','first-A','first-A2','reopen-C',
    ...['first','reopen'].flatMap(m=>['result','process','exit-observation'].map(s=>m+'-'+s))])
    hashes[file+'.json']=await sha(path.join(fixtureRoot,file+'.json'));
  return hashes;
}
const originalHashes = followup ? await validateOriginal() : null;
await mkdir(root); // Both the original and the one-time follow-up refuse any existing evidence destination.
let outstanding=false, acquireAttempted=false;
async function observe(mode) {
  const view=await owners();
  await publish(mode+'-preflight.json',{operationId,time:now(),view,files:await dirImage(engineering)});
  confirmHandoff(view);
  if(await sha(project)!==expected)throw Error('Main file changed before '+mode);
  const out=await open(path.join(root,mode+'-stdout.txt'),'wx');
  const err=await open(path.join(root,mode+'-stderr.txt'),'wx');
  try {
    const args=['--profile="InoProShop(V1.9.1.6)"','--runscript="'+script+'"'];
    await publish(mode+'-intent.json',{operationId,mode,project,expected,executable:exe,args,time:now()});
    const child=spawn(exe,args,{cwd:path.dirname(exe),windowsHide:true,windowsVerbatimArguments:true,
      env:{...process.env,INOPRO_S8B_ROOT:root,INOPRO_S8B_FIXTURE_ROOT:fixtureRoot,INOPRO_S8B_REPO:repo,
        INOPRO_S8B_PASS:mode,INOPRO_S8B_OPERATION:operationId},
      stdio:['ignore',out.fd,err.fd]});
    outstanding=true;
    const done=new Promise(resolve=>{
      child.once('error',e=>resolve({error:e.message,time:now()}));
      child.once('close',(code,signal)=>resolve({code,signal,time:now()}));
    });
    const birth=await probeProcess(child.pid);
    await publish(mode+'-process.json',{operationId,pid:child.pid,birth,time:now()});
    let timer;
    const ended=await Promise.race([done,new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true,time:now()}),180000);})]);
    clearTimeout(timer);
    await publish(mode+'-exit-observation.json',{operationId,pid:child.pid,...ended});
    if(ended.timeout)child.unref(); // Leave the IDE and leases intact; never terminate or relaunch.
    if(ended.code!==0 || birth.state!=='running')throw Error('Native exit or process identity unconfirmed; stop');
    const r=await readJson(path.join(root,mode+'-result.json'));
    if(r.operationId!==operationId || r.passName!==mode || r.engine.pid!==child.pid ||
       r.engine.creationUtcTicks!==birth.identity.startId || r.engine.executableVersion!==view.fileVersion ||
       pathKey(r.projectPath)!==pathKey(project) || !r.opened || !r.closed ||
       r.diskBefore!==expected || r.diskAfterClose!==expected || await sha(project)!==expected)
      throw Error('Native result, closure, file hash or process identity not confirmed; stop');
    outstanding=false;
    await publish(mode+'-after-exit.json',{operationId,time:now(),files:await dirImage(engineering)});
    if(r.status!=='succeeded' || !r.requestedScansReturned)throw Error('Collection failed; inspect original native result');
    return r;
  } finally { await out.close();await err.close(); }
}
try {
  const view=await owners();
  const initialLease=await leaseView(serviceLock);
  await publish('preflight.json',{time:now(),operationId,view,initialLease});
  confirmHandoff(view);
  if(initialLease.present&&initialLease.state!=='stale')throw Error('Original directory is occupied or owner uncertain');
  if(pathKey(sourceArg)!==pathKey(source) || await sha(source)!==expected ||
     (await readJson(path.join(fixed,'package.json'))).version!=='0.33.0')throw Error('Source or fixed build identity mismatch');
  for(const suffix of ['.~u','.lock','.lck','.~lock'])
    if(await optional(()=>lstat(source+suffix)))throw Error('Source occupied');
  const before=await checkRegistry();
  acquireAttempted=true;
  await store.acquire(project);
  const held=await checkRegistry();
  const svc=await leaseView(serviceLock), own=await leaseView(projectLock);
  if(svc.state!=='active'||own.state!=='active'||svc.pid!==process.pid||own.pid!==process.pid)
    throw Error('Could not confirm probe owns both leases');
  await publish('lease-acquired.json',{operationId,time:now(),before,held,svc,projectLease:own});
  if(followup) {
    if(!isDeepStrictEqual(originalHashes,await validateOriginal()))throw Error('Original evidence changed before open');
    await publish('original-proof.json',{originalOperationId:original.operationId,hashes:originalHashes,time:now()});
  } else {
    await mkdir(engineering);
    await copyFile(source,project,constants.COPYFILE_EXCL);
  }
  await assertNotIsolated(store,undefined,[source,project]);
  if(await identity(source)!==held.sourceId || await sha(source)!==expected || await sha(project)!==expected ||
    await identity(project)===held.sourceId)throw Error('Fixture copy identity mismatch');
  await publish('fixture-origin.json',{operationId,source,project,sha256:expected,sourceId:held.sourceId,
    projectFileId:await identity(project),runtime:fixed,originalOperationId:original?.operationId ?? null,
    launcherSha256:await sha(fileURLToPath(import.meta.url)),
    nativeSha256:await sha(script),collectorSha256:await sha(collector),workerSha256:await sha(path.join(repo,'bridge','worker.py'))});
  const mode=followup?'followup':'first';
  const first=await observe(mode);
  const a=await readJson(path.join(root,mode+'-A.json')), a2=await readJson(path.join(root,mode+'-A2.json'));
  if(!isDeepStrictEqual(a,a2))throw Error('Same-handle reports differ; no second open');
  if(followup) {
    await publish('probe-complete.json',{operationId,originalOperationId:original.operationId,time:now(),
      sameHandleRawEqual:true,engine:first.engine,projectFileId:await identity(project),mainFileSha256:await sha(project)});
  } else {
    const second=await observe('reopen');
    if(first.engine.creationUtcTicks===second.engine.creationUtcTicks)throw Error('Independent IDE identity not confirmed');
    const c=await readJson(path.join(root,'reopen-C.json'));
    await publish('probe-complete.json',{operationId,time:now(),sameHandleRawEqual:true,
      independentOpenRawEqual:isDeepStrictEqual(a,c),first:first.engine,second:second.engine,mainFileSha256:await sha(project)});
  }
} catch(e) {
  await publish('probe-stopped.json',{operationId,time:now(),outstanding,error:e.message});
  throw e;
} finally {
  if(acquireAttempted&&!outstanding) {
    await store.release();
    await publish('lease-final.json',{operationId,time:now(),service:await leaseView(serviceLock),
      fixture:await leaseView(projectLock),owners:await owners()});
  }
}
