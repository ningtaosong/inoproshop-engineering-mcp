// 明确为 Fixture 契约/竞争/故障测试，不是 IDE 编译或 DSH 桌面证据。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,access,realpath,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect,app,app2,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {Store,digest,atomicJson,pathKey} from '../dist/storage.js';
import {reply} from '../dist/contracts.js';

const hash=async p=>digest(await readFile(p));
const target=s=>({projectId:s.projectId,applicationId:s.applicationId,targetKind:s.targetKind});
async function context(t,adapter=new FixtureAdapter()) {
  const env=await setup();const other=path.join(env.dir,'另一目录',path.basename(env.source));
  await mkdir(path.dirname(other));const b=JSON.parse(await readFile(env.source,'utf8'));
  b.objects[0].implementation='// B 的独立内容，相同 POU GUID';await writeFile(other,JSON.stringify(b));
  const services=[];
  const create=()=>{const s=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:10},adapter);services.push(s);return s;};
  const service=create();t.after(async()=>{for(const s of services)await s.store.release();});
  async function done(result,s=service){while(result.status==='running'){await new Promise(r=>setTimeout(r,5));result=await s.call('operation_status',{operationId:result.operationId});}return result;}
  const invoke=async(tool,args={},s=service)=>done(await s.call(tool,args),s);
  const open=(sourcePath,requestId='open-'+randomUUID(),s=service)=>invoke('project_open_copy',{sourcePath,requestId,applicationId:app},s);
  return {env,other,service,create,done,invoke,open};
}

test('A/B 同名源、相同 POU GUID：登记、副本路径复用、切回保留修改与独立编译状态',async t=>{
  const c=await context(t),{service:s}=c;const ah=await hash(c.env.source),bh=await hash(c.other);
  const a=(await c.open(c.env.source)).data.session,ta=target(a);
  const r=(await c.invoke('object_read',{...ta,objectId:obj})).data;
  const change=await c.invoke('code_apply_change',{...ta,objectId:obj,requestId:'change-A',expectedHash:r.contentHash,declaration:r.declaration,implementation:'// A 已修改'});
  const buildA=await c.invoke('project_build',{...ta,requestId:'build-A'});
  await c.invoke('project_save',{...ta,requestId:'save-A',expectedSnapshot:change.data.snapshot});
  const b=(await c.open(c.other)).data.session,tb=target(b);
  assert.notEqual(a.projectId,b.projectId);assert.equal(path.basename(a.sourcePath),path.basename(b.sourcePath));
  assert.equal((await c.invoke('object_read',{...tb,objectId:obj})).data.implementation,'// B 的独立内容，相同 POU GUID');
  await c.invoke('project_build',{...tb,requestId:'build-B'});
  await assert.rejects(()=>s.call('object_read',{...ta,objectId:obj}),e=>e.code==='PROJECT_NOT_ACTIVE');
  const back=await c.invoke('project_open_copy',{sourcePath:a.workingPath,requestId:'back-by-copy'});
  assert.equal(back.data.session.projectId,a.projectId);assert.equal(back.data.session.workingPath,a.workingPath);
  assert.equal((await c.invoke('object_read',{...ta,objectId:obj})).data.implementation,'// A 已修改');
  const list=(await s.call('project_list',{})).data;assert.equal(list.projects.length,2);
  assert.equal(list.activeProjectId,a.projectId);assert.equal(list.projects.find(p=>p.projectId===a.projectId).lastBuild.operationId,buildA.operationId);
  assert.notEqual(list.projects[0].lastBuild.operationId,list.projects[1].lastBuild.operationId);
  assert.equal(await hash(c.env.source),ah);assert.equal(await hash(c.other),bh);
  assert.ok((await s.store.operations()).find(o=>o.requestId==='change-A').response.data.checkpoint);
  // 切换期间两个已登记源锁和服务锁均保留，不靠整体 release 切换。
  for(const f of [s.store.file('service.lock'),s.store.sourceLock(a.sourcePath),s.store.sourceLock(b.sourcePath)])await access(f);
});

