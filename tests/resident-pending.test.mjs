// Synthetic resident record shapes; never opens or edits a real project/ledger.
import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{randomUUID}from'node:crypto';
import{setup,app}from'./helpers.mjs';import{Store,atomicJson,canonical,digest,readJson}from'../dist/storage.js';import{fileIdentity}from'../dist/isolation.js';import{assessPending,related,targetFiles}from'../dist/pending-impact.js';import{residentHash}from'../dist/resident.js';import{EngineeringService}from'../dist/service.js';import{FixtureAdapter}from'../dist/fixture-adapter.js';
import{verifyClosedResident}from'../dist/resident-reopen.js';
import{residentDependencies,residentObject,verifyResidentResult}from'../dist/resident.js';
import{callAndWait}from'./operation-wait.mjs';
const nativePid=2147000030,ownerPid=2147000031,identity=pid=>({version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid,startId:String(pid)});
async function fixture(t,{early=false}={}){
 const env=await setup(),store=new Store(env.dataDir),f=await fileIdentity(env.source),other=path.join(env.dir,'independent.json');await fs.copyFile(env.source,other);
 const s={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:env.source,workingPath:env.source,directPath:env.source,storageMode:'direct',editMode:'direct',sessionMode:'resident',sourceHash:f.sha256,diskHash:f.sha256,applicationId:app,applications:[{applicationId:app,path:['Device','Application']}]};
 await store.put('registry.json',{version:2,revision:1,activeProjectId:early?null:s.projectId,projects:early?[]:[s]});
 const launchId=randomUUID(),root=store.file('resident/'+launchId),put=async(n,v)=>atomicJson(path.join(root,n),v),native=identity(nativePid),owner=identity(ownerPid),small={pid:native.pid,startId:native.startId},rows=[];
 const leases=[{path:store.file('service.lock'),sha256:'a'.repeat(64)},{path:store.sourceLock(env.source),sha256:'b'.repeat(64)}];
 for(let sequence=1;sequence<=(early?1:2);sequence++){
  const operationId=randomUUID(),requestId=randomUUID(),tool=sequence===1?'project_open':'project_build',command=sequence===1?'inspect':'build',status=early?'unknown':sequence===1?'succeeded':'unknown';
  const args=sequence===1?{requestId,sessionMode:'resident',projectPath:env.source,applicationId:app}:{requestId,projectId:s.projectId,applicationId:app,expectedResidentVersion:'c'.repeat(64)};
  const ipc=store.file('ipc/'+operationId),op={schemaVersion:1,operationId,requestId,tool,args,fingerprint:digest(canonical({tool,args})),status,resident:true,project:s,ownerPid,ownerIdentity:owner,startedAt:'2026-11-26T14:00:00Z',finishedAt:'2026-11-26T14:01:00Z',bridge:{directory:ipc,pid:nativePid,launchId},dispatchFiles:[f]};
  if(early)op.activation={revision:1,previousActiveProjectId:null};
  const req={operationId,requestId,requestFingerprint:op.fingerprint,command,projectPath:env.source,args:{...args,residentLeases:leases},directory:ipc,launchId,sequence,diskHash:f.sha256,fileIdentity:f.fileId,deadlineUtc:'2026-11-26T14:03:00Z',leases};
  const e={launchId,sequence,requestHash:residentHash(req),processIdentity:small,requestCompleted:true,ideExitRequested:false};
  const result={contractVersion:'1.0.0',operationId,requestId,status,summary:'synthetic original record',data:{residentEvidence:e,...(early?{firstError:{dispatched:false,type:'ImportError',message:'No module named _3S.CoDeSys.Core'},secondaryErrors:[],recoverableRejection:false,saved:false,closed:false,reopened:false}:sequence===2?{firstError:{dispatched:true,message:'original compiler conservation failure'}}:{})}};op.response=result;
  await store.saveOp(op);await atomicJson(path.join(ipc,'request.json'),req);await put(`request-${sequence}.json`,req);await atomicJson(path.join(ipc,'result.json'),result);
  await atomicJson(path.join(ipc,'request-entered.json'),{launchId,requestHash:e.requestHash,processIdentity:small});
  await atomicJson(path.join(ipc,'completed.json'),{launchId,sequence,processIdentity:small,requestHash:e.requestHash,resultHash:residentHash(result)});
  await atomicJson(path.join(ipc,'service-verification.json'),{passed:true,launchId,sequence,requestHash:e.requestHash,resultHash:residentHash(result),processIdentity:native,processState:'running',exitRequiredForRequest:false,diskHash:f.sha256});
  if(!early)await atomicJson(path.join(ipc,'before.json'),{diskHash:f.sha256,state:{projectPath:env.source,projectHandle:0,openedProjects:{'0':{handle:0,path:env.source,primary:true,library:false}}}});
  rows.push({op,req,result,ipc});
 }
 await put('intent.json',{directory:root,projectPath:env.source,originalFileId:f.fileId,launchId,corePath:path.join(env.dir,'resident_core.py'),coreHash:'d'.repeat(64),scriptHash:'e'.repeat(64)});
 await put('process-start.json',{launchId,processIdentity:native,entry:path.join(env.dir,'resident_host.py'),coreHash:'d'.repeat(64),scriptHash:'e'.repeat(64)});
 await put('entry.json',{pid:nativePid,scriptSha256:'e'.repeat(64)});await put('modules-loaded.json',{launchId,processIdentity:small,coreHash:'d'.repeat(64)});
 await put('ready.json',{launchId,processIdentity:small,state:{startup:false}});await put('receiver-stopped.json',{completed:rows.length,ideExitRequested:false,projectClosed:false,firstError:null});
 await put('process-exit.json',{launchId,pid:nativePid,processIdentity:native,code:0,signal:null,lastSequence:rows.length,at:'2026-11-27T01:00:00Z'});
 const c={env,store,s,other,root,rows,put,native,owner,launchId,probe:async()=>({state:'exited'})};c.op=rows.at(-1).op;c.ipc=rows.at(-1).ipc;
 c.mutate=async(file,fn)=>{const v=await readJson(file);fn(v);await atomicJson(file,v);};
 c.assess=()=>assessPending(store,{probe:c.probe});return c;
}
async function tree(root){const rows=[];for(const e of await fs.readdir(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isDirectory())rows.push(...await tree(p));else rows.push([p,digest(await fs.readFile(p))]);}return rows.sort();}

