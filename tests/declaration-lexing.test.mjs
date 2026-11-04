import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {arrayBounds,declarationMatches} from '../dist/contracts.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {setup,app} from './helpers.mjs';

const cases=JSON.parse(await readFile('tests/fixtures/declaration-lexing.json','utf8'));
test('ordered declaration lexing: complete boundaries and old kind restrictions (shared Python cases)',()=>{
 for(const c of cases){
  assert.equal(declarationMatches(c.kind,c.name,c.text),c.read,c.id+' read');
  assert.equal(declarationMatches(c.kind,c.name,c.text,true),c.write,c.id+' write');
  if(c.kind==='array')assert.deepEqual(arrayBounds(c.name,c.text),c.bounds,c.id+' bounds');
 }
});

test('invalid array creation never dispatches; invalid changes leave the working file and original content intact',async()=>{
 const e=await setup(),fixture=new FixtureAdapter();let creations=0;
 const s=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},{reconcile:d=>fixture.reconcile(d),execute:async(...args)=>{if(args[0].command==='create_declaration')creations++;return fixture.execute(...args);}});
 try{
  const opened=await s.call('project_open_copy',{requestId:'open',sourcePath:e.source,applicationId:app}),target={projectId:opened.data.session.projectId,applicationId:app};
  const valid=cases.find(c=>c.id==='comment-quotes-markers');
  const create={...target,parentId:app,name:'T_Values',objectType:'array',expectedSnapshot:opened.data.snapshot};
  for(const c of cases.filter(c=>c.kind==='array'&&!c.write)){
   const r=await s.call('declaration_create',{...create,requestId:'invalid-'+c.id,declaration:c.text});assert.equal(r.error.code,'INVALID_DECLARATION',c.id);
  }
  assert.equal(creations,0);
  const made=await s.call('declaration_create',{...create,requestId:'valid-create',declaration:valid.text});assert.equal(made.status,'succeeded',JSON.stringify(made));assert.equal(creations,1);
  const bytes=await readFile(opened.data.session.workingPath);
  for(const c of cases.filter(c=>c.kind==='array'&&!c.write)){
   const r=await s.call('code_apply_change',{...target,requestId:'change-'+c.id,objectId:made.data.objectId,objectType:'array',expectedHash:made.data.contentHash,declaration:c.text});
   assert.equal(r.error.code,'OBJECT_TYPE_MISMATCH',c.id);assert.deepEqual(await readFile(opened.data.session.workingPath),bytes,c.id);
  }
  const read=await s.call('object_read',{...target,objectId:made.data.objectId});assert.equal(read.data.declaration,valid.text);assert.equal((await s.status()).data.writeFrozen,false);
 }finally{await s.store.release();}
});

test('production Python lexer/native guard/dispatch doubles reject without factory, replacement or save',()=>{
 const r=spawnSync('python',['tests/bridge_declaration_lexing_test.py'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});assert.equal(r.status,0,r.stdout+r.stderr);
});
