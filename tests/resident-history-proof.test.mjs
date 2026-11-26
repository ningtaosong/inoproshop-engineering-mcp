import {test} from 'node:test';import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {verifyClosedResident} from '../dist/resident-reopen.js';
import {residentDependencies,residentHash,verifyResidentResult} from '../dist/resident.js';
import {digest} from '../dist/storage.js';
const archive=JSON.parse(await fs.readFile(new URL('fixtures/resident-closed-list-20261126.json',import.meta.url),'utf8'));
async function historicalFixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'resident-history-')),file=path.join(root,'saved.project');await fs.writeFile(file,'offline saved bytes');
 const stat=await fs.stat(file,{bigint:true}),diskHash=digest(await fs.readFile(file)),fileId=`${stat.dev}:${stat.ino}`,a=structuredClone(archive),launchId=a.launch['intent.json'].launchId;
 const native=a.launch['process-start.json'].processIdentity;native.platform=process.platform;native.host=os.hostname().toLowerCase();
 a.launch['process-exit.json'].processIdentity=structuredClone(native);
 const s=structuredClone(a.operations.at(-1).operation.project);s.lastStateOperationId=a.operations.at(-1).operation.operationId;s.diskHash=diskHash;s.workingPath=file;
 const directory=path.join(root,'resident',launchId);await fs.mkdir(directory,{recursive:true});
 Object.assign(a.launch['intent.json'],{directory,projectPath:file,originalFileId:fileId});
 for(const [name,value] of Object.entries(a.launch))await fs.writeFile(path.join(directory,name),JSON.stringify(value));
 for(const entry of a.operations){
  const op=entry.operation,ipc=path.join(root,'ipc',op.operationId),f=entry.files;await fs.mkdir(ipc,{recursive:true});op.project=structuredClone(s);op.bridge.directory=ipc;op.ownerIdentity.platform=process.platform;op.ownerIdentity.host=os.hostname().toLowerCase();
  Object.assign(f['request.json'],{projectPath:file,fileIdentity:fileId,diskHash});
  f['before.json'].diskHash=diskHash;f['before.json'].state.projectPath=file;f['before.json'].state.openedProjects['0'].path=file;
  const data=f['result.json'].data;data.diskHash=diskHash;data.projectPath=file;data.snapshot=residentHash(residentDependencies(f['before.json'].state));data.residentVersion=residentHash({dependencies:residentDependencies(f['before.json'].state),diskHash});
  const requestHash=residentHash(f['request.json']);data.residentEvidence.requestHash=requestHash;
  const resultHash=residentHash(f['result.json']);Object.assign(f['completed.json'],{requestHash,resultHash});Object.assign(f['service-verification.json'],{requestHash,resultHash,processIdentity:native,diskHash});op.response=structuredClone(f['result.json']);
  for(const [name,value] of Object.entries(f))await fs.writeFile(path.join(ipc,name),JSON.stringify(value));
 }
 const operations=a.operations.map(x=>x.operation),store={file:r=>path.join(root,r),operations:async()=>operations},probe=async()=>({state:'exited'});
 const fingerprints=async()=>{const rows=[];async function walk(dir){for(const d of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())await walk(p);else rows.push([path.relative(root,p),digest(await fs.readFile(p))]);}}await walk(root);return rows;};
 return {root,file,directory,operations,store,s,probe,archive:a,native,fingerprints};
}
test('historical real excluded-list proof survives newer business classification without rewriting evidence',async()=>{
 const f=await historicalFixture(),entry=f.archive.operations.at(-1),ipc=entry.operation.bridge.directory,before=await f.fingerprints();
 // Replaying today's business whitelist is deliberately not a historical proof.
 await assert.rejects(verifyResidentResult(entry.files['request.json'],entry.files['result.json'],ipc,f.native),/Excluded object coverage differs/);
 const proof=await verifyClosedResident(f.store,f.s,'new-open',f.probe);assert.equal(proof.priorLaunchId,f.archive.launch['intent.json'].launchId);assert.deepEqual(await f.fingerprints(),before);
});
test('non-native predispatch open conflict is not counted as another old native sequence',async()=>{
 const f=await historicalFixture();const conflict={operationId:randomUUID(),requestId:randomUUID(),tool:'project_open',status:'conflict',project:structuredClone(f.s),response:{status:'conflict',error:{code:'RESIDENT_RECONNECT_UNSUPPORTED'}}};f.operations.push(conflict);
 const proof=await verifyClosedResident(f.store,f.s,'next-new-open',f.probe);assert.equal(proof.operationIds.length,2);assert(!proof.operationIds.includes(conflict.operationId));
});
for(const fault of ['result-hash','request-hash','completed-hash','verification-missing','verification-false','receipt-launch','unknown','live','exit-nonzero'])test('historical completion proof rejects '+fault,async()=>{
 const f=await historicalFixture(),entry=f.archive.operations.at(-1),ipc=entry.operation.bridge.directory;
 const edit=async(name,change)=>{const p=path.join(ipc,name),v=JSON.parse(await fs.readFile(p,'utf8'));change(v);await fs.writeFile(p,JSON.stringify(v));};
 if(fault==='result-hash')await edit('result.json',r=>r.data.total=100);
 if(fault==='request-hash')await edit('request.json',r=>r.args.limit=1);
 if(fault==='completed-hash')await edit('completed.json',r=>r.resultHash='f'.repeat(64));
 if(fault==='verification-missing')await fs.unlink(path.join(ipc,'service-verification.json'));
 if(fault==='verification-false')await edit('service-verification.json',r=>r.passed=false);
 if(fault==='receipt-launch')await edit('completed.json',r=>r.launchId=randomUUID());
 if(fault==='unknown')entry.operation.status='unknown';
 if(fault==='exit-nonzero'){const p=path.join(f.directory,'process-exit.json'),r=JSON.parse(await fs.readFile(p,'utf8'));r.code=23;await fs.writeFile(p,JSON.stringify(r));}
 const probe=fault==='live'?async()=>({state:'running',identity:f.native}):f.probe;
 const before=await f.fingerprints();await assert.rejects(verifyClosedResident(f.store,f.s,'new-open',probe),e=>e.code==='RESIDENT_RECONNECT_UNSUPPORTED');assert.deepEqual(await f.fingerprints(),before);
});
