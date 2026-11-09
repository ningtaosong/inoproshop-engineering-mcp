// Synthetic unknown records/native process doubles; these are NOT real IDE fault evidence.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {setup,app,obj,connect} from './helpers.mjs';
import {Store,canonical,digest,atomicJson} from '../dist/storage.js';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {evaluateIsolation,generatePlan,commitIsolation,isolationState,assertNotIsolated,maintenanceGate,isolationDirectory} from '../dist/isolation.js';
const dead=2147483647;const target=s=>({projectId:s.projectId,applicationId:app,targetKind:'application'});
async function inventory(root){const rows=[];async function walk(dir){for(const n of await fs.readdir(dir)){const p=path.join(dir,n);if((await fs.stat(p)).isDirectory())await walk(p);else rows.push([p,digest(await fs.readFile(p))]);}}await walk(root);return rows.sort();}
async function context(t) {
 const env=await setup(),fixture=new FixtureAdapter();let dispatches=[];const services=[];
 const adapter={reconcile:d=>fixture.reconcile(d),execute:(r,...args)=>{dispatches.push(r);return fixture.execute(r,...args);}};
 const create=()=>{const s=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);services.push(s);return s;};
 let service=create();const opened=await service.call('project_open_copy',{requestId:'original-open',sourcePath:env.source,applicationId:app}),s=opened.data.session;
 await service.store.release();const store=service.store;
 const operationId=randomUUID(),args={requestId:'original-unknown',...target(s),expectedSnapshot:s.snapshot},directory=store.file('ipc/'+operationId);
 const op={schemaVersion:1,registryVersion:1,operationId,requestId:args.requestId,tool:'project_save',args,fingerprint:digest(canonical({tool:'project_save',args})),status:'unknown',ownerPid:dead,startedAt:new Date().toISOString(),project:s,bridge:{directory,pid:dead}};
 await store.saveOp(op);await atomicJson(path.join(directory,'request.json'),{operationId,command:'save',projectPath:s.workingPath,args});
 await atomicJson(path.join(directory,'dispatched.json'),{operationId,pid:dead});
 await atomicJson(path.join(directory,'result.json'),{contractVersion:'1.0.0',status:'unknown',summary:'fixture reopen uncertainty',operationId});
 const lock={pid:dead,dataDir:env.dataDir,createdAt:new Date().toISOString()};
 await atomicJson(store.file('service.lock'),lock);await atomicJson(store.sourceLock(s.sourcePath),lock);
 const anchors=[];
 t.after(async()=>{
   for(const sv of services)await sv.store.release();
   for(const f of await fs.readdir(isolationDirectory).catch(()=>[])){
     const p=path.join(isolationDirectory,f);const r=JSON.parse(await fs.readFile(p,'utf8'));
     if(r.value?.dataDir===env.dataDir)await fs.unlink(p); // ONLY this test's generated anchors, never real evidence.
   }
 });
 const plan=()=>generatePlan(env.dataDir,operationId,'synthetic fault isolation test');
 return {env,s,store,op,adapter,create,service,plan,dispatches};
}
test('只读评估和计划不写现场、不派发 IDE；准确归属并保留未知',async t=>{
 const c=await context(t),before=await inventory(c.env.dataDir),count=c.dispatches.length;
 const a=await evaluateIsolation(c.env.dataDir,c.op.operationId),p=await c.plan();
 assert.equal(a.eligible,true,JSON.stringify(a.blockers));assert.equal(p.projectId,c.s.projectId);assert.equal(p.canReleaseOtherProjects,true);
 assert.deepEqual(await inventory(c.env.dataDir),before);assert.equal(c.dispatches.length,count);assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});
