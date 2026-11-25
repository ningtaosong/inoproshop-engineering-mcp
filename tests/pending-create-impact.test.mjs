// Synthetic copies of the original creation protocol; never changes historical evidence.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,atomicJson,canonical,digest} from '../dist/storage.js';
import {publishProcessEvidence} from '../dist/process-exit.js';
import {fileIdentity} from '../dist/isolation.js';
import {assessPending,related,targetFiles} from '../dist/pending-impact.js';

const stages=['native-create','initialize-cycle20ms','initialize-installed-placeholder','verify-native-preset','save-native-initialization','close-native-initialization','publish-exclusive','guard-published-target','reopen-specified-path','verify-reopened-preset','close-specified-path'];
const identity=pid=>({version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid,startId:'12345'});
async function fixture(){
 const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'inopro-create-impact-')),store=new Store(path.join(dir,'ledger'));
 const id=randomUUID(),requestId=randomUUID(),target=path.join(dir,'engineering','new.project'),ipc=store.file('ipc/'+id),staging=path.join(ipc,'native-initialization'),scratch=path.join(staging,path.basename(target));
 await fs.mkdir(staging,{recursive:true});await fs.mkdir(path.dirname(target));await fs.writeFile(target,'synthetic native artifact');await fs.copyFile(target,scratch);await fs.writeFile(path.join(staging,'new-AllUsers.opt'),'sidecar');await fs.copyFile(target,target+'backup');
 const args={requestId,projectPath:target},op={schemaVersion:1,registryVersion:1,operationId:id,requestId,tool:'project_create',args,fingerprint:digest(canonical({tool:'project_create',args})),status:'unknown',ownerPid:2000000001,ownerIdentity:identity(2000000001),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),activation:{previousActiveProjectId:null,revision:0},creation:{projectId:randomUUID(),sessionId:randomUUID(),projectPath:target,preset:'am610-minimal-v1'},bridge:{directory:ipc,pid:2000000002,launchId:randomUUID()},response:{contractVersion:'1.0.0',operationId:id,requestId,status:'unknown',summary:'original timeout',error:{code:'IDE_TIMEOUT',message:'original timeout'}}};
 const req={operationId:id,requestId,requestFingerprint:op.fingerprint,launchId:op.bridge.launchId,exitEvidenceVersion:1,command:'new_project',projectPath:target,args:{preset:op.creation.preset},resultPath:path.join(ipc,'result.json')};
 const start={binding:{operationId:id,requestId,requestFingerprint:op.fingerprint,launchId:req.launchId,requestHash:digest(canonical(req))},pid:op.bridge.pid,process:{state:'running',identity:identity(op.bridge.pid)},observedAt:new Date().toISOString()};
 const e={preset:op.creation.preset,initializationArtifact:scratch,publishedExclusively:true,reopened:true,noBusinessCopy:true,savedDiskHash:digest(await fs.readFile(target)),stages:stages.map(phase=>({phase,status:'succeeded'}))};
 const result={contractVersion:'1.0.0',operationId:id,status:'succeeded',summary:'native result only',data:{projectPath:target,diskHash:e.savedDiskHash,creationEvidence:e,lifecycle:{ownedHandleRemaining:false,closeUnconfirmed:false,saveAttempts:1,saveMayHaveOccurred:true}}};
 const factory={name:path.basename(target),location:staging,device:{type:4102,id:'10f4 0002',version:'3.5.11.11'},wizardSha256:'7b1fbbf5316171a8ad883614000085b901016ee8abac60efd8524404339fd6ac',factoryGuid:'cc393387-a21c-4f68-a3e3-84c36951965d',factoryType:'Inovance.InoPro.InoSTObject.STImplementationObjectFactory'};
 await store.put('registry.json',{version:2,revision:0,activeProjectId:null,projects:[]});
 const write=async()=>{await store.saveOp(op);await atomicJson(req.resultPath,result);await atomicJson(path.join(ipc,'request.json'),req);await atomicJson(path.join(ipc,'creation-evidence.json'),e);await atomicJson(path.join(ipc,'native-factory.json'),factory);await atomicJson(path.join(ipc,'dispatched.json'),{operationId:id,pid:op.bridge.pid});start.binding.requestHash=digest(canonical(req));await publishProcessEvidence(path.join(ipc,'process-start.json'),start);};
 for(let i=0;i<stages.length;i++){const n=String(i+1).padStart(2,'0');await atomicJson(path.join(ipc,'creation-stage-'+n+'-start.json'),{phase:stages[i],status:'started'});await atomicJson(path.join(ipc,'creation-stage-'+n+'-end.json'),e.stages[i]);}
 await write();return {dir,store,op,req,start,e,result,factory,ipc,staging,target,scratch,write,probe:async()=>({state:'exited'})};
}
test('complete ended native creation is scoped without rewriting unknown or registration',async()=>{
 const c=await fixture(),before=await fs.readFile(c.store.file('operations/'+c.op.operationId+'.json'));
 const r=await assessPending(c.store,{probe:c.probe});assert.equal(r.globalFrozen,false,JSON.stringify(r.impacts));
 assert.equal(r.impacts[0].scope,'project');assert.equal(r.impacts[0].projectId,c.op.creation.projectId);
 assert.deepEqual(await fs.readFile(c.store.file('operations/'+c.op.operationId+'.json')),before);
 assert.deepEqual((await c.store.registry()).projects,[]);
 for(const p of [c.target,c.scratch,c.target+'backup',path.join(c.staging,'new-AllUsers.opt')])assert.equal(related(r.impacts,undefined,await targetFiles([p])).length,1);
 const other=path.join(c.dir,'unrelated.project');await fs.writeFile(other,'other');assert.equal(related(r.impacts,undefined,await targetFiles([other])).length,0);
});

