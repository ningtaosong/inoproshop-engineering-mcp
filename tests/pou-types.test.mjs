import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,connect,app} from './helpers.mjs';
import {schemas,pouHeader,pouDeclarationMatches} from '../dist/contracts.js';
import {readFile,writeFile} from 'node:fs/promises';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

const bodies=[
  {name:'F_AddOne',pouType:'function',returnType:'DINT',declaration:'FUNCTION F_AddOne : DINT\nVAR_INPUT\n Value : DINT;\nEND_VAR\nVAR\n Delta : DINT := 1;\nEND_VAR',implementation:'F_AddOne := Value + Delta;'},
  ...['BOOL','INT','REAL','TIME'].map(type=>({name:'F_Return'+type,pouType:'function',returnType:type,
    declaration:`FUNCTION F_Return${type} : ${type}\nVAR_INPUT\n Value : ${type};\nEND_VAR`,
    implementation:`F_Return${type} := ${type==='BOOL'?'NOT ':''}Value;`})),
  {name:'PRG_Demo',pouType:'program',declaration:'PROGRAM PRG_Demo\nVAR\n Result : DINT;\nEND_VAR',implementation:'Result := F_AddOne(Value := 41);'}
];
const args=(s,snapshot,body)=>({requestId:'create-'+body.name,projectId:s.projectId,applicationId:app,parentId:app,expectedSnapshot:snapshot,...body});

test('五种FUNCTION返回类型与PROGRAM经stdio/替身创建、去重、列读搜比；既有其他返回类型不收窄',async t=>{
  const env=await setup();
  const fixture=JSON.parse(await readFile(env.source,'utf8'));
  fixture.objects.push({objectId:'20000000-0000-4000-8000-000000000003',applicationId:app,path:['设备','应用一','F_LegacyString'],
    objectType:'st_pou',pouType:'function',returnType:'STRING(24)',pouTypeSource:'native-pou-type-id-and-declaration-header',
    declaration:'FUNCTION F_LegacyString : STRING(24)\nVAR_INPUT\n Value : STRING(24);\nEND_VAR',implementation:'F_LegacyString := Value;'});
  await writeFile(env.source,JSON.stringify(fixture));
  const c=await connect(env.dataDir);t.after(()=>c.client.close());
  const tool=(await c.client.listTools()).tools.find(t=>t.name==='pou_create');
  assert.deepEqual(tool.inputSchema.properties.pouType.enum,['function_block','program','function']);
  assert.deepEqual(tool.inputSchema.properties.returnType.enum,['DINT','BOOL','INT','REAL','TIME']);
  const opened=await c.done(await c.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app}));
  const s=opened.data.session,target={projectId:s.projectId,applicationId:app};let snapshot=opened.data.snapshot;
  const baseline=await c.done(await c.call('project_compare',{...target,mode:'capture',origin:'working-copy'}));
  for(const body of bodies){
    const request=args(s,snapshot,body);
    const [one,two]=await Promise.all([c.call('pou_create',request),c.call('pou_create',request)]);
    assert.equal(one.operationId,two.operationId);const r=await c.done(one);assert.equal(r.status,'succeeded',JSON.stringify(r));
    snapshot=r.data.snapshot;assert.equal(r.data.objectType,'st_pou');assert.equal(r.data.pouType,body.pouType);
    assert.equal(r.data.returnType,body.returnType);assert.equal(r.data.declaration,body.declaration);
    const read=await c.done(await c.call('object_read',{...target,objectId:r.data.objectId}));
    assert.equal(read.data.implementation,body.implementation);assert.equal(read.data.pouType,body.pouType);
    const collision=await c.done(await c.call('pou_create',{...request,requestId:'collision-'+body.name,expectedSnapshot:snapshot}));
    assert.equal(collision.error.code,'OBJECT_EXISTS');
    assert.equal((await c.call('pou_create',request)).operationId,r.operationId);
  }
  const list=await c.done(await c.call('object_list',target));
  for(const body of bodies){const row=list.data.objects.find(o=>o.path.at(-1)===body.name);assert.equal(row.pouType,body.pouType);assert.equal(row.returnType,body.returnType);}
  const search=await c.done(await c.call('project_search',{...target,query:'F_'}));
  for(const type of ['DINT','BOOL','INT','REAL','TIME','STRING(24)'])assert(search.data.matches.some(m=>m.pouType==='function'&&m.returnType===type));
  assert(search.data.matches.some(m=>m.pouType==='program'&&m.region==='implementation'));
  const final=await c.done(await c.call('project_compare',{...target,mode:'capture',origin:'working-copy'}));
  const compare=await c.done(await c.call('project_compare',{...target,mode:'compare',baselineOperationId:baseline.operationId,targetOperationId:final.operationId}));
  assert.equal(compare.data.counts.object.added,bodies.length);assert.equal(compare.data.counts.object.modified,0);
  for(const body of bodies.filter(b=>b.pouType==='function')){const item=compare.data.items.find(i=>i.relativePath[0]===body.name);assert.equal(item.pouType,'function');assert.equal(item.returnType,body.returnType);}
  const legacy=list.data.objects.find(o=>o.path.at(-1)==='F_LegacyString');
  assert.equal((await c.done(await c.call('object_read',{...target,objectId:legacy.objectId}))).data.returnType,'STRING(24)');
  const legacyItem=compare.data.items.find(i=>i.relativePath[0]==='F_LegacyString');assert.equal(legacyItem.returnType,'STRING(24)');assert.equal(legacyItem.category,'unchanged');
});

