import {test} from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';
import {setup,app} from './helpers.mjs';import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';import {atomicJson} from '../dist/storage.js';
test('生产桥接生命周期：重开/关闭/双异常、创建及修改的未知状态',async()=>{
 await promisify(execFile)('python',['tests/bridge_lifecycle_test.py'],{windowsHide:true,timeout:30000});
});
test('保存可能已发生时冻结；重复状态查询及原请求去重不再次执行保存',async()=>{
 const env=await setup();const fixture=new FixtureAdapter();let saves=0,dispatches=0;
 const adapter={reconcile:dir=>fixture.reconcile(dir),execute:async(req,dir,onStart)=>{
  dispatches++;
  if(req.command!=='save')return fixture.execute(req,dir,onStart);
  saves++;
  const r={contractVersion:'1.0.0',operationId:req.operationId,status:'unknown',summary:'saved but reopen failed',error:{code:'IDE_API_ERROR',message:'reopen failure'},data:{lifecycle:{saveMayHaveOccurred:true,events:[{stage:'save',status:'succeeded'},{stage:'reopen',status:'failed'}]}}};
  await atomicJson(path.join(dir,'result.json'),r);return r;
 }};
 const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
 try{
  const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});const s=opened.data.session;
  const args={projectId:s.projectId,applicationId:app,requestId:'save-once',expectedSnapshot:s.snapshot};
  const r=await service.call('project_save',args);assert.equal(r.status,'unknown');const count=dispatches;
  for(let i=0;i<3;i++){
   assert.equal((await service.call('operation_status',{operationId:r.operationId})).status,'unknown');
   assert.equal((await service.call('operation_status',{operationId:r.operationId,reconcile:true})).status,'unknown');
   assert.equal((await service.call('project_save',args)).operationId,r.operationId);
  }
  assert.equal(saves,1);assert.equal(dispatches,count);assert.equal((await service.call('session_status',{})).data.writeFrozen,true);
  await assert.rejects(()=>service.call('project_save',{...args,requestId:'must-not-replay'}),e=>e.code==='PENDING_UNKNOWN');
  assert.equal(saves,1);
 }finally{await service.store.release();}
});
