// Acceptance infrastructure only: stub MCP, no engineering service or IDE.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ResidentAutosaveAcceptanceRounds} from '../scripts/lib/resident-autosave-acceptance-rounds.mjs';
import {runDriver,submitControl} from '../scripts/resident-autosave-acceptance-driver.mjs';

function fixture(){
 const state={calls:0,finishes:0,observations:0,logs:[]};
 const c=new ResidentAutosaveAcceptanceRounds({
  call:async()=>{state.calls++;throw Error('No engineering request permitted');},
  record:async(event,data)=>{state.logs.push({event,data});if(state.publishError)throw state.publishError;},
  finish:async()=>{state.finishes++;if(state.exitError)throw state.exitError;return state.exit??{code:0,signal:null};},
  observeExit:async()=>{state.observations++;return state.late??null;}
 });
 return {...state,c,state,command:kind=>({kind,id:randomUUID(),ticket:c.ticket,authorization:'explicit offline maintenance test'})};
}
for(const opened of [false,true])test('explicit finish is reachable '+(opened?'after opening':'before opening')+' without native requests',async()=>{
 const {c,state,command}=fixture();if(opened)c.target={projectId:randomUUID()};
 assert.deepEqual(c.control().allowed,[opened?'edit':'open','finish']);
 assert.equal(state.finishes,0); // a displayed control never starts shutdown
 const request=command('finish'),result=await c.submit(request);
 assert.equal(result.status,'finished');assert.equal(result.ideCloseRequested,false);
 assert.equal(await c.submit(request),result);assert.equal(state.finishes,1);assert.equal(state.calls,0);
 assert.deepEqual(c.control().allowed,[]);
});
test('frozen business stays frozen; explicit cleanup preserves original first error',async()=>{
 const {c,state,command}=fixture(),first=Error('original unknown');await c.stop(first);
 assert.deepEqual(c.control().allowed,['finish']);const original=c.firstError;
 await assert.rejects(c.submit(command('edit')),/not permitted/);
 await assert.rejects(c.submit(command('open')),/not permitted/);
 assert.equal((await c.submit(command('finish'))).status,'finished');
 assert.equal(c.firstError,original);assert.equal(state.calls,0);assert.equal(state.finishes,1);
});
test('running cannot finish or issue another business command',async()=>{
 const {c,state,command}=fixture();c.state='running';assert.deepEqual(c.control().allowed,[]);
 await assert.rejects(c.submit(command('finish')),/not permitted/);assert.equal(state.finishes,0);
});
for(const exit of [{code:1,signal:null},{code:0,signal:'SIGTERM'},{}])test('unconfirmed/nonzero exit remains pending '+JSON.stringify(exit),async()=>{
 const {c,state,command}=fixture();state.exit=exit;
 assert.equal((await c.submit(command('finish'))).status,'finish-pending');
 assert.deepEqual(c.control().allowed,['observe-exit']);
 await assert.rejects(c.submit(command('finish')),/not permitted/);
 await assert.rejects(c.submit(command('edit')),/not permitted/);assert.equal(state.finishes,1);assert.equal(state.calls,0);
});
test('bounded late observation does not repeat EOF or replace its first failure',async()=>{
 const {c,state,command}=fixture();state.exitError=Error('original EOF deadline');
 await c.submit(command('finish'));const original=c.cleanupError;
 assert.equal((await c.submit(command('observe-exit'))).status,'finish-pending');
 state.late={code:0,signal:null};const result=await c.submit(command('observe-exit'));
 assert.equal(result.status,'finished-with-prior-error');assert.equal(result.firstCleanupError,original);
 assert.equal(state.finishes,1);assert.equal(state.observations,2);assert.equal(state.calls,0);
});
test('evidence failure before finish sends no EOF; stale/unauthorized commands do not finish',async()=>{
 const {c,state,command}=fixture();
 await assert.rejects(c.submit({...command('finish'),ticket:'stale'}),/Stale/);
 await assert.rejects(c.submit({...command('finish'),authorization:''}),/authorization/);
 state.publishError=Error('first publish failure');const result=await c.submit(command('finish'));
 assert.equal(result.status,'frozen');assert.equal(c.firstError.message,'first publish failure');assert.equal(state.finishes,0);
});
for(const mismatch of [false,true])test('actual autosave driver + SDK stub EOF after '+(mismatch?'initialization failure':'initialization')+'; no project',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'autosave-finish-')),directory=path.join(root,'client');
 const entry=path.resolve('tests/resident-driver-child-fixture.mjs');
 const config={directory,entry,cwd:process.cwd(),dataDir:path.join(root,'unused-registry'),
  entrySha256:createHash('sha256').update(await fs.readFile(entry)).digest('hex'),
  version:mismatch?'wrong':'0.40.0',toolCount:1,toolNames:['fixture_only']};
 const oldExitCode=process.exitCode,running=runDriver(config);let control;
 for(let i=0;i<200;i++){
  control=await fs.readFile(path.join(directory,'control.json'),'utf8').then(JSON.parse,()=>null);
  if(control)break;await new Promise(r=>setTimeout(r,25));
 }
 assert(control);assert.equal(control.state,mismatch?'frozen':'waiting');
 const submitted=await submitControl(directory,{kind:'finish',authorization:'explicit offline finish'});
 const finished=await running;process.exitCode=oldExitCode;assert.equal(finished.state,'finished');
 const result=JSON.parse(await fs.readFile(path.join(directory,'results',submitted.commandId+'.json'),'utf8'));
 assert.equal(result.result.status,'finished');assert.equal(result.result.ideCloseRequested,false);
 const events=await Promise.all((await fs.readdir(path.join(directory,'journal'))).map(async f=>JSON.parse(await fs.readFile(path.join(directory,'journal',f),'utf8'))));
 assert.equal(events.filter(x=>x.event==='mcp-request').length,0);
 const transport=await Promise.all((await fs.readdir(path.join(directory,'transport'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile(path.join(directory,'transport',f),'utf8'))));
 assert.equal(transport.filter(x=>x.value.event==='eof-sent').length,1);
 assert(transport.some(x=>x.value.event==='service-exit'&&x.value.data.code===0&&x.value.data.signal===null));
 assert.equal(await fs.stat(config.dataDir).then(()=>true,()=>false),false);
});
