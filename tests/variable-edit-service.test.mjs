import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {setup,app,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas} from '../dist/contracts.js';

test('variable_edit adds once, then changes only its initializer in direct fixture',async t=>{
 const e=await setup(),adapter=new FixtureAdapter();let dispatched=0;
 const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},
  {execute:(...args)=>{dispatched++;return adapter.execute(...args)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>service.store.release());
 const call=async(name,args)=>{let r=await service.call(name,schemas[name].parse(args));while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
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

test('variable_edit follows a moved FUNCTION_BLOCK native identity, not its old root path',async t=>{
 const e=await setup({objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:'FUNCTION_BLOCK Main\nVAR\n Value:DINT := 7;\nEND_VAR',implementation:'',objectType:'function_block',hasImplementation:true}]});
 const adapter=new FixtureAdapter(),service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},adapter);
 t.after(()=>service.store.release());
 const call=async(name,args)=>{let r=await service.call(name,schemas[name].parse(args));while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
 const opened=await call('project_open_copy',{requestId:randomUUID(),sourcePath:e.source,applicationId:app});assert.equal(opened.status,'succeeded');
 const target={projectId:opened.data.session.projectId,applicationId:app},version=async()=>{
  const r=await call('project_structure',{projectId:target.projectId});assert.equal(r.status,'succeeded');
  return {expectedStructureVersion:r.data.organizationVersions[app],expectedDiskHash:r.data.diskHash};
 };
 const folder=await call('folder_create',{...target,requestId:randomUUID(),parentId:app,name:'Alarms',...await version()});assert.equal(folder.status,'succeeded',JSON.stringify(folder));
 const moved=await call('object_move',{...target,requestId:randomUUID(),objectId:obj,sourceParentId:app,targetParentId:folder.data.object.objectId,...await version()});assert.equal(moved.status,'succeeded',JSON.stringify(moved));
 const before=await call('object_read',{...target,objectId:obj});assert.equal(before.status,'succeeded');assert.equal(before.data.path.at(-2),'Alarms');
 const state=await service.store.session();
 const changed=await call('variable_edit',{...target,requestId:randomUUID(),objectId:obj,expectedHash:before.data.contentHash,expectedSnapshot:state.snapshot,expectedDiskHash:state.diskHash,action:'set-initializer',name:'Value',initializer:'8',expectedOldInitializer:'7'});
 assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.path.at(-2),'Alarms');assert.match(changed.data.declaration,/Value:DINT := 8;/);
});