test('first read before snapshot: normal exit, unchanged disk and dispatched=false do not invent ownership or reopen',async t=>{
 const c=await fixture(t,{early:true}),before=await tree(c.env.dataDir),a=await c.assess();
 assert.equal(a.globalFrozen,true);assert.match(a.impacts[0].reason,/early read evidence coverage incomplete/);
 const service=new EngineeringService({dataDir:c.env.dataDir,testMode:true},new FixtureAdapter());service.pendingOptions.probe=c.probe;
 await assert.rejects(()=>service.guardPending('project_open',{projectPath:c.env.source,sessionMode:'resident'}),e=>e.code==='PENDING_UNKNOWN');
 await assert.rejects(()=>verifyClosedResident(c.store,c.s,randomUUID(),c.probe),e=>e.code==='RESIDENT_RECONNECT_UNSUPPORTED');
 assert.deepEqual(await tree(c.env.dataDir),before);
 assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});

test('future early ownership receipt alone does not implement an unknown reopening authorization',async t=>{
 const c=await fixture(t,{early:true}),row={handle:0,path:c.env.source,library:false,primary:true};
 await atomicJson(path.join(c.ipc,'ownership-0001.json'),{scheme:'resident-public-ownership-v1',raw:{returned:row,primary:row,all:[row],readErrors:[]},nativeValidation:{passed:true,error:null}});
 const before=await tree(c.env.dataDir);assert.equal((await c.assess()).globalFrozen,true);
 assert.deepEqual(await tree(c.env.dataDir),before);
});

