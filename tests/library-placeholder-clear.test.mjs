import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setup,connect,app,obj} from './helpers.mjs';
import {CLEAR_DEFAULT,CLEAR_OVERRIDE,clearTarget,clearStateDifference,validateClearResult,clearResolution} from '../dist/library-placeholder-clear.js';
import {libraryConfigurationVersion,placeholderConfigurationVersion} from '../dist/libraries.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas,outputSchemas,VERSION} from '../dist/contracts.js';
import {z} from 'zod';
import {digest} from '../dist/storage.js';

const managerId='40000000-0000-4000-8000-000000000001',referenceId='3880672626';
const prefix=['Device','Plc Logic','Application'];
const scope={ideVersion:'1.9.1.6',deviceObjectId:'50000000-0000-4000-8000-000000000001',devicePath:['Device'],
  controller:{type:4102,id:'10f4 0002',version:'3.5.11.11'},applicationId:app,applicationPath:prefix,managerId};
function fixture(){
 const managerPath=[...prefix,'Library Manager'];
 const row={index:0,parentIndex:null,managerId,managerPath,order:0,path:[...managerPath,'references','0'],
  rawFields:{id:referenceId,name:'#CAA Mathematics',namespace:'MATH',is_placeholder:true,is_managed:false,system_library:false,
   optional:false,qualified_only:false,placeholder_name:'CAA Mathematics',default_resolution:CLEAR_DEFAULT,
   effective_resolution:CLEAR_OVERRIDE,resolution_info:'占位符重定向解析',resolver_guid:'b303f5ce-75ff-4668-a777-7da8debb449c',is_redirected:true,explicit_redirection:CLEAR_OVERRIDE},
  unavailableFields:[],resolutionStatus:'effective-resolution-reported',resolutionBasis:'Native effective_resolution string only',installedStatus:'not-queried'};
 const tasks=[1,2].map(i=>({applicationId:app,taskId:`60000000-0000-4000-8000-00000000000${i}`,path:[...prefix,'Task Configuration','Task'+i],
  rawFields:{kind_of_task:'Cyclic',interval:'t#20ms',priority:'1',interval_unit:'ms',core_binding:'-2',event:'',external_event:'',parent_synchron_task:'',event_pou_guid:app},
  watchdog:{enabled:'False',time:'',time_unit:'ms',sensitivity:'1'},unavailableFields:[],callsComplete:true,rawCalls:[['Main','中文'],['Main','None'],['Main','']]}));
 return {applications:[{applicationId:app,path:prefix}],objects:[{objectId:obj,applicationId:app,path:[...prefix,'Main'],nativeTypeId:'6f9dac99-8de1-4efc-8465-68ac443b7d08',
  pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header',declaration:'PROGRAM Main\nVAR\nEND_VAR',implementation:'// 保留',embeddedObjectTypes:['3b83b776-fb25-43b8-99f2-3c507c9143fc']}],
  tasks,placeholderClearScope:scope,libraryManagers:[{applicationId:app,managerId,path:managerPath,nativeTypeId:'adb5cb65-8e1d-4a00-b70a-375ea27582f3',unavailableFields:[],references:[row]}]};
}
async function context(t,copy=false,extra={}){
 const e=await setup({...fixture(),...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call(copy?'project_open_copy':'project_open',{requestId:randomUUID(),[copy?'sourcePath':'projectPath']:e.source,applicationId:app}));
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));const s=opened.data.session;
 let refs=await c.done(await c.call('library_inspect',{projectId:s.projectId,applicationId:app}));assert.equal(refs.status,'succeeded',JSON.stringify(refs));
 while(!refs.data.references.some(r=>r.rawFields.id===referenceId)&&refs.data.page.hasMore){
   refs=await c.done(await c.call('library_inspect',{projectId:s.projectId,applicationId:app,offset:refs.data.page.nextOffset,expectedVersion:refs.data.version}));
   assert.equal(refs.status,'succeeded',JSON.stringify(refs));
 }
 const args={requestId:randomUUID(),projectId:s.projectId,applicationId:app,managerId,placeholderReferenceId:referenceId,
  expectedDiskHash:s.diskHash,expectedReferenceVersion:refs.data.configurationVersion,expectedPlaceholderVersion:refs.data.placeholderConfigurationVersion,
  expectedExplicitRedirection:CLEAR_OVERRIDE,referenceOperationId:refs.operationId};
 return {e,c,s,refs,args};
}
const counts=async(x,r)=>JSON.parse(await readFile(path.join(x.e.dataDir,'ipc',r.operationId,'placeholder-clear-counts.json'),'utf8'));
for(const copy of [false,true])test(`clear successful persistence and same-request dedup ${copy?'copy':'direct'}`,async t=>{
 const x=await context(t,copy),r=await x.c.done(await x.c.call('library_placeholder_clear',x.args));
 assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.cleared,true);assert.equal(r.data.buildApplicable,false);
 assert.equal(r.data.resolution.effectiveResolution,CLEAR_DEFAULT);assert.equal(r.data.resolution.loadedStatus,'not-independently-verified');
 assert.equal(r.data.targetAfter.rawFields.explicit_redirection,null);assert.equal(r.data.targetAfter.rawFields.is_redirected,false);
 assert.deepEqual(await counts(x,r),{clear:1,save:1});assert.deepEqual(await x.c.call('library_placeholder_clear',x.args),r);
 const dirs=await readdir(path.join(x.e.dataDir,'ipc',r.operationId,'placeholder-clear-service'));assert.equal(dirs.length,1);
 const v=JSON.parse(await readFile(path.join(x.e.dataDir,'ipc',r.operationId,'placeholder-clear-service',dirs[0],'verification.json'),'utf8'));assert.equal(v.status,'succeeded');
 const before=await readFile(x.s.workingPath),refs=await x.c.done(await x.c.call('library_inspect',{projectId:x.s.projectId,applicationId:app}));
 const absent=await x.c.done(await x.c.call('library_placeholder_clear',{...x.args,requestId:randomUUID(),expectedDiskHash:refs.data.diskHash,
  expectedReferenceVersion:refs.data.configurationVersion,expectedPlaceholderVersion:refs.data.placeholderConfigurationVersion,referenceOperationId:refs.operationId}));
 assert.equal(absent.status,'conflict');assert.deepEqual(await readFile(x.s.workingPath),before);
});
for(const value of [null,'','None','Unpredicted native resolution'])test(`explicit clear and actual resolution distinct ${JSON.stringify(value)}`,async t=>{
 const x=await context(t,false,{clearEffective:value,clearInfo:null}),r=await x.c.done(await x.c.call('library_placeholder_clear',x.args));
 assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.resolution.effectiveResolution,value);assert.equal(r.data.resolution.resolutionInfo,null);
 assert.equal(r.data.resolution.status,value==='Unpredicted native resolution'?'native-resolution-reported':'native-unresolved');assert.equal(r.data.buildApplicable,false);
});
for(const name of ['wrong-id','page-version','wrong-op','wrong-explicit','disk','missing','system','managed','duplicate','name','default'])
test('prewrite rejects with unchanged bytes and zero dispatch: '+name,async t=>{
 const f=fixture(),r=f.libraryManagers[0].references[0];
 if(name==='missing'){delete r.rawFields.effective_resolution;r.resolutionStatus='unknown';}
 if(name==='system')r.rawFields.system_library=true;
 if(name==='managed')r.rawFields.is_managed=true;
 if(name==='name')r.rawFields.placeholder_name='Other';
 if(name==='default')r.rawFields.default_resolution='Other';
 if(name==='duplicate')f.libraryManagers[0].references.push({...structuredClone(r),order:1,path:[...r.managerPath,'references','1']});
 const x=await context(t,false,f),args={...x.args};
 if(name==='wrong-id')args.placeholderReferenceId='other';
 if(name==='page-version')args.expectedReferenceVersion=x.refs.data.version;
 if(name==='wrong-op')args.referenceOperationId=randomUUID();
 if(name==='wrong-explicit')args.expectedExplicitRedirection='other';
 if(name==='disk')await writeFile(x.s.workingPath,(await readFile(x.s.workingPath,'utf8'))+' ');
 const before=await readFile(x.s.workingPath),out=await x.c.done(await x.c.call('library_placeholder_clear',args));
 assert.equal(out.status,'conflict',JSON.stringify(out));assert.deepEqual(await readFile(x.s.workingPath),before);
 assert.ok(!(await readdir(path.join(x.e.dataDir,'ipc'))).includes(out.operationId));
});
for(const copy of [false,true])for(const fault of ['setter','missing','extra','identity','source','task','coverage','publication','save','reopen'])
test(`partial clear freezes without recovery ${copy?'copy':'direct'} ${fault}`,async t=>{
 const x=await context(t,copy,{placeholderClearFault:fault}),before=await readFile(x.s.workingPath);
 const r=await x.c.done(await x.c.call('library_placeholder_clear',x.args));assert.equal(r.status,'unknown',JSON.stringify(r));
 assert.ok(r.operationId,JSON.stringify(r));
 assert.deepEqual(await counts(x,r),{clear:1,save:fault==='reopen'?1:0});
 if(fault!=='reopen')assert.deepEqual(await readFile(x.s.workingPath),before);
 assert.equal((await x.c.call('session_status')).data.globalFrozen,true);assert.deepEqual(await x.c.call('library_placeholder_clear',x.args),r);
 assert.equal((await x.c.call('project_build',{requestId:randomUUID(),projectId:x.s.projectId,applicationId:app})).status,'unknown');
});
test('independent service validator rejects raw differences and allows only task/PROGRAM enumeration',async t=>{
 const x=await context(t),r=await x.c.done(await x.c.call('library_placeholder_clear',x.args));assert.equal(r.status,'succeeded',JSON.stringify(r));
 const d=JSON.parse(await readFile(r.data.evidence.operationRecord,'utf8')).value.response.data,a=x.args,checkpoint=path.join(x.e.dataDir,'ipc',r.operationId,'checkpoint.project');
 assert.doesNotThrow(()=>validateClearResult(d,a,x.s,checkpoint));
 const switched=structuredClone(d);for(const s of [switched.immediate,switched.after]){s.tasks[app].tasks.reverse();s.tasks[app].programs.reverse();}
 assert.doesNotThrow(()=>validateClearResult(switched,a,x.s,checkpoint));
 for(const mutate of [v=>delete v.after.library.references[0].rawFields.effective_resolution,v=>v.after.library.references[0].rawFields.extra=1,
  v=>v.after.library.references[0].rawFields.namespace='BAD',v=>v.after.sources[0].implementation='changed',
  v=>v.after.sources[0].embeddedObjectTypes=[],v=>v.after.tasks[app].tasks[0].rawCalls.reverse(),
  v=>v.after.tasks[app].tasks[0].watchdog.enabled='True',v=>v.after.tasks[app].tasks.push(structuredClone(v.after.tasks[app].tasks[0])),
  v=>v.workerDiskHash='0'.repeat(64),v=>delete v.postExitDiskHashObserved,v=>v.after.nativeScope.controller.version='other',
  v=>v.after.library.scope.fieldReadComplete=false,v=>v.after.library.references[0].rawFields.effective_resolution=0]){
   const bad=structuredClone(d);mutate(bad);assert.throws(()=>validateClearResult(bad,a,x.s,checkpoint));
 }
});

