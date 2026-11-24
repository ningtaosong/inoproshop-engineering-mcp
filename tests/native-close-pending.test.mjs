import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {IdeAdapter} from '../dist/adapter.js';
import {atomicJson,readJson} from '../dist/storage.js';
import {setup} from './helpers.mjs';
import {processObservations,requestBinding,normalCloseDouble} from './process-double.mjs';

test('all close receipts returned but process never exits: bounded timeout, no kill/retry or restart success',async()=>{
 const env=await setup(),directory=path.join(env.dir,'ipc');let spawns=0,kills=0,recorded;
 const completed=new Promise(resolve=>recorded=resolve);
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:300},()=>{
  spawns++;const child=new EventEmitter();child.pid=12345;child.kill=()=>kills++;
  setTimeout(async()=>{
   const request=await readJson(path.join(directory,'request.json'));
   await atomicJson(path.join(directory,'dispatched.json'),{operationId:request.operationId,pid:12345});
   await atomicJson(path.join(directory,'result.json'),{contractVersion:'1.0.0',operationId:request.operationId,status:'succeeded',summary:'business complete'});
   await normalCloseDouble(directory);recorded();
   // Public execute returned, but the simulated process intentionally emits no exit.
  },10);return child;
 },processObservations);
 const started=Date.now();
 await assert.rejects(()=>adapter.execute({...requestBinding,operationId:'pending-close',command:'read',projectPath:env.source,args:{}},directory,async()=>{}),{code:'IDE_TIMEOUT'});
 assert(Date.now()-started>=250);await completed;
 assert.equal((await readJson(path.join(directory,'normal-close-returned.json'))).dispatchCount,1);
 assert.equal(await readJson(path.join(directory,'process-exit.json')),undefined);
 const before=await fs.readFile(path.join(directory,'result.json'));
 const restart=new IdeAdapter({},undefined,processObservations);
 assert.equal((await restart.reconcile(directory)).error.code,'IDE_STILL_RUNNING');
 assert.deepEqual(await fs.readFile(path.join(directory,'result.json')),before);
 assert.equal(spawns,1);assert.equal(kills,0);
});
