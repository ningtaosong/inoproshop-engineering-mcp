import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {z} from 'zod';
import {schemas,outputSchemas,searchDataSchema} from '../dist/contracts.js';import {searchResult} from '../dist/queries.js';
import {codeHash,digest,canonical,atomicJson,Store} from '../dist/storage.js';import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {app,app2,obj,obj2,setup,connect} from './helpers.mjs';
import {withoutInitializerMemberExtension} from './contract-compatibility.mjs';
function raw(source,extra={}){
 const corpus=[{objectId:obj,applicationId:app,path:['Device','Application','Main'],objectType:'st_pou',hasImplementation:true,declaration:'PROGRAM Main',implementation:source,contentHash:codeHash('PROGRAM Main',source)},...(extra.corpus??[])];
 return {contractVersion:'1.0.0',status:'succeeded',summary:'synthetic native corpus',operationId:obj2,data:{projectId:app,applicationId:app,targetKind:'application',projectPath:'fixture',diskHash:'a'.repeat(64),readOnlyEvidence:{beforeDiskHash:'a'.repeat(64),afterCloseDiskHash:'a'.repeat(64),postExitDiskHash:'a'.repeat(64),unchanged:true},corpus,
  scope:{description:'fixture supported source only',applicationPath:['Device','Application'],treeComplete:true,eligibleObjects:corpus.length,readObjects:corpus.length,coverageComplete:true,readFailures:[],enumerationFailures:[],skippedObjects:[],...extra.scope}}};
}
const args=(extra={})=>({...schemas.project_search.parse({projectId:app,applicationId:app,query:'Config2'}),matchMode:'identifier',areas:['implementation'],...extra});
test('identifier matches complete words/member components, case and underscores; literal stays a substring search',()=>{
 const source='Config Config2 MyConfig Config_Extra Config20 _Config2 Config2_\nGVL.Config2.DelayTime; config2; CONFIG2;';
 const r=searchResult(raw(source),args());assert.deepEqual(r.data.matches.map(x=>x.matchedText),['Config2','Config2','config2','CONFIG2']);
 assert.deepEqual(searchResult(raw(source),args({query:'Config'})).data.matches.map(x=>x.matchedText),['Config']);
 assert.equal(searchResult(raw(source),args({caseSensitive:true})).data.matches.length,2);
 const literal=searchResult(raw(source),{...args(),query:'Config',matchMode:'literal'});assert(literal.data.matches.length>1);assert.equal(literal.data.matchMode,'literal');
});
test('ordered lexing skips nested comments, quotes/escapes and never joins tokens across removed text',()=>{
 const source=`Config2; (* ' " // Config2 (* nested Config2 *) *)\n'Config2;$'Config2'; "Config2;$"Config2"; // Config2\nCon(* ' *)fig2; Config(* inner *)2; 'a''Config2'; "a""Config2"; Config2;`;
 const r=searchResult(raw(source),args());assert.deepEqual(r.data.matches.map(x=>x.position.startOffset),[0,source.lastIndexOf('Config2')]);assert(r.data.lexicalCoverage.complete);
});
test('identifier input requires a single supported name and explicit source-only regions; default literal remains compatible',()=>{
 const target={projectId:app,applicationId:app,query:'Config2'};
 assert(schemas.project_search.safeParse({...target,matchMode:'identifier',areas:['declaration','implementation']}).success);
 for(const extra of [{areas:['name']},{},{query:'GVL.Config2'},{query:'Config*'},{query:'1Config'},{query:'Config 2'},{query:'Config\u0301'}])assert(!schemas.project_search.safeParse({...target,matchMode:'identifier',areas:['implementation'],...extra,...(Object.keys(extra).length?{}:{areas:undefined})}).success,JSON.stringify(extra));
 assert.equal(schemas.project_search.parse(target).matchMode,'literal');assert(schemas.project_search.safeParse({...target,query:'a+b'}).success);
});
test('unclosed/unsupported input reports a separate lexical gap and prevents definitive absence',()=>{
 for(const tail of ["(* ' Config2", "'Config2",'*) Config2','😀Config2','123Config2','Config2\u0301']){
  const r=searchResult(raw('Good; '+tail),args());assert.equal(r.data.lexicalCoverage.complete,false,tail);assert.equal(r.data.lexicalCoverage.gaps.length,1);
  assert.equal(r.data.matches.length,0,tail);assert.equal(r.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');assert.equal(r.data.page.totalMatches,null);
  assert.equal(r.data.scope.coverageComplete,true);assert.equal(r.data.page.truncated,false);
 }
});
test('other nineteen tool schemas exactly preserve the frozen 0.13.0 contract',async()=>{
 const old=JSON.parse(await readFile('tests/fixtures/identifier-legacy-contracts.json','utf8'));assert.equal(old.tools.length,19);assert.equal(Object.keys(schemas).length,25);
 for(const t of old.tools){const strip=withoutInitializerMemberExtension;assert.deepEqual(strip(z.toJSONSchema(schemas[t.name],{io:'input'})),t.inputSchema,t.name+' input');assert.deepEqual(strip(z.toJSONSchema(outputSchemas[t.name])),t.outputSchema,t.name+' output');}
});
test('Unicode neighbours, supplementary letters, normalized newlines and UTF-16 spans stay original',()=>{
 const original='// 😀中文\r\n中文Config2; Config2中文; 𐐀Config2; Config2; 变量 := config2;\r\n',source=original.replace(/\r\n/g,'\n');
 const r=searchResult(raw(original),args());assert(r.data.lexicalCoverage.complete);assert.deepEqual(r.data.matches.map(x=>x.matchedText),['Config2','config2']);
 for(const m of r.data.matches){const p=m.position;assert.equal(source.slice(p.startOffset,p.endOffset),m.matchedText);assert.equal(source.slice(m.context.startOffset,m.context.endOffset),m.context.text);const pre=source.slice(0,p.startOffset);assert.equal(p.line,pre.split('\n').length);assert.equal(p.column,p.startOffset-pre.lastIndexOf('\n'));}
 assert.equal(searchResult(raw(source),args({query:'变量'})).data.matches.length,1);
 assert.equal(searchResult(raw('𐐀 𐐨'),args({query:'𐐀'})).data.matches.length,2);
});
test('supported numeric/time/based/typed quoted literals do not leak identifier-like literal parts',()=>{
 const source=`Config2; INT#17 REAL#1.25e-2 BOOL#FALSE T#1h_2m_3s D#2026-11-05 16#FF 1.0e-3 STRING#'Config2' WSTRING#"Config2"; T#2s-Config2;`;
 const r=searchResult(raw(source),args());assert.equal(r.data.lexicalCoverage.complete,true,JSON.stringify(r.data.lexicalCoverage));assert.equal(r.data.matches.length,2);
 for(const query of ['FF','FALSE','e','s','STRING'])assert.equal(searchResult(raw(source),args({query})).data.matches.length,0,query);
});
test('same names in different objects/regions are separate; lexical gaps, read gaps and total truncation stay separate',()=>{
 const second={objectId:obj2,applicationId:app,path:['Device','Application','Folder','Main'],objectType:'st_pou',hasImplementation:true,declaration:'PROGRAM Main\nVAR Config2 : INT; END_VAR',implementation:'Config2;',contentHash:codeHash('PROGRAM Main\nVAR Config2 : INT; END_VAR','Config2;')};
 const r=searchResult(raw('Config2; (* unclosed',{corpus:[second],scope:{eligibleObjects:3,coverageComplete:false,readFailures:[{path:['Device','Application','Missing'],stage:'object-read',reason:'fixture'}]}}),args({areas:['declaration','implementation'],limit:1,maxResults:2}));
 assert.equal(r.data.page.returned,1);assert(r.data.page.hasMore);assert(r.data.page.truncated);assert.equal(r.data.page.totalMatches,null);assert.equal(r.data.lexicalCoverage.gaps.length,1);assert.equal(r.data.scope.readFailures.length,1);
 const all=searchResult(raw('Config2;',{corpus:[second]}),args({areas:['declaration','implementation']}));assert.equal(all.data.matches.length,3);assert.deepEqual(new Set(all.data.matches.map(x=>x.objectId)),new Set([obj,obj2]));assert.deepEqual(new Set(all.data.matches.map(x=>x.region)),new Set(['declaration','implementation']));
});
test('query/mode/case/areas/cap/engineering identity and lexer version bind the page version',()=>{
 const r=searchResult(raw('Config2; config2;'),args({limit:1}));
 const next=searchResult(raw('Config2; config2;'),args({limit:1,offset:1,expectedVersion:r.data.version}));assert.equal(next.status,'succeeded');assert.equal(next.data.page.hasMore,false);
 for(const change of [{matchMode:'literal'},{query:'config2'},{caseSensitive:true},{areas:['declaration']},{maxResults:1},{projectId:obj2}])assert.equal(searchResult(raw('Config2; config2;'),args({offset:1,expectedVersion:r.data.version,...change})).error.code,'SEARCH_VERSION_CHANGED',JSON.stringify(change));
});
test('old literal golden result is reproducible only for verifying legacy evidence; current literal still includes comments/strings',async()=>{
 const old=JSON.parse(await readFile('tests/fixtures/identifier-search-legacy.json','utf8'));assert.deepEqual(searchResult(old.raw,old.args,{legacy:true}),old.result);
 const now=searchResult(old.raw,{...old.args,limit:100});assert.equal(now.data.page.totalMatches,3);assert.equal(now.data.lexicalCoverage,undefined);assert.notEqual(now.data.version,old.result.data.version);
});
async function ctx(t,extra={}){
 const e=await setup(extra),c=await connect(e.dataDir);t.after(()=>c.client.close());const opened=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'open'}));assert.equal(opened.status,'succeeded');
 const target={projectId:opened.data.session.projectId,applicationId:app};return {e,c,target,s:opened.data.session,call:async a=>c.done(await c.call('project_search',{...target,...a}))};
}
async function ops(x){return Promise.all((await readdir(path.join(x.e.dataDir,'operations'))).map(async n=>JSON.parse(await readFile(path.join(x.e.dataDir,'operations',n),'utf8')).value));}
test('managed pages reuse one verified IDE corpus and keep the file unchanged; invalid inputs never dispatch',async t=>{
 const x=await ctx(t),before=await readFile(x.s.workingPath),q={query:'计数',matchMode:'identifier',areas:['declaration','implementation'],limit:1};
 let r=await x.call(q);assert.equal(r.status,'succeeded',JSON.stringify(r));assert(searchDataSchema.safeParse(r.data).success);const first=r,rows=[...r.data.matches];
 while(r.data.page.hasMore){r=await x.call({...q,offset:r.data.page.nextOffset,expectedVersion:first.data.version});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.readOrigin.kind,'recorded-inventory');assert.equal(r.data.readOrigin.inventoryOperationId,first.operationId);rows.push(...r.data.matches);}
 assert.equal(rows.length,3);assert.equal((await ops(x)).filter(o=>o.tool==='project_search'&&o.bridge).length,1);assert.deepEqual(await readFile(x.s.workingPath),before);
 const n=(await ops(x)).length;
 for(const bad of [{areas:['name']},{query:'a.b'},{query:'1Bad'}])await assert.rejects(x.call({...q,...bad}));
 assert.equal((await ops(x)).length,n);
 assert.equal((await x.call({...q,query:'other',offset:1,expectedVersion:first.data.version})).error.code,'SEARCH_VERSION_CHANGED');
 assert.equal((await x.call({...q,matchMode:'literal',offset:1,expectedVersion:first.data.version})).error.code,'SEARCH_VERSION_CHANGED');
 assert.equal((await x.c.call('session_status')).data.writeFrozen,false);
});
test('same GUID in another project cannot reuse the first project page; original query stays isolated',async t=>{
 const x=await ctx(t),q={query:'计数',matchMode:'identifier',areas:['declaration','implementation'],limit:1},first=await x.call(q),other=path.join(x.e.dir,'other.json');await writeFile(other,await readFile(x.e.source));
 const opened=await x.c.done(await x.c.call('project_open_copy',{sourcePath:other,applicationId:app,requestId:'other'}));
 const cross=await x.c.done(await x.c.call('project_search',{projectId:opened.data.session.projectId,applicationId:app,...q,offset:1,expectedVersion:first.data.version}));assert.equal(cross.error.code,'SEARCH_VERSION_CHANGED');
 assert.equal((await x.c.call('project_search',{...x.target,...q})).error.code,'PROJECT_NOT_ACTIVE');
});
async function makeLegacy(x){
 const q={query:'计数',areas:['declaration','implementation'],limit:1},first=await x.call(q),store=new Store(x.e.dataDir),o=await store.operation(first.operationId),native=JSON.parse(await readFile(path.join(o.bridge.directory,'observed-after-exit.json'),'utf8'));
 delete o.args.matchMode;o.response={...searchResult(native,o.args,{legacy:true}),requestId:o.requestId};o.fingerprint=digest(canonical({tool:o.tool,args:o.args}));await store.saveOp(o);return{q,store,o};
}
test('verified legitimate old literal pages explicitly conflict without freezing or re-reading the IDE',async t=>{
 const x=await ctx(t),{q,o}=await makeLegacy(x);const r=await x.call({...q,offset:1,expectedVersion:o.response.data.version});assert.equal(r.status,'conflict',JSON.stringify(r));assert.equal(r.error.code,'SEARCH_SCANNER_VERSION_CHANGED');assert.equal((await x.c.call('session_status')).data.writeFrozen,false);
 assert.equal((await ops(x)).filter(o=>o.tool==='project_search'&&o.bridge).length,1);
});
test('corrupt cached original evidence or published result freezes instead of being accepted as a version upgrade',async t=>{
 for(const mutate of ['legacy-root','current-source','current-result','current-query','unknown-lexer']){
  const x=await ctx(t);let q,o,store;
  if(mutate==='legacy-root')({q,o,store}=await makeLegacy(x));else {q={query:'计数',matchMode:'identifier',areas:['declaration','implementation'],limit:1};const f=await x.call(q);store=new Store(x.e.dataDir);o=await store.operation(f.operationId);}
  if(mutate==='legacy-root'||mutate==='current-source'){
   const file=path.join(o.bridge.directory,'observed-after-exit.json'),raw=JSON.parse(await readFile(file,'utf8'));raw.data.projectId=app2;await atomicJson(file,raw);
  }else {if(mutate==='current-result')o.response.data.matches[0].matchedText='corrupt';else if(mutate==='current-query')o.args.query='tampered';else o.response.data.lexerVersion='future-or-corrupt';await store.saveOp(o);}
  const r=await x.call({...q,offset:1,expectedVersion:o.response.data.version});assert.equal(r.status,'unknown',JSON.stringify(r));assert.equal(r.error.code,'SEARCH_EVIDENCE_INVALID');assert.equal((await x.c.call('session_status')).data.writeFrozen,true);assert.equal((await ops(x)).filter(o=>o.tool==='project_search'&&o.bridge).length,1);
 }
});
test('incomplete cached project paths and malformed request/response bindings must remain unknown, never plain failed',async t=>{
 for(const mutate of ['missing-path','bad-source-path','relative-path','bad-areas','missing-areas','response-id','response-state']){
  const x=await ctx(t),q={query:'计数',matchMode:mutate==='missing-areas'?'literal':'identifier',areas:mutate==='missing-areas'?['name','declaration','implementation']:['declaration','implementation'],limit:1},first=await x.call(q),store=new Store(x.e.dataDir),o=await store.operation(first.operationId);
  if(mutate==='missing-path')delete o.project.workingPath;
  if(mutate==='bad-source-path')o.project.sourcePath=17;
  if(mutate==='relative-path'){o.project.workingPath=path.basename(o.project.workingPath);assert.equal(path.isAbsolute(o.project.workingPath),false);}
  if(mutate==='bad-areas')o.args.areas='declaration,implementation';
  if(mutate==='missing-areas')delete o.args.areas;
  if(mutate==='response-id')o.response.operationId=app2;
  if(mutate==='response-state')o.response.status='failed';
  await store.saveOp(o);const r=await x.call({...q,offset:1,expectedVersion:first.data.version});
  assert.equal(r.status,'unknown',mutate+' '+JSON.stringify(r));assert.equal(r.error.code,'SEARCH_EVIDENCE_INVALID');assert.equal((await x.c.call('session_status')).data.writeFrozen,true);
  assert.equal((await ops(x)).filter(o=>o.tool==='project_search'&&o.bridge).length,1);
 }
});

