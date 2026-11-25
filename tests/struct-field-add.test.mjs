import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {planStructField,applyStructInsertion,structStateView,STRUCT_NATIVE} from '../dist/struct-field.js';
import {normalize,codeHash,canonical,digest} from '../dist/storage.js';import {schemas} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {setup,app,obj,obj2} from './helpers.mjs';
const source='TYPE ST_Config :\r\nSTRUCT\r\n    (* 中文😀 新字段不是这里 *)\r\n    Count : DINT := 7; // comment\r\n    Delay : TIME := T#5s;\r\nEND_STRUCT\r\nEND_TYPE\r\n';
const edit={action:'add-struct-field',name:'Enable',type:'BOOL'};
const plan=(s=source,a=edit)=>planStructField(s,'ST_Config',a);
for(const type of ['BOOL','DINT','TIME'])for(const s of [source,source.replaceAll('\r\n','\n'),'TYPE ST_Config : STRUCT Count : DINT; END_STRUCT END_TYPE'])test('planner minimal '+type+' '+s.length,()=>{
 const p=plan(s,{...edit,type}),raw=applyStructInsertion(s,p.declaration,{...p.range,text:p.after});
 assert.equal(normalize(raw),p.declaration);assert.equal(p.before,'');assert.equal(p.range.startOffset,p.range.endOffset);
 assert.equal(p.declaration,normalize(s).slice(0,p.range.startOffset)+p.after+normalize(s).slice(p.range.endOffset));
 assert.match(raw,new RegExp('Enable : '+type+';'));if(s.includes('\r\n'))assert.equal(raw.replaceAll('\r\n','').includes('\n'),false);
});
const invalidSources=[
 ['empty','TYPE ST_Config : STRUCT END_STRUCT END_TYPE'],['incomplete',source.replace('END_STRUCT','')],
 ['name exists',source.replace('Count : DINT','Enable : DINT')],['case duplicate',source.replace('Delay : TIME','count : TIME')],
 ['shared',source.replace('Count :','Count, N :')],['array',source.replace('Count : DINT','Count : ARRAY[0..2] OF DINT')],
 ['nested',source.replace('Count : DINT','Count : ST_Other')],['union',source.replace('STRUCT','UNION')],
 ['AT',source.replace('Count :','Count AT %MD0 :')],['attribute',"{attribute 'qualified_only'}\n"+source],
 ['comment',source+'(*'],['string',source.replace(':= 7',":= 'END_STRUCT'")],
 ['type unknown',source.replace('Count : DINT','Count : INT')],['time above range',source.replace('T#5s','T#61s')],
 ['DINT overflow',source.replace(':= 7',':= 2147483648')],['missing delimiter',source.replace('7;','7')],
 ['extra declaration',source+'VAR\nX : DINT;\nEND_VAR'],['empty initializer',source.replace(':= 7',':= ')],
];
for(const [n,s] of invalidSources)test('planner rejects '+n,()=>assert.throws(()=>plan(s)));
for(const a of [{name:'count'},{name:'st_config'},{name:'IF'},{name:'__Internal'},{name:'AND'},{name:'BOOL_TO_DINT'},
 {type:'INT'},{initializer:'TRUE'},{section:'VAR'},{memberName:'X'},{typeObjectId:obj},{expectedOldInitializer:'0'}])test('request guard '+JSON.stringify(a),()=>assert.throws(()=>plan(source,{...edit,...a})));
