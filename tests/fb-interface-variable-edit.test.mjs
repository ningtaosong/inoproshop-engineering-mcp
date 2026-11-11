import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setup,app,obj} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas} from '../dist/contracts.js';
import {planVariableEdit} from '../dist/variable-edit.js';

const declaration='FUNCTION_BLOCK FB_DelayAlarm\nVAR_INPUT\n DelayTime : TIME := T#3s;\nEND_VAR\nVAR_OUTPUT\n Alarm : BOOL := FALSE;\nEND_VAR\nVAR\n Count : DINT := 0;\nEND_VAR';
const implementation='Alarm := FALSE; // Count and DelayTime stay here';
const native='6f9dac99-8de1-4efc-8465-68ac443b7d08';

test('planner selects only the named FB interface block and preserves unrelated source',()=>{
 for(const [section,type,value] of [['VAR_INPUT','BOOL','TRUE'],['VAR_INPUT','DINT','7'],['VAR_INPUT','TIME','T#8s'],
   ['VAR_OUTPUT','BOOL','FALSE'],['VAR_OUTPUT','DINT','8'],['VAR_OUTPUT','TIME','T#9s']]){
  const name=section==='VAR_INPUT'?'InputNew':'OutputNew';
  const added=planVariableEdit(declaration,'function_block','FB_DelayAlarm',{action:'add',section,name,type,initializer:value},[]);
  assert.equal(added.declaration.split(name+' : '+type+' := '+value+';').length,2);
  const changed=planVariableEdit(added.declaration,'function_block','FB_DelayAlarm',{action:'set-initializer',section,name,initializer:value==='TRUE'?'FALSE':value==='FALSE'?'TRUE':type==='DINT'?'9':'T#10s',expectedOldInitializer:value});
  assert.equal(changed.declaration.replace(changed.after,changed.before),added.declaration);
 }
 assert.match(planVariableEdit(declaration,'function_block','FB_DelayAlarm',{action:'set-initializer',section:'VAR_INPUT',name:'DelayTime',initializer:'T#4s',expectedOldInitializer:'T#3s'}).declaration,/DelayTime : TIME := T#4s;/);
 assert.match(planVariableEdit(declaration,'function_block','FB_DelayAlarm',{action:'set-initializer',section:'VAR_OUTPUT',name:'Alarm',initializer:'TRUE',expectedOldInitializer:'FALSE'}).declaration,/Alarm : BOOL := TRUE;/);
 assert.match(planVariableEdit(declaration,'function_block','FB_DelayAlarm',{action:'add',name:'LocalNew',type:'BOOL',initializer:'TRUE'}).declaration,/VAR\n Count : DINT := 0;\n LocalNew : BOOL := TRUE;/);
});

test('planner rejects uncertain interface locations, conflicts and unsupported declarations',()=>{
 assert.equal(schemas.variable_edit.safeParse({requestId:randomUUID(),projectId:randomUUID(),applicationId:app,objectId:obj,
  expectedHash:'0'.repeat(64),expectedSnapshot:'0'.repeat(64),expectedDiskHash:'0'.repeat(64),action:'set-initializer',section:'VAR_INPUT',name:'DelayTime',initializer:'T#4s'}).success,false);
 const add=(source,section,name,children=[])=>planVariableEdit(source,'function_block','FB_DelayAlarm',{action:'add',section,name,type:'BOOL',initializer:'TRUE'},children);
 assert.throws(()=>add(declaration,'VAR_INPUT','Alarm'),/conflict/i);
 assert.throws(()=>add(declaration,'VAR_OUTPUT','DelayTime'),/conflict/i);
 assert.throws(()=>planVariableEdit(declaration.replace('Alarm : BOOL','DelayTime : BOOL'),'function_block','FB_DelayAlarm',
  {action:'set-initializer',section:'VAR_INPUT',name:'DelayTime',initializer:'T#4s',expectedOldInitializer:'T#3s'}),/ambiguous/i);
 assert.throws(()=>add(declaration,'VAR_INPUT','ResetState',['resetstate']),/conflict/i);
 assert.throws(()=>planVariableEdit(declaration,'function_block','FB_DelayAlarm',{action:'add',section:'VAR_INPUT',name:'NewName',type:'BOOL',initializer:'TRUE'}),/inventory/i);
 assert.throws(()=>add(declaration.replace('VAR_OUTPUT','VAR_INPUT'),'VAR_INPUT','NewName'),/ambiguous/i);
 assert.throws(()=>planVariableEdit(declaration.replace('VAR_OUTPUT','VAR_INPUT'),'function_block','FB_DelayAlarm',
  {action:'set-initializer',section:'VAR_INPUT',name:'DelayTime',initializer:'T#4s',expectedOldInitializer:'T#3s'}),/ambiguous/i);
 assert.throws(()=>add(declaration.replace('VAR_INPUT','VAR_IN_OUT'),'VAR_INPUT','NewName'),/boundary|missing/i);
 assert.throws(()=>add(declaration.replace('VAR_INPUT','VAR_INPUT RETAIN'),'VAR_INPUT','NewName'),/boundary|missing/i);
 assert.throws(()=>add(declaration.replace('DelayTime : TIME','DelayTime AT %IX0.0 : TIME'),'VAR_INPUT','NewName'),/special|boundary/i);
 for(const name of ['IF','ADD','TO_BOOL'])assert.throws(()=>add(declaration,'VAR_INPUT',name),/reserved/i);
 for(const name of ['IfEnabled','AddCount','ToBoolFlag'])assert.doesNotThrow(()=>add(declaration,'VAR_OUTPUT',name));
 assert.throws(()=>planVariableEdit(declaration,'st_pou','FB_DelayAlarm',{action:'add',section:'VAR_INPUT',name:'A',type:'BOOL',initializer:'TRUE'},[]),/FUNCTION_BLOCK/i);
 assert.throws(()=>planVariableEdit('VAR_GLOBAL\n A:BOOL:=TRUE;\nEND_VAR','gvl','GVL',{action:'add',section:'VAR_OUTPUT',name:'B',type:'BOOL',initializer:'TRUE'},[]),/FUNCTION_BLOCK/i);
});

test('service rejects interface ambiguity before change; valid add, set and duplicate stay isolated',async t=>{
 const e=await setup({objects:[{objectId:obj,applicationId:app,path:['设备','应用一','FB_DelayAlarm'],objectType:'function_block',nativeTypeId:native,pouType:'function_block',pouTypeSource:'native-pou-type-id-and-declaration-header',hasImplementation:true,declaration,implementation}]});
 const adapter=new FixtureAdapter(),commands=[];
 const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},
  {execute:(...args)=>{commands.push(args[0].command);return adapter.execute(...args)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>service.store.release());
 const call=async(name,args)=>{let r=await service.call(name,schemas[name].parse(args));while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
 const opened=await call('project_open_copy',{requestId:randomUUID(),sourcePath:e.source,applicationId:app});assert.equal(opened.status,'succeeded');
 const s=opened.data.session,read=await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj});
 const base={projectId:s.projectId,applicationId:app,objectId:obj,expectedHash:read.data.contentHash,expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash};
 const file=()=>readFile(s.workingPath),hash=async()=>createHash('sha256').update(await file()).digest('hex');
 const before=await hash(),start=commands.length;
 const rejected=await call('variable_edit',{...base,requestId:randomUUID(),action:'add',section:'VAR_INPUT',name:'Alarm',type:'BOOL',initializer:'TRUE'});
 assert.equal(rejected.status,'unsupported');assert.equal(await hash(),before);assert.equal(commands.slice(start).includes('change'),false);
 const add={...base,requestId:randomUUID(),action:'add',section:'VAR_INPUT',name:'DemoPermit',type:'BOOL',initializer:'TRUE'};
 const first=await call('variable_edit',add);assert.equal(first.status,'succeeded',JSON.stringify(first));assert.match(first.data.declaration,/DemoPermit : BOOL := TRUE;/);
 const count=commands.length;assert.deepEqual(await call('variable_edit',add),first);assert.equal(commands.length,count);
 const second=await call('variable_edit',{...base,requestId:randomUUID(),expectedHash:first.data.contentHash,expectedSnapshot:first.data.snapshot,expectedDiskHash:first.data.diskHash,
  action:'add',section:'VAR_OUTPUT',name:'PermitEcho',type:'BOOL',initializer:'FALSE'});
 assert.equal(second.status,'succeeded',JSON.stringify(second));assert.match(second.data.declaration,/PermitEcho : BOOL := FALSE;/);
 const changed=await call('variable_edit',{...base,requestId:randomUUID(),expectedHash:second.data.contentHash,expectedSnapshot:second.data.snapshot,expectedDiskHash:second.data.diskHash,
  action:'set-initializer',section:'VAR_INPUT',name:'DelayTime',initializer:'T#4s',expectedOldInitializer:'T#3s'});
 assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.implementation,implementation);
 assert.equal(JSON.parse(await file()).objects[0].declaration,changed.data.declaration);
});

