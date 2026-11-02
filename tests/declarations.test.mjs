import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {setup,connect,app,obj} from './helpers.mjs';
import {schemas,declarationMatches} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
const declaration='TYPE ST_Config :\nSTRUCT\n Delay : TIME;\nEND_STRUCT\nEND_TYPE\n';
const gvl="{attribute 'qualified_only'}\nVAR_GLOBAL\n Config : ST_Config := (Delay := T#5s);\nEND_VAR\n";
const target=s=>({projectId:s.projectId,applicationId:app});
const create=(s,snap,kind='structure')=>({...target(s),requestId:'create-'+kind,parentId:app,expectedSnapshot:snap,name:kind==='gvl'?'GVL_Config':'ST_Config',objectType:kind,declaration:kind==='gvl'?gvl:declaration});

test('声明创建、无实现读取与修改：去重、过期版本、同名冲突、类型拒绝和旧 POU 兼容',async t=>{
 const env=await setup(),c=await connect(env.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call('project_open_copy',{sourcePath:env.source,applicationId:app,requestId:'open'})),s=opened.data.session;
 const args=create(s,opened.data.snapshot),[x,y]=await Promise.all([c.call('declaration_create',args),c.call('declaration_create',args)]);assert.equal(x.operationId,y.operationId);
 const dut=await c.done(x);assert.equal(dut.status,'succeeded',JSON.stringify(dut));assert.equal(dut.data.hasImplementation,false);assert.equal(dut.data.implementation,'');
 const created=await c.done(await c.call('declaration_create',create(s,dut.data.snapshot,'gvl')));assert.equal(created.status,'succeeded');
 const id=created.data.objectId;
 const read=await c.done(await c.call('object_read',{...target(s),objectId:id}));assert.equal(read.data.objectType,'gvl');assert.equal(read.data.declaration,gvl);
 const change={...target(s),requestId:'change',objectId:id,objectType:'gvl',expectedHash:read.data.contentHash,declaration:gvl.replace('T#5s','T#7s')};
 const changed=await c.done(await c.call('code_apply_change',change));assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.implementation,'');
 assert.equal((await c.done(await c.call('code_apply_change',{...change,requestId:'stale'}))).status,'conflict');
 for(const extra of [{objectType:'structure'},{implementation:'x := 1;'},{declaration:'TYPE GVL_Config : INT; END_TYPE'}])assert.equal((await c.done(await c.call('code_apply_change',{...change,...extra,expectedHash:changed.data.contentHash,requestId:'wrong-'+JSON.stringify(extra)}))).error.code,'OBJECT_TYPE_MISMATCH');
 const collision=await c.done(await c.call('declaration_create',{...args,requestId:'collision',expectedSnapshot:changed.data.snapshot,name:'st_config',declaration:declaration.replace('ST_Config','st_config')}));assert.equal(collision.error.code,'OBJECT_EXISTS');
 const stale=await c.done(await c.call('declaration_create',{...args,requestId:'stale-create',name:'ST_Other',declaration:declaration.replace('ST_Config','ST_Other')}));assert.equal(stale.error.code,'SNAPSHOT_CONFLICT');
 const wrongPOU=await c.done(await c.call('code_apply_change',{...change,requestId:'wrong-pou',objectId:obj}));assert.equal(wrongPOU.error.code,'OBJECT_TYPE_MISMATCH');
 const list=await c.done(await c.call('object_list',target(s)));assert.deepEqual(list.data.objects.filter(o=>o.hasImplementation===false).map(o=>o.objectType).sort(),['gvl','structure']);
 const bytes=await readFile(s.workingPath);await c.client.close();const again=await connect(env.dataDir);t.after(()=>again.client.close());const dup=await again.call('declaration_create',args);assert.equal(dup.operationId,dut.operationId);assert.deepEqual(await readFile(s.workingPath),bytes);
});

