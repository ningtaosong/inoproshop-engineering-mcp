import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {z} from 'zod';import {schemas,outputSchemas,declarationMatches} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {compareReply} from '../dist/comparison.js';
import {digest,canonical} from '../dist/storage.js';
import {setup,connect,app,app2,obj} from './helpers.mjs';import {withoutEnumExtension} from './contract-compatibility.mjs';
const declaration='TYPE E_State :\n(\n Idle := 0,\n Running := 1,\n Fault := 2\n);\nEND_TYPE\n';
const target=s=>({projectId:s.projectId,applicationId:app});
const create=(s,snapshot)=>({...target(s),requestId:'enum-create',parentId:app,expectedSnapshot:snapshot,name:'E_State',objectType:'enum',declaration});
const bounds='TYPE E_State : (Low := -32768, High := 32767); END_TYPE';
const invalid=[declaration.replace('TYPE E_State','TYPE Other'),declaration.replace('Running := 1','idle := 1'),declaration.replace('Running := 1','Running := 0'),declaration.replace('Running := 1','Running'),declaration.replace('2','32768'),bounds.replace('-32768','-32769'),declaration.replace('1','1 + 0'),declaration.replace('1','INT#1'),declaration.replace('1','16#1'),declaration.replace(');',') DINT;'),declaration.replace('E_State :','E_State EXTENDS Base :'),"{attribute 'strict'}\n"+declaration,'TYPE E_State : (); END_TYPE','TYPE E_State : ARRAY[0..1] OF INT; END_TYPE','TYPE E_State : INT; END_TYPE'];

test('十九工具和旧Schema兼容，仅允许声明对象类型枚举的加法扩展',async()=>{
 const old=JSON.parse(await readFile('tests/fixtures/enum-legacy-contracts.json','utf8'));
 assert.equal(Object.keys(schemas).length,20);assert.equal(old.toolCount,19);
 for(const t of old.tools){assert.deepEqual(withoutEnumExtension(z.toJSONSchema(schemas[t.name],{io:'input'})),t.inputSchema,t.name+' input');assert.deepEqual(withoutEnumExtension(z.toJSONSchema(outputSchemas[t.name])),t.outputSchema,t.name+' output');}
 const a={requestId:'x',projectId:app,applicationId:app,parentId:app,expectedSnapshot:'a'.repeat(64),name:'E_State',objectType:'enum',declaration};
 assert(schemas.declaration_create.safeParse(a).success);
 for(const extra of [{baseType:'INT'},{members:[]},{implementation:''},{objectType:'alias'}])assert.equal(schemas.declaration_create.safeParse({...a,...extra}).success,false);
});

test('枚举窄语法、重复成员和值、十进制边界、属性/基类型拒绝在原生派发前完成',async()=>{
 assert(declarationMatches('enum','e_state',bounds,true));assert(!declarationMatches('structure','E_State',declaration));
 assert(declarationMatches('enum','E_State',"{attribute 'strict'}\n"+declaration));
 const env=await setup(),fixture=new FixtureAdapter();let nativeCreates=0;
 const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},{reconcile:d=>fixture.reconcile(d),execute:async(...a)=>{if(a[0].command==='create_declaration')nativeCreates++;return fixture.execute(...a);}});
 try{const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});
  for(const [i,text] of invalid.entries()){assert(!declarationMatches('enum','E_State',text,true),text);const r=await service.call('declaration_create',{...create(opened.data.session,opened.data.snapshot),requestId:'invalid-'+i,declaration:text});assert.equal(r.error.code,'INVALID_DECLARATION',JSON.stringify(r));}
  assert.equal(nativeCreates,0);assert.equal((await service.status()).data.writeFrozen,false);
 }finally{await service.store.release();}
});

test('枚举创建/读回/保存重开、去重、同名/过期拒绝，并进入列表/搜索和前后比较',async t=>{
 const e=await setup(),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app})),s=opened.data.session,a=target(s);
 const baseline=await c.done(await c.call('project_compare',{...a,mode:'capture',origin:'working-copy',requestId:'before'}));assert.equal(baseline.status,'succeeded');
 const args=create(s,opened.data.snapshot),[one,two]=await Promise.all([c.call('declaration_create',args),c.call('declaration_create',args)]);assert.equal(one.operationId,two.operationId);
 const created=await c.done(one);assert.equal(created.status,'succeeded',JSON.stringify(created));assert.equal(created.data.objectType,'enum');assert.equal(created.data.hasImplementation,false);assert.equal(created.data.nativeTypeId,'2db5746d-d284-4425-9f7f-2663a34b0ebc');assert.equal(created.data.declaration,declaration);assert(created.data.reopened);
 const id=created.data.objectId;const read=await c.done(await c.call('object_read',{...a,objectId:id}));assert.equal(read.data.declaration,declaration);assert.equal(read.data.implementation,'');
 const list=await c.done(await c.call('object_list',a));assert.equal(list.data.objects.find(o=>o.objectId===id).objectType,'enum');
 const search=await c.done(await c.call('project_search',{...a,query:'Running',areas:['declaration']}));assert.equal(search.status,'succeeded',JSON.stringify(search));assert.equal(search.data.matches[0].objectType,'enum');
 const collision=await c.done(await c.call('declaration_create',{...args,requestId:'collision',expectedSnapshot:created.data.snapshot}));assert.equal(collision.error.code,'OBJECT_EXISTS');
 const stale=await c.done(await c.call('declaration_create',{...args,requestId:'stale',name:'E_Other',declaration:declaration.replaceAll('E_State','E_Other')}));assert.equal(stale.error.code,'SNAPSHOT_CONFLICT');
 const save=await c.done(await c.call('project_save',{...a,requestId:'save',expectedSnapshot:created.data.snapshot}));assert(save.data.saved&&save.data.reopened);
 const final=await c.done(await c.call('project_compare',{...a,mode:'capture',origin:'working-copy',requestId:'after'}));
 const comparison=await c.done(await c.call('project_compare',{...a,mode:'compare',baselineOperationId:baseline.operationId,targetOperationId:final.operationId}));assert.equal(comparison.status,'succeeded',JSON.stringify(comparison));assert.deepEqual(comparison.data.counts.object,{added:1,deleted:0,modified:0,unchanged:1,incomparable:0});assert.equal(comparison.data.items.find(i=>i.category==='added').objectType,'enum');
 const bytes=await readFile(s.workingPath);await c.client.close();const restart=await connect(e.dataDir);t.after(()=>restart.client.close());assert.equal((await restart.call('declaration_create',args)).operationId,created.operationId);assert.deepEqual(await readFile(s.workingPath),bytes);
});

