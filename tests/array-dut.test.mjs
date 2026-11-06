import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,copyFile} from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {z} from 'zod';
import {schemas,outputSchemas,declarationMatches,arrayBounds} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {compareReply} from '../dist/comparison.js';import {digest,canonical} from '../dist/storage.js';
import {setup,connect,app,app2,obj} from './helpers.mjs';import {withoutArrayExtension} from './contract-compatibility.mjs';
const text=(low=1,high=2)=>`TYPE T_Values :\nARRAY [${low}..${high}] OF DINT;\nEND_TYPE\n`;
const target=s=>({projectId:s.projectId,applicationId:app});
const create=(s,snapshot)=>({...target(s),requestId:'array-create',parentId:app,expectedSnapshot:snapshot,name:'T_Values',objectType:'array',declaration:text()});

test('array is an additive nineteen-tool contract extension with every legacy schema preserved',async()=>{
 const old=JSON.parse(await readFile('tests/fixtures/array-legacy-contracts.json','utf8'));assert.equal(Object.keys(schemas).length,21);
 for(const t of old.tools){assert.deepEqual(withoutArrayExtension(z.toJSONSchema(schemas[t.name],{io:'input'})),t.inputSchema,t.name+' input');assert.deepEqual(withoutArrayExtension(z.toJSONSchema(outputSchemas[t.name])),t.outputSchema,t.name+' output');}
 const args=create({projectId:app},'a'.repeat(64));assert(schemas.declaration_create.safeParse(args).success);
 for(const extra of [{dimensions:1},{baseType:'DINT'},{implementation:''},{objectType:'alias'},{targetKind:'pool'}])assert(!schemas.declaration_create.safeParse({...args,...extra}).success);
});

test('complete narrow array guard: comments/whitespace/bounds accepted; unsupported input never creates natively',async()=>{
 for(const [lo,hi] of [[1,3],[7,7],[0,255],[255,255]])assert.deepEqual(arrayBounds('t_values',text(lo,hi)),{lower:lo,upper:hi});
 assert(declarationMatches('array','T_Values','(*前注*) TYPE T_Values : // 行注\n ARRAY [ 1 (*下界*) .. 3 ] OF dint ; END_TYPE //结束',true));
 const invalid=[text(3,1),text(-1,2),text(0,256),text('N',3),text('1+0',3),text('16#0',3),text('0,0..1',3),text('*',3),text().replace('DINT','REAL'),text().replace('DINT','ARRAY [1..2] OF DINT'),text().replace('DINT;','DINT := [1,2];'),text().replace('T_Values','Other'),text()+'TYPE Other : DINT; END_TYPE',text()+'x := 1;',"{attribute 'strict'} "+text(),'TYPE T_Values : DINT; END_TYPE',"TYPE T_Values : ARRAY [1..2] OF DINT; END_TYPE 'extra'",'TYPE T_Values : ARRAY [1..2] OF DINT; END_TYPE\n(* unclosed'];
 const e=await setup(),f=new FixtureAdapter();let factories=0;
 const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},{reconcile:d=>f.reconcile(d),execute:async(...a)=>{if(a[0].command==='create_declaration')factories++;return f.execute(...a);}});
 try{const o=await service.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app});
  for(const [i,declaration] of invalid.entries()){assert(!declarationMatches('array','T_Values',declaration,true),declaration);const r=await service.call('declaration_create',{...create(o.data.session,o.data.snapshot),requestId:'invalid-'+i,declaration});assert.equal(r.error.code,'INVALID_DECLARATION',JSON.stringify(r));}
  assert.equal(factories,0);assert.equal((await service.status()).data.writeFrozen,false);
 }finally{await service.store.release();}
});

