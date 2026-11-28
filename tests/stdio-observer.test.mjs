import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {ObservedStdioTransport,preservePrimary} from '../scripts/lib/observed-stdio.mjs';
import {exclusiveJson} from '../dist/exit-journal.js';
import {Store} from '../dist/storage.js';
import {setup,app} from './helpers.mjs';
const fixture=path.resolve('tests/stdio-child-fixture.mjs');
const rows=async dir=>Promise.all((await fs.readdir(dir)).filter(n=>n.endsWith('.json')).sort().map(async n=>JSON.parse(await fs.readFile(path.join(dir,n),'utf8')).value));

test('baseline SDK EOF semantics remain explicit (no claim the dependency closes on EOF)',async()=>{
 const input=new PassThrough(),output=new PassThrough(),transport=new StdioServerTransport(input,output);let closed=0;
 transport.onclose=()=>closed++;await transport.start();input.end();await new Promise(r=>setImmediate(r));assert.equal(closed,0);await transport.close();
});
test('controlled Node process: durable creation identity, exit, close, EOF and idempotent close',async()=>{
 const env=await setup(),directory=path.join(env.dir,'observer');
 const transport=new ObservedStdioTransport({command:process.execPath,args:[fixture,'normal'],stderr:'pipe'},{directory});
 await transport.start();const a=transport.close(),b=transport.close();assert.equal(a,b);const exit=await a;assert.equal(exit.code,0);assert.equal(exit.signal,null);
 const events=await rows(directory),start=events.find(e=>e.event==='service-start');
 assert.equal(start.binding.process.state,'running');assert.equal(start.binding.process.identity.pid,start.binding.pid);
 assert.match(start.binding.entryFingerprint.sha256,/^[a-f0-9]{64}$/);
 for(const name of ['eof-requested','eof-sent','service-exit','service-close'])assert.equal(events.filter(e=>e.event===name).length,1,name);
 assert(events.every(e=>e.binding.runId===start.binding.runId));
});
test('close deadline retained, bounded late normal exit appended, no second EOF or success upgrade',async()=>{
 const env=await setup(),directory=path.join(env.dir,'observer');
 const transport=new ObservedStdioTransport({command:process.execPath,args:[fixture,'late'],stderr:'pipe'},{directory,closeTimeoutMs:20});
 await transport.start();await assert.rejects(()=>transport.close(),/EOF exit unconfirmed/);
 await transport.observeLate(5000);await assert.rejects(()=>transport.close(),/EOF exit unconfirmed/);
 const events=await rows(directory);assert(events.some(e=>e.event==='close-observation-deadline'));
 assert.equal(events.find(e=>e.event==='service-exit').data.code,0);assert.equal(events.filter(e=>e.event==='eof-sent').length,1);
 assert.equal(events.find(e=>e.event==='late-observation-ended').data.deadlineReached,false);
});
test('nonzero Node exit remains failure and has raw exit and close evidence',async()=>{
 const env=await setup(),directory=path.join(env.dir,'observer');
 const transport=new ObservedStdioTransport({command:process.execPath,args:[fixture,'nonzero'],stderr:'pipe'},{directory});
 await transport.start();await assert.rejects(()=>transport.close(),/normal exit unconfirmed/);
 const events=await rows(directory);assert.equal(events.find(e=>e.event==='service-exit').data.code,7);assert(events.some(e=>e.event==='cleanup-error'));
});
test('observer publication fault cannot become successful shutdown',async()=>{
 const env=await setup(),directory=path.join(env.dir,'observer'),reports=[];
 const transport=new ObservedStdioTransport({command:process.execPath,args:[fixture,'normal'],stderr:'pipe'},
 {directory,write:async(file,value)=>{if(file.includes('service-close'))throw Error('FIRST close publication fault');await exclusiveJson(file,value);},report:r=>reports.push(r)});
 await transport.start();await assert.rejects(()=>transport.close(),/journal publication failed/);
 assert.equal(transport.exitSeen.code,0);assert.equal(reports.length,1);assert.match(reports[0].error.message,/FIRST/);
});
test('observed service error is not erased by subsequent normal exit',async()=>{
 const env=await setup(),directory=path.join(env.dir,'observer');
 const transport=new ObservedStdioTransport({command:process.execPath,args:[fixture,'normal'],stderr:'pipe'},{directory});
 transport.onerror=()=>{};await transport.start();const first=Error('service event first error');transport.child.emit('error',first);
 await assert.rejects(()=>transport.close(),e=>e===first);assert.equal(transport.exitSeen.code,0);
 const events=await rows(directory);assert.equal(events.find(e=>e.event==='service-error').data.error.message,first.message);
});
test('business first error and cleanup error separately retained, original throw preserved',async()=>{
 const first=Error('FIRST business unknown'),cleanup=Error('SECOND close deadline'),events=[];
 await assert.rejects(()=>preservePrimary(async()=>{throw first;},async()=>{throw cleanup;},async(event,data)=>events.push({event,data})),e=>e===first);
 assert.deepEqual(events.map(e=>e.event),['business-error','cleanup-error']);assert.equal(events[1].data.primary.message,first.message);
});
test('successful business does not hide failed cleanup',async()=>{
 const second=Error('close failed');await assert.rejects(()=>preservePrimary(async()=>42,async()=>{throw second;}),e=>e===second);
});
test('identity returned after child exit is not bound as its creation identity (PID reuse)',async()=>{
 const env=await setup(),directory=path.join(env.dir,'observer');let transport;
 transport=new ObservedStdioTransport({command:process.execPath,args:[fixture,'normal'],stderr:'pipe'},
 {directory,probe:async pid=>{transport.child.stdin.end();await transport.closed;return {state:'running',identity:{version:1,platform:process.platform,host:'offline',pid,startId:'999999'}};}});
 await assert.rejects(()=>transport.start(),/creation identity unconfirmed/);await transport.close();
 const start=(await rows(directory)).find(e=>e.event==='service-start');assert.equal(start.binding.process.state,'unconfirmed');
 assert.equal(start.binding.process.reason,'exit-before-creation-identity-confirmed');
});
test('production offline stdio idle EOF completes journal and closes naturally; no engineering call',async t=>{
 const env=await setup(),directory=path.join(env.dir,'observer'),entry=path.resolve('dist/server.js');
 const transport=new ObservedStdioTransport({command:process.execPath,args:[entry],cwd:process.cwd(),stderr:'pipe',
   env:{...process.env,INOPRO_DATA_DIR:env.dataDir,INOPRO_TEST_MODE:'fixture'}},{directory});
 let stderr='';transport.stderr.on('data',d=>stderr+=d.toString());
 const client=new Client({name:'offline-exit-test',version:'1'});t.after(()=>client.close());await client.connect(transport);
 assert.equal(client.getServerVersion().version,'0.41.1');assert.equal((await client.listTools()).tools.length,38);
 await client.close();assert.equal(transport.exitSeen.code,0,stderr);
 const runs=await fs.readdir(path.join(env.dataDir,'service-lifecycle'));assert.equal(runs.length,1);
 const journal=await rows(path.join(env.dataDir,'service-lifecycle',runs[0]));assert.equal(journal[0].event,'shutdown-requested');
 assert.equal(journal[0].data.reason,'stdin-end');assert(journal.some(e=>e.event==='observations-settled'));assert.equal(journal.at(-1).event,'shutdown-completed');
 assert.equal(await fs.access(path.join(env.dataDir,'operations')).then(()=>true,()=>false),false);
});
test('production offline stdio EOF after running reply waits queued fixture completion before exit',async()=>{
 const env=await setup({delayMs:250}),directory=path.join(env.dir,'observer'),entry=path.resolve('dist/server.js');
 const transport=new ObservedStdioTransport({command:process.execPath,args:[entry],cwd:process.cwd(),stderr:'pipe',
   env:{...process.env,INOPRO_DATA_DIR:env.dataDir,INOPRO_TEST_MODE:'fixture',INOPRO_RESPONSE_WAIT_MS:'1'}},{directory});
 transport.stderr.on('data',()=>{});const client=new Client({name:'offline-fixture-exit',version:'1'});await client.connect(transport);
 const result=(await client.callTool({name:'project_open',arguments:{requestId:'fixture-only-open',projectPath:env.source,applicationId:app}})).structuredContent;
 assert.equal(result.status,'running');await client.close();assert.equal(transport.exitSeen.code,0);
 const ledger=await new Store(env.dataDir).operation(result.operationId);
 assert.equal(ledger.status,'succeeded');assert.equal(await fs.access(path.join(env.dataDir,'service.lock')).then(()=>true,()=>false),false);
 const events=await rows(directory);assert(Date.parse(events.find(e=>e.event==='service-exit').data.observedAt)>=Date.parse(ledger.finishedAt));
});