test('真实 stdio：服务正常重启恢复登记、稳定 ID、应用选择、编译和历史去重结果',async t=>{
  const env=await setup();let c=await connect(env.dataDir);t.after(()=>c.client.close());
  const args={sourcePath:env.source,requestId:'open',applicationId:app};
  const opened=await c.done(await c.call('project_open_copy',args));const s=opened.data.session;
  const build=await c.done(await c.call('project_build',{...target(s),requestId:'build'}));
  const before=await readFile(path.join(env.dataDir,'registry.json'),'utf8');await c.client.close();
  c=await connect(env.dataDir);const list=await c.call('project_list');
  assert.equal(list.data.activeProjectId,s.projectId);assert.equal(list.data.projects[0].lastBuild.operationId,build.operationId);
  assert.equal(list.data.projects[0].applicationId,app);assert.equal(list.data.projects[0].workingPath,s.workingPath);
  assert.equal(await readFile(path.join(env.dataDir,'registry.json'),'utf8'),before,'只读登记不写文件');
  const duplicate=await c.call('project_open_copy',args);assert.equal(duplicate.operationId,opened.operationId);
  assert.equal((await new Store(env.dataDir).operations()).length,2);
});

test('新请求打开已登记源或副本均复用；重复激活请求不再次切换或派发 IDE',async t=>{
  let count=0;const f=new FixtureAdapter();const c=await context(t,{reconcile:d=>f.reconcile(d),execute:(...a)=>{count++;return f.execute(...a);}});
  const a=(await c.open(c.env.source)).data.session;const b=(await c.open(c.other)).data.session;
  const args={projectId:a.projectId,requestId:'activate-once'};
  const back=await c.invoke('project_activate',args);const after=count;
  assert.equal((await c.invoke('project_activate',args)).operationId,back.operationId);assert.equal(count,after);
  await c.invoke('project_activate',{projectId:b.projectId,requestId:'to-b'});
  // 原请求查询/重试只能返回原结果，不再次激活 A。
  await c.invoke('project_activate',args);assert.equal((await c.service.store.session()).projectId,b.projectId);
  const again=await c.open(c.env.source,'new-open');assert.equal(again.data.session.projectId,a.projectId);
  assert.equal(again.data.session.workingPath,a.workingPath);assert.equal((await c.service.store.registry()).projects.length,2);
});

test('切换受理后排队的旧 A 请求执行前拒绝，不能用相同 GUID 读取 B',async t=>{
  const f=new FixtureAdapter();let hold=false,release,enteredResolve;
  const entered=new Promise(r=>enteredResolve=r),barrier=new Promise(r=>release=r);const dispatched=[];
  const c=await context(t,{reconcile:d=>f.reconcile(d),execute:async(req,...rest)=>{
    dispatched.push({command:req.command,path:req.projectPath});if(hold&&req.command==='inspect'){enteredResolve();await barrier;}return f.execute(req,...rest);
  }});
  const a=(await c.open(c.env.source)).data.session,b=(await c.open(c.other)).data.session;
  await c.invoke('project_activate',{requestId:'initial-back',projectId:a.projectId});hold=true;
  const switching=c.service.call('project_activate',{requestId:'switch-B',projectId:b.projectId});await entered;
  const queued=c.service.call('object_read',{...target(a),objectId:obj});
  const queuedFirst=await queued;assert.equal(queuedFirst.status,'running');release();
  assert.equal((await c.done(await switching)).status,'succeeded');
  const rejected=await c.done(queuedFirst);assert.equal(rejected.status,'conflict');assert.equal(rejected.error.code,'PROJECT_NOT_ACTIVE');
  assert.equal(dispatched.filter(x=>x.command==='read').length,0);
});

test('运行和排队操作存在时拒绝切换，状态/登记查询不阻塞、不打开 IDE',async t=>{
  const f=new FixtureAdapter();let release,enteredResolve;let hold=false;
  const entered=new Promise(r=>enteredResolve=r),barrier=new Promise(r=>release=r);
  const c=await context(t,{reconcile:d=>f.reconcile(d),execute:async(req,...rest)=>{if(hold&&req.command==='read'){enteredResolve();await barrier;}return f.execute(req,...rest);}});
  const a=(await c.open(c.env.source)).data.session;hold=true;
  const first=c.service.call('object_read',{...target(a),objectId:obj});await entered;
  await assert.rejects(()=>c.service.call('project_open_copy',{requestId:'blocked-switch',sourcePath:c.other,applicationId:app}),e=>e.code==='PENDING_OPERATION');
  assert.equal((await c.service.call('project_list',{})).data.activeProjectId,a.projectId);
  assert.equal((await c.service.call('session_status',{})).data.pending.length,1);release();await c.done(await first);
});