test('array create/change/reopen, dedup, stale/collision guards, paged list/search/compare and project identity',async t=>{
 const e=await setup(),c=await connect(e.dataDir);t.after(()=>c.client.close());const done=async(n,a)=>c.done(await c.call(n,a));
 const opened=await done('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app}),s=opened.data.session,a=target(s);
 const baseline=await done('project_compare',{...a,mode:'capture',requestId:'before'}),args=create(s,opened.data.snapshot);
 const [one,two]=await Promise.all([c.call('declaration_create',args),c.call('declaration_create',args)]);assert.equal(one.operationId,two.operationId);
 const created=await c.done(one);assert.equal(created.status,'succeeded',JSON.stringify(created));assert.equal(created.data.objectType,'array');assert.equal(created.data.declaration,text());assert.equal(created.data.implementation,'');assert.equal(created.data.hasImplementation,false);assert(created.data.reopened);
 const middle=await done('project_compare',{...a,mode:'capture',requestId:'middle'});
 assert.equal((await done('declaration_create',{...args,requestId:'collision',expectedSnapshot:created.data.snapshot})).error.code,'OBJECT_EXISTS');
 assert.equal((await done('declaration_create',{...args,requestId:'stale-create',name:'T_Other',declaration:text().replace('T_Values','T_Other')})).error.code,'SNAPSHOT_CONFLICT');
 const change={...a,requestId:'grow',objectId:created.data.objectId,objectType:'array',expectedHash:created.data.contentHash,declaration:text(1,3)};
 const changed=await done('code_apply_change',change);assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.declaration,text(1,3));assert(changed.data.reopened);
 assert.equal((await done('code_apply_change',{...change,requestId:'stale-change'})).status,'conflict');
 for(const [i,extra] of [{objectType:'structure'},{declaration:'TYPE T_Values : STRUCT X : DINT; END_STRUCT END_TYPE'},{declaration:'TYPE T_Values : (A := 0); END_TYPE'},{declaration:text(0,256)},{declaration:text(1,3)+'TYPE Bad : DINT; END_TYPE'},{implementation:'x := 1;'}].entries())assert.equal((await done('code_apply_change',{...change,...extra,requestId:'bad-change-'+i,expectedHash:changed.data.contentHash})).error.code,'OBJECT_TYPE_MISMATCH');
 const listed=[];let offset=0;do{const r=await done('object_list',{...a,offset,limit:1});listed.push(...r.data.objects);offset=r.data.nextOffset;}while(offset!==null);assert.equal(listed.find(o=>o.objectId===created.data.objectId).objectType,'array');
 const search=await done('project_search',{...a,query:'T_Values',areas:['name','declaration'],caseSensitive:true,limit:1}),page=await done('project_search',{...a,query:'T_Values',areas:['name','declaration'],caseSensitive:true,limit:1,offset:search.data.page.nextOffset,expectedVersion:search.data.version});
 assert.equal(search.data.matches[0].objectType,'array');assert.equal(page.data.matches[0].region,'declaration');assert.equal(page.data.page.hasMore,false);
 const saved=await done('project_save',{...a,requestId:'save',expectedSnapshot:changed.data.snapshot});assert(saved.data.saved&&saved.data.reopened);
 const final=await done('project_compare',{...a,mode:'capture',requestId:'final'});
 const comp=await done('project_compare',{...a,mode:'compare',baselineOperationId:baseline.operationId,targetOperationId:final.operationId,limit:1});assert.equal(comp.data.counts.object.added,1);assert.equal(comp.data.counts.object.unchanged,1);
 const range=await done('project_compare',{...a,mode:'compare',baselineOperationId:middle.operationId,targetOperationId:final.operationId,limit:10});assert.equal(range.data.counts.object.modified,1);assert.equal(range.data.items.find(i=>i.category==='modified').objectType,'array');
 const b=path.join(e.dir,'B.json');await copyFile(s.workingPath,b);const other=(await done('project_open_copy',{requestId:'B',sourcePath:b,applicationId:app})).data.session;
 assert.equal((await c.call('object_read',{...a,objectId:created.data.objectId})).error.code,'PROJECT_NOT_ACTIVE');assert.equal((await done('object_read',{...target(other),objectId:created.data.objectId})).data.objectType,'array');
 await done('project_activate',{requestId:'return',projectId:s.projectId});await c.client.close();const restart=await connect(e.dataDir);t.after(()=>restart.client.close());assert.equal((await restart.call('declaration_create',args)).operationId,created.operationId);
});

