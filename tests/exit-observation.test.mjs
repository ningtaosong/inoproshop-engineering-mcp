import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ServiceLifecycle} from '../dist/service-lifecycle.js';
import {ExitJournal,exclusiveJson} from '../dist/exit-journal.js';
import {EngineeringService} from '../dist/service.js';
import {IdeAdapter} from '../dist/adapter.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {atomicJson,readJson,digest} from '../dist/storage.js';
import {setup,app,obj} from './helpers.mjs';
import {normalCloseDouble,processObservations,requestBinding} from './process-double.mjs';
import {callAndWait} from './operation-wait.mjs';

const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
function life(actions={}) {
 const events=[],errors=[],counts={release:0,close:0,stop:0};
 const lifecycle=new ServiceLifecycle({stopAdmission:()=>counts.stop++,drain:async()=>{},observe:async()=>{},
  status:async()=>({status:'succeeded',data:{writeFrozen:false,pending:[]}}),release:async()=>counts.release++,close:async()=>counts.close++,
  record:async(event,data)=>events.push({event,data}),failed:e=>errors.push(e),...actions});
 return {lifecycle,events,errors,counts};
}
test('EOF drains once, closes normally and preserves exact release preconditions',async()=>{
 const x=life(),a=x.lifecycle.request('stdin-end'),b=x.lifecycle.request('stdin-close');assert.equal(a,b);await a;
 assert.deepEqual(x.counts,{release:1,close:1,stop:1});assert.equal(x.errors.length,0);
 assert.equal(x.events.filter(e=>e.event==='shutdown-requested').length,1);
});
for(const status of [
 {status:'succeeded',data:{writeFrozen:true,pending:[{status:'unknown'}]}},
 {status:'succeeded',data:{writeFrozen:false,pending:[{status:'unknown',isolated:true}]}},
 {status:'unknown',data:{pending:[],writeFrozen:true}},
 {status:'succeeded',data:{writeFrozen:false}},
])test('EOF retains lease for original unknown/isolated/missing status '+JSON.stringify(status),async()=>{
 const x=life({status:async()=>status});await x.lifecycle.request('stdin-end');assert.equal(x.counts.release,0);assert.equal(x.counts.close,1);
 assert(x.events.some(e=>e.event==='lease-retained'));
});
for(const failedStage of ['drain','observe','status','release','close','record'])test('shutdown failure retains first cause '+failedStage,async()=>{
 const first=Error('FIRST '+failedStage),x=life({[failedStage]:async()=>{throw first;}});
 await x.lifecycle.request('stdin-end');assert.equal(x.errors[0],first);assert.equal(x.counts.stop,1);
 if(!['release','close'].includes(failedStage))assert.equal(x.counts.release,0);
});
test('EOF cannot skip observation after queue drain fails',async()=>{
 const observed=gate(),entered=gate();let closed=false;
 const x=life({drain:async()=>{throw Error('queue failure');},observe:async()=>{entered.resolve();await observed.promise;},close:async()=>closed=true});
 const done=x.lifecycle.request('stdin-end');await entered.promise;assert.equal(closed,false);observed.resolve();await done;assert.equal(closed,true);
});

