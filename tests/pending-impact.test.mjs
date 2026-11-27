// Offline fixtures only. No real historical record or native IDE is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setup,app} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {canonical,digest,atomicJson} from '../dist/storage.js';
import {publishProcessEvidence} from '../dist/process-exit.js';
import {assessPending,targetFiles,related} from '../dist/pending-impact.js';
import {probeProcess} from '../dist/lease-process.js';

const gonePid=2147000001;
async function context(t){
 const env=await setup(),other=path.join(env.dir,'independent-B.json');await fs.copyFile(env.source,other);
 const adapter=new FixtureAdapter(),config={dataDir:env.dataDir,testMode:true,responseWaitMs:10000};
 const service=new EngineeringService(config,adapter);t.after(()=>service.store.release());
 const a=await service.call('project_open',{projectPath:env.source,applicationId:app,requestId:'open-A'});assert.equal(a.status,'succeeded');
 const session=a.data.session,id=randomUUID(),requestId=randomUUID(),args={projectId:session.projectId,applicationId:app,requestId,expectedSnapshot:session.snapshot};
 const op={schemaVersion:1,registryVersion:1,operationId:id,requestId,tool:'project_save',args,fingerprint:digest(canonical({tool:'project_save',args})),
  project:session,status:'unknown',ownerPid:gonePid,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),
  response:{contractVersion:'1.0.0',operationId:id,requestId,status:'unknown',summary:'original timeout',error:{code:'IDE_TIMEOUT',message:'original timeout'}},
  bridge:{directory:service.store.file('ipc/'+id),pid:gonePid,launchId:randomUUID()}};
 await fs.mkdir(op.bridge.directory,{recursive:true});
 const request={operationId:id,requestId,requestFingerprint:op.fingerprint,launchId:op.bridge.launchId,exitEvidenceVersion:1,
  command:'save',projectPath:session.workingPath,args,resultPath:path.join(op.bridge.directory,'result.json')};
 await atomicJson(path.join(op.bridge.directory,'request.json'),request);
 const start={binding:{operationId:id,requestId,requestFingerprint:op.fingerprint,launchId:request.launchId,requestHash:digest(canonical(request))},pid:gonePid,
  process:{state:'running',identity:{version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid:gonePid,startId:'123'}},observedAt:new Date().toISOString()};
 await publishProcessEvidence(path.join(op.bridge.directory,'process-start.json'),start);await service.store.saveOp(op);
 const original=await fs.readFile(service.store.file('operations/'+id+'.json'));
 return {env,other,service,adapter,config,op,request,start,original};
}
test('exited unknown A permits independent B without changing A; status and dispatch agree',async t=>{
 const c=await context(t),s=await c.service.status();assert.equal(s.data.globalFrozen,false);assert.equal(s.data.writeFrozen,true);
 const b=await c.service.call('project_open',{projectPath:c.other,applicationId:app,requestId:'open-B'});assert.equal(b.status,'succeeded');
 assert.equal((await c.service.status()).data.writeFrozen,false);
 assert.deepEqual(await fs.readFile(c.service.store.file('operations/'+c.op.operationId+'.json')),c.original);
 assert.equal((await c.service.call('operation_status',{operationId:c.op.operationId})).status,'unknown');
 const list=await c.service.projects();assert.equal(list.data.projects.find(p=>p.projectId===c.op.project.projectId).availability,'unresolved');
 assert.equal(list.data.projects.find(p=>p.projectId===b.data.session.projectId).availability,'available');
});

