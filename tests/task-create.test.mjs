import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setup} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas,outputSchemas} from '../dist/contracts.js';
import {codeHash,digest} from '../dist/storage.js';

const nativeStImplementation='3b83b776-fb25-43b8-99f2-3c507c9143fc';

async function context(t,mutate=()=>{},changeResult=x=>x,{inspect=true}={}) {
  const e=await setup(),adapter=new FixtureAdapter();
  const writes=[];
  const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:3000},
    {execute:async (req,...rest)=>{
      if(['task_create','task_call_append'].includes(req.command))writes.push(req.operationId);
      const result=await adapter.execute(req,...rest);
      return ['task_create','task_call_append'].includes(req.command)?changeResult(result):result;
    },reconcile:d=>adapter.reconcile(d)});
  t.after(()=>service.store.release());
  const call=(tool,args)=>service.call(tool,schemas[tool].parse(args));
  const opened=await call('project_create',{requestId:randomUUID(),projectPath:path.join(await realpath(e.dir),'AM610.project')});
  assert.equal(opened.status,'succeeded');
  const session=opened.data.session,file=session.workingPath;
  const seed=JSON.parse(await readFile(file,'utf8')),applicationId=session.applicationId;
  const declaration='PROGRAM PRG_S8Probe\nVAR\nEND_VAR',implementation='';
  const program={...seed.objects[0],path:[...seed.applications[0].path,'PRG_S8Probe'],objectId:randomUUID(),
    declaration,implementation,contentHash:codeHash(declaration,implementation),embeddedObjectTypes:[nativeStImplementation]};
  seed.objects.push(program);
  seed.taskConfigurationId=randomUUID();
  mutate(seed,program);
  await writeFile(file,JSON.stringify(seed));
  const disk=digest(await readFile(file));
  await service.store.saveSession({...session,diskHash:disk});
  const target={projectId:session.projectId,applicationId};
  const baseline=await call('project_build',{...target,requestId:randomUUID()});
  assert.equal(baseline.status,'succeeded');
  const before=inspect?await call('task_inspect',target):undefined;
  const args={...target,requestId:randomUUID(),taskConfigurationId:seed.taskConfigurationId,name:'ProbeTask',intervalMs:50,
    programId:program.objectId,expectedProgramHash:program.contentHash,expectedTaskVersion:before?.data.configurationVersion??baseline.data.taskConfigurationVersion,expectedDiskHash:disk};
  const {name,intervalMs,...identity}=args;
  const appendArgs={...identity,taskId:seed.tasks[0].taskId};
  return {file,service,call,baseline,before,args,appendArgs,target,writes};
}

test('append product retains the entire ordered prefix and comments, invalidates build, and deduplicates',async t=>{
  const original=[['PLC_PRG',''],['Another','保留中文注释'],['Third','None']];
  const x=await context(t,p=>p.tasks[0].rawCalls=original);
  const r=await x.call('task_call_append',x.appendArgs);
  assert.equal(r.status,'succeeded',JSON.stringify(r));
  assert(outputSchemas.task_call_append.safeParse(r).success);
  assert.deepEqual(r.data.before.tasks[0].rawCalls,original);
  assert.deepEqual(r.data.after.tasks[0].rawCalls,[...original,['PRG_S8Probe','']]);
  assert.deepEqual(r.data.afterAppend,r.data.after);
  assert.equal(r.data.buildApplicable,false);
  assert.equal((await x.service.store.session()).buildApplicable,false);
  assert.deepEqual(await x.call('task_call_append',x.appendArgs),r);
  assert.deepEqual(x.writes,[r.operationId]);
  const built=await x.call('project_build',{...x.target,requestId:randomUUID()});
  assert.equal(built.data.taskConfigurationVersion,r.data.configurationVersion);
  assert.equal(built.data.diskHash,digest(await readFile(x.file)));
});

