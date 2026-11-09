import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {z} from 'zod';
import {outputSchemas} from '../dist/contracts.js';
import {setup,connect,app,app2} from './helpers.mjs';import {schemas,libraryDataSchema} from '../dist/contracts.js';
import {IdeAdapter} from '../dist/adapter.js';import {digest,atomicJson} from '../dist/storage.js';import {EventEmitter} from 'node:events';
import {withoutEnumExtension} from './contract-compatibility.mjs';
const type='adb5cb65-8e1d-4a00-b70a-375ea27582f3',mid='40000000-0000-4000-8000-000000000001';
function manager(id=mid,applicationId=app,tail='库管理器',values){const prefix=['设备',applicationId===app?'应用一':'应用二',tail];
 const rows=values||[{id:'1',name:'普通库, 1.2.3 (厂商)',namespace:'中文',is_placeholder:false,is_managed:true},
  {id:'2',name:'#占位',namespace:'Delay',is_placeholder:true,placeholder_name:'占位',default_resolution:'基础库, * (厂商)',effective_resolution:'基础库, 2.0.0 (厂商)',resolution_info:'设备解析'},
  {id:'3',name:'#未知',namespace:'',is_placeholder:true,placeholder_name:'未知',default_resolution:'未知库, * (厂商)',effective_resolution:'',resolution_info:''}];
 return{applicationId,managerId:id,path:prefix,nativeTypeId:type,unavailableFields:[],references:rows.map((rawFields,order)=>({index:order,parentIndex:null,managerId:id,managerPath:prefix,order,path:[...prefix,'references',String(order)],rawFields,unavailableFields:[],resolutionStatus:rawFields.effective_resolution?'effective-resolution-reported':'unknown',resolutionBasis:'Native effective_resolution string only',installedStatus:'not-queried'}))};}
async function ctx(t,extra={}){const e=await setup({libraryManagers:[manager(),manager(mid,app2)],...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());const r=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'open'}));assert.equal(r.status,'succeeded');const s=r.data.session;
 return {e,c,s,invoke:async(a={})=>c.done(await c.call('library_inspect',{projectId:s.projectId,applicationId:app,...a}))};}

