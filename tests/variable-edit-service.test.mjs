import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {setup} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas} from '../dist/contracts.js';

test('variable_edit adds once, then changes only its initializer in direct fixture',async t=>{
 const e=await setup(),adapter=new FixtureAdapter();let dispatched=0;
 const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},
  {execute:(...args)=>{dispatched++;return adapter.execute(...args)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>service.store.release());
 const call=(name,args)=>service.call(name,schemas[name].parse(args));
 const created=await call('project_create',{requestId:randomUUID(),projectPath:path.join(await realpath(e.dir),'VariableEdit.project')});
 assert.equal(created.status,'succeeded',JSON.stringify(created));
 const s=created.data.session,p=JSON.parse(await readFile(s.workingPath,'utf8')),o=p.objects[0];
 const target={projectId:s.projectId,applicationId:s.applicationId,objectId:o.objectId};
 const bad=await call('variable_edit',{...target,requestId:randomUUID(),expectedHash:o.contentHash,expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash,
  action:'add',name:'Injected',type:'DINT',initializer:'1; Evil : DINT := 2'});
 assert.equal(bad.status,'unsupported');assert.equal(JSON.parse(await readFile(s.workingPath,'utf8')).objects[0].declaration,o.declaration);
 const add={...target,requestId:randomUUID(),expectedHash:o.contentHash,expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash,
  action:'add',name:'Delay',type:'TIME',initializer:'T#8s'};
 const first=await call('variable_edit',add);assert.equal(first.status,'succeeded',JSON.stringify(first));
 assert.match(first.data.declaration,/Delay : TIME := T#8s;/);assert.equal(first.data.implementation,'');
 const count=dispatched;assert.deepEqual(await call('variable_edit',add),first);assert.equal(dispatched,count);
 const change=await call('variable_edit',{...target,requestId:randomUUID(),expectedHash:first.data.contentHash,expectedSnapshot:first.data.snapshot,
  expectedDiskHash:first.data.diskHash,action:'set-initializer',name:'Delay',initializer:'T#7s',expectedOldInitializer:'T#8s'});
 assert.equal(change.status,'succeeded',JSON.stringify(change));assert.equal(change.data.declaration.replace('T#7s','T#8s'),first.data.declaration);
 const file=JSON.parse(await readFile(s.workingPath,'utf8'));assert.equal(file.objects[0].declaration,change.data.declaration);
});
