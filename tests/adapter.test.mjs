import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {setup} from './helpers.mjs';
import {IdeAdapter} from '../dist/adapter.js';
import {atomicJson} from '../dist/storage.js';
import {randomUUID} from 'node:crypto';

test('真实适配器计时路径：超时不发送 kill，迟到证据可原样核对',async()=> {
  const env=await setup(); const directory=path.join(env.dir,'IPC');
  let kills=0; const child=new EventEmitter(); child.kill=()=>{kills++;};
  const adapter=new IdeAdapter({executable:process.execPath,profile:'测试 Profile 空格',noUI:false,timeoutMs:100},(exe,args,options)=> {
    assert.equal(options.shell,false); assert.equal(options.env.INOPRO_BRIDGE_REQUEST,path.join(directory,'request.json'));
    assert.ok(!args.some(a=>a.startsWith('--scriptargs')));
    return child;
  });
  const operationId=randomUUID(); const req={operationId,command:'read',projectPath:env.source,args:{}};
  await assert.rejects(()=>adapter.execute(req,directory,async()=>{}),e=>e.code==='IDE_TIMEOUT');
  assert.equal(kills,0);
  const late={contractVersion:'1.0.0',operationId,status:'failed',summary:'迟到测试结果'};
  await atomicJson(path.join(directory,'result.json'),late); child.emit('exit',0);
  assert.deepEqual(await adapter.reconcile(directory),late);
});

test('原进程退出且没有派发标记，才确定 NOT_DISPATCHED',async()=> {
  const env=await setup(); const directory=path.join(env.dir,'IPC');
  const operationId=randomUUID();
  const adapter=new IdeAdapter({executable:process.execPath,profile:'profile',noUI:false,timeoutMs:1000},()=> {
    const child=new EventEmitter(); setTimeout(()=>child.emit('exit',1),15); return child;
  });
  const r=await adapter.execute({operationId,command:'read',projectPath:env.source,args:{}},directory,async()=>{});
  assert.equal(r.status,'failed'); assert.equal(r.error.code,'NOT_DISPATCHED');
});
