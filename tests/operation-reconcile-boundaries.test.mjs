import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {setup,app} from './helpers.mjs';import {scenario} from './exit-scenario.mjs';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {IdeAdapter} from '../dist/adapter.js';import {atomicJson,readJson} from '../dist/storage.js';

test('历史 succeeded 无退出字段只读兼容，不补造退出0或改账本',async()=>{
 const e=await setup();let dispatches=0,reconciles=0;
 const s=new EngineeringService({dataDir:e.dataDir},{execute:()=>{dispatches++;},reconcile:()=>{reconciles++;}});
 const operationId=randomUUID(),op={schemaVersion:1,operationId,requestId:'historical-success',tool:'task_inspect',args:{},fingerprint:'old',status:'succeeded',ownerPid:2147483647,startedAt:'2026-11-20T00:00:00Z',finishedAt:'2026-11-20T00:00:01Z',
  response:{contractVersion:'1.0.0',operationId,status:'succeeded',summary:'historical result'}};
 await s.store.saveOp(op);const file=s.store.file('operations/'+operationId+'.json'),bytes=await fs.readFile(file);
 for(const key of [{operationId},{requestId:op.requestId}])for(const reconcile of [false,true])
  assert.deepEqual(await s.call('operation_status',{...key,reconcile}),op.response);
 assert.deepEqual(await fs.readFile(file),bytes);assert.equal(dispatches+reconciles,0);
});
test('requestId 对应多个操作时拒绝猜测，不进入 adapter',async()=>{
 const e=await setup(),s=new EngineeringService({dataDir:e.dataDir},{reconcile:()=>assert.fail('reconcile')});
 for(let i=0;i<2;i++)await s.store.saveOp({schemaVersion:1,operationId:randomUUID(),requestId:'ambiguous',tool:'task_inspect',args:{},fingerprint:'old',status:'unknown',ownerPid:2147483647,startedAt:'2026-11-20T00:00:00Z'});
 await assert.rejects(()=>s.call('operation_status',{requestId:'ambiguous',reconcile:true}),e=>e.code==='OPERATION_REQUEST_AMBIGUOUS');
});
test('原进程仍存在不核对结果；未隔离缺结果不启动 IDE',async t=>{
 const e=await setup(),fixture=new FixtureAdapter(),s=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:2000},fixture);
 t.after(()=>s.store.release());
 const opened=await s.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app});
 const operationId=randomUUID(),op={schemaVersion:1,operationId,requestId:'missing',tool:'project_save',args:{projectId:opened.data.session.projectId},fingerprint:'old',status:'unknown',ownerPid:2147483647,startedAt:'2026-11-20T00:00:00Z',project:opened.data.session,bridge:{directory:s.store.file('ipc/'+operationId),pid:process.pid}};
 await s.store.saveOp(op);const file=s.store.file('operations/'+operationId+'.json'),bytes=await fs.readFile(file);
 let reconciles=0;fixture.reconcile=async()=>{reconciles++;return undefined;};
 assert.equal((await s.call('operation_status',{operationId,reconcile:true})).status,'unknown');assert.equal(reconciles,0);
 assert.deepEqual(await fs.readFile(file),bytes);
 op.bridge.pid=2147483647;await s.store.saveOp(op);
 assert.equal((await s.call('operation_status',{operationId,reconcile:true})).status,'unknown');assert.equal(reconciles,1);
});
test('退出回执缺失时区分同一创建实例仍在、PID复用和已退出',async()=>{
 const x=await scenario({code:0});await fs.unlink(path.join(x.directory,'process-exit.json'));
 for(const [state,observation,expected] of [
  ['same',{state:'running',identity:x.identity},'IDE_STILL_RUNNING'],
  ['reuse',{state:'running',identity:{...x.identity,startId:'777'}},'EXIT_IDENTITY_UNCONFIRMED'],
  ['exited',{state:'exited'},'EXIT_EVIDENCE_MISSING'],
  ['denied',{state:'unconfirmed',reason:'access denied'},'EXIT_IDENTITY_UNCONFIRMED']
 ]){
  const adapter=new IdeAdapter({},undefined,{probe:async()=>observation});
  const r=await adapter.reconcile(x.directory,x.request);assert.equal(r.status,'unknown',state);assert.equal(r.error.code,expected);
 }
});
test('历史 IPC 没有退出字段不补造正常退出，原文件保持',async()=>{
 const e=await setup(),dir=path.join(e.dir,'legacy-ipc'),operationId=randomUUID();
 const req={operationId,command:'read',projectPath:e.source,args:{}},raw={contractVersion:'1.0.0',operationId,status:'succeeded',summary:'legacy raw'};
 await atomicJson(path.join(dir,'request.json'),req);await atomicJson(path.join(dir,'result.json'),raw);
 const adapter=new IdeAdapter({});
 assert.equal((await adapter.reconcile(dir)).error.code,'EXIT_EVIDENCE_MISSING');
 assert.deepEqual(await readJson(path.join(dir,'request.json')),req);assert.deepEqual(await readJson(path.join(dir,'result.json')),raw);
 assert.equal(await readJson(path.join(dir,'process-exit.json')),undefined);
});
