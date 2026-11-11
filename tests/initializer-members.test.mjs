import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {z} from 'zod';
import {variableResult} from '../dist/variables.js';
import {parseInitializerMembers,INITIALIZER_MEMBER_PARSER_VERSION} from '../dist/initializer-members.js';
import {schemas,outputSchemas,variableDataSchema} from '../dist/contracts.js';
import {codeHash,digest,Store,atomicJson} from '../dist/storage.js';
import {setup,connect,app,obj} from './helpers.mjs';
import {withoutMethodExtension} from './contract-compatibility.mjs';
const fixture=async()=>JSON.parse(await readFile('tests/fixtures/initializer-legacy-variables.json','utf8'));
test('explicit member query keeps parent variables and locates named values',async()=>{
 const f=await fixture(),r=variableResult(f.raw,{...f.pages[0].args,limit:100,includeInitializerMembers:true});
 assert.equal(r.status,'succeeded');const members=r.data.entries.filter(e=>e.category==='initializer-member');
 assert.equal(members.length,4);assert.equal(r.data.counts.variable,3);assert.equal(r.data.memberExtraction.parserVersion,'named-initializer-members-v1');
 for(const x of members){assert(['Config','Config2'].includes(x.parentName));assert(['DelayTime','Text'].includes(x.name));const source=f.raw.data.corpus[0].declaration;for(const [p,key] of [['position','source'],['namePosition','name'],['valuePosition','valueRaw']])assert.equal(source.slice(x[p].startOffset,x[p].endOffset),x[key]);}
});
test('disabled extension preserves every pre-0.15 golden result and page identity',async()=>{
 const f=await fixture();for(const p of f.pages){assert.deepEqual(variableResult(f.raw,p.args),p.result);assert.deepEqual(variableResult(f.raw,{...p.args,includeInitializerMembers:false}),p.result);}
});
const extract=(s,limit)=>parseInitializerMembers(s,0,s.length,limit);
test('outer syntax only; nested calls, arrays and inner aggregates remain whole raw values',()=>{
 const s="(Inner := (X := 1, Y := 2), Items := [1, 2, (X := 3)], Call := F(X := 1, Y := G(2, 3)), Plain := (1+2))",p=extract(s);
 assert(p.complete);assert.equal(p.rows.length,4);assert.deepEqual(p.rows.map(r=>r.name),['Inner','Items','Call','Plain']);
 assert.deepEqual(p.rows.map(r=>r.valueRaw),['(X := 1, Y := 2)','[1, 2, (X := 3)]','F(X := 1, Y := G(2, 3))','(1+2)']);
 for(const s of ['(1 + 2)','(Value)','(F(X := 1))','F(X := 1)','T#3s','[1, 2]','((A := 1))']){const p=extract(s);assert.equal(p.status,'not-named',s);assert.equal(p.rows.length,0);}
});
test('ordered comments, nested quotes/escapes and UTF-16 positions are original source ranges',()=>{
 const prefix='// 中文😀\n',body=`(延时 (* ' " (* nested , := *) *) := (* begin *) T#15s (* end *),\n Text := 'a,($' := ''b' , Wide := "😀,$"),:=", Next := F(a := [1,2]))`,s=prefix+body;
 const p=parseInitializerMembers(s,prefix.length,s.length);assert(p.complete,JSON.stringify(p));assert.equal(p.rows.length,4);
 assert.equal(p.rows[0].valueRaw,'(* begin *) T#15s (* end *)');
 for(const r of p.rows)for(const [key,field] of [['position','source'],['namePosition','name'],['valuePosition','valueRaw']]){
  const v=r[key];assert.equal(s.slice(v.startOffset,v.endOffset),r[field]);assert.equal(v.line,s.slice(0,v.startOffset).split('\n').length);assert.equal(v.column,v.startOffset-s.slice(0,v.startOffset).lastIndexOf('\n'));
 }
 assert.equal(extract('(A := 1 // , := ) ignored\n, B := 2)').rows.length,2);
});
test('ambiguous, mixed, qualified, duplicate and empty inputs remain incomplete, never publish a merged value',()=>{
 for(const s of ['(A := 1 B := 2)','(A := T#1s B := T#2s)','(A := 1, a := 2)','(A := )','(1, 2)','(A := 1, 2)','(GVL.A := 1)','(A := 1,)','()','(A := (1,2] )','(A := 1','(A := 1) trailing','(A := 1; B := 2)',"(A := 'unclosed)",'(A := 1 (* unclosed)']){
  const p=extract(s);assert(!p.complete,s);assert(p.gaps.length,s);assert(p.gaps.every(x=>x.position&&s.slice(x.position.startOffset,x.position.endOffset)===x.source),s);
 }
 assert.equal(extract('(A := 1 B := 2)').rows.length,0);
 const p=extract('(Good := 1, Broken := 2 Other := 3)');assert.deepEqual(p.rows.map(x=>x.name),['Good']);
});
async function pure(source,a={}){const f=await fixture(),raw=structuredClone(f.raw),o=raw.data.corpus[0];o.declaration=source;o.implementation='';o.contentHash=codeHash(source,'');return variableResult(raw,{...f.pages[0].args,limit:100,includeInitializerMembers:true,...a});}
test('no initializer/default expansion; type fields and initializer members have separate categories and counts',async()=>{
 const r=await pure('PROGRAM Main\r\nVAR\r\n None : ST_Config;\r\n Config : ST_Config := (Delay := T#9s);\r\n Ordinary : DINT := (1+2);\r\nEND_VAR');
 assert.equal(r.data.counts.variable,3);assert.equal(r.data.counts['initializer-member'],1);assert.equal(r.data.memberExtraction.absentInitializers,1);assert.equal(r.data.memberExtraction.ordinaryExpressions,1);
 const m=r.data.entries.find(e=>e.category==='initializer-member');assert.equal(m.valueRaw,'T#9s');assert.equal(m.parentCategory,'variable');assert.equal(r.data.entries.find(x=>x.name==='None').initializerRaw,null);
 const f=await fixture(),raw=structuredClone(f.raw),o=raw.data.corpus[0];o.path[o.path.length-1]='Main';o.objectType='structure';o.hasImplementation=false;o.declaration='TYPE Main : STRUCT Field : ST_Config := (Delay := T#2s); END_STRUCT END_TYPE';o.implementation='';o.contentHash=codeHash(o.declaration,'');
 const fields=variableResult(raw,{...f.pages[0].args,includeInitializerMembers:true,limit:100});assert.equal(fields.data.counts.variable,0);assert.equal(fields.data.counts['type-field'],1);assert.equal(fields.data.counts['initializer-member'],1);assert.equal(fields.data.entries.find(e=>e.category==='initializer-member').parentCategory,'type-field');
});
test('member gaps, declaration coverage and name filtering remain distinct; limits are not hidden',async()=>{
 const s='PROGRAM Main\nVAR Config2 : ST_Config := (Delay := 1 Other := 2); END_VAR',r=await pure(s,{name:'Config2'});
 assert(r.data.coverage.declarationParseComplete);assert(!r.data.memberExtraction.completeInParsedParents);assert.equal(r.data.counts.variable,1);assert.equal(r.data.counts['initializer-member'],0);assert.equal(r.data.counts['initializer-member-gap'],1);assert.equal(r.data.page.total,null);
 const filtered=await pure(s,{name:'Delay'});assert.equal(filtered.data.entries.filter(x=>x.category==='initializer-member').length,0);assert.equal(filtered.data.memberExtraction.selectedParents,0,'name filters parents, not members');
 const clipped=await pure('PROGRAM Main\nVAR Config : ST_Config := (A := 1, B := 2, C := 3); END_VAR',{maxInitializerMembers:1});
 assert(clipped.data.memberExtraction.membersTruncated);assert(!clipped.data.memberExtraction.completeInParsedParents);assert(!clipped.data.page.truncated);assert.equal(clipped.data.counts['initializer-member'],1);assert.equal(clipped.data.page.total,null);
 const output=await pure('PROGRAM Main\nVAR Config : ST_Config := (A := 1, B := 2); END_VAR',{maxEntries:1});assert(output.data.page.truncated);assert(!output.data.memberExtraction.membersTruncated);assert.equal(output.data.counts['initializer-member'],2);
 const incomplete=await pure('PROGRAM Main\nVAR Config : ST_Config := (A := 1; END_VAR');assert(!incomplete.data.coverage.declarationParseComplete);assert.equal(incomplete.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');
});
async function context(t,source='PROGRAM Main\nVAR Config : ST_Config := (A := 1, B := 2); END_VAR'){
 const e=await setup({objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:source,implementation:''}]}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opened=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'member-fixture'}));assert.equal(opened.status,'succeeded');
 const q={projectId:opened.data.session.projectId,applicationId:app,includeInitializerMembers:true,limit:1};const call=async a=>c.done(await c.call('variable_inspect',{...q,...a}));return {e,c,q,call,store:new Store(e.dataDir),working:opened.data.session.workingPath};
}
test('twenty-one tools, explicit opt-in; legacy contracts unchanged except additive compare origin',async t=>{
 const x=await context(t),tools=(await x.c.client.listTools()).tools;assert.equal(tools.length,28);assert(tools.find(x=>x.name==='variable_inspect').inputSchema.properties.includeInitializerMembers);
 const old=JSON.parse(await readFile('tests/fixtures/initializer-legacy-contracts.json','utf8'));assert.equal(old.tools.length,19);
 // 0.16 adds current-project to compare origins; retain every pre-existing field/value.
 const legacyCompare=v=>{if(Array.isArray(v))return v.map(legacyCompare);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='enum'&&Array.isArray(x)?x.filter(e=>e!=='current-project'):legacyCompare(x)]));return v;};
 for(const t of old.tools){const input=withoutMethodExtension(z.toJSONSchema(schemas[t.name],{io:'input'})),output=withoutMethodExtension(z.toJSONSchema(outputSchemas[t.name]));assert.deepEqual(t.name==='project_compare'?legacyCompare(input):input,t.inputSchema,t.name);assert.deepEqual(t.name==='project_compare'?legacyCompare(output):output,t.outputSchema,t.name);}
 for(const bad of [{includeInitializerMembers:'true'},{includeInitializerMembers:undefined,maxInitializerMembers:2},{includeInitializerMembers:false,maxInitializerMembers:1},{maxInitializerMembers:0},{maxInitializerMembers:2001},{memberWrite:true}])assert(!schemas.variable_inspect.safeParse({...x.q,...bad}).success,JSON.stringify(bad));
 const r=await x.call({});assert(variableDataSchema.safeParse(r.data).success,JSON.stringify(r));
});
test('member pages are stable, bounded, read-only and cannot mix options, limits, queries or projects',async t=>{
 const x=await context(t),first=await x.call({}),before=await readFile(x.working),all=[...first.data.entries];let page=first;
 while(page.data.page.hasMore){page=await x.call({offset:page.data.page.nextOffset,expectedVersion:first.data.version});assert.equal(page.status,'succeeded',JSON.stringify(page));assert.equal(page.data.readOrigin.inventoryOperationId,first.operationId);all.push(...page.data.entries);}
 assert.equal(all.length,3);assert.equal(all.filter(x=>x.category==='initializer-member').length,2);
 for(const change of [{includeInitializerMembers:false},{maxInitializerMembers:1},{name:'Config'},{caseSensitive:true}]){
  const r=await x.call({offset:1,expectedVersion:first.data.version,...change});assert.equal(r.status,'conflict',JSON.stringify(change));assert.equal(r.error.code,'NATIVE_VERSION_CHANGED');
 }
 const other=await x.c.done(await x.c.call('project_open_copy',{sourcePath:x.e.source+'-copy',requestId:'missing-source'}));assert.notEqual(other.status,'succeeded');
 const cross=await x.call({projectId:'99999999-9999-4999-8999-999999999999',offset:1,expectedVersion:first.data.version});assert.notEqual(cross.status,'succeeded');
 assert.equal((await x.c.call('session_status')).data.globalFrozen,false);assert.deepEqual(await readFile(x.working),before);assert.equal((await x.store.operations()).filter(o=>o.tool==='variable_inspect'&&o.bridge).length,1);
});
test('old v2 pages still continue without member mode; enable requires fresh query, never a native fallback',async t=>{
 const x=await context(t),old=await x.call({includeInitializerMembers:false});const next=await x.call({includeInitializerMembers:false,expectedVersion:old.data.version,offset:0,sourceRead:{objectId:obj,offset:0}});assert.equal(next.status,'succeeded');assert.equal(next.data.version,old.data.version);assert.equal(next.data.memberExtraction,undefined);
 const mixed=await x.call({expectedVersion:old.data.version,offset:1});assert.equal(mixed.status,'conflict');assert.equal(mixed.error.code,'NATIVE_VERSION_CHANGED');
 await x.c.client.close();const c=await connect(x.e.dataDir);t.after(()=>c.client.close());const restart=await c.done(await c.call('variable_inspect',{...x.q,includeInitializerMembers:false,expectedVersion:old.data.version,offset:0,sourceRead:{objectId:obj,offset:0}}));assert.equal(restart.status,'succeeded');assert.equal(restart.data.version,old.data.version);
});
test('long member values use explicit previews and same-version original sourceRead, no silent clipping',async t=>{
 const source="PROGRAM Main\nVAR Config : ST_Config := (Text := '"+'😀中文, := (* )'.repeat(500)+"', Delay := T#3s); END_VAR",x=await context(t,source),first=await x.call({limit:100});assert.equal(first.status,'succeeded');
 let p=first,rows=[...p.data.entries];while(p.data.page.hasMore){p=await x.call({limit:100,expectedVersion:first.data.version,offset:p.data.page.nextOffset});rows.push(...p.data.entries);}
 const member=rows.find(e=>e.category==='initializer-member'&&e.name==='Text');assert.equal(member.valueRaw,null);assert(member.previews.valueRaw);assert(Buffer.byteLength(JSON.stringify(first))<14000);
 let full='',offset=0;do{const page=await x.call({expectedVersion:first.data.version,offset:0,sourceRead:{objectId:obj,offset,limit:999}});assert.equal(page.status,'succeeded');full+=page.data.sourceDetail.text;offset=page.data.sourceDetail.nextOffset;}while(offset!==null);
 assert.equal(full,source);const value=source.slice(member.valuePosition.startOffset,member.valuePosition.endOffset);assert.equal(digest(value),member.previews.valueRaw.sha256);assert.equal(value.length,member.previews.valueRaw.utf16Length);
 assert.equal((await x.store.operations()).filter(o=>o.tool==='variable_inspect'&&o.args.expectedVersion&&o.bridge).length,0);
});
test('changed content is an ordinary conflict; damaged member source/identity/result evidence freezes without recapture',async t=>{
 for(const change of ['disk','source','identity','result','parser']){
  const x=await context(t),r=await x.call({}),o=await x.store.operation(r.operationId),ipc=path.join(o.bridge.directory,'observed-after-exit.json');
  if(change==='disk')await writeFile(x.working,(await readFile(x.working,'utf8'))+' ');
  else if(change==='source'){const raw=JSON.parse(await readFile(ipc,'utf8'));raw.data.corpus[0].declaration+=' Bad';await atomicJson(ipc,raw);}
  else{if(change==='identity')o.project.projectId='99999999-9999-4999-8999-999999999999';if(change==='result')o.response.data.entries[0].initializerRaw='(Forged := 1)';if(change==='parser')o.response.data.memberExtraction.parserVersion='unknown-future-version';await x.store.saveOp(o);}
  const next=await x.call({offset:1,expectedVersion:r.data.version});assert.equal(next.status,change==='disk'?'conflict':'unknown',change+' '+JSON.stringify(next));assert.equal((await x.c.call('session_status')).data.globalFrozen,change!=='disk');assert.equal((await x.store.operations()).filter(o=>o.tool==='variable_inspect'&&o.bridge).length,1);
 }
});
test('same object GUID in a second registered project cannot reuse member pages',async t=>{
 const x=await context(t),a=await x.call({}),other=x.e.source+'.independent.json';await writeFile(other,await readFile(x.e.source));
 const opened=await x.c.done(await x.c.call('project_open_copy',{sourcePath:other,requestId:'other-fixture-project',applicationId:app}));assert.equal(opened.status,'succeeded');assert.notEqual(opened.data.session.projectId,x.q.projectId);
 const q={...x.q,projectId:opened.data.session.projectId},b=await x.c.done(await x.c.call('variable_inspect',q));assert.equal(b.status,'succeeded');assert.equal(a.data.entries[0].objectId,b.data.entries[0].objectId);assert.notEqual(a.data.version,b.data.version);
 const mixed=await x.c.done(await x.c.call('variable_inspect',{...q,offset:1,expectedVersion:a.data.version}));assert.equal(mixed.status,'conflict');assert.equal(mixed.error.code,'NATIVE_VERSION_CHANGED');
});
test('member counts never mask original enumeration/read/parse gaps',async()=>{
 const f=await fixture(),raw=structuredClone(f.raw);raw.data.scope.coverageComplete=false;raw.data.scope.treeComplete=false;raw.data.scope.enumerationFailures=[{objectId:null,path:['Device','Application'],stage:'fixture-enumeration',error:'isolated fixture subtree unavailable'}];
 const r=variableResult(raw,{...f.pages[0].args,includeInitializerMembers:true,limit:100});assert(!r.data.coverage.sourceReadComplete);assert(!r.data.coverage.objectEnumerationComplete);assert(r.data.memberExtraction.completeInParsedParents);assert.equal(r.data.page.total,null);
 const none=variableResult(raw,{...f.pages[0].args,includeInitializerMembers:true,name:'Absent'});assert.equal(none.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');
 assert.equal(INITIALIZER_MEMBER_PARSER_VERSION,'named-initializer-members-v1');
});
