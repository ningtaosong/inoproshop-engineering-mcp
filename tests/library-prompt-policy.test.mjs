import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {setup,connect,app,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

test('direct project_open opts into exact initial-open prompt handling; copy and catalog do not',async()=>{
 const e=await setup(),fixture=new FixtureAdapter(),requests=[];
 const adapter={reconcile:d=>fixture.reconcile(d),execute:async(...a)=>{requests.push(a[0]);return fixture.execute(...a);}};
 const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},adapter);
 const done=async(name,args)=>{let r=await service.call(name,args);for(let i=0;r.status==='running'&&i<100;i++){
   await new Promise(resolve=>setTimeout(resolve,5));r=await service.call('operation_status',{operationId:r.operationId});
 }assert.notEqual(r.status,'running');return r;};
 assert.equal((await done('project_open',{requestId:'direct',projectPath:e.source,applicationId:app})).status,'succeeded');
 assert.equal(requests.at(-1).promptPolicy,'library-info-open-stages-v2');
 assert.deepEqual(requests.at(-1).promptStages,['initial-open']);
 assert.equal((await done('project_open_copy',{requestId:'copy',sourcePath:e.source,applicationId:app})).status,'succeeded');
 assert.equal(requests.at(-1).promptPolicy,undefined);
 assert.equal((await done('library_catalog',{})).status,'succeeded');
 assert.equal(requests.at(-1).promptPolicy,undefined);
});

test('direct S5b source read, change, build and save receive only their native open stages',async t=>{
 const managerId='40000000-0000-4000-8000-000000000001',managerPath=['设备','应用一','库管理器'];
 const e=await setup({libraryManagers:[{applicationId:app,managerId,path:managerPath,
   nativeTypeId:'adb5cb65-8e1d-4a00-b70a-375ea27582f3',unavailableFields:[],references:[
     {index:0,parentIndex:null,managerId,managerPath,order:0,path:[...managerPath,'references','0'],
       rawFields:{id:'native-placeholder-1',name:'#S5bDemo',namespace:'FMATH',is_placeholder:true,
         is_managed:false,system_library:false,optional:false,qualified_only:false,
         placeholder_name:'S5bDemo',default_resolution:'Fixture Mathematics, 1.0.0 (Fixture Vendor)',
         effective_resolution:'None',resolution_info:'None',resolver_guid:'fixture-resolver',
         is_redirected:false,explicit_redirection:null},unavailableFields:[],
       resolutionStatus:'effective-resolution-reported',
       resolutionBasis:'Native effective_resolution string only',installedStatus:'not-queried'}]}]}),
   c=await connect(e.dataDir);
 t.after(()=>c.client.close());
 const done=async(name,args)=>c.done(await c.call(name,args));
 const check=async(result,command,stages)=>{
   const request=JSON.parse(await readFile(path.join(e.dataDir,'ipc',result.operationId,'request.json'),'utf8'));
   assert.equal(request.command,command);
   assert.equal(request.promptPolicy,'library-info-open-stages-v2');
   assert.deepEqual(request.promptStages,stages);
 };
 const opened=await done('project_open',{requestId:'open',projectPath:e.source,applicationId:app});
 assert.equal(opened.status,'succeeded');await check(opened,'inspect',['initial-open']);
 const target={projectId:opened.data.session.projectId,applicationId:app};
 const refs=await done('library_inspect',target);assert.equal(refs.status,'succeeded',JSON.stringify(refs));await check(refs,'libraries',['initial-open']);
 const structure=await done('project_structure',{projectId:target.projectId});
 assert.equal(structure.status,'succeeded');await check(structure,'structure',['initial-open']);
 const listed=await done('object_list',target);assert.equal(listed.status,'succeeded');await check(listed,'list',['initial-open']);
 const search=await done('project_search',{...target,query:'Main'});
 assert.equal(search.status,'succeeded');await check(search,'search',['initial-open']);
 const read=await done('object_read',{...target,objectId:obj});assert.equal(read.status,'succeeded');await check(read,'read',['initial-open']);
 const changed=await done('code_apply_change',{...target,requestId:'change',objectId:obj,
   expectedHash:read.data.contentHash,declaration:read.data.declaration,
   implementation:read.data.implementation+'\n// S5b prompt policy fixture'});
 assert.equal(changed.status,'succeeded');await check(changed,'change',['initial-open','reopen']);
 const build=await done('project_build',{...target,requestId:'build'});
 assert.equal(build.status,'succeeded');await check(build,'build',['initial-open']);
 const saved=await done('project_save',{...target,requestId:'save',expectedSnapshot:build.data.snapshot});
 assert.equal(saved.status,'succeeded');await check(saved,'save',['initial-open','reopen']);
});