test('append fixture rejects malformed raw records with a matching version before add or save',async t=>{
  for(const row of [[null,''],['PLC_PRG',null],'AB']){
    const x=await context(t,p=>p.tasks[0].rawCalls=[row],undefined,{inspect:false});
    assert.equal(x.appendArgs.expectedTaskVersion,x.baseline.data.taskConfigurationVersion);
    const r=await x.call('task_call_append',x.appendArgs);
    assert.equal(r.status,'conflict',JSON.stringify(r));
    assert.equal(r.error.code,'TASK_APPEND_IDENTITY_OR_COVERAGE');
    const op=await x.service.store.operation(r.operationId);
    await assert.rejects(access(path.join(op.bridge.directory,'task-append-dispatched.json')));
    await assert.rejects(access(path.join(op.bridge.directory,'checkpoint.project')));
    assert.equal(digest(await readFile(x.file)),x.appendArgs.expectedDiskHash);
    assert.deepEqual(JSON.parse(await readFile(x.file,'utf8')).tasks[0].rawCalls,[row]);
  }
});

for(const stage of ['afterAppend','reopen'])test('append freezes when literal None is read as native null at '+stage,async t=>{
  const x=await context(t,p=>{
    p.tasks[0].rawCalls[0][1]='None';
    p.nullTaskAppendCommentAt=stage;
  });
  const r=await x.call('task_call_append',x.appendArgs);
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,'TASK_APPEND_INCOMPLETE');
  assert.equal(r.data.automaticRollback,false);
  assert.deepEqual(r.data.before.tasks[0].rawCalls,[['PLC_PRG','None']]);
  assert.equal(r.data.partial.tasks[0].rawCalls[0][1],null);
  const op=await x.service.store.operation(r.operationId);
  const checkpoint=await readFile(path.join(op.bridge.directory,'checkpoint.project'));
  const dispatch=JSON.parse(await readFile(path.join(op.bridge.directory,'task-append-dispatched.json'),'utf8'));
  assert.equal(dispatch.order,1);
  assert.equal(digest(checkpoint),x.appendArgs.expectedDiskHash);
  assert.equal(digest(await readFile(x.file))!==x.appendArgs.expectedDiskHash,stage==='reopen');
  assert.deepEqual(await x.call('task_call_append',x.appendArgs),r);
  await assert.rejects(x.call('task_call_append',{...x.appendArgs,requestId:randomUUID()}),/未决/);
  assert.deepEqual(x.writes,[r.operationId]);
});

test('append guard rejects duplicate names, stale versions and missing comment tuples before native mutation',async t=>{
  for(const [mutation,patch,code] of [
    [p=>p.tasks[0].rawCalls.push(['pRg_s8pROBE','already']),{},'TASK_CALL_EXISTS'],
    [p=>p.tasks[0].rawCalls=[['PLC_PRG']],{},'TASK_APPEND_IDENTITY_OR_COVERAGE'],
    [()=>{}, {expectedTaskVersion:'9'.repeat(64)},'TASK_VERSION_CHANGED'],
  ]){
    const x=await context(t,mutation),before=await readFile(x.file);
    const r=await x.call('task_call_append',{...x.appendArgs,...patch});
    assert.equal(r.status,'conflict',JSON.stringify(r));
    assert.equal(r.error.code,code);
    const op=await x.service.store.operation(r.operationId);
    await assert.rejects(access(path.join(op.bridge.directory,'task-append-dispatched.json')));
    await assert.rejects(access(path.join(op.bridge.directory,'checkpoint.project')));
    assert.deepEqual(await readFile(x.file),before);
  }
});

for(const [fault,changed] of [['failTaskCallAppend',false],['failTaskAppendReopen',true]])test('append freezes after '+fault,async t=>{
  const x=await context(t,p=>p[fault]=true);
  const r=await x.call('task_call_append',x.appendArgs);
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,'TASK_APPEND_INCOMPLETE');
  assert.equal(r.data.automaticRollback,false);
  assert.equal(digest(await readFile(x.file))!==x.appendArgs.expectedDiskHash,changed);
  assert.deepEqual(await x.call('task_call_append',x.appendArgs),r);
  await assert.rejects(x.call('task_call_append',{...x.appendArgs,requestId:randomUUID()}),/未决/);
  assert.deepEqual(x.writes,[r.operationId]);
});

