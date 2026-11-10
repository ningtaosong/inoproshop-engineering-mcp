import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setup,connect,app,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

test('生产缺少 IDE 返回 unsupported，不静默回退 fixture',async t=> {
  const env=await setup(); const c=await connect(env.dataDir,{INOPRO_TEST_MODE:'',INOPRO_EXE:path.join(env.dir,'missing.exe')}); t.after(()=>c.client.close());
  const e=await c.call('environment_inspect'); assert.notEqual(e.data.mode,'fixture-test-only'); assert.equal(e.data.ideInstalled,false);
  const p=path.join(env.dir,'测试.project'); await writeFile(p,await readFile(env.source));
  const opened=await c.done(await c.call('project_open_copy',{sourcePath:p,requestId:'unsupported'}));
  assert.equal(opened.status,'unsupported'); assert.equal(opened.error.code,'IDE_MISSING');
});

test('编译后即使 ST 未变，磁盘非文本配置变化也让保存证据失效',async t=> {
  const env=await setup(); const c=await connect(env.dataDir); t.after(()=>c.client.close());
  const opened=await c.done(await c.call('project_open_copy',{sourcePath:env.source,requestId:'open',applicationId:app}));
  const s=opened.data.session; const target={projectId:s.projectId,applicationId:app};
  const build=await c.done(await c.call('project_build',{...target,requestId:'build'}));
  const p=JSON.parse(await readFile(s.workingPath,'utf8')); p.deviceVersion='manually changed'; await writeFile(s.workingPath,JSON.stringify(p));
  const save=await c.done(await c.call('project_save',{...target,requestId:'save',expectedSnapshot:build.data.snapshot}));
  assert.equal(save.status,'conflict'); assert.equal(save.error.code,'BUILD_SNAPSHOT_STALE');
});

test('桥接返回错误对象时冻结',async()=> {
  const env=await setup(); const fixture=new FixtureAdapter();
  const adapter={reconcile:dir=>fixture.reconcile(dir),execute:async(req,dir,onStart)=> {
    const r=await fixture.execute(req,dir,onStart);
    if(req.command==='read') r.data.objectId='30000000-0000-4000-8000-000000000001';
    return r;
  }};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try {
    const open=await service.call('project_open_copy',{sourcePath:env.source,requestId:'open',applicationId:app});
    const r=await service.call('object_read',{projectId:open.data.session.projectId,applicationId:app,objectId:obj});
    assert.equal(r.status,'unknown'); assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
  } finally {await service.store.release();}
});

test('客户端取消只取消等待，原请求继续发布持久化结果',async t=> {
  const env=await setup({delayMs:250}); const c=await connect(env.dataDir,{INOPRO_RESPONSE_WAIT_MS:'5000'}); t.after(()=>c.client.close());
  const args={sourcePath:env.source,requestId:'cancelled',applicationId:app};
  const controller=new AbortController(); const pending=c.call('project_open_copy',args,{signal:controller.signal});
  // System birth-identity verification can precede admission. Cancel only
  // after this exact request is persisted, so the test measures cancellation
  // of a running request instead of racing an absent operation record.
  const deadline=Date.now()+10000;let admitted=false;
  while(Date.now()<deadline){const status=await c.call('session_status');if(status.data.pending.some(p=>p.requestId==='cancelled')){admitted=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert(admitted,'original request must be admitted before cancellation');controller.abort();await assert.rejects(pending);
  // Cancellation ends the client wait, not the engineering operation. Query
  // the original request to a bounded terminal result instead of assuming 320ms.
  const original=await c.done(await c.call('operation_status',{requestId:'cancelled'})); assert.equal(original.status,'succeeded');
  const duplicate=await c.call('project_open_copy',args); assert.equal(duplicate.operationId,original.operationId);
});

test('对象池使用 null Application 且不能越界读另一应用',async t=> {
  const env=await setup({applications:[],objects:[{objectId:obj,applicationId:null,path:['F_Test'],declaration:'FUNCTION F_Test : INT',implementation:'F_Test := 1;'}]});
  const c=await connect(env.dataDir); t.after(()=>c.client.close());
  const opened=await c.done(await c.call('project_open_copy',{sourcePath:env.source,requestId:'open-pool'}));
  assert.equal(opened.status,'succeeded',JSON.stringify(opened));
  assert.equal(opened.data.session.targetKind,'pool'); assert.equal(opened.data.session.applicationId,null);
  const target={projectId:opened.data.session.projectId,targetKind:'pool',applicationId:null};
  assert.equal((await c.done(await c.call('object_read',{...target,objectId:obj}))).status,'succeeded');
  assert.equal((await c.done(await c.call('object_read',{...target,targetKind:'application',objectId:obj}))).status,'conflict');
});