for(const stage of ['admission','queued','native-start','returned-running'])test('production service EOF gate '+stage,async t=>{
 const env=await setup(),fixture=new FixtureAdapter(),entered=gate(),continueRun=gate(),queueGate=gate();let launches=0;
 const adapter={reconcile:d=>fixture.reconcile(d),execute:async(...args)=>{
   launches++;if(stage!=='admission'&&stage!=='queued'){entered.resolve();await continueRun.promise;}return fixture.execute(...args);
 }};
 const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1},adapter);
 t.after(()=>service.store.release());
 if(stage==='queued')service.queue=queueGate.promise;
 if(stage==='admission'){const acquire=service.store.acquire.bind(service.store);service.store.acquire=async()=>{entered.resolve();await continueRun.promise;return acquire();};}
 const request=service.call('project_open',{requestId:'open-gated',projectPath:env.source,applicationId:app});
 if(stage==='queued') {
   assert.equal((await request).status,'running');assert.equal(launches,0);
 }else await entered.promise;
 if(stage==='returned-running')assert.equal((await request).status,'running');
 let closed=false;
 const x=life({stopAdmission:()=>service.stopAdmission(),drain:()=>service.drain(),status:()=>service.status(),
   release:()=>service.store.release(),close:async()=>closed=true});
 const done=x.lifecycle.request('stdin-end');await turn();assert.equal(closed,false);
 await assert.rejects(()=>service.call('environment_inspect',{}),e=>e.code==='SERVICE_CLOSING');
 continueRun.resolve();queueGate.resolve();await request;await done;assert.equal(launches,1);assert.equal(closed,true);
 const operations=await service.store.operations();assert.equal(operations.length,1);assert.equal(operations[0].status,'succeeded');
});

