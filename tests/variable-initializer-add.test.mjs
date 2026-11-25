import {beforeStructFieldInput} from './contract-projection.mjs';

import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {planVariableEdit as plan} from '../dist/variable-edit.js';
import {normalize,codeHash} from '../dist/storage.js';
import {schemas,outputSchemas} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {setup,app,obj,obj2} from './helpers.mjs';
const native='6f9dac99-8de1-4efc-8465-68ac443b7d08',st='3b83b776-fb25-43b8-99f2-3c507c9143fc';
const source='PROGRAM Main\r\nVAR\r\n // 中文😀 Delay : TIME := T#2s;\r\n Delay\r\n : TIME (* 原文 *)\r\n ; // Delay\r\n Other : TIME := T#5s;\r\nEND_VAR\r\n';
const action={action:'add-initializer',name:'Delay',initializer:'T#8s'};
const sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const execute=(s=source,a=action,kind='st_pou',name='Main')=>plan(s,kind,name,a);
for(const [type,values] of [['BOOL',['TRUE','FALSE']],['DINT',['-2147483648','2147483647','0']],['TIME',['T#0ms','T#8s','T#60000ms']]])
 for(const value of values)for(const scope of ['program','function','function_block','gvl'])test('planner '+scope+' '+type+' '+value,()=>{
  const header=scope==='gvl'?'':scope.toUpperCase()+' Main'+(scope==='function'?' : DINT':'')+'\n';
  const s=header+(scope==='gvl'?'VAR_GLOBAL':'VAR')+'\n Delay : '+type+'; Other : BOOL := FALSE;\nEND_VAR';
  const p=execute(s,{...action,initializer:value},scope==='gvl'?'gvl':scope==='function_block'?'function_block':'st_pou');
  assert.equal(p.declaration,s.replace(type+';',type+' := '+value+';'));
  assert.equal(p.range.startOffset,p.range.endOffset);assert.equal(p.before,'');
 });
