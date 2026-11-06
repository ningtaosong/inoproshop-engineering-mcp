import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access,realpath,link} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect,app,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {digest,Store} from '../dist/storage.js';

async function context(t,extra={}) {const e=await setup(extra),c=await connect(e.dataDir);t.after(()=>c.client.close());return {e,c};}
async function call(c,name,args={}) {return c.done(await c.call(name,args));}
async function open(c,file,more={}) {return call(c,'project_open',{requestId:randomUUID(),projectPath:file,applicationId:app,...more});}
const target=s=>({projectId:s.projectId,applicationId:s.applicationId});
const hash=async file=>digest(await readFile(file));

test('direct stdio: same path write/build/save/read, retained historical baseline and no projects directory',async t=>{
 const {e,c}=await context(t),original=await readFile(e.source),r=await open(c,e.source);assert.equal(r.status,'succeeded',JSON.stringify(r));
 const s=r.data.session,a=target(s);assert.equal(s.storageMode,'direct');assert.equal(s.editMode,'direct');assert.equal(r.data.projectPath,await realpath(e.source));assert.equal(r.data.reused,false);
 await assert.rejects(()=>access(path.join(e.dataDir,'projects')),x=>x.code==='ENOENT');
 const baseline=await call(c,'project_compare',{...a,mode:'capture',origin:'current-project'});assert.equal(baseline.status,'succeeded',JSON.stringify(baseline));
 const read=await call(c,'object_read',{...a,objectId:obj});
 const args={...a,objectId:obj,requestId:'direct-change',expectedHash:read.data.contentHash,declaration:read.data.declaration,implementation:read.data.implementation+'\n// direct'};
 const changed=await call(c,'code_apply_change',args);assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.persistedToProject,true);assert.equal(changed.data.persistedToWorkingCopy,undefined);
 assert.notEqual(await hash(e.source),digest(original));assert.deepEqual(await readFile(changed.data.checkpoint),original);
 assert.equal((await call(c,'code_apply_change',args)).operationId,changed.operationId);
 const build=await call(c,'project_build',{...a,requestId:'direct-build'});assert.equal(build.data.buildPassed,true);
 const saved=await call(c,'project_save',{...a,requestId:'direct-save',expectedSnapshot:build.data.snapshot});assert.equal(saved.data.reopened,true);
 const final=await call(c,'project_compare',{...a,mode:'capture',origin:'current-project'});assert.equal(final.status,'succeeded',JSON.stringify(final));
 const compared=await call(c,'project_compare',{...a,mode:'compare',baselineOperationId:baseline.operationId,targetOperationId:final.operationId});assert.equal(compared.status,'succeeded',JSON.stringify(compared));assert.equal(compared.data.counts.object.modified,1);
 assert.equal(compared.data.baseline.projectPath,compared.data.target.projectPath);assert.notEqual(compared.data.baseline.diskHash,compared.data.target.diskHash);
 assert.equal((await open(c,e.source)).data.session.projectId,s.projectId);assert.equal((await open(c,e.source)).data.reused,true);
 const noSource=await call(c,'project_compare',{...a,mode:'capture',origin:'registered-source'});assert.equal(noSource.error.code,'NO_REGISTERED_SOURCE');
 assert.equal((await c.call('session_status')).data.writeFrozen,false);
 await assert.rejects(()=>access(path.join(e.dataDir,'projects')),x=>x.code==='ENOENT');
});