async function readyEarly(t){
 const c=await fixture(t,{early:true}),r=c.rows[0],small={pid:c.native.pid,startId:c.native.startId},p={handle:0,path:c.env.source,primary:true,library:false};
 const ownership={scheme:'resident-public-ownership-v1',ordinal:1,operationId:c.op.operationId,requestId:c.op.requestId,launchId:c.launchId,sequence:1,requestHash:residentHash(r.req),processIdentity:small,projectPath:c.env.source,scriptHash:'e'.repeat(64),coreHash:'d'.repeat(64),projectHandle:0,attempts:{open:1,read:1,replace:0,build:0},raw:{returned:p,primary:p,all:[p],readErrors:[]},nativeValidation:{passed:true,error:null}};
 r.result.data.firstError.phase='initial-snapshot';
 r.result.data.residentEvidence.ownershipRecords=[{name:'ownership-0001.json',sha256:residentHash(ownership)}];
 await atomicJson(path.join(c.ipc,'ownership-0001.json'),ownership);await atomicJson(path.join(c.ipc,'first-error.json'),r.result.data.firstError);
 c.refresh=async()=>{
  c.op.response=r.result;await c.store.saveOp(c.op);await atomicJson(path.join(c.ipc,'result.json'),r.result);await atomicJson(path.join(c.ipc,'first-error.json'),r.result.data.firstError);
  await c.mutate(path.join(c.ipc,'completed.json'),x=>x.resultHash=residentHash(r.result));
  await c.mutate(path.join(c.ipc,'service-verification.json'),x=>x.resultHash=residentHash(r.result));
 };
 await c.refresh();const runId=randomUUID();c.shutdown=c.store.file('service-lifecycle/'+runId);
 const events=[['shutdown-requested',{reason:'stdin-end'}],['observations-settled',{}],['lease-retained',{reason:'unknown retained'}],['shutdown-completed',{errorCount:0,operationSuccessNotImplied:true}]];
 for(let i=0;i<events.length;i++){
  const [event,data]=events[i],value={binding:{runId,pid:c.owner.pid,processIdentity:c.owner},ordinal:i+1,observedAt:'2026-11-27T02:00:0'+i+'Z',event,data};
  await atomicJson(path.join(c.shutdown,String(i+1).padStart(6,'0')+'-'+event+'.json'),{schemaVersion:1,value,checksum:digest(canonical(value))});
 }
 return c;
}

