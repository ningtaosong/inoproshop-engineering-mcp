import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';import path from 'node:path';
import {parseDeclaration,variableResult} from '../dist/variables.js';
import {searchResult} from '../dist/queries.js';
import {schemas} from '../dist/contracts.js';
import {Store,canonical,digest} from '../dist/storage.js';
import {setup,connect,app,obj} from './helpers.mjs';
const cases=JSON.parse(await readFile('tests/fixtures/variable-boundaries.json','utf8'));
const vars=p=>p.rows.filter(r=>['variable','type-field'].includes(r.category));
const gaps=p=>p.rows.filter(r=>r.category==='parse-gap');
const parse=c=>parseDeclaration(c.source,c.kind,c.objectName);
test('missing semicolon cannot turn a following declaration into a trusted initializer',()=>{
 for(const tail of ['Y : BOOL := FALSE','Y, Z : ARRAY [1..3] OF DINT','Y AT %MX0.0 : BOOL']){
  const source='PROGRAM Main\nVAR\nGood : INT;\nX : DINT := 1\n'+tail+';\nEND_VAR';
  const p=parseDeclaration(source,'st_pou','Main');assert.equal(p.complete,false);assert.deepEqual(vars(p).map(r=>r.name),['Good']);
  assert(gaps(p).some(r=>r.source.includes('X : DINT')&&r.position.line===4));
 }
 const p=parse(cases[0]);assert.equal(p.complete,false);assert.deepEqual(vars(p),[]);assert(gaps(p).length);
});
test('unsupported inline/nested/unclosed compound types never leak inner fields into local scope',()=>{
 for(const body of ['Payload : STRUCT A : DINT; B : BOOL; END_STRUCT; Tail : INT;',
  'Payload : STRUCT A : STRUCT X : INT; Y : BOOL; END_STRUCT; B : BOOL; END_STRUCT; Tail : INT;',
  'Payload : UNION A : DINT; B : BOOL; END_UNION; Tail : INT;',
  'Payload : STRUCT A : DINT; B : BOOL;',
  'Payload : ARRAY [1..3] OF STRUCT A : DINT; B : BOOL; END_STRUCT; Tail : INT;']){
  const p=parseDeclaration('PROGRAM Main\nVAR\nGood : DINT;\n'+body+'\nEND_VAR','st_pou','Main');
  assert.equal(p.complete,false);assert.deepEqual(vars(p).map(r=>r.name),['Good']);assert(gaps(p).some(g=>g.source.includes('Payload')));
 }
 const p=parse(cases[1]);assert.deepEqual(vars(p).map(r=>r.name),['Good']);
 const fields=parseDeclaration('TYPE S : STRUCT Good : INT; Payload : STRUCT A : INT; B : BOOL; END_STRUCT; END_STRUCT END_TYPE','structure','S');
 assert.equal(fields.complete,false);assert.deepEqual(vars(fields).map(r=>r.name),['Good']);assert.equal(vars(fields)[0].category,'type-field');
});
test('missing END_VAR cannot reclassify a new section, including unsupported sections',()=>{
 for(const section of ['VAR_INPUT','VAR_OUTPUT','VAR_IN_OUT','VAR_TEMP','VAR_EXTERNAL'])for(const separator of ['','Broken : INT := 1\n']){
  const p=parseDeclaration('PROGRAM Main\nVAR\nGood : DINT;\n'+separator+section+'\nInput : BOOL;\nAnother : DINT;\nEND_VAR','st_pou','Main');
  assert.equal(p.complete,false);assert.deepEqual(vars(p).map(r=>[r.name,r.section]),[['Good','VAR']]);assert(gaps(p).some(r=>r.source.includes(section)));
 }
});
test('exact keywords preserve VAR_-prefixed types/names and do not open unsupported sections',()=>{
 const p=parse(cases[2]);assert.equal(p.complete,true);assert.equal(p.rows[0].category,'function-return');assert.equal(p.rows[0].typeRaw,'VAR_Result');assert.equal(vars(p)[0].section,'VAR_INPUT');
 const source='PROGRAM Main\nVAR\nVAR_Local, Other : VAR_Result;\nVAR_Value : Vendor.VAR_Type;\nEND_VAR';
 const q=parseDeclaration(source,'st_pou','Main');assert(q.complete);assert.deepEqual(vars(q).map(r=>r.name),['VAR_Local','Other','VAR_Value']);
 for(const s of ['VAR_TEMP','VAR_EXTERNAL']){const p=parseDeclaration('FUNCTION F : VAR_Result\n'+s+'\nX : INT;\nEND_VAR','st_pou','F');assert.equal(p.complete,false);assert.equal(p.rows[0].category,'function-return');assert.equal(vars(p).length,0);assert(gaps(p).some(g=>g.reason.includes('Unsupported declaration section')));}
 const qualified=parseDeclaration('FUNCTION F : Vendor.VAR_TEMP\nVAR_INPUT X : My.Type; END_VAR','st_pou','F');assert(qualified.complete);assert.equal(qualified.rows[0].typeRaw,'Vendor.VAR_TEMP');
});
test('valid aggregate/array/named argument/time/string/comment boundaries and original UTF-16 positions remain intact',()=>{
 const source=`PROGRAM Main\r\n(* ' " (* nested *) *)\r\nVAR RETAIN\r\n中文, Other : ARRAY [1..3] OF DINT := [1, 2, 3];\r\nConfig : VAR_Settings := (Delay := T#1h2m3s, Text := 'a;,:=(*//', Inner := (X := 1, Y := 2));\r\nTimeOfDay : TOD := TOD#12:34:56;\r\nSpan : TIME := T#1h2m3s;\r\nResult : DINT := F(Value := 1, Other := 2);\r\nS : STRING := '😀'';$' , : (*';\r\nEND_VAR\r\nVAR_INPUT\r\nOther : VAR_Result;\r\nEND_VAR`;
 const s=source.replace(/\r\n?/g,'\n'),p=parseDeclaration(source,'st_pou','Main');assert(p.complete,JSON.stringify(p));assert.equal(vars(p).length,8);
 assert.equal(vars(p).find(r=>r.name==='TimeOfDay').initializerRaw,'TOD#12:34:56');
 assert.equal(vars(p).find(r=>r.name==='Config').initializerRaw,"(Delay := T#1h2m3s, Text := 'a;,:=(*//', Inner := (X := 1, Y := 2))");
 for(const row of vars(p))for(const [key,field] of [['position','source'],['namePosition','name'],['typePosition','typeRaw'],['initializerPosition','initializerRaw']])if(row[key])assert.equal(s.slice(row[key].startOffset,row[key].endOffset),row[field]);
 assert.equal(vars(p).filter(r=>r.name==='Other').length,2);assert(p.rows.some(r=>r.category==='comment'));
});
async function context(t,source){
 const e=await setup({objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:source,implementation:''}]}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call('project_open_copy',{sourcePath:e.source,requestId:'open',applicationId:app}));assert.equal(opened.status,'succeeded');
 const target={projectId:opened.data.session.projectId,applicationId:app};return {e,c,target,call:async a=>c.done(await c.call('variable_inspect',{...target,...a}))};
}
test('name filtering keeps boundary gaps and cannot assert definitive absence',async t=>{
 for(const c of [cases[0],cases[1],cases[3]]){
  const x=await context(t,c.source),r=await x.call({name:c===cases[1]?'B':'Y'});assert.equal(r.status,'succeeded');
  assert.equal(r.data.coverage.declarationParseComplete,false);assert.equal(r.data.coverage.supportedScopeComplete,false);
  assert.equal(r.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');assert(r.data.entries.some(r=>r.category==='parse-gap'));assert.equal(r.data.counts.variable,0);
 }
});
test('old parser continuation conflicts without freezing or dispatch; corrupt evidence still freezes',async t=>{
 const source='PROGRAM Main\nVAR X : INT; Y : BOOL; END_VAR',x=await context(t,source),r=await x.call({limit:1});
 assert.equal(r.data.parserVersion,'declaration-variables-v2');
 const store=new Store(x.e.dataDir),op=await store.operation(r.operationId),raw=JSON.parse(await readFile(path.join(op.bridge.directory,'observed-after-exit.json'),'utf8'));
 const validated=searchResult(raw,{...op.args,query:'\0variable-inventory-validation',areas:['name'],caseSensitive:true,offset:0,limit:1,maxResults:1}).data;
 // Persist the exact v1 digest layout and lack of parserVersion as a legacy-record fixture.
 const legacy=digest(canonical({parser:'declaration-variables-v1',sourceVersion:validated.version,objectId:op.args.objectId??null,name:op.args.name??null,caseSensitive:op.args.caseSensitive,maxObjects:op.args.maxObjects,maxEntries:op.args.maxEntries,coverage:r.data.coverage}));
 op.response.data.version=legacy;delete op.response.data.parserVersion;await store.saveOp(op);const bytes=await readFile(store.file('operations/'+op.operationId+'.json'));
 const old=await x.call({limit:1,offset:1,expectedVersion:legacy});assert.equal(old.status,'conflict');assert.equal(old.error.code,'VARIABLE_PARSER_VERSION_CHANGED');
 const detail=await x.call({expectedVersion:legacy,sourceRead:{objectId:obj,offset:0}});assert.equal(detail.status,'conflict');assert.equal(detail.error.code,'VARIABLE_PARSER_VERSION_CHANGED');
 assert.equal((await x.c.call('session_status')).data.globalFrozen,false);assert.deepEqual(await readFile(store.file('operations/'+op.operationId+'.json')),bytes);
 const fresh=await x.call({limit:1});assert.equal(fresh.status,'succeeded');assert.notEqual(fresh.data.version,legacy);
 const next=await x.call({limit:1,offset:1,expectedVersion:fresh.data.version});assert.equal(next.status,'succeeded');assert.equal(next.data.entries[0].name,'Y');
 assert.equal((await store.operations()).filter(o=>o.tool==='variable_inspect'&&o.args.expectedVersion&&o.bridge).length,0);
 const y=await context(t,source),first=await y.call({limit:1}),s=new Store(y.e.dataDir),o=await s.operation(first.operationId);delete o.response.data.parserVersion;await s.saveOp(o);
 const p=path.join(o.bridge.directory,'observed-after-exit.json'),bad=JSON.parse(await readFile(p,'utf8'));bad.data.corpus[0].declaration+=' broken';await writeFile(p,JSON.stringify(bad));
 assert.equal((await y.call({limit:1,offset:1,expectedVersion:first.data.version})).status,'unknown');assert.equal((await y.c.call('session_status')).data.globalFrozen,true);
 const z=await context(t,source),valid=await z.call({limit:1}),storeZ=new Store(z.e.dataDir),invalid=await storeZ.operation(valid.operationId);invalid.response.data.parserVersion='damaged-version';await storeZ.saveOp(invalid);
 assert.equal((await z.call({limit:1,offset:1,expectedVersion:valid.data.version})).status,'unknown');assert.equal((await z.c.call('session_status')).data.globalFrozen,true);
});