const rows=()=>[{objectId:obj,applicationId:app,path:['设备','应用一','ST_Config'],objectType:'structure',nativeTypeId:STRUCT_NATIVE,hasImplementation:false,declaration:source,implementation:''},
 {objectId:obj2,applicationId:app,path:['设备','应用一','Main'],objectType:'st_pou',nativeTypeId:'6f9dac99-8de1-4efc-8465-68ac443b7d08',hasImplementation:true,pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header',embeddedObjectTypes:['3b83b776-fb25-43b8-99f2-3c507c9143fc'],declaration:'PROGRAM Main\r\nVAR\r\n Config : ST_Config := (Count := 3);\r\nEND_VAR\r\n',implementation:'// ST_Config Enable unchanged\r\n'}];
const tasks=()=>[{applicationId:app,taskId:'40000000-0000-4000-8000-000000000001',path:['设备','应用一','Task Configuration','MainTask'],rawFields:{kind_of_task:'Cyclic',priority:'1',interval:'t#20ms',interval_unit:'ms',event_pou_guid:'',event:'',external_event:'',core_binding:'-2',parent_synchron_task:''},watchdog:{enabled:'False',time:'',time_unit:'ms',sensitivity:'1'},callsComplete:true,unavailableFields:[],rawCalls:[['Main','中文'],['Main','None'],['Main','']]}];
async function fixture(t,{mode='direct',objects=rows(),extra={},rewrite=x=>x,after=x=>x}={}){
 const e=await setup({objects,tasks:tasks(),...extra}),adapter=new FixtureAdapter(),requests=[];
 const config={dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000};
 const wrap={execute:async(q,...rest)=>{requests.push(structuredClone(q));return after(await adapter.execute(rewrite(q),...rest),q);},reconcile:d=>adapter.reconcile(d)};
 const service=new EngineeringService(config,wrap);t.after(()=>service.store.release());
 const call=async(n,a)=>{let x=await service.call(n,schemas[n].parse(a));while(x.status==='running')x=await service.call('operation_status',{operationId:x.operationId});return x;};
 const opened=await call(mode==='direct'?'project_open':'project_open_copy',{requestId:randomUUID(),...(mode==='direct'?{projectPath:e.source}:{sourcePath:e.source}),applicationId:app});
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));const s=opened.data.session;
 const request={...edit,requestId:randomUUID(),projectId:s.projectId,applicationId:app,objectId:obj,expectedHash:codeHash(objects[0].declaration,''),expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash};
 return {e,s,service,call,request,requests,config,wrap};
}
for(const mode of ['direct','copy'])for(const type of ['BOOL','DINT','TIME'])test('service '+mode+' '+type+' preserves all other raw source/tasks and dedupes',async t=>{
 const f=await fixture(t,{mode});f.request.type=type;
 const before=JSON.parse(await readFile(f.s.workingPath));const r=await f.call('variable_edit',f.request);assert.equal(r.status,'succeeded',JSON.stringify(r));
 const final=JSON.parse(await readFile(f.s.workingPath));const expected=structuredClone(before),p=plan(source,f.request);expected.objects[0].declaration=applyStructInsertion(source,p.declaration,{...p.range,text:p.after});
 assert.deepEqual(final,expected);assert.deepEqual(r.data.structFieldEvidence.before.sources[1],r.data.structFieldEvidence.reopened.sources[1]);
 const calls=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),r);assert.equal(f.requests.length,calls);
 assert.equal(f.requests.filter(x=>x.command==='change').length,1);
});
for(const [n,s] of invalidSources)test('service pre-write rejects '+n+' without mutation/save',async t=>{
 const objects=rows();objects[0].declaration=s;const f=await fixture(t,{objects}),before=await readFile(f.s.workingPath);
 const r=await f.call('variable_edit',f.request);assert.notEqual(r.status,'succeeded');assert.deepEqual(await readFile(f.s.workingPath),before);
 assert.equal(f.requests.filter(x=>['change','save'].includes(x.command)).length,0);
});
for(const field of ['expectedHash','expectedSnapshot','expectedDiskHash'])test('pre-write stale '+field,async t=>{
 const f=await fixture(t);f.request[field]='0'.repeat(64);const before=await readFile(f.s.workingPath);
 assert.equal((await f.call('variable_edit',f.request)).status,'conflict');assert.deepEqual(await readFile(f.s.workingPath),before);assert.equal(f.requests.filter(x=>x.command==='change').length,0);
});
for(const mode of ['direct','copy'])test('partial failure '+mode+' remains unknown without reverse writes and is deduped/frozen',async t=>{
 const f=await fixture(t,{mode,extra:{failImplementation:true}});const r=await f.call('variable_edit',f.request);assert.equal(r.status,'unknown',JSON.stringify(r));
 assert.match(JSON.parse(await readFile(f.s.workingPath)).objects[0].declaration,/Enable : BOOL/);
 const count=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),r);assert.equal(f.requests.length,count);
 await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');assert.equal(f.requests.length,count);
});
const changes={
 'missing evidence':d=>delete d.structFieldEvidence,
 'task call order':d=>d.structFieldEvidence.reopened.tasks.tasks[0].rawCalls.reverse(),
 'task comment':d=>d.structFieldEvidence.immediate.tasks.tasks[0].rawCalls[0][1]='',
 'source changed':d=>d.structFieldEvidence.reopened.sources[1].declaration+=' ',
 'ST identity':d=>d.structFieldEvidence.immediate.sources[1].embeddedObjectTypes=[],
 'missing source':d=>d.structFieldEvidence.reopened.sources.pop(),
 'duplicate source':d=>d.structFieldEvidence.reopened.sources.push(d.structFieldEvidence.reopened.sources[0]),
 'target parent':d=>d.structFieldEvidence.immediate.target.parentId=obj2,
 'coverage':d=>d.structFieldEvidence.reopened.complete=false,
 'task coverage':d=>d.structFieldEvidence.reopened.tasks.coverageComplete=false,
 'unknown field':d=>d.structFieldEvidence.reopened.sources[0].unknown='changed',
 'raw evidence':d=>d.structFieldInsertionEvidence.preservedRawSurroundings=false,
};
for(const [name,mutate] of Object.entries(changes))test('service independent result rejects '+name,async t=>{
 const f=await fixture(t,{after:(r,q)=>{if(q.command==='change'&&r.status==='succeeded')mutate(r.data);return r;}});
 const r=await f.call('variable_edit',f.request);assert.equal(r.status,'unknown',JSON.stringify(r));const count=f.requests.length;
 await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');assert.equal(f.requests.length,count);
});
test('source directory and task set enumeration change does not change preservation',async t=>{
 const f=await fixture(t,{after:(r,q)=>{if(q.command==='change'){r.data.structFieldEvidence.immediate.sources.reverse();r.data.structFieldEvidence.reopened.sources.reverse();}return r;}});
 assert.equal((await f.call('variable_edit',f.request)).status,'succeeded');
});
test('new schema accepts only field action without initializer; old actions still require initializer',()=>{
 const base={requestId:randomUUID(),projectId:app,applicationId:app,objectId:obj,expectedHash:'a'.repeat(64),expectedSnapshot:'a'.repeat(64),expectedDiskHash:'a'.repeat(64),...edit};
 assert.equal(schemas.variable_edit.safeParse(base).success,true);assert.equal(schemas.variable_edit.safeParse({...base,initializer:'TRUE'}).success,false);
 for(const action of ['add','set-initializer','set-member-initializer','set-type','add-member-initializer','add-initializer'])assert.equal(schemas.variable_edit.safeParse({...base,action}).success,false);
});