test('声明对象的相同 GUID 跨工程隔离，旧目标请求不能写入新活动工程',async t=>{
 const env=await setup();const b=path.join(env.dir,'B.json');await copyFile(env.source,b);
 const c=await connect(env.dataDir);t.after(()=>c.client.close());
 const a=(await c.done(await c.call('project_open_copy',{sourcePath:env.source,applicationId:app,requestId:'a'}))).data;
 const r=await c.done(await c.call('declaration_create',create(a.session,a.snapshot)));
 // Deliberately give independent B the exact same DUT identity/content, as copied native projects do.
 await writeFile(b,await readFile(a.session.workingPath));
 const s=(await c.done(await c.call('project_open_copy',{sourcePath:b,applicationId:app,requestId:'b'}))).data.session;
 const change={objectId:r.data.objectId,objectType:'structure',expectedHash:r.data.contentHash,declaration:declaration.replace('Delay : TIME;','Delay : TIME := T#3s;')};
 assert.equal((await c.call('code_apply_change',{...target(a.session),...change,requestId:'inactive'})).error.code,'PROJECT_NOT_ACTIVE');
 assert.equal((await c.done(await c.call('code_apply_change',{...target(s),...change,requestId:'active'}))).status,'succeeded');
 await c.done(await c.call('project_activate',{projectId:a.session.projectId,requestId:'return'}));
 const back=await c.done(await c.call('object_read',{...target(a.session),objectId:r.data.objectId}));assert.equal(back.data.declaration,declaration);
});

test('声明创建不接受枚举/联合体/池/文件夹类型或实现参数',()=>{
 const args={requestId:'x',projectId:app,applicationId:app,parentId:app,expectedSnapshot:'a'.repeat(64),name:'X',objectType:'structure',declaration};
 for(const extra of [{objectType:'enum'},{objectType:'union'},{targetKind:'pool'},{implementation:''},{name:'../X'}])assert.equal(schemas.declaration_create.safeParse({...args,...extra}).success,false);
 assert.equal(declarationMatches('structure','X','TYPE X : (A, B); END_TYPE'),false);
 assert.equal(declarationMatches('structure','X','TYPE X : UNION A : INT; END_UNION END_TYPE'),false);
 assert.equal(declarationMatches('gvl','X',"VAR_GLOBAL\n Message : STRING := 'TYPE // STRUCT';\nEND_VAR"),true);
});

test('声明结果缺少类型证据或伪造为其他原生类型时冻结，不因存在文本而放行',async()=>{
 for(const corrupt of [d=>{delete d.hasImplementation;},d=>{d.nativeTypeId='6f9dac99-8de1-4efc-8465-68ac443b7d08';},d=>{d.path=['设备','应用一','Folder',d.name];}]){
  const env=await setup(),fixture=new FixtureAdapter();let sends=0;
  const adapter={reconcile:d=>fixture.reconcile(d),execute:async(r,d,f)=>{const out=await fixture.execute(r,d,f);if(r.command==='create_declaration'){sends++;corrupt(out.data);}return out;}};
  const service=new EngineeringService({dataDir:env.dataDir,testMode:true,responseWaitMs:1000},adapter);
  try{
   const opened=await service.call('project_open_copy',{sourcePath:env.source,applicationId:app,requestId:'open'}),args=create(opened.data.session,opened.data.snapshot);
   const r=await service.call('declaration_create',args);assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
   assert.equal((await service.status()).data.writeFrozen,true);assert.equal((await service.call('declaration_create',args)).operationId,r.operationId);
   await assert.rejects(()=>service.call('declaration_create',{...args,requestId:'never-replay'}),e=>e.code==='PENDING_UNKNOWN');assert.equal(sends,1);
  }finally{await service.store.release();}
 }
});

test('真实生产声明桥接函数的类型与失败恢复测试（对象替身，非 IDE）',()=>{
 const r=spawnSync('python',['tests/bridge_declaration_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