test('original source is not redirected to legacy copy; explicit copy path reuses its original identity',async t=>{
 const {e,c}=await context(t),legacy=await call(c,'project_open_copy',{requestId:'copy',sourcePath:e.source,applicationId:app}),s=legacy.data.session;
 const original=await hash(e.source),oldSource=s.sourceHash;
 const atCopy=await open(c,s.workingPath);assert.equal(atCopy.status,'succeeded',JSON.stringify(atCopy));assert.equal(atCopy.data.session.projectId,s.projectId);assert.equal(atCopy.data.session.sourceHash,oldSource);assert.equal(atCopy.data.projectPath,s.workingPath);
 const direct=await open(c,e.source);assert.equal(direct.status,'succeeded',JSON.stringify(direct));assert.notEqual(direct.data.session.projectId,s.projectId);assert.equal(direct.data.projectPath,await realpath(e.source));
 const again=await call(c,'project_open_copy',{requestId:'copy-again',sourcePath:e.source,applicationId:app});assert.equal(again.data.session.projectId,s.projectId);assert.equal(again.data.projectPath,s.workingPath);
 assert.equal((await c.call('project_list')).data.projects.length,2);assert.equal(await hash(e.source),original);
});

test('legacy copy can still be requested after a direct source registration',async t=>{
 const {e,c}=await context(t);const direct=await open(c,e.source);const old=await call(c,'project_open_copy',{requestId:'explicit-copy',sourcePath:e.source,applicationId:app});
 assert.equal(old.status,'succeeded',JSON.stringify(old));assert.notEqual(old.data.projectPath,direct.data.projectPath);assert.equal(old.data.session.storageMode,undefined);
 assert.equal((await open(c,e.source)).data.projectPath,direct.data.projectPath);
});

test('explicit direct access to a legacy copy preserves registered-source comparison and historical current snapshot',async t=>{
 const {e,c}=await context(t),legacy=await call(c,'project_open_copy',{requestId:'legacy-origin',sourcePath:e.source,applicationId:app}),s=(await open(c,legacy.data.projectPath)).data.session,a=target(s);
 const source=await call(c,'project_compare',{...a,mode:'capture',origin:'registered-source'});assert.equal(source.status,'succeeded',JSON.stringify(source));assert.equal(source.data.snapshot.origin,'registered-source');
 const current=await call(c,'project_compare',{...a,mode:'capture',origin:'working-copy'});assert.equal(current.status,'succeeded',JSON.stringify(current));assert.equal(current.data.snapshot.origin,'current-project');
 const result=await call(c,'project_compare',{...a,mode:'compare',baselineOperationId:source.operationId,targetOperationId:current.operationId});assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.data.counts.object.modified,0);
});

test('ambiguous Application open is read-only; exact retry reuses candidate identity',async t=>{
 const {e,c}=await context(t),first=await call(c,'project_open',{requestId:'choose-application',projectPath:e.source});assert.equal(first.error.code,'APPLICATION_SELECTION_REQUIRED');
 const saved=JSON.parse(await readFile(path.join(e.dataDir,'operations',first.operationId+'.json'))).value;
 const second=await open(c,e.source);assert.equal(second.status,'succeeded',JSON.stringify(second));assert.equal(second.data.session.projectId,saved.project.projectId);assert.equal((await c.call('project_list')).data.projects.length,1);
});

test('every direct operation rejects external disk changes before native dispatch, without accepting a new baseline',async t=>{
 for(const name of ['object_read','object_list','project_build','project_save','code_apply_change','project_open']){
  const {e,c}=await context(t),opened=await open(c,e.source),s=opened.data.session;
  await writeFile(e.source,(await readFile(e.source,'utf8'))+' ');
  const args=name==='project_open'?{requestId:randomUUID(),projectPath:e.source,applicationId:app}:name==='object_read'?{...target(s),objectId:obj}:name==='object_list'?target(s):name==='code_apply_change'?{...target(s),requestId:randomUUID(),objectId:obj,expectedHash:'0'.repeat(64),declaration:'x',implementation:'y'}:{...target(s),requestId:randomUUID(),...(name==='project_save'?{expectedSnapshot:s.snapshot}:{})};
  const result=await call(c,name,args);assert.equal(result.status,'conflict',name+JSON.stringify(result));
  const op=JSON.parse(await readFile(path.join(e.dataDir,'operations',result.operationId+'.json'))).value;assert.equal(op.bridge,undefined);
 }
});