test('complete early readonly failure: new explicit open, following read and changed memory retain old unknown bytes',async t=>{
 const c=await readyEarly(t),before=await tree(c.ipc),oldLedger=await fs.readFile(c.store.file('operations/'+c.op.operationId+'.json'));
 const a=await c.assess();assert.equal(a.globalFrozen,false,JSON.stringify(a.impacts));assert.ok(a.impacts[0].earlyProof);
 const APP=app,OBJ='20000000-0000-4000-8000-000000000001',ST='3b83b776-fb25-43b8-99f2-3c507c9143fc',POU='6f9dac99-8de1-4efc-8465-68ac443b7d08';
 const node=(id,parent,name,typ,d,i)=>({objectId:id,applicationId:APP,parentId:parent,path:parent?['Application',name]:['Application'],nativeTypeId:typ,declaration:d,implementation:i,embeddedObjectTypes:i===null?[]:[ST]});
 const state={projectPath:c.env.source,projectHandle:0,thread:1,applications:[APP],openedProjects:{'0':{handle:0,path:c.env.source,primary:true,library:false}},nodes:{[APP]:node(APP,null,'Application',APP,null,null),[OBJ]:node(OBJ,APP,'Logic',POU,'PROGRAM Logic\nVAR\nx:DINT;\nEND_VAR','x := 1;')}};
 let owned=false,seq=0,writes=0;const launch=randomUUID(),native=identity(2147000032),requests=[];
 const adapter={residentOwned:()=>owned,execute:()=>{throw Error('No batch');},executeResident:async(input,dir,onLaunch)=>{
  owned=true;await onLaunch(native.pid,launch);const f=await fileIdentity(input.projectPath);
  const req={...input,launchId:launch,sequence:++seq,directory:dir,diskHash:f.sha256,fileIdentity:f.fileId,leases:input.args.residentLeases};requests.push(req);
  const put=(n,v)=>atomicJson(path.join(dir,n),v),old=structuredClone(state),dep=residentDependencies(old),version=residentHash({dependencies:dep,diskHash:f.sha256});
  await put('request.json',req);await put('before.json',{state:old,diskHash:f.sha256});
  const data={applications:[{applicationId:APP,path:['Application']}],applicationId:APP,projectPath:f.path,projectHandle:0,snapshot:residentHash(dep),residentVersion:version,diskHash:f.sha256,sessionMode:'resident',saved:false,closed:false,reopened:false,saveCalls:0,closeCalls:0,exitCalls:0,compileCalls:0};
  if(req.command==='change'){
   await put('checkpoint.json',{request:req,state:old,diskHash:f.sha256,residentVersion:version});await put('predispatch.json',{state:old,diskHash:f.sha256});await put('dispatch.json',{operationId:req.operationId,requestId:req.requestId,action:'replace-implementation'});
   state.nodes[OBJ].implementation=req.args.implementation;writes++;const actual=residentDependencies(state);
   await put('after.json',{state,diskHash:f.sha256});await put('verification.json',{equal:true,expected:actual,actual});
   Object.assign(data,{snapshot:residentHash(actual),residentVersion:residentHash({dependencies:actual,diskHash:f.sha256}),memoryModified:true,persistedToProject:false});
  }
  if(req.command==='read'||req.command==='change')Object.assign(data,residentObject(state,OBJ,APP));
  data.residentEvidence={launchId:launch,sequence:seq,processIdentity:{pid:native.pid,startId:native.startId},requestHash:residentHash(req),requestCompleted:true,ideExitRequested:false};
  const result={contractVersion:'1.0.0',operationId:req.operationId,requestId:req.requestId,status:'succeeded',summary:'offline producer',data};
  await put('result.json',result);await put('completed.json',{launchId:launch,sequence:seq,processIdentity:data.residentEvidence.processIdentity,requestHash:residentHash(req),resultHash:residentHash(result)});
  await verifyResidentResult(req,result,dir,native);
  await put('service-verification.json',{passed:true,launchId:launch,sequence:seq,requestHash:residentHash(req),resultHash:residentHash(result),processIdentity:native,processState:'running',exitRequiredForRequest:false,diskHash:f.sha256});return result;
 }};
 const service=new EngineeringService({dataDir:c.env.dataDir,testMode:true,responseWaitMs:20},adapter,{probe:c.probe});t.after(()=>service.store.release());
 const call=(tool,args)=>callAndWait(service,tool,args);
 const opened=await call('project_open',{requestId:randomUUID(),projectPath:c.env.source,sessionMode:'resident',applicationId:APP});assert.equal(opened.status,'succeeded',JSON.stringify(opened));
 const target={projectId:opened.data.session.projectId,applicationId:APP,objectId:OBJ};
 const read=await call('object_read',target);assert.equal(read.status,'succeeded',JSON.stringify(read));
 const changed=await call('code_apply_change',{...target,requestId:randomUUID(),expectedHash:read.data.contentHash,expectedResidentVersion:read.data.residentVersion,declaration:read.data.declaration,implementation:'x := 7; // explicit new-session edit'});assert.equal(changed.status,'succeeded',JSON.stringify(changed));
 const reread=await call('object_read',target);assert.equal(reread.status,'succeeded',JSON.stringify(reread));assert.equal(reread.data.implementation,changed.data.implementation);
 assert.equal(writes,1);assert.deepEqual(requests.map(r=>r.command),['inspect','read','change','read']);
 assert.deepEqual(await tree(c.ipc),before);assert.deepEqual(await fs.readFile(c.store.file('operations/'+c.op.operationId+'.json')),oldLedger);
 assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');assert.notEqual(opened.data.session.sessionId,c.s.sessionId);
 const successorBefore=c.store.file('ipc/'+opened.operationId+'/before.json'),savedBefore=await fs.readFile(successorBefore);
 for(const defect of ['missing','corrupt-owned-path']){
  if(defect==='missing')await fs.unlink(successorBefore);
  else {const bad=JSON.parse(savedBefore);bad.state.openedProjects['0'].path=c.other;await atomicJson(successorBefore,bad);}
  assert.equal((await c.assess()).globalFrozen,true,defect);
  await assert.rejects(()=>service.guardPending('object_read',target),e=>e.code==='PENDING_UNKNOWN');
  await fs.writeFile(successorBefore,savedBefore);
 }
 // Subsequent disk changes are guarded by the CURRENT resident session. The
 // ended historical unknown must not become a global freeze again.
 await fs.appendFile(c.env.source,'user changed disk after handoff');
 const changedDisk=await c.assess();assert.equal(changedDisk.globalFrozen,false,JSON.stringify(changedDisk.impacts));assert.ok(changedDisk.impacts[0].continuedBy);
 await service.guardPending('object_read',target);
 await assert.rejects(()=>service.guardPending('project_open',{requestId:randomUUID(),projectPath:c.env.source,sessionMode:'resident'}),e=>e.code==='PENDING_UNKNOWN');
 await service.guardPending('project_open',{requestId:randomUUID(),projectPath:c.other,sessionMode:'resident'});
 assert.equal(requests.length,4,'assessment never sends an engineering request');
 assert.deepEqual(await tree(c.ipc),before);assert.deepEqual(await fs.readFile(c.store.file('operations/'+c.op.operationId+'.json')),oldLedger);
});