test('十九工具、只读Schema；十八个原输入输出Schema逐项兼容',async t=>{
 const x=await ctx(t),tools=(await x.c.client.listTools()).tools;assert.equal(tools.length,23);const tool=tools.find(t=>t.name==='library_inspect');assert.equal(tool.annotations.readOnlyHint,true);assert(tool.outputSchema);
 const old=JSON.parse(await readFile('tests/fixtures/library-legacy-contracts.json','utf8'));
 for(const expected of old.tools){const actual=tools.find(t=>t.name===expected.name);assert(actual);assert.equal(digest(JSON.stringify(withoutEnumExtension(z.toJSONSchema(schemas[expected.name],{io:'input'})))),expected.inputHash,expected.name+' input');assert.equal(digest(JSON.stringify(withoutEnumExtension(z.toJSONSchema(outputSchemas[expected.name])))),expected.outputHash,expected.name+' output');}
 for(const args of [{applicationId:null},{targetKind:'pool'},{save:true},{limit:201},{maxReferences:0},{fieldRead:{referenceIndex:0,field:'install'}}])assert.equal(schemas.library_inspect.safeParse({projectId:app,applicationId:app,...args}).success,false);
});
test('直接引用、占位声明/实际解析分开，原字符串/中文/空串保留，不推断已安装或缺库',async t=>{
 const x=await ctx(t),before=await readFile(x.s.workingPath),r=await x.invoke();assert.equal(r.status,'succeeded',JSON.stringify(r));assert(libraryDataSchema.safeParse(r.data).success);
 assert.equal(r.data.managers.length,1);assert.equal(r.data.references.length,3);const [regular,p,unknown]=r.data.references;
 assert.equal(regular.rawFields.name,'普通库, 1.2.3 (厂商)');assert.equal(regular.resolutionStatus,'unknown');assert.equal(p.rawFields.default_resolution,'基础库, * (厂商)');assert.equal(p.rawFields.effective_resolution,'基础库, 2.0.0 (厂商)');assert.equal(p.resolutionStatus,'effective-resolution-reported');assert.equal(unknown.rawFields.effective_resolution,'');assert.equal(unknown.resolutionStatus,'unknown');assert.equal(unknown.installedStatus,'not-queried');assert(r.data.scope.enumerationComplete);assert.deepEqual(await readFile(x.s.workingPath),before);
});
test('多个管理器保留各身份，单字段/条目失败和截断不变成完整覆盖',async t=>{
 const a=manager(),b=manager(randomUUID(),app,'第二管理器');a.references[1].rawFields.effective_resolution=null;a.references[1].resolutionStatus='unknown';a.references[1].unavailableFields=[{field:'effective_resolution',reason:'getter failed; not proof of missing library'}];b.enumerationError='entry failed';
 const x=await ctx(t,{libraryManagers:[a,b]}),r=await x.invoke();assert.equal(r.status,'succeeded');assert.equal(r.data.managers.length,2);assert.equal(r.data.scope.enumerationComplete,false);assert.equal(r.data.scope.fieldReadComplete,false);assert.equal(r.data.page.total,null);assert.equal(r.data.page.hasMore,false);assert.equal(r.data.references[1].resolutionStatus,'unknown');
 const cap=await x.invoke({maxReferences:1});assert.equal(cap.status,'succeeded');assert(cap.data.scope.truncated);assert.equal(cap.data.page.total,null);
});
test('空管理器与无法枚举明确区分，不从已安装目录补成工程清单',async t=>{
 const x=await ctx(t,{libraryManagers:[],installedLibraries:['CmpLog'],treeReadError:'unreadable subtree'}),r=await x.invoke();assert.equal(r.status,'succeeded');assert.equal(r.data.references.length,0);assert.equal(r.data.scope.enumerationComplete,false);assert.equal(r.data.page.total,null);
 const y=await ctx(t,{libraryManagers:[]}),q=await y.invoke();assert.equal(q.data.scope.enumerationComplete,true);assert.equal(q.data.page.total,0);
});
test('空管理器也必须核对精确Application路径与原生类型，异常证据冻结',async t=>{
 const m=manager(mid,app,'错误路径',[]);m.path=['设备','应用二','库管理器'];
 const x=await ctx(t,{libraryManagers:[m]}),r=await x.invoke();assert.equal(r.status,'unknown');assert.equal((await x.c.call('session_status')).data.globalFrozen,true);
});
test('页复用原采集、跨重启、不重新启动IDE；范围和文件变化拒绝',async t=>{
 const x=await ctx(t),a=await x.invoke({limit:1});assert.equal(a.status,'succeeded');await x.c.client.close();const c=await connect(x.e.dataDir);t.after(()=>c.client.close());
 const call=async extra=>c.done(await c.call('library_inspect',{projectId:x.s.projectId,applicationId:app,...extra}));
 const b=await call({limit:2,offset:a.data.page.nextOffset,expectedVersion:a.data.version});assert.equal(b.status,'succeeded',JSON.stringify(b));assert.equal(b.data.readOrigin.inventoryOperationId,a.operationId);assert.equal(b.data.page.hasMore,false);
 const op=JSON.parse(await readFile(path.join(x.e.dataDir,'operations',b.operationId+'.json'))).value;assert.equal(op.bridge,undefined);
 assert.equal((await call({offset:1})).error.code,'NATIVE_PAGE_VERSION_REQUIRED');assert.equal((await call({offset:1,expectedVersion:a.data.version,maxReferences:1})).error.code,'NATIVE_VERSION_CHANGED');
 await writeFile(x.s.workingPath,(await readFile(x.s.workingPath,'utf8'))+' ');assert.equal((await call({offset:1,expectedVersion:a.data.version})).error.code,'READ_DISK_CHANGED');
});
test('长值显式预览，同原版本字段分段完整读回，实际字节分页及无新派发',async t=>{
 const long='中文😀"\\'.repeat(1000),m=manager();m.references[1].rawFields.effective_resolution=long;
 const x=await ctx(t,{libraryManagers:[m]}),r=await x.invoke({limit:200});assert.equal(r.status,'succeeded',JSON.stringify(r));assert(Buffer.byteLength(JSON.stringify(r))<=16000);const p=r.data.references[1];assert.equal(p.rawFields.effective_resolution,null);assert.equal(p.fieldPreviews.effective_resolution.utf16Length,long.length);
 let offset=0,full='';do{const q=await x.invoke({expectedVersion:r.data.version,fieldRead:{referenceIndex:1,field:'effective_resolution',offset,limit:997}});assert.equal(q.status,'succeeded',JSON.stringify(q));assert.equal(q.data.readOrigin.inventoryOperationId,r.operationId);const d=q.data.fieldDetail;full+=d.text;assert.equal(d.sha256,digest(long));offset=d.nextOffset;}while(offset!==null);assert.equal(full,long);
 assert.equal((await x.invoke({fieldRead:{referenceIndex:1,field:'name'}})).error.code,'NATIVE_PAGE_VERSION_REQUIRED');
 assert.equal((await x.invoke({expectedVersion:r.data.version,fieldRead:{referenceIndex:2,field:'resolver_guid'}})).error.code,'LIBRARY_FIELD_UNAVAILABLE');
 const ops=await Promise.all((await readdir(path.join(x.e.dataDir,'operations'))).map(async f=>JSON.parse(await readFile(path.join(x.e.dataDir,'operations',f))).value));assert.equal(ops.filter(o=>o.tool==='library_inspect'&&o.bridge).length,1);
});
test('同GUID跨Application/工程身份隔离，不隐式切换或重用其他范围页',async t=>{
 const x=await ctx(t),first=await x.invoke({limit:1});assert.equal((await x.invoke({applicationId:app2,expectedVersion:first.data.version,offset:1})).error.code,'TARGET_MISMATCH');
 const second=path.join(x.e.dir,'B.json');await writeFile(second,await readFile(x.e.source));const b=await x.c.done(await x.c.call('project_open_copy',{requestId:'B',sourcePath:second,applicationId:app}));assert.equal(b.status,'succeeded');
 assert.equal((await x.invoke()).error.code,'PROJECT_NOT_ACTIVE');assert.equal((await x.invoke({projectId:b.data.session.projectId,offset:1,expectedVersion:first.data.version})).error.code,'NATIVE_VERSION_CHANGED');
});
test('意外修改与损坏原清单继续冻结，查询不重放读取',async t=>{
 for(const mutate of [false,true]){const x=await ctx(t,{readMutatesFile:mutate}),r=await x.invoke({limit:1});let q=r;
  if(!mutate){const file=path.join(x.e.dataDir,'ipc',r.operationId,'observed-after-exit.json'),raw=JSON.parse(await readFile(file));raw.data.references[0].rawFields.name='tampered';await writeFile(file,JSON.stringify(raw));q=await x.invoke({offset:1,expectedVersion:r.data.version});}
  assert.equal(q.status,'unknown',JSON.stringify(q));const before=await readFile(x.s.workingPath);for(let i=0;i<2;i++)assert.equal((await x.c.call('operation_status',{operationId:q.operationId})).status,'unknown');assert.deepEqual(await readFile(x.s.workingPath),before);assert.equal((await x.c.call('session_status')).data.globalFrozen,true);
 }
});
test('真实适配器libraries命令确认退出后哈希，不自动保存或kill（进程替身）',async()=>{
 const e=await setup(),dir=path.join(e.dir,'ipc'),before=digest(await readFile(e.source));let killed=0;
 const adapter=new IdeAdapter({executable:process.execPath,profile:'test',timeoutMs:1000},()=>{const child=new EventEmitter();child.kill=()=>killed++;setTimeout(async()=>{const r=JSON.parse(await readFile(path.join(dir,'request.json')));await atomicJson(path.join(dir,'result.json'),{contractVersion:'1.0.0',status:'succeeded',summary:'fixture',operationId:r.operationId,data:{diskHash:before,readOnlyEvidence:{beforeDiskHash:before,afterCloseDiskHash:before,unchanged:true}}});await writeFile(e.source,(await readFile(e.source,'utf8'))+' ');child.emit('exit',0);},20);return child;});
 const r=await adapter.execute({operationId:randomUUID(),command:'libraries',projectPath:e.source,args:{readDiskHash:before}},dir,async()=>{});assert.equal(r.status,'unknown');assert.equal(r.error.code,'READ_ONLY_FILE_CHANGED');assert.equal(killed,0);
});
test('生产固定库读取器：原生API替身、失败及只读调用白名单',()=>{const r=spawnSync('python',['tests/bridge_libraries_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);});
