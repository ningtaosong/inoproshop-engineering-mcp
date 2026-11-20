// Independent probe only. No model, PLC or MCP operations are launched.
import {execFile, spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {copyFile, lstat, mkdir, open, readFile, readdir, realpath, stat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {promisify, isDeepStrictEqual} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const mappedSupplement=args[0]==='--mapped-supplement';
const supplement=mappedSupplement || args[0]==='--control-supplement';
const oldControl='D:\\InoPro-S8b-Positive-20261120-091939';
const oldMapping='D:\\InoPro-S8b-Positive-20261120-094036';
const scenario = mappedSupplement ? 'mapped-supplement' : supplement ? 'supplement' : args[0]==='--control' ? 'control' : args[0]==='--after-control' ? 'mapping' : null;
const input = scenario ? args.slice(1,4) : args;
if (scenario && args.length!==(scenario==='mapping'?6:4)) throw Error('Malformed independent stage invocation');
const followup = input[0]==='--after-preflight';
if(supplement && !/^D:\\InoPro-S8b-Supplement-\d{8}-\d{6}$/i.test(input[0]))throw Error('Independent supplement log root required');
const fixtureRoot = supplement ? (mappedSupplement ? oldMapping : oldControl) : input[followup ? 1 : 0];
if(!/^D:\\InoPro-S8b-Positive-\d{8}-\d{6}$/i.test(fixtureRoot ?? '') ||
   input.length !== (followup ? 2 : 3))throw Error('Unsupported invocation or fixture root');
const root = supplement ? input[0] : followup ? path.join(fixtureRoot,'confirmed-preflight-followup') : fixtureRoot;
const priorOrigin = followup ? JSON.parse(await readFile(path.join(fixtureRoot,'fixture-origin.json'),'utf8')) : null;
const sourceArg = followup ? priorOrigin.source : input[1];
const expected = followup ? priorOrigin.sha256 : input[2];
const seed = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173';
const archive = 'D:\\InoPro\\deliveries\\InoPro-review-20261109-132658.zip';
const archiveSha256 = 'c67abad48bef4bc410d72020d89f1452772f04a007f4622e490c90e815d597f0';
const seedMember = 'projects/AM610_Minimal_MCP.project';
if(process.platform!=='win32'||!path.isAbsolute(sourceArg??'')||!/\.project$/i.test(sourceArg)||expected!==seed)
  throw Error('Verified source, exact seed hash and dedicated Windows fixture required');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('./io-mapping-positive-native.py', import.meta.url));
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
const project = path.join(engineering,'AM610_IO_Positive.project');
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

const tracked = [fileURLToPath(import.meta.url), script, path.join(repo,'bridge','worker.py'),
  path.join(repo,'scripts','probes','io_mapping_read.py'),path.join(repo,'scripts','probes','io_mapping_export_guard.py'),
  path.join(repo,'scripts','probes','io_mapping_positive_guard.py'),path.join(repo,'scripts','probes','io-mapping-native.py')];
if(scenario) tracked.push(...['io_mapping_phase_guard.py','device_add_preflight.py','io_mapping_control_history.py'].map(name=>path.join(repo,'scripts','probes',name)));
async function fingerprints() {
  const files={};
  for(const filename of tracked)files[path.relative(repo,filename)]=await sha(filename);
  return JSON.stringify(files);
}
async function verifyArchive() {
  // Confirm the exact archived member rather than trusting a supplied file name.
  const cmd = [
    'from pathlib import Path',
    'import hashlib,json,sys,zipfile',
    'p=Path(sys.argv[1]); name=sys.argv[2]',
    'with zipfile.ZipFile(p) as z:',
    '    if z.namelist().count(name)!=1: raise ValueError("Ambiguous archive member")',
    '    data=z.read(name)',
    'print(json.dumps(dict(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())))'
  ].join('\n');
  if(await sha(archive)!==archiveSha256)throw Error('Seed archive fingerprint changed');
  const {stdout} = await run('python',['-B','-X','utf8','-c',cmd,archive,seedMember],{windowsHide:true,timeout:20000});
  if(JSON.parse(stdout).sha256!==seed || await sha(source)!==seed)throw Error('Seed bytes differ from archived member');
}
async function leasesHeld() {
  const svc=await leaseView(serviceLock), fixture=await leaseView(projectLock);
  if(svc.state!=='active'||fixture.state!=='active'||svc.pid!==process.pid||fixture.pid!==process.pid)
    throw Error('Both service and fixture leases must still identify this launcher');
  return {svc,fixture};
}
async function witness(mode,suffix) {
  const view=await owners();
  const current={operationId,time:now(),view,files:await dirImage(engineering),fileIdentity:await identity(project)};
  await publish(mode+'-'+suffix+'.json',current);
  return current;
}
const methods={prepare:{save:1,compile:1,dispatch:0},map:{save:1,compile:1,dispatch:1},verify:{save:0,compile:1,dispatch:0}};
Object.assign(methods,{'mapped-supplement':{save:0,compile:1,dispatch:0},supplement:{save:0,compile:1,dispatch:0},setup:{save:1,compile:0,dispatch:0},control:{save:1,compile:1,dispatch:0},
  controlread:{save:0,compile:1,dispatch:0},mapping:{save:1,compile:2,dispatch:1},mappedread:{save:0,compile:1,dispatch:0}});
let uncertain=false, acquireAttempted=false;
async function nativePass(mode, disk, fileId, codeIdentity) {
  const pre=await witness(mode,'preflight');
  confirmHandoff(pre.view);
  await leasesHeld();
  await checkRegistry();
  await assertNotIsolated(store,undefined,[source,project]);
  if(await sha(project)!==disk || pathKey(await realpath(project))!==pathKey(project) ||
    pre.fileIdentity!==fileId || await sha(source)!==seed || await fingerprints()!==codeIdentity)
    throw Error('Probe implementation, path, source, file identity or disk changed before '+mode);
  for(const suffix of ['.~u','.lock','.lck','.~lock'])
    if(await optional(()=>lstat(project+suffix)))throw Error('External occupation of fixture');
  const childArgs=['--profile="InoProShop(V1.9.1.6)"','--runscript="'+script+'"'];
  await publish(mode+'-intent.json',{operationId,mode,project,expectedDisk:disk,fileId,
    executable:exe,args:childArgs,code:JSON.parse(codeIdentity),time:now()});
  const out=await open(path.join(root,mode+'-stdout.txt'),'wx');
  const err=await open(path.join(root,mode+'-stderr.txt'),'wx');
  try {
    const child=spawn(exe,childArgs,{cwd:path.dirname(exe),windowsHide:true,windowsVerbatimArguments:true,
      env:{...process.env,INOPRO_S8B_ROOT:root,INOPRO_S8B_FIXTURE_ROOT:fixtureRoot,INOPRO_S8B_REPO:repo,INOPRO_S8B_PASS:mode,
        INOPRO_S8B_OPERATION:operationId,INOPRO_S8B_EXPECTED_SHA256:disk},stdio:['ignore',out.fd,err.fd]});
    uncertain=true;
    const done=new Promise(resolve=>{
      child.once('error',e=>resolve({error:e.message,time:now()}));
      child.once('close',(code,signal)=>resolve({code,signal,time:now()}));
    });
    const birth=await probeProcess(child.pid);
    await publish(mode+'-process.json',{operationId,mode,pid:child.pid,birth,time:now()});
    let timer;
    const ended=await Promise.race([done,new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true,time:now()}),240000);})]);
    clearTimeout(timer);
    await publish(mode+'-exit-observation.json',{operationId,mode,pid:child.pid,...ended});
    if(ended.timeout)child.unref();
    if(ended.code!==0 || ended.signal!==null || birth.state!=='running')
      throw Error('Native termination or process instance unconfirmed; stop');
    const r=await readJson(path.join(root,mode+'-result.json'));
    if(r.operationId!==operationId || r.passName!==mode || r.engine.pid!==child.pid ||
       r.engine.creationUtcTicks!==birth.identity.startId || r.engine.executableVersion!==pre.view.fileVersion ||
       pathKey(r.projectPath)!==pathKey(project) || !r.opened || !r.closed || r.diskBefore!==disk ||
       !/^[0-9a-f]{64}$/.test(r.diskAfterClose) || r.diskAfterClose!==await sha(project))
      throw Error('Original native result, closure or file identity not confirmed; stop');
    const post=await witness(mode,'after-exit');
    if(r.status==='failed' && r.fixtureWriteStarted===false && r.setterDispatchCount===0 &&
        r.saveCalls===0 && r.diskAfterClose===disk) {
      uncertain=false;
      throw Error('Confirmed write-free failure before dispatch; retain the original result');
    }
    const wanted=methods[mode];
    if(r.status!=='succeeded' || r.saveCalls!==wanted.save || r.compileCalls!==wanted.compile ||
       r.setterDispatchCount!==wanted.dispatch || (wanted.save===0 && (r.diskAfterClose!==disk || post.fileIdentity!==fileId)))
      throw Error('Required native evidence unconfirmed; retain original outcome and stop');
    uncertain=false;
    return {disk:r.diskAfterClose,fileId:post.fileIdentity,process:r.engine};
  } finally {await out.close();await err.close();}
}
async function validatePreflight() {
  const read=n=>readJson(path.join(fixtureRoot,n+'.json'));
  // Pin all 41 closed first-attempt evidence files, including original code digests,
  // pre/post identities, snapshots, native exports, stdout/stderr and stage records.
  const names=[];
  for(const e of await readdir(fixtureRoot,{withFileTypes:true})) {
    if(e.isFile())names.push(e.name);
    else if(!e.isDirectory() || !['engineering','confirmed-preflight-followup'].includes(e.name))
      throw Error('Unexpected original evidence entry');
  }
  const lines=[];
  for(const n of names.sort())lines.push(await sha(path.join(fixtureRoot,n))+'  '+n+'\n');
  const manifest=digest(lines.join(''));
  if(names.length!==41 || manifest!=='86bab057a6eab64b17d570c9d24955a853b322ee2f70ee55a0b64881279b3b18')
    throw Error('Original pre-dispatch evidence differs or there are additional dispatch/checkpoint records');
  const origin=await read('fixture-origin'), op=origin.operationId, release=await read('lease-final'), stop=await read('probe-stopped');
  if(pathKey(await realpath(fixtureRoot))!==pathKey(fixtureRoot) || pathKey(await realpath(project))!==pathKey(project) ||
    pathKey(origin.project)!==pathKey(project) || !isDeepStrictEqual(origin,priorOrigin) ||
    origin.operationId!=='a6c3d4ad-a79e-439b-b055-aec644c4eca5' || origin.archiveSha256!==archiveSha256 ||
    release.operationId!==op || release.service.present!==false || release.fixture.present!==false ||
    stop.operationId!==op || stop.uncertain!==false)throw Error('Original stop, ownership or disposal not established');
  let disk=seed, prep;
  for(const mode of ['prepare','map']) {
    const r=await read(mode+'-result'), exit=await read(mode+'-exit-observation'), proc=await read(mode+'-process');
    const pre=await read(mode+'-preflight'), post=await read(mode+'-after-exit'), intent=await read(mode+'-intent');
    if([r,exit,proc,pre,post,intent].some(x=>x.operationId!==op) || r.passName!==mode || r.opened!==true || r.closed!==true ||
      pathKey(r.projectPath)!==pathKey(project) || pathKey(intent.project)!==pathKey(project) || !isDeepStrictEqual(intent.code,origin.scripts) ||
      r.engine.executableVersion!=='1.9.1.6' || proc.birth?.state!=='running' || proc.birth.identity.startId!==r.engine.creationUtcTicks ||
      [proc.pid,proc.birth.identity.pid,exit.pid].some(x=>x!==r.engine.pid) || exit.code!==0 || exit.signal!==null ||
      intent.fileId!==pre.fileIdentity || r.diskBefore!==disk || r.setterDispatchCount!==0)
      throw Error('Original execution or exit evidence incomplete');
    if(mode==='prepare') {
      if(r.status!=='succeeded' || r.saveCalls!==1 || r.compileCalls!==1 || !r.fixtureWriteStarted)throw Error('Unconfirmed original preparation');
      disk=r.diskAfterClose;
      prep={disk,fileId:post.fileIdentity,process:r.engine};
    } else if(r.status!=='failed' || r.saveCalls!==0 || r.compileCalls!==0 || r.fixtureWriteStarted!==false ||
      r.primaryError?.stage!=='before' || r.primaryError.message!=='Prepared fixture evidence differs at reopen' ||
      r.cleanupError || r.callbackError || r.diskAfterClose!==disk || pre.fileIdentity!==prep.fileId ||
      post.fileIdentity!==prep.fileId || r.engine.creationUtcTicks===prep.process.creationUtcTicks)throw Error('Previous map preflight uncertain');
  }
  const left=await read('prepare-prepared-state'),right=await read('map-before-state');
  const byRecord=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
  for(const state of [left,right]) {
    if(state.export.complete!==true || state.snapshot.coverage.enumerationComplete!==true ||
       state.snapshot.coverage.truncated || !state.snapshot.scans.every(s=>s.endObserved))throw Error('Original coverage incomplete');
    for(const section of ['devices','connectors','scans'])state.snapshot[section].sort(byRecord);
  }
  if(!isDeepStrictEqual(left,right) || await sha(path.join(fixtureRoot,'prepare-prepared.export'))!==left.export.exportSha256 ||
     await sha(path.join(fixtureRoot,'map-before.export'))!==left.export.exportSha256 ||
     await identity(project)!==prep.fileId || await sha(project)!==disk || await identity(source)!==origin.sourceId)
    throw Error('Original keyed observations, independent export or disk identity diverge');
  return {prep,manifest,previousOperationId:op};
}
async function historicalFixture(mapped=false) {
  const scriptPath=path.join(repo,'scripts','probes','io_mapping_control_history.py');
  const {stdout}=await run('python',['-B','-X','utf8',scriptPath,...(mapped?['mapped']:[])],{windowsHide:true,timeout:45000});
  const ref=JSON.parse(stdout);
  if(ref.root!==(mapped ? oldMapping : oldControl)||ref.fileId!==await identity(ref.project)||ref.disk!==await sha(ref.project)||
     pathKey(await realpath(ref.project))!==pathKey(ref.project))throw Error('Original saved file identity changed');
  return ref;
}
async function controlProof() {
  const dir=args[4],receipt=path.join(dir,'probe-complete.json');
  if(!/^D:\\InoPro-S8b-(?:Positive|Supplement)-\d{8}-\d{6}$/i.test(dir)||dir===root||
     !/^[a-f0-9]{64}$/.test(args[5])||await sha(receipt)!==args[5])throw Error('Control completion fingerprint differs');
  const r=await readJson(receipt),release=await readJson(path.join(dir,'lease-final.json'));
  if(!['control','supplement'].includes(r.scenario)||!r.stageHashes||release.operationId!==r.operationId||
      release.service.present!==false||release.fixture.present!==false)throw Error('Control incomplete or leases not released');
  for(const [f,h] of Object.entries(r.stageHashes)){
    if(f!==path.basename(f)||await sha(path.join(dir,f))!==h)throw Error('Control evidence changed: '+f);
  }
  const o=await readJson(path.join(dir,'fixture-origin.json'));
  if(o.operationId!==r.operationId||JSON.stringify(o.scripts)!==await fingerprints()||o.seedSha256!==seed||
     await sha(o.project)!==r.mainFileSha256)throw Error('Control file, seed or probe source changed');
  if(r.scenario==='supplement'){
    const old=await historicalFixture(), reference=await readJson(path.join(dir,'historical-control.json'));
    const behavior=await readJson(path.join(dir,'supplement-behavior.json'));
    if(!isDeepStrictEqual(old,reference)||behavior.oldOperationId!==old.operationId||
       behavior.supplementOperationId!==r.operationId||behavior.input!==old.disk||
       r.verified.fileId!==old.fileId||r.mainFileSha256!==old.disk)throw Error('Supplement chain mismatch');
    return {operationId:r.operationId,receiptSha256:args[5],controlRoot:dir,oldOperationId:old.operationId,
            historicalArchiveSha256:old.archiveSha256,behavior};
  }
  return {operationId:r.operationId,receiptSha256:args[5],controlRoot:dir,
          behavior:await readJson(path.join(dir,'controlread-behavior.json'))};
}
const proof=scenario==='mapping' ? await controlProof() : null;
const historical=supplement ? await historicalFixture(mappedSupplement) : null;
const bound=followup ? await validatePreflight() : null;
await mkdir(root); // Exclusive creation also prevents replay or continuation of old attempts.
try {
  const view=await owners();
  const lease=await leaseView(serviceLock);
  await publish('preflight.json',{operationId,time:now(),view,lease});
  confirmHandoff(view);
  if(lease.present && lease.state!=='stale')throw Error('Service lease active or indeterminate');
  if(pathKey(sourceArg)!==pathKey(source) || (await readJson(path.join(fixed,'package.json'))).version!=='0.33.0')
    throw Error('Source path or fixed build differs');
  for(const ext of ['.~u','.lock','.lck','.~lock'])
    if(await optional(()=>lstat(source+ext)))throw Error('External occupation of source');
  await verifyArchive();
  const codeIdentity=await fingerprints();
  const before=await checkRegistry();
  acquireAttempted=true;
  await store.acquire(project);
  const held=await checkRegistry();
  await publish('lease-acquired.json',{operationId,time:now(),before,held,...await leasesHeld()});
  if(supplement) {
    if(!isDeepStrictEqual(historical,await historicalFixture(mappedSupplement)))throw Error('Historical fixture changed during acquisition');
    await publish(mappedSupplement?'historical-mapping.json':'historical-control.json',historical);
  } else if(followup) {
    if(!isDeepStrictEqual(bound,await validatePreflight()))throw Error('Original evidence changed during acquisition');
    await publish('original-proof.json',bound);
  } else {
    await mkdir(engineering);
    await copyFile(source,project,constants.COPYFILE_EXCL);
  }
  await assertNotIsolated(store,undefined,[source,project]);
  const fileId=await identity(project);
  if(fileId===held.sourceId || await identity(source)!==held.sourceId || await sha(source)!==seed ||
      await sha(project)!==(supplement ? historical.disk : followup ? bound.prep.disk : seed))throw Error('Fixture/version changed or aliases source');
  await publish('fixture-origin.json',{operationId,source,project,sha256:seed,sourceId:held.sourceId,projectFileId:fileId,
    archive,archiveSha256,member:seedMember,runtime:fixed,seedSha256:seed,preparedDisk:bound?.prep.disk,
    originalOperationId:historical?.operationId ?? bound?.previousOperationId,inputDisk:historical?.disk,scripts:JSON.parse(codeIdentity)});
  if(scenario) {
    if(proof)await publish('control-proof.json',proof);
    let prep,middle,verified;
    if(supplement) {
      verified=await nativePass(scenario,historical.disk,historical.fileId,codeIdentity);
      if(historical.starts.includes(verified.process.creationUtcTicks))throw Error('Supplement lacks independent process identity');
    } else {
      prep=await nativePass('setup',seed,fileId,codeIdentity);
      middle=await nativePass(scenario,prep.disk,prep.fileId,codeIdentity);
      verified=await nativePass(scenario==='control'?'controlread':'mappedread',middle.disk,middle.fileId,codeIdentity);
      if(new Set([prep,middle,verified].map(p=>p.process.creationUtcTicks)).size!==3)throw Error('Independent IDE identities required');
    }
    const stageHashes={};
    for(const f of await readdir(root,{withFileTypes:true})){
      if(f.isFile())stageHashes[f.name]=await sha(path.join(root,f.name));
    }
    await publish('probe-complete.json',{operationId,scenario,prepare:prep,middle,verified,
      stageHashes,mainFileSha256:verified.disk,time:now()});
  } else {
  const prep=followup ? bound.prep : await nativePass('prepare',seed,fileId,codeIdentity);
  const mapped=await nativePass('map',prep.disk,prep.fileId,codeIdentity);
  const verify=await nativePass('verify',mapped.disk,mapped.fileId,codeIdentity);
  if(new Set([prep,mapped,verify].map(p=>p.process.creationUtcTicks)).size!==3)
    throw Error('Cannot identify independent preparation, mapping and readback processes');
  await publish('probe-complete.json',{operationId,time:now(),prepare:prep,map:mapped,verify,mainFileSha256:verify.disk});
  }
} catch(e) {
  await publish('probe-stopped.json',{operationId,time:now(),uncertain,error:e.message});
  throw e;
} finally {
  if(acquireAttempted && !uncertain) {
    await store.release();
    await publish('lease-final.json',{operationId,time:now(),service:await leaseView(serviceLock),
      fixture:await leaseView(projectLock),owners:await owners()});
  }
}
