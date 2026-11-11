import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect,app,app2,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {codeHash} from '../dist/storage.js';
import {schemas,methodHeader,methodDeclarationMatches} from '../dist/contracts.js';
import {comparisonItems} from '../dist/comparison.js';
import {parseDeclaration} from '../dist/variables.js';
import {withoutMethodExtension} from './contract-compatibility.mjs';
import {outputSchemas} from '../dist/contracts.js';
import {canonical,digest} from '../dist/storage.js';
import {z} from 'zod';
const fb=randomUUID(),fb2=randomUUID(),fbOther=randomUUID();
const parent=(id,name,aid=app)=>({objectId:id,applicationId:aid,path:['设备',aid===app?'应用一':'应用二',name],objectType:'function_block',pouType:'function_block',pouTypeSource:'native-pou-type-id-and-declaration-header',nativeTypeId:'6f9dac99-8de1-4efc-8465-68ac443b7d08',hasImplementation:true,declaration:'FUNCTION_BLOCK '+name+'\nVAR\n State : DINT := 7;\nEND_VAR',implementation:''});
const seed=async(extra={})=>{const e=await setup(extra),p=JSON.parse(await readFile(e.source,'utf8'));p.objects.push(parent(fb,'FB_State'),parent(fb2,'FB_Other'),parent(fbOther,'FB_Remote',app2));await writeFile(e.source,JSON.stringify(p));return e;};
async function env(extra={},mutate){const e=await seed(extra),fixture=new FixtureAdapter(),seen=[];const adapter={reconcile:d=>fixture.reconcile(d),execute:async(...args)=>{seen.push(args[0].command);const r=await fixture.execute(...args);if(mutate)await mutate(r,args[0],args[1]);return r;}};const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},adapter);const done=async(n,a)=>{let r=await service.call(n,schemas[n].parse(a));while(r.status==='running'){await new Promise(f=>setTimeout(f,5));r=await service.call('operation_status',{operationId:r.operationId});}return r;};const opened=await done('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app});assert.equal(opened.status,'succeeded',JSON.stringify(opened));return {e,service,done,seen,opened,s:opened.data.session};}
const target=s=>({projectId:s.projectId,applicationId:app,targetKind:'application'});
const header=(name,ret='DINT')=>'METHOD PUBLIC '+name+(ret==='DINT'?' : DINT':'')+'\nVAR_INPUT\nEND_VAR';
const request=(x,o,parentId=fb,name='ReadState',ret='DINT')=>({...target(x.s),requestId:randomUUID(),parentId,expectedParentHash:codeHash(parent(parentId,parentId===fb?'FB_State':'FB_Other').declaration,''),expectedSnapshot:o.snapshot,expectedDiskHash:o.diskHash,name,access:'PUBLIC',returnType:ret,declaration:header(name,ret),implementation:ret==='DINT'?name+' := State;':'State := 0;'});

test('Method schema/header: explicit PUBLIC, void/DINT; no rename or extra declaration forms',()=>{
 for(const ret of ['void','DINT'])assert(methodDeclarationMatches('ReadState',header('ReadState',ret),ret,'PUBLIC'));
 for(const d of ['METHOD PRIVATE ReadState : DINT','METHOD PUBLIC Wrong : DINT','METHOD PUBLIC ReadState : BOOL',header('ReadState')+'\nMETHOD PUBLIC Extra','METHOD PUBLIC ReadState : DINT\nVAR_TEMP\nX:DINT;\nEND_VAR',"METHOD PUBLIC ReadState : DINT (* unclosed"] )assert(!methodDeclarationMatches('ReadState',d,'DINT','PUBLIC'),d);
 assert(methodDeclarationMatches('ReadState','METHOD PUBLIC ReadState : DINT\nVAR\n VAR_InputSetting : VAR_Result;\nEND_VAR','DINT','PUBLIC'));
 assert.equal(methodHeader('METHOD ReadState\nVAR_INPUT\nEND_VAR').returnType,'void');
 assert(!schemas.method_create.safeParse({}).success);assert(!schemas.code_apply_change.safeParse({requestId:'x',...target({projectId:randomUUID()}),objectId:randomUUID(),expectedHash:'a'.repeat(64),declaration:header('M'),implementation:'',objectType:'method'}).success);
});
test('All 23 old tool contracts remain exact after removing only documented additive Method fields',async()=>{
 const old=JSON.parse(await readFile('tests/fixtures/method-legacy-contracts.json','utf8'));assert.equal(Object.keys(schemas).length,27);
 for(const row of old.tools){assert.equal(digest(canonical(withoutMethodExtension(z.toJSONSchema(schemas[row.name],{io:'input'})))),row.inputHash,row.name+' input');assert.equal(digest(canonical(withoutMethodExtension(z.toJSONSchema(outputSchemas[row.name])))),row.outputHash,row.name+' output');}
});
test('Native-method lifecycle substitute: two return kinds, independent parents, same-parent conflict and original-request dedup',async t=>{
 const x=await env();t.after(()=>x.service.store.release());const a=request(x,x.opened.data),r=await x.done('method_create',a);assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.parentId,fb);assert.equal(r.data.factoryEvidence.arguments[1],'DINT');assert.equal(r.data.reopened,true);
 const dup=await x.done('method_create',a);assert.equal(dup.operationId,r.operationId);assert.equal(x.seen.filter(n=>n==='create_method').length,1);
 const second=await x.done('method_create',request(x,r.data,fb2));assert.equal(second.status,'succeeded',JSON.stringify(second));assert.notEqual(r.data.objectId,second.data.objectId);
 const collision=await x.done('method_create',request(x,second.data));assert.equal(collision.status,'conflict');assert.equal(collision.error.code,'METHOD_EXISTS');
 const voidResult=await x.done('method_create',request(x,second.data,fb,'ResetState','void'));assert.equal(voidResult.status,'succeeded',JSON.stringify(voidResult));assert.equal(voidResult.data.factoryEvidence.arguments[1],'');
 const list=await x.done('object_list',{...target(x.s),offset:0,limit:200});assert.equal(list.data.objects.filter(o=>o.objectType==='method').length,3);
 for(const m of [r,second,voidResult]){const read=await x.done('object_read',{...target(x.s),objectId:m.data.objectId});assert.equal(read.data.contentHash,m.data.contentHash);assert.deepEqual(read.data.parentPath,m.data.path.slice(0,-1));}
});
test('Method modifications invalidate old builds without changing parent text; search/variables/compare include child',async t=>{
 const x=await env();t.after(()=>x.service.store.release());const base=await x.done('project_compare',{...target(x.s),mode:'capture',requestId:'before'});
 const created=await x.done('method_create',request(x,x.opened.data));assert.equal(created.status,'succeeded',JSON.stringify(created));
 const build=await x.done('project_build',{...target(x.s),requestId:'build'});assert.equal((await x.service.status()).data.session.buildApplicable,true);
 const a={...target(x.s),requestId:'change-method',objectType:'method',parentId:fb,objectId:created.data.objectId,expectedHash:created.data.contentHash,declaration:header('ReadState'),implementation:'ReadState := State + 1;'};
 const changed=await x.done('code_apply_change',a);assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.notEqual(changed.data.snapshot,build.data.snapshot);assert.equal((await x.service.status()).data.session.buildApplicable,false);
 assert.equal((await x.done('code_apply_change',a)).operationId,changed.operationId);
 const read=await x.done('object_read',{...target(x.s),objectId:fb});assert.equal(read.data.declaration,parent(fb,'FB_State').declaration);
 const search=await x.done('project_search',{...target(x.s),query:'ReadState',matchMode:'identifier',areas:['declaration','implementation'],caseSensitive:false,offset:0,limit:1,maxResults:20});assert.equal(search.status,'succeeded',JSON.stringify(search));assert.equal(search.data.matches[0].objectType,'method');assert.equal(search.data.matches[0].parentId,fb);
 if(search.data.page.hasMore){const page=await x.done('project_search',{...target(x.s),query:'ReadState',matchMode:'identifier',areas:['declaration','implementation'],caseSensitive:false,offset:search.data.page.nextOffset,expectedVersion:search.data.version,limit:1,maxResults:20});assert.equal(page.status,'succeeded',JSON.stringify(page));}
 const vars=await x.done('variable_inspect',{...target(x.s),objectId:created.data.objectId});assert.equal(vars.status,'succeeded',JSON.stringify(vars));assert(vars.data.entries.some(e=>e.category==='method-return'&&e.typeRaw==='DINT'));
 const after=await x.done('project_compare',{...target(x.s),mode:'capture',requestId:'after'}),comp=await x.done('project_compare',{...target(x.s),mode:'compare',baselineOperationId:base.operationId,targetOperationId:after.operationId});assert.equal(comp.status,'succeeded',JSON.stringify(comp));assert(comp.data.items.some(i=>i.objectType==='method'&&i.category==='added'));
 const newBuild=await x.done('project_build',{...target(x.s),requestId:'new-build'}),save=await x.done('project_save',{...target(x.s),requestId:'save',expectedSnapshot:newBuild.data.snapshot});assert.equal(save.status,'succeeded');
});
test('Wrong/cross-app/non-FB parent, stale parent/children version and disk change reject',async t=>{
 const x=await env();t.after(()=>x.service.store.release());
 for(const parentId of [obj,fbOther,randomUUID()]){const r=await x.done('method_create',{...request(x,x.opened.data),parentId});assert.equal(r.status,'unsupported',JSON.stringify(r));}
 const stale=await x.done('method_create',{...request(x,x.opened.data),expectedParentHash:'0'.repeat(64)});assert.equal(stale.error.code,'METHOD_PARENT_VERSION_CHANGED');
 const seen=x.seen.length,bad=await x.done('method_create',{...request(x,x.opened.data),declaration:header('Wrong')});assert.equal(bad.error.code,'INVALID_METHOD_DECLARATION');assert.equal(x.seen.length,seen);
 await appendFile(x.s.workingPath,' ');const disk=await x.done('method_create',request(x,x.opened.data));assert.equal(disk.status,'conflict');assert.equal(x.seen.length,seen);
});
test('Method readonly and forbidden header/parent changes leave source intact',async t=>{
 const x=await env();t.after(()=>x.service.store.release());const r=await x.done('method_create',request(x,x.opened.data)),before=await readFile(x.s.workingPath);
 for(const change of [{parentId:fb2},{declaration:header('Renamed')},{declaration:'METHOD PUBLIC ReadState\nVAR_INPUT\nEND_VAR'},{declaration:'METHOD PRIVATE ReadState : DINT'}]){
  const q=await x.done('code_apply_change',{...target(x.s),requestId:randomUUID(),objectType:'method',parentId:fb,objectId:r.data.objectId,expectedHash:r.data.contentHash,declaration:header('ReadState'),implementation:'ReadState := State;',...change});assert.equal(q.status,'unsupported',JSON.stringify(q));assert.deepEqual(await readFile(x.s.workingPath),before);
 }
 const y=await env({methodPermissionDenied:true});t.after(()=>y.service.store.release());const denied=await y.done('method_create',request(y,y.opened.data));assert.equal(denied.error.code,'METHOD_PARENT_OR_PERMISSION');assert.equal((JSON.parse(await readFile(y.s.workingPath))).objects.length,5);
});
test('Method save/reopen/readback uncertainty and corrupt successful evidence freeze original request',async()=>{
 for(const flag of ['failMethodSave','failMethodReopen','failMethodReadback']){
  const x=await env({[flag]:true});try{const a=request(x,x.opened.data),r=await x.done('method_create',a);assert.equal(r.status,'unknown');assert.equal((await x.service.status()).data.writeFrozen,true);assert.equal((await x.done('method_create',a)).operationId,r.operationId);await assert.rejects(()=>x.done('method_create',{...a,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');}finally{await x.service.store.release();}
 }
 for(const corrupt of [d=>d.parentId=fb2,d=>d.nativeTypeId=app,d=>d.factoryEvidence.arguments[1]='INT',d=>d.methodReturnType='void']){
  const x=await env({},(r,q)=>{if(q.command==='create_method'&&r.status==='succeeded')corrupt(r.data);});try{const r=await x.done('method_create',request(x,x.opened.data));assert.equal(r.status,'unknown',JSON.stringify(r));}finally{await x.service.store.release();}
 }
});
test('Method declaration variables preserve UTF-16 positions and return is distinct',()=>{
 const s="METHOD PUBLIC ReadState : DINT\nVAR_INPUT\n Value : DINT := 7; // 中文\nEND_VAR\nVAR\n Text : STRING := '😀;';\nEND_VAR";
 const p=parseDeclaration(s,'method','ReadState');assert.equal(p.complete,true);assert.equal(p.rows.filter(r=>r.category==='method-return').length,1);
 for(const r of p.rows.filter(r=>r.category==='variable'))assert.equal(s.slice(r.namePosition.startOffset,r.namePosition.endOffset),r.name);
 assert.equal(parseDeclaration(s.replace('PUBLIC','PRIVATE'),'method','ReadState').complete,false);
});
test('Method comparison preserves full parent paths and marks old skipped/changed-parent identity incomparable',()=>{
 const identity={applicationPath:['App']},m={objectId:randomUUID(),parentId:fb,parentPath:['App','FB_A'],objectType:'method',nativeTypeId:'f8a58466-d7f6-439f-bbb8-d4600e41d099',path:['App','FB_A','ReadState'],hasImplementation:true,declaration:header('ReadState'),implementation:'ReadState := 7;'};
 const snap=(objects,skippedObjects=[])=>({identity,objects,tasks:[],scope:{coverageComplete:true,skippedObjects},taskCoverage:{complete:true}});
 const old=snap([],[{nativeTypeId:m.nativeTypeId,path:m.path}]),now=snap([m]);assert.equal(comparisonItems(old,now)[0].category,'incomparable');
 assert.equal(comparisonItems(now,snap([{...m,parentId:fb2}]))[0].category,'incomparable');
 const sameName={...m,objectId:randomUUID(),parentId:fb2,parentPath:['App','FB_B'],path:['App','FB_B','ReadState']};assert.equal(comparisonItems(snap([m,sameName]),snap([m,sameName])).length,2);
});
for(const tool of ['project_search','variable_inspect'])test(tool+': legitimate old skipped-Method pages conflict, damaged evidence freezes; neither redispatches',async()=>{
 for(const corrupt of [false,true]){
  const unsupported={objectId:randomUUID(),parentId:fb,applicationId:app,path:['设备','应用一','FB_State','Unsupported'],objectType:'method',nativeTypeId:'f8a58466-d7f6-439f-bbb8-d4600e41d099',declaration:'METHOD PUBLIC Unsupported : BOOL',implementation:'Unsupported := TRUE;'};
  const x=await env({objects:[unsupported]},async(r,q,dir)=>{
   if(q.command!=='search'||r.status!=='succeeded')return;
   // Explicit historical-native-inventory fixture, not an IDE result.
   const s=r.data.scope;delete s.methodCoverageVersion;delete s.unsupportedChildren;s.coverageComplete=s.treeComplete&&s.readFailures.length===0;
   s.skippedObjects=s.skippedObjects.map(o=>({...o,stage:'unsupported-type',reason:'Old fixture reader skipped native Method'}));
   for(const name of ['result.json','observed-after-exit.json'])await writeFile(path.join(dir,name),JSON.stringify(r));
  });
  try{
   const q={...target(x.s),offset:0,limit:1,...(tool==='project_search'?{query:'State',areas:['declaration','implementation'],matchMode:'literal',maxResults:20}:{})},first=await x.done(tool,q);assert.equal(first.status,'succeeded',JSON.stringify(first));
   if(corrupt){const op=await x.service.store.operation(first.operationId),file=path.join(op.bridge.directory,'observed-after-exit.json'),raw=JSON.parse(await readFile(file));raw.data.corpus[0].declaration+=' damaged';await writeFile(file,JSON.stringify(raw));}
   const seen=x.seen.length,r=await x.done(tool,{...q,offset:1,expectedVersion:first.data.version});assert.equal(r.status,corrupt?'unknown':'conflict',JSON.stringify(r));assert.equal(x.seen.length,seen);assert.equal((await x.service.status()).data.writeFrozen,corrupt);
   if(!corrupt)assert.equal(r.error.code,'METHOD_COVERAGE_UPGRADE');
  }finally{await x.service.store.release();}
 }
});


test('Actual MCP stdio validates native Method comparison output, not only direct service results',async t=>{
 const e=await seed(),c=await connect(e.dataDir,{INOPRO_RESPONSE_WAIT_MS:'1000'});t.after(()=>c.client.close());
 const call=async(name,args)=>{const raw=await c.client.callTool({name,arguments:args});assert(!raw.isError,JSON.stringify(raw));return c.done(raw.structuredContent);};
 const opened=await call('project_open_copy',{requestId:'open-method-schema',sourcePath:e.source,applicationId:app});assert.equal(opened.status,'succeeded');
 const s=opened.data.session,target={projectId:s.projectId,applicationId:app};
 const baseline=await call('project_compare',{...target,mode:'capture',requestId:'schema-before'});
 const r=await call('method_create',request({s},opened.data));assert.equal(r.status,'succeeded');
 const after=await call('project_compare',{...target,mode:'capture',requestId:'schema-after'});
 const result=await call('project_compare',{...target,mode:'compare',baselineOperationId:baseline.operationId,targetOperationId:after.operationId});assert.equal(result.status,'succeeded');assert(result.data.items.some(i=>i.objectType==='method'&&i.parentId===fb));
});
