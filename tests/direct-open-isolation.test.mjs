// Synthetic direct-open operation records. Never replays the real S5b request.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setup,app} from './helpers.mjs';
import {Store,atomicJson,canonical,digest} from '../dist/storage.js';
import {sealLease} from '../dist/lease-process.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {evaluateIsolation,generatePlan,commitIsolation,isolationState,assertNotIsolated,isolationDirectory} from '../dist/isolation.js';

const dead=2147483647;
async function provisional(t) {
  const env=await setup(),store=new Store(env.dataDir),registry=await store.ensureRegistry();
  const actual=await fs.realpath(env.source),hash=digest(await fs.readFile(actual));
  const operationId=randomUUID(),requestId=randomUUID(),args={requestId,projectPath:actual};
  const session={projectId:randomUUID(),sessionId:randomUUID(),storageMode:'direct',editMode:'direct',
    directPath:actual,sourcePath:actual,workingPath:actual,sourceHash:hash,diskHash:hash};
  const directory=store.file('ipc/'+operationId);
  const op={schemaVersion:1,registryVersion:1,operationId,requestId,tool:'project_open',args,
    fingerprint:digest(canonical({tool:'project_open',args})),status:'unknown',ownerPid:dead,
    startedAt:new Date().toISOString(),project:session,
    activation:{previousActiveProjectId:registry.activeProjectId,revision:registry.revision},
    bridge:{directory,pid:dead}};
  await store.saveOp(op);
  await atomicJson(path.join(directory,'request.json'),{operationId,command:'inspect',projectPath:actual,args,
    fileGuard:{expectedDiskHash:hash,mode:'direct'}});
  await atomicJson(path.join(directory,'dispatched.json'),{operationId,pid:dead});
  const identity={version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid:dead,startId:'1'};
  const lock=()=>sealLease({leaseVersion:2,leaseId:randomUUID(),pid:dead,dataDir:env.dataDir,
    createdAt:new Date().toISOString(),processIdentity:identity});
  await atomicJson(store.file('service.lock'),lock());await atomicJson(store.sourceLock(actual),lock());
  t.after(async()=>{
    await store.release();
    await fs.unlink(store.sourceLock(actual)).catch(()=>{});
    for(const name of await fs.readdir(isolationDirectory).catch(()=>[])){
      const p=path.join(isolationDirectory,name),value=JSON.parse(await fs.readFile(p,'utf8')).value;
      if(value?.dataDir===env.dataDir)await fs.unlink(p);
    }
  });
  return {env,store,registry,op,session,directory};
}

test('登记前已派发的 direct project_open 可以只读生成暂定归属计划',async t=>{
  const c=await provisional(t);
  const result=await evaluateIsolation(c.env.dataDir,c.op.operationId);
  assert.equal(result.eligible,true,JSON.stringify(result.blockers));
  assert.equal(result.projectId,c.session.projectId);
  assert.equal(result.ownershipBasis,'provisional-direct');
  assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
  assert.equal((await c.store.registry()).projects.length,0);
});

test('原请求、暂定身份、IPC 和磁盘保护字段矛盾时均在计划前拒绝',async t=>{
  for(const fault of ['fingerprint','request-id','session','path','disk-hash','guard','dispatch','missing-dispatch']){
    const c=await provisional(t),request=path.join(c.directory,'request.json');
    if(fault==='fingerprint')c.op.fingerprint='0'.repeat(64);
    if(fault==='request-id')c.op.args.requestId=randomUUID();
    if(fault==='session')c.op.project.sessionId='not-a-session';
    if(fault==='path')c.op.project.directPath=path.join(c.env.dir,'different.json');
    if(fault==='disk-hash')c.op.project.diskHash='0'.repeat(64);
    if(['fingerprint','request-id','session','path','disk-hash'].includes(fault))await c.store.saveOp(c.op);
    if(fault==='guard'){const r=JSON.parse(await fs.readFile(request));r.fileGuard.expectedDiskHash='0'.repeat(64);await fs.writeFile(request,JSON.stringify(r));}
    if(fault==='dispatch')await atomicJson(path.join(c.directory,'dispatched.json'),{operationId:c.op.operationId,pid:dead-1});
    if(fault==='missing-dispatch')await fs.unlink(path.join(c.directory,'dispatched.json'));
    const a=await evaluateIsolation(c.env.dataDir,c.op.operationId);
    assert.equal(a.eligible,false,fault);
    assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
  }
});

test('文件变化、登记冲突、硬链接别名及其他未决操作拒绝暂定归属',async t=>{
  for(const fault of ['file','registered-path','hardlink','pending']){
    const c=await provisional(t);
    if(fault==='file')await fs.appendFile(c.session.workingPath,' ');
    if(fault==='registered-path'){
      const r=await c.store.registry();r.projects.push({...c.session,projectId:randomUUID(),sessionId:randomUUID()});
      await c.store.put('registry.json',r);
    }
    if(fault==='hardlink'){
      const link=path.join(c.env.dir,'alias.json');await fs.link(c.session.workingPath,link);
      const r=await c.store.registry();r.projects.push({...c.session,projectId:randomUUID(),sessionId:randomUUID(),
        sourcePath:link,workingPath:link,directPath:link});await c.store.put('registry.json',r);
    }
    if(fault==='pending'){
      const id=randomUUID(),requestId=randomUUID(),args={requestId,projectPath:c.session.workingPath};
      await c.store.saveOp({...c.op,operationId:id,requestId,args,fingerprint:digest(canonical({tool:'project_open',args})),
        bridge:{directory:c.store.file('ipc/'+id),pid:dead}});
    }
    const a=await evaluateIsolation(c.env.dataDir,c.op.operationId);
    assert.equal(a.eligible,false,fault);
  }
});

