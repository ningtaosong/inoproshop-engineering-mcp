import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect,app,app2,obj} from './helpers.mjs';
import {Store,codeHash} from '../dist/storage.js';
import {schemas,DomainError} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

const code={name:'FB_DelayAlarm',pouType:'function_block',declaration:'FUNCTION_BLOCK FB_DelayAlarm\nVAR_OUTPUT\nAlarm : BOOL;\nEND_VAR',implementation:'// 中文创建\nAlarm := FALSE;'};
const creation=(s,snapshot)=>({requestId:'create',projectId:s.projectId,targetKind:'application',applicationId:app,parentId:app,expectedSnapshot:snapshot,...code});

test('POU 创建经真实 stdio：精确应用、同名冲突、检查点、并发去重、重启复用与源保护',async t=>{
  const env=await setup();
  const source=JSON.parse(await readFile(env.source,'utf8'));
  source.objects.push({objectId:randomUUID(),applicationId:app2,path:['设备','应用二',code.name],declaration:code.declaration,implementation:'// 另一个 Application 的同名 FB'});
  await writeFile(env.source,JSON.stringify(source));const original=await readFile(env.source);
  let c=await connect(env.dataDir);t.after(()=>c.client.close());
  const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app}));
  const s=opened.data.session;const args=creation(s,opened.data.snapshot);
  const [a,b]=await Promise.all([c.call('pou_create',args),c.call('pou_create',args)]);
  assert.equal(a.operationId,b.operationId);const created=await c.done(a);
  assert.equal(created.status,'succeeded',JSON.stringify(created));assert.equal(created.data.applicationId,app);
  assert.equal(created.data.parentId,app);assert.deepEqual(created.data.path,['设备','应用一',code.name]);
  assert.equal(created.data.created,true);assert.equal(created.data.reopened,true);assert.equal(created.data.persistedToWorkingCopy,true);
  assert.equal(created.data.contentHash,codeHash(code.declaration,code.implementation));
  assert.deepEqual(await readFile(created.data.checkpoint),original);
  const state=JSON.parse(await readFile(s.workingPath,'utf8'));
  assert.equal(state.objects.filter(o=>o.applicationId===app&&o.path.at(-1)===code.name).length,1);
  assert.equal(state.objects.find(o=>o.applicationId===app2&&o.path.at(-1)===code.name).implementation,'// 另一个 Application 的同名 FB');
  const lower=await c.done(await c.call('pou_create',{...args,requestId:'case-collision',expectedSnapshot:created.data.snapshot,name:'fb_delayalarm',declaration:code.declaration.replace(code.name,'fb_delayalarm')}));
  assert.equal(lower.status,'conflict');assert.equal(lower.error.code,'OBJECT_EXISTS');
  assert.equal((await c.call('pou_create',{...args,implementation:'different'})).error.code,'REQUEST_ID_REUSED');
  await c.client.close();c=await connect(env.dataDir);
  const duplicate=await c.call('pou_create',args);assert.equal(duplicate.operationId,created.operationId);assert.equal(duplicate.data.objectId,created.data.objectId);
  assert.deepEqual(await readFile(env.source),original);
  const ops=await new Store(env.dataDir).operations();assert.equal(ops.filter(o=>o.tool==='pou_create'&&o.status==='succeeded').length,1);
});

test('POU 创建拒绝过期快照、错误父 GUID/首部与超出本轮范围的输入',async t=>{
  const env=await setup();const c=await connect(env.dataDir);t.after(()=>c.client.close());
  const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app}));
  const args=creation(opened.data.session,opened.data.snapshot);
  const p=JSON.parse(await readFile(opened.data.session.workingPath,'utf8'));p.objects[0].implementation+='\n// 人工修改';await writeFile(opened.data.session.workingPath,JSON.stringify(p));
  const stale=await c.done(await c.call('pou_create',args));assert.equal(stale.error.code,'SNAPSHOT_CONFLICT');
  const parent=await c.done(await c.call('pou_create',{...args,requestId:'parent',parentId:app2}));assert.equal(parent.error.code,'PARENT_MISMATCH');
  const header=await c.done(await c.call('pou_create',{...args,requestId:'header',declaration:'PROGRAM FB_DelayAlarm'}));assert.equal(header.error.code,'INVALID_POU_DECLARATION');
  for(const extra of [{name:'../escape'},{pouType:'method'},{pouType:'function'},{returnType:'DINT'},{applicationId:null},{targetKind:'pool'},{language:'LD'}])assert.equal(schemas.pou_create.safeParse({...args,...extra}).success,false);
  assert.equal(JSON.parse(await readFile(opened.data.session.workingPath,'utf8')).objects.length,p.objects.length);
});