test('array type/text/native/factory evidence or reopen corruption remains frozen, no request replay',async()=>{
 for(const corrupt of [d=>{d.objectType='structure';},d=>{d.declaration=text(0,3);},d=>{d.nativeTypeId=app;},d=>{delete d.creationMethod;},d=>{d.reopened=false;}]){
  const e=await setup(),f=new FixtureAdapter();let creates=0;const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},{reconcile:d=>f.reconcile(d),execute:async(...a)=>{const r=await f.execute(...a);if(a[0].command==='create_declaration'){creates++;corrupt(r.data);}return r;}});
  try{const o=await service.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app}),args=create(o.data.session,o.data.snapshot),r=await service.call('declaration_create',args);assert.equal(r.status,'unknown',JSON.stringify(r));assert((await service.status()).data.writeFrozen);assert.equal((await service.call('declaration_create',args)).operationId,r.operationId);await assert.rejects(()=>service.call('declaration_create',{...args,requestId:'no-replay'}),e=>e.code==='PENDING_UNKNOWN');assert.equal(creates,1);}finally{await service.store.release();}
 }
});

test('old skipped same-path array DUT is incomparable, old page token rejected, enum token and old matching retained',()=>{
 const prefix=['Device','Application'],identity={projectId:app,applicationId:app,applicationPath:prefix,origin:'working-copy',projectPath:'fixture.project',diskHash:'a'.repeat(64),evidence:{kind:'managed-native-capture',operationId:obj}};
 const original=[['PLC_PRG','st_pou'],['ST_Config','structure'],['E_State','enum']].map(([n,objectType],i)=>({objectId:[app,obj,app2][i],path:[...prefix,n],objectType,hasImplementation:objectType==='st_pou',declaration:n,implementation:''}));
 const array={objectId:'50000000-0000-4000-8000-000000000001',path:[...prefix,'T_Values'],objectType:'array',hasImplementation:false,nativeTypeId:'2db5746d-d284-4425-9f7f-2663a34b0ebc',declaration:text(),implementation:''};
 const snap=(objects,skippedObjects=[])=>({identity,version:digest(canonical([objects,skippedObjects])),objects,tasks:[],scope:{treeComplete:true,coverageComplete:true,readFailures:[],enumerationFailures:[],skippedObjects},taskCoverage:{complete:true,enumerationFailures:[],resolutionReadFailures:[]}});
 const old=snap(original,[{objectId:array.objectId,path:array.path,nativeTypeId:array.nativeTypeId,stage:'unsupported-form',reason:'old reader skipped array'}]),now=snap([...original,array]);
 for(const [b,t] of [[old,now],[now,old]]){const r=compareReply(b,t,{offset:0,limit:1});assert.equal(r.data.counts.object.incomparable,1);assert.equal(r.data.counts.object.added+r.data.counts.object.deleted,0);assert.equal(r.data.counts.object.unchanged,3);assert(!r.data.coverageComplete);assert.equal(r.data.gaps.entries[0].stage,'array-coverage');const prev=digest(canonical([b.version,t.version]));assert.throws(()=>compareReply(b,t,{offset:1,limit:1,expectedVersion:prev}),e=>e.code==='COMPARE_VERSION_CHANGED');assert.equal(compareReply(b,t,{offset:1,limit:5,expectedVersion:r.data.version}).data.page.hasMore,false);}
 const noGap=snap(original);assert.equal(compareReply(noGap,noGap,{offset:0,limit:10}).data.version,digest(canonical([noGap.version,noGap.version])));
});

test('native Alias-array production bridge double: exact parameters, range guard and uncertain reopen',()=>{
 const r=spawnSync('python',['tests/bridge_array_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
