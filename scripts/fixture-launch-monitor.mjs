// Independent IDE fixture monitor. It never kills, retries, or resumes a child.
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Store} from '../dist/storage.js';
import {assertNotIsolated,isolationState} from '../dist/isolation.js';
import {probeProcess} from '../dist/lease-process.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const timestamp=()=>new Date().toISOString();
export async function monitorFixture(options) {
  const {dataDir,target,exe,profile,script,result,out,deadlineMs,buildRoot,buildCommit,spawnFn=spawn,probeFn=probeProcess,
    store=new Store(dataDir),checkIsolation=assertNotIsolated,getIsolationState=isolationState,read=fs.readFile}=options;
  await fs.mkdir(out,{recursive:true});
  const events=await fs.open(path.join(out,'launcher-events.jsonl'),'ax');
  let seq=0,child,childEnd,childDone=false,lease=false,timedOut=false,timeout,exit,spawnError,final,deadlineWrite=Promise.resolve();
  const event=async(stage,details={})=>{const row={seq:++seq,at:timestamp(),stage,...details};await events.writeFile(JSON.stringify(row)+'\n');await events.sync();return row;};
  const inspectResult=async()=>{try{return JSON.parse(await read(result,'utf8'));}catch{return null;}};
  const publicationComplete=async()=>{
    const names=(await fs.readdir(out)).filter(x=>/^native-phase-\d+\.json$/.test(x)).sort();
    for(const name of names){
      try{const phase=JSON.parse(await fs.readFile(path.join(out,name),'utf8'));
        if(phase.stage==='result-publish'&&phase.status==='succeeded'&&phase.target===target)return true;
      }catch{/* An unreadable phase cannot prove publication. */}
    }
    return false;
  };
  try {
    await event('before-acquire',{dataDir,target,targetSha256:sha(await read(target)),buildRoot,buildCommit,
      workerSha256:buildRoot?sha(await read(path.join(buildRoot,'bridge/worker.py'))):null,exe,
      exeSha256:sha(await read(exe)),profile,script,scriptSha256:sha(await read(script)),result,deadlineMs});
    const isolated=await getIsolationState(store),covered=new Set(isolated.own.flatMap(e=>e.plan.operationIds));
    const pending=(await store.operations()).filter(o=>(o.status==='unknown'||o.status==='running')&&!covered.has(o.operationId));
    if(pending.length)throw Error('uncovered pending operations: '+pending.map(o=>o.operationId).join(','));
    await checkIsolation(store,undefined,[target]);
    await store.acquire(target);lease=true;await event('lease-acquired');
    const args=[`--profile="${profile}"`,`--runscript="${script.replaceAll('\\','/')}"`];
    const env={...process.env,FIXTURE_TARGET:target,FIXTURE_RESULT:result,FIXTURE_PHASE_DIR:out};
    const streams=await Promise.all(['stdout','stderr'].map(x=>fs.open(path.join(out,x+'.txt'),'ax')));
    try {child=spawnFn(exe,args,{cwd:path.dirname(exe),windowsHide:true,windowsVerbatimArguments:true,shell:false,
      stdio:['ignore','pipe','pipe'],env});}
    catch(e){await event('spawn-failed',{error:String(e)});for(const file of streams)await file.close();throw e;}
    childEnd=new Promise(resolve=>{child.once('error',e=>{spawnError=String(e);resolve({kind:'error',error:spawnError});});
      child.once('exit',(code,signal)=>resolve({kind:'exit',code,signal}));});
    const writes=[Promise.resolve(),Promise.resolve()];
    for(const [i,channel] of ['stdout','stderr'].entries())if(child[channel])
      child[channel].on('data',b=>{writes[i]=writes[i].then(()=>streams[i].write(b)).then(()=>streams[i].sync());});
    await event('child-created',{pid:child.pid??null,args,cwd:path.dirname(exe)});
    const identity=child.pid?await probeFn(child.pid).catch(e=>({state:'unconfirmed',reason:String(e)})):
      {state:'unconfirmed',reason:'spawn-returned-no-pid'};
    await event('child-identity',{pid:child.pid,observation:identity});
    timeout=setTimeout(()=>{timedOut=true;deadlineWrite=inspectResult().then(r=>
      event('observation-deadline',{pid:child.pid,resultPresent:!!r}));},deadlineMs);
    exit=await childEnd;childDone=true;clearTimeout(timeout);
    await deadlineWrite;
    await event(exit.kind==='exit'?'child-exit':'child-error',{pid:child.pid,...exit});
    await Promise.all(writes);
    for(const file of streams){await file.sync();await file.close();}
    const native=await inspectResult(),published=await publicationComplete();
    await event('result-inspected',{present:!!native,passed:native?.passed===true,published,stages:native?.stages??null});
    final={capturedAt:timestamp(),pid:child.pid,identity,exit,timedOut,
      nativeResultPresent:!!native,nativePassed:native?.passed===true,nativePublicationComplete:published,
      targetSha256:sha(await read(target)),
      status:spawnError?'spawn-error':identity.state!=='running'?'identity-unconfirmed':!native?'no-native-result':!published?'incomplete-native-publication':timedOut?'late-result':
        exit.kind==='exit'&&exit.code===0&&native.passed===true?'succeeded':'failed'};
    await fs.writeFile(path.join(out,'launcher-summary.json'),JSON.stringify(final,null,2));
    await event('launcher-finished',{status:final.status});
    return final;
  }catch(e){await event('launcher-error',{error:String(e)});
    if(childEnd&&!childDone){await event('awaiting-child-after-launcher-error',{pid:child.pid});
      const ended=await childEnd;childDone=true;await event('child-ended-after-launcher-error',{pid:child.pid,...ended});}
    await fs.writeFile(path.join(out,'launcher-summary.json'),JSON.stringify({capturedAt:timestamp(),status:'launcher-error',error:String(e),pid:child?.pid??null},null,2));throw e;}
  finally{if(timeout)clearTimeout(timeout);if(lease){try{await store.release();await event('lease-released');}catch(e){await event('lease-release-error',{error:String(e)});
      if(final)await fs.writeFile(path.join(out,'launcher-summary.json'),JSON.stringify({...final,status:'lease-release-unknown',releaseError:String(e)},null,2));
      await events.close();throw e;}}await events.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [dataDir,target,exe,profile,script,result,out,deadline,buildRoot,buildCommit]=process.argv.slice(2);
  if(![dataDir,target,exe,profile,script,result,out,deadline,buildRoot,buildCommit].every(Boolean))throw Error('Usage: node fixture-launch-monitor.mjs DATA_DIR TARGET EXE PROFILE SCRIPT RESULT OUT DEADLINE_MS BUILD_ROOT BUILD_COMMIT');
  const r=await monitorFixture({dataDir,target,exe,profile,script,result,out,deadlineMs:Number(deadline),buildRoot,buildCommit});
  console.log(JSON.stringify(r));if(r.status!=='succeeded')process.exitCode=1;
}