test('POU 部分创建失败只恢复新 GUID；恢复不明则冻结，重启不重放',async t=>{
  for(const unknown of [false,true]){
    const env=await setup({failCreateImplementation:true,failCreateRecovery:unknown});let c=await connect(env.dataDir);t.after(()=>c.client.close());
    const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app}));
    const args=creation(opened.data.session,opened.data.snapshot);const r=await c.done(await c.call('pou_create',args));
    assert.equal(r.status,unknown?'unknown':'failed');assert.equal(r.data.recovery.status,unknown?'unknown':'succeeded');assert.ok(r.data.partialContent.objectId);
    assert.equal(JSON.parse(await readFile(opened.data.session.workingPath,'utf8')).objects.length,unknown?3:2);
    if(unknown){
      await c.client.close();c=await connect(env.dataDir);
      assert.equal((await c.call('session_status')).data.writeFrozen,true);
      const duplicate=await c.call('pou_create',args);assert.equal(duplicate.operationId,r.operationId);assert.equal(duplicate.status,'unknown');
      const blocked=await c.call('pou_create',{...args,requestId:'do-not-replay'});assert.equal(blocked.error.code,'PENDING_UNKNOWN');
    }else{
      assert.equal(r.data.recovery.absentAfterReopen,true);
      assert.equal((await c.done(await c.call('object_read',{projectId:opened.data.session.projectId,applicationId:app,objectId:obj}))).status,'succeeded');
    }
  }
});

test('POU 创建成功响应缺少父身份/正确路径/检查点时冻结，不以 succeeded 放行',async()=>{
  for(const corrupt of [d=>{d.parentId=app2;},d=>{d.path=['错误位置',code.name];},d=>{d.objectType='program';},d=>{d.checkpoint='wrong';}]){
    const env=await setup();const fixture=new FixtureAdapter();
    const adapter={reconcile:d=>fixture.reconcile(d),execute:async(...args)=>{const r=await fixture.execute(...args);if(args[0].command==='create')corrupt(r.data);return r;}};
    const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
    try{
      const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});
      const r=await service.call('pou_create',creation(opened.data.session,opened.data.snapshot));
      assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');assert.equal((await service.status()).data.writeFrozen,true);
    }finally{await service.store.release();}
  }
});

test('POU 创建超时的晚到结果只核对原请求，新建 GUID 不重放',async()=>{
  const env=await setup();const fixture=new FixtureAdapter();let dispatches=0;
  const adapter={reconcile:d=>fixture.reconcile(d),execute:async(req,dir,onStart)=>{
    dispatches++;if(req.command!=='create')return fixture.execute(req,dir,onStart);
    setTimeout(()=>{void fixture.execute(req,dir,onStart);},60);throw new DomainError('unknown','IDE_TIMEOUT','测试创建超时');
  }};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try{
    const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});const args=creation(opened.data.session,opened.data.snapshot);
    const unknown=await service.call('pou_create',args);assert.equal(unknown.status,'unknown');
    assert.equal((await service.call('pou_create',args)).operationId,unknown.operationId);
    await assert.rejects(()=>service.call('pou_create',{...args,requestId:'blocked'}),e=>e.code==='PENDING_UNKNOWN');
    await new Promise(r=>setTimeout(r,160));const recovered=await service.operation({operationId:unknown.operationId,reconcile:true});
    assert.equal(recovered.status,'succeeded',JSON.stringify(recovered));assert.equal((await service.call('pou_create',args)).data.objectId,recovered.data.objectId);
    assert.equal(dispatches,2);assert.equal(JSON.parse(await readFile(opened.data.session.workingPath,'utf8')).objects.length,3);
  }finally{await service.store.release();}
});