const sha=async p=>digest(await readFile(p));
// Combined production service/adapter path. All process and file operations below
// target synthetic fixture files; no real IDE or archived project is opened.
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {IdeAdapter} from '../dist/adapter.js';
import {atomicJson,readJson} from '../dist/storage.js';
import {processObservations,normalCloseDouble} from './process-double.mjs';
for(const mode of ['direct','copy'])for(const failure of ['none','preflight-close','write-close','write-missing-receipt'])
test('structure field and production exit guard '+mode+' '+failure,async t=>{
 const f=await fixture(t,{mode});await f.service.store.release();
 const nativeFixture=new FixtureAdapter(),commands=[];let kills=0;
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:3000,noUI:false},(exe,args,options)=>{
  const child=new EventEmitter();child.pid=12345;child.kill=()=>kills++;
  setTimeout(async()=>{try{
   const request=await readJson(options.env.INOPRO_BRIDGE_REQUEST),dir=path.dirname(options.env.INOPRO_BRIDGE_REQUEST);
   commands.push(request.command);
   const result=await nativeFixture.execute(request,path.join(f.e.dir,'native-fixture-'+commands.length),async()=>{});
   await atomicJson(path.join(dir,'dispatched.json'),{operationId:request.operationId,pid:12345});
   await atomicJson(path.join(dir,'result.json'),result);await normalCloseDouble(dir);
   if((failure==='preflight-close'&&request.command==='read')||(failure==='write-close'&&request.command==='change'))
    await atomicJson(path.join(dir,'normal-close-failed.json'),{firstError:{message:'original public close failure'}});
   if(failure==='write-missing-receipt'&&request.command==='change')await (await import('node:fs/promises')).unlink(path.join(dir,'normal-close-returned.json'));
   child.emit('exit',0,null);
  }catch(e){child.emit('error',e);}},30);return child;
 },processObservations);
 const service=new EngineeringService({...f.config,responseWaitMs:5000},adapter);t.after(()=>service.store.release());
 const before=await sha(f.s.workingPath),r=await service.call('variable_edit',schemas.variable_edit.parse(f.request));
 if(failure==='none'){
  assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.structFieldEvidence.reopened.sources.length,2);
  assert.equal(commands.filter(x=>x==='change').length,1);assert.notEqual(await sha(f.s.workingPath),before);
 }else{
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,failure==='write-missing-receipt'?'NORMAL_CLOSE_EVIDENCE_MISSING':'NORMAL_CLOSE_FAILED');
  if(failure!=='write-missing-receipt')assert.equal(r.data.normalCloseEvidence.firstFailure.firstError.message,'original public close failure');
  assert.equal(commands.filter(x=>x==='change').length,failure==='preflight-close'?0:1);
  if(failure==='preflight-close')assert.equal(await sha(f.s.workingPath),before);
  const after=await sha(f.s.workingPath),count=commands.length;
  assert.equal((await service.call('variable_edit',schemas.variable_edit.parse(f.request))).operationId,r.operationId);
  await assert.rejects(()=>service.call('variable_edit',schemas.variable_edit.parse({...f.request,requestId:randomUUID()})),e=>e.code==='PENDING_UNKNOWN');
  await service.store.release();const restarted=new EngineeringService(f.config,new IdeAdapter({}));t.after(()=>restarted.store.release());
  assert.equal((await restarted.call('operation_status',{operationId:r.operationId,reconcile:true})).status,'unknown');
  assert.equal(commands.length,count);assert.equal(await sha(f.s.workingPath),after);
 }
 assert.equal(commands.filter(x=>x==='save').length,0);assert.equal(kills,0);
});

// These are separate guarantees: old 37 inputs unchanged; all 38 outputs unchanged.
import {z} from 'zod';import {outputSchemas} from '../dist/contracts.js';
import {beforeStructFieldInput} from './contract-projection.mjs';
test('0.39 additive input action and conditional initializer; old 37 inputs and 38 outputs compatible',async()=>{
 const baseline=JSON.parse(await readFile(new URL('./fixtures/struct-field-0380-contracts.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(schemas).length,38);
 for(const [name,b] of Object.entries(baseline)){
  assert.deepEqual(beforeStructFieldInput(name,z.toJSONSchema(schemas[name])),b.input,name+' input');
  assert.deepEqual(z.toJSONSchema(outputSchemas[name]),b.output,name+' output');
 }
});
