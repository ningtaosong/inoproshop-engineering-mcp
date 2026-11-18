import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EngineeringService} from '../dist/service.js';
import {configuration} from '../dist/adapter.js';
import {deviceCatalogResult} from '../dist/device-catalog.js';
import {schemas,reply} from '../dist/contracts.js';

const row=(version,extra={})=>({type:'4102',id:'10f4 0002',deviceDescriptionVersion:version,
  name:'Sample Controller',vendor:'Vendor',source:{name:'System Repository',isInternal:true},unavailableFields:[],...extra});
const result=(args,entries,scope={},lookup={status:'not-requested'})=>deviceCatalogResult(
  reply('succeeded','native substitute',{entries,scope:{capturedSources:1,truncated:false,enumerationFailures:[],...scope},
    detailLookup:lookup,projectOpened:false}),schemas.device_catalog.parse(args));
const v1=row('1.0.0'),v2=row('2.0.0');
const detail={type:v1.type,id:v1.id,deviceDescriptionVersion:v1.deviceDescriptionVersion};

test('native name matching keeps all versions and provides a stable page across reordered native rows',()=>{
  const first=result({query:'sample',limit:1},[v2,v1]);
  assert.equal(first.data.projectOpened,false);
  assert.equal(first.data.firmwareStatus,'not-read');
  assert.equal(first.data.page.hasMore,true);
  assert.equal(first.data.page.total,2);
  const second=result({query:'sample',offset:first.data.page.nextOffset,expectedVersion:first.data.version},[v1,v2]);
  assert.equal(second.data.version,first.data.version);
  assert.deepEqual(new Set([...first.data.entries,...second.data.entries]),new Set([v1,v2]));
  assert.equal(second.data.page.hasMore,false);
  assert.equal(result({query:'VENDOR',field:'vendor'},[v1]).data.page.total,1);
});
test('changed inventory invalidates continuations, and continuation needs a version',()=>{
  assert.throws(()=>schemas.device_catalog.parse({offset:1}));
  const version=result({},[v1,v2]).data.version;
  const changed=result({offset:1,expectedVersion:version},[v1,row('3.0.0')]);
  assert.equal(changed.status,'conflict');
  assert.equal(changed.error.code,'DEVICE_CATALOG_CHANGED');
});
test('qualified empty result differs from incomplete enumeration, unreadable fields, and truncation',()=>{
  const empty=result({query:'no',field:'name'},[v1]);
  assert.deepEqual(empty.data.entries,[]);
  assert.equal(empty.data.page.total,0);
  assert.equal(empty.data.scope.matchCoverageComplete,true);
  const partial=result({query:'no'},[v1],{enumerationFailures:[{stage:'source-devices',sourceIndex:0}]});
  assert.equal(partial.data.scope.enumerationComplete,false);
  assert.equal(partial.data.page.total,null);
  const missing=result({query:'no'},[row('1.0.0',{name:null,unavailableFields:['name']})]);
  assert.equal(missing.data.scope.enumerationComplete,true);
  assert.equal(missing.data.scope.fieldReadComplete,false);
  assert.equal(missing.data.page.total,null);
  const truncated=result({query:'sample'},[v1],{truncated:true});
  assert.equal(truncated.data.entries.length,1);
  assert.equal(truncated.data.page.total,null);
  assert.throws(()=>result({},[row('1.0.0',{name:null})]),{code:'DEVICE_CATALOG_EVIDENCE_INVALID'});
});
test('exact detail requires a unique enumerated identity and matching native get_device fields',()=>{
  const {name,vendor}=v1;
  const returned={status:'returned',fields:{...detail,name,vendor}};
  assert.equal(result({detail},[v1,v2],{},returned).data.detailVerified,true);
  assert.equal(result({detail},[v1,v1],{},returned).error.code,'DEVICE_IDENTITY_AMBIGUOUS');
  assert.equal(result({detail},[v2],{},returned).error.code,'DEVICE_IDENTITY_NOT_FOUND');
  assert.equal(result({detail},[v1],{truncated:true},returned).error.code,'DEVICE_CATALOG_INCOMPLETE');
  assert.equal(result({detail},[v1],{},{status:'lookup-unavailable'}).error.code,'DEVICE_NATIVE_LOOKUP_UNCONFIRMED');
  assert.equal(result({detail},[v1],{},{status:'returned',fields:{...returned.fields,id:'different'}}).error.code,'DEVICE_NATIVE_LOOKUP_UNCONFIRMED');
  assert.throws(()=>schemas.device_catalog.parse({projectId:'any'}));
});
test('output byte bound reduces page size and nextOffset uses delivered rows',()=>{
  const rows=Array.from({length:50},(_,i)=>row('2.'+i,{name:'设'.repeat(256),vendor:'备'.repeat(256)}));
  const page=result({limit:50},rows).data.page;
  assert.ok(page.returned>0&&page.returned<50);
  assert.equal(page.nextOffset,page.returned);
});
test('service dispatch is global, leaves the registry empty and binds the reply to its operation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'device-catalog-tests-'));
  const requests=[];
  const service=new EngineeringService(configuration({INOPRO_DATA_DIR:dir,INOPRO_RESPONSE_WAIT_MS:'2000'}),{
    async execute(req) {
      requests.push(req);
      return {...reply('succeeded','native substitute',{entries:[v1,v2],
        scope:{capturedSources:1,truncated:false,enumerationFailures:[]},detailLookup:{status:'not-requested'},projectOpened:false}),
        operationId:req.operationId};
    }
  });
  try {
    const answer=await service.call('device_catalog',schemas.device_catalog.parse({query:'Sample'}));
    assert.equal(answer.status,'succeeded',JSON.stringify(answer));
    assert.deepEqual(answer.data.entries,[v1,v2]);
    assert.deepEqual(requests.map(req=>[req.command,req.projectPath,req.fileGuard]),[['device_catalog','',undefined]]);
    const operation=await service.store.operation(answer.operationId);
    assert.equal(operation.project,undefined);
    assert.equal((await service.projects()).data.projects.length,0);
  } finally {
    await service.store.release();
  }
});
test('production native adapter under repository substitutes',()=>{
  const python=spawnSync('python',['tests/bridge_device_catalog_test.py'],{encoding:'utf8'});
  assert.equal(python.status,0,python.stdout+python.stderr);
});