test('活动原进程、损坏登记、错误归属均拒绝处置',async t=>{
 const c=await context(t);const valid=await fs.readFile(c.store.file('registry.json'));
 c.op.bridge.pid=process.pid;await c.store.saveOp(c.op);let p=await c.plan();assert.equal(p.eligible,false);await assert.rejects(()=>commitIsolation(p),e=>e.code==='PLAN_BLOCKED');
 c.op.bridge.pid=dead;c.op.project={...c.s,projectId:randomUUID()};await c.store.saveOp(c.op);p=await c.plan();assert.equal(p.eligible,false);assert.ok(p.blockers.some(x=>x.includes('绑定')));
 c.op.project=c.s;await c.store.saveOp(c.op);await fs.writeFile(c.store.file('registry.json'),'{broken');p=await c.plan();assert.equal(p.eligible,false);await assert.rejects(()=>commitIsolation(p),e=>e.code==='PLAN_BLOCKED');await fs.writeFile(c.store.file('registry.json'),valid);
});
test('计划过期（文件、锁、进程与操作归属变化）全部拒绝，原记录不改',async t=>{
 for(const change of ['file','lock','process','ownership']){
   const c=await context(t),p=await c.plan();
   if(change==='file')await fs.appendFile(c.s.workingPath,' ');
   if(change==='lock')await atomicJson(c.store.sourceLock(c.s.sourcePath),{pid:dead,dataDir:c.env.dataDir,changed:true});
   if(change==='process'){c.op.ownerPid=process.pid;await c.store.saveOp(c.op);}
   if(change==='ownership'){c.op.project={...c.s,sessionId:randomUUID()};await c.store.saveOp(c.op);}
   await assert.rejects(()=>commitIsolation(p),e=>e.code==='PLAN_STALE');assert.equal(await c.store.get('isolation-ledger.json'),undefined);
 }
});
test('活动服务持有排他锁时拒绝；维护 gate 阻止新派发，旧标记不自动移除',async t=>{
 const c=await context(t),p=await c.plan();await atomicJson(c.store.file('service.lock'),{pid:process.pid,dataDir:c.env.dataDir});
 await assert.rejects(()=>commitIsolation(p),e=>e.code==='PLAN_STALE');
 await atomicJson(maintenanceGate,{pid:dead,planId:'interrupted-test'});
 try{await assert.rejects(()=>c.service.call('project_open_copy',{requestId:'busy',sourcePath:c.env.source,applicationId:app}),e=>e.code==='MAINTENANCE_EXCLUSIVE');assert.equal((await c.service.status()).data.globalFrozen,true);}
 finally{await fs.unlink(maintenanceGate);}
});
test('提交去重、重启；原未知/登记/工程/锁字节不变，状态区分工程隔离与全局冻结',async t=>{
 const c=await context(t),p=await c.plan(),before=await inventory(c.env.dataDir),lockBefore=await fs.readFile(c.store.sourceLock(c.s.sourcePath));
 const first=await commitIsolation(p),second=await commitIsolation(p);assert.equal(first.deduplicated,false);assert.equal(second.deduplicated,true);
 for(const [file,hash] of before)assert.equal(digest(await fs.readFile(file)),hash,file);assert.deepEqual(await fs.readFile(c.store.sourceLock(c.s.sourcePath)),lockBefore);
 const sv=c.create(),status=await sv.call('session_status',{});assert.equal(status.data.globalFrozen,false);assert.equal(status.data.writeFrozen,true);assert.equal(status.data.availability,'active-project-isolated');assert.equal(status.data.pending[0].status,'unknown');
 assert.equal((await isolationState(new Store(c.env.dataDir))).own.length,1);assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});
test('并发提交只提交一次，另一提交忙或去重，不出现重复处置',async t=>{
 const c=await context(t),p=await c.plan();const results=await Promise.allSettled([commitIsolation(p),commitIsolation(p)]);
 assert.ok(results.some(x=>x.status==='fulfilled'));for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'MAINTENANCE_EXCLUSIVE');
 assert.equal((await isolationState(c.store)).own.length,1);
});
test('持久化各阶段中断均保持冻结；完整提交后的中断可只读核对并去重',async t=>{
 for(const stage of ['journal','prepared','anchor','local-committed','committed']) {
  const c=await context(t),p=await c.plan();await assert.rejects(()=>commitIsolation(p,{afterStage:async s=>{if(s===stage)throw Error('injected '+stage);}}),/injected/);
  const status=await c.service.status();
  if(stage==='committed'){assert.equal(status.data.globalFrozen,false);assert.equal((await commitIsolation(p)).deduplicated,true);}
  else {assert.equal(status.data.globalFrozen,true);await assert.rejects(()=>c.service.call('project_open_copy',{requestId:'no-partial-recovery',sourcePath:c.env.source,applicationId:app}));}
  // Preserve test observations in the test log; remove only the synthetic public anchor before next subcase.
  for(const f of await fs.readdir(isolationDirectory).catch(()=>[])){const file=path.join(isolationDirectory,f),r=JSON.parse(await fs.readFile(file));if(r.value?.dataDir===c.env.dataDir)await fs.unlink(file);}
 }
});
test('源、副本、大小写/realpath/硬链接别名和跨数据目录导入持续受阻，新编号无效；相同哈希独立文件不当成同工程',async t=>{
 const c=await context(t),p=await c.plan();await commitIsolation(p);const sv=c.create(),count=c.dispatches.length;
 const hardlink=path.join(c.env.dir,'hardlink.json');await fs.link(c.s.workingPath,hardlink);
 const junction=path.join(c.env.dir,'alias-dir');await fs.symlink(path.dirname(c.s.workingPath),junction,'junction');
 for(const sourcePath of [c.env.source,c.s.workingPath,c.env.source.toUpperCase(),hardlink,path.join(junction,path.basename(c.s.workingPath))])
  await assert.rejects(()=>sv.call('project_open_copy',{requestId:randomUUID(),sourcePath,applicationId:app}),e=>e.code==='PROJECT_ISOLATED');
 await assert.rejects(()=>sv.call('project_activate',{requestId:'new-activation',projectId:c.s.projectId}),e=>e.code==='PROJECT_ISOLATED');
 await assert.rejects(()=>sv.call('project_save',{...target(c.s),requestId:'new-save',expectedSnapshot:c.s.snapshot}),e=>e.code==='PROJECT_ISOLATED');
 for(const tool of ['project_structure','device_inspect'])
  await assert.rejects(()=>sv.call(tool,{projectId:c.s.projectId,...(tool==='device_inspect'?{deviceId:obj,maxParameters:5000}:{maxNodes:5000}),offset:0,limit:100}),e=>e.code==='PROJECT_ISOLATED');
 const otherStore=new Store(path.join(c.env.dir,'another-service'));
 await assert.rejects(()=>assertNotIsolated(otherStore,undefined,[hardlink]),e=>e.code==='PROJECT_ISOLATED');
 const copy=path.join(c.env.dir,'independent-copy.json');await fs.copyFile(c.env.source,copy);await assertNotIsolated(otherStore,undefined,[copy]);
 assert.equal(c.dispatches.length,count);assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});