test('打开失败、外部修改或副本丢失均保留 A，失败临时锁只释放自己的源锁',async t=>{
  const c=await context(t),a=(await c.open(c.env.source)).data.session;
  await writeFile(c.other,JSON.stringify({notFixture:true}));const failed=await c.open(c.other);assert.equal(failed.status,'failed');
  assert.equal((await c.service.store.session()).projectId,a.projectId);await access(c.service.store.file('service.lock'));
  await access(c.service.store.sourceLock(a.sourcePath));await assert.rejects(()=>access(c.service.store.sourceLock(c.other)));
  await copyFile(c.env.source,c.other);const b=(await c.open(c.other)).data.session;
  await c.invoke('project_activate',{projectId:a.projectId,requestId:'back'});
  const original=await readFile(b.workingPath);await writeFile(b.workingPath,Buffer.concat([original,Buffer.from(' ')]));
  const conflict=await c.invoke('project_activate',{projectId:b.projectId,requestId:'external'});assert.equal(conflict.error.code,'WORKING_COPY_CHANGED');
  assert.equal((await c.service.store.session()).projectId,a.projectId);
  await unlink(b.workingPath);
  assert.equal((await c.invoke('project_activate',{projectId:b.projectId,requestId:'missing-copy'})).status,'failed');
  assert.equal((await c.service.store.session()).projectId,a.projectId);
  const missing=await c.invoke('project_open_copy',{sourcePath:path.join(c.env.dir,'missing.json'),requestId:'missing'});assert.equal(missing.status,'failed');
  assert.equal((await c.service.store.session()).projectId,a.projectId);
});

for(const when of ['before','after'])test(`切换登记发布${when==='before'?'前':'后'}中断：只核对原结果，恢复后不重复 IDE 操作`,async t=>{
  let dispatches=0;const f=new FixtureAdapter();const c=await context(t,{reconcile:d=>f.reconcile(d),execute:(...a)=>{dispatches++;return f.execute(...a);}});
  const a=(await c.open(c.env.source)).data.session,b=(await c.open(c.other)).data.session;
  await c.invoke('project_activate',{projectId:a.projectId,requestId:'back'});
  const put=c.service.store.put.bind(c.service.store);let once=true;
  c.service.store.put=async(name,value)=>{if(name==='registry.json'&&value.activeProjectId===b.projectId&&once){once=false;if(when==='after')await put(name,value);throw Error('测试注入：登记发布中断');}return put(name,value);};
  const interrupted=await c.invoke('project_activate',{projectId:b.projectId,requestId:'interrupted'});
  assert.equal(interrupted.status,'unknown');assert.equal((await c.service.call('session_status',{})).data.writeFrozen,true);
  assert.equal((await c.service.store.registry()).activeProjectId,when==='before'?a.projectId:b.projectId);
  await assert.rejects(()=>c.service.call('project_activate',{projectId:a.projectId,requestId:'cannot-switch'}),e=>e.code==='PERSISTENCE_ERROR');
  c.service.store.put=put;const count=dispatches;
  const recovered=await c.service.call('operation_status',{operationId:interrupted.operationId,reconcile:true});
  assert.equal(recovered.status,'succeeded');assert.equal(dispatches,count);assert.equal((await c.service.store.session()).projectId,b.projectId);
  assert.equal((await c.service.call('session_status',{})).data.writeFrozen,false);
});

test('切换在结果记录发布时中断，正常重启后恢复原切换、不重新打开工程',async t=>{
  const c=await context(t),a=(await c.open(c.env.source)).data.session;
  const save=c.service.store.saveOp.bind(c.service.store);
  c.service.store.saveOp=async op=>{if(op.requestId==='open-B'&&op.status!=='running')throw Error('测试：最终响应发布中断');return save(op);};
  const pending=await c.open(c.other,'open-B');assert.equal(pending.status,'unknown');
  await c.service.store.release();const restarted=c.create();
  const old=(await restarted.store.operations()).find(o=>o.requestId==='open-B');old.ownerPid=2147483647;await restarted.store.saveOp(old);
  const list=await restarted.call('project_list',{});assert.equal(list.data.projects.length,2);assert.equal(list.data.writeFrozen,true);
  const recovered=await restarted.call('operation_status',{operationId:old.operationId,reconcile:true});assert.equal(recovered.status,'succeeded');
  assert.notEqual((await restarted.store.session()).projectId,a.projectId);
  assert.equal((await restarted.store.operations()).length,2);
});