for(const [name,edit] of Object.entries({
 'invalid native handle':c=>c.mutate(path.join(c.ipc,'ownership-0001.json'),v=>v.projectHandle=9),
 'wrong native path':c=>c.mutate(path.join(c.ipc,'ownership-0001.json'),v=>v.raw.returned.path=c.other),
 'extra native engineering project':c=>c.mutate(path.join(c.ipc,'ownership-0001.json'),v=>v.raw.all.push({handle:8,path:c.other,library:false,primary:false})),
 'missing ownership':c=>fs.unlink(path.join(c.ipc,'ownership-0001.json')),
 'write attempt':c=>c.mutate(path.join(c.ipc,'ownership-0001.json'),v=>v.attempts.replace=1),
 'build attempt':c=>c.mutate(path.join(c.ipc,'ownership-0001.json'),v=>v.attempts.build=1),
 'ownership read failed':c=>c.mutate(path.join(c.ipc,'ownership-0001.json'),v=>v.raw.readErrors.push({error:'failed'})),
 'extra dispatch marker':c=>atomicJson(path.join(c.ipc,'dispatch.json'),{action:'change'}),
 'missing completed shutdown':c=>fs.unlink(path.join(c.shutdown,'000004-shutdown-completed.json')),
 'service shutdown reports error':async c=>{const file=path.join(c.shutdown,'000004-shutdown-completed.json'),r=await readJson(file);r.value.data.errorCount=1;r.checksum=digest(canonical(r.value));await atomicJson(file,r);},
 'service signal shutdown':async c=>{const file=path.join(c.shutdown,'000001-shutdown-requested.json'),r=await readJson(file);r.value.data.reason='SIGTERM';r.checksum=digest(canonical(r.value));await atomicJson(file,r);},
 'service still active':async c=>{c.probe=async pid=>pid===c.owner.pid?{state:'running',identity:c.owner}:{state:'exited'};},
 'native stop evidence':c=>c.put('stop.json',{reason:'uncertain'}),
 'second launch request':c=>c.put('request-2.json',{command:'build'}),
 'wrong phase':async c=>{c.rows[0].result.data.firstError.phase='snapshot-returned';await c.refresh();},
 'secondary publication failure':async c=>{c.rows[0].result.data.secondaryErrors=[{message:'publish failed'}];await c.refresh();},
 'nonzero IDE exit':c=>c.mutate(path.join(c.root,'process-exit.json'),v=>v.code=1),
 'missing IDE exit':c=>fs.unlink(path.join(c.root,'process-exit.json')),
 'file changed':c=>fs.appendFile(c.env.source,'changed'),
 'unknown registration instead of verified successor':async c=>c.store.put('registry.json',{version:2,revision:2,activeProjectId:c.s.projectId,projects:[{...c.s,sessionId:randomUUID()}]}),
}))test('early fresh open refuses '+name+' without historical rewrite',async t=>{
 const c=await readyEarly(t);await edit(c);
 const ownership=await readJson(path.join(c.ipc,'ownership-0001.json'));
 if(ownership){c.rows[0].result.data.residentEvidence.ownershipRecords[0].sha256=residentHash(ownership);await c.refresh();}
 const before=await tree(c.env.dataDir),a=await c.assess();assert.equal(a.globalFrozen,true,name);
 const adapter=new FixtureAdapter();let dispatch=0;adapter.executeResident=async()=>{dispatch++;throw Error('forbidden');};const service=new EngineeringService({dataDir:c.env.dataDir,testMode:true},adapter,{probe:c.probe});
 await assert.rejects(()=>service.guardPending('project_open',{projectPath:c.env.source,sessionMode:'resident'}),e=>e.code==='PENDING_UNKNOWN');assert.equal(dispatch,0);assert.deepEqual(await tree(c.env.dataDir),before);
});
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
