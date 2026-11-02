import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect,app,obj} from './helpers.mjs';
import {Store,atomicJson,codeHash,digest} from '../dist/storage.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {DomainError,reply} from '../dist/contracts.js';

test('断开 / 重启保留原结果，不自动重放；损坏记录冻结',async t=> {
  const env=await setup(); let c=await connect(env.dataDir);
  const args={requestId:'open',sourcePath:env.source,applicationId:app};
  const opened=await c.done(await c.call('project_open_copy',args)); await c.client.close();
  c=await connect(env.dataDir); t.after(()=>c.client.close());
  assert.equal((await c.call('project_open_copy',args)).operationId,opened.operationId);
  const store=new Store(env.dataDir); const ops=await store.operations();
  await writeFile(store.file('operations/'+ops[0].operationId+'.json'),'{broken');
  const broken=await c.call('project_open_copy',{...args,requestId:'new'}); assert.equal(broken.status,'unknown'); assert.equal(broken.error.code,'CORRUPT_RECORD');
});

test('未决修改重启后冻结；只接纳原操作晚到结果；不重放',async t=> {
  const env=await setup(); const store=new Store(env.dataDir);
  const workingPath=path.join(env.dir,'旧工作副本.json');await copyFile(env.source,workingPath);
  const project={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:env.source,workingPath,sourceHash:digest(await readFile(env.source)),applicationId:app,targetKind:'application'};
  await store.saveSession(project);
  const operationId=randomUUID(); const directory=store.file('ipc/'+operationId);
  const args={projectId:project.projectId,objectId:obj,applicationId:app,declaration:'PROGRAM Test',implementation:'// 原操作'};
  const op={schemaVersion:1,operationId,requestId:'lost',tool:'code_apply_change',args,fingerprint:'abc',status:'running',startedAt:new Date().toISOString(),ownerPid:2147483647,bridge:{directory}};
  await store.saveOp(op); const c=await connect(env.dataDir); t.after(()=>c.client.close());
  const status=await c.call('session_status'); assert.equal(status.data.writeFrozen,true);
  assert.equal((await c.call('project_open_copy',{requestId:'cannot-replay',sourcePath:env.source,applicationId:app})).status,'unknown');
  const missing=await c.call('operation_status',{requestId:'lost',reconcile:true}); assert.equal(missing.status,'unknown');
  await atomicJson(path.join(directory,'result.json'),{...reply('succeeded','原修改晚到证据',{...args,contentHash:codeHash(args.declaration,args.implementation),snapshot:'0'.repeat(64),diskHash:digest(await readFile(workingPath)),persistedToWorkingCopy:true,reopened:true,testMode:true}),operationId});
  const recovered=await c.call('operation_status',{requestId:'lost',reconcile:true}); assert.equal(recovered.status,'succeeded');
  assert.equal((await store.operations()).length,1);
  assert.equal((await c.call('session_status')).data.writeFrozen,false);
});

test('执行超时不会取消 IDE；原操作 unknown 后阻止写入，晚到结果可核对',async()=> {
  const env=await setup(); let executions=0;
  const fixture=new FixtureAdapter();
  const adapter={reconcile:dir=>fixture.reconcile(dir),execute:async(req,dir,onStart)=> {
    executions++;
    if(req.command!=='change') return fixture.execute(req,dir,onStart);
    // 模拟派发完成后通道超时；IDE 自身在后台继续并稍后发布证据。
    setTimeout(()=>{void fixture.execute(req,dir,onStart);},80);
    throw new DomainError('unknown','IDE_TIMEOUT','测试超时');
  }};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try {
    const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});
    const target={projectId:opened.data.session.projectId,applicationId:app};
    const read=await service.call('object_read',{...target,objectId:obj});
    const args={...target,requestId:'timeout',objectId:obj,expectedHash:read.data.contentHash,declaration:read.data.declaration,implementation:'// 晚到结果'};
    const unknown=await service.call('code_apply_change',args); assert.equal(unknown.status,'unknown');
    assert.equal((await service.call('code_apply_change',args)).status,'unknown');
    await assert.rejects(()=>service.call('project_build',{...target,requestId:'blocked'}),e=>e.code==='PENDING_UNKNOWN');
    await new Promise(r=>setTimeout(r,160));
    assert.equal((await service.call('operation_status',{operationId:unknown.operationId,reconcile:true})).status,'succeeded');
    assert.equal(executions,3);
  } finally {await service.store.release();}
});

test('写后结果发布失败时即时冻结；恢复发布后只核对原结果',async()=> {
  const env=await setup(); const fixture=new FixtureAdapter(); let dispatches=0;
  const adapter={reconcile:dir=>fixture.reconcile(dir),execute:(...args)=>{dispatches++;return fixture.execute(...args);}};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try {
    const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});
    const target={projectId:opened.data.session.projectId,applicationId:app};
    const r=await service.call('object_read',{...target,objectId:obj});
    const save=service.store.saveOp.bind(service.store);
    service.store.saveOp=async op=>{if(op.status!=='running')throw new Error('测试：结果发布失败');return save(op);};
    const failed=await service.call('code_apply_change',{...target,objectId:obj,requestId:'publish-fail',expectedHash:r.data.contentHash,declaration:r.data.declaration,implementation:'// 已写入但响应发布失败'});
    assert.equal(failed.status,'unknown'); assert.equal(failed.error.code,'PERSISTENCE_ERROR');
    assert.equal((await service.call('session_status',{})).data.writeFrozen,true);
    await assert.rejects(()=>service.call('project_build',{...target,requestId:'blocked'}),e=>e.code==='PERSISTENCE_ERROR');
    service.store.saveOp=save;
    assert.equal((await service.call('operation_status',{operationId:failed.operationId,reconcile:true})).status,'succeeded');
    assert.equal(dispatches,3); assert.equal((await service.call('session_status',{})).data.writeFrozen,false);
  } finally {await service.store.release();}
});
