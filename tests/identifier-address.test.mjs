import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {searchResult} from '../dist/queries.js';
import {lexSt,IDENTIFIER_LEXER_VERSION,LEGACY_IDENTIFIER_LEXER_VERSION} from '../dist/st-lex.js';
import {parseDeclaration,variableResult,VARIABLE_PARSER_VERSION} from '../dist/variables.js';
import {codeHash,Store,atomicJson} from '../dist/storage.js';import {schemas} from '../dist/contracts.js';import {setup,connect,app} from './helpers.mjs';
const fixture=async()=>JSON.parse(await readFile('tests/fixtures/identifier-address-v1.json','utf8'));
function withSource(f,declaration,implementation,extra={}){
 const raw=structuredClone(f.raw),o=raw.data.corpus[0];Object.assign(o,{declaration,implementation,contentHash:codeHash(declaration,implementation)});
 return searchResult(raw,{...f.args,...extra});
}
test('direct-address IX0 components are not complete identifier occurrences; real IX0 declaration and assignment remain',async()=>{
 const f=JSON.parse(await readFile('tests/fixtures/identifier-address-v1.json','utf8')),r=searchResult(f.raw,f.args);
 assert.equal(r.data.matches.length,2,JSON.stringify({matches:r.data.matches,coverage:r.data.lexicalCoverage}));assert(r.data.lexicalCoverage.complete);
 assert.deepEqual(r.data.matches.map(m=>[m.region,m.position.startOffset]),[['declaration',f.raw.data.corpus[0].declaration.indexOf('IX0 : BOOL')],['implementation',0]]);
});

test('supported area/size/decimal positions are consumed whole, including lower case, without validating hardware addresses',async()=>{
 const f=await fixture();assert.equal(IDENTIFIER_LEXER_VERSION,'st-identifier-v2');
 for(const area of ['I','Q','M'])for(const size of ['','X','B','W','D','L'])for(const position of ['0','12.3.4']){
  const address='%'+area+size+position,word=address.slice(1).split('.')[0],source=address+' + '+word+'; '+address.toLowerCase()+';';
  const r=withSource(f,'PROGRAM Main',source,{query:word,areas:['implementation']});assert(r.data.lexicalCoverage.complete,address);assert.equal(r.data.matches.length,1,address);assert.equal(r.data.matches[0].position.startOffset,address.length+3);
  assert(lexSt(source,true).tokens.some(t=>t.text===address&&!t.id));
 }
 const r=withSource(f,'PROGRAM Main','%ix0.0 + IX0 + ix0;',{query:'ix0',caseSensitive:true,areas:['implementation']});assert.deepEqual(r.data.matches.map(m=>m.matchedText),['ix0']);
});

test('unknown, wildcard, incomplete and ambiguous address tails report a gap and do not leak subsequent names',async()=>{
 const f=await fixture();
 for(const bad of ['%','%I','%IX','%P0','%QY0','%I*','% IX0.0','%IX-1.0','%IX0.','%IX0..1','%IX0.0Foo','%IX0.0_','%IX0.0#BOOL','%IX0.0😀',"%IX0.0'IX0'",'%IX0.0%QX1.0']){
  const s='IX0; '+bad+'; IX0;',r=withSource(f,'PROGRAM Main',s,{areas:['implementation']});assert.equal(r.data.matches.length,1,bad);assert(!r.data.lexicalCoverage.complete,bad);assert.equal(r.data.lexicalCoverage.gaps[0].position.startOffset,5,bad);assert.equal(r.data.page.totalMatches,null);
  const none=withSource(f,'PROGRAM Main',s,{areas:['implementation'],query:'Absent'});assert.equal(none.data.noMatchConclusion,'coverage-incomplete-no-definitive-absence');
 }
});

test('comments/quoted escapes stay skipped; literal still sees address text and UTF-16 spans point at original words',async()=>{
 const f=await fixture(),s="// 中文😀 %IX0.0\n'IX0;$'%IX0.0'; \"IX0;$\"%IX0.0\"; (* %IX (* ' *) *) %IX0.0; IX0; ix0;";
 const r=withSource(f,'PROGRAM Main',s,{areas:['implementation']});assert(r.data.lexicalCoverage.complete);assert.deepEqual(r.data.matches.map(m=>m.matchedText),['IX0','ix0']);
 for(const m of r.data.matches){const p=m.position;assert.equal(s.slice(p.startOffset,p.endOffset),m.matchedText);assert.equal(p.line,s.slice(0,p.startOffset).split('\n').length);assert.equal(p.column,p.startOffset-s.lastIndexOf('\n',p.startOffset-1));assert.equal(s.slice(m.context.startOffset,m.context.endOffset),m.context.text);}
 assert.deepEqual(searchResult(f.raw,f.literalArgs),f.literalResult,'Exact pre-fix literal output, version included');
 const literal=withSource(f,'PROGRAM Main',s,{areas:['implementation'],matchMode:'literal'});assert(literal.data.matches.length>r.data.matches.length);assert.equal(literal.data.lexicalCoverage,undefined);
});

