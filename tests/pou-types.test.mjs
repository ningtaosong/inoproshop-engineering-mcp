import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,connect,app} from './helpers.mjs';
import {schemas} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

const bodies=[
  {name:'F_AddOne',pouType:'function',returnType:'DINT',declaration:'FUNCTION F_AddOne : DINT\nVAR_INPUT\n Value : DINT;\nEND_VAR\nVAR\n Delta : DINT := 1;\nEND_VAR',implementation:'F_AddOne := Value + Delta;'},
  {name:'PRG_Demo',pouType:'program',declaration:'PROGRAM PRG_Demo\nVAR\n Result : DINT;\nEND_VAR',implementation:'Result := F_AddOne(Value := 41);'}
];
const args=(s,snapshot,body)=>({requestId:'create-'+body.name,projectId:s.projectId,applicationId:app,parentId:app,expectedSnapshot:snapshot,...body});

test('扩展pou_create经真实stdio传输/替身工程：PROGRAM/DINT FUNCTION、去重、检索与可信快照对比',async t=>{
  const env=await setup(),c=await connect(env.dataDir);t.after(()=>c.client.close());
  const tool=(await c.client.listTools()).tools.find(t=>t.name==='pou_create');
  assert.deepEqual(tool.inputSchema.properties.pouType.enum,['function_block','program','function']);
  assert.equal(tool.inputSchema.properties.returnType.const,'DINT');
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
  for(const body of bodies)assert.equal(list.data.objects.find(o=>o.path.at(-1)===body.name).pouType,body.pouType);
  const search=await c.done(await c.call('project_search',{...target,query:'F_AddOne'}));
  assert(search.data.matches.some(m=>m.pouType==='function'&&m.returnType==='DINT'));
  assert(search.data.matches.some(m=>m.pouType==='program'&&m.region==='implementation'));
  const final=await c.done(await c.call('project_compare',{...target,mode:'capture',origin:'working-copy'}));
  const compare=await c.done(await c.call('project_compare',{...target,mode:'compare',baselineOperationId:baseline.operationId,targetOperationId:final.operationId}));
  assert.equal(compare.data.counts.object.added,2);assert.equal(compare.data.counts.object.modified,0);
  assert.equal(compare.data.items.find(i=>i.relativePath[0]==='F_AddOne').pouType,'function');
  assert.equal(compare.data.items.find(i=>i.relativePath[0]==='F_AddOne').returnType,'DINT');
});

test('FUNCTION必须显式DINT且首部一致；其他POU拒绝返回类型，无效声明不派发IDE',async()=>{
  const env=await setup();let creates=0;const fixture=new FixtureAdapter();
  const adapter={reconcile:d=>fixture.reconcile(d),execute:(r,...rest)=>{if(r.command==='create')creates++;return fixture.execute(r,...rest);}};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try{
    const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});
    const good=args(opened.data.session,opened.data.snapshot,bodies[0]);
    for(const extra of [{returnType:undefined},{returnType:'INT'},{returnType:'BOOL'},{returnType:'ST_Struct'},{pouType:'program'},{pouType:'function_block'}])
      assert.equal(schemas.pou_create.safeParse({...good,...extra}).success,false);
    for(const [i,declaration] of ['FUNCTION F_AddOne : INT','PROGRAM F_AddOne','FUNCTION Other : DINT','FUNCTION F_AddOne : DINT VAR_INPUT Value:DINT; END_VAR'].entries()){
      const r=await service.call('pou_create',{...good,requestId:'bad-'+i,declaration});
      assert.equal(r.status,'failed');assert.equal(r.error.code,'INVALID_POU_DECLARATION');
    }
    assert.equal(creates,0);
  }finally{await service.store.release();}
});

test('新增POU读回返回类型/类型/全文不一致必须unknown并冻结，原请求查询不重新创建',async()=>{
  for(const change of [d=>{d.returnType='INT';},d=>{delete d.returnType;},d=>{d.pouType='program';},d=>{d.declaration=d.declaration.replace('DINT','INT');}]){
    const env=await setup(),fixture=new FixtureAdapter();let creates=0;
    const adapter={reconcile:d=>fixture.reconcile(d),execute:async(r,...rest)=>{const out=await fixture.execute(r,...rest);if(r.command==='create'){creates++;change(out.data);}return out;}};
    const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
    try{
      const opened=await service.call('project_open_copy',{requestId:'open',sourcePath:env.source,applicationId:app});const request=args(opened.data.session,opened.data.snapshot,bodies[0]);
      const r=await service.call('pou_create',request);assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
      assert.equal((await service.status()).data.writeFrozen,true);assert.equal((await service.call('pou_create',request)).operationId,r.operationId);
      assert.equal(creates,1);
    }finally{await service.store.release();}
  }
});
