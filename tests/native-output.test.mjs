import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {setup,connect,app} from './helpers.mjs';
import {schemas,deviceDataSchema} from '../dist/contracts.js';
import {digest,canonical} from '../dist/storage.js';
import {boundNativeReply,toolOutput,jsonBytes,NATIVE_REPLY_BYTES} from '../dist/native-output.js';
const dev='30000000-0000-4000-8000-000000000001';
const longValue='😀中文\n\t"\\'+('变量😀\u0001"\\'.repeat(700));
function fixture(values=Array.from({length:100},(_,i)=>i===0?longValue:'T#3s')) {
 const node={index:0,parentIndex:null,parentId:null,objectId:dev,name:'设备',path:['设备'],pathComplete:true,nativeTypeId:dev,kind:'device',typeBasis:'native-flag',isDevice:true,childrenRead:true,unavailableFields:[]};
 const parameters=values.map((value,index)=>({index,parentIndex:null,identifier:String(index),name:'参数'+index,path:['设备','connectors','1',String(index)],ownerPath:['设备','connectors','1'],
  type:value===null?null:'STRING',value,valueSource:'connectors.host_parameters.value',source:'connectors.host_parameters',hasSubElements:false,unavailableFields:value===null?[{field:'value',reason:'unreadable'}]:[]}));
 return{nativeNodes:[node],nativeDevices:[{device:node,identification:{type:'4102',id:'test',deviceDescriptionVersion:'3.5.11.11'},deviceInfo:{name:'Fixture',vendor:'厂商',description:'test',orderNumber:''},
  identificationSource:'get_device_identification',modelSource:'exact description',firmwareVersion:null,firmwareStatus:'not-provided-by-verified-offline-api',unavailableFields:[],connectors:[],parameters,parameterReadFailures:[],
  scope:{description:'fixture offline scope'},completeDeviceConfiguration:false,runtimeObserved:false,valueLimitations:'offline only'}]};
}
async function context(t,f=fixture()) {
 const e=await setup(f),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const o=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'open'}));assert.equal(o.status,'succeeded');
 const s=o.data.session;
 const call=async args=>c.done(await c.call('device_inspect',{projectId:s.projectId,deviceId:dev,...args}));
 return{e,c,s,call};
}
async function op(c,id){return JSON.parse(await readFile(path.join(c.e.dataDir,'operations',id+'.json'),'utf8')).value;}
function bounded(result){assert(jsonBytes(result)<=NATIVE_REPLY_BYTES);const wire=toolOutput(result);assert(jsonBytes(wire)<50000);assert.equal(wire.content[0].text,wire.structuredContent.summary+'\n'+JSON.stringify(wire.structuredContent));}