for(const alias of ['original','hardlink','symlink','registered-id'])test('A still blocked through '+alias,async t=>{
 const c=await context(t);let p=c.env.source;
 if(alias==='hardlink'){p=path.join(c.env.dir,'hardlink-A.json');await fs.link(c.env.source,p);}
 if(alias==='symlink'){p=path.join(c.env.dir,'alias-A.json');await fs.symlink(c.env.source,p,'file');}
 let dispatches=0;c.adapter.execute=async()=>{dispatches++;throw Error('must not dispatch');};
 const tool=alias==='registered-id'?'project_activate':'project_open';
 const args=alias==='registered-id'?{projectId:c.op.project.projectId,requestId:randomUUID()}:{projectPath:p,applicationId:app,requestId:randomUUID()};
 await assert.rejects(()=>c.service.call(tool,args),e=>e.code==='PENDING_UNKNOWN'&&e.status==='conflict');assert.equal(dispatches,0);
 assert.deepEqual(await fs.readFile(c.service.store.file('operations/'+c.op.operationId+'.json')),c.original);
});
for(const state of ['active','unconfirmed','throws','pid-reused'])test('bound native process observation '+state,async t=>{
 const c=await context(t),nativePid=gonePid-1;c.start.pid=nativePid;c.start.process.identity.pid=nativePid;c.op.bridge.pid=nativePid;
 await publishProcessEvidence(path.join(c.op.bridge.directory,'process-start.json'),c.start);await c.service.store.saveOp(c.op);
 const probe=async pid=>{if(pid!==nativePid)return probeProcess(pid);if(state==='throws')throw Error('OS evidence unavailable');return state==='unconfirmed'?{state:'unconfirmed',reason:'OS refused'}:
  {state:'running',identity:{...c.start.process.identity,...(state==='pid-reused'?{startId:'999'}:{})}};};
 const service=c.service;service.pendingOptions.probe=probe;
 const assessment=await assessPending(service.store,{probe});assert.equal(assessment.globalFrozen,state!=='pid-reused');
 if(state==='pid-reused')assert.equal(assessment.impacts[0].scope,'project');
 else {let calls=0;c.adapter.execute=async()=>{calls++;};await assert.rejects(()=>service.call('project_open',{projectPath:c.other,applicationId:app,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');assert.equal(calls,0);}
});
const corruptions={
 'missing start':async c=>fs.unlink(path.join(c.op.bridge.directory,'process-start.json')),
 'damaged start checksum':async c=>atomicJson(path.join(c.op.bridge.directory,'process-start.json'),{schemaVersion:1,checksum:'bad',value:c.start}),
 'wrong launch':async c=>{c.start.binding.launchId=randomUUID();await publishProcessEvidence(path.join(c.op.bridge.directory,'process-start.json'),c.start);},
 'wrong request':async c=>{c.request.requestId=randomUUID();await atomicJson(path.join(c.op.bridge.directory,'request.json'),c.request);},
 'corrupt result':async c=>fs.writeFile(path.join(c.op.bridge.directory,'result.json'),'{'),
 'corrupt exit receipt':async c=>fs.writeFile(path.join(c.op.bridge.directory,'process-exit.json'),'{'),
 'contradictory operation response':async c=>{c.op.response.status='succeeded';await c.service.store.saveOp(c.op);},
 'wrong result identity':async c=>atomicJson(path.join(c.op.bridge.directory,'result.json'),{contractVersion:'1.0.0',operationId:randomUUID(),status:'succeeded',summary:'x'}),
 'owner active without identity':async c=>{c.op.ownerPid=process.pid;await c.service.store.saveOp(c.op);},
 'project missing':async c=>fs.unlink(c.env.source),
 'operation path changed':async c=>{c.op.project={...c.op.project,workingPath:c.other};await c.service.store.saveOp(c.op);},
 'request fingerprint changed':async c=>{c.op.fingerprint='f'.repeat(64);await c.service.store.saveOp(c.op);},
 'missing project binding':async c=>{delete c.op.project;c.op.args.projectId=randomUUID();c.op.fingerprint=digest(canonical({tool:c.op.tool,args:c.op.args}));await c.service.store.saveOp(c.op);},
 'ambiguous request':async c=>{await c.service.store.saveOp({...c.op,operationId:randomUUID()});},
 'invalid dispatch identity':async c=>{c.op.dispatchFiles=[{path:c.env.source,key:c.env.source.toLowerCase(),fileId:null}];await c.service.store.saveOp(c.op);}
};
for(const [name,corrupt] of Object.entries(corruptions))test('global conservative stop: '+name,async t=>{
 const c=await context(t);await corrupt(c);let dispatches=0;c.adapter.execute=async()=>{dispatches++;};
 const s=await c.service.status();assert.equal(s.data.globalFrozen,true,name);
 await assert.rejects(()=>c.service.call('project_open',{projectPath:c.other,applicationId:app,requestId:'blocked-B'}),e=>e.code==='PENDING_UNKNOWN');assert.equal(dispatches,0);
});
test('same request deduplicates to original unknown; does not assess/replay or alter finish time',async t=>{
 const c=await context(t);let calls=0;c.adapter.execute=async()=>{calls++;};
 assert.deepEqual(await c.service.call(c.op.tool,c.op.args),c.op.response);assert.equal(calls,0);
 assert.deepEqual(await fs.readFile(c.service.store.file('operations/'+c.op.operationId+'.json')),c.original);
});
test('damaged operation ledger does not become a scoped exception',async t=>{
 const c=await context(t);await fs.writeFile(c.service.store.file('operations/'+c.op.operationId+'.json'),'{');
 assert.equal((await c.service.status()).status,'unknown');await assert.rejects(()=>c.service.call('project_open',{projectPath:c.other,requestId:'bad',applicationId:app}),e=>e.code==='CORRUPT_RECORD');
});
test('queued successor is conflict/not-dispatched if previous operation becomes unknown',async t=>{
 const env=await setup(),base=new FixtureAdapter(),config={dataDir:env.dataDir,testMode:true,responseWaitMs:5},s=new EngineeringService(config,base);t.after(()=>s.store.release());
 const first=await s.call('project_open',{projectPath:env.source,applicationId:app,requestId:'open'});await s.queue;const session=(await s.store.operation(first.operationId)).response.data.session;
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let calls=0;
 base.execute=async req=>{calls++;entered();await gate;return {contractVersion:'1.0.0',operationId:req.operationId,status:'unknown',summary:'first actual uncertainty'};};
 const args={projectId:session.projectId,applicationId:app,targetKind:'application'};
 const aPromise=s.call('project_structure',args);await started;
 const bPromise=s.call('project_structure',{...args,limit:9});const a=await aPromise,b=await bPromise;assert.equal(b.status,'running');release();await s.queue;
 assert.equal((await s.store.operation(a.operationId)).status,'unknown');const stopped=await s.store.operation(b.operationId);
 assert.equal(stopped.status,'conflict');assert.equal(stopped.response.error.code,'PENDING_UNKNOWN');assert.equal(stopped.bridge,undefined);assert.equal(calls,1);
});
test('changed pending evidence at actual native launch rejects before adapter dispatch',async t=>{
 const c=await context(t),original=c.service.guardPending.bind(c.service);let checks=0,calls=0;
 c.service.guardPending=async(...args)=>{checks++;if(checks===3)await fs.writeFile(path.join(c.op.bridge.directory,'process-start.json'),'{');return original(...args);};
 c.adapter.execute=async()=>{calls++;};
 const b=await c.service.call('project_open',{projectPath:c.other,requestId:'race',applicationId:app});assert.equal(b.status,'conflict');assert.equal(calls,0);assert(checks>=3);
});
test('saved original file identity blocks old hardlink even when original pathname is replaced',async t=>{
 const c=await context(t),oldLink=path.join(c.env.dir,'old-file.json');await fs.link(c.env.source,oldLink);
 c.op.dispatchFiles=await targetFiles([c.env.source]);await c.service.store.saveOp(c.op);
 await fs.unlink(c.env.source);await fs.copyFile(c.other,c.env.source);
 const assessment=await assessPending(c.service.store);assert.equal(assessment.globalFrozen,false);
 assert.equal(related(assessment.impacts,undefined,await targetFiles([oldLink])).length,1);
 await assert.rejects(()=>c.service.call('project_open',{projectPath:oldLink,requestId:'old-alias',applicationId:app}),e=>e.code==='PENDING_UNKNOWN');
});
test('ended historical running record is scoped too; switching does not reintroduce global gate',async t=>{
 const c=await context(t);c.op.status='running';delete c.op.finishedAt;delete c.op.response;await c.service.store.saveOp(c.op);
 const before=await fs.readFile(c.service.store.file('operations/'+c.op.operationId+'.json'));
 assert.equal((await c.service.status()).data.globalFrozen,false);
 const b=await c.service.call('project_open',{projectPath:c.other,applicationId:app,requestId:'new-B'});assert.equal(b.status,'succeeded');
 assert.deepEqual(await fs.readFile(c.service.store.file('operations/'+c.op.operationId+'.json')),before);
});
test('file identity failure after bridge allocation is not a dispatched unknown',async t=>{
 const c=await context(t),save=c.service.store.saveOp.bind(c.service.store);let calls=0,changed=false;
 c.service.store.saveOp=async op=>{await save(op);if(op.requestId==='identity-race'&&op.bridge&&!changed){changed=true;await fs.unlink(c.other);await fs.mkdir(c.other);}};
 c.adapter.execute=async()=>{calls++;};
 const result=await c.service.call('project_open',{projectPath:c.other,applicationId:app,requestId:'identity-race'});
 assert.equal(result.status,'conflict');assert.equal(result.error.code,'NOT_DISPATCHED');assert.equal(calls,0);
 assert.equal((await c.service.store.operation(result.operationId)).status,'conflict');
});
