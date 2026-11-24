// Synthetic copies of the persisted 0.38 request shape. No IDE, planner or real registry.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Store,canonical,digest,codeHash,atomicJson} from '../dist/storage.js';
import {evaluateIsolation,generatePlan,commitIsolation} from '../dist/isolation.js';
const dead=2147483647;
async function inventory(dir) {
 const rows=[];for(const n of (await fs.readdir(dir)).sort()){
  const p=path.join(dir,n),s=await fs.stat(p);
  if(s.isDirectory())rows.push(...await inventory(p));else rows.push([p,digest(await fs.readFile(p))]);
 }return rows;
}
async function fixture(mode='direct') {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'variable-isolation-')),store=new Store(path.join(dir,'registry'));
 const sourcePath=path.join(dir,'source.project'),workingPath=mode==='direct'?sourcePath:path.join(dir,'copy.project');
 const checkpoint=Buffer.from('synthetic before project bytes'),oldHash=digest(checkpoint);
 await fs.writeFile(sourcePath,checkpoint);await fs.writeFile(workingPath,'synthetic already saved partial change');
 const session={projectId:randomUUID(),sessionId:randomUUID(),sourcePath,workingPath,sourceHash:oldHash,diskHash:oldHash,
  applicationId:randomUUID(),...(mode==='direct'?{storageMode:'direct',editMode:'direct',directPath:workingPath}:{})};
 await store.put('registry.json',{version:2,revision:3,activeProjectId:session.projectId,projects:[session]});
 const before={objectId:randomUUID(),applicationId:session.applicationId,path:['Device','Application','FB_InitProbe'],
  objectType:'function_block',nativeTypeId:'6f9dac99-8de1-4efc-8465-68ac443b7d08',language:'ST',hasImplementation:true,
  declaration:'FUNCTION_BLOCK FB_InitProbe\r\nVAR_INPUT\r\n InputCount : DINT; // 中文\r\nEND_VAR',implementation:'// preserve body'};
 before.contentHash=codeHash(before.declaration,before.implementation);
 const args={requestId:randomUUID(),projectId:session.projectId,targetKind:'application',applicationId:session.applicationId,
  objectId:before.objectId,expectedHash:before.contentHash,expectedSnapshot:digest('snapshot'),expectedDiskHash:oldHash,
  action:'add-initializer',name:'InputCount',initializer:'7',section:'VAR_INPUT'};
 const id=randomUUID(),ipc=store.file('ipc/'+id),launchId=randomUUID();
 const effectiveArgs={...args,declaration:before.declaration.replace('DINT;','DINT := 7;'),implementation:before.implementation,
  objectType:before.objectType,variableEdit:true,initializerTargetGuard:{objectId:before.objectId,applicationId:session.applicationId}};
 const op={schemaVersion:1,registryVersion:1,operationId:id,requestId:args.requestId,tool:'variable_edit',args,effectiveArgs,
  variableOriginal:{...before,projectPath:workingPath,diskHash:oldHash,lifecycle:{saveAttempts:0}},
  fingerprint:digest(canonical({tool:'variable_edit',args})),status:'unknown',ownerPid:dead,startedAt:'2026-11-23T10:00:00Z',
  finishedAt:'2026-11-23T10:01:00Z',project:session,bridge:{directory:ipc,pid:dead,launchId}};
 const request={operationId:id,requestId:args.requestId,requestFingerprint:op.fingerprint,launchId,exitEvidenceVersion:1,
  command:'change',projectPath:workingPath,args:structuredClone(effectiveArgs),resultPath:path.join(ipc,'result.json'),
  checkpointPath:path.join(ipc,'checkpoint.project'),...(mode==='direct'?{fileGuard:{mode:'direct',expectedDiskHash:oldHash}}:{})};
 await store.saveOp(op);await atomicJson(path.join(ipc,'request.json'),request);
 await atomicJson(path.join(ipc,'before.json'),before);await fs.writeFile(path.join(ipc,'checkpoint.project'),checkpoint);
 await atomicJson(path.join(ipc,'dispatched.json'),{operationId:id,pid:dead});
 await atomicJson(path.join(ipc,'result.json'),{operationId:id,status:'succeeded',summary:'bridge saved before exit uncertainty'});
 const lock={pid:dead,dataDir:store.root,createdAt:'2026-11-23T10:00:00Z'};
 await atomicJson(store.file('service.lock'),lock);await atomicJson(store.sourceLock(sourcePath),lock);
 return {dir,store,session,op,request,before,ipc};
}
async function persist(c) {
 await c.store.saveOp(c.op);await atomicJson(path.join(c.ipc,'request.json'),c.request);
 await atomicJson(path.join(c.ipc,'before.json'),c.before);
}
async function observe(c) {
 const before=await inventory(c.dir),sourceLock=await fs.readFile(c.store.sourceLock(c.session.sourcePath));
 const evaluation=await evaluateIsolation(c.store.root,c.op.operationId);
 const plan=await generatePlan(c.store.root,c.op.operationId,'synthetic variable edit ownership only');
 assert.deepEqual(await inventory(c.dir),before);assert.deepEqual(await fs.readFile(c.store.sourceLock(c.session.sourcePath)),sourceLock);
 assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
 assert.equal((await c.store.operation(c.op.operationId)).finishedAt,c.op.finishedAt);
 assert.equal(evaluation.eligible,plan.eligible);assert.equal(evaluation.evidenceVersion,plan.evidenceVersion);
 assert.equal(await c.store.get('isolation-ledger.json'),undefined);
 return plan;
}
for(const mode of ['direct','copy'])test(`persisted variable_edit change evidence is eligible without re-planning (${mode})`,async()=>{
 const c=await fixture(mode),plan=await observe(c);
 assert.equal(plan.eligible,true,JSON.stringify(plan.blockers));
 assert.deepEqual(plan.operationIds,[c.op.operationId]);assert.equal(plan.projectId,c.session.projectId);
 assert.notEqual(digest(await fs.readFile(c.session.workingPath)),c.op.args.expectedDiskHash,'saved partial bytes remain');
});
const mutations={
 'wrong command':c=>{c.request.command='read';},
 'wrong request id':c=>{c.request.requestId=randomUUID();},
 'wrong fingerprint':c=>{c.request.requestFingerprint=digest('wrong');},
 'wrong operation id':c=>{c.request.operationId=randomUUID();},
 'wrong launch id':c=>{c.request.launchId=randomUUID();},
 'wrong project path':c=>{c.request.projectPath=c.session.sourcePath+'.other';},
 'wrong result path':c=>{c.request.resultPath=path.join(c.ipc,'other.json');},
 'wrong checkpoint path':c=>{c.request.checkpointPath=path.join(c.ipc,'other.project');},
 'missing effective arguments':c=>{delete c.op.effectiveArgs;},
 'effective arguments differ from request':c=>{c.op.effectiveArgs.declaration+='\n';},
 'extra bridge argument':c=>{c.request.args.extra='unrecorded';},
 'original argument rewritten in effective and request':c=>{c.op.effectiveArgs.initializer=c.request.args.initializer='9';},
 'object identity differs':c=>{c.before.objectId=randomUUID();},
 'application identity differs':c=>{c.before.applicationId=randomUUID();},
 'missing object identity':c=>{delete c.before.objectId;},
 'invalid object identity':c=>{c.before.objectId='not-a-guid';},
 'wrong object content hash':c=>{c.before.contentHash=digest('wrong');},
 'changed declaration':c=>{c.before.declaration+='\n';},
 'changed implementation':c=>{c.before.implementation+='\n';},
 'changed original path':c=>{c.op.variableOriginal.path=['Other','FB_InitProbe'];},
 'missing original path':c=>{delete c.op.variableOriginal.path;},
 'wrong original project':c=>{c.op.variableOriginal.projectPath=c.session.sourcePath+'.other';},
 'wrong original disk version':c=>{c.op.variableOriginal.diskHash=digest('wrong');},
 'native type differs':c=>{c.op.variableOriginal.nativeTypeId=randomUUID();},
 'shared unknown field differs':c=>{c.before.newEvidence='a';c.op.variableOriginal.newEvidence='b';},
 'non-text before declaration':c=>{c.before.declaration=null;},
 'missing original observation':c=>{delete c.op.variableOriginal;},
 'missing before object type':c=>{delete c.before.objectType;},
 'missing direct file guard':c=>{delete c.request.fileGuard;},
 'wrong direct guard hash':c=>{c.request.fileGuard.expectedDiskHash=digest('wrong');},
 'variableEdit marker missing':c=>{delete c.request.args.variableEdit;delete c.op.effectiveArgs.variableEdit;},
 'effective implementation differs from original':c=>{c.request.args.implementation=c.op.effectiveArgs.implementation='changed';},
 'effective object type differs':c=>{c.request.args.objectType=c.op.effectiveArgs.objectType='gvl';},
};
for(const [name,mutate] of Object.entries(mutations))test('variable_edit isolation rejects '+name,async()=>{
 const c=await fixture();mutate(c);await persist(c);const p=await observe(c);assert.equal(p.eligible,false,name);
});
for(const kind of ['before missing','before corrupt','checkpoint missing','checkpoint changed'])test('variable_edit isolation rejects '+kind,async()=>{
 const c=await fixture(),file=path.join(c.ipc,kind.startsWith('before')?'before.json':'checkpoint.project');
 if(kind.endsWith('missing'))await fs.unlink(file);else await fs.writeFile(file,'corrupt');
 assert.equal((await observe(c)).eligible,false);
});
test('eligible variable_edit plan becomes stale without changing commit exclusivity rules',async()=>{
 const c=await fixture(),plan=await observe(c);assert.equal(plan.eligible,true,JSON.stringify(plan.blockers));
 await fs.appendFile(c.session.workingPath,'later change');const before=await inventory(c.dir);
 await assert.rejects(()=>commitIsolation(plan),e=>e.code==='PLAN_STALE');
 assert.deepEqual(await inventory(c.dir),before);assert.equal(await c.store.get('isolation-ledger.json'),undefined);
});