test('创建白名单、显式参数与声明一致性在服务派发前拒绝错误，其他POU拒绝returnType',async()=>{
  const env=await setup();let creates=0;const fixture=new FixtureAdapter();
  const adapter={reconcile:d=>fixture.reconcile(d),execute:(r,...rest)=>{if(r.command==='create')creates++;return fixture.execute(r,...rest);}};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try{
    const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});
    const good=args(opened.data.session,opened.data.snapshot,bodies[0]);
    for(const [i,extra] of [{returnType:undefined},...['STRING','ARRAY[0..1] OF INT','ST_Struct','POINTER TO INT','REFERENCE TO INT','MyAlias','LREAL','UDINT','int'].map(returnType=>({returnType})),{pouType:'program'},{pouType:'function_block'}].entries()){
      const request={...good,...extra,requestId:'invalid-type-'+i};
      if(request.returnType===undefined)delete request.returnType; // JSON wire absence, not an internal undefined-valued field.
      assert.equal(schemas.pou_create.safeParse(request).success,false);
      const rejected=await service.call('pou_create',request);assert.equal(rejected.status,'failed');assert.equal(rejected.error.code,'INVALID_POU_DECLARATION');
    }
    for(const [i,declaration] of ['FUNCTION F_AddOne : INT','PROGRAM F_AddOne','FUNCTION Other : DINT','FUNCTION F_AddOne : DINT VAR_INPUT Value:DINT; END_VAR'].entries()){
      const r=await service.call('pou_create',{...good,requestId:'bad-'+i,declaration});
      assert.equal(r.status,'failed');assert.equal(r.error.code,'INVALID_POU_DECLARATION');
    }
    assert.equal(creates,0);
  }finally{await service.store.release();}
});

test('声明首部沿用不区分大小写，创建参数仍是显式大写枚举；读取保留原类型文字',()=>{
  assert(pouDeclarationMatches('function','F_Case','function f_case : real\nVAR_INPUT\n Value:REAL;\nEND_VAR','REAL'));
  assert.equal(pouHeader('FUNCTION F_Legacy : STRING(24)\nVAR\nEND_VAR').returnType,'STRING(24)');
  assert.equal(pouHeader('function f_case : real\n').returnType,'real');
});

test('新增POU读回返回类型/类型/全文不一致必须unknown并冻结，原请求查询不重新创建',async()=>{
  for(const change of [d=>{d.returnType='INT';},d=>{delete d.returnType;},d=>{d.pouType='program';},d=>{d.declaration=d.declaration.replace('TIME','INT');}]){
    const env=await setup(),fixture=new FixtureAdapter();let creates=0;
    const adapter={reconcile:d=>fixture.reconcile(d),execute:async(r,...rest)=>{const out=await fixture.execute(r,...rest);if(r.command==='create'){creates++;change(out.data);}return out;}};
    const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
    try{
      const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});const request=args(opened.data.session,opened.data.snapshot,bodies.find(b=>b.returnType==='TIME'));
      const r=await service.call('pou_create',request);assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
      assert.equal((await service.status()).data.writeFrozen,true);assert.equal((await service.call('pou_create',request)).operationId,r.operationId);
      assert.equal(creates,1);
    }finally{await service.store.release();}
  }
});