test('service freezes even when a success reply hides a damaged append prefix',async t=>{
  const x=await context(t,()=>{},r=>{r.data.afterAppend.tasks[0].rawCalls[0][1]='changed';return r;});
  const r=await x.call('task_call_append',x.appendArgs);
  assert.equal(r.status,'unknown');
  assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
});

test('create task binds unique root PROGRAM, keeps existing calls and invalidates old build',async t=>{
  const x=await context(t);
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'succeeded',JSON.stringify(r));
  assert(outputSchemas.task_create.safeParse(r).success);
  assert.equal(r.data.task.rawFields.interval,'t#50ms');
  assert.deepEqual(r.data.programEmbeddedObjectTypes,[nativeStImplementation]);
  assert.deepEqual(r.data.calls,[{order:0,applicationId:x.args.applicationId,programId:x.args.programId,raw:['PRG_S8Probe','']}]);
  assert.deepEqual(r.data.after.tasks[0].rawCalls,x.before.data.tasks[0].calls.map(c=>c.raw));
  assert.equal(r.data.snapshot,x.baseline.data.snapshot);
  assert.equal(r.data.buildApplicable,false);
  assert.equal((await x.service.store.session()).buildApplicable,false);
  assert.equal(digest(await readFile(r.data.checkpoint)),x.args.expectedDiskHash);
  assert.equal(r.data.savedDiskHash,digest(await readFile(x.file)));
  assert.deepEqual(await x.call('task_create',x.args),r);
  assert.deepEqual(x.writes,[r.operationId]);
  const built=await x.call('project_build',{...x.target,requestId:randomUUID()});
  assert.equal(built.data.taskConfigurationVersion,r.data.configurationVersion);
  const saved=await x.call('project_save',{...x.target,requestId:randomUUID(),expectedSnapshot:built.data.snapshot});
  assert.equal(saved.data.buildApplicable,true);
  const read=await x.call('task_inspect',x.target);
  assert.equal(read.data.tasks.find(row=>row.taskId===r.data.taskId).calls[0].resolution.objectId,x.args.programId);
});

test('task created but bind unconfirmed keeps checkpoint, original exception and frozen replay',async t=>{
  const x=await context(t,p=>p.failNewTaskBinding=true),bytes=await readFile(x.file);
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,'TASK_CREATE_INCOMPLETE');
  assert.deepEqual(r.data.actions.map(a=>[a.stage,a.status]),[['create','succeeded'],['period','succeeded'],['bind','started']]);
  assert.match(r.data.primaryException.message,/bind error/);
  assert.deepEqual(r.data.partial.tasks.find(task=>task.taskId===r.data.taskId).rawCalls,[]);
  assert.equal(r.data.automaticRollback,false);
  assert.deepEqual(await readFile(r.data.checkpoint),bytes);
  assert.deepEqual(await x.call('task_create',x.args),r);
  await assert.rejects(x.call('task_create',{...x.args,requestId:randomUUID()}),/未决/);
  assert.deepEqual(x.writes,[r.operationId]);
  assert.deepEqual(await readFile(x.file),bytes);
});