test('0.13 variable tables retain the exact v2 digest and can continue without mixing the new search semantics',async t=>{
 const {variableResult,VARIABLE_PARSER_VERSION}=await import('../dist/variables.js');
 const f=JSON.parse(await readFile('tests/fixtures/identifier-variable-legacy.json','utf8'));
 assert.deepEqual(variableResult(f.raw,f.args),f.result,'Exact baseline v2 result, not merely the same schema');
 const x=await ctx(t,{objects:f.raw.data.corpus.map(o=>({...o,applicationId:app,path:['设备','应用一','Main']}))}),args={...x.target,limit:1},first=await x.c.done(await x.c.call('variable_inspect',args));assert.equal(first.status,'succeeded');assert(first.data.page.hasMore);
 const store=new Store(x.e.dataDir),o=await store.operation(first.operationId),raw=JSON.parse(await readFile(path.join(o.bridge.directory,'observed-after-exit.json'),'utf8'));
 const validated=searchResult(raw,{...o.args,query:'\0variable-inventory-validation',areas:['name'],caseSensitive:true,offset:0,limit:1,maxResults:1},{legacy:true}).data;
 const expected=digest(canonical({parser:VARIABLE_PARSER_VERSION,sourceVersion:validated.version,objectId:o.args.objectId??null,name:o.args.name??null,caseSensitive:o.args.caseSensitive,maxObjects:o.args.maxObjects,maxEntries:o.args.maxEntries,coverage:first.data.coverage}));
 assert.equal(first.data.version,expected,'Keep the original variable-table identity');
 const next=await x.c.done(await x.c.call('variable_inspect',{...args,expectedVersion:expected,offset:first.data.page.nextOffset}));assert.equal(next.status,'succeeded',JSON.stringify(next));
 assert.equal(next.data.readOrigin.kind,'recorded-inventory');assert.equal(next.data.version,expected);
 assert.equal((await ops(x)).filter(o=>o.tool==='variable_inspect'&&o.bridge).length,1);
});
