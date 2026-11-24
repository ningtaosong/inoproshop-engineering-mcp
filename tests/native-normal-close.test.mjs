import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {scenario} from './exit-scenario.mjs';
import {atomicJson,readJson,canonical,digest} from '../dist/storage.js';
import {IdeAdapter} from '../dist/adapter.js';
import {publishProcessEvidence} from '../dist/process-exit.js';
import {setup,app,obj} from './helpers.mjs';
import {processObservations,normalCloseDouble} from './process-double.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {EventEmitter} from 'node:events';

test('close callback failure followed by exit 0 must not accept the business success',async()=>{
 const x=await scenario({code:0,afterResult:async({directory})=>{
  await atomicJson(path.join(directory,'normal-close-failed.json'),{firstError:{message:'public close callback failed'}});
 }});
 assert.equal(x.result.status,'unknown');
 assert.equal(x.spawns,1);assert.equal(x.kills,0);
 assert.equal((await x.adapter.reconcile(x.directory,x.request)).status,'unknown');
});
test('worker must not force engine shutdown from the runscript entry tail',async()=>{
 const source=await fs.readFile('bridge/worker.py','utf8');
 assert.equal(/\bsystem\.exit\s*\(/.test(source),false);
});

for(const stage of ['preflight','queue','queued','callback','dispatch','returned'])
test('normal exit 0 without '+stage+' remains unknown after restart',async()=>{
 const x=await scenario({code:0,afterClose:async({directory})=>fs.unlink(path.join(directory,`normal-close-${stage}.json`))});
 assert.equal(x.result.error.code,'NORMAL_CLOSE_EVIDENCE_MISSING');
 assert.equal((await new IdeAdapter({}).reconcile(x.directory,x.request)).status,'unknown');
 assert.equal(x.spawns,1);assert.equal(x.kills,0);
});
for(const kind of ['operation','request','launch','fingerprint','pid','creation','requestHash','guid','arguments','ordinal','open-project','ui','async','delegate','policy','order','corrupt'])
test('close evidence rejects '+kind,async()=>{
 const x=await scenario({code:0,afterClose:async({directory})=>{
  let stage=kind==='policy'?'preflight':kind==='open-project'||kind==='ui'?'callback':kind==='async'||kind==='delegate'?'queue':'dispatch';
  const f=path.join(directory,`normal-close-${stage}.json`),e=await readJson(f);
  if(kind==='operation')e.binding.operationId='other';
  if(kind==='request')e.binding.requestId='other';
  if(kind==='launch')e.binding.launchId='other';
  if(kind==='fingerprint')e.binding.requestFingerprint='other';
  if(kind==='pid')e.binding.pid++;
  if(kind==='creation')e.binding.startId='9876';
  if(kind==='requestHash')e.binding.requestFileHash='a'.repeat(64);
  if(kind==='guid')e.commandGuid='other';
  if(kind==='arguments')e.arguments=['save'];
  if(kind==='ordinal')e.dispatchOrdinal=2;
  if(kind==='open-project')e.noProject.openProjectCount=1;
  if(kind==='ui')e.noProject.uiPresent=false;
  if(kind==='async')e.asyncRequested=false;
  if(kind==='delegate')e.callableKind='System.Action';
  if(kind==='policy')e.policy.helperHash='a'.repeat(64);
  if(kind==='order')e.utc='2000-01-01T00:00:00Z';
  await atomicJson(f,e);
  if(kind==='corrupt')await fs.writeFile(f,'{broken');
 }});
 assert.equal(x.result.status,'unknown',JSON.stringify(x.result));
 assert.equal((await new IdeAdapter({}).reconcile(x.directory,x.request)).status,'unknown');
});
test('close failure JSON publication failure remains visible through independently bound stderr',async()=>{
 const x=await scenario({code:0,afterClose:async({directory})=>fs.appendFile(path.join(directory,'stderr.txt'),'NORMAL_CLOSE_FIRST_ERROR original fault\nNORMAL_CLOSE_RECORD_ERROR denied\n')});
 assert.equal(x.result.error.code,'NORMAL_CLOSE_FAILED');assert.equal(x.result.data.priorResult.status,'succeeded');
});
test('close receipt mutation after process exit cannot upgrade a failed close',async()=>{
 const x=await scenario({code:0,close:false});assert.equal(x.result.status,'unknown');
 await normalCloseDouble(x.directory,x.identity);
 assert.equal((await x.adapter.reconcile(x.directory,x.request)).error.code,'NORMAL_CLOSE_FILES_CHANGED');
});
test('historical request without new close policy keeps old exit evidence rules and bytes',async()=>{
 const x=await scenario({code:0});
 const request=await readJson(path.join(x.directory,'request.json'));delete request.normalClosePolicy;
 await atomicJson(path.join(x.directory,'request.json'),request);
 const start=(await readJson(path.join(x.directory,'process-start.json'))).value;
 start.binding.requestHash=digest(canonical(request));await publishProcessEvidence(path.join(x.directory,'process-start.json'),start);
 const exit=(await readJson(path.join(x.directory,'process-exit.json'))).value;
 exit.binding=start.binding;exit.startHash=digest(canonical(start));delete exit.normalCloseHashes;delete exit.normalCloseStderrHash;
 await publishProcessEvidence(path.join(x.directory,'process-exit.json'),exit);
 const before=await fs.readFile(path.join(x.directory,'process-exit.json'));
 assert.equal((await new IdeAdapter({}).reconcile(x.directory,x.request)).status,'succeeded');
 assert.deepEqual(await fs.readFile(path.join(x.directory,'process-exit.json')),before);
});
test('no UI request rejected before process launch',async()=>{
 let calls=0;const x=await setup();
 const adapter=new IdeAdapter({executable:process.execPath,noUI:true},()=>{calls++;throw Error('must not launch');});
 await assert.rejects(()=>adapter.execute({},path.join(x.dir,'ipc'),async()=>{}),{code:'NORMAL_CLOSE_REQUIRES_UI'});
 assert.equal(calls,0);
});
for(const direct of [true,false])test('normal-close failure freezes writes, deduplicates and survives restart '+direct,async t=>{
 const e=await setup(),fixture=new FixtureAdapter(),config={dataDir:e.dataDir,testMode:true,responseWaitMs:5000};
 const prep=new EngineeringService(config,fixture);t.after(()=>prep.store.release());
 const opened=await prep.call(direct?'project_open':'project_open_copy',{requestId:'open',applicationId:app,...(direct?{projectPath:e.source}:{sourcePath:e.source})});
 const target={projectId:opened.data.session.projectId,applicationId:app};
 const read=await prep.call('object_read',{...target,objectId:obj});await prep.store.release();
 let writes=0,kills=0;
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:3000},(exe,args,options)=>{
  const child=new EventEmitter();child.pid=12345;child.kill=()=>kills++;
  setTimeout(async()=>{
   const request=await readJson(options.env.INOPRO_BRIDGE_REQUEST),d=path.dirname(options.env.INOPRO_BRIDGE_REQUEST);
   writes++;const result=await fixture.execute(request,path.join(e.dir,'fixture-result'),async()=>{});
   await atomicJson(path.join(d,'dispatched.json'),{operationId:request.operationId,pid:12345});
   await atomicJson(path.join(d,'result.json'),result);await normalCloseDouble(d);
   await atomicJson(path.join(d,'normal-close-failed.json'),{firstError:{message:'first public close exception'}});
   child.emit('exit',0,null);
  },30);return child;
 },processObservations);
 const service=new EngineeringService(config,adapter);t.after(()=>service.store.release());
 const args={...target,requestId:'one-write',objectId:obj,expectedHash:read.data.contentHash,declaration:read.data.declaration,implementation:'// authorized fixture write'};
 const r=await service.call('code_apply_change',args);assert.equal(r.error.code,'NORMAL_CLOSE_FAILED');
 assert.equal(r.data.normalCloseEvidence.firstFailure.firstError.message,'first public close exception');
 const after=await fs.readFile(opened.data.session.workingPath);
 assert.equal((await service.call('code_apply_change',args)).operationId,r.operationId);assert.equal(writes,1);
 await assert.rejects(()=>service.call('project_build',{...target,requestId:'blocked'}),e=>e.code==='PENDING_UNKNOWN');
 await service.store.release();const restart=new EngineeringService(config,new IdeAdapter({}));t.after(()=>restart.store.release());
 assert.equal((await restart.call('operation_status',{operationId:r.operationId,reconcile:true})).status,'unknown');
 assert.deepEqual(await fs.readFile(opened.data.session.workingPath),after);assert.equal(writes,1);assert.equal(kills,0);
});
