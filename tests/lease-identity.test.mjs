// Process-instance doubles model PID reuse; no real PID churn or IDE fault injection.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {Store} from '../dist/storage.js';
import {probeProcess,observeLeaseOwner,sameProcess,sealLease} from '../dist/lease-process.js';
const identity=n=>({version:1,platform:'win32',host:'fixture-host',pid:process.pid,startId:String(n)});
const run=(n,pid=process.pid)=>({state:'running',identity:{...identity(n),pid}});
const root=()=>fs.mkdtemp(path.join(os.tmpdir(),'InoPro lease case '));
const record=(r,n=100,pid=process.pid)=>sealLease({leaseVersion:2,leaseId:randomUUID(),pid,dataDir:r,createdAt:new Date().toISOString(),processIdentity:{...identity(n),pid}});
const write=(p,v)=>fs.writeFile(p,JSON.stringify(v));
const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
test('PID reuse: live PID with a different recorded process instance must not produce SESSION_BUSY',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'InoPro lease identity '));
 const old=record(root,100);
 await fs.writeFile(path.join(root,'service.lock'),JSON.stringify(old));
 const store=new Store(root,{probe:async pid=>({state:'running',identity:{...identity(200),pid}})});
 await store.lease(store.file('service.lock'));
 assert.notEqual(JSON.parse(await fs.readFile(store.file('service.lock'))).leaseId,old.leaseId);
 await store.release();
});
test('active matching process instance prevents another service; lease acquisition IDs differ after release',async()=>{
 const r=await root(),a=new Store(r,{probe:async()=>run(100)}),b=new Store(r,{probe:async()=>run(100)}),p=a.file('service.lock');
 await a.lease(p);const first=await json(p);await assert.rejects(()=>b.lease(p),e=>e.code==='SESSION_BUSY');
 assert.deepEqual(await json(p),first);await a.lease(p);await a.release();await b.lease(p);assert.notEqual((await json(p)).leaseId,first.leaseId);await b.release();
});
test('same PID does not prove ownership: same-directory replacement blocks recheck and all-lock release',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(100)}),p=s.file('service.lock'),q=s.file('other.lock');
 await s.lease(p);await s.lease(q);const original=await fs.readFile(q),replacement={...(await json(q)),leaseId:randomUUID()};await write(q,replacement);
 await assert.rejects(()=>s.lease(q),e=>e.code==='LOCK_CHANGED');await assert.rejects(()=>s.release(),e=>e.code==='LOCK_CHANGED');
 await fs.access(p);assert.deepEqual(await json(q),replacement);await fs.writeFile(q,original);await s.release();
});
test('unconfirmed/denied/throwing identity probes preserve existing lease; own query failure cannot create a lock',async()=>{
 for(const outcome of [{state:'unconfirmed',reason:'access-denied'},null]) {
  const r=await root(),p=path.join(r,'service.lock'),old=record(r,100,12345);await write(p,old);
  const s=new Store(r,{probe:async pid=>{if(pid===process.pid)return run(200);if(outcome)return outcome;throw Error('denied');}});
  await assert.rejects(()=>s.lease(p),e=>e.code==='LEASE_IDENTITY_UNCONFIRMED');assert.deepEqual(await json(p),old);
 }
 const r=await root(),s=new Store(r,{probe:async()=>({state:'unconfirmed',reason:'self-denied'})});
 await assert.rejects(()=>s.lease(s.file('service.lock')),e=>e.code==='LEASE_IDENTITY_UNCONFIRMED');await assert.rejects(()=>fs.access(s.file('service.lock')));
});
test('legacy exited owner can be archived verbatim; legacy live PID cannot be inferred stale from its newer start time',async()=>{
 for(const exited of [false,true]) {
  const r=await root(),p=path.join(r,'service.lock'),old={pid:12345,dataDir:r,createdAt:'2020-01-01T00:00:00.000Z'};await write(p,old);const bytes=await fs.readFile(p);
  const s=new Store(r,{probe:async pid=>pid===process.pid?run(200):exited?{state:'exited'}:run(200,pid)});
  if(!exited){await assert.rejects(()=>s.lease(p),e=>e.code==='LEASE_IDENTITY_UNCONFIRMED');assert.deepEqual(await fs.readFile(p),bytes);}
  else {await s.lease(p);const archives=(await fs.readdir(r)).filter(x=>x.includes('.stale.'));assert.equal(archives.length,1);assert.deepEqual(await fs.readFile(path.join(r,archives[0])),bytes);await s.release();}
 }
});
test('two concurrent reclaimers cannot both acquire; no lease is overwritten',async()=>{
 const r=await root(),p=path.join(r,'service.lock');await write(p,record(r,1));
 const a=new Store(r,{probe:async()=>run(2)}),b=new Store(r,{probe:async()=>run(2)});
 const result=await Promise.allSettled([a.lease(p),b.lease(p)]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 assert(['LOCK_RECLAIM_BUSY','SESSION_BUSY'].includes(result.find(x=>x.status==='rejected').reason.code));await a.release();await b.release();
});
test('owner process instance changes between checks: reclaim refuses instead of using an earlier observation',async()=>{
 const r=await root(),p=path.join(r,'service.lock'),old=record(r,1,12345);await write(p,old);let calls=0;
 const s=new Store(r,{probe:async pid=>pid===process.pid?run(2):run(++calls===1?2:3,pid)});
 await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_OWNER_CHANGED');assert.deepEqual(await json(p),old);
});
test('lease bytes change during identity checks: refuse reclaim and retain replacement',async()=>{
 const r=await root(),p=path.join(r,'service.lock'),old=record(r,1),replacement=record(r,3);await write(p,old);let calls=0;
 const s=new Store(r,{probe:async()=>{if(++calls===2)await write(p,replacement);return run(2);}});
 await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_CHANGED');assert.deepEqual(await json(p),replacement);
});
test('replaced .reclaim marker is preserved, original refusal is retained with cleanup failure',async()=>{
 const r=await root(),p=path.join(r,'service.lock'),old=record(r),marker={external:'must-not-delete'};await write(p,old);let calls=0;
 const s=new Store(r,{probe:async()=>{if(++calls===2)await write(p+'.reclaim',marker);return run(100);}});
 await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_CLEANUP_UNCONFIRMED'&&e.cause.code==='SESSION_BUSY'&&!!e.cleanup);
 assert.deepEqual(await json(p+'.reclaim'),marker);assert.deepEqual(await json(p),old);
});
test('pre-existing reclaim marker/invalid records are never silently removed or treated as exited',async()=>{
 for(const value of ['{broken',{}, {pid:0,dataDir:'relative',createdAt:'bad'}, {...record('x'),leaseId:'bad'}, {pid:process.pid,dataDir:await root()}]) {
  const r=await root(),p=path.join(r,'service.lock');await fs.writeFile(p,typeof value==='string'?value:JSON.stringify(value));const before=await fs.readFile(p);
  const s=new Store(r,{probe:async()=>run(200)});await assert.rejects(()=>s.lease(p),e=>e.status==='unknown');assert.deepEqual(await fs.readFile(p),before);
 }
 const r=await root(),p=path.join(r,'service.lock');await write(p+'.reclaim',{old:true});const s=new Store(r,{probe:async()=>run(2)});
 await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_RECLAIM_BUSY');assert.deepEqual(await json(p+'.reclaim'),{old:true});
});
test('real OS process creation identity is stable, live lease exclusion and release use the real probe',async()=>{
 const a=await probeProcess(process.pid),b=await probeProcess(process.pid);assert.equal(a.state,'running');assert(sameProcess(a.identity,b.identity));assert.equal((await probeProcess(2147483647)).state,'exited');
 const r=await root(),s=new Store(r),p=s.file('service.lock');await s.lease(p);const lock=await json(p);assert(sameProcess(lock.processIdentity,a.identity));
 assert.equal((await observeLeaseOwner(lock)).state,'active');await assert.rejects(()=>new Store(r).lease(p),e=>e.code==='SESSION_BUSY');await s.release();await assert.rejects(()=>fs.access(p));
});
test('different identity domains are not evidence of PID reuse',async()=>{
 const r=await root(),old=record(r);const state=await observeLeaseOwner(old,async()=>({state:'running',identity:{...identity(200),host:'another-host'}}));assert.equal(state.state,'unconfirmed');
});
test('identical bytes in a replaced file do not pass held-lease revalidation',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(1)}),p=s.file('service.lock');await s.lease(p);
 const raw=await fs.readFile(p);await fs.rename(p,p+'.old');await fs.writeFile(p,raw);
 await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_CHANGED');await assert.rejects(()=>s.release(),e=>e.code==='LOCK_CHANGED');assert.deepEqual(await fs.readFile(p),raw);
});
test('service and source path leases have independent acquisition IDs and normal source release preserves service lease',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(1)}),source=path.join(r,'fixture.project'),p=s.file('service.lock'),q=s.sourceLock(source);
 await s.acquire(source);assert.notEqual((await json(p)).leaseId,(await json(q)).leaseId);await s.releaseSource(source);await fs.access(p);await assert.rejects(()=>fs.access(q));await s.release();
});
test('foreign missing records/pending operations still prevent takeover after owner exit',async()=>{
 const r=await root(),foreign=await root(),s=new Store(r,{probe:async pid=>pid===process.pid?run(2):{state:'exited'}}),p=s.file('service.lock');
 await write(p,{pid:12345,dataDir:foreign,createdAt:new Date().toISOString()});const raw=await fs.readFile(p);
 await assert.rejects(()=>s.lease(p),e=>e.code==='FOREIGN_RECORDS_MISSING');assert.deepEqual(await fs.readFile(p),raw);
});
test('lease read permission failure preserves bytes and does not become stale',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(1)}),p=s.file('service.lock'),old=record(r);await write(p,old);
 const open=fs.open;fs.open=async function(file,...args){if(file===p){const e=new Error('synthetic ACL denial');e.code='EACCES';throw e;}return open.call(this,file,...args);};
 try {await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_RECORD_INVALID');}finally{fs.open=open;}
 assert.deepEqual(await json(p),old);
});
test('valid-shaped but damaged birth identity/checksum is unconfirmed, not PID reuse',async()=>{
 const r=await root(),old=record(r),damaged={...old,processIdentity:{...old.processIdentity,startId:'123'}};
 const observed=await observeLeaseOwner(damaged,async()=>run(200));assert.equal(observed.state,'unconfirmed');assert.equal(observed.reason,'lease-checksum-mismatch');
});
test('overlapping rechecks from the same service serialize, while another service remains excluded',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(1)}),p=s.file('service.lock');await s.lease(p);
 await Promise.all(Array.from({length:8},()=>s.lease(p)));const old=await json(p);
 await assert.rejects(()=>new Store(r,{probe:async()=>run(1)}).lease(p),e=>e.code==='SESSION_BUSY');assert.deepEqual(await json(p),old);await s.release();
});
test('partial lease write is retained as uncertain evidence, never overwritten on retry',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(1)}),p=s.file('service.lock'),open=fs.open;
 fs.open=async function(file,...args){const f=await open.call(this,file,...args);if(file===p&&args[0]==='wx'){const write=f.writeFile.bind(f);f.writeFile=async()=>{await write('{partial');throw Error('synthetic interrupted write');};}return f;};
 try{await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_WRITE_UNCONFIRMED');}finally{fs.open=open;}
 const raw=await fs.readFile(p,'utf8');assert.equal(raw,'{partial');await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_RECORD_INVALID');assert.equal(await fs.readFile(p,'utf8'),raw);
});
test('partial guard write leaves the exclusive marker for inspection',async()=>{
 const r=await root(),s=new Store(r,{probe:async()=>run(1)}),p=s.file('service.lock'),open=fs.open;
 fs.open=async function(file,...args){const f=await open.call(this,file,...args);if(file===p+'.reclaim'){const write=f.writeFile.bind(f);f.writeFile=async()=>{await write('{partial-guard');throw Error('synthetic guard write failure');};}return f;};
 try{await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_GUARD_UNCONFIRMED');}finally{fs.open=open;}
 assert.equal(await fs.readFile(p+'.reclaim','utf8'),'{partial-guard');await assert.rejects(()=>s.lease(p),e=>e.code==='LOCK_RECLAIM_BUSY');await assert.rejects(()=>fs.access(p));
});
