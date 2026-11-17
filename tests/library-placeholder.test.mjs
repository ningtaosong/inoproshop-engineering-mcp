import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setup,connect,app} from './helpers.mjs';

const managerId='40000000-0000-4000-8000-000000000001';
const referenceId='native-placeholder-1';
function manager(){
 const path=['设备','应用一','库管理器'];
 return {applicationId:app,managerId,path,nativeTypeId:'adb5cb65-8e1d-4a00-b70a-375ea27582f3',unavailableFields:[],references:[
  {index:0,parentIndex:null,managerId,managerPath:path,order:0,path:[...path,'references','0'],
   rawFields:{id:referenceId,name:'#S5bDemo',namespace:'FMATH',is_placeholder:true,is_managed:false,
    system_library:false,optional:false,qualified_only:false,placeholder_name:'S5bDemo',
    default_resolution:'Fixture Mathematics, 1.0.0 (Fixture Vendor)',effective_resolution:'None',
    resolution_info:'None',resolver_guid:'fixture-resolver',is_redirected:false,explicit_redirection:null},
   unavailableFields:[],resolutionStatus:'effective-resolution-reported',resolutionBasis:'Native effective_resolution string only',installedStatus:'not-queried'}]};
}
async function context(t,copy=false,extra={}){
 const e=await setup({libraryManagers:[manager()],...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call(copy?'project_open_copy':'project_open',copy?
  {requestId:randomUUID(),sourcePath:e.source,applicationId:app}:
  {requestId:randomUUID(),projectPath:e.source,applicationId:app}));
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));
 const s=opened.data.session,scope={projectId:s.projectId,applicationId:app};
 const catalog=await c.done(await c.call('library_catalog',{}));
 const refs=await c.done(await c.call('library_inspect',scope));
 assert.equal(catalog.status,'succeeded');assert.equal(refs.status,'succeeded',JSON.stringify(refs));
 const args={requestId:randomUUID(),...scope,managerId,placeholderReferenceId:referenceId,
  expectedDiskHash:s.diskHash,expectedReferenceVersion:refs.data.configurationVersion,
  expectedPlaceholderVersion:refs.data.placeholderConfigurationVersion,expectedExplicitRedirection:null,
  referenceOperationId:refs.operationId,installedIdentity:catalog.data.entries[0].identity,
  expectedCatalogVersion:catalog.data.catalogVersion,catalogOperationId:catalog.operationId};
 return {e,c,s,scope,catalog,refs,args,opened};
}
for(const copy of [false,true])test(`原生占位符显式覆盖、持久化、去重及 no-op ${copy?'copy':'direct'}`,async t=>{
 const x=await context(t,copy),before=await readFile(x.s.workingPath);
 const build=await x.c.done(await x.c.call('project_build',{requestId:randomUUID(),...x.scope}));assert.equal(build.status,'succeeded');
 const r=await x.c.done(await x.c.call('library_placeholder_resolve',x.args));
 assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.changed,true);
 assert.equal(r.data.reopened,true);assert.equal(r.data.buildApplicable,false);
 assert.notDeepEqual(await readFile(x.s.workingPath),before);
 assert.equal(r.data.targetAfter.rawFields.explicit_redirection,r.data.installed.displayName);
 // Integrating the direct-open dialog fix must not authorize confirmations in
 // subsequent native library reads/writes or the historical copy workflow.
 const request=async result=>JSON.parse(await readFile(path.join(x.e.dataDir,'ipc',result.operationId,'request.json'),'utf8'));
 assert.equal((await request(x.opened)).promptPolicy,copy?undefined:'library-info-initial-open-v1');
 assert.equal((await request(x.refs)).promptPolicy,undefined);
 assert.equal((await request(r)).command,'resolve_placeholder');
 assert.equal((await request(r)).promptPolicy,undefined);
 assert.deepEqual(await x.c.call('library_placeholder_resolve',x.args),r);
 const state=(await x.c.call('session_status')).data.session;
 const ref=await x.c.done(await x.c.call('library_inspect',x.scope));
  assert.equal(ref.status,'succeeded',JSON.stringify(ref));
 const noOp=await x.c.done(await x.c.call('library_placeholder_resolve',{...x.args,requestId:randomUUID(),
  expectedDiskHash:state.diskHash,expectedReferenceVersion:ref.data.configurationVersion,
  expectedPlaceholderVersion:ref.data.placeholderConfigurationVersion,
  expectedExplicitRedirection:r.data.installed.displayName,referenceOperationId:ref.operationId}));
 assert.equal(noOp.status,'succeeded',JSON.stringify(noOp));assert.equal(noOp.data.changed,false);
});
test('过期版本与错误身份在写前拒绝，文件不变',async t=>{
 const x=await context(t),before=await readFile(x.s.workingPath);
 for(const patch of [{expectedPlaceholderVersion:'0'.repeat(64)},{installedIdentity:'0'.repeat(64)},
  {placeholderReferenceId:'other'}]){
  const r=await x.c.done(await x.c.call('library_placeholder_resolve',{...x.args,...patch,requestId:randomUUID()}));
  assert.equal(r.status,'conflict',JSON.stringify(r));assert.deepEqual(await readFile(x.s.workingPath),before);
 }
});
test('显式覆盖虽等于目标库，但有效解析矛盾时拒绝 no-op',async t=>{
 const m=manager(),display='Fixture Mathematics, 1.0.0 (Fixture Vendor)';
 Object.assign(m.references[0].rawFields,{explicit_redirection:display,is_redirected:true,
  effective_resolution:'Other Mathematics, 1.0.0 (Other Vendor)'});
 m.references[0].resolutionStatus='effective-resolution-reported';
 const x=await context(t,false,{libraryManagers:[m]}),before=await readFile(x.s.workingPath);
 const r=await x.c.done(await x.c.call('library_placeholder_resolve',{...x.args,
  expectedExplicitRedirection:display}));
 assert.equal(r.status,'conflict',JSON.stringify(r));
 assert.deepEqual(await readFile(x.s.workingPath),before);
 assert.equal((await x.c.call('session_status')).data.globalFrozen,false);
});
test('占位符显式覆盖字段缺失即使清单标记完整也不派发写入',async t=>{
 const m=manager();delete m.references[0].rawFields.explicit_redirection;
 const x=await context(t,false,{libraryManagers:[m]}),before=await readFile(x.s.workingPath);
 const r=await x.c.done(await x.c.call('library_placeholder_resolve',x.args));
 assert.equal(r.status,'conflict',JSON.stringify(r));
 assert.deepEqual(await readFile(x.s.workingPath),before);
 assert.equal((await x.c.call('session_status')).data.globalFrozen,false);
});
for(const copy of [false,true])for(const fault of ['reopen-enumeration','reopen-field','reopen-truncated','reopen-missing'])
test(`重开证据不完整冻结 ${copy?'copy':'direct'} ${fault}`,async t=>{
 const x=await context(t,copy,{placeholderEvidenceFault:fault}),before=await readFile(x.s.workingPath);
 const r=await x.c.done(await x.c.call('library_placeholder_resolve',x.args));
 assert.equal(r.status,'unknown',JSON.stringify(r));assert.notDeepEqual(await readFile(x.s.workingPath),before);
 assert.equal((await x.c.call('session_status')).data.globalFrozen,true);
 assert.equal((await x.c.call('operation_status',{operationId:r.operationId})).status,'unknown');
 assert.equal((await x.c.call('project_build',{requestId:randomUUID(),...x.scope})).status,'unknown');
});
test('部分设置不自动恢复，原操作保持 unknown',async t=>{
 const x=await context(t,false,{failPlaceholderResolve:true});
 const r=await x.c.done(await x.c.call('library_placeholder_resolve',x.args));
 assert.equal(r.status,'unknown',JSON.stringify(r));assert.equal((await x.c.call('session_status')).data.globalFrozen,true);
 assert.equal((await x.c.call('operation_status',{operationId:r.operationId})).status,'unknown');
});