test('枚举错误类型/全文/创建依据读回和保存后unknown继续冻结，不通过新编号重放',async()=>{
 for(const corrupt of [d=>{d.objectType='structure';},d=>{d.nativeTypeId=app;},d=>{d.declaration=declaration.replace('2','3');},d=>{delete d.creationMethod;},d=>{d.reopened=false;}]){
  const e=await setup(),f=new FixtureAdapter();let creates=0;const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},{reconcile:d=>f.reconcile(d),execute:async(...a)=>{const r=await f.execute(...a);if(a[0].command==='create_declaration'){creates++;corrupt(r.data);}return r;}});
  try{const open=await service.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app}),args=create(open.data.session,open.data.snapshot);const r=await service.call('declaration_create',args);assert.equal(r.status,'unknown',JSON.stringify(r));assert.equal((await service.status()).data.writeFrozen,true);assert.equal((await service.call('declaration_create',args)).operationId,r.operationId);await assert.rejects(()=>service.call('declaration_create',{...args,requestId:'no-replay'}),e=>e.code==='PENDING_UNKNOWN');assert.equal(creates,1);
  }finally{await service.store.release();}
 }
});

test('枚举相同GUID跨工程隔离，非活动工程的旧目标读取被拒绝',async t=>{
 const e=await setup(),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app})),s=opened.data.session;
 const created=await c.done(await c.call('declaration_create',create(s,opened.data.snapshot)));assert.equal(created.status,'succeeded');
 const b=path.join(e.dir,'B.json');await copyFile(s.workingPath,b);const other=(await c.done(await c.call('project_open_copy',{requestId:'open-b',sourcePath:b,applicationId:app}))).data.session;
 assert.equal((await c.call('object_read',{...target(s),objectId:created.data.objectId})).error.code,'PROJECT_NOT_ACTIVE');
 assert.equal((await c.done(await c.call('object_read',{...target(other),objectId:created.data.objectId}))).data.objectType,'enum');
 await c.done(await c.call('project_activate',{requestId:'return',projectId:s.projectId}));assert.equal((await c.done(await c.call('object_read',{...target(s),objectId:created.data.objectId}))).data.declaration,declaration);
});

test('真实枚举桥接工厂、错误读回及重开不确定状态（原生对象替身，非IDE）',()=>{
 const r=spawnSync('python',['tests/bridge_enum_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});

test('旧快照明确跳过同路径DUT时枚举不能推断新增或删除，原三类匹配不变',()=>{
 const prefix=['Device','Application'],identity={projectId:app,applicationId:app,applicationPath:prefix,origin:'working-copy',projectPath:'fixture.project',diskHash:'a'.repeat(64),evidence:{kind:'managed-native-capture',operationId:obj}};
 const original=[['PLC_PRG','st_pou'],['ST_Config','structure'],['GVL_Config','gvl']].map(([name,objectType],i)=>({objectId:[app,obj,app2][i],path:[...prefix,name],objectType,hasImplementation:objectType==='st_pou',declaration:'unchanged fixture '+name,implementation:''}));
 const enumeration={objectId:'50000000-0000-4000-8000-000000000001',path:[...prefix,'E_State'],objectType:'enum',hasImplementation:false,nativeTypeId:'2db5746d-d284-4425-9f7f-2663a34b0ebc',declaration,implementation:''};
 const snapshot=(objects,skippedObjects=[])=>({identity,version:'b'.repeat(64),objects,tasks:[],scope:{treeComplete:true,coverageComplete:true,readFailures:[],enumerationFailures:[],skippedObjects},taskCoverage:{complete:true,enumerationFailures:[],resolutionReadFailures:[]}});
 const old=snapshot(original,[{objectId:enumeration.objectId,path:enumeration.path,nativeTypeId:enumeration.nativeTypeId,stage:'unsupported-form',reason:'old reader did not support enum'}]),current=snapshot([...original,enumeration]);
 for(const [b,t] of [[old,current],[current,old]]){const r=compareReply(b,t,{offset:0,limit:10}),e=r.data.items.find(x=>x.objectType==='enum');assert.equal(e.category,'incomparable');assert.equal(r.data.counts.object.unchanged,3);assert.equal(r.data.counts.object.added+r.data.counts.object.deleted,0);assert.equal(r.data.coverageComplete,false);assert.equal(r.data.gaps.count,1);const previousVersion=digest(canonical([b.version,t.version]));assert.notEqual(r.data.version,previousVersion);assert.throws(()=>compareReply(b,t,{offset:1,limit:1,expectedVersion:previousVersion}),e=>e.code==='COMPARE_VERSION_CHANGED');}
});
