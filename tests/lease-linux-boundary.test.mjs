// Production probeProcess with system-interface doubles on the Windows host.
// These are not Linux/WSL, real process-exit, or IDE acceptance records.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {probeProcess,observeLeaseOwner} from '../dist/lease-process.js';
import {Store} from '../dist/storage.js';
const pid=424242,bootPath='/proc/sys/kernel/random/boot_id',statPath=`/proc/${pid}/stat`,boot='11111111-2222-3333-4444-555555555555';
const fields=Array(30).fill('0');fields[0]='S';fields[19]='12345';
const stat=`${pid} (fixture process name) ${fields.join(' ')}\n`;
const cases=[
 {name:'live PID, boot_id ENOENT',file:bootPath,code:'ENOENT'},
 {name:'live PID, pid/stat ENOENT',file:statPath,code:'ENOENT'},
 {name:'live PID, boot_id EACCES',file:bootPath,code:'EACCES'},
 {name:'live PID, pid/stat EPERM',file:statPath,code:'EPERM'},
 {name:'live PID, malformed boot_id',file:bootPath,content:'not-a-boot-identity'},
 {name:'live PID, malformed pid/stat',file:statPath,content:'unverifiable stat'}
];
async function systemDouble(spec,run) {
 const platform=Object.getOwnPropertyDescriptor(process,'platform'),kill=process.kill,read=fs.readFile,calls={kill:[],read:[]};
 assert.equal(platform.configurable,true,'test requires a restorable platform descriptor');
 Object.defineProperty(process,'platform',{...platform,value:'linux'});
 process.kill=function(id,signal){if(id!==pid)return kill.call(this,id,signal);calls.kill.push({pid:id,signal});if(spec.killCode){const e=new Error('synthetic system process query error');e.code=spec.killCode;throw e;}return true;};
 fs.readFile=async function(file,...args){
  if(file!==bootPath&&file!==statPath)return read.call(this,file,...args);
  calls.read.push(file);
  if(file===spec.file){if(spec.code){const e=new Error('synthetic identity file failure');e.code=spec.code;throw e;}return spec.content;}
  return file===bootPath?boot:stat;
 };
 try {return await run(calls);}finally{fs.readFile=read;process.kill=kill;Object.defineProperty(process,'platform',platform);}
}
for(const spec of cases) {
 test('production probe: '+spec.name+' is unconfirmed, never exited/stale',async()=>{
  await systemDouble(spec,async calls=>{
   const observed=await probeProcess(pid);assert.equal(observed.state,'unconfirmed',JSON.stringify({observed,calls}));
   const owner=await observeLeaseOwner({pid,dataDir:path.resolve('fixture-data'),createdAt:'2026-11-10T00:00:00.000Z'});
   assert.equal(owner.state,'unconfirmed');assert(calls.kill.every(c=>c.signal===0));assert(calls.read.includes(spec.file));
  });
 });
 test('lease acquisition: '+spec.name+' preserves original bytes/file and creates no stale archive',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'InoPro Linux identity fixture ')),file=path.join(root,'service.lock');
  const bytes=JSON.stringify({pid,dataDir:root,createdAt:'2026-11-10T00:00:00.000Z'});await fs.writeFile(file,bytes);const original=await fs.stat(file,{bigint:true});
  await systemDouble(spec,async()=>{
   // Only the *own* test-process identity is provided. The lease-owner path
   // calls the actual production probeProcess and its mocked OS/file APIs.
   const store=new Store(root,{probe:id=>id===process.pid?Promise.resolve({state:'running',identity:{version:1,platform:'linux',host:os.hostname().toLowerCase(),pid:id,startId:'99999:'+boot}}):probeProcess(id)});
   let error;try {await store.lease(file);}catch(e){error=e;}
   const after=await fs.readFile(file,'utf8'),names=await fs.readdir(root);
   assert.equal(error?.code,'LEASE_IDENTITY_UNCONFIRMED',JSON.stringify({error:error?.code,bytesChanged:after!==bytes,files:names}));
   assert.equal(after,bytes);assert.equal((await fs.stat(file,{bigint:true})).ino,original.ino);assert.deepEqual(names,['service.lock']);
  });
 });
}
test('production probe: explicit OS ESRCH proves absence without reading identity files',async()=>{
 await systemDouble({killCode:'ESRCH',file:bootPath,code:'ENOENT'},async calls=>{
  assert.deepEqual(await probeProcess(pid),{state:'exited'});
  const owner=await observeLeaseOwner({pid,dataDir:path.resolve('fixture-data'),createdAt:'2026-11-10T00:00:00.000Z'});assert.equal(owner.state,'stale');assert.equal(owner.reason,'owner-pid-exited');assert.deepEqual(calls.read,[]);
 });
});
for(const killCode of ['EPERM','EINVAL'])test('production probe: '+killCode+' plus missing identity is not exit evidence',async()=>{
 await systemDouble({killCode,file:statPath,code:'ENOENT'},async calls=>{assert.equal((await probeProcess(pid)).state,'unconfirmed');assert(calls.read.includes(statPath));});
});
test('production probe: valid existing Linux identity encoding is unchanged (system doubles only)',async()=>{
 await systemDouble({},async()=>{assert.deepEqual(await probeProcess(pid),{state:'running',identity:{version:1,platform:'linux',host:os.hostname().toLowerCase(),pid,startId:'12345:'+boot}});});
});
