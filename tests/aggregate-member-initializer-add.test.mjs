import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {planMemberInitializerEdit as plan,applyMemberInitializerInsertion as rawInsert} from '../dist/variable-edit.js';
import {normalize,codeHash} from '../dist/storage.js';
import {schemas,outputSchemas} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {setup,app,obj,obj2} from './helpers.mjs';

const source='VAR_GLOBAL\n Config2 : ST_EditConfig := (DelayTime := T#5s, Count := 7);\nEND_VAR';
const type='TYPE ST_EditConfig : STRUCT\n Enable : BOOL;\n DelayTime : TIME;\n Count : DINT;\n Label : STRING;\nEND_STRUCT\nEND_TYPE';
const action={action:'add-member-initializer',name:'Config2',memberName:'Enable',initializer:'TRUE'};
const digest=s=>createHash('sha256').update(s).digest('hex');
const sha=async p=>digest(await readFile(p));
const execute=(s=source,d=type,a=action)=>plan(s,d,'GVL_Edit','ST_EditConfig',a);

for(const [memberName,initializer,aggregate] of [
 ['Enable','TRUE','DelayTime := T#5s, Count := 7'],['Enable','FALSE','Count := 1'],
 ['Count','-2147483648','Enable := FALSE'],['Count','2147483647','Enable := TRUE'],
 ['Count','0','Enable := TRUE'],['DelayTime','T#0ms','Count := 1'],
 ['DelayTime','T#60000ms','Count := 1'],['DelayTime','T#60s','Count := 1']]){
 test('planner authorized '+memberName+' '+initializer,()=>{
  const s=source.replace('DelayTime := T#5s, Count := 7',aggregate);
  const p=execute(s,type,{...action,memberName,initializer});
  assert.equal(p.before,'');assert.equal(p.range.startOffset,p.range.endOffset);
  assert.equal(p.declaration,normalize(s).slice(0,p.range.startOffset)+p.after+normalize(s).slice(p.range.startOffset));
  assert.equal(p.after,', '+memberName+' := '+initializer);
  assert.equal(p.memberName,memberName);
 });
}

for(const aggregate of [
 'DelayTime := T#5s, Count := 7',
 '\r\n  DelayTime := T#5s, (* 中文 Enable 不是真实成员 *)\r\n  Count := 7\r\n ',
 '\n  DelayTime := T#5s,\n  Count := 7 // Enable := FALSE 是注释\n ',
 "Count := 7, Label := 'Enable := TRUE, ) (*文本*)'",
 "(*😀 中文头*) DelayTime := T#5s, Count := 7 (*尾部*)"]){
 test('one insertion preserves comments, line endings and strings '+JSON.stringify(aggregate),()=>{
  const s=source.replace('DelayTime := T#5s, Count := 7',aggregate).replace(/\r?\n/g,'\r\n');
  const p=execute(s);const native=rawInsert(s,p.declaration,{...p.range,text:p.after});
  assert.equal(normalize(native),p.declaration);
  const at=native.indexOf(p.after,s.indexOf('Config2'));
  assert.equal(native.slice(0,at)+native.slice(at+p.after.length),s);
  assert.equal(p.after,', Enable := TRUE');
 });
}

test('case-insensitive names use the actual field spelling without sample names or offsets',()=>{
 const s='VAR_GLOBAL\n Thing : Settings := (\n  Total := 8\n );\nEND_VAR';
 const d='TYPE Settings : STRUCT\n Total : DINT; Ready : BOOL;\nEND_STRUCT END_TYPE';
 const p=plan(s,d,'Options','Settings',{...action,name:'tHiNg',memberName:'rEaDy'});
 assert.equal(p.declaration,s.replace('\n );','\n , Ready := TRUE);'));
});