test('service refuses a direct Method name collision before change or save',async t=>{
 const parentPath=['设备','应用一','FB_DelayAlarm'],methodId=randomUUID();
 const method={objectId:methodId,applicationId:app,path:[...parentPath,'DemoPermit'],parentId:obj,parentPath,objectType:'method',
  nativeTypeId:'f8a58466-d7f6-439f-bbb8-d4600e41d099',language:'ST',hasImplementation:true,
  declaration:'METHOD PUBLIC DemoPermit\nVAR\nEND_VAR',implementation:'',methodReturnType:'void',access:'PUBLIC'};
 const e=await setup({objects:[{objectId:obj,applicationId:app,path:parentPath,objectType:'function_block',nativeTypeId:native,pouType:'function_block',
  pouTypeSource:'native-pou-type-id-and-declaration-header',hasImplementation:true,declaration,implementation},method]});
 const adapter=new FixtureAdapter(),commands=[];
 const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},
  {execute:(...args)=>{commands.push(args[0].command);return adapter.execute(...args)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>service.store.release());
 const call=async(name,args)=>{let r=await service.call(name,schemas[name].parse(args));while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
 const opened=await call('project_open_copy',{requestId:randomUUID(),sourcePath:e.source,applicationId:app});assert.equal(opened.status,'succeeded');
 const s=opened.data.session,read=await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj});
 const before=createHash('sha256').update(await readFile(s.workingPath)).digest('hex'),count=commands.length;
 const result=await call('variable_edit',{requestId:randomUUID(),projectId:s.projectId,applicationId:app,objectId:obj,
  expectedHash:read.data.contentHash,expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash,action:'add',section:'VAR_INPUT',
  name:'DemoPermit',type:'BOOL',initializer:'TRUE'});
 assert.equal(result.status,'unsupported',JSON.stringify(result));assert.match(result.summary,/Method|Property|conflict/i);
 assert.equal(commands.slice(count).includes('change'),false);assert.equal(commands.slice(count).includes('save'),false);
 assert.equal(createHash('sha256').update(await readFile(s.workingPath)).digest('hex'),before);
});