test('进程或源租约未确认退出、计划过期时拒绝提交',async t=>{
  const c=await provisional(t),p=await generatePlan(c.env.dataDir,c.op.operationId,'synthetic direct-open isolation');
  assert.equal(p.version,2);assert.equal(p.ownershipBasis,'provisional-direct');
  c.op.bridge.pid=process.pid;await c.store.saveOp(c.op);
  assert.equal((await evaluateIsolation(c.env.dataDir,c.op.operationId)).eligible,false);
  await assert.rejects(()=>commitIsolation(p),e=>e.code==='PLAN_STALE');
  c.op.bridge.pid=dead;await c.store.saveOp(c.op);
  await atomicJson(c.store.sourceLock(c.session.sourcePath),{pid:process.pid,dataDir:c.env.dataDir});
  assert.equal((await evaluateIsolation(c.env.dataDir,c.op.operationId)).eligible,false);
});

test('同 PID 不同进程身份的来源锁不能冒充原服务租约',async t=>{
  const c=await provisional(t),file=c.store.sourceLock(c.session.sourcePath);
  const prior=JSON.parse(await fs.readFile(file));
  await atomicJson(file,sealLease({leaseVersion:2,leaseId:randomUUID(),pid:dead,dataDir:c.env.dataDir,
    createdAt:new Date().toISOString(),processIdentity:{...prior.processIdentity,startId:'2'}}));
  const a=await evaluateIsolation(c.env.dataDir,c.op.operationId);
  assert.equal(a.eligible,false);
  assert.ok(a.blockers.some(x=>x.includes('同一原进程实例')));
});

test('合成暂定工程隔离后拦截原路径与硬链接；无关工程可派发，原 unknown 不改',async t=>{
  const c=await provisional(t),p=await generatePlan(c.env.dataDir,c.op.operationId,'synthetic direct-open isolation');
  const first=await commitIsolation(p),second=await commitIsolation(p);
  assert.equal(first.deduplicated,false);assert.equal(second.deduplicated,true);
  assert.equal((await isolationState(c.store)).own[0].plan.version,2);
  const alias=path.join(c.env.dir,'hardlink.json');await fs.link(c.session.workingPath,alias);
  for(const q of [c.session.workingPath,alias])
    await assert.rejects(()=>assertNotIsolated(c.store,undefined,[q]),e=>e.code==='PROJECT_ISOLATED');
  const service=new EngineeringService({dataDir:c.env.dataDir,testMode:true,responseWaitMs:1000},new FixtureAdapter());
  t.after(()=>service.store.release());
  const status=await service.status();assert.equal(status.data.globalFrozen,false);
  for(const q of [c.session.workingPath,alias]){
    await assert.rejects(()=>service.call('project_open',{requestId:randomUUID(),projectPath:q}),e=>e.code==='PROJECT_ISOLATED');
    await assert.rejects(()=>service.call('project_open_copy',{requestId:randomUUID(),sourcePath:q}),e=>e.code==='PROJECT_ISOLATED');
  }
  const other=path.join(c.env.dir,'unrelated.json');await fs.copyFile(c.session.workingPath,other);
  const opened=await service.call('project_open',{requestId:randomUUID(),projectPath:other,applicationId:app});
  assert.equal(opened.status,'succeeded');assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});

test('已登记直接工程和旧副本隔离仍生成旧格式计划',async t=>{
  const c=await provisional(t),r=await c.store.registry();r.version=2;r.projects.push(c.session);await c.store.put('registry.json',r);
  const direct=await generatePlan(c.env.dataDir,c.op.operationId,'synthetic registered direct');
  assert.equal(direct.version,1);assert.equal(direct.ownershipBasis,undefined);
  assert.equal(direct.eligible,true,JSON.stringify(direct.blockers));
});

test('迟到终态及同身份登记不自动解除已提交的暂定工程隔离',async t=>{
  const c=await provisional(t),p=await generatePlan(c.env.dataDir,c.op.operationId,'synthetic direct-open isolation');
  await commitIsolation(p);
  c.op.status='succeeded';await c.store.saveOp(c.op);
  const registry=await c.store.registry();registry.version=2;registry.projects.push(c.session);
  await c.store.put('registry.json',registry);
  assert.equal((await isolationState(c.store)).own[0].plan.planId,p.planId);
  await assert.rejects(()=>assertNotIsolated(c.store,c.session.projectId,[c.session.workingPath]),e=>e.code==='PROJECT_ISOLATED');
});

test('暂定工程的提交中断保持全局冻结，绝不补改原操作',async t=>{
  const c=await provisional(t),p=await generatePlan(c.env.dataDir,c.op.operationId,'synthetic direct-open isolation');
  await assert.rejects(()=>commitIsolation(p,{afterStage:async stage=>{if(stage==='prepared')throw Error('synthetic interruption');}}),/synthetic interruption/);
  const service=new EngineeringService({dataDir:c.env.dataDir,testMode:true,responseWaitMs:1000},new FixtureAdapter());
  t.after(()=>service.store.release());
  assert.equal((await service.status()).data.globalFrozen,true);
  assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});
