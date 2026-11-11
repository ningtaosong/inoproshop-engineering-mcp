import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setup,app,obj,obj2} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas} from '../dist/contracts.js';

const gvl='VAR_GLOBAL\n Config : ST_AlarmConfig := (DelayTime := T#10s);\n Config2 : ST_AlarmConfig := (DelayTime := T#5s, Enabled := TRUE);\nEND_VAR';
const dut='TYPE ST_AlarmConfig : STRUCT\n DelayTime : TIME := T#3s;\n Enabled : BOOL := FALSE;\n Count : DINT := 0;\nEND_STRUCT\nEND_TYPE';
const native='2db5746d-d284-4425-9f7f-2663a34b0ebc';
const entries=(extra=[])=>[
 {objectId:obj,applicationId:app,path:['设备','应用一','GVL_AlarmConfig'],objectType:'gvl',nativeTypeId:'ffbfa93a-b94d-45fc-a329-229860183b1d',hasImplementation:false,declaration:gvl,implementation:''},
 {objectId:obj2,applicationId:app,path:['设备','应用一','ST_AlarmConfig'],objectType:'structure',nativeTypeId:native,hasImplementation:false,declaration:dut,implementation:''},...extra];
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');

async function fixture(t,objects=entries(),rewrite=x=>x,extra={}){
 const e=await setup({objects,...extra}),adapter=new FixtureAdapter(),commands=[];
 const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},
  {execute:(...args)=>{commands.push(args[0].command);args[0]=rewrite(args[0]);return adapter.execute(...args)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>service.store.release());
 const call=async(name,args)=>{let r=await service.call(name,schemas[name].parse(args));while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
 const opened=await call('project_open_copy',{requestId:randomUUID(),sourcePath:e.source,applicationId:app});assert.equal(opened.status,'succeeded');
 const s=opened.data.session;
 const parent=await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj});
 const type=await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj2});
 const request={requestId:randomUUID(),projectId:s.projectId,applicationId:app,objectId:obj,expectedHash:parent.data.contentHash,
  expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash,action:'set-member-initializer',name:'Config2',memberName:'DelayTime',
  typeObjectId:obj2,expectedTypeHash:type.data.contentHash,expectedOldInitializer:'T#5s',initializer:'T#8s'};
 return {e,s,service,commands,call,request,parent,type};
}

test('member action writes one typed literal, reads it back and retains the other source',async t=>{
 const f=await fixture(t),first=await f.call('variable_edit',f.request);
 assert.equal(first.status,'succeeded',JSON.stringify(first));
 assert.equal(first.data.declaration,gvl.replace('Config2 : ST_AlarmConfig := (DelayTime := T#5s','Config2 : ST_AlarmConfig := (DelayTime := T#8s'));
 assert.equal(first.data.editEvidence.fieldType,'TIME');assert.equal(first.data.variableTypeEvidence.contentHash,f.type.data.contentHash);
 assert.equal((await readFile(f.s.workingPath,'utf8')).includes('T#8s'),true);
 const count=f.commands.length,again=await f.call('variable_edit',f.request);
 assert.deepEqual(again,first);assert.equal(f.commands.length,count);
});

test('wrong type hash and absent member reject before change/save, leaving file and session usable',async t=>{
 const f=await fixture(t),before=await sha(f.s.workingPath),count=f.commands.length;
 const stale=await f.call('variable_edit',{...f.request,requestId:randomUUID(),expectedTypeHash:'0'.repeat(64)});
 assert.equal(stale.status,'conflict');assert.equal(await sha(f.s.workingPath),before);
 const missing=await f.call('variable_edit',{...f.request,requestId:randomUUID(),memberName:'Missing'});
 assert.equal(missing.status,'unsupported');assert.equal(await sha(f.s.workingPath),before);
 assert.equal(f.commands.slice(count).includes('change'),false);assert.equal(f.commands.slice(count).includes('save'),false);
 const success=await f.call('variable_edit',f.request);assert.equal(success.status,'succeeded',JSON.stringify(success));
});

test('same-name local DUT ambiguity refuses before change',async t=>{
 const extra={objectId:randomUUID(),applicationId:app,path:['设备','应用一','ST_AlarmConfig'],objectType:'structure',nativeTypeId:native,hasImplementation:false,declaration:dut,implementation:''};
 const f=await fixture(t,entries([extra])),before=await sha(f.s.workingPath),count=f.commands.length;
 const r=await f.call('variable_edit',f.request);
 assert.equal(r.status,'unsupported',JSON.stringify(r));assert.equal(await sha(f.s.workingPath),before);
 assert.equal(f.commands.slice(count).includes('change'),false);
});

test('old actions reject member-only parameters; same value reports no save',async t=>{
 const f=await fixture(t);
 assert.equal(schemas.variable_edit.safeParse({...f.request,action:'set-initializer'}).success,false);
 const count=f.commands.length;
 const r=await f.call('variable_edit',{...f.request,initializer:'T#5s'});
 assert.equal(r.status,'succeeded');assert.equal(r.data.noOp,true);
 assert.equal(f.commands.slice(count).includes('change'),false);
 assert.equal(f.commands.slice(count).includes('save'),false);
});

test('native write boundary rejects a changed structure even after successful service preflight',async t=>{
 const tamper=req=>req.command==='change'?{...req,args:{...req.args,variableTypeGuard:{...req.args.variableTypeGuard,contentHash:'0'.repeat(64)}}}:req;
 const f=await fixture(t,entries(),tamper),before=await sha(f.s.workingPath);
 const r=await f.call('variable_edit',f.request);
 assert.equal(r.status,'conflict',JSON.stringify(r));assert.equal(r.error.code,'MEMBER_TYPE_CHANGED');
 assert.equal(await sha(f.s.workingPath),before);assert.equal(f.commands.includes('change'),true);
});

test('old parent hash and external disk changes stop before dispatching a write',async t=>{
 const f=await fixture(t),start=f.commands.length;
 const stale=await f.call('variable_edit',{...f.request,requestId:randomUUID(),expectedHash:'0'.repeat(64)});
 assert.equal(stale.status,'conflict');assert.equal(f.commands.slice(start).includes('change'),false);
 const {writeFile}=await import('node:fs/promises');
 await writeFile(f.s.workingPath,(await readFile(f.s.workingPath,'utf8'))+' ');
 const count=f.commands.length,r=await f.call('variable_edit',{...f.request,requestId:randomUUID()});
 assert.equal(r.status,'conflict');assert.equal(f.commands.length,count);
});

test('uncertain partial member write freezes without an automatic reverse write',async t=>{
 const f=await fixture(t,entries(),x=>x,{failImplementation:true});
 const first=await f.call('variable_edit',f.request);
 assert.equal(first.status,'unknown',JSON.stringify(first));
 assert.equal(first.error.code,'PARTIAL_WRITE');
 assert.equal((await readFile(f.s.workingPath,'utf8')).includes('T#8s'),true);
 const count=f.commands.filter(x=>x==='change').length;
 await assert.rejects(f.call('variable_edit',{...f.request,requestId:randomUUID()}),e=>e.code==='PENDING_UNKNOWN');
 assert.equal(f.commands.filter(x=>x==='change').length,count);
});