for(const target of ['target','scratch'])for(const type of ['hardlink','symlink'])test('created '+target+' remains blocked through current '+type,async()=>{
 const c=await fixture(),alias=path.join(c.dir,'alias.project');
 if(type==='hardlink')await fs.link(c[target],alias);else await fs.symlink(c[target],alias,'file');
 const r=await assessPending(c.store,{probe:c.probe});assert.equal(r.globalFrozen,false);
 assert.equal(related(r.impacts,undefined,await targetFiles([alias])).length,1);
});
for(const who of ['owner','native'])for(const state of ['active','unconfirmed','reused'])test(who+' process '+state,async()=>{
 const c=await fixture(),pid=who==='owner'?c.op.ownerPid:c.op.bridge.pid;
 const probe=async n=>n!==pid?{state:'exited'}:state==='unconfirmed'?{state:'unconfirmed',reason:'no access'}:{state:'running',identity:{...identity(pid),...(state==='reused'?{startId:'99999'}:{})}};
 assert.equal((await assessPending(c.store,{probe})).globalFrozen,state!=='reused');
});
const changes={
 'missing reservation':async c=>{delete c.op.creation;await c.store.saveOp(c.op);},
 'wrong reserved path':async c=>{c.op.creation.projectPath=c.scratch;await c.store.saveOp(c.op);},
 'wrong preset':async c=>{c.req.args.preset='another';await c.write();},
 'wrong original fingerprint':async c=>{c.op.fingerprint='f'.repeat(64);await c.write();},
 'missing owner identity':async c=>{delete c.op.ownerIdentity;await c.store.saveOp(c.op);},
 'missing native identity':async c=>{delete c.start.process.identity;await c.write();},
 'native command changed':async c=>{c.req.command='inspect';await c.write();},
 'publication missing':async c=>fs.unlink(path.join(c.ipc,'creation-evidence.json')),
 'publication contradictory':async c=>{c.result.data.creationEvidence={...c.e,savedDiskHash:'f'.repeat(64)};await c.write();},
 'target missing':async c=>fs.unlink(c.target),
 'scratch missing':async c=>fs.unlink(c.scratch),
 'target bytes replaced':async c=>fs.writeFile(c.target,'changed'),
 'scratch bytes replaced':async c=>fs.writeFile(c.scratch,'changed'),
 'known target identity replaced same bytes':async c=>{c.op.dispatchFiles=[await fileIdentity(c.target)];await c.store.saveOp(c.op);await fs.rename(c.target,c.target+'.old');await fs.copyFile(c.scratch,c.target);},
 'known identity malformed':async c=>{c.op.dispatchFiles=[{path:c.target,fileId:null}];await c.store.saveOp(c.op);},
 'stage missing':async c=>fs.unlink(path.join(c.ipc,'creation-stage-07-end.json')),
 'stage failed':async c=>atomicJson(path.join(c.ipc,'creation-stage-07-end.json'),{phase:'publish-exclusive',status:'failed'}),
 'factory path inconsistent':async c=>{c.factory.location=path.dirname(c.target);await c.write();},
 'result identity inconsistent':async c=>{c.result.operationId=randomUUID();await c.write();},
 'close incomplete':async c=>{c.result.data.lifecycle.closeUnconfirmed=true;await c.write();},
 'publication null':async c=>{c.e.publishedExclusively=null;await c.write();},
 'multiple launches':async c=>{await fs.mkdir(path.join(c.ipc,'second'));await atomicJson(path.join(c.ipc,'second','request.json'),{...c.req,launchId:randomUUID()});},
 'registered elsewhere':async c=>c.store.put('registry.json',{version:2,revision:1,activeProjectId:null,projects:[{...c.op.creation,sourcePath:c.target,workingPath:c.target,sourceHash:c.e.savedDiskHash,storageMode:'direct',editMode:'direct',directPath:c.target}]}),
 'staging directory alias':async c=>{const moved=c.staging+'-moved';await fs.rename(c.staging,moved);await fs.symlink(moved,c.staging,'junction');}
};
for(const [name,change] of Object.entries(changes))test('creation chain rejects '+name,async()=>{
 const c=await fixture();await change(c);const r=await assessPending(c.store,{probe:c.probe});assert.equal(r.globalFrozen,true,name);assert.equal((await c.store.operation(c.op.operationId)).status,'unknown');
});
test('already recorded consistent target identity is accepted',async()=>{const c=await fixture();c.op.dispatchFiles=[await fileIdentity(c.target)];await c.store.saveOp(c.op);assert.equal((await assessPending(c.store,{probe:c.probe})).globalFrozen,false);});
test('a late evidence change is not cached as permission',async()=>{
 const c=await fixture(),original=fs.readFile;let reads=0;
 fs.readFile=async function(p,...args){const data=await original.call(this,p,...args);if(p===path.join(c.ipc,'creation-evidence.json')&&++reads===1)await fs.writeFile(p,'{}');return data;};
 try{assert.equal((await assessPending(c.store,{probe:c.probe})).globalFrozen,true);}finally{fs.readFile=original;}
});
test('same-byte replacement during assessment is rejected by current identity reread',async()=>{
 const c=await fixture(),original=fs.readFile;let reads=0;
 fs.readFile=async function(p,...args){const data=await original.call(this,p,...args);if(p===c.target&&++reads===1){await fs.rename(p,p+'.old');await fs.copyFile(c.scratch,p);}return data;};
 try{assert.equal((await assessPending(c.store,{probe:c.probe})).globalFrozen,true);}finally{fs.readFile=original;}
});