test('旧布局隔离兼容：只读不迁移；首次正常操作原子迁移，旧文件/ID/日志/检查点保留',async t=>{
  const c=await context(t),store=c.service.store;
  const workingPath=path.join(c.env.dir,'旧副本.json');await copyFile(c.env.source,workingPath);
  const legacy={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:c.env.source,workingPath,sourceHash:await hash(c.env.source),applicationId:app2,targetKind:'application'};
  await store.saveSession(legacy);const legacyBytes=await readFile(store.file('session.json'));
  const id=randomUUID(),checkpoint=store.file('ipc/'+id+'/checkpoint.project');await mkdir(path.dirname(checkpoint),{recursive:true});await copyFile(workingPath,checkpoint);
  await store.saveOp({schemaVersion:1,operationId:id,requestId:'historical',tool:'object_read',args:{...target(legacy),objectId:obj},fingerprint:'legacy-fingerprint',status:'succeeded',ownerPid:2147483647,startedAt:new Date().toISOString(),response:{...reply('succeeded','旧结果'),operationId:id}});
  const opBytes=await readFile(store.file('operations/'+id+'.json')),checkpointHash=await hash(checkpoint);
  assert.equal((await c.service.call('project_list',{})).data.activeProjectId,legacy.projectId);
  await assert.rejects(()=>access(store.file('registry.json')));
  const activated=await c.invoke('project_activate',{projectId:legacy.projectId,requestId:'migrate'});assert.equal(activated.status,'succeeded');
  assert.equal(activated.data.session.applicationId,app2);assert.equal(activated.data.session.workingPath,workingPath);
  assert.deepEqual(await readFile(store.file('session.json')),legacyBytes);assert.deepEqual(await readFile(store.file('operations/'+id+'.json')),opBytes);assert.equal(await hash(checkpoint),checkpointHash);
  assert.equal((await c.service.call('operation_status',{operationId:id})).summary,'旧结果');
});

test('原单工程迁移发布中断：旧文件未变，新服务能从旧文件幂等恢复',async t=>{
  const c=await context(t),s={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:c.env.source,workingPath:c.env.source,sourceHash:await hash(c.env.source),applicationId:app,targetKind:'application'};
  await mkdir(c.service.store.file('operations'),{recursive:true}); // 隔离的完整旧布局，不把缺失目录伪装为空。
  await c.service.store.saveSession(s);const before=await readFile(c.service.store.file('session.json'));
  const put=c.service.store.put.bind(c.service.store);c.service.store.put=async(name,v)=>{if(name==='registry.json')throw Error('测试：迁移发布失败');return put(name,v);};
  await assert.rejects(()=>c.service.call('project_activate',{projectId:s.projectId,requestId:'migrate-fail'}),e=>e.status==='unknown');
  assert.deepEqual(await readFile(c.service.store.file('session.json')),before);await c.service.store.release();
  const restarted=c.create();assert.equal((await restarted.call('project_list',{})).data.activeProjectId,s.projectId);
  assert.equal((await c.invoke('project_activate',{projectId:s.projectId,requestId:'migrate-recovered'},restarted)).status,'succeeded');
});

test('非活动工程的历史晚到编译按原 projectId 核对，绝不回写 B 或改变活动项',async t=>{
  const c=await context(t),a=(await c.open(c.env.source)).data.session,b=(await c.open(c.other)).data.session;
  const operationId=randomUUID(),dir=c.service.store.file('ipc/'+operationId),args={...target(a),requestId:'legacy-late-build'};
  const raw=await new FixtureAdapter().execute({operationId,command:'build',projectPath:a.workingPath,args},dir,()=>{});
  await c.service.store.saveOp({schemaVersion:1,operationId,requestId:args.requestId,tool:'project_build',args,fingerprint:'legacy',status:'running',ownerPid:2147483647,startedAt:new Date().toISOString(),bridge:{directory:dir}});
  await assert.rejects(()=>c.service.call('project_activate',{projectId:a.projectId,requestId:'blocked'}),e=>e.code==='PENDING_UNKNOWN');
  const recovered=await c.service.call('operation_status',{operationId,reconcile:true});assert.equal(recovered.status,'succeeded');
  const r=await c.service.store.registry();assert.equal(r.activeProjectId,b.projectId);
  assert.equal(r.projects.find(p=>p.projectId===a.projectId).lastBuild.operationId,operationId);
  assert.equal(r.projects.find(p=>p.projectId===b.projectId).lastBuild,undefined);assert.equal(recovered.data.diskHash,raw.data.diskHash);
});