test('native ownership markers block direct opening and later saves without removing marker',async t=>{
 for(const suffix of ['.~u','.lock','.lck','.~lock']) {
  const {e,c}=await context(t);await writeFile(e.source+suffix,'external owner');const r=await open(c,e.source);assert.equal(r.error.code,'PROJECT_BUSY');assert.equal(await readFile(e.source+suffix,'utf8'),'external owner');
 }
 const {e,c}=await context(t),s=(await open(c,e.source)).data.session;await writeFile(e.source+'.~u','unsaved external IDE');
 const r=await call(c,'project_save',{...target(s),requestId:'busy-save',expectedSnapshot:s.snapshot});assert.equal(r.error.code,'PROJECT_BUSY');
});

test('direct hardlink alias fails clearly; canonical same file never receives two live bindings',async t=>{
 const {e,c}=await context(t);await open(c,e.source);const alias=path.join(e.dir,'alias.json');await link(e.source,alias);
 const r=await open(c,alias);assert.equal(r.error.code,'PROJECT_PATH_ALIAS');assert.equal((await c.call('project_list')).data.projects.length,1);
});

test('unknown direct write preserves partial disk and checkpoint, no rollback or repeated dispatch',async t=>{
 const {e,c}=await context(t,{failImplementation:true}),s=(await open(c,e.source)).data.session,a=target(s),before=await readFile(e.source),r=await call(c,'object_read',{...a,objectId:obj});
 const args={...a,requestId:'partial-direct',objectId:obj,expectedHash:r.data.contentHash,declaration:r.data.declaration+'\n// partial',implementation:r.data.implementation};
 const failed=await call(c,'code_apply_change',args);assert.equal(failed.status,'unknown');assert.notEqual(await hash(e.source),digest(before));assert.deepEqual(await readFile(failed.data.checkpoint),before);
 assert.equal((await call(c,'code_apply_change',args)).operationId,failed.operationId);assert.equal((await c.call('session_status')).data.writeFrozen,true);
 assert.equal((await open(c,e.source)).error.code,'PENDING_UNKNOWN');
});

test('missing native direct guard evidence freezes rather than publishing a successful direct open',async t=>{
 const e=await setup(),fixture=new FixtureAdapter();let calls=0;
 const service=new EngineeringService({testMode:true,dataDir:e.dataDir,responseWaitMs:1000},{reconcile:d=>fixture.reconcile(d),execute:async(...a)=>{calls++;const r=await fixture.execute(...a);delete r.data.directFileEvidence;return r;}});
 t.after(()=>service.store.release());const r=await service.call('project_open',{requestId:'missing-evidence',projectPath:e.source,applicationId:app});
 assert.equal(r.status,'unknown');assert.equal(r.error.code,'DIRECT_EVIDENCE_INVALID');assert.equal(calls,1);assert.equal((await service.status()).data.globalFrozen,true);
});

test('direct session and historical snapshots survive service restart',async t=>{
 const {e,c}=await context(t),s=(await open(c,e.source)).data.session,a=target(s),b=await call(c,'project_compare',{...a,mode:'capture',origin:'current-project'});
 await c.client.close();const second=await connect(e.dataDir);t.after(()=>second.client.close());const r=await open(second,e.source);assert.equal(r.data.session.projectId,s.projectId);
 const result=await call(second,'project_compare',{...a,mode:'compare',baselineOperationId:b.operationId,targetOperationId:b.operationId});assert.equal(result.status,'succeeded',JSON.stringify(result));
});

test('first direct activation upgrades registry envelope; old records retained and downgraded direct records freeze',async t=>{
 const {e,c}=await context(t),legacy=await call(c,'project_open_copy',{requestId:'old-binding',sourcePath:e.source,applicationId:app}),store=new Store(e.dataDir),before=await store.registry();assert.equal(before.version,1);
 await open(c,e.source);const after=await store.registry();assert.equal(after.version,2);assert.deepEqual(after.projects.find(s=>s.projectId===legacy.data.session.projectId),before.projects[0]);
 await store.put('registry.json',{...after,version:1});assert.equal((await c.call('session_status')).data.globalFrozen,true);
});