test('non-strict declaration tokens, AT raw text, positions and existing variable v2 identity remain byte-for-byte compatible',async()=>{
 const f=await fixture();assert.equal(VARIABLE_PARSER_VERSION,'declaration-variables-v2');assert.deepEqual(lexSt(f.raw.data.corpus[0].declaration),{...f.declarationTokens,error:undefined});assert.deepEqual(parseDeclaration(f.raw.data.corpus[0].declaration,'st_pou','Main'),f.parsed);assert.deepEqual(variableResult(f.raw,f.variableArgs),f.variableResult);
 const row=f.parsed.rows.find(r=>r.name==='Input');assert.equal(row.addressRaw,'%IX0.0');assert.equal(f.raw.data.corpus[0].declaration.slice(row.addressPosition.startOffset,row.addressPosition.endOffset),'%IX0.0');
});

test('v1 replay verifies the exact published buggy result; no client option can select the historical lexer',async()=>{
 const f=await fixture();assert.deepEqual(searchResult(f.raw,f.args,{identifierVersion:LEGACY_IDENTIFIER_LEXER_VERSION}),f.result);const now=searchResult(f.raw,f.args);assert.notEqual(now.data.version,f.result.data.version);assert.equal(now.data.matches.length,2);assert(!schemas.project_search.safeParse({...f.args,identifierVersion:LEGACY_IDENTIFIER_LEXER_VERSION}).success);
});

async function context(t,mode='identifier'){
 const f=await fixture(),e=await setup({objects:f.raw.data.corpus.map(o=>({...o,path:['设备','应用一','Main']}))}),c=await connect(e.dataDir);t.after(()=>c.client.close());const opened=await c.done(await c.call('project_open_copy',{sourcePath:e.source,applicationId:app,requestId:'address-fixture'}));assert.equal(opened.status,'succeeded',JSON.stringify(opened));const target={projectId:opened.data.session.projectId,applicationId:app},q={...target,query:'IX0',matchMode:mode,areas:['declaration','implementation'],limit:1};
 const first=await c.done(await c.call('project_search',q));assert.equal(first.status,'succeeded');const store=new Store(e.dataDir),op=await store.operation(first.operationId),raw=JSON.parse(await readFile(path.join(op.bridge.directory,'observed-after-exit.json'),'utf8'));return{f,e,c,store,op,raw,q,first,workingPath:opened.data.session.workingPath};
}
async function legacy(x){x.op.response={...searchResult(x.raw,x.op.args,{identifierVersion:LEGACY_IDENTIFIER_LEXER_VERSION}),requestId:x.op.requestId};await x.store.saveOp(x.op);assert.equal(x.op.response.data.matches[0].position.startOffset,31);assert.equal(x.op.response.data.page.totalMatches,4);return x.op.response.data.version;}
const nativeCount=async x=>(await x.store.operations()).filter(o=>o.tool==='project_search'&&o.bridge).length;

test('verified old identifier pages conflict as a normal lexer upgrade, with no freeze, original-record edit or IDE dispatch',async t=>{
 const x=await context(t),version=await legacy(x),before=await readFile(x.store.file('operations/'+x.op.operationId+'.json')),file=await readFile(x.workingPath);const r=await x.c.done(await x.c.call('project_search',{...x.q,expectedVersion:version,offset:1}));assert.equal(r.status,'conflict',JSON.stringify(r));assert.equal(r.error.code,'SEARCH_LEXER_VERSION_CHANGED');assert.equal((await x.c.call('session_status')).data.writeFrozen,false);assert.equal(await nativeCount(x),1);assert.deepEqual(await readFile(x.store.file('operations/'+x.op.operationId+'.json')),before);assert.deepEqual(await readFile(x.workingPath),file);
});

test('corrupt old identifier source, identity, result or lexer evidence still becomes unknown, never a harmless upgrade',async t=>{
 for(const change of ['source','identity','result','coverage']){
  const x=await context(t),version=await legacy(x);
  if(change==='source'){x.raw.data.corpus[0].implementation+=' IX0;';await atomicJson(path.join(x.op.bridge.directory,'observed-after-exit.json'),x.raw);}
  else{if(change==='identity')x.op.project.projectId=app;else if(change==='result')x.op.response.data.matches[0].matchedText='wrong';else x.op.response.data.lexicalCoverage.lexerVersion=IDENTIFIER_LEXER_VERSION;await x.store.saveOp(x.op);}
  const r=await x.c.done(await x.c.call('project_search',{...x.q,expectedVersion:version,offset:1}));assert.equal(r.status,'unknown',change+' '+JSON.stringify(r));assert.equal(r.error.code,'SEARCH_EVIDENCE_INVALID');assert.equal((await x.c.call('session_status')).data.writeFrozen,true);assert.equal(await nativeCount(x),1);
 }
});

test('literal pages continue across this lexer change using the same version and corpus, with no recapture',async t=>{
 const x=await context(t,'literal'),rows=[...x.first.data.matches];let page=x.first;
 while(page.data.page.hasMore){page=await x.c.done(await x.c.call('project_search',{...x.q,expectedVersion:x.first.data.version,offset:page.data.page.nextOffset}));assert.equal(page.status,'succeeded');assert.equal(page.data.version,x.first.data.version);assert.equal(page.data.lexerVersion,null);assert.equal(page.data.readOrigin.inventoryOperationId,x.first.operationId);rows.push(...page.data.matches);}
 assert.equal(rows.length,4);assert.equal(await nativeCount(x),1);assert.equal((await x.c.call('session_status')).data.globalFrozen,false);
});
