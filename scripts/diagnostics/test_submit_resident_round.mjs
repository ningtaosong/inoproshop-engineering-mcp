import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {submitRound,waitRound} from './submit_resident_round.mjs';
import {roundWaiting,roundSubmission,version} from './resident_project_observer.mjs';
import {sha,durable} from './native_idle_observer.mjs';

function fixture(fn){
 const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'resident-round-submit-test-'));
 const i={scope:'one-owned-project-two-explicit-rounds',directory:root,startupReceipt:path.join(root,'observer.json'),launchId:'synthetic-launch',projectPath:'D:\synthetic-not-a-project',exe:'synthetic-ide',idleMs:null,requestMs:60000,fixedFiles:[]};
 const intent=path.join(root,'intent.json'),identity={pid:999,startId:'555'},owners={888:{state:'running',pid:888,startId:'444',path:'synthetic-node'},999:{state:'running',...identity,path:i.exe}};
 durable(intent,i);durable(i.startupReceipt,{pid:888,startId:'444',nodePath:'synthetic-node',intentSha256:sha(fs.readFileSync(intent))});durable(path.join(root,'ready.json'),{binding:{...identity,launchId:i.launchId}});
 const w1=roundWaiting(i,1,identity,null,null);durable(path.join(root,'awaiting-round-1.json'),w1);
 const context={i,intent,root,identity,owners,probe:pid=>owners[pid],w1};
 return Promise.resolve().then(()=>fn(context)).finally(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(base));assert.ok(path.basename(root).startsWith('resident-round-submit-test-'));fs.rmSync(root,{recursive:true});});
}
function second(x){
 const prior={status:'memory-verified',changes:1,memoryVersion:'synthetic-memory',observationHash:'synthetic-observation'};
 const previous={status:'round-completed',round:1,launchId:x.i.launchId,projectPath:x.i.projectPath,processIdentity:x.identity,completedSequences:[1,2,3],modifications:1,saved:false,closed:false,lastStepResultHash:version(prior)};
 durable(path.join(x.root,'result-3.json'),prior);durable(path.join(x.root,'round-1-result.json'),previous);
 durable(path.join(x.root,'awaiting-round-2.json'),roundWaiting(x.i,2,x.identity,previous,prior));return previous;
}
test('submitter publishes once and returns original ticket on identical re-query',()=>fixture(x=>{const a=submitRound(x.intent,1,x.probe),bytes=fs.readFileSync(a.file),mtime=fs.statSync(a.file).mtimeMs;assert.equal(a.created,true);const b=submitRound(x.intent,1,x.probe);assert.equal(b.created,false);assert.deepEqual(fs.readFileSync(a.file),bytes);assert.equal(fs.statSync(a.file).mtimeMs,mtime);assert.ok(!fs.existsSync(path.join(x.root,'round-2.json')));}));
test('second round cannot be queued before first result and new waiting receipt',()=>fixture(x=>{assert.throws(()=>submitRound(x.intent,2,x.probe));assert.ok(!fs.existsSync(path.join(x.root,'round-2.json')));}));
test('explicit second submission uses first round receipt without issuing engineering requests',()=>fixture(x=>{second(x);const a=submitRound(x.intent,2,x.probe);assert.equal(a.created,true);assert.equal(a.ticket.previousRoundHash,version(JSON.parse(fs.readFileSync(path.join(x.root,'round-1-result.json')))));assert.ok(!fs.existsSync(path.join(x.root,'request-4.json')));}));
for(const kind of ['stopped','owner-changed','prior-changed','waiting-owner','ticket-conflict'])test('submitter refuses '+kind,()=>fixture(x=>{second(x);if(kind==='stopped')durable(path.join(x.root,'observer-stop.json'),{});if(kind==='owner-changed')x.owners[999]={...x.owners[999],startId:'different'};if(kind==='prior-changed'){const file=path.join(x.root,'round-1-result.json'),v=JSON.parse(fs.readFileSync(file));v.saved=true;fs.writeFileSync(file,JSON.stringify(v));}if(kind==='waiting-owner'){const file=path.join(x.root,'awaiting-round-2.json'),v=JSON.parse(fs.readFileSync(file));v.processIdentity.pid=1000;fs.writeFileSync(file,JSON.stringify(v));}if(kind==='ticket-conflict')durable(path.join(x.root,'round-2.json'),{wrong:true});const before=fs.existsSync(path.join(x.root,'round-2.json'))?fs.readFileSync(path.join(x.root,'round-2.json')):null;assert.throws(()=>submitRound(x.intent,2,x.probe));if(before)assert.deepEqual(fs.readFileSync(path.join(x.root,'round-2.json')),before);else assert.ok(!fs.existsSync(path.join(x.root,'round-2.json')));}));
test('read completed response without rewriting it',()=>fixture(async x=>{const submitted=submitRound(x.intent,1,x.probe),file=path.join(x.root,'round-1-result.json'),result={status:'round-completed',round:1,launchId:x.i.launchId,submissionHash:version(submitted.ticket),processIdentity:x.identity,completedSequences:[1,2,3],saved:false,closed:false};durable(file,result);const before=fs.readFileSync(file);assert.deepEqual(await waitRound(submitted),result);assert.deepEqual(fs.readFileSync(file),before);}));
test('wait reports first stop without publishing a recovery request',()=>fixture(async x=>{const submitted=submitRound(x.intent,1,x.probe);durable(path.join(x.root,'observer-stop.json'),{reason:'first fault'});await assert.rejects(waitRound(submitted));assert.ok(!fs.existsSync(path.join(x.root,'round-2.json')));}));
test('wait reports lost observer identity without replaying a submitted request',()=>fixture(async x=>{const submitted=submitRound(x.intent,1,x.probe),before=fs.readFileSync(submitted.file);await assert.rejects(waitRound(submitted,()=>({state:'not-found'})));assert.deepEqual(fs.readFileSync(submitted.file),before);assert.ok(!fs.existsSync(path.join(x.root,'round-2.json')));}));
