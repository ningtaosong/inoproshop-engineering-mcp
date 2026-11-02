import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {setup,connect,app,app2,obj,obj2} from './helpers.mjs';
import {schemas,searchDataSchema,taskDataSchema} from '../dist/contracts.js';
import {IdeAdapter} from '../dist/adapter.js';
import {digest,atomicJson,codeHash} from '../dist/storage.js';
import {searchResult} from '../dist/queries.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

async function context(t,extra={}){
 const e=await setup(extra),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'open'}));const s=opened.data.session;
 const target={projectId:s.projectId,targetKind:'application',applicationId:app};
 const invoke=async(name,args={})=>c.done(await c.call(name,{...target,...args}));
 return {e,c,s,target,invoke};
}
test('正式搜索 stdio：中文/名称/大小写/声明实现、字面量与 UTF-16 原文位置及只读 Schema',async t=>{
 const c=await context(t);const baseline=await readFile(c.s.workingPath);
 let r=await c.invoke('project_search',{query:'main',caseSensitive:false,areas:['name']});assert.equal(r.status,'succeeded');assert.equal(r.data.matches.length,1);assert.equal(r.data.matches[0].position,null);
 assert.equal(r.data.matches[0].nameOffset,0);assert.equal(searchDataSchema.safeParse(r.data).success,true);
 assert.equal((await c.invoke('project_search',{query:'main',caseSensitive:true,areas:['name']})).data.matches.length,0);
 const read=(await c.invoke('object_read',{objectId:obj})).data;
 const body='// 😀报警与 a+b\n报警 := 1; // Main 字符串候选\nName := \'Main\';';
 await c.invoke('code_apply_change',{requestId:'prepare',objectId:obj,expectedHash:read.contentHash,declaration:read.declaration,implementation:body});
 r=await c.invoke('project_search',{query:'报警',caseSensitive:true,areas:['implementation']});assert.equal(r.data.matches.length,2);
 for(const m of r.data.matches){assert.equal(body.slice(m.position.startOffset,m.position.endOffset),m.matchedText);assert.equal(body.slice(m.context.startOffset,m.context.endOffset),m.context.text);assert.equal(m.candidateReference,true);}
 assert.equal(r.data.matches[0].position.column,6);assert.equal(r.data.matches[1].position.line,2);
 assert.equal((await c.invoke('project_search',{query:'a+b',areas:['implementation']})).data.matches.length,1);
 assert.equal((await c.invoke('project_search',{query:'PROGRAM',areas:['declaration']})).data.matches.length,1);
 r=await c.invoke('project_search',{query:'不存在'});assert.equal(r.data.noMatchConclusion,'no-match-in-covered-scope');assert.equal(r.data.scope.coverageComplete,true);
 const bytes=await readFile(c.s.workingPath);await c.invoke('project_search',{query:'Main'});assert.deepEqual(await readFile(c.s.workingPath),bytes);assert.notDeepEqual(bytes,baseline);
 const tools=(await c.c.client.listTools()).tools;for(const name of ['project_search','task_inspect']){const tool=tools.find(x=>x.name===name);assert.equal(tool.annotations.readOnlyHint,true);assert.ok(tool.inputSchema&&tool.outputSchema);}
});
test('稳定分页与截断分别记录，跨页写入、条件变化及缺少版本均拒绝',async t=>{
 const c=await context(t);const first=await c.invoke('project_search',{query:'计数',limit:1,maxResults:2});assert.equal(first.data.page.hasMore,true);
 assert.equal(first.data.page.truncated,true);assert.equal(first.data.page.totalMatches,null);assert.equal(first.data.page.matchedAtLeast,3);
 const second=await c.invoke('project_search',{query:'计数',limit:1,maxResults:2,offset:first.data.page.nextOffset,expectedVersion:first.data.version});assert.equal(second.data.version,first.data.version);assert.equal(second.data.page.hasMore,false);assert.equal(second.data.page.truncated,true);
 assert.notEqual(first.data.matches[0].position.startOffset,second.data.matches[0].position.startOffset);
 assert.equal((await c.invoke('project_search',{query:'计数',offset:1})).error.code,'SEARCH_PAGE_VERSION_REQUIRED');
 assert.equal((await c.invoke('project_search',{query:'Main',offset:1,expectedVersion:first.data.version})).error.code,'SEARCH_VERSION_CHANGED');
 const read=(await c.invoke('object_read',{objectId:obj})).data;
 await c.invoke('code_apply_change',{requestId:'changed',objectId:obj,expectedHash:read.contentHash,declaration:read.declaration,implementation:read.implementation+'\n// new'});
 assert.equal((await c.invoke('project_search',{query:'计数',limit:1,maxResults:2,offset:1,expectedVersion:first.data.version})).error.code,'SEARCH_VERSION_CHANGED');
});
test('读取失败、跳过对象与树枚举失败明确报告，不能把部分无命中写成不存在',async t=>{
 const objects=[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:'PROGRAM Main',implementation:'',queryReadError:'test unreadable'},
 {objectId:obj2,applicationId:app,path:['设备','应用一','Enum'],objectType:'enum',declaration:'TYPE Enum : (A, B); END_TYPE',implementation:''}];
 const c=await context(t,{objects,treeReadError:'child enumeration incomplete'});const r=await c.invoke('project_search',{query:'absent'});
 assert.equal(r.status,'succeeded');assert.equal(r.data.scope.coverageComplete,false);assert.equal(r.data.scope.readFailures.length,1);assert.equal(r.data.scope.skippedObjects.length,1);assert.equal(r.data.scope.enumerationFailures.length,1);assert.equal(r.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');
});
test('同名路径分别命中，不同工程相同 GUID 的页版本不能跨工程使用',async t=>{
 const c=await context(t);const original=JSON.parse(await readFile(c.e.source,'utf8'));
 const b=path.join(c.e.dir,'B.json');await writeFile(b,JSON.stringify(original));
 const first=await c.invoke('project_search',{query:'Main',limit:1});
 const opened=await c.c.done(await c.c.call('project_open_copy',{sourcePath:b,applicationId:app,requestId:'b'}));const s=opened.data.session;
 assert.equal((await c.c.call('project_search',{...c.target,query:'Main'})).error.code,'PROJECT_NOT_ACTIVE');
 const cross=await c.c.done(await c.c.call('project_search',{projectId:s.projectId,applicationId:app,query:'Main',offset:1,expectedVersion:first.data.version}));assert.equal(cross.error.code,'SEARCH_VERSION_CHANGED');
});
const task=(kind='Cyclic',extra={})=>({taskId:randomUUID(),applicationId:app,path:['设备','应用一','Tasks',kind],rawFields:{kind_of_task:kind,priority:'10',interval:'20',interval_unit:'ms'},watchdog:{enabled:'False',time:'100',time_unit:'ms',sensitivity:'1'},unavailableFields:[],rawCalls:[['Main','']],callsComplete:true,...extra});
test('真实任务契约：周期/事件/未知类型、缺字段及配置顺序，不用默认值假装完整',async t=>{
 const c=await context(t,{tasks:[task(),task('Event',{rawFields:{kind_of_task:'Event',event:'Trigger',interval:'0',interval_unit:'ms'},unavailableFields:[{field:'priority',reason:'unavailable'}],rawCalls:[['Missing',''],['Main','']]}),task('FutureKind')]});
 const bytes=await readFile(c.s.workingPath);const r=await c.invoke('task_inspect');assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(taskDataSchema.safeParse(r.data).success,true);
 const cyclic=r.data.tasks.find(x=>x.taskType==='Cyclic'),event=r.data.tasks.find(x=>x.taskType==='Event'),future=r.data.tasks.find(x=>x.taskType==='FutureKind');
 assert.equal(cyclic.interval.meaning,'configured-cycle-period');assert.equal(cyclic.calls[0].resolution.objectId,obj);
 assert.equal(event.interval.meaning,'not-a-cycle-period');assert.equal(event.rawFields.priority,undefined);assert.equal(event.unavailableFields[0].field,'priority');assert.deepEqual(event.calls.map(x=>x.order),[0,1]);assert.equal(event.calls[0].name,'Missing');assert.equal(event.calls[0].resolution.status,'unresolved');
 assert.equal(future.interval.meaning,'unknown-task-type');assert.equal(r.data.coverageComplete,false);assert.equal(r.data.runtimeObserved,false);assert.deepEqual(await readFile(c.s.workingPath),bytes);
});
test('任务同名程序歧义、限定路径与额外原始调用值，只有唯一核实时关联 GUID',async t=>{
 const duplicate=randomUUID();const objects=[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:'PROGRAM Main',implementation:''},
 {objectId:duplicate,applicationId:app,path:['设备','应用一','Folder','Main'],declaration:'PROGRAM Main',implementation:''},
 {objectId:obj2,applicationId:app2,path:['设备','应用二','Main'],declaration:'PROGRAM Main',implementation:''}];
 const c=await context(t,{objects,tasks:[task('Cyclic',{rawCalls:[['Main',''],['Folder.Main',''],['Folder.Main','unverified raw extra']]})]});
 const calls=(await c.invoke('task_inspect')).data.tasks[0].calls;assert.equal(calls[0].resolution.status,'ambiguous');assert.equal(calls[0].resolution.objectId,undefined);assert.equal(calls[0].resolution.candidates.length,2);
 assert.equal(calls[1].resolution.objectId,duplicate);assert.equal(calls[2].resolution.status,'unresolved');assert.equal(calls[2].raw[1],'unverified raw extra');
 const hits=(await c.invoke('project_search',{query:'Main',areas:['name']})).data.matches;assert.equal(hits.length,2);assert.notDeepEqual(hits[0].path,hits[1].path);
 const incomplete=await context(t,{treeReadError:'partial program inventory',tasks:[task()]});
 const partial=(await incomplete.invoke('task_inspect')).data;
 assert.equal(partial.coverageComplete,false);assert.equal(partial.tasks[0].calls[0].resolution.status,'unresolved');assert.equal(partial.tasks[0].calls[0].resolution.objectId,undefined);
});
test('只读前登记磁盘变化拒绝，读取中变化 unknown 冻结，不自动保存或重放',async t=>{
 const c=await context(t);await writeFile(c.s.workingPath,(await readFile(c.s.workingPath,'utf8'))+' ');
 assert.equal((await c.invoke('project_search',{query:'Main'})).error.code,'READ_DISK_CHANGED');
 const d=await context(t,{readMutatesFile:true});const result=await d.invoke('task_inspect');assert.equal(result.status,'unknown');assert.equal(result.error.code,'READ_ONLY_FILE_CHANGED');
 assert.equal((await d.c.call('session_status')).data.writeFrozen,true);
 assert.equal((await d.invoke('task_inspect')).error.code,'PENDING_UNKNOWN');
});
test('真实适配器在 IDE 退出后发现文件变化保留原结果并冻结；不 kill、不复编、不保存',async()=>{
 const e=await setup(),dir=path.join(e.dir,'read-ipc'),before=digest(await readFile(e.source));let kills=0;
 const adapter=new IdeAdapter({executable:process.execPath,profile:'test',timeoutMs:1000},()=>{
  const child=new EventEmitter();child.kill=()=>{kills++;};setTimeout(async()=>{const request=JSON.parse(await readFile(path.join(dir,'request.json'),'utf8'));
   await atomicJson(path.join(dir,'result.json'),{contractVersion:'1.0.0',status:'succeeded',summary:'test',operationId:request.operationId,data:{diskHash:before,readOnlyEvidence:{beforeDiskHash:before,afterCloseDiskHash:before,unchanged:true}}});
   await writeFile(e.source,(await readFile(e.source,'utf8'))+' ');child.emit('exit',0);},20);return child;
 });
 const r=await adapter.execute({operationId:randomUUID(),command:'search',projectPath:e.source,args:{readDiskHash:before}},dir,async()=>{});assert.equal(r.status,'unknown');assert.equal(r.error.code,'READ_ONLY_FILE_CHANGED');assert.equal(kills,0);
 const again=await adapter.reconcile(dir);assert.deepEqual(again,r);
});
test('新增输入边界拒绝正则/池任务/错误分页/未知参数，旧十三工具的输入仍兼容',()=>{
 for(const extra of [{query:''},{regex:true},{limit:101},{maxResults:1001},{expectedVersion:'not-hash'},{areas:[]}])assert.equal(schemas.project_search.safeParse({projectId:app,applicationId:app,query:'x',...extra}).success,false);
 assert.equal(schemas.task_inspect.safeParse({projectId:app,applicationId:null,targetKind:'pool'}).success,false);
 assert.equal(schemas.code_apply_change.safeParse({projectId:app,applicationId:app,requestId:'old',objectId:obj,expectedHash:'a'.repeat(64),declaration:'PROGRAM Main',implementation:''}).success,true);
});
test('搜索超时冻结，迟到的原始读取结果经同一查询计算核对，不重启 IDE 或重放',async()=>{
 const e=await setup(),fixture=new FixtureAdapter();let sends=0,pending;
 const adapter={reconcile:d=>fixture.reconcile(d),execute:async(req,dir,start)=>{
  sends++;if(req.command!=='search')return fixture.execute(req,dir,start);
  pending={req,dir,start};throw Object.assign(Error('test timeout'),{status:'unknown',code:'IDE_TIMEOUT'});
 }};
 const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},adapter);
 try{
  const opened=await service.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'open'});
  const args=schemas.project_search.parse({projectId:opened.data.session.projectId,applicationId:app,query:'Main'});
  const r=await service.call('project_search',args);assert.equal(r.status,'unknown');assert.equal((await service.status()).data.writeFrozen,true);
  await fixture.execute(pending.req,pending.dir,pending.start);
  const recovered=await service.call('operation_status',{operationId:r.operationId,reconcile:true});assert.equal(recovered.status,'succeeded',JSON.stringify(recovered));
  assert.equal(recovered.data.matches[0].matchedText,'Main');assert.equal(sends,2);assert.equal((await service.status()).data.writeFrozen,false);
 }finally{await service.store.release();}
});
test('生产 Python 读取器的对象读取/任务字段故障测试（替身，非真实 IDE）',()=>{
 const r=spawnSync('python',['tests/bridge_queries_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
test('同字节重开的已知无文本调用包装节点 GUID 不破坏分页，支持对象身份仍绑定版本',()=>{
 const args=schemas.project_search.parse({projectId:app,applicationId:app,query:'Main',limit:1});
 const corpus=[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],objectType:'st_pou',hasImplementation:true,declaration:'PROGRAM Main',implementation:'',contentHash:codeHash('PROGRAM Main','')}];
 const raw={contractVersion:'1.0.0',status:'succeeded',summary:'raw',data:{projectId:app,applicationId:app,targetKind:'application',projectPath:'fixture',diskHash:'a'.repeat(64),corpus,
  scope:{description:'supported only',applicationPath:['设备','应用一'],treeComplete:true,eligibleObjects:1,readObjects:1,coverageComplete:true,readFailures:[],enumerationFailures:[],skippedObjects:[{objectId:randomUUID(),nativeTypeId:'413e2a7d-adb1-4d2c-be29-6ae6e4fab820',path:['设备','应用一','Tasks','MainTask','Main'],stage:'unsupported-type',reason:'no supported text'}]}}};
 const first=searchResult(raw,args),secondRaw=structuredClone(raw);secondRaw.data.scope.skippedObjects[0].objectId=randomUUID();
 const second=searchResult(secondRaw,{...args,offset:1,expectedVersion:first.data.version});assert.equal(second.status,'succeeded');assert.equal(second.data.version,first.data.version);assert.notEqual(first.data.scope.skippedObjects[0].objectId,second.data.scope.skippedObjects[0].objectId);
 secondRaw.data.corpus[0].objectId=randomUUID();assert.equal(searchResult(secondRaw,{...args,offset:1,expectedVersion:first.data.version}).error.code,'SEARCH_VERSION_CHANGED');
});
