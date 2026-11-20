import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {EventEmitter} from 'node:events';import {randomUUID} from 'node:crypto';
import {setup} from './helpers.mjs';import {processObservations,requestBinding} from './process-double.mjs';
import {IdeAdapter} from '../dist/adapter.js';import {atomicJson,readJson} from '../dist/storage.js';
test('退出绑定使用实际可序列化请求，缺省 undefined 字段不误报冲突',async()=>{
 const e=await setup(),directory=path.join(e.dir,'ipc'),operationId=randomUUID();
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:1000},()=>{
  const c=new EventEmitter();c.pid=12345;setTimeout(async()=>{
   await atomicJson(path.join(directory,'dispatched.json'),{operationId,pid:12345});
   await atomicJson(path.join(directory,'result.json'),{contractVersion:'1.0.0',operationId,status:'failed',summary:'confirmed rejection'});c.emit('exit',0,null);
  },30);return c;
 },processObservations);
 const r=await adapter.execute({...requestBinding,operationId,command:'read',projectPath:e.source,args:{optional:undefined,nested:{absent:undefined,value:1}}},directory,async()=>{});
 assert.equal(r.status,'failed');assert.equal(r.summary,'confirmed rejection');
 assert.deepEqual((await readJson(path.join(directory,'request.json'))).args,{nested:{value:1}});
});