test('其他工程可读改编存重开；原请求不重放，迟到可信结果核对后仍隔离',async t=>{
 const c=await context(t);await commitIsolation(await c.plan());const sv=c.create();const other=path.join(c.env.dir,'other.json');await fs.copyFile(c.env.source,other);
 const s=(await sv.call('project_open_copy',{requestId:'other-open',sourcePath:other,applicationId:app})).data.session;const to=target(s);
 const r=await sv.call('object_read',{...to,objectId:obj});
 const changed=await sv.call('code_apply_change',{...to,objectId:obj,requestId:'other-edit',expectedHash:r.data.contentHash,declaration:r.data.declaration,implementation:'// unrelated change'});assert.equal(changed.status,'succeeded');
 const build=await sv.call('project_build',{...to,requestId:'other-build'});assert.equal(build.data.buildPassed,true);
 const saved=await sv.call('project_save',{...to,requestId:'other-save',expectedSnapshot:build.data.snapshot});assert.equal(saved.status,'succeeded');
 assert.equal((await sv.call('object_read',{...to,objectId:obj})).data.implementation,'// unrelated change');
 const before=c.dispatches.length;for(let i=0;i<2;i++)assert.equal((await sv.call('operation_status',{operationId:c.op.operationId})).status,'unknown');
 assert.equal(c.dispatches.length,before);
 const late={contractVersion:'1.0.0',operationId:c.op.operationId,status:'succeeded',summary:'trusted fixture original save result',data:{snapshot:c.s.snapshot,diskHash:digest(await fs.readFile(c.s.workingPath)),saved:true,reopened:true}};
 await atomicJson(path.join(c.op.bridge.directory,'result.json'),late);
 assert.equal((await sv.call('operation_status',{operationId:c.op.operationId,reconcile:true})).status,'succeeded');assert.equal(c.dispatches.length,before);
 const archived=(await isolationState(c.store)).own[0].plan.evidence.originalRecords.find(r=>r.path===c.store.file('operations/'+c.op.operationId+'.json'));
 assert.equal(JSON.parse(Buffer.from(archived.base64,'base64')).value.status,'unknown');
 assert.equal((await sv.call('session_status',{})).data.isolatedProjects.length,1);assert.equal((await sv.call('session_status',{})).data.pending.length,0);
 await assert.rejects(()=>sv.call('project_activate',{requestId:'no-auto-recovery',projectId:c.s.projectId}),e=>e.code==='PROJECT_ISOLATED');
 assert.ok(c.dispatches.every(r=>r.operationId!==c.op.operationId));
});
test('本地或全局隔离记录缺失/损坏不视作已恢复；旧工具 Schema 兼容',async t=>{
 const c=await context(t),p=await c.plan();await commitIsolation(p);const ledger=await fs.readFile(c.store.file('isolation-ledger.json'));
 await fs.writeFile(c.store.file('isolation-ledger.json'),'{broken');assert.equal((await c.service.status()).data.globalFrozen,true);
 await fs.writeFile(c.store.file('isolation-ledger.json'),ledger);
 const anchorPath=(await fs.readdir(isolationDirectory)).map(f=>path.join(isolationDirectory,f));let own;
 for(const q of anchorPath)if(JSON.parse(await fs.readFile(q)).value?.dataDir===c.env.dataDir)own=q;
 const anchor=await fs.readFile(own);await fs.unlink(own);assert.equal((await c.service.status()).data.globalFrozen,true);await fs.writeFile(own,anchor);
 const client=await connect(c.env.dataDir);t.after(()=>client.client.close());assert.equal((await client.client.listTools()).tools.length,22);
 const status=await client.call('session_status',{});assert.equal(status.status,'succeeded');assert.equal(status.data.isolatedProjects.length,1);
});
test('原生/桥接进程缺失及损坏 IPC 结果不能用退出推断绕过；必要源锁缺失仍阻止',async t=>{
 const c=await context(t);delete c.op.bridge.pid;await c.store.saveOp(c.op);assert.equal((await c.plan()).eligible,false);
 c.op.bridge.pid=dead;await c.store.saveOp(c.op);await fs.writeFile(path.join(c.op.bridge.directory,'result.json'),'{broken');assert.equal((await c.plan()).eligible,false);
 await atomicJson(path.join(c.op.bridge.directory,'result.json'),{contractVersion:'1.0.0',operationId:c.op.operationId,status:'unknown'});
 await fs.unlink(c.store.sourceLock(c.s.sourcePath));assert.equal((await c.plan()).eligible,false);
});
test('维护提交期间原证据文件拒绝外部写入；计划不能替换路径身份',async t=>{
 const c=await context(t),p=await c.plan(),bad=structuredClone(p);bad.aliases[0].path=path.join(c.env.dir,'fake-source');
 await assert.rejects(()=>commitIsolation({...p,planId:'../../registry'}),e=>e.code==='PLAN_INVALID');
 await assert.rejects(()=>commitIsolation(bad),e=>['PLAN_STALE','PLAN_INVALID'].includes(e.code));
 await commitIsolation(p,{afterStage:async stage=>{if(stage==='prepared'){
   await assert.rejects(()=>fs.writeFile(c.s.workingPath,'must not write'),e=>['EACCES','EPERM','EBUSY'].includes(e.code));
   await assert.rejects(()=>c.create().call('object_read',{...target(c.s),objectId:obj}),e=>e.code==='MAINTENANCE_EXCLUSIVE');
 }}});
});
test('跨目录全局隔离引用的登记丢失时保持全局冻结；不猜测故障目录已消失',async t=>{
 const c=await context(t);await commitIsolation(await c.plan());
 const ledger=await fs.readFile(c.store.file('isolation-ledger.json'));await fs.unlink(c.store.file('isolation-ledger.json'));
 await assert.rejects(()=>isolationState(new Store(path.join(c.env.dir,'other-root'))),e=>e.code==='ISOLATION_INCOMPLETE');
 await fs.writeFile(c.store.file('isolation-ledger.json'),ledger);
});
test('真实本地 CLI 默认只评估，计划文件与标准输出不改现场；相同计划编号改内容拒绝',async t=>{
 const c=await context(t),before=await inventory(c.env.dataDir);
 const r=await promisify(execFile)(process.execPath,['dist/maintenance.js','evaluate','--data-dir',c.env.dataDir],{windowsHide:true});
 const a=JSON.parse(r.stdout);assert.equal(a.operationAssessments.length,1);assert.equal(a.operationAssessments[0].eligible,true);assert.deepEqual(await inventory(c.env.dataDir),before);
 const p=await c.plan();await commitIsolation(p);await assert.rejects(()=>commitIsolation({...p,reason:'changed'}),e=>e.code==='PLAN_CONFLICT');
});
test('其他服务尚未登记的候选工程若共享文件身份，也不能通过维护归属检查',async t=>{
 const c=await context(t),alias=path.join(c.env.dir,'foreign-candidate.json');await fs.link(c.s.workingPath,alias);
 const foreign=new Store(path.join(c.env.dir,'foreign-live')),candidate={...c.s,projectId:randomUUID(),sourcePath:alias,workingPath:alias};
 await foreign.put('registry.json',{version:1,revision:0,activeProjectId:null,projects:[]});
 await foreign.saveOp({...c.op,project:candidate,args:{...c.op.args,projectId:candidate.projectId}});
 const lock=foreign.sourceLock(alias);await atomicJson(lock,{pid:process.pid,dataDir:foreign.root});
 try{const p=await c.plan();assert.equal(p.eligible,false);assert.ok(p.blockers.some(x=>x.includes('关联外部服务')));}
 finally{await fs.unlink(lock);}
});