test('损坏登记/操作、登记丢失均冻结；已确认原操作仍能按 operationId 查询',async t=>{
  const c=await context(t),opened=await c.open(c.env.source),r=await c.service.store.registry();
  await c.service.store.put('registry.json',{...r,activeProjectId:randomUUID()});
  assert.equal((await c.service.call('session_status',{})).status,'unknown');
  await assert.rejects(()=>c.service.call('project_activate',{projectId:opened.data.session.projectId,requestId:'corrupt'}),e=>e.status==='unknown');
  assert.equal((await c.service.call('operation_status',{operationId:opened.operationId})).status,'succeeded');
  await c.service.store.put('registry.json',r);
  const another=randomUUID();await writeFile(c.service.store.file('operations/'+another+'.json'),'{broken');
  assert.equal((await c.service.call('session_status',{})).data.writeFrozen,true);
  assert.equal((await c.service.call('operation_status',{operationId:opened.operationId})).status,'succeeded');
});

test('源锁原目录缺失、记录损坏或未决时不接管，正常失败不释放服务锁',async t=>{
  for(const reason of ['missing','corrupt','unknown']) {
    const c=await context(t);const source=await realpath(c.env.source),foreign=path.join(c.env.dir,'原锁数据-'+reason),lock=c.service.store.sourceLock(source);
    if(reason!=='missing'){
      const store=new Store(foreign);await mkdir(store.file('operations'),{recursive:true});
      const legacy={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:source,workingPath:source,sourceHash:await hash(source)};
      await store.saveSession(legacy);
      if(reason==='corrupt')await writeFile(store.file('session.json'),'bad');
      else await store.saveOp({schemaVersion:1,operationId:randomUUID(),requestId:'old',tool:'project_build',args:{},fingerprint:'old',status:'unknown',ownerPid:2147483647,startedAt:new Date().toISOString()});
    }
    await atomicJson(lock,{pid:2147483647,dataDir:foreign,createdAt:new Date().toISOString()});const lockHash=await hash(lock);
    const result=await c.open(c.env.source);assert.equal(result.status,'unknown',reason+JSON.stringify(result));assert.equal(await hash(lock),lockHash);
    assert.equal((await c.service.call('session_status',{})).data.writeFrozen,true);await access(c.service.store.file('service.lock'));
  }
});

test('首次多应用不猜目标；选择失败保留活动项及原副本，随后精确选择复用候选',async t=>{
  const c=await context(t),a=(await c.open(c.env.source)).data.session;
  const failed=await c.invoke('project_open_copy',{sourcePath:c.other,requestId:'ambiguous'});
  assert.equal(failed.status,'conflict');assert.equal((await c.service.store.session()).projectId,a.projectId);
  const selected=await c.open(c.other);assert.equal(selected.status,'succeeded');assert.equal(selected.data.session.workingPath,failed.data.workingPath);
});

test('只读登记在空目录不创建文件或启动 IDE',async t=>{
  let dispatches=0;const c=await context(t,{execute:()=>{dispatches++;throw Error('不可派发');},reconcile:()=>{throw Error('不可核对');}});
  const result=await c.service.call('project_list',{});assert.deepEqual(result.data.projects,[]);assert.equal(result.data.activeProjectId,null);
  await assert.rejects(()=>access(c.env.dataDir));assert.equal(dispatches,0);
});

test('请求入队前发布中断：不派发 IDE，当前服务冻结而非继续接受新切换',async t=>{
  let dispatches=0;const f=new FixtureAdapter();const c=await context(t,{reconcile:d=>f.reconcile(d),execute:(...a)=>{dispatches++;return f.execute(...a);}});
  const a=(await c.open(c.env.source)).data.session,count=dispatches;
  c.service.store.saveOp=async()=>{throw Error('测试：请求发布中断');};
  const result=await c.service.call('project_activate',{projectId:a.projectId,requestId:'admission-interrupted'});
  assert.equal(result.status,'unknown');assert.equal(result.error.code,'PERSISTENCE_ERROR');assert.equal(dispatches,count);
  assert.equal((await c.service.call('session_status',{})).data.writeFrozen,true);
  await assert.rejects(()=>c.service.call('project_open_copy',{sourcePath:c.other,requestId:'cannot-switch',applicationId:app}),e=>e.code==='PERSISTENCE_ERROR');
});

