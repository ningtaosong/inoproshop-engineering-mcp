import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,access } from 'node:fs/promises';
import path from 'node:path';
import { connect,setup,app,app2,obj,obj2 } from './helpers.mjs';
import { Store,codeHash } from '../dist/storage.js';

test('真实 stdio 协议：初始化、十七工具、中文同名对象、冲突、重复请求、错误再修复及重开',async t=> {
  const env=await setup(); const c=await connect(env.dataDir); t.after(()=>c.client.close());
  const tools=await c.client.listTools(); assert.equal(tools.tools.length,18);
  assert.ok(tools.tools.every(x=>x.inputSchema && x.outputSchema));
  const initial=await c.call('session_status'); assert.equal(initial.data.session,null);
  const inspect=await c.call('environment_inspect'); assert.equal(inspect.data.mode,'fixture-test-only');
  await assert.rejects(()=>access(env.dataDir),e=>e.code==='ENOENT');
  const openArgs={requestId:'open',sourcePath:env.source,applicationId:app};
  const opened=await c.done(await c.call('project_open_copy',openArgs)); assert.equal(opened.status,'succeeded');
  const session=opened.data.session; const target={projectId:session.projectId,applicationId:app};
  assert.notEqual(session.workingPath,env.source);
  const list=await c.done(await c.call('object_list',{...target,offset:0,limit:1})); assert.equal(list.data.objects[0].objectId,obj);
  const other=await c.done(await c.call('object_read',{...target,objectId:obj2})); assert.equal(other.status,'failed');
  const read=await c.done(await c.call('object_read',{...target,objectId:obj}));
  assert.equal(read.data.contentHash,codeHash(read.data.declaration,read.data.implementation));
  const change={...target,objectId:obj,requestId:'change',expectedHash:read.data.contentHash,declaration:read.data.declaration,implementation:read.data.implementation+'\n// 修改：中文、空格路径与 😀'};
  const result=await c.done(await c.call('code_apply_change',change)); assert.equal(result.status,'succeeded');
  assert.equal((await c.call('code_apply_change',change)).operationId,result.operationId);
  const reused=await c.call('code_apply_change',{...change,implementation:'不同参数'}); assert.equal(reused.error.code,'REQUEST_ID_REUSED');
  const stale=await c.done(await c.call('code_apply_change',{...change,requestId:'stale'})); assert.equal(stale.status,'conflict');
  const wrong=await c.done(await c.call('object_list',{...target,applicationId:app2})); assert.equal(wrong.status,'conflict');
  const bad=await c.done(await c.call('code_apply_change',{...change,requestId:'bad',expectedHash:result.data.contentHash,implementation:'SYNTAX_ERROR'}));
  const failedBuild=await c.done(await c.call('project_build',{...target,requestId:'build-bad'}));
  assert.equal(failedBuild.data.buildPassed,false); assert.equal(failedBuild.data.diagnostics.length,1);
  const fixed=await c.done(await c.call('code_apply_change',{...change,requestId:'fix',expectedHash:bad.data.contentHash}));
  const build=await c.done(await c.call('project_build',{...target,requestId:'build-fixed'}));
  assert.equal(build.data.buildPassed,true); assert.equal(build.data.snapshot,fixed.data.snapshot);
  const save=await c.done(await c.call('project_save',{...target,requestId:'save',expectedSnapshot:build.data.snapshot}));
  assert.equal(save.data.reopened,true); assert.equal(save.data.snapshot,build.data.snapshot);
  assert.equal(JSON.parse(await readFile(env.source,'utf8')).objects[0].implementation,read.data.implementation);
  assert.ok(JSON.parse(await readFile(session.workingPath,'utf8')).objects[0].implementation.includes('😀'));
  const opFiles=await new Store(env.dataDir).operations(); assert.ok(opFiles.every(x=>x.fingerprint));
  assert.equal(c.stderr(),'');
});

test('部分写入失败恢复、诊断不完整不能通过、保存拒绝过期快照',async t=> {
  const env=await setup({failImplementation:true}); const c=await connect(env.dataDir); t.after(()=>c.client.close());
  const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app}));
  const s=opened.data.session; const target={projectId:s.projectId,applicationId:app};
  const r=await c.done(await c.call('object_read',{...target,objectId:obj}));
  const changed=await c.done(await c.call('code_apply_change',{...target,requestId:'partial',objectId:obj,expectedHash:r.data.contentHash,declaration:'PROGRAM Changed',implementation:'other'}));
  assert.equal(changed.status,'failed'); assert.equal(changed.data.recovery.status,'succeeded');
  assert.equal(changed.data.recovery.contentHash,r.data.contentHash); assert.notEqual(changed.data.partialContent.declaration,r.data.declaration);
  const p=JSON.parse(await readFile(s.workingPath,'utf8')); p.incompleteDiagnostics=true; await writeFile(s.workingPath,JSON.stringify(p));
  const b=await c.done(await c.call('project_build',{...target,requestId:'incomplete'})); assert.equal(b.status,'unknown'); assert.equal(b.data.buildPassed,null);
  const frozen=await c.call('project_save',{...target,requestId:'save',expectedSnapshot:'0'.repeat(64)}); assert.equal(frozen.error.code,'PENDING_UNKNOWN');
});

test('同一业务请求并发到达只派发一次；状态查询保持响应',async t=> {
  const env=await setup({delayMs:250}); const c=await connect(env.dataDir); t.after(()=>c.client.close());
  const args={requestId:'same-concurrent',sourcePath:env.source,applicationId:app};
  const [a,b]=await Promise.all([c.call('project_open_copy',args),c.call('project_open_copy',args)]);
  assert.equal(a.operationId,b.operationId);
  const now=Date.now(); const status=await c.call('session_status'); assert.ok(Date.now()-now<200); assert.equal(status.data.pending.length,1);
  assert.equal((await c.done(a)).status,'succeeded');
  assert.equal((await new Store(env.dataDir).operations()).length,1);
});

test('跨进程数据目录和跨数据目录工程占用均拒绝',async t=> {
  const env=await setup(); const c=await connect(env.dataDir); const d=await connect(env.dataDir); const e=await connect(path.join(env.dir,'其他数据'));
  t.after(async()=>{await Promise.all([c.client.close(),d.client.close(),e.client.close()]);});
  const a={requestId:'open',sourcePath:env.source,applicationId:app};
  assert.equal((await c.done(await c.call('project_open_copy',a))).status,'succeeded');
  assert.equal((await d.call('project_open_copy',{...a,requestId:'second'})).error.code,'SESSION_BUSY');
  const occupied=await e.done(await e.call('project_open_copy',a)); assert.equal(occupied.status,'conflict'); assert.equal(occupied.error.code,'SESSION_BUSY');
});