const bad=[
 ['already initialized',source.replace('Count := 7','Count := 7, Enable := FALSE'),type,action],
 ['case duplicate member',source.replace('Count := 7','Count := 7, enable := FALSE, ENABLE := TRUE'),type,action],
 ['missing field',source,type,{...action,memberName:'Missing'}],
 ['unsupported field type',source,type.replace('Enable : BOOL','Enable : INT'),action],
 ['duplicate DUT field',source,type.replace('Enable : BOOL;','Enable : BOOL; enable : BOOL;'),action],
 ['no initialization',source.replace(' := (DelayTime := T#5s, Count := 7)',''),type,action],
 ['empty initializer',source.replace('DelayTime := T#5s, Count := 7',''),type,action],
 ['incomplete initializer',source.replace(', Count := 7)',', Count := )'),type,action],
 ['missing comma',source.replace(', Count := 7',' Count := 7'),type,action],
 ['nested member',source.replace('Count := 7','Count := (X := 7)'),type,action],
 ['array member',source.replace('Count := 7','Count := [7]'),type,action],
 ['array parent',source.replace('ST_EditConfig','ARRAY[0..2] OF ST_EditConfig'),type,action],
 ['union',source,type.replace('STRUCT','UNION'),action],
 ['RETAIN',source.replace('VAR_GLOBAL','VAR_GLOBAL RETAIN'),type,action],
 ['PERSISTENT',source.replace('VAR_GLOBAL','VAR_GLOBAL PERSISTENT'),type,action],
 ['AT',source.replace('Config2 :','Config2 AT %MD0 :'),type,action],
 ['shared parent',source.replace('Config2 :','Config2, Another :'),type,action],
 ['duplicate parent',source.replace('END_VAR',' Config2 : ST_EditConfig := (Count := 2);\nEND_VAR'),type,action],
 ['duplicate empty block',source+'\nVAR_GLOBAL\nEND_VAR',type,action],
 ['unknown old member',source.replace('Count := 7','Unknown := 7'),type,action],
 ['qualified parent',source.replace('ST_EditConfig','Library.ST_EditConfig'),type,action],
 ['expected old value on add',source,type,{...action,expectedOldInitializer:'FALSE'}],
 ['out-of-range TIME',source.replace('DelayTime := T#5s, ','Enable := TRUE, '),type,{...action,memberName:'DelayTime',initializer:'T#61s'}],
 ['out-of-range DINT',source.replace(', Count := 7',''),type,{...action,memberName:'Count',initializer:'2147483648'}],
 ['nonliteral BOOL',source,type,{...action,initializer:'1'}],
];
for(const [name,s,d,a] of bad)test('planner refuses '+name,()=>assert.throws(()=>execute(s,d,a)));

test('old set-member action never creates a missing explicit member',()=>{
 assert.throws(()=>execute(source,type,{...action,action:'set-member-initializer',expectedOldInitializer:'FALSE'}),/missing/);
});

