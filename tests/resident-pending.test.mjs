// Synthetic resident record shapes; never opens or edits a real project/ledger.
import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{randomUUID}from'node:crypto';
import{setup,app}from'./helpers.mjs';import{Store,atomicJson,canonical,digest,readJson}from'../dist/storage.js';import{fileIdentity}from'../dist/isolation.js';import{assessPending,related,targetFiles}from'../dist/pending-impact.js';import{residentHash}from'../dist/resident.js';import{EngineeringService}from'../dist/service.js';import{FixtureAdapter}from'../dist/fixture-adapter.js';
const nativePid=2147000030,ownerPid=2147000031,identity=pid=>({version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid,startId:String(pid)});
async function fixture(t){
 const env=await setup(),store=new Store(env.dataDir),f=await fileIdentity(env.source),other=path.join(env.dir,'independent.json');await fs.copyFile(env.source,other);
 const s={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:env.source,workingPath:env.source,directPath:env.source,storageMode:'direct',editMode:'direct',sessionMode:'resident',sourceHash:f.sha256,diskHash:f.sha256,applicationId:app,applications:[{applicationId:app,path:['Device','Application']}]};
 await store.put('registry.json',{version:2,revision:1,activeProjectId:s.projectId,projects:[s]});
 const launchId=randomUUID(),root=store.file('resident/'+launchId),put=async(n,v)=>atomicJson(path.join(root,n),v),native=identity(nativePid),owner=identity(ownerPid),small={pid:native.pid,startId:native.startId},rows=[];
 const leases=[{path:store.file('service.lock'),sha256:'a'.repeat(64)},{path:store.sourceLock(env.source),sha256:'b'.repeat(64)}];
 for(let sequence=1;sequence<=2;sequence++){
  const operationId=randomUUID(),requestId=randomUUID(),tool=sequence===1?'project_open':'project_build',command=sequence===1?'inspect':'build',status=sequence===1?'succeeded':'unknown';
  const args=sequence===1?{requestId,sessionMode:'resident',projectPath:env.source,applicationId:app}:{requestId,projectId:s.projectId,applicationId:app,expectedResidentVersion:'c'.repeat(64)};
  const ipc=store.file('ipc/'+operationId),op={schemaVersion:1,operationId,requestId,tool,args,fingerprint:digest(canonical({tool,args})),status,resident:true,project:s,ownerPid,ownerIdentity:owner,startedAt:'2026-11-26T14:00:00Z',finishedAt:'2026-11-26T14:01:00Z',bridge:{directory:ipc,pid:nativePid,launchId},dispatchFiles:[f]};
  const req={operationId,requestId,requestFingerprint:op.fingerprint,command,projectPath:env.source,args:{...args,residentLeases:leases},directory:ipc,launchId,sequence,diskHash:f.sha256,fileIdentity:f.fileId,deadlineUtc:'2026-11-26T14:03:00Z',leases};
  const e={launchId,sequence,requestHash:residentHash(req),processIdentity:small,requestCompleted:true,ideExitRequested:false};
  const result={contractVersion:'1.0.0',operationId,requestId,status,summary:'synthetic original record',data:{residentEvidence:e,...(sequence===2?{firstError:{dispatched:true,message:'original compiler conservation failure'}}:{})}};op.response=result;
  await store.saveOp(op);await atomicJson(path.join(ipc,'request.json'),req);await put(`request-${sequence}.json`,req);await atomicJson(path.join(ipc,'result.json'),result);
  await atomicJson(path.join(ipc,'request-entered.json'),{launchId,requestHash:e.requestHash,processIdentity:small});
  await atomicJson(path.join(ipc,'completed.json'),{launchId,sequence,processIdentity:small,requestHash:e.requestHash,resultHash:residentHash(result)});
  await atomicJson(path.join(ipc,'service-verification.json'),{passed:true,launchId,sequence,requestHash:e.requestHash,resultHash:residentHash(result),processIdentity:native,processState:'running',exitRequiredForRequest:false,diskHash:f.sha256});
  await atomicJson(path.join(ipc,'before.json'),{diskHash:f.sha256,state:{projectPath:env.source,projectHandle:0,openedProjects:{'0':{handle:0,path:env.source,primary:true,library:false}}}});
  rows.push({op,req,result,ipc});
 }
 await put('intent.json',{directory:root,projectPath:env.source,originalFileId:f.fileId,launchId,corePath:path.join(env.dir,'resident_core.py'),coreHash:'d'.repeat(64),scriptHash:'e'.repeat(64)});
 await put('process-start.json',{launchId,processIdentity:native,entry:path.join(env.dir,'resident_host.py'),coreHash:'d'.repeat(64),scriptHash:'e'.repeat(64)});
 await put('entry.json',{pid:nativePid,scriptSha256:'e'.repeat(64)});await put('modules-loaded.json',{launchId,processIdentity:small,coreHash:'d'.repeat(64)});
 await put('ready.json',{launchId,processIdentity:small,state:{startup:false}});await put('receiver-stopped.json',{completed:2,ideExitRequested:false,projectClosed:false,firstError:null});
 await put('process-exit.json',{launchId,pid:nativePid,processIdentity:native,code:0,signal:null,lastSequence:2,at:'2026-11-27T01:00:00Z'});
 const c={env,store,s,other,root,rows,put,native,owner,launchId,probe:async()=>({state:'exited'})};c.op=rows[1].op;c.ipc=rows[1].ipc;
 c.mutate=async(file,fn)=>{const v=await readJson(file);fn(v);await atomicJson(file,v);};
 c.assess=()=>assessPending(store,{probe:c.probe});return c;
}
async function tree(root){const rows=[];for(const e of await fs.readdir(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isDirectory())rows.push(...await tree(p));else rows.push([p,digest(await fs.readFile(p))]);}return rows.sort();}
test('ended resident unknown: readonly scoped assessment, original project and hardlink blocked, unrelated target allowed',async t=>{
 const c=await fixture(t),before=await tree(c.env.dataDir),a=await c.assess();assert.equal(a.globalFrozen,false,JSON.stringify(a.impacts));assert.equal(a.impacts[0].scope,'project');
 assert.equal(related(a.impacts,undefined,await targetFiles([c.other])).length,0);assert.equal(related(a.impacts,undefined,await targetFiles([c.env.source])).length,1);
 const alias=path.join(c.env.dir,'hardlink.json');await fs.link(c.env.source,alias);assert.equal(related(a.impacts,undefined,await targetFiles([alias])).length,1);
 assert.deepEqual(await tree(c.env.dataDir),before);assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});