async function pendingAdapter(options={}) {
 const env=await setup(),directory=path.join(env.dir,'late-ipc'),child=new EventEmitter();child.pid=12345;let kills=0;
 child.kill=()=>kills++;const started=gate();
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',noUI:false,timeoutMs:35},()=>child,{...processObservations,...options});
 const request={...requestBinding,operationId:randomUUID(),command:'read',projectPath:env.source,args:{}};
 const pending=adapter.execute(request,directory,async()=>started.resolve()).catch(e=>e);
 await started.promise;const result=await pending;
 assert.equal(result.code,'IDE_TIMEOUT');
 const raw={contractVersion:'1.0.0',operationId:request.operationId,status:'succeeded',summary:'fixture late success',data:{value:'preserved'}};
 await atomicJson(path.join(directory,'dispatched.json'),{operationId:request.operationId,pid:child.pid});
 await atomicJson(path.join(directory,'result.json'),raw);await normalCloseDouble(directory);
 return {env,directory,child,adapter,request,result,raw,kills:()=>kills};
}
for(const [code,signal] of [[0,null],[3221226525,null],[null,'SIGABRT'],[null,null]])test('late fact after timeout remains separate '+code+'/'+signal,async()=>{
 const x=await pendingAdapter();let closed=false;
 const f=life({observe:()=>x.adapter.waitForObservations(),status:async()=>({status:'succeeded',data:{pending:[{status:'unknown'}],writeFrozen:true}}),close:async()=>closed=true});
 const finished=f.lifecycle.request('stdin-end');await turn();assert.equal(closed,false);
 x.child.emit('exit',code,signal);await finished;
 assert.equal(closed,true);assert.equal(f.counts.release,0);assert.equal(x.result.code,'IDE_TIMEOUT');
 const exit=(await readJson(path.join(x.directory,'process-exit.json'))).value;assert.equal(exit.code,code);assert.equal(exit.signal,signal);
 assert.deepEqual(await readJson(path.join(x.directory,'result.json')),x.raw);
 assert.equal(await readJson(path.join(x.directory,'observed-after-exit.json')),undefined);assert.equal(x.kills(),0);
});
test('runtime error with PID is not exit; missing exit event yields unknown receipt',async()=>{
 const x=await pendingAdapter();let done=false;const drained=x.adapter.waitForObservations().then(()=>done=true);
 x.child.emit('error',Error('runtime fault'));await turn();assert.equal(done,false);
 x.child.emit('close',0,null);await drained;
 assert.equal((await readJson(path.join(x.directory,'process-exit.json'))).value.state,'unconfirmed');
 assert.equal((await x.adapter.reconcile(x.directory)).status,'unknown');assert.equal(x.kills(),0);
});
for(const diagnosticFails of [false,true])test('late publication failure durable original error and diagnostic fault '+diagnosticFails,async()=>{
 const reports=[];
 const x=await pendingAdapter({writeEvidence:async(file,value)=>{
   if(file.endsWith('process-exit.json'))throw Error('FIRST publication rejected');await atomicJson(file,value);
 },...(diagnosticFails?{writeDiagnostic:async()=>{throw Error('SECOND diagnostic rejected');}}:{}),reportDiagnostic:v=>reports.push(v)});
 x.child.emit('exit',0,null);await x.adapter.waitForObservations();assert.equal(x.result.code,'IDE_TIMEOUT');
 assert.equal(await readJson(path.join(x.directory,'process-exit.json')),undefined);
 if(diagnosticFails){assert.equal(reports.length,1);assert.match(reports[0].error.message,/FIRST/);assert.match(reports[0].recordError.message,/SECOND/);}
 else {const error=(await readJson(path.join(x.directory,'process-exit-publication-error.json'))).value;
   assert.equal(error.binding.operationId,x.request.operationId);assert.equal(error.timedOut,true);assert.match(error.error.message,/FIRST/);
   assert.equal(error.observedExit.code,0);assert.deepEqual(error.process,(await readJson(path.join(x.directory,'process-start.json'))).value.process);}
 assert.equal((await new IdeAdapter({}).reconcile(x.directory,x.request)).status,'unknown');assert.equal(x.kills(),0);
});
test('receipt collision never overwrites original bytes',async()=>{
 const x=await pendingAdapter(),file=path.join(x.directory,'process-exit.json');await fs.writeFile(file,'original evidence');
 x.child.emit('exit',0,null);await x.adapter.waitForObservations();assert.equal(await fs.readFile(file,'utf8'),'original evidence');
 assert.equal((await new IdeAdapter({}).reconcile(x.directory)).status,'unknown');
});
test('observation drain waits for the actual publication promise',async()=>{
 const writing=gate(),complete=gate();const x=await pendingAdapter({writeEvidence:async(file,value)=>{
   if(file.endsWith('process-exit.json')){writing.resolve();await complete.promise;}await atomicJson(file,value);
 }});x.child.emit('exit',0,null);await writing.promise;let drained=false;
 const waiting=x.adapter.waitForObservations().then(()=>drained=true);await turn();assert.equal(drained,false);
 complete.resolve();await waiting;assert(await readJson(path.join(x.directory,'process-exit.json')));
});
test('journal preserves append order and refuses overwritten evidence',async()=>{
 const env=await setup(),journal=new ExitJournal(path.join(env.dir,'journal'),{runId:'offline'});
 await Promise.all([journal.record('exit',{code:0}),journal.record('close',{code:0})]);await journal.settled();
 const rows=await fs.readdir(journal.directory);assert.equal(rows.length,2);assert.match(rows[0],/000001-exit/);
 const file=path.join(journal.directory,rows[0]),original=await fs.readFile(file);
 await assert.rejects(()=>exclusiveJson(file,{}),e=>e.code==='EEXIST');assert.deepEqual(await fs.readFile(file),original);
});
test('journal identity/write failure observable without losing first error',async()=>{
 const env=await setup(),reports=[],first=Error('identity binding unavailable'),binding=Promise.reject(first);binding.catch(()=>{});
 const journal=new ExitJournal(path.join(env.dir,'journal'),binding,undefined,v=>reports.push(v));
 await assert.rejects(()=>journal.record('exit',{code:0}),e=>e===first);await assert.rejects(()=>journal.settled());
 assert.equal(reports.length,1);assert.equal(reports[0].value.bindingUnconfirmed,true);
});
for(const failWrite of [false,true])test('runtime error before exit cannot race diagnostic publication or disappear '+failWrite,async()=>{
 const env=await setup(),directory=path.join(env.dir,'runtime'),child=new EventEmitter();child.pid=12345;
 const writing=gate(),allow=gate(),start=gate(),reports=[];
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',noUI:false,timeoutMs:5000},()=>child,
 {...processObservations,writeDiagnostic:async(file,value)=>{writing.resolve();await allow.promise;if(failWrite)throw Error('SECOND diagnostic failure');await exclusiveJson(file,value);},reportDiagnostic:v=>reports.push(v)});
 const request={...requestBinding,operationId:randomUUID(),command:'read',projectPath:env.source,args:{}};
 let finished=false;const pending=adapter.execute(request,directory,async()=>start.resolve()).then(r=>{finished=true;return r;});
 await start.promise;await atomicJson(path.join(directory,'dispatched.json'),{operationId:request.operationId,pid:child.pid});
 await atomicJson(path.join(directory,'result.json'),{contractVersion:'1.0.0',operationId:request.operationId,status:'succeeded',summary:'fixture'});
 await normalCloseDouble(directory);child.emit('error',Error('FIRST runtime fault'));await writing.promise;child.emit('exit',0,null);
 await turn();assert.equal(finished,false);allow.resolve();const result=await pending;
 assert.equal(result.status,'unknown');assert.equal(result.error.code,'EXIT_OBSERVER_FAILED');assert.match(result.error.message,/FIRST/);
 assert.equal((await adapter.reconcile(directory)).error.code,'EXIT_OBSERVER_FAILED');
 assert.equal((await new IdeAdapter({}).reconcile(directory,request)).status,'unknown','Restart must retain runtime fault even when supplemental diagnostic failed');
 if(failWrite){assert.equal(reports.length,1);assert.match(reports[0].recordError.message,/SECOND/);}
});
for(const [code,signal] of [[0,null],[7,null],[null,'SIGABRT']])test('production service timeout EOF retains operation and lease bytes '+code+'/'+signal,async t=>{
 const env=await setup(),baselineAdapter=new FixtureAdapter(),preparation=[];
 const execute=baselineAdapter.execute.bind(baselineAdapter);baselineAdapter.execute=async(...a)=>{preparation.push(a[0]);return execute(...a);};
 const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:5000},baselineAdapter);
 t.after(async()=>{await service.drain();await service.store.release();});
 const opened=await callAndWait(service,'project_open',{requestId:'open',projectPath:env.source,applicationId:app});
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));assert.equal(service.adapter,baselineAdapter);
 assert.equal(preparation.length,1);assert.equal(preparation[0].command,'inspect');assert.equal(preparation[0].operationId,opened.operationId);
 let directory;const child=new EventEmitter();child.pid=12345;child.kill=()=>assert.fail('never kill');
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',noUI:false,timeoutMs:100},(exe,args,options)=>{
   directory=path.dirname(options.env.INOPRO_BRIDGE_REQUEST);return child;
 },processObservations);service.adapter=adapter;
 const args={requestId:'read-timeout',projectId:opened.data.session.projectId,applicationId:app,objectId:obj};
 const result=await callAndWait(service,'object_read',args);assert.equal(result.status,'unknown');assert.equal(result.error.code,'IDE_TIMEOUT');
 const ledger=service.store.file('operations/'+result.operationId+'.json'),lease=service.store.file('service.lock');
 const before=await fs.readFile(ledger),leaseBefore=await fs.readFile(lease),sourceBefore=await fs.readFile(env.source);
 assert.equal((await service.call('object_read',args)).operationId,result.operationId);
 let closed=false;const x=life({stopAdmission:()=>service.stopAdmission(),drain:()=>service.drain(),observe:()=>adapter.waitForObservations(),
   status:()=>service.status(),release:()=>service.store.release(),close:async()=>closed=true});
 const done=x.lifecycle.request('stdin-end');await turn();assert.equal(closed,false);
 const request=await readJson(path.join(directory,'request.json'));
 assert.equal(request.command,'read');assert.equal(request.operationId,result.operationId);assert.equal(request.requestId,args.requestId);
 await atomicJson(path.join(directory,'dispatched.json'),{operationId:request.operationId,pid:child.pid});
 await atomicJson(path.join(directory,'result.json'),{contractVersion:'1.0.0',operationId:request.operationId,status:'succeeded',summary:'late fixture data'});
 await normalCloseDouble(directory);child.emit('exit',code,signal);await done;
 assert.equal(closed,true);assert.deepEqual(await fs.readFile(ledger),before);assert.deepEqual(await fs.readFile(lease),leaseBefore);
 assert.deepEqual(await fs.readFile(env.source),sourceBefore);assert.equal(await readJson(path.join(directory,'observed-after-exit.json')),undefined);
 assert.equal((await service.status()).data.writeFrozen,true);
});
test('runtime fault with diagnostic loss remains frozen and idempotent after service restart',async t=>{
 const env=await setup(),fixture=new FixtureAdapter(),service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:5000},fixture);
 t.after(async()=>{await service.drain();await service.store.release();});
 const opened=await callAndWait(service,'project_open',{requestId:'open',projectPath:env.source,applicationId:app});
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));assert.equal(service.adapter,fixture);
 let spawns=0;service.adapter=new IdeAdapter({executable:process.execPath,profile:'offline',noUI:false,timeoutMs:3000},(exe,args,options)=>{
  spawns++;const c=new EventEmitter();c.pid=12345;
  setTimeout(async()=>{const directory=path.dirname(options.env.INOPRO_BRIDGE_REQUEST),request=await readJson(options.env.INOPRO_BRIDGE_REQUEST);
   await atomicJson(path.join(directory,'dispatched.json'),{operationId:request.operationId,pid:c.pid});
   await atomicJson(path.join(directory,'result.json'),{contractVersion:'1.0.0',operationId:request.operationId,status:'succeeded',summary:'fixture read'});
   await normalCloseDouble(directory);c.emit('error',Error('FIRST runtime event'));c.emit('exit',0,null);
  },30);return c;
 },{...processObservations,writeDiagnostic:async()=>{throw Error('diagnostic disk unavailable');},reportDiagnostic:()=>{}});
 const args={requestId:'runtime-fault',projectId:opened.data.session.projectId,applicationId:app,objectId:obj};
 const result=await callAndWait(service,'object_read',args);assert.equal(result.error.code,'EXIT_OBSERVER_FAILED');
 const ledger=service.store.file('operations/'+result.operationId+'.json'),before=await fs.readFile(ledger);
 assert.equal((await service.call('object_read',args)).operationId,result.operationId);assert.equal(spawns,1);
 await assert.rejects(()=>service.call('project_build',{...args,requestId:'no-write'}),e=>e.code==='PENDING_UNKNOWN');
 await service.store.release();
 const restart=new EngineeringService(service.config,new IdeAdapter({}));t.after(()=>restart.store.release());
 const observed=await restart.call('operation_status',{operationId:result.operationId,reconcile:true});
 assert.equal(observed.error.code,'EXIT_OBSERVER_FAILED');assert.deepEqual(await fs.readFile(ledger),before);
 assert.equal((await restart.status()).data.globalFrozen,true);assert.equal(spawns,1);
});
test('runtime first fault survives later exit publication and diagnostic faults',async()=>{
 const env=await setup(),directory=path.join(env.dir,'faults'),started=gate(),child=new EventEmitter();child.pid=12345;const reports=[];
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',noUI:false,timeoutMs:2000},()=>child,
 {...processObservations,writeEvidence:async(file,value)=>{if(file.endsWith('process-exit.json'))throw Error('SECOND exit record');await atomicJson(file,value);},
  writeDiagnostic:async()=>{throw Error('THIRD diagnostic');},reportDiagnostic:r=>reports.push(r)});
 const pending=adapter.execute({...requestBinding,operationId:randomUUID(),command:'read',projectPath:env.source,args:{}},directory,async()=>started.resolve());
 await started.promise;child.emit('error',Error('FIRST runtime'));child.emit('exit',0,null);
 const result=await pending;assert.equal(result.error.code,'EXIT_OBSERVER_FAILED');assert.match(result.error.message,/FIRST/);
 assert.match(result.data.publicationError.message,/SECOND/);assert.equal(reports.length,2);
});