test('exact insertion preserves normalized surrounding comments, multiline and astral text',()=>{
 const p=execute();const s=normalize(source);
 assert.equal(p.declaration,s.slice(0,p.range.startOffset)+p.after+s.slice(p.range.endOffset));
 assert.equal(p.after,' := T#8s');assert.match(p.declaration,/Other : TIME := T#5s/);
});
const bad=[
 ['initialized',source.replace(': TIME (*',': TIME := T#8s (*')],
 ['empty explicit',source.replace(': TIME (*',': TIME := (*')],
 ['duplicate',source.replace('Other : TIME := T#5s','delay : TIME')],
 ['shared',source.replace(' Delay\r\n',' Delay, X\r\n')],
 ['AT',source.replace(' Delay\r\n',' Delay AT %MD0\r\n')],
 ['RETAIN',source.replace('VAR\r\n','VAR RETAIN\r\n')],
 ['PERSISTENT',source.replace('VAR\r\n','VAR PERSISTENT\r\n')],
 ['duplicate block',source+'VAR\nEND_VAR'],
 ['modified duplicate',source+'VAR RETAIN\nEND_VAR'],
 ['array',source.replace(': TIME (*',': ARRAY[0..1] OF TIME (*')],
 ['alias',source.replace(': TIME (*',': TimeAlias (*')],
 ['aggregate',source.replace(': TIME (*',': ST_Config (*')],
 ['missing terminator',source.replace(' ; // Delay',' // Delay')],
 ['incomplete',source.replace('END_VAR','')],
 ['attribute',source.replace(' Delay\r\n',"{attribute 'x'} Delay\r\n")],
 ['cross scope',source+'VAR_INPUT\nDelay : TIME;\nEND_VAR'],
 ['unclosed comment',source+'(*'],
];
for(const [n,s] of bad)test('planner refuses '+n,()=>assert.throws(()=>execute(s)));
for(const a of [{section:'VAR_INPUT'},{type:'TIME'},{expectedOldInitializer:''},{expectedOldType:'TIME'},{initializer:'T#61s'},{initializer:'T#-1s'},{name:'Missing'}])
 test('planner rejects unsupported request '+JSON.stringify(a),()=>assert.throws(()=>execute(source,{...action,...a})));
test('old set initializer still rejects absent initializer',()=>assert.throws(()=>execute(source,{...action,action:'set-initializer'})));
test('comments/strings/same-name in other object do not constitute an initializer',()=>{
 const s='VAR_GLOBAL\nLabel : STRING := \'Delay : TIME := T#3s;\';\nDelay : TIME;\nEND_VAR';
 assert.equal(execute(s,action,'gvl').declaration,s.replace('\nDelay : TIME;','\nDelay : TIME := T#8s;'));
});
const objects=()=>[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],objectType:'st_pou',nativeTypeId:native,hasImplementation:true,
 pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header',embeddedObjectTypes:[st],declaration:source,implementation:'// 保留\r\n'},
 {objectId:obj2,applicationId:app,path:['设备','应用一','Other'],objectType:'st_pou',nativeTypeId:native,hasImplementation:true,pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header',embeddedObjectTypes:[st],declaration:'PROGRAM Other\nVAR\nDelay : TIME;\nEND_VAR',implementation:''}];
async function fixture(t,{rows=objects(),extra={},mode='direct',rewrite=x=>x,after=x=>x}={}){
 const e=await setup({objects:rows,...extra}),adapter=new FixtureAdapter(),requests=[];
 const config={dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000};
 const wrap={execute:async(q,...rest)=>{requests.push(structuredClone(q));return after(await adapter.execute(rewrite(q),...rest),q);},reconcile:d=>adapter.reconcile(d)};
 const service=new EngineeringService(config,wrap);t.after(()=>service.store.release());
 const call=async(n,a)=>{let x=await service.call(n,schemas[n].parse(a));while(x.status==='running')x=await service.call('operation_status',{operationId:x.operationId});return x;};
 const opened=await call(mode==='direct'?'project_open':'project_open_copy',{requestId:randomUUID(),...(mode==='direct'?{projectPath:e.source}:{sourcePath:e.source}),applicationId:app});
 assert.equal(opened.status,'succeeded');const s=opened.data.session;
 const request={...action,requestId:randomUUID(),projectId:s.projectId,applicationId:app,objectId:obj,expectedHash:codeHash(rows[0].declaration,rows[0].implementation),expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash};
 return {e,s,call,request,requests,service,config,wrap};
}
for(const mode of ['direct','copy'])for(const scope of ['pou','gvl'])test('service '+mode+' '+scope+' raw preservation and dedupe',async t=>{
 const rows=objects();if(scope==='gvl')Object.assign(rows[0],{path:['设备','应用一','Main'],objectType:'gvl',nativeTypeId:'ffbfa93a-b94d-45fc-a329-229860183b1d',hasImplementation:false,declaration:source.replace('PROGRAM Main\r\nVAR','VAR_GLOBAL'),implementation:''});
 const f=await fixture(t,{mode,rows}),before=JSON.parse(await readFile(f.s.workingPath));
 const x=await f.call('variable_edit',f.request);assert.equal(x.status,'succeeded',JSON.stringify(x));
 const final=JSON.parse(await readFile(f.s.workingPath)),at=rows[0].declaration.indexOf('; // Delay');
 assert.equal(final.objects[0].declaration,rows[0].declaration.slice(0,at)+' := T#8s'+rows[0].declaration.slice(at));
 assert.equal(final.objects[0].implementation,rows[0].implementation);assert.deepEqual(final.objects[1],before.objects[1]);
 assert.equal(x.data.initializerInsertionEvidence.afterRawHash,x.data.initializerInsertionEvidence.reopenedRawHash);
 const count=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),x);assert.equal(f.requests.length,count);
 const s=(await f.call('session_status',{})).data.session;
 const again=await f.call('variable_edit',{...f.request,requestId:randomUUID(),expectedHash:x.data.contentHash,expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash});
 assert.equal(again.status,'unsupported');assert.equal(f.requests.filter(q=>q.command==='change').length,1);
});
for(const [n,s] of bad)test('service pre-write '+n+' zero change/save',async t=>{
 const rows=objects();rows[0].declaration=s;const f=await fixture(t,{rows}),before=await sha(f.s.workingPath);
 const x=await f.call('variable_edit',f.request);assert.notEqual(x.status,'succeeded');
 assert.equal(await sha(f.s.workingPath),before);assert.equal(f.requests.filter(q=>['change','save'].includes(q.command)).length,0);
});
for(const mutation of [{expectedHash:'0'.repeat(64)},{expectedSnapshot:'0'.repeat(64)},{expectedDiskHash:'0'.repeat(64)}])
 test('version refusal '+JSON.stringify(mutation),async t=>{
 const f=await fixture(t),before=await sha(f.s.workingPath);assert.equal((await f.call('variable_edit',{...f.request,...mutation})).status,'conflict');
 assert.equal(await sha(f.s.workingPath),before);assert.equal(f.requests.filter(q=>q.command==='change').length,0);
 });