test('新格式登记丢失不回退 session 或重新复制；无桥接结果的原切换持续冻结',async t=>{
  const c=await context(t),a=(await c.open(c.env.source)).data.session;
  await unlink(c.service.store.file('registry.json'));
  assert.equal((await c.service.call('session_status',{})).data.writeFrozen,true);
  await assert.rejects(()=>c.service.call('project_activate',{projectId:a.projectId,requestId:'missing-registry'}),e=>e.status==='unknown');
  const d=await context(t),opened=(await d.open(d.env.source)).data.session,r=await d.service.store.registry();
  const id=randomUUID();await d.service.store.saveOp({schemaVersion:1,registryVersion:1,operationId:id,requestId:'before-bridge',tool:'project_activate',
    args:{projectId:opened.projectId},fingerprint:'original',status:'running',ownerPid:2147483647,startedAt:new Date().toISOString(),project:opened,
    activation:{previousActiveProjectId:r.activeProjectId,revision:r.revision}});
  const result=await d.service.call('operation_status',{operationId:id,reconcile:true});assert.equal(result.status,'unknown');
  assert.equal((await d.service.store.session()).projectId,opened.projectId);
  await assert.rejects(()=>d.service.call('project_open_copy',{sourcePath:d.other,requestId:'no-replay',applicationId:app}),e=>e.code==='PENDING_UNKNOWN');
});

test('安全退出核对全部锁归属；同 PID 的外部替换不能导致部分锁先被删除',async t=>{
  const c=await context(t),a=(await c.open(c.env.source)).data.session,lock=c.service.store.sourceLock(a.sourcePath);
  const original=await readFile(lock);await atomicJson(lock,{pid:process.pid,dataDir:path.join(c.env.dir,'其他所属目录')});
  try {
    await assert.rejects(()=>c.service.store.release(),e=>e.code==='LOCK_CHANGED');
    await access(c.service.store.file('service.lock'));await access(lock);
  } finally {await writeFile(lock,original);}
});

test('同时核对多个原结果也串行提交，各工程编译状态不相互覆盖',async t=>{
  const f=new FixtureAdapter();let active=0,maxActive=0;
  const c=await context(t,{execute:(...a)=>f.execute(...a),reconcile:async d=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,30));try{return await f.reconcile(d);}finally{active--;}}});
  const a=(await c.open(c.env.source)).data.session,b=(await c.open(c.other)).data.session,ids=[];
  for(const s of [a,b]){
    const operationId=randomUUID(),dir=c.service.store.file('ipc/'+operationId),args={...target(s),requestId:'late-'+s.projectId};
    await f.execute({operationId,command:'build',projectPath:s.workingPath,args},dir,()=>{});
    await c.service.store.saveOp({schemaVersion:1,registryVersion:1,operationId,requestId:args.requestId,tool:'project_build',args,fingerprint:'late',status:'unknown',ownerPid:2147483647,startedAt:new Date().toISOString(),project:s,bridge:{directory:dir}});ids.push(operationId);
  }
  const results=await Promise.all(ids.map(operationId=>c.service.call('operation_status',{operationId,reconcile:true})));
  assert.ok(results.every(r=>r.status==='succeeded'));assert.equal(maxActive,1);
  const r=await c.service.store.registry();assert.equal(r.activeProjectId,b.projectId);
  assert.deepEqual(r.projects.map(s=>s.lastBuild.operationId),ids);
});

test('本数据目录旧 session 存在但操作目录缺失时冻结，不建立新登记或接管源锁',async t=>{
  const c=await context(t),s={projectId:randomUUID(),sessionId:randomUUID(),sourcePath:c.env.source,workingPath:c.env.source,sourceHash:await hash(c.env.source),applicationId:app,targetKind:'application'};
  await c.service.store.saveSession(s);const original=await readFile(c.service.store.file('session.json'));
  const status=await c.service.call('session_status',{});assert.equal(status.status,'unknown');assert.equal(status.data.writeFrozen,true);
  await assert.rejects(()=>c.service.call('project_activate',{projectId:s.projectId,requestId:'records-missing'}),e=>e.status==='unknown');
  await assert.rejects(()=>access(c.service.store.file('registry.json')));
  await assert.rejects(()=>access(c.service.store.sourceLock(s.sourcePath)));
  assert.deepEqual(await readFile(c.service.store.file('session.json')),original);
});
