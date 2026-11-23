
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {planVariableEdit as plan} from '../dist/variable-edit.js';
import {normalize,codeHash,canonical,digest} from '../dist/storage.js';
import {schemas,outputSchemas} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {setup,app,obj,obj2} from './helpers.mjs';
const native='6f9dac99-8de1-4efc-8465-68ac443b7d08',st='3b83b776-fb25-43b8-99f2-3c507c9143fc';
const source='FUNCTION_BLOCK Main\r\nVAR_INPUT\r\n // 中文😀 Delay : TIME := T#2s;\r\n Delay\r\n : TIME (* 原文 *)\r\n ; // Delay\r\n Other : TIME := T#5s;\r\nEND_VAR\r\n';
const action={action:'add-initializer',section:'VAR_INPUT',name:'Delay',initializer:'T#8s'};
const sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const execute=(s=source,a=action,kind='function_block',name='Main')=>plan(s,kind,name,a);
for(const section of ['VAR_INPUT','VAR_OUTPUT'])for(const [type,values] of [['BOOL',['TRUE','FALSE']],['DINT',['-2147483648','2147483647','0']],['TIME',['T#0ms','T#8s','T#60000ms']]])
 for(const value of values)test('interface planner '+section+' '+type+' '+value,()=>{
 const s='FUNCTION_BLOCK Main\n'+section+'\n Delay : '+type+'; Other : BOOL := FALSE;\nEND_VAR';
 const p=execute(s,{...action,section,initializer:value});assert.equal(p.declaration,s.replace(type+';',type+' := '+value+';'));
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
 ['RETAIN',source.replace('VAR_INPUT\r\n','VAR RETAIN\r\n')],
 ['PERSISTENT',source.replace('VAR_INPUT\r\n','VAR PERSISTENT\r\n')],
 ['duplicate block',source+'VAR_INPUT\nEND_VAR'],
 ['modified duplicate',source+'VAR_INPUT RETAIN\nEND_VAR'],
 ['array',source.replace(': TIME (*',': ARRAY[0..1] OF TIME (*')],
 ['alias',source.replace(': TIME (*',': TimeAlias (*')],
 ['aggregate',source.replace(': TIME (*',': ST_Config (*')],
 ['missing terminator',source.replace(' ; // Delay',' // Delay')],
 ['incomplete',source.replace('END_VAR','')],
 ['attribute',source.replace(' Delay\r\n',"{attribute 'x'} Delay\r\n")],
 ['cross scope',source+'VAR_OUTPUT\nDelay : TIME;\nEND_VAR'],
 ['unclosed comment',source+'(*'],
];
for(const [n,s] of bad)test('planner refuses '+n,()=>assert.throws(()=>execute(s)));
for(const a of [{section:'VAR_IN_OUT'},{type:'TIME'},{expectedOldInitializer:''},{expectedOldType:'TIME'},{initializer:'T#61s'},{initializer:'T#-1s'},{name:'Missing'}])
 test('planner rejects unsupported request '+JSON.stringify(a),()=>assert.throws(()=>execute(source,{...action,...a})));
test('old set initializer still rejects absent initializer',()=>assert.throws(()=>execute(source,{...action,action:'set-initializer'})));
test('comments/strings/same-name in other object do not constitute an initializer',()=>{
 const s='VAR_GLOBAL\nLabel : STRING := \'Delay : TIME := T#3s;\';\nDelay : TIME;\nEND_VAR';
 assert.equal(execute(s,{...action,section:undefined},'gvl').declaration,s.replace('\nDelay : TIME;','\nDelay : TIME := T#8s;'));
});
const objects=()=>[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],objectType:'function_block',nativeTypeId:native,hasImplementation:true,
 pouType:'function_block',pouTypeSource:'native-pou-type-id-and-declaration-header',embeddedObjectTypes:[st],declaration:source,implementation:'// 保留\r\n'},
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
for(const mode of ['direct','copy'])for(const section of ['VAR_INPUT','VAR_OUTPUT'])test('service interface '+mode+' '+section+' preservation and dedupe',async t=>{
 const rows=objects();rows[0].declaration=rows[0].declaration.replace('VAR_INPUT',section);
 const f=await fixture(t,{mode,rows}),before=JSON.parse(await readFile(f.s.workingPath));f.request.section=section;
 const x=await f.call('variable_edit',f.request);assert.equal(x.status,'succeeded',JSON.stringify(x));
 const final=JSON.parse(await readFile(f.s.workingPath)),at=rows[0].declaration.indexOf('; // Delay');
 assert.equal(final.objects[0].declaration,rows[0].declaration.slice(0,at)+' := T#8s'+rows[0].declaration.slice(at));
 assert.equal(final.objects[0].implementation,rows[0].implementation);assert.deepEqual(final.objects.slice(1),before.objects.slice(1));
 assert.equal(x.data.initializerInsertionEvidence.afterRawHash,x.data.initializerInsertionEvidence.reopenedRawHash);
 const count=f.requests.length;assert.deepEqual(await f.call('variable_edit',f.request),x);assert.equal(f.requests.length,count);
 const now=(await f.call('session_status',{})).data.session;
 const again=await f.call('variable_edit',{...f.request,requestId:randomUUID(),expectedHash:x.data.contentHash,expectedSnapshot:now.snapshot,expectedDiskHash:now.diskHash});
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

const methodId='30000000-0000-4000-8000-000000000001';
function withMethod(){const rows=objects();rows.push({objectId:methodId,applicationId:app,parentId:obj,parentPath:rows[0].path,path:[...rows[0].path,'ReadCount'],objectType:'method',nativeTypeId:'f8a58466-d7f6-439f-bbb8-d4600e41d099',embeddedObjectTypes:[st],hasImplementation:true,declaration:'METHOD PUBLIC ReadCount : DINT\r\nVAR\r\nEND_VAR',implementation:'ReadCount := 7;',access:'PUBLIC',methodReturnType:'DINT',methodMetadataSource:'native-method-type-parent-and-declaration-header'});return rows;}
test('interface subtree source retained through production service evidence',async t=>{
 const rows=withMethod(),f=await fixture(t,{rows});const r=await f.call('variable_edit',f.request);assert.equal(r.status,'succeeded',JSON.stringify(r));
 const e=r.data.initializerTargetReadback;assert.equal(e.before.interfaceChildren.rows.length,1);assert.deepEqual(e.before,e.reopened);
 assert.equal(e.before.interfaceChildren.rows[0].implementation,'ReadCount := 7;');
});
for(const kind of ['missing','duplicate','parent','source','complete','field','type'])test('interface child evidence rejects '+kind,async t=>{
 const rows=withMethod();const f=await fixture(t,{rows,after:(x,q)=>{
 if(q.command!=='read'||!x.data?.initializerTargetEvidence)return x;
 const e=x.data.initializerTargetEvidence.interfaceChildren,r=e.rows[0];
 if(kind==='missing')delete x.data.initializerTargetEvidence.interfaceChildren;
 if(kind==='duplicate')e.rows.push({...r});if(kind==='parent')r.parentId=obj2;
 if(kind==='source')r.declaration=null;if(kind==='complete')e.complete=false;
 if(kind==='field')delete r.implementationRawHash;if(kind==='type')r.objectType='unknown';return x;
 }});const old=await sha(f.s.workingPath);const r=await f.call('variable_edit',f.request);assert.notEqual(r.status,'succeeded');assert.equal(await sha(f.s.workingPath),old);assert.equal(f.requests.filter(q=>q.command==='change').length,0);
});
for(const stage of ['immediate','reopened'])test('interface child post-write '+stage+' difference freezes',async t=>{
 const f=await fixture(t,{rows:withMethod(),after:(x,q)=>{if(q.command==='change'&&x.status==='succeeded'){x.data.initializerTargetReadback=structuredClone(x.data.initializerTargetReadback);x.data.initializerTargetReadback[stage].interfaceChildren.rows[0].implementation+=' changed';}return x;}});
 const r=await f.call('variable_edit',f.request);assert.equal(r.status,'unknown');await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');
});
for(const kind of ['st_pou','gvl','method','property'])test('explicit interface rejects non-FB '+kind,async t=>{const rows=objects();rows[0].objectType=kind;const f=await fixture(t,{rows});const old=await sha(f.s.workingPath);assert.notEqual((await f.call('variable_edit',f.request)).status,'succeeded');assert.equal(await sha(f.s.workingPath),old);assert.equal(f.requests.filter(q=>q.command==='change').length,0);});

function withProperty(){
 const rows=withMethod(),pid=randomUUID(),ids=[randomUUID(),randomUUID()],path=[...rows[0].path,'Value'];
 const accessors=ids.map((id,i)=>({objectId:id,parentId:pid,nativeTypeId:'792f2eb6-721e-4e64-ba20-bc98351056db',name:['Get','Set'][i],hasDeclaration:true,hasImplementation:true,embeddedObjectTypes:[st],childIds:[]})).sort((a,b)=>a.objectId.localeCompare(b.objectId));
 const structure={scheme:'fb-property-accessors-v2',propertyId:pid,accessors,readOnly:false};
 const declaration='PROPERTY PUBLIC Value : DINT',propHash=codeHash(declaration,'');
 const common={applicationId:app,fbId:obj,propertyId:pid,propertyPath:path,propertyName:'Value',propertyType:'DINT',access:'PUBLIC',readOnly:false,accessorStructure:structure,accessorVersion:digest(canonical(structure)),propertyContentHash:propHash,propertyMetadataSource:'native-property-accessor-tree-and-declaration'};
 rows.push({...common,objectId:pid,parentId:obj,parentPath:rows[0].path,path,objectType:'property',nativeTypeId:'5a3b8626-d3e9-4f37-98b5-66420063d91e',hasImplementation:false,declaration,implementation:'',embeddedObjectTypes:[]});
 for(const r of accessors)rows.push({...common,objectId:r.objectId,parentId:pid,parentPath:path,path:[...path,r.name],objectType:r.name==='Get'?'property_get':'property_set',nativeTypeId:r.nativeTypeId,hasImplementation:true,declaration:'VAR\nEND_VAR',implementation:r.name==='Get'?'Value := 7;':'// keep',embeddedObjectTypes:[st]});
 return rows;
}
test('service preserves complete Method/Property/Get/Set subtree',async t=>{const f=await fixture(t,{rows:withProperty()});const r=await f.call('variable_edit',f.request);assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.initializerTargetReadback.before.interfaceChildren.rows.length,4);});
for(const kind of ['method-under-method','accessor-under-fb','duplicate-get','wrong-native','property-coverage','child-case-id'])test('service refuses subtree structure '+kind,async t=>{
 const f=await fixture(t,{rows:withProperty(),after:(x,q)=>{
 if(q.command!=='read'||!x.data?.initializerTargetEvidence)return x;
 const rows=x.data.initializerTargetEvidence.interfaceChildren.rows,m=rows.find(x=>x.objectType==='method'),g=rows.find(x=>x.objectType==='property_get'),p=rows.find(x=>x.objectType==='property');
 if(kind==='method-under-method'){const n={...m,objectId:randomUUID(),parentId:m.objectId,parentPath:m.path,path:[...m.path,'Other']};rows.push(n);}
 if(kind==='accessor-under-fb'){g.parentId=obj;g.parentPath=x.data.path;g.path=[...x.data.path,'Get'];}
 if(kind==='duplicate-get'){rows.push({...g,objectId:randomUUID()});}
 if(kind==='wrong-native')m.nativeTypeId=obj2;
 if(kind==='property-coverage')rows.splice(rows.indexOf(g),1);
 if(kind==='child-case-id')rows.push({...g,objectId:g.objectId.toUpperCase()});return x;
 }});const old=await sha(f.s.workingPath);const r=await f.call('variable_edit',f.request);assert.notEqual(r.status,'succeeded');assert.equal(await sha(f.s.workingPath),old);assert.equal(f.requests.filter(q=>['change','save'].includes(q.command)).length,0);
});

test('38 tool schemas unchanged; only explicit FB section refinement extended',async()=>{
 const b=JSON.parse(await readFile(new URL('./fixtures/fb-interface-initializer-legacy-contracts.json',import.meta.url)));const h=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 assert.equal(Object.keys(schemas).length,38);for(const [n,x] of Object.entries(b.tools)){assert.equal(h(z.toJSONSchema(schemas[n])),x.input,n);assert.equal(h(z.toJSONSchema(outputSchemas[n])),x.output,n);}
 const q={...action,requestId:randomUUID(),projectId:randomUUID(),applicationId:app,objectId:obj,expectedHash:'a'.repeat(64),expectedSnapshot:'a'.repeat(64),expectedDiskHash:'a'.repeat(64)};
 for(const section of ['VAR_INPUT','VAR_OUTPUT',undefined])assert(schemas.variable_edit.safeParse({...q,section}).success);
 for(const patch of [{type:'TIME'},{expectedOldInitializer:''},{section:'VAR_IN_OUT'},{memberName:'X'},{action:'set-type',type:'TIME',expectedOldType:'DINT',expectedOldInitializer:'1'}])assert(!schemas.variable_edit.safeParse({...q,...patch}).success);
});

for(const section of ['VAR_INPUT','VAR_OUTPUT'])for(const modifier of ['RETAIN','PERSISTENT','CONSTANT',"{attribute 'x'}"])
 test('interface initializer refuses modified selected block '+section+' '+modifier,()=>{
 const s='FUNCTION_BLOCK Main\n'+section+' '+modifier+'\n Delay : TIME;\nEND_VAR';
 assert.throws(()=>execute(s,{...action,section}));
 });
for(const section of ['VAR_INPUT','VAR_OUTPUT'])test('interface initializer counts empty duplicate modified blocks '+section,()=>{
 for(const modifier of ['', ' RETAIN',' PERSISTENT'])assert.throws(()=>execute('FUNCTION_BLOCK Main\n'+section+'\n Delay : TIME;\nEND_VAR\n'+section+modifier+'\nEND_VAR',{...action,section}));
});
