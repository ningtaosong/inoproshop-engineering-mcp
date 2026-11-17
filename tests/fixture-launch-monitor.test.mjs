import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {monitorFixture} from '../scripts/fixture-launch-monitor.mjs';

const base=async(out,spawnFn,deadlineMs=100,hasResult=false)=>monitorFixture({
  dataDir:'D:/test-data',target:'D:/test-fixture.project',exe:'D:/IDE.exe',profile:'InoProShop(V1.9.1.6)',
  script:'D:/prepare.py',result:'D:/native-result.json',out,deadlineMs,spawnFn,
  store:{operations:async()=>[],acquire:async()=>{},release:async()=>{}},
  getIsolationState:async()=>({own:[]}),checkIsolation:async()=>{},
  probeFn:async pid=>({state:'running',identity:{version:1,platform:'win32',host:'test',pid,startId:'123'}}),
  read:async p=>{if(p==='D:/native-result.json'){
    if(!hasResult)throw Object.assign(Error('missing'),{code:'ENOENT'});
    return Buffer.from(JSON.stringify({target:'D:/test-fixture.project',passed:true,stages:['open','reopen','final-close']}));
  }return Buffer.from(p);}
});
const fakeChild=(delay=0)=>{const c=new EventEmitter();c.pid=12345;c.stdout=new PassThrough();c.stderr=new PassThrough();
  setTimeout(()=>{c.stdout.write('native stdout\n');c.stderr.write('native stderr\n');c.stdout.end();c.stderr.end();c.emit('exit',0,null);},delay);return c;};
const events=async out=>(await readFile(path.join(out,'launcher-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);

test('spawn failure is durable and cannot be reported as preparation success',async()=>{
  const out=await mkdtemp(path.join(os.tmpdir(),'ino-monitor-spawn-'));
  await assert.rejects(base(out,()=>{throw Error('launch refused');}),/launch refused/);
  const rows=await events(out);assert.deepEqual(rows.slice(0,2).map(x=>x.stage),['before-acquire','lease-acquired']);
  assert.ok(rows.some(x=>x.stage==='spawn-failed'));
  assert.equal(JSON.parse(await readFile(path.join(out,'launcher-summary.json'),'utf8')).status,'launcher-error');
});
test('zero exit without native result remains uncertain; streams and identity are retained',async()=>{
  const out=await mkdtemp(path.join(os.tmpdir(),'ino-monitor-no-result-'));
  const r=await base(out,()=>fakeChild());assert.equal(r.status,'no-native-result');
  const rows=await events(out);assert.ok(rows.some(x=>x.stage==='child-created'&&x.pid===12345));
  assert.ok(rows.some(x=>x.stage==='child-identity'&&x.observation.identity.startId==='123'));
  assert.ok(rows.some(x=>x.stage==='result-inspected'&&x.present===false));
  assert.match(await readFile(path.join(out,'stdout.txt'),'utf8'),/native stdout/);
  assert.match(await readFile(path.join(out,'stderr.txt'),'utf8'),/native stderr/);
});
test('deadline records still running and waits for natural exit without killing',async()=>{
  const out=await mkdtemp(path.join(os.tmpdir(),'ino-monitor-timeout-'));
  let child;const r=await base(out,()=>child=fakeChild(80),5);
  assert.equal(r.timedOut,true);assert.equal(r.status,'no-native-result');
  assert.ok((await events(out)).some(x=>x.stage==='observation-deadline'));
  assert.equal(child.listenerCount('exit'),0);
});
test('a written success field without the final publication phase is incomplete',async()=>{
  const out=await mkdtemp(path.join(os.tmpdir(),'ino-monitor-partial-'));
  const r=await base(out,()=>fakeChild(),100,true);
  assert.equal(r.nativePassed,true);
  assert.equal(r.nativePublicationComplete,false);
  assert.equal(r.status,'incomplete-native-publication');
});
test('zero exit and a complete matching publication phase can prove fixture completion',async()=>{
  const out=await mkdtemp(path.join(os.tmpdir(),'ino-monitor-complete-'));
  await writeFile(path.join(out,'native-phase-000019.json'),JSON.stringify({stage:'result-publish',status:'succeeded',target:'D:/test-fixture.project'}));
  const r=await base(out,()=>fakeChild(),100,true);
  assert.equal(r.nativePublicationComplete,true);
  assert.equal(r.status,'succeeded');
});