for(const [label,mutate,makePatch,code] of [
  ['old configuration',()=>{},()=>({expectedTaskVersion:'1'.repeat(64)}),'TASK_VERSION_CHANGED'],
  ['name collision',()=>{},()=>({name:'maintask'}),'TASK_NAME_EXISTS'],
  ['wrong task configuration node',()=>{},()=>({taskConfigurationId:randomUUID()}),'TASK_CREATE_IDENTITY_OR_COVERAGE'],
  ['stale PROGRAM text',()=>{},()=>({expectedProgramHash:'9'.repeat(64)}),'TASK_CREATE_IDENTITY_OR_COVERAGE'],
  ['incomplete raw calls',p=>{p.tasks[0].callsComplete=false;},()=>({}),'TASK_CREATE_IDENTITY_OR_COVERAGE'],
  ['ambiguous PROGRAM name',(p,prg)=>p.objects.push({...prg,objectId:randomUUID()}),()=>({}),'TASK_CREATE_IDENTITY_OR_COVERAGE']
])test('write guard: '+label,async t=>{
  const x=await context(t,mutate),before=await readFile(x.file);
  const r=await x.call('task_create',{...x.args,...makePatch()});
  assert.equal(r.status,'conflict',JSON.stringify(r));assert.equal(r.error.code,code);
  const op=await x.service.store.operation(r.operationId);
  await assert.rejects(access(path.join(op.bridge.directory,'checkpoint.project')));
  assert.deepEqual(await readFile(x.file),before);
});

test('disk conflict is rejected without native dispatch',async t=>{
  const x=await context(t);
  const r=await x.call('task_create',{...x.args,expectedDiskHash:'2'.repeat(64)});
  assert.equal(r.status,'conflict');assert.equal(r.error.code,'TASK_DISK_CHANGED');
  assert.deepEqual(x.writes,[]);
});

for(const [label,mutate,message] of [
  ['non-ST',(p,program)=>program.embeddedObjectTypes=['00000000-0000-0000-0000-000000000001'],/原生 ST/],
  ['missing',(p,program)=>delete program.embeddedObjectTypes,/原生 ST/],
  ['unreadable',(p,program)=>program.embeddedObjectTypesError='Native embedded type read failed',/Native embedded type read failed/]
])test('native PROGRAM language guard rejects before creating a checkpoint: '+label,async t=>{
  const x=await context(t,mutate);
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'conflict',JSON.stringify(r));
  assert.equal(r.error.code,'TASK_CREATE_IDENTITY_OR_COVERAGE');
  assert.match(r.data.primaryException.message,message);
  const op=await x.service.store.operation(r.operationId);
  await assert.rejects(access(path.join(op.bridge.directory,'checkpoint.project')));
  assert.equal(digest(await readFile(x.file)),x.args.expectedDiskHash);
  assert.deepEqual(x.writes,[r.operationId]);
});

for(const [stage,mutate,message,saved] of [
  ['bind',p=>p.loseTaskProgramLanguageAfterBind=true,/原生 ST/,false],
  ['reopen',p=>p.taskProgramLanguageReopenError='Native embedded type read failed',/Native embedded type read failed/,true]
])test('language evidence failure at '+stage+' freezes without replay or rollback',async t=>{
  const x=await context(t,mutate);
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,'TASK_CREATE_INCOMPLETE');
  assert.match(r.data.primaryException.message,message);
  assert.deepEqual(r.data.actions.at(-1),{stage:'bind',status:'succeeded'});
  assert.equal(r.data.automaticRollback,false);
  assert.equal(digest(await readFile(r.data.checkpoint)),x.args.expectedDiskHash);
  assert.equal(digest(await readFile(x.file))!==x.args.expectedDiskHash,saved);
  assert.deepEqual(await x.call('task_create',x.args),r);
  await assert.rejects(x.call('task_create',{...x.args,requestId:randomUUID()}),/未决/);
  assert.deepEqual(x.writes,[r.operationId]);
});

test('inconsistent saved binding evidence reported as unknown',async t=>{
  const x=await context(t,()=>{},r=>{r.data.calls[0].programId=randomUUID();return r;});
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
  await assert.rejects(x.call('task_create',{...x.args,requestId:randomUUID()}),/未决/);
  assert.equal(x.writes.length,1);
});

test('service freezes when bridge success omits native ST evidence',async t=>{
  const x=await context(t,()=>{},r=>{delete r.data.programEmbeddedObjectTypes;return r;});
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'unknown');
  assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
  await assert.rejects(x.call('task_create',{...x.args,requestId:randomUUID()}),/未决/);
  assert.deepEqual(x.writes,[r.operationId]);
});
