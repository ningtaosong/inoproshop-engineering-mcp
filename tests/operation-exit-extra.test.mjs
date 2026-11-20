import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {scenario} from './exit-scenario.mjs';
import {setup,app,obj} from './helpers.mjs';
import {processObservations,requestBinding} from './process-double.mjs';
import {IdeAdapter} from '../dist/adapter.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {EngineeringService} from '../dist/service.js';
import {atomicJson,readJson,digest} from '../dist/storage.js';
import {publishProcessEvidence} from '../dist/process-exit.js';

for(const [name,options,code] of [
 ['signal',{code:null,signal:'SIGABRT'},'IDE_ABNORMAL_EXIT'],
 ['unknown-status',{code:null},'EXIT_STATUS_UNCONFIRMED'],
 ['identity-unavailable',{code:0,probe:async()=>({state:'unconfirmed',reason:'denied'})},'EXIT_IDENTITY_UNCONFIRMED'],
 ['identity-throws',{code:0,probe:async()=>{throw Error('original identity exception');}},'EXIT_IDENTITY_UNCONFIRMED'],
 ['identity-after-exit',{code:0,probe:async()=>{await new Promise(r=>setTimeout(r,80));return processObservations.probe();}},'EXIT_IDENTITY_UNCONFIRMED'],
 ['dispatched-no-result',{code:0,writeResult:false},'RESULT_MISSING'],
 ['success-no-marker',{code:0,dispatch:false},'DISPATCH_EVIDENCE_MISSING'],
])test('退出边界 '+name,async()=>{
 const x=await scenario(options);assert.equal(x.result.status,'unknown');assert.equal(x.result.error.code,code);
 assert.equal(x.kills,0);assert.equal(x.spawns,1);
 const restart=new IdeAdapter({});
 assert.equal((await restart.reconcile(x.directory,x.request)).status,'unknown');
});
test('正常退出证据绑定操作、请求、创建身份与原始文件；重启仍成功',async()=>{
 const x=await scenario({code:0});assert.equal(x.result.status,'succeeded');
 const exit=(await readJson(path.join(x.directory,'process-exit.json'))).value;
 assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.deepEqual(exit.processIdentity,x.identity);
 assert.equal(exit.binding.operationId,x.request.operationId);assert.equal(exit.binding.requestId,x.request.requestId);
 assert.equal(exit.resultHash,digest(await fs.readFile(path.join(x.directory,'result.json'))));
 assert.equal((await new IdeAdapter({}).reconcile(x.directory,x.request)).status,'succeeded');
});
for(const kind of ['missing','corrupt','operation','request','launch','pid','birth','result','dispatch','cached-success'])
test('重启退出证据拒绝 '+kind,async()=>{
 const x=await scenario({code:0}),file=path.join(x.directory,'process-exit.json');
 const before=await fs.readFile(path.join(x.directory,'result.json'));
 if(kind==='missing')await fs.unlink(file);
 else if(kind==='corrupt')await fs.writeFile(file,'{broken');
 else if(kind==='result')await fs.appendFile(path.join(x.directory,'result.json'),' ');
 else if(kind==='dispatch')await fs.appendFile(path.join(x.directory,'dispatched.json'),' ');
 else if(kind==='cached-success'){
  await fs.unlink(file);await atomicJson(path.join(x.directory,'observed-after-exit.json'),x.raw);
 }else{
  const v=(await readJson(file)).value;
  if(kind==='operation')v.binding.operationId=randomUUID();
  if(kind==='request')v.binding.requestId='other-task';
  if(kind==='launch')v.binding.launchId=randomUUID();
  if(kind==='pid')v.pid++;
  if(kind==='birth')v.processIdentity.startId='999999';
  await publishProcessEvidence(file,v);
 }
 const r=await new IdeAdapter({}).reconcile(x.directory,x.request);assert.equal(r.status,'unknown',kind);
 if(kind!=='result')assert.deepEqual(await fs.readFile(path.join(x.directory,'result.json')),before);
});
test('原请求归属不匹配不能使用另一操作的退出证据',async()=>{
 const x=await scenario({code:0});
 assert.equal((await x.adapter.reconcile(x.directory,{...x.request,requestFingerprint:'0'.repeat(64)})).error.code,'EXIT_EVIDENCE_MISMATCH');
});
for(const which of ['process-start.json','process-exit.json'])test('退出证据发布失败 '+which,async()=>{
 const x=await scenario({code:0,writeEvidence:async(file,value)=>{
  if(file.endsWith(which))throw Error('first publish failure '+which);
  await atomicJson(file,value);
 }});
 assert.equal(x.result.status,'unknown');assert.equal(x.result.error.code,'EXIT_EVIDENCE_PUBLISH_FAILED');
 assert.match(x.result.error.message,/first publish failure/);
 const r=await new IdeAdapter({}).reconcile(x.directory,x.request);assert.equal(r.status,'unknown');
 assert.deepEqual(await readJson(path.join(x.directory,'result.json')),x.raw);
});
test('超时仍观察原进程退出，未隔离迟到成功可由新实例核对，无自动重放',async()=>{
 const x=await scenario({code:0,timeoutMs:15,delay:100});assert.equal(x.result.error.code,'IDE_TIMEOUT');
 for(let i=0;i<100&&!await readJson(path.join(x.directory,'process-exit.json'));i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(await readJson(path.join(x.directory,'observed-after-exit.json')),undefined);
 assert.equal((await new IdeAdapter({}).reconcile(x.directory,x.request)).status,'succeeded');
 assert.equal(x.spawns,1);assert.equal(x.kills,0);
});
test('未启动进程的 error 与已派发异常退出分开',async()=>{
 const e=await setup(),directory=path.join(e.dir,'spawn-failure');
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:1000},()=>{
  const c=new EventEmitter();setTimeout(()=>c.emit('error',Object.assign(Error('spawn denied'),{code:'EACCES'})),10);return c;
 });
 const r=await adapter.execute({...requestBinding,operationId:randomUUID(),command:'read',projectPath:e.source,args:{}},directory,async()=>{});
 assert.equal(r.status,'failed');assert.equal(r.error.code,'NOT_DISPATCHED');
 assert.equal((await readJson(path.join(directory,'process-exit.json'))).value.error.message,'spawn denied');
});
for(const direct of [false,true])test('生产服务：异常退出冻结、去重、重启核对；无恢复性写入 '+(direct?'direct':'copy'),async t=>{
 const env=await setup(),fixture=new FixtureAdapter();let nativeCalls=0,original;
 const s=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:5000},fixture);t.after(()=>s.store.release());
 const opened=await s.call(direct?'project_open':'project_open_copy',{requestId:'open',...(direct?{projectPath:env.source}:{sourcePath:env.source}),applicationId:app});
 const target={projectId:opened.data.session.projectId,applicationId:app},read=await s.call('object_read',{...target,objectId:obj});
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:1000},(exe,args,options)=>{
  nativeCalls++;const c=new EventEmitter();c.pid=12345;
  setTimeout(async()=>{
   const f=options.env.INOPRO_BRIDGE_REQUEST,d=path.dirname(f),request=await readJson(f);
   const r=await fixture.execute(request,path.join(env.dir,'fixture-'+nativeCalls),async()=>{});
   original={...r,status:'unknown',error:{code:'FIRST_NATIVE_FAULT',message:'name changed; binding uncertain'},data:{...r.data,cleanupError:'close failed'}};
   await atomicJson(path.join(d,'dispatched.json'),{operationId:request.operationId,pid:12345});
   await atomicJson(path.join(d,'result.json'),original);c.emit('exit',3221226525,null);
  },30);return c;
 },processObservations);
 const service=new EngineeringService(s.config,adapter);await s.store.release();t.after(()=>service.store.release());
 const args={...target,requestId:'uncertain-write',objectId:obj,expectedHash:read.data.contentHash,declaration:read.data.declaration,implementation:'// changed by fixture'};
 const r=await service.call('code_apply_change',args);assert.equal(r.status,'unknown');assert.equal(r.error.code,'IDE_ABNORMAL_EXIT');
 assert.equal(r.data.priorResult.error.code,'FIRST_NATIVE_FAULT');assert.equal(r.data.priorResult.data.cleanupError,'close failed');
 const after=await fs.readFile(opened.data.session.workingPath);
 assert.equal((await service.call('code_apply_change',args)).operationId,r.operationId);assert.equal(nativeCalls,1);
 await assert.rejects(()=>service.call('project_build',{...target,requestId:'new-write'}),e=>e.code==='PENDING_UNKNOWN');
 const file=service.store.file('operations/'+r.operationId+'.json'),bytes=await fs.readFile(file);
 await service.store.release();const restart=new EngineeringService(s.config,new IdeAdapter({}));t.after(()=>restart.store.release());
 const reconciled=await restart.call('operation_status',{requestId:args.requestId,reconcile:true});assert.equal(reconciled.status,'unknown');
 assert.equal((await restart.status()).data.globalFrozen,true);
 assert.deepEqual(await fs.readFile(opened.data.session.workingPath),after);
 assert.deepEqual(await fs.readFile(file),bytes);assert.equal(nativeCalls,1);
});
