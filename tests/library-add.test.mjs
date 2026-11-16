import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {setup,connect,app,obj} from './helpers.mjs';
import {digest} from '../dist/storage.js';
const managerId='40000000-0000-4000-8000-000000000001';
const manager=()=>({applicationId:app,managerId,path:['设备','应用一','库管理器'],nativeTypeId:'adb5cb65-8e1d-4a00-b70a-375ea27582f3',unavailableFields:[],references:[]});
async function context(t,copy=false,extra={}){
 const e=await setup({libraryManagers:[manager()],...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const open=await c.done(await c.call(copy?'project_open_copy':'project_open',copy?{sourcePath:e.source,applicationId:app,requestId:randomUUID()}:{projectPath:e.source,applicationId:app,requestId:randomUUID()}));assert.equal(open.status,'succeeded',JSON.stringify(open));
 const s=open.data.session,scope={projectId:s.projectId,applicationId:app};
 const cat=await c.done(await c.call('library_catalog',{}));assert.equal(cat.status,'succeeded',JSON.stringify(cat));
 const refs=await c.done(await c.call('library_inspect',{...scope}));assert.equal(refs.status,'succeeded',JSON.stringify(refs));
 const row=cat.data.entries[0],args={requestId:randomUUID(),...scope,managerId,expectedDiskHash:s.diskHash,expectedReferenceVersion:refs.data.configurationVersion,referenceOperationId:refs.operationId,
  installedIdentity:row.identity,expectedCatalogVersion:cat.data.catalogVersion,catalogOperationId:cat.operationId,expectedNamespace:row.defaultNamespace};
 return {e,c,s,cat,refs,row,args,scope};
}
test('本机目录不需要工程身份；分页、版本和精确身份有明确证据',async t=>{
 const {c,cat,row}=await context(t);assert.equal(cat.data.total,1);assert.equal(cat.data.entries.length,1);
 assert.equal(cat.data.entries[0].identity,digest(JSON.stringify([row.displayName,row.company,row.title,row.version,row.defaultNamespace,row.repositoryFile])));
 const detail=await c.done(await c.call('library_catalog',{detailIdentity:row.identity,expectedVersion:cat.data.catalogVersion}));assert.equal(detail.status,'succeeded');assert.equal(detail.data.entries.length,1);
 const filtered=await c.done(await c.call('library_catalog',{query:'mathematics',expectedVersion:cat.data.catalogVersion}));assert.equal(filtered.status,'succeeded');assert.equal(filtered.data.page.total,1);
 const empty=await c.done(await c.call('library_catalog',{query:'not-installed',expectedVersion:cat.data.catalogVersion}));assert.equal(empty.status,'succeeded');assert.equal(empty.data.page.total,0);
 const bad=await c.done(await c.call('library_catalog',{expectedVersion:'0'.repeat(64)}));assert.equal(bad.status,'conflict');assert.equal(bad.error.code,'INSTALLED_CATALOG_CHANGED');
});
for(const copy of [false,true])test(`精确直接库引用、保存读回、去重和旧编译失效 ${copy?'copy':'direct'}`,async t=>{
 const x=await context(t,copy),before=await readFile(x.s.workingPath),build=await x.c.done(await x.c.call('project_build',{requestId:randomUUID(),...x.scope}));assert.equal(build.status,'succeeded');
 const add=await x.c.done(await x.c.call('library_reference_add',x.args));assert.equal(add.status,'succeeded',JSON.stringify(add));assert.equal(add.data.changed,true);assert.equal(add.data.reopened,true);assert.equal(add.data.buildApplicable,false);
 assert.equal(add.data.after.references.length,1);assert.equal(add.data.addedReference.rawFields.name,x.row.displayName);
 assert.notDeepEqual(await readFile(x.s.workingPath),before);
 const duplicate=await x.c.done(await x.c.call('library_reference_add',x.args));assert.deepEqual(duplicate,add);assert.equal((await x.c.call('session_status')).data.session.buildApplicable,false);
});
test('旧版本和错误库身份在写入前拒绝；后续有效请求仍可执行',async t=>{
 const x=await context(t),before=await readFile(x.s.workingPath);
 const stale=await x.c.done(await x.c.call('library_reference_add',{...x.args,requestId:randomUUID(),expectedReferenceVersion:'0'.repeat(64)}));assert.equal(stale.status,'conflict');assert.deepEqual(await readFile(x.s.workingPath),before);
 const wrong=await x.c.done(await x.c.call('library_reference_add',{...x.args,requestId:randomUUID(),installedIdentity:'0'.repeat(64)}));assert.equal(wrong.status,'conflict');assert.deepEqual(await readFile(x.s.workingPath),before);
 const good=await x.c.done(await x.c.call('library_reference_add',x.args));assert.equal(good.status,'succeeded',JSON.stringify(good));
});
test('直接引用查询证据绑定当时的工程磁盘版本',async t=>{
 const x=await context(t),read=await x.c.done(await x.c.call('object_read',{...x.scope,objectId:obj}));assert.equal(read.status,'succeeded');
 const edit=await x.c.done(await x.c.call('code_apply_change',{requestId:randomUUID(),...x.scope,objectId:obj,expectedHash:read.data.contentHash,
   declaration:read.data.declaration,implementation:read.data.implementation+'\n// changed after library inspection'}));assert.equal(edit.status,'succeeded');
 const latest=(await x.c.call('session_status')).data.session,before=await readFile(x.s.workingPath);
 const stale=await x.c.done(await x.c.call('library_reference_add',{...x.args,requestId:randomUUID(),expectedDiskHash:latest.diskHash}));
 assert.equal(stale.status,'conflict');assert.equal(stale.error.code,'LIBRARY_REFERENCE_EVIDENCE');assert.deepEqual(await readFile(x.s.workingPath),before);
});
test('已存在精确直接引用返回可核对 no-op，不再次保存',async t=>{
 const x=await context(t),add=await x.c.done(await x.c.call('library_reference_add',x.args));assert.equal(add.status,'succeeded');
 const s=(await x.c.call('session_status')).data.session;
 const refs=await x.c.done(await x.c.call('library_inspect',x.scope));assert.equal(refs.status,'succeeded');
 const before=await readFile(x.s.workingPath);
 const again=await x.c.done(await x.c.call('library_reference_add',{...x.args,requestId:randomUUID(),expectedDiskHash:s.diskHash,
   expectedReferenceVersion:refs.data.configurationVersion,referenceOperationId:refs.operationId}));
 assert.equal(again.status,'succeeded',JSON.stringify(again));assert.equal(again.data.changed,false);assert.equal(again.data.noOp,true);assert.equal(again.data.reopened,false);
 assert.deepEqual(await readFile(x.s.workingPath),before);
});
test('部分添加结果未知时不自动移除；冻结后续写入',async t=>{
 const x=await context(t,false,{failLibraryAdd:true}),r=await x.c.done(await x.c.call('library_reference_add',x.args));assert.equal(r.status,'unknown',JSON.stringify(r));
 const status=await x.c.call('session_status');assert.equal(status.data.globalFrozen,true);
 const follow=await x.c.call('project_build',{requestId:randomUUID(),...x.scope});assert.equal(follow.status,'unknown');
 const same=await x.c.call('operation_status',{operationId:r.operationId});assert.equal(same.status,'unknown');
});
for(const copy of [false,true])for(const fault of ['reopen-enumeration','reopen-truncated','reopen-field','reopen-missing-field','reopen-contradiction','reopen-missing-coverage'])
test(`保存重开后证据不完整，服务独立冻结 ${copy?'copy':'direct'} ${fault}`,async t=>{
 const x=await context(t,copy,{libraryAddEvidenceFault:fault}),before=await readFile(x.s.workingPath);
 const result=await x.c.done(await x.c.call('library_reference_add',x.args));
 assert.equal(result.status,'unknown',JSON.stringify(result));
 assert.notDeepEqual(await readFile(x.s.workingPath),before);
 const status=await x.c.call('session_status');assert.equal(status.data.globalFrozen,true);
 const same=await x.c.call('operation_status',{operationId:result.operationId});assert.equal(same.status,'unknown');
 const retry=await x.c.call('library_reference_add',x.args);assert.equal(retry.operationId,result.operationId);
 const follow=await x.c.call('project_build',{requestId:randomUUID(),...x.scope});assert.equal(follow.status,'unknown');
});
test('写前库清单不完整时拒绝派发，文件不变',async t=>{
 const m=manager();m.enumerationError='Injected native enumeration failure';
 const x=await context(t,false,{libraryManagers:[m]}),before=await readFile(x.s.workingPath);
 assert.equal(x.refs.data.scope.enumerationComplete,false);
 const rejected=await x.c.done(await x.c.call('library_reference_add',x.args));
 assert.equal(rejected.status,'conflict');assert.equal(rejected.error.code,'LIBRARY_REFERENCE_EVIDENCE');
 assert.deepEqual(await readFile(x.s.workingPath),before);
});
test('正常分页仍可提供完整原生采集的写前证据',async t=>{
 const m=manager();
 for(let i=0;i<2;i++)m.references.push({index:i,parentIndex:null,managerId,managerPath:m.path,order:i,path:[...m.path,'references',String(i)],
   rawFields:{id:String(i+1),name:`Existing Library ${i}`,namespace:`OLD${i}`,is_placeholder:false,is_managed:true,
     system_library:false,optional:false,qualified_only:false},unavailableFields:[],resolutionStatus:'unknown',
   resolutionBasis:'Native effective_resolution string only',installedStatus:'not-queried'});
 const x=await context(t,false,{libraryManagers:[m]});
 const page=await x.c.done(await x.c.call('library_inspect',{...x.scope,limit:1}));
 assert.equal(page.status,'succeeded');assert.equal(page.data.page.hasMore,true);
 assert.equal(page.data.scope.enumerationComplete,true);
 const add=await x.c.done(await x.c.call('library_reference_add',{...x.args,requestId:randomUUID(),
   expectedReferenceVersion:page.data.configurationVersion,referenceOperationId:page.operationId}));
 assert.equal(add.status,'succeeded',JSON.stringify(add));assert.equal(add.data.after.references.length,3);
});
test('生产桥接：直接与旧副本的部分添加均不反向写入或恢复保存（原生接口替身）',()=>{
 const r=spawnSync('python',['tests/bridge_library_add_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