const native='2db5746d-d284-4425-9f7f-2663a34b0ebc';
const objects=()=>[
 {objectId:obj,applicationId:app,path:['设备','应用一','GVL_Edit'],objectType:'gvl',nativeTypeId:'ffbfa93a-b94d-45fc-a329-229860183b1d',hasImplementation:false,declaration:source,implementation:''},
 {objectId:obj2,applicationId:app,path:['设备','应用一','ST_EditConfig'],objectType:'structure',nativeTypeId:native,hasImplementation:false,declaration:type,implementation:''}
];
async function fixture(t,{rows=objects(),extra={},rewrite=r=>r,after=r=>r,mode='copy'}={}){
 const e=await setup({objects:rows,...extra}),adapter=new FixtureAdapter(),requests=[];
 const config={dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000};
 const wrap={execute:async(r,...rest)=>{requests.push(structuredClone(r));return after(await adapter.execute(rewrite(r),...rest),r);},reconcile:d=>adapter.reconcile(d)};
 const service=new EngineeringService(config,wrap);t.after(()=>service.store.release());
 const call=async(n,a)=>{let r=await service.call(n,schemas[n].parse(a));while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
 const opened=await call(mode==='direct'?'project_open':'project_open_copy',{requestId:randomUUID(),...(mode==='direct'?{projectPath:e.source}:{sourcePath:e.source}),applicationId:app});
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));const s=opened.data.session;
 const parent=await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj});
 const dut=rows[1].nativeTypeId===native?await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj2}):{};
 const request={...action,requestId:randomUUID(),projectId:s.projectId,applicationId:app,objectId:obj,
  expectedHash:parent.data.contentHash,expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash,typeObjectId:obj2,expectedTypeHash:dut.data?.contentHash??codeHash(rows[1].declaration,rows[1].implementation)};
 return {e,s,service,call,request,requests,config,wrap};
}
for(const mode of ['direct','copy'])test('service '+mode+' adds exactly once and deduplicates',async t=>{
 const f=await fixture(t,{mode}),before=JSON.parse(await readFile(f.s.workingPath,'utf8'));
 const result=await f.call('variable_edit',f.request);assert.equal(result.status,'succeeded',JSON.stringify(result));
 assert.equal(result.data.declaration,execute().declaration);
 assert.equal(result.data.editEvidence.action,'add-member-initializer');
 assert.equal(result.data.editEvidence.before,'');assert.equal(result.data.memberInsertionEvidence.preservedRawSurroundings,true);
 const final=JSON.parse(await readFile(f.s.workingPath,'utf8'));
 assert.equal(final.objects[0].declaration,execute().declaration);
 assert.deepEqual(final.objects[1],before.objects[1]);
 const count=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),result);assert.equal(f.requests.length,count);
 assert.equal(f.requests.filter(r=>r.command==='change').length,1);
});
for(const mutation of [
 {expectedHash:'0'.repeat(64)},{expectedSnapshot:'0'.repeat(64)},{expectedDiskHash:'0'.repeat(64)},
 {expectedTypeHash:'0'.repeat(64)},{memberName:'Missing'},{memberName:'Count'}
])test('service rejects stale/invalid before native write '+JSON.stringify(mutation),async t=>{
 const f=await fixture(t),before=await sha(f.s.workingPath),at=f.requests.length;
 const result=await f.call('variable_edit',{...f.request,...mutation});
 assert(['conflict','unsupported'].includes(result.status),JSON.stringify(result));
 assert.equal(await sha(f.s.workingPath),before);
 assert.equal(f.requests.slice(at).filter(r=>['change','save'].includes(r.command)).length,0);
});
test('same-name different native DUT, changed ownership and unsupported native type refuse',async t=>{
 for(const change of ['duplicate','parent','type']){
  const rows=objects();if(change==='duplicate')rows.push({...rows[1],objectId:randomUUID()});
  else if(change==='parent')rows[1].path.splice(2,0,'Folder');
  else rows[1].nativeTypeId='00000000-0000-4000-8000-000000000000';
  const f=await fixture(t,{rows}),before=await sha(f.s.workingPath);
  const r=await f.call('variable_edit',f.request);assert(['conflict','unsupported',...(change==='type'?['unknown']:[])].includes(r.status),JSON.stringify(r));
  assert.equal(await sha(f.s.workingPath),before);assert.equal(f.requests.filter(r=>r.command==='change').length,0);
 }
});
test('external disk edit and write-boundary DUT change are refused',async t=>{
 const f=await fixture(t);await writeFile(f.s.workingPath,(await readFile(f.s.workingPath,'utf8'))+' ');
 const before=await sha(f.s.workingPath),count=f.requests.length;
 assert.equal((await f.call('variable_edit',f.request)).status,'conflict');assert.equal(f.requests.length,count);assert.equal(await sha(f.s.workingPath),before);
 const g=await fixture(t,{rewrite:r=>r.command==='change'?{...r,args:{...r.args,variableTypeGuard:{...r.args.variableTypeGuard,contentHash:'0'.repeat(64)}}}:r});
 const old=await sha(g.s.workingPath);assert.equal((await g.call('variable_edit',g.request)).status,'conflict');assert.equal(await sha(g.s.workingPath),old);
});
for(const mode of ['direct','copy'])test('partial insertion freezes without reversal, retry or restart replay '+mode,async t=>{
 const f=await fixture(t,{mode,extra:{failImplementation:true}});
 const r=await f.call('variable_edit',f.request);assert.equal(r.status,'unknown',JSON.stringify(r));
 assert.match(await readFile(f.s.workingPath,'utf8'),/Enable := TRUE/);
 const n=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),r);
 await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');
 assert.equal(f.requests.length,n);await f.service.store.release();
 const restarted=new EngineeringService(f.config,f.wrap);t.after(()=>restarted.store.release());
 const status=await restarted.call('operation_status',{operationId:r.operationId,reconcile:true});
 assert.equal(status.status,'unknown');assert.equal(f.requests.length,n);
});
for(const loss of ['type','insertion','declaration','list'])test('missing '+loss+' evidence freezes and retains the first result',async t=>{
 const after=(r,req)=>{
  if(loss==='list'&&req.command==='list')return {...r,data:{...r.data,complete:false,nextOffset:999}};
  if(req.command!=='change'||r.status!=='succeeded')return r;
  const data={...r.data};if(loss==='type')delete data.variableTypeEvidence;
  if(loss==='insertion')delete data.memberInsertionEvidence;
  if(loss==='declaration')data.declaration+='// unexpected';
  return {...r,data};
 };
 const f=await fixture(t,{after}),before=await sha(f.s.workingPath);
 const r=await f.call('variable_edit',f.request);assert.equal(r.status,'unknown',JSON.stringify(r));
 if(loss==='list'){assert.equal(await sha(f.s.workingPath),before);assert.equal(f.requests.filter(r=>r.command==='change').length,0);}
 const count=f.requests.length;
 await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');
 assert.equal(f.requests.length,count);
});
test('37 tools: other 36 input/output schemas unchanged; variable_edit only adds enum action',async()=>{
 const baseline=JSON.parse(await readFile(new URL('./fixtures/aggregate-member-legacy-contracts.json',import.meta.url)));
 assert.equal(Object.keys(schemas).length,37);
 for(const [name,entry] of Object.entries(baseline.tools)){
  const input=z.toJSONSchema(schemas[name]);
  if(name==='variable_edit')input.properties.action.enum=input.properties.action.enum.filter(x=>x!=='add-member-initializer');
  assert.equal(digest(JSON.stringify(input)),entry.input,name+' input');
  assert.equal(digest(JSON.stringify(z.toJSONSchema(outputSchemas[name]))),entry.output,name+' output');
 }
 const f={...action,requestId:randomUUID(),projectId:randomUUID(),applicationId:app,objectId:obj,typeObjectId:obj2,expectedTypeHash:'a'.repeat(64),expectedHash:'a'.repeat(64),expectedSnapshot:'a'.repeat(64),expectedDiskHash:'a'.repeat(64)};
 assert(schemas.variable_edit.safeParse(f).success);
 for(const bad of [{expectedOldInitializer:'FALSE'},{section:'VAR_INPUT'},{type:'BOOL'},{expectedOldType:'BOOL'},{typeObjectId:undefined},{expectedTypeHash:undefined},{memberName:undefined}])
  assert.equal(schemas.variable_edit.safeParse({...f,...bad}).success,false);
});