test('production service rejects wrong clear envelope operationId, freezes and does not replay',async t=>{
 const e=await setup(fixture()),base=new FixtureAdapter();let clears=0;
 const adapter={reconcile:d=>base.reconcile(d),execute:async(...args)=>{
   const r=await base.execute(...args);if(args[0].command==='clear_placeholder'){clears++;r.operationId=randomUUID();}return r;
 }};
 const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},adapter);
 t.after(()=>service.store.release());
 const call=async(n,a)=>{let r=await service.call(n,schemas[n].parse(a));while(r.status==='running')r=await service.operation({operationId:r.operationId});return r;};
 const opened=await call('project_open',{requestId:randomUUID(),projectPath:e.source,applicationId:app}),s=opened.data.session;
 const refs=await call('library_inspect',{projectId:s.projectId,applicationId:app});
 const a={requestId:randomUUID(),projectId:s.projectId,applicationId:app,managerId,placeholderReferenceId:referenceId,
  expectedDiskHash:s.diskHash,expectedReferenceVersion:refs.data.configurationVersion,expectedPlaceholderVersion:refs.data.placeholderConfigurationVersion,
  expectedExplicitRedirection:CLEAR_OVERRIDE,referenceOperationId:refs.operationId};
 const r=await call('library_placeholder_clear',a);assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESULT_ID_MISMATCH');
 assert.equal((await service.status()).data.globalFrozen,true);assert.equal((await call('library_placeholder_clear',a)).operationId,r.operationId);
 await assert.rejects(()=>call('library_placeholder_clear',{...a,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');assert.equal(clears,1);
});
test('0.37.x keeps the added clear tool and original 37 contracts unchanged',async()=>{
 const prior=JSON.parse(await readFile(new URL('./fixtures/placeholder-clear-legacy-contracts.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(prior.tools).length,37);assert.equal(Object.keys(schemas).length,38);assert.equal(VERSION,'0.37.1');
 for(const [name,hashes] of Object.entries(prior.tools)){
  assert.equal(digest(JSON.stringify(z.toJSONSchema(schemas[name]))),hashes.input,name+' input');
  assert.equal(digest(JSON.stringify(z.toJSONSchema(outputSchemas[name]))),hashes.output,name+' output');
 }
 assert(!schemas.library_placeholder_clear.safeParse({}).success);
});

for(const largeSource of [false,true])test(`native 19-reference clear delivery stays bounded and full evidence retained; largeSource=${largeSource}`,async t=>{
 const archived=JSON.parse(await readFile(new URL('./fixtures/placeholder-clear-native-rows.json',import.meta.url),'utf8'));
 const f=fixture(),rows=archived.references,target=rows.find(r=>r.rawFields.placeholder_name==='CAA Mathematics');
 target.rawFields.id=referenceId;f.libraryManagers[0].references=rows;
 if(largeSource)f.objects[0].implementation='// 大量原文保持\n'.repeat(100000);
 const x=await context(t,false,f),r=await x.c.done(await x.c.call('library_placeholder_clear',x.args));
 assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.delivery.kind,'placeholder-clear-summary-v1');
 assert.equal(r.data.preservation.referenceCount,19);assert.equal(r.data.before,undefined);
 assert.equal(r.data.resolution.effectiveResolution,CLEAR_DEFAULT);assert.equal(r.data.targetAfter.rawFields.explicit_redirection,null);
 assert(Buffer.byteLength(JSON.stringify(r))<16000);
 const ledger=JSON.parse(await readFile(r.data.evidence.operationRecord,'utf8')).value.response;
 assert.equal(ledger.data.before.library.references.length,19);assert.equal(ledger.data.after.sources[0].implementation,f.objects[0].implementation);
 assert.equal(r.data.evidence.completeReplySha256,digest(JSON.stringify(ledger)));assert(Buffer.byteLength(JSON.stringify(ledger))>66000);
 assert.deepEqual(await x.c.call('operation_status',{operationId:r.operationId}),r);
 assert.deepEqual(await x.c.call('library_placeholder_clear',x.args),r);
 await x.c.client.close();const resumed=await connect(x.e.dataDir);t.after(()=>resumed.client.close());
 assert.deepEqual(await resumed.call('operation_status',{operationId:r.operationId}),r);
 assert.deepEqual(await resumed.call('library_placeholder_clear',x.args),r);
});