test('service production guard blocks original and permits unrelated without modifying history',async t=>{
 const c=await fixture(t),service=new EngineeringService({dataDir:c.env.dataDir,testMode:true},new FixtureAdapter());service.pendingOptions.probe=c.probe;
 const before=await tree(c.env.dataDir);await service.guardPending('project_open',{projectPath:c.other});
 await assert.rejects(()=>service.guardPending('project_open',{projectPath:c.env.source}),e=>e.code==='PENDING_UNKNOWN');
 assert.deepEqual(await tree(c.env.dataDir),before);
});
const edits={
 'missing launch exit':c=>fs.unlink(path.join(c.root,'process-exit.json')),
 'nonzero exit':c=>c.mutate(path.join(c.root,'process-exit.json'),v=>v.code=1),
 'exit signal':c=>c.mutate(path.join(c.root,'process-exit.json'),v=>v.signal='SIGTERM'),
 'wrong exit creation identity':c=>c.mutate(path.join(c.root,'process-exit.json'),v=>v.processIdentity.startId='9'),
 'wrong launch':c=>c.mutate(path.join(c.root,'intent.json'),v=>v.launchId=randomUUID()),
 'wrong project':c=>c.mutate(path.join(c.root,'intent.json'),v=>v.projectPath=c.other),
 'wrong file identity':c=>c.mutate(path.join(c.root,'intent.json'),v=>v.originalFileId='123:456'),
 'disk bytes changed':c=>fs.appendFile(c.env.source,' '),
 'request fingerprint changed':c=>c.mutate(path.join(c.ipc,'request.json'),v=>v.requestFingerprint='0'.repeat(64)),
 'request args changed':c=>c.mutate(path.join(c.ipc,'request.json'),v=>v.args.expectedResidentVersion='0'.repeat(64)),
 'wrong request directory':c=>c.mutate(path.join(c.ipc,'request.json'),v=>v.directory=c.root),
 'wrong project in request':c=>c.mutate(path.join(c.ipc,'request.json'),v=>v.projectPath=c.other),
 'duplicate sequence':c=>c.mutate(path.join(c.ipc,'request.json'),v=>v.sequence=1),
 'missing earlier queue':c=>fs.unlink(path.join(c.root,'request-1.json')),
 'extra queue':c=>c.put('request-3.json',{}),
 'nested prior operation request':c=>atomicJson(path.join(c.rows[0].ipc,'other','request.json'),c.rows[0].req),
 'modified queue':c=>c.mutate(path.join(c.root,'request-2.json'),v=>v.diskHash='a'.repeat(64)),
 'missing completion':c=>fs.unlink(path.join(c.ipc,'completed.json')),
 'wrong completion hash':c=>c.mutate(path.join(c.ipc,'completed.json'),v=>v.resultHash='0'.repeat(64)),
 'wrong service hash':c=>c.mutate(path.join(c.ipc,'service-verification.json'),v=>v.requestHash='0'.repeat(64)),
 'service proof missing':c=>fs.unlink(path.join(c.ipc,'service-verification.json')),
 'wrong native entry':c=>c.mutate(path.join(c.ipc,'request-entered.json'),v=>v.processIdentity.startId='9'),
 'missing module sidecar':c=>fs.unlink(path.join(c.root,'modules-loaded.json')),
 'module hash differs':c=>c.mutate(path.join(c.root,'modules-loaded.json'),v=>v.coreHash='f'.repeat(64)),
 'ready identity differs':c=>c.mutate(path.join(c.root,'ready.json'),v=>v.processIdentity.pid=123),
 'receiver incomplete':c=>c.mutate(path.join(c.root,'receiver-stopped.json'),v=>v.completed=1),
 'exit coverage incomplete':c=>c.mutate(path.join(c.root,'process-exit.json'),v=>v.lastSequence=1),
 'native wrong owned path':c=>c.mutate(path.join(c.ipc,'before.json'),v=>v.state.openedProjects['0'].path=c.other),
 'native extra primary':c=>c.mutate(path.join(c.ipc,'before.json'),v=>v.state.openedProjects['1']={handle:1,path:c.other,primary:true,library:false}),
 'unknown result changed to succeeded':c=>c.mutate(path.join(c.ipc,'result.json'),v=>v.status='succeeded'),
 'owner identity missing':async c=>{delete c.op.ownerIdentity;await c.store.saveOp(c.op);},
 'operation wrong project':async c=>{c.op.project={...c.op.project,workingPath:c.other};await c.store.saveOp(c.op);},
 'duplicate request ledger':async c=>{await c.store.saveOp({...c.op,operationId:randomUUID()});},
 'former successful row modified':async c=>{const o=c.rows[0].op;o.args.applicationId=randomUUID();await c.store.saveOp(o);},
 'unconfirmed still-running ledger':async c=>{c.op.status='running';delete c.op.response;await c.store.saveOp(c.op);},
};
for(const[name,fn]of Object.entries(edits))test('global stop without rewrite: '+name,async t=>{const c=await fixture(t);await fn(c);const before=await tree(c.env.dataDir),a=await c.assess();assert.equal(a.globalFrozen,true,name);assert.deepEqual(await tree(c.env.dataDir),before);});
for(const who of ['native','owner'])for(const state of ['running','unconfirmed','reused','invalid-identity'])test(who+' process '+state,async t=>{
 const c=await fixture(t),id=c[who];c.probe=async pid=>pid!==id.pid?{state:'exited'}:state==='unconfirmed'?{state:'unconfirmed',reason:'missing'}:{state:'running',identity:{...id,...(state==='reused'?{startId:'999'}:state==='invalid-identity'?{startId:'new'}:{})}};
 assert.equal((await c.assess()).globalFrozen,state!=='reused');
});
test('late result evidence change during assessment stays global',async t=>{
 const c=await fixture(t);let checks=0;c.probe=async pid=>{if(pid===nativePid&&++checks===2)await c.mutate(path.join(c.ipc,'completed.json'),v=>v.resultHash='0'.repeat(64));return{state:'exited'};};assert.equal((await c.assess()).globalFrozen,true);
});
test('late extra queue during final process observation stays global',async t=>{
 const c=await fixture(t);let checks=0;c.probe=async pid=>{if(pid===nativePid&&++checks===3)await c.put('request-3.json',{});return{state:'exited'};};assert.equal((await c.assess()).globalFrozen,true);
});
test('same request returns original unknown without re-dispatch or changed finish time',async t=>{
 const c=await fixture(t),adapter=new FixtureAdapter();let dispatch=0;adapter.execute=async()=>{dispatch++;throw Error('must not dispatch');};const service=new EngineeringService({dataDir:c.env.dataDir,testMode:true},adapter),before=await tree(c.env.dataDir);
 t.after(()=>service.store.release());assert.deepEqual(await service.call(c.op.tool,c.op.args),c.op.response);assert.equal(dispatch,0);
 // A normal service call acquires its own lease. It does not rewrite history.
 await service.store.release();assert.deepEqual(await tree(c.env.dataDir),before);
});
