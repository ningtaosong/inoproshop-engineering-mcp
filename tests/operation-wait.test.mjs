import {test} from 'node:test';import assert from 'node:assert/strict';
import {waitForOperation,callAndWait} from './operation-wait.mjs';
const running={status:'running',operationId:'original-operation',requestId:'original-request'};
for(const status of ['succeeded','failed','conflict','unsupported','unknown'])test('wait returns exact terminal without polling: '+status,async()=>{
 const reply={...running,status,error:{code:'ORIGINAL',message:'first error'}};assert.equal(await waitForOperation(()=>assert.fail('no poll'),reply),reply);
});
test('one initial dispatch, then only original operation ID; running is never a session',async()=>{
 const calls=[],events=[],terminal={...running,status:'succeeded',data:{session:{projectId:'fixture'}}};let polls=0;
 const service={call:async(tool,args)=>{calls.push({tool,args});if(tool==='project_open_copy')return running;assert.deepEqual(args,{operationId:running.operationId});return ++polls===2?terminal:running;}};
 const result=await callAndWait(service,'project_open_copy',{requestId:running.requestId},{intervalMs:0,observe:e=>events.push(e)});
 assert.equal(result,terminal);assert.deepEqual(calls.map(x=>x.tool),['project_open_copy','operation_status','operation_status']);
 assert.equal(events[0].reply,running);assert.equal(events.at(-1).reply,terminal);assert.ok(calls.every(x=>!('reconcile' in x.args)));
});
for(const change of [{operationId:'other'},{requestId:'other'},{operationId:undefined},{requestId:undefined},{status:undefined}])test('wait refuses missing or changed original identity/status: '+JSON.stringify(change),async()=>{
 await assert.rejects(waitForOperation(async()=>({...running,status:'succeeded',...change}),running,{intervalMs:0}),/identity|status/);
});
test('running without original ID is rejected before querying',async()=>{let calls=0;await assert.rejects(waitForOperation(()=>calls++,{status:'running'}),/operationId/);assert.equal(calls,0);});
for(const phase of ['dispatch','poll','record'])test('first thrown error object and stack survive '+phase,async()=>{
 const first=Error('first original '+phase),service={call:async tool=>{if(phase==='dispatch'||tool==='operation_status')throw first;return running;}};
 const action=phase==='record'?waitForOperation(()=>assert.fail('no query'),running,{observe:()=>{throw first;}}):callAndWait(service,'project_open',{});
 await assert.rejects(action,e=>e===first&&e.stack===first.stack);
});
test('finite observation of running preserves original and last response, with no replay',async()=>{
 let calls=0;await assert.rejects(waitForOperation(async(tool,args)=>{calls++;assert.equal(tool,'operation_status');assert.deepEqual(args,{operationId:running.operationId});return running;},running,{timeoutMs:20,intervalMs:5}),e=>e.code==='TEST_OPERATION_WAIT_EXPIRED'&&e.operationId===running.operationId&&e.lastReply===running);
 assert.ok(calls>=1);
});
test('hung read is bounded; late completion does not issue another query',async()=>{
 let resolve,calls=0;const late=new Promise(r=>resolve=r);
 await assert.rejects(waitForOperation(()=>{calls++;return late;},running,{timeoutMs:20}),e=>e.code==='TEST_OPERATION_WAIT_EXPIRED');
 resolve({...running,status:'succeeded'});await late;assert.equal(calls,1);
});
test('failure still reaches synthetic owner cleanup and never restores or saves',async()=>{
 const first=Error('query failed');let cleanup=0,writes=0;
 try{await assert.rejects(waitForOperation(async tool=>{if(tool!=='operation_status')writes++;throw first;},running),e=>e===first);}finally{cleanup++;}
 assert.equal(cleanup,1);assert.equal(writes,0);
});
