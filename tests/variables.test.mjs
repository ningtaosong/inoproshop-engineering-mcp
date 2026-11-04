import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';import path from 'node:path';import {z} from 'zod';
import {parseDeclaration,variableResult} from '../dist/variables.js';
import {schemas,outputSchemas,variableDataSchema} from '../dist/contracts.js';
import {setup,connect,app,app2,obj,obj2} from './helpers.mjs';
import {digest,codeHash} from '../dist/storage.js';

const declarations=p=>p.rows.filter(r=>['variable','type-field'].includes(r.category));
test('ordered read lexer, original UTF-16 ranges, multiline/multiple declarations and opaque initialization',()=>{
 const s=`PROGRAM Main
(* ' " (* nested *) // *)
VAR CONSTANT RETAIN
    中文, Other : ARRAY [1..3] OF My.Type :=
        [(Text := 'a;,(*$'//*)', V := 1), (V := 2)];
    Instance : FB_Test;
    地址 AT %MX0.0 : BOOL := TRUE;
    S : STRING(200) := 'literal '' quote $' ; , // (* *)';
END_VAR
VAR_INPUT
    Input : TIME := T#7s;
END_VAR
VAR_OUTPUT
    Output : BOOL;
END_VAR
VAR_IN_OUT
    Shared : ST_Config;
END_VAR
`;
 const p=parseDeclaration(s,'st_pou','Main');assert(p.complete,JSON.stringify(p));
 const rows=declarations(p);assert.deepEqual(rows.map(r=>r.name),['中文','Other','Instance','地址','S','Input','Output','Shared']);
 assert.equal(rows[0].typeRaw,'ARRAY [1..3] OF My.Type');assert.deepEqual(rows[0].modifiers,['CONSTANT','RETAIN']);assert(rows[0].initializerRaw.includes("a;,(*$'//*)"));
 assert.equal(rows[2].hasExplicitInitializer,false);assert.equal(rows[2].initializerRaw,null);assert.equal(rows[3].addressRaw,'%MX0.0');
 assert.equal(rows.at(-1).section,'VAR_IN_OUT');assert.equal(rows.at(-2).section,'VAR_OUTPUT');
 for(const r of rows){for(const [key,field] of [['namePosition','name'],['typePosition','typeRaw'],['initializerPosition','initializerRaw'],['addressPosition','addressRaw'],['position','source']])if(r[key])assert.equal(s.slice(r[key].startOffset,r[key].endOffset),r[field],r.name+' '+field);}
 assert(p.rows.some(r=>r.category==='comment'&&r.source.includes('nested')));
});

test('global aggregation, type fields, function return are separate and no instance/default expansion',()=>{
 const g=parseDeclaration('VAR_GLOBAL\nConfig : ST_Config := (Delay := T#9s, Text := \'a,b;\');\nNone : ST_Config;\nEND_VAR','gvl','GVL');assert(g.complete);
 assert.equal(declarations(g)[0].initializerRaw,"(Delay := T#9s, Text := 'a,b;')");assert.equal(declarations(g)[1].initializerRaw,null);
 const s=parseDeclaration('TYPE ST_Config : STRUCT Delay : TIME := T#3s; X : INT; END_STRUCT END_TYPE','structure','ST_Config');assert(s.complete);assert(declarations(s).every(x=>x.category==='type-field'));
 const f=parseDeclaration('FUNCTION F_Test : DINT\nVAR_INPUT\n Value : DINT;\nEND_VAR','st_pou','F_Test');assert(f.complete);assert.equal(f.rows[0].category,'function-return');assert.equal(f.rows[0].typeRaw,'DINT');assert.equal(declarations(f).length,1);
 for(const kind of ['enum','array'])assert.equal(parseDeclaration('not variable instances',kind,'T').rows.length,0);
});

