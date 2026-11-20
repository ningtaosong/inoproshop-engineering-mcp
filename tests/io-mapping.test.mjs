import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,appendFile} from 'node:fs/promises';
import {setup,connect,app,obj} from './helpers.mjs';
import {ioMappingPage} from '../dist/io-mapping.js';
import {schemas} from '../dist/contracts.js';

const module={guid:obj,type:40600,id:'10F4 0600',deviceDescriptionVersion:'00.00.00.20',path:['Device','Module']};
const keys=[[],['member','leaf']].map(memberPath=>({deviceGuid:obj,connectorId:2,parameterId:13,memberPath}));
const inventory={rootDevice:{type:4102,id:'10f4 0002',deviceDescriptionVersion:'3.5.11.11',path:['Device']},
 device:module,connector:{ownerGuid:obj,id:2,interface:'Common.inovance2'},coverage:{observed:2,enumerationComplete:true},
 channels:keys.map(channelKey=>({channelKey,identityStatus:'unique-in-view'}))};
test('read-only pages and exact detail use one native inventory and reject changed disk or version',async t=>{
 const e=await setup({ioInventory:inventory}),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const opening=await c.done(await c.call('project_open_copy',{requestId:'io-open',sourcePath:e.source,applicationId:app}));
 const {projectId,workingPath}=opening.data.session;
 const invoke=async args=>c.done(await c.call('io_mapping_inspect',{projectId,...args}));
 const bytes=await readFile(workingPath),one=await invoke({limit:1});
 assert.equal(one.status,'succeeded',JSON.stringify(one));assert.deepEqual(one.data.channels[0].channelKey,keys[0]);
 const version=one.data.version;
 for(const args of [{offset:1},{detail:keys[1]}]){
   const r=await invoke({...args,expectedVersion:version});
   assert.equal(r.status,'succeeded');assert.equal(r.data.readOrigin.inventoryOperationId,one.operationId);
   assert.deepEqual(r.data.channels[0].channelKey,keys[1]);
 }
 assert.equal((await invoke({offset:1,expectedVersion:'f'.repeat(64)})).status,'conflict');
 assert.deepEqual(await readFile(workingPath),bytes);
 await appendFile(workingPath,' ');
 assert.equal((await invoke({expectedVersion:version,detail:keys[1]})).status,'conflict');
 assert.equal(schemas.io_mapping_inspect.safeParse({projectId,save:true}).success,false);
});
test('coverage and member identity participate in version; truncated/changed evidence cannot supply prior page',()=>{
 const raw={status:'succeeded',data:{...structuredClone(inventory),projectId:obj,diskHash:'a'.repeat(64)}};
 const args={offset:0,limit:1,projectId:obj},v=ioMappingPage(raw,args).data.version;
 raw.data.coverage.enumerationComplete=false;
 assert.notEqual(ioMappingPage(raw,args).data.version,v);
 assert.throws(()=>ioMappingPage(raw,{...args,expectedVersion:v}),/版本/);
 raw.data.device.id='other';
 assert.throws(()=>ioMappingPage(raw,args),/scope/);
});
