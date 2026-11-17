import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,app} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

test('only direct project_open opts into exact initial-open prompt handling',async()=>{
 const e=await setup(),fixture=new FixtureAdapter(),requests=[];
 const adapter={reconcile:d=>fixture.reconcile(d),execute:async(...a)=>{requests.push(a[0]);return fixture.execute(...a);}};
 const service=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000},adapter);
 const done=async(name,args)=>{let r=await service.call(name,args);for(let i=0;r.status==='running'&&i<100;i++){
   await new Promise(resolve=>setTimeout(resolve,5));r=await service.call('operation_status',{operationId:r.operationId});
 }assert.notEqual(r.status,'running');return r;};
 assert.equal((await done('project_open',{requestId:'direct',projectPath:e.source,applicationId:app})).status,'succeeded');
 assert.equal(requests.at(-1).promptPolicy,'library-info-initial-open-v1');
 assert.equal((await done('project_open_copy',{requestId:'copy',sourcePath:e.source,applicationId:app})).status,'succeeded');
 assert.equal(requests.at(-1).promptPolicy,undefined);
});