test('默认大值仅预览，按实际字节页游标可覆盖原清单且不重复派发',async t=>{
 const c=await context(t),first=await c.call({});assert.equal(first.status,'succeeded');assert(deviceDataSchema.safeParse(first.data).success);bounded(first);
 assert(first.data.page.returned<100);assert(first.data.delivery.pageReduced);assert.equal(first.data.scope.parameterCoverageComplete,true);assert.equal(first.data.page.truncated,false);
 const p=first.data.parameters[0];assert.equal(p.value,null);assert.equal(p.valuePreview.sha256,digest(longValue));assert.equal(p.valuePreview.utf16Length,longValue.length);assert(longValue.startsWith(p.valuePreview.text));assert.equal(p.unavailableFields.length,0);
 let r=first,rows=[...r.data.parameters];while(r.data.page.hasMore){r=await c.call({offset:r.data.page.nextOffset,expectedVersion:first.data.version});assert.equal(r.status,'succeeded');bounded(r);assert.equal(r.data.readOrigin.inventoryOperationId,first.operationId);assert.equal((await op(c,r.operationId)).bridge,undefined);rows.push(...r.data.parameters);}
 assert.deepEqual(rows.map(x=>x.index),Array.from({length:100},(_,i)=>i));
 const raw=JSON.parse(await readFile(path.join(c.e.dataDir,'ipc',first.operationId,'observed-after-exit.json'),'utf8'));assert.equal(raw.data.parameters[0].value,longValue);
 const again=await c.c.call('operation_status',{operationId:first.operationId});assert.deepEqual(again,first);bounded(again);
});
test('分段值跨服务重启从原清单无损重组，空串/缺失值和 UTF-16 边界分别处理',async t=>{
 const c=await context(t,fixture([longValue,'',null])),first=await c.call({});await c.c.client.close();const restarted=await connect(c.e.dataDir);t.after(()=>restarted.client.close());
 const detail=async valueRead=>restarted.done(await restarted.call('device_inspect',{projectId:c.s.projectId,deviceId:dev,expectedVersion:first.data.version,valueRead}));
 let offset=0,text='',parts=0;
 do{const r=await detail({parameterIndex:0,offset,limit:513});assert.equal(r.status,'succeeded',JSON.stringify(r));bounded(r);assert(deviceDataSchema.safeParse(r.data).success);assert.equal(r.data.valueDetail.offset,offset);assert.equal(r.data.valueDetail.sha256,digest(longValue));assert.equal(r.data.valueDetail.text.length,r.data.valueDetail.endOffset-offset);
  assert.equal((await op(c,r.operationId)).bridge,undefined);assert.equal(r.data.readOrigin.inventoryOperationId,first.operationId);text+=r.data.valueDetail.text;offset=r.data.valueDetail.nextOffset;parts++;
 }while(offset!==null);
 assert(parts>1);assert.equal(text,longValue);assert.equal(digest(text),digest(longValue));
 const empty=await detail({parameterIndex:1});assert.equal(empty.data.valueDetail.text,'');assert.equal(empty.data.valueDetail.totalLength,0);assert.equal(empty.data.valueDetail.nextOffset,null);
 assert.equal((await detail({parameterIndex:2})).error.code,'PARAMETER_VALUE_UNAVAILABLE');
 assert.equal((await detail({parameterIndex:0,offset:1})).error.code,'VALUE_OFFSET_INVALID');
 assert.equal((await detail({parameterIndex:0,offset:longValue.length+1})).error.code,'VALUE_OFFSET_INVALID');
 assert.equal((await detail({parameterIndex:9})).error.code,'PARAMETER_INDEX_OUT_OF_RANGE');
});
test('详情沿用版本/采集范围/磁盘/活动身份约束；缺少版本不新采集',async t=>{
 const c=await context(t),first=await c.call({});
 assert.equal((await c.call({valueRead:{parameterIndex:0}})).error.code,'NATIVE_PAGE_VERSION_REQUIRED');
 assert.equal((await c.call({expectedVersion:first.data.version,maxParameters:2,valueRead:{parameterIndex:0}})).error.code,'NATIVE_VERSION_CHANGED');
 assert.equal((await c.call({expectedVersion:first.data.version,offset:1,valueRead:{parameterIndex:0}})).error.code,'VALUE_PAGE_OFFSET');
 assert.equal((await c.call({expectedVersion:'0'.repeat(64),valueRead:{parameterIndex:0}})).error.code,'NATIVE_VERSION_CHANGED');
 const page0=await c.call({expectedVersion:first.data.version,offset:0});assert.equal(page0.data.readOrigin.inventoryOperationId,first.operationId);assert.equal((await op(c,page0.operationId)).bridge,undefined);
 await writeFile(c.s.workingPath,(await readFile(c.s.workingPath,'utf8'))+' ');
 assert.equal((await c.call({expectedVersion:first.data.version,valueRead:{parameterIndex:0}})).error.code,'READ_DISK_CHANGED');
 const records=await Promise.all((await readdir(path.join(c.e.dataDir,'operations'))).map(async n=>JSON.parse(await readFile(path.join(c.e.dataDir,'operations',n))).value));
 assert.equal(records.filter(x=>x.tool==='device_inspect'&&x.bridge).length,1);
});
test('详情原清单缺失或值被篡改时冻结，不用预览替代原值、不重派发',async t=>{
 for(const mode of ['missing','tampered','missing-bridge']){const c=await context(t),first=await c.call({}),p=path.join(c.e.dataDir,'ipc',first.operationId,'observed-after-exit.json');
  if(mode==='missing')await rm(p);else if(mode==='tampered'){const raw=JSON.parse(await readFile(p));raw.data.parameters[0].value+='tampered';await writeFile(p,JSON.stringify(raw));}
  else{const file=path.join(c.e.dataDir,'operations',first.operationId+'.json'),envelope=JSON.parse(await readFile(file));delete envelope.value.bridge;envelope.checksum=digest(canonical(envelope.value));await writeFile(file,JSON.stringify(envelope));}
  const r=await c.call({expectedVersion:first.data.version,valueRead:{parameterIndex:0}});assert.equal(r.status,'unknown');assert.equal(r.error.code,'NATIVE_INVENTORY_UNCONFIRMED');assert.equal((await op(c,r.operationId)).bridge,undefined);assert.equal((await c.c.call('session_status')).data.globalFrozen,true);
 }
});
test('兼容旧输入，小值/空串/未知保持含义，详情不能夹带保存或无效上限',async t=>{
 const c=await context(t,fixture(['T#3s','',null])),r=await c.call({});assert.deepEqual(r.data.parameters.map(x=>x.value),['T#3s','',null]);assert.equal(r.data.scope.parameterCoverageComplete,false);assert(r.data.parameters.every(x=>x.valuePreview===undefined));
 for(const valueRead of [{parameterIndex:-1},{parameterIndex:0,limit:1},{parameterIndex:0,limit:2049},{parameterIndex:0,save:true}])assert.equal(schemas.device_inspect.safeParse({projectId:app,deviceId:dev,valueRead}).success,false);
 assert(schemas.device_inspect.safeParse({projectId:app,deviceId:dev}).success);
});
test('历史大响应及极端元数据不会绕过传输上限，投影不修改原证据',()=>{
 const d=fixture().nativeDevices[0];const r={contractVersion:'1.0.0',status:'succeeded',summary:'历史设备结果',operationId:dev,requestId:'old',data:{...d,projectId:app,version:'0'.repeat(64),readOrigin:{kind:'ide',inventoryOperationId:dev},page:{offset:0,limit:100,returned:100,retained:100,nextOffset:null,hasMore:false,truncated:false,total:100}}};
 const before=JSON.stringify(r),b=boundNativeReply(r);bounded(b);assert.equal(JSON.stringify(r),before);assert.equal(b.operationId,r.operationId);assert.equal(b.data.version,r.data.version);assert(b.data.page.hasMore);assert.equal(b.data.parameters[0].value,null);
 r.data.deviceInfo.description='很长'.repeat(30000);const overflow=boundNativeReply(r);assert.equal(overflow.status,'unsupported');assert.equal(overflow.error.code,'NATIVE_METADATA_TOO_LARGE');bounded(overflow);
});
test('高转义文本片段按真实返回边界推进，完整 MCP 封装仍小于客户端阈值',async t=>{
 const value='\u0000'.repeat(5000)+'😀',c=await context(t,fixture([value])),first=await c.call({});let next=0,combined='';
 while(next!==null){const r=await c.call({expectedVersion:first.data.version,valueRead:{parameterIndex:0,offset:next,limit:2048}});assert.equal(r.status,'succeeded');bounded(r);const v=r.data.valueDetail;assert(v.endOffset>next);combined+=v.text;next=v.nextOffset;}
 assert.equal(combined,value);
});