for(const change of ['missing-ST','non-ST','ST-error','native-type','app-path'])test('native identity refusal '+change,async t=>{
 const rows=objects();if(change==='missing-ST')delete rows[0].embeddedObjectTypes;if(change==='non-ST')rows[0].embeddedObjectTypes=[];
 if(change==='ST-error')rows[0].embeddedObjectTypesError='read failed';if(change==='native-type')rows[0].nativeTypeId='0'.repeat(36);if(change==='app-path')rows[0].path=['another','Main'];
 const f=await fixture(t,{rows}),before=await sha(f.s.workingPath);assert.notEqual((await f.call('variable_edit',f.request)).status,'succeeded');
 assert.equal(await sha(f.s.workingPath),before);assert.equal(f.requests.filter(q=>q.command==='change').length,0);
});
test('external disk and same-handle native target guard are refused',async t=>{
 const f=await fixture(t);await writeFile(f.s.workingPath,(await readFile(f.s.workingPath,'utf8'))+' ');const before=await sha(f.s.workingPath);
 assert.equal((await f.call('variable_edit',f.request)).status,'conflict');assert.equal(await sha(f.s.workingPath),before);
 const g=await fixture(t,{rewrite:q=>q.command==='change'?{...q,args:{...q.args,initializerTargetGuard:{...q.args.initializerTargetGuard,nativeTypeId:'different'}}}:q});
 const old=await sha(g.s.workingPath);assert.equal((await g.call('variable_edit',g.request)).status,'conflict');assert.equal(await sha(g.s.workingPath),old);
});
for(const mode of ['direct','copy'])test('partial write freezes and never replay/rollback '+mode,async t=>{
 const f=await fixture(t,{mode,extra:{failImplementation:true}});const x=await f.call('variable_edit',f.request);assert.equal(x.status,'unknown');
 const count=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),x);
 await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');assert.equal(f.requests.length,count);
 await f.service.store.release();const restarted=new EngineeringService(f.config,f.wrap);t.after(()=>restarted.store.release());
 assert.equal((await restarted.call('operation_status',{operationId:x.operationId,reconcile:true})).status,'unknown');assert.equal(f.requests.length,count);
});
for(const loss of ['insertion','identity','raw-implementation','declaration'])test('post-write '+loss+' evidence missing freezes',async t=>{
 const f=await fixture(t,{after:(x,q)=>{
  if(q.command!=='change'||x.status!=='succeeded')return x;
  const d={...x.data};if(loss==='insertion')delete d.initializerInsertionEvidence;if(loss==='identity')delete d.initializerTargetReadback;
  if(loss==='raw-implementation')d.initializerInsertionEvidence={...d.initializerInsertionEvidence,reopenedImplementationRawHash:'0'.repeat(64)};
  if(loss==='declaration')d.declaration+='// changed';return {...x,data:d};
 }});
 const x=await f.call('variable_edit',f.request);assert.equal(x.status,'unknown',JSON.stringify(x));
 const n=f.requests.length;await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');assert.equal(f.requests.length,n);
});
test('historical initializer contract projection retains old rules',async()=>{
 const baseline=JSON.parse(await readFile(new URL('./fixtures/variable-initializer-add-legacy-contracts.json',import.meta.url)));
 for(const [name,b] of Object.entries(baseline)){
  const input=beforeStructFieldInput(name,z.toJSONSchema(schemas[name]));if(name==='variable_edit')input.properties.action.enum=input.properties.action.enum.filter(x=>x!=='add-initializer');
  assert.deepEqual(input,b.input,name);assert.deepEqual(z.toJSONSchema(outputSchemas[name]),b.output,name);
 }
 assert.equal(Object.keys(schemas).length,38);
 const q={...action,requestId:randomUUID(),projectId:randomUUID(),applicationId:app,objectId:obj,expectedHash:'a'.repeat(64),expectedSnapshot:'a'.repeat(64),expectedDiskHash:'a'.repeat(64)};
 assert(schemas.variable_edit.safeParse(q).success);
 for(const x of [{type:'TIME'},{expectedOldInitializer:''},{memberName:'X'},{typeObjectId:obj2}])assert(!schemas.variable_edit.safeParse({...q,...x}).success);
});

test('candidate package and initialize version match', async () => {
 const { VERSION } = await import('../dist/contracts.js');
 const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
 assert.equal(VERSION, pkg.version);
 assert.equal(VERSION, '0.39.0');
});