test('uncertain lexical/delimiter boundaries and unsupported forms give gaps, never mine subsequent text',()=>{
 const prefix='PROGRAM Main\nVAR\n Good : DINT;\n';
 for(const body of ["Broken : STRING := 'unterminated; Fake : DINT; END_VAR",'(* unclosed \' *) (* nested never closes\n Fake : DINT; END_VAR','Broken : DINT := (1; Fake : DINT; END_VAR','Broken : DINT := [1); Fake : DINT; END_VAR']){
  const p=parseDeclaration(prefix+body,'st_pou','Main');assert(!p.complete);assert.deepEqual(declarations(p).map(x=>x.name),['Good']);assert(p.rows.some(x=>x.category==='parse-gap'&&x.position));
 }
 for(const text of ['PROGRAM Main\nVAR_TEMP\n Fake : DINT;\nEND_VAR\nVAR\n Later : DINT;\nEND_VAR',"{attribute 'x'} PROGRAM Main\nVAR X : DINT; END_VAR"]){const p=parseDeclaration(text,'st_pou','Main');assert(!p.complete);assert.equal(declarations(p).length,0);}
 const p=parseDeclaration(prefix+'Bad : POINTER TO DINT;\n Good2 : BOOL;\nEND_VAR','st_pou','Main');assert(!p.complete);assert.deepEqual(declarations(p).map(x=>x.name),['Good','Good2']);
 assert(parseDeclaration('PROGRAM Main\nVAR\nS : WSTRING := "😀;,//(*$"*)";\nEND_VAR','st_pou','Main').complete);
});

