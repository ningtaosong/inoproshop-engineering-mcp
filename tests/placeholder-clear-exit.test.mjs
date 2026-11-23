import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {scenario} from './exit-scenario.mjs';
import {readJson,digest} from '../dist/storage.js';

test('production adapter clear: normal bound exit publishes independent disk evidence, restart repeats safely',async()=>{
 const x=await scenario({code:0,command:'clear_placeholder'});
 assert.equal(x.result.status,'succeeded',JSON.stringify(x.result));assert.equal(x.result.data.workerDiskHash,x.raw.data.diskHash);
 assert.equal(x.result.data.postExitDiskHashObserved,true);assert.equal(x.spawns,1);assert.equal(x.kills,0);
 const raw=await readJson(path.join(x.directory,'result.json'));assert.equal(raw.data.postExitDiskHashObserved,undefined);
 const again=await x.adapter.reconcile(x.directory);assert.equal(again.status,'succeeded');assert.equal(again.data.workerDiskHash,x.raw.data.diskHash);
});
test('production adapter clear: changed disk after raw result freezes and retains original; no restored-byte upgrade',async()=>{
 let original;
 const x=await scenario({code:0,command:'clear_placeholder',afterResult:async({request})=>{
   original=await fs.readFile(request.projectPath);await fs.appendFile(request.projectPath,' external change');
 }});
 assert.equal(x.result.status,'unknown');assert.equal(x.result.error.code,'CLEAR_SAVED_DISK_CHANGED');
 assert.deepEqual(await readJson(path.join(x.directory,'result.json')),x.raw);
 await fs.writeFile(x.request.projectPath,original); // Synthetic offline file only: exercise sticky failure.
 assert.equal((await x.adapter.reconcile(x.directory)).status,'unknown');assert.equal(x.spawns,1);assert.equal(x.kills,0);
});
for(const [name,options] of [['nonzero',{code:3221226525}],['signal',{code:null,signal:'SIGTERM'}],['unknown-code',{code:null}]])
test('production adapter clear rejects '+name,async()=>{
 const x=await scenario({...options,command:'clear_placeholder'});assert.equal(x.result.status,'unknown',JSON.stringify(x.result));
 assert.equal((await x.adapter.reconcile(x.directory)).status,'unknown');assert.equal(x.spawns,1);assert.equal(x.kills,0);
 assert.deepEqual(await readJson(path.join(x.directory,'result.json')),x.raw);
});
test('production adapter clear rejects missing exit receipt on restart',async()=>{
 const x=await scenario({code:0,command:'clear_placeholder'});assert.equal(x.result.status,'succeeded');
 await fs.rename(path.join(x.directory,'process-exit.json'),path.join(x.directory,'process-exit.offline-held.json'));
 const r=await x.adapter.reconcile(x.directory);assert.equal(r.status,'unknown');assert.equal(x.spawns,1);
});
