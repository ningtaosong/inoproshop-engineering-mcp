import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {setup,connect,app,obj} from './helpers.mjs';import {schemas,structureDataSchema,deviceDataSchema} from '../dist/contracts.js';
import {IdeAdapter} from '../dist/adapter.js';import {digest,atomicJson} from '../dist/storage.js';import {EventEmitter} from 'node:events';
const dev='30000000-0000-4000-8000-000000000001',unknown='30000000-0000-4000-8000-000000000002';
function fixture(){
 const node=(id,name,index,parentIndex,parentId,kind,isDevice=false)=>({index,parentIndex,parentId,objectId:id,name,path:parentIndex===null?[name]:['设备',name],pathComplete:true,nativeTypeId:unknown,kind,typeBasis:kind==='unknown'?'unconfirmed':'native-flag',isDevice,unavailableFields:[],childrenRead:true});
 const nodes=[node(dev,'设备',0,null,null,'device',true),node(app,'应用',1,0,dev,'application'),node(obj,'程序',2,0,dev,'pou'),node(unknown,'未知非ST',3,0,dev,'unknown')];
 const parameters=[0,1,2].map(i=>({index:i,parentIndex:null,source:'connectors.host_parameters',ownerPath:['设备','connectors','1'],identifier:String(i),name:'参数'+i,path:['设备','connectors','1',String(i)],type:'std:TIME',value:i===1?'':'T#4s',valueSource:'connectors.host_parameters.value',hasSubElements:false,unavailableFields:[]}));
 return {nativeNodes:nodes,nativeDevices:[{device:nodes[0],identification:{type:'4102',id:'test-device-id',deviceDescriptionVersion:'1.2.3.4'},deviceInfo:{name:'Actual model from matched description',vendor:'vendor',description:'description',orderNumber:''},
  identificationSource:'get_device_identification',modelSource:'repository exact identity',firmwareVersion:null,firmwareStatus:'not-provided-by-verified-offline-api',unavailableFields:[],connectors:[],parameters,parameterReadFailures:[],scope:{description:'explicit fixture offline parameter scope'},completeDeviceConfiguration:false,runtimeObserved:false,valueLimitations:'Offline only'}]};
}
async function context(t,extra={}){const e=await setup({...fixture(),...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());const opened=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'open'}));assert.equal(opened.status,'succeeded');const s=opened.data.session;return{e,c,s};}
// done accepts a Reply, so resolve the call before polling.
async function invoke(c,tool,a={}){return c.c.done(await c.c.call(tool,{projectId:c.s.projectId,...a}));}
test('新增正式 Schema 与十七工具：旧十五输入兼容，新工具不接受写入/App/名称猜测参数',async t=>{
 const c=await context(t);const tools=(await c.c.client.listTools()).tools;assert.equal(tools.length,22);
 for(const name of ['project_structure','device_inspect']){const tool=tools.find(x=>x.name===name);assert.equal(tool.annotations.readOnlyHint,true);assert(tool.inputSchema&&tool.outputSchema);}
 for(const a of [{projectId:app,save:true},{projectId:app,limit:201},{projectId:app,maxNodes:0},{projectId:app,applicationId:app}])assert.equal(schemas.project_structure.safeParse(a).success,false);
 assert.equal(schemas.device_inspect.safeParse({projectId:app,deviceId:dev,firmware:true}).success,false);
 assert.equal(schemas.device_inspect.safeParse({projectId:app,deviceId:'设备'}).success,false);
 assert(schemas.object_read.safeParse({projectId:app,applicationId:app,objectId:obj}).success);
});
test('完整原生树含未知非ST、父子/身份/路径；分页沿用原清单且没有新桥接派发',async t=>{
 const c=await context(t),before=await readFile(c.s.workingPath),first=await invoke(c,'project_structure',{limit:2});
 assert.equal(first.status,'succeeded',JSON.stringify(first));assert(structureDataSchema.safeParse(first.data).success);assert.equal(first.data.nodes[1].parentId,dev);
 const second=await invoke(c,'project_structure',{offset:2,limit:2,expectedVersion:first.data.version});assert.equal(second.status,'succeeded',JSON.stringify(second));assert.equal(second.data.nodes[1].kind,'unknown');assert.equal(second.data.nodes[1].name,'未知非ST');assert.equal(second.data.nodes[1].parentIndex,0);
 assert.equal(second.data.version,first.data.version);assert.equal(second.data.readOrigin.kind,'recorded-inventory');assert.equal(second.data.readOrigin.inventoryOperationId,first.operationId);
 const record=JSON.parse(await readFile(path.join(c.e.dataDir,'operations',second.operationId+'.json'))).value;assert.equal(record.bridge,undefined);assert.deepEqual(await readFile(c.s.workingPath),before);
 assert.equal((await c.c.call('session_status')).data.session.projectId,c.s.projectId);
});
test('截断/读取失败单列，末页不是完整覆盖，设备未提供值不补默认',async t=>{
 const f=fixture();f.nativeNodes[3].unavailableFields=[{field:'nativeTypeId',reason:'read failed'}];f.nativeNodes[3].nativeTypeId=null;f.nativeDevices[0].parameters[0].value=null;f.nativeDevices[0].parameters[0].unavailableFields=[{field:'value',reason:'unreadable'}];
 const c=await context(t,{...f,treeReadError:'branch failure'});const r=await invoke(c,'project_structure',{maxNodes:2});assert(r.data.page.truncated);assert.equal(r.data.page.total,null);assert.equal(r.data.scope.coverageComplete,false);assert.equal(r.data.scope.enumerationFailures.length,1);
 const d=await invoke(c,'device_inspect',{deviceId:dev,maxParameters:1});assert.equal(d.status,'succeeded');assert.equal(d.data.parameters[0].value,null);assert.equal(d.data.firmwareVersion,null);assert.equal(d.data.identification.deviceDescriptionVersion,'1.2.3.4');assert.equal(d.data.completeDeviceConfiguration,false);assert.equal(d.data.scope.parameterCoverageComplete,false);assert.equal(d.data.page.total,null);assert(d.data.page.truncated);
});
test('设备离线参数分页保留空串、实际来源，错误目标不当设备处理',async t=>{
 const c=await context(t),first=await invoke(c,'device_inspect',{deviceId:dev,limit:1});assert.equal(first.status,'succeeded',JSON.stringify(first));assert(deviceDataSchema.safeParse(first.data).success);
 const next=await invoke(c,'device_inspect',{deviceId:dev,limit:2,offset:1,expectedVersion:first.data.version});assert.equal(next.data.parameters[0].value,'');assert.equal(next.data.parameters[0].valueSource,'connectors.host_parameters.value');assert.equal(next.data.page.hasMore,false);
 const notDevice=await invoke(c,'device_inspect',{deviceId:obj});assert.equal(notDevice.status,'unsupported');assert.equal(notDevice.error.code,'NOT_DEVICE');
 assert.equal((await invoke(c,'device_inspect',{deviceId:randomUUID()})).error.code,'DEVICE_ID_NOT_UNIQUE');assert.equal((await c.c.call('session_status')).data.writeFrozen,false);
});
test('续页跨重启仍沿用原记录，缺少版本/变化范围/磁盘变化明确拒绝',async t=>{
 const c=await context(t),first=await invoke(c,'project_structure',{limit:1});await c.c.client.close();const restarted=await connect(c.e.dataDir);t.after(()=>restarted.client.close());
 const page=await restarted.done(await restarted.call('project_structure',{projectId:c.s.projectId,limit:2,offset:1,expectedVersion:first.data.version}));assert.equal(page.status,'succeeded',JSON.stringify(page));assert.equal(page.data.readOrigin.inventoryOperationId,first.operationId);
 assert.equal((await restarted.done(await restarted.call('project_structure',{projectId:c.s.projectId,offset:1}))).error.code,'NATIVE_PAGE_VERSION_REQUIRED');
 assert.equal((await restarted.done(await restarted.call('project_structure',{projectId:c.s.projectId,offset:1,maxNodes:3,expectedVersion:first.data.version}))).error.code,'NATIVE_VERSION_CHANGED');
 await writeFile(c.s.workingPath,(await readFile(c.s.workingPath,'utf8'))+' ');assert.equal((await restarted.done(await restarted.call('project_structure',{projectId:c.s.projectId,offset:1,expectedVersion:first.data.version}))).error.code,'READ_DISK_CHANGED');
});
test('同 GUID 不同工程隔离，旧目标不派发、不能借页版本隐式激活',async t=>{
 const c=await context(t),first=await invoke(c,'project_structure',{limit:1}),b=path.join(c.e.dir,'B.json');await writeFile(b,await readFile(c.e.source));
 const opened=await c.c.done(await c.c.call('project_open_copy',{sourcePath:b,applicationId:app,requestId:'B'})),bid=opened.data.session.projectId;
 assert.equal((await invoke(c,'project_structure')).error.code,'PROJECT_NOT_ACTIVE');
 assert.equal((await c.c.done(await c.c.call('project_structure',{projectId:bid,offset:1,expectedVersion:first.data.version}))).error.code,'NATIVE_VERSION_CHANGED');
 assert.equal((await c.c.call('session_status')).data.session.projectId,bid);
});
test('损坏或丢失的分页原证据继续冻结，不重新启动原清单读取',async t=>{
 for(const corrupt of [false,true]){const c=await context(t),first=await invoke(c,'project_structure',{limit:1}),p=path.join(c.e.dataDir,'ipc',first.operationId,'observed-after-exit.json');if(corrupt){const raw=JSON.parse(await readFile(p));raw.data.nodes[0].name='tampered';await writeFile(p,JSON.stringify(raw));}else await rm(p);
  const r=await invoke(c,'project_structure',{offset:1,expectedVersion:first.data.version});assert.equal(r.status,'unknown',JSON.stringify(r));assert.equal(r.error.code,'NATIVE_INVENTORY_UNCONFIRMED');assert.equal((await c.c.call('session_status')).data.globalFrozen,true);
  const record=JSON.parse(await readFile(path.join(c.e.dataDir,'operations',r.operationId+'.json'))).value;assert.equal(record.bridge,undefined);
 }
});
test('新只读工具发现意外文件变化后冻结；原操作查询不重放',async t=>{
 const c=await context(t,{readMutatesFile:true}),r=await invoke(c,'project_structure');assert.equal(r.status,'unknown');assert.equal(r.error.code,'READ_ONLY_FILE_CHANGED');
 const before=await readFile(c.s.workingPath);for(let i=0;i<2;i++)assert.equal((await c.c.call('operation_status',{operationId:r.operationId})).status,'unknown');assert.deepEqual(await readFile(c.s.workingPath),before);assert.equal((await invoke(c,'device_inspect',{deviceId:dev})).error.code,'PENDING_UNKNOWN');
});
test('实际适配器为两项命令核对进程退出后的工程文件，不保存修正或 kill',async()=>{
 for(const command of ['structure','device']){const e=await setup(),dir=path.join(e.dir,'ipc'),before=digest(await readFile(e.source));let killed=0;
  const adapter=new IdeAdapter({executable:process.execPath,profile:'test',timeoutMs:1000},()=>{const child=new EventEmitter();child.kill=()=>killed++;setTimeout(async()=>{const r=JSON.parse(await readFile(path.join(dir,'request.json')));await atomicJson(path.join(dir,'result.json'),{contractVersion:'1.0.0',status:'succeeded',summary:'fixture',operationId:r.operationId,data:{diskHash:before,readOnlyEvidence:{beforeDiskHash:before,afterCloseDiskHash:before,unchanged:true}}});await writeFile(e.source,(await readFile(e.source,'utf8'))+' ');child.emit('exit',0);},20);return child;});
  const r=await adapter.execute({operationId:randomUUID(),command,projectPath:e.source,args:{readDiskHash:before}},dir,async()=>{});assert.equal(r.status,'unknown');assert.equal(r.error.code,'READ_ONLY_FILE_CHANGED');assert.equal(killed,0);
 }
});
test('生产原生读取器故障覆盖（API 替身，不是真实 IDE）',()=>{const r=spawnSync('python',['tests/bridge_native_queries_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);});