async function ctx(t,extra={}){
 const objects=[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:'PROGRAM Main\nVAR\n X : DINT := 7;\nEND_VAR',implementation:''},
  {objectId:obj2,applicationId:app,path:['设备','应用一','FB_Test'],declaration:'FUNCTION_BLOCK FB_Test\nVAR_INPUT X : BOOL; END_VAR\nVAR_OUTPUT Alarm : BOOL := FALSE; END_VAR',implementation:''}];
 const e=await setup({objects,...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const o=await c.done(await c.call('project_open_copy',{sourcePath:e.source,requestId:'open',applicationId:app}));assert.equal(o.status,'succeeded');
 const target={projectId:o.data.session.projectId,applicationId:app};return {e,c,s:o.data.session,target,call:async a=>c.done(await c.call('variable_inspect',{...target,...a}))};
}
test('twenty tools; all nineteen existing contracts unchanged; precise read-only input/output schema',async t=>{
 const x=await ctx(t);const tools=(await x.c.client.listTools()).tools;assert.equal(tools.length,20);assert(tools.find(x=>x.name==='variable_inspect').annotations.readOnlyHint);
 const old=JSON.parse(await readFile('tests/fixtures/variable-legacy-contracts.json','utf8'));assert.equal(old.tools.length,19);
 for(const t of old.tools){assert.deepEqual(z.toJSONSchema(schemas[t.name],{io:'input'}),t.inputSchema,t.name+' input');assert.deepEqual(z.toJSONSchema(outputSchemas[t.name]),t.outputSchema,t.name+' output');}
 for(const a of [{applicationId:null},{targetKind:'pool'},{limit:101},{write:true},{maxObjects:0},{sourceRead:{objectId:obj,offset:-1}}])assert(!schemas.variable_inspect.safeParse({...x.target,...a}).success);
 assert(variableDataSchema.safeParse((await x.call({})).data).success);
});
test('same-name scopes, exact object/name filtering, paging/version/restart and no native re-read',async t=>{
 const x=await ctx(t),bytes=await readFile(x.s.workingPath),r=await x.call({limit:1});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.basis,'declaration-parsing');
 let rows=[...r.data.entries],page=r;
 while(page.data.page.hasMore){page=await x.call({limit:1,offset:page.data.page.nextOffset,expectedVersion:r.data.version});assert.equal(page.status,'succeeded',JSON.stringify(page));assert.equal(page.data.readOrigin.inventoryOperationId,r.operationId);rows.push(...page.data.entries);}
 assert.equal(rows.filter(e=>e.name==='X').length,2);assert.equal(new Set(rows.filter(e=>e.name==='X').map(e=>e.objectId)).size,2);
 assert.equal((await x.call({offset:1})).error.code,'NATIVE_PAGE_VERSION_REQUIRED');
 assert.equal((await x.call({offset:1,expectedVersion:r.data.version,name:'X'})).error.code,'NATIVE_VERSION_CHANGED');
 const filtered=await x.call({objectId:obj2,name:'x'});assert.equal(filtered.data.entries.filter(e=>e.category==='variable').length,1);assert.equal(filtered.data.entries.find(e=>e.name==='X').hasExplicitInitializer,false);
 assert.equal((await x.call({name:'absent'})).data.noMatchConclusion,'no-matching-declarations-in-supported-scope');
 await x.c.client.close();const c=await connect(x.e.dataDir);t.after(()=>c.client.close());const after=await c.done(await c.call('variable_inspect',{...x.target,limit:1,offset:1,expectedVersion:r.data.version}));assert.equal(after.status,'succeeded');assert.equal(after.data.readOrigin.inventoryOperationId,r.operationId);
 assert.deepEqual(await readFile(x.s.workingPath),bytes);
 const ops=await Promise.all((await readdir(path.join(x.e.dataDir,'operations'))).map(async n=>JSON.parse(await readFile(path.join(x.e.dataDir,'operations',n))).value));
 assert.equal(ops.filter(o=>o.tool==='variable_inspect'&&o.args.expectedVersion&&o.bridge).length,0);
});
test('long initializer/comments are explicit previews; same-version sourceRead reconstructs exact text and SHA',async t=>{
 const source="PROGRAM Main\nVAR\nX : STRING := '"+'😀中文;,(*//'.repeat(900)+"'; (* "+'long注释'.repeat(1000)+' *)\nEND_VAR';
 const x=await ctx(t,{objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:source,implementation:''}]}),r=await x.call({});assert.equal(r.status,'succeeded',JSON.stringify(r));assert(Buffer.byteLength(JSON.stringify(r))<16000);
 const variable=r.data.entries.find(e=>e.category==='variable');assert(variable.hasExplicitInitializer);assert.equal(variable.initializerRaw,null);assert(variable.previews.initializerRaw);
 let offset=0,full='';do{const q=await x.call({expectedVersion:r.data.version,sourceRead:{objectId:obj,offset,limit:997}});assert.equal(q.status,'succeeded',JSON.stringify(q));const d=q.data.sourceDetail;assert.equal(d.sha256,digest(source));full+=d.text;offset=d.nextOffset;}while(offset!==null);
 assert.equal(full,source);assert.equal((await x.call({sourceRead:{objectId:obj}})).error.code,'NATIVE_PAGE_VERSION_REQUIRED');
});
test('partial parsing, failures, missing object and both kinds of truncation cannot assert completeness/absence',async t=>{
 const x=await ctx(t,{objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:'PROGRAM Main\nVAR\n X : DINT;\n Bad : DINT := (1;\nEND_VAR',implementation:''}],treeReadError:'failed subtree'});
 const r=await x.call({name:'absent'});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.coverage.objectEnumerationComplete,false);assert.equal(r.data.coverage.declarationParseComplete,false);assert.equal(r.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');assert(r.data.entries.some(e=>e.category==='parse-gap'));
 assert.equal((await x.call({objectId:obj2})).data.coverage.supportedScopeComplete,false);
 const y=await ctx(t);const short=await y.call({maxEntries:1});assert(short.data.page.truncated);assert.equal(short.data.page.total,null);const cap=await y.call({maxObjects:1});assert(cap.data.coverage.objectsTruncated);assert.equal(cap.data.coverage.supportedScopeComplete,false);
});
test('GVL/type-field/table provenance, comment association and source read failure stay separate',async t=>{
 const sid='40000000-0000-4000-8000-000000000004',aid='40000000-0000-4000-8000-000000000005';
 const objects=[
  {objectId:obj,applicationId:app,path:['设备','应用一','GVL_Config'],objectType:'gvl',declaration:'VAR_GLOBAL RETAIN\nConfig : ST_Config := (Delay := T#8s);\nMissing : INT;\nEND_VAR',implementation:''},
  {objectId:sid,applicationId:app,path:['设备','应用一','ST_Config'],objectType:'structure',declaration:"TYPE ST_Config : STRUCT\n Delay (* ' 😀 *) : TIME := T#3s;\nEND_STRUCT END_TYPE",implementation:''},
  {objectId:aid,applicationId:app,path:['设备','应用一','T_Array'],objectType:'array',declaration:'TYPE T_Array : ARRAY [1..3] OF DINT; END_TYPE',implementation:''}];
 const x=await ctx(t,{objects}),r=await x.call({});assert.equal(r.status,'succeeded',JSON.stringify(r));assert(r.data.coverage.supportedScopeComplete);
 assert.equal(r.data.counts.variable,2);assert.equal(r.data.counts['type-field'],1);assert.equal(r.data.coverage.excludedDefinitions.length,1);
 const f=r.data.entries.find(x=>x.category==='type-field');assert.equal(f.initializerRaw,'T#3s');const c=r.data.entries.find(x=>x.category==='comment');assert.equal(c.association,'within-single-name-declaration');assert.equal(c.associatedName,'Delay');
 const fail=await ctx(t,{objects:[...objects,{objectId:obj2,applicationId:app,path:['设备','应用一','Unread'],declaration:'PROGRAM Unread',implementation:'',queryReadError:'getter unavailable'}]});
 const q=await fail.call({name:'absent'});assert.equal(q.status,'succeeded');assert.equal(q.data.coverage.sourceReadComplete,false);assert(q.data.scope.readFailures.length);assert.equal(q.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');
 const normalized=parseDeclaration('PROGRAM P\r\nVAR\r\n 中文 : DINT;\r\nEND_VAR','st_pou','P');assert.equal(declarations(normalized)[0].namePosition.line,3);assert.equal(declarations(normalized)[0].namePosition.column,2);
});
test('read mutation/corrupt evidence freezes; content conflicts and cross-engine/project targets never mix pages',async t=>{
 const x=await ctx(t),r=await x.call({limit:1});
 assert.equal((await x.call({applicationId:app2})).error.code,'TARGET_MISMATCH');
 const b=path.join(x.e.dir,'B.json');await writeFile(b,await readFile(x.e.source));const o=await x.c.done(await x.c.call('project_open_copy',{requestId:'B',sourcePath:b,applicationId:app}));
 assert.equal((await x.call({})).error.code,'PROJECT_NOT_ACTIVE');assert.equal((await x.call({projectId:o.data.session.projectId,expectedVersion:r.data.version,offset:1})).error.code,'NATIVE_VERSION_CHANGED');
 const y=await ctx(t,{readMutatesFile:true});const bad=await y.call({});assert.equal(bad.status,'unknown');assert.equal((await y.c.call('session_status')).data.globalFrozen,true);assert.equal((await y.c.call('operation_status',{operationId:bad.operationId})).status,'unknown');
 const zed=await ctx(t),orig=await zed.call({limit:1});const p=path.join(zed.e.dataDir,'ipc',orig.operationId,'observed-after-exit.json');const raw=JSON.parse(await readFile(p));raw.data.corpus[0].declaration+=' ';await writeFile(p,JSON.stringify(raw));assert.equal((await zed.call({offset:1,expectedVersion:orig.data.version})).status,'unknown');
 const changed=await ctx(t),first=await changed.call({limit:1});await writeFile(changed.s.workingPath,(await readFile(changed.s.workingPath,'utf8'))+' ');assert.equal((await changed.call({offset:1,expectedVersion:first.data.version})).error.code,'READ_DISK_CHANGED');
});
