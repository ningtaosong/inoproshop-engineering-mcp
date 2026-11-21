import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access,realpath,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {setup} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas,outputSchemas} from '../dist/contracts.js';
import {codeHash,digest} from '../dist/storage.js';

const nativeStImplementation='3b83b776-fb25-43b8-99f2-3c507c9143fc';

async function context(t,mutate=()=>{},changeResult=x=>x,{inspect=true,copy=false}={}) {
  const e=await setup(),adapter=new FixtureAdapter();
  const writes=[];
  const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:3000},
    {execute:async (req,...rest)=>{
      if(['task_create','task_call_append','task_call_replace'].includes(req.command))writes.push(req.operationId);
      const result=await adapter.execute(req,...rest);
      return ['task_create','task_call_append','task_call_replace'].includes(req.command)?changeResult(result,req,rest[0]):result;
    },reconcile:d=>adapter.reconcile(d)});
  t.after(()=>service.store.release());
  const call=(tool,args)=>service.call(tool,schemas[tool].parse(args));
  const opened=await call('project_create',{requestId:randomUUID(),projectPath:path.join(await realpath(e.dir),'AM610.project')});
  assert.equal(opened.status,'succeeded');
  let session=opened.data.session,file=session.workingPath;
  const seed=JSON.parse(await readFile(file,'utf8')),applicationId=session.applicationId;
  const declaration='PROGRAM PRG_S8Probe\nVAR\nEND_VAR',implementation='';
  const program={...seed.objects[0],path:[...seed.applications[0].path,'PRG_S8Probe'],objectId:randomUUID(),
    declaration,implementation,contentHash:codeHash(declaration,implementation),embeddedObjectTypes:[nativeStImplementation]};
  seed.objects.push(program);
  seed.taskConfigurationId=randomUUID();
  mutate(seed,program);
  await writeFile(file,JSON.stringify(seed));
  if(copy){
    const source=path.join(e.dir,'copy-seed.project');
    await writeFile(source,JSON.stringify(seed),{flag:'wx'});
    const openedCopy=await call('project_open_copy',{sourcePath:source,applicationId,requestId:randomUUID()});
    assert.equal(openedCopy.status,'succeeded',JSON.stringify(openedCopy));
    session=openedCopy.data.session;file=session.workingPath;
  }
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
  return {file,service,call,baseline,before,args,appendArgs,target,writes,seed};
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

for(const mode of ['direct','copy']){
  for(const fault of [null,'name','comment','readback','reopen'])test('replace '+mode+' '+(fault??'saved version'),async t=>{
    const x=await context(t,p=>{
      p.objects[0].embeddedObjectTypes=[nativeStImplementation];
      p.tasks[0].rawCalls=[['Other','中文'],['PLC_PRG','None']];
      p.failTaskReplace=fault;
    },undefined,{copy:mode==='copy'});
    const old=x.seed.objects[0],args={...x.appendArgs,oldProgramId:old.objectId,expectedOldProgramHash:old.contentHash,
      expectedCallOrder:1,expectedCall:['PLC_PRG','None']};
    const r=await x.call('task_call_replace',args);
    assert.equal(r.status,fault?'unknown':'succeeded',JSON.stringify(r));
    assert.deepEqual(await x.call('task_call_replace',args),r);
    assert.equal(x.writes.length,1);
    if(fault){
      assert.equal(r.data.automaticRollback,false);
      assert.equal(digest(await readFile(x.file))!==args.expectedDiskHash,fault==='reopen');
      await assert.rejects(x.call('task_call_replace',{...args,requestId:randomUUID()}),/未决/);
      assert.equal(x.writes.length,1);
    }else{
      assert.deepEqual(r.data.after.tasks[0].rawCalls,[['Other','中文'],['PRG_S8Probe','None']]);
      assert.equal((await x.service.store.session()).buildApplicable,false);
      const build=await x.call('project_build',{...x.target,requestId:randomUUID()});
      assert.equal(build.data.taskConfigurationVersion,r.data.configurationVersion);
      assert.equal(build.data.diskHash,digest(await readFile(x.file)));
    }
  });
}
test('replace service independently rejects incomplete reopened PROGRAM evidence',async t=>{
  const x=await context(t,p=>{p.objects[0].embeddedObjectTypes=[nativeStImplementation];},r=>{
    if(r.status==='succeeded')delete r.data.programReads.reopened.oldProgram;
    return r;
  });
  const old=x.seed.objects[0];
  const r=await x.call('task_call_replace',{...x.appendArgs,oldProgramId:old.objectId,expectedOldProgramHash:old.contentHash,
    expectedCallOrder:0,expectedCall:['PLC_PRG','']});
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
});

for(const copy of [false,true])test('replace refuses a stale row, PROGRAM or disk before mutation '+(copy?'copy':'direct'),async t=>{
  const x=await context(t,p=>{p.objects[0].embeddedObjectTypes=[nativeStImplementation];},undefined,{copy});
  const old=x.seed.objects[0],args={...x.appendArgs,oldProgramId:old.objectId,expectedOldProgramHash:old.contentHash,
    expectedCallOrder:0,expectedCall:['PLC_PRG','']};
  for(const patch of [{expectedCallOrder:1},{expectedCall:['PLC_PRG','None']},{expectedTaskVersion:'1'.repeat(64)},
    {expectedOldProgramHash:'2'.repeat(64)},{expectedProgramHash:'3'.repeat(64)},{expectedDiskHash:'4'.repeat(64)}]){
    const r=await x.call('task_call_replace',{...args,...patch,requestId:randomUUID()});
    assert.equal(r.status,'conflict');
    const op=await x.service.store.operation(r.operationId);
    if(op.bridge)for(const name of ['task-replace-dispatched.json','checkpoint.project']){
      await assert.rejects(access(path.join(op.bridge.directory,name)));
    }
    assert.equal(digest(await readFile(x.file)),args.expectedDiskHash);
  }
});


// 0.34.1: only task_create task enumeration is an identity set; raw calls stay ordered.
for(const copy of [false,true])test('create accepts reordered multiple old tasks in saved inventory '+(copy?'copy':'direct'),async t=>{
  const x=await context(t,p=>{
    p.tasks.push({...structuredClone(p.tasks[0]),taskId:randomUUID(),
      path:[...p.tasks[0].path.slice(0,-1),'Secondary'],rawCalls:[['A','中文'],['B','None']]});
    p.taskCreateReopenOrder=true;
  },undefined,{copy});
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'succeeded',JSON.stringify(r));
  assert(outputSchemas.task_create.safeParse(r).success);
  assert.deepEqual(r.data.before.tasks.map(t=>t.path.at(-1)),['MainTask','Secondary']);
  assert.deepEqual(r.data.after.tasks.map(t=>t.path.at(-1)),['ProbeTask','Secondary','MainTask']);
  assert.deepEqual(r.data.after.tasks[1].rawCalls,[['A','中文'],['B','None']]);
  assert.deepEqual(await x.call('task_create',x.args),r);
  assert.equal(x.writes.length,1);
  assert.equal((await x.service.store.session()).buildApplicable,false);
});

for(const [label,mutate] of [
  ['removed task',d=>d.after.tasks.splice(0,1)],
  ['added task',d=>d.after.tasks.push({...d.after.tasks[0],taskId:randomUUID()})],
  ['duplicated identity',d=>d.after.tasks.push(structuredClone(d.after.tasks[0]))],
  ['empty identity',d=>d.after.tasks[0].taskId=''],
  ['missing identity',d=>delete d.after.tasks[0].taskId],
  ['parent path',d=>d.after.tasks[0].path[0]='Elsewhere'],
  ['period',d=>d.after.tasks[0].rawFields.interval='t#21ms'],
  ['priority',d=>d.after.tasks[0].rawFields.priority='2'],
  ['watchdog',d=>d.after.tasks[0].watchdog.enabled='True'],
  ['calls reorder',d=>d.after.tasks[0].rawCalls.reverse()],
  ['comment null',d=>d.after.tasks[0].rawCalls[0][1]=null],
  ['comment value',d=>d.after.tasks[0].rawCalls[0][1]='Changed'],
  ['binding',d=>d.after.tasks[0].rawCalls[0][0]='Changed'],
  ['PROGRAM identity',d=>d.after.programs[0].objectId=randomUUID()],
  ['missing field',d=>delete d.after.tasks[0].rawFields.priority],
  ['read error',d=>d.after.tasks[0].unavailableFields.push({field:'priority',reason:'failed'})],
  ['coverage',d=>d.after.coverageComplete=false],
  ['new metadata',d=>d.after.futureEvidence={readable:false}],
])test('create service refuses changed preserved evidence and freezes: '+label,async t=>{
  const x=await context(t,p=>p.tasks[0].rawCalls=[['PLC_PRG','None'],['Other','中文']],r=>{
    mutate(r.data);return r;
  });
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
  const bytes=await readFile(x.file);
  assert.deepEqual(await x.call('task_create',x.args),r);
  await assert.rejects(x.call('task_create',{...x.args,requestId:randomUUID()}),/未决/);
  assert.deepEqual(await readFile(x.file),bytes);
  assert.equal(x.writes.length,1);
});

for(const [label,mutate] of [
  ['duplicate ID',p=>p.tasks.push(structuredClone(p.tasks[0]))],
  ['empty ID',p=>p.tasks[0].taskId=''],
  ['null call',p=>p.tasks[0].rawCalls=[['PLC_PRG',null]]],
  ['missing configuration field',p=>delete p.tasks[0].rawFields.priority],
])test('create fixture strict preflight has no checkpoint or save: '+label,async t=>{
  const x=await context(t,mutate,undefined,{inspect:false});
  const r=await x.call('task_create',x.args);
  assert.equal(r.status,'conflict',JSON.stringify(r));
  assert.equal(r.error.code,'TASK_CREATE_IDENTITY_OR_COVERAGE');
  assert.equal(digest(await readFile(x.file)),x.args.expectedDiskHash);
  const op=await x.service.store.operation(r.operationId);
  await assert.rejects(access(path.join(op.bridge.directory,'checkpoint.project')));
});


function callInventorySeed(p) {
  p.objects[0].embeddedObjectTypes=[nativeStImplementation];
  p.tasks[0].rawCalls=[['PLC_PRG','中文'],['Another',''],['Third','None']];
  p.tasks.push({...structuredClone(p.tasks[0]),taskId:randomUUID(),
    path:[...p.tasks[0].path.slice(0,-1),'Secondary'],rawCalls:[['Other','保留'],['Last','None']]});
}
function callInventoryArgs(x,tool) {
  const old=x.seed.objects[0];
  return tool==='append'?x.appendArgs:{...x.appendArgs,oldProgramId:old.objectId,
    expectedOldProgramHash:old.contentHash,expectedCallOrder:0,expectedCall:['PLC_PRG','中文']};
}
for(const tool of ['append','replace'])for(const stage of ['none','immediate','reopened']){
  test('call inventory '+tool+' accepts only top-level order at '+stage,async t=>{
    const x=await context(t,callInventorySeed,r=>{
      if(r.status==='succeeded'){
        const key=stage==='immediate'?(tool==='append'?'afterAppend':'afterReplace'):'after';
        if(stage!=='none')r.data[key].tasks.reverse();
      }
      return r;
    });
    const r=await x.call('task_call_'+tool,callInventoryArgs(x,tool));
    assert.equal(r.status,'succeeded',JSON.stringify(r));
    const row=r.data.after.tasks.find(task=>task.taskId===x.appendArgs.taskId);
    assert.deepEqual(row.rawCalls,tool==='append'?
      [['PLC_PRG','中文'],['Another',''],['Third','None'],['PRG_S8Probe','']]:
      [['PRG_S8Probe','中文'],['Another',''],['Third','None']]);
  });
}


const callInventoryFaults={
  'target order':i=>i.tasks[0].rawCalls.reverse(),
  'other order':i=>i.tasks[1].rawCalls.reverse(),
  'call added':i=>i.tasks[0].rawCalls.push(['Unexpected','']),
  'call removed':i=>i.tasks[0].rawCalls.pop(),
  'call name':i=>i.tasks[0].rawCalls[0][0]='Wrong',
  'comment':i=>i.tasks[0].rawCalls[0][1]='Wrong',
  'None versus null':i=>i.tasks[0].rawCalls[2][1]=null,
  'binding':i=>i.programs[0].objectId=randomUUID(),
  'priority':i=>i.tasks[0].rawFields.priority='9',
  'interval':i=>i.tasks[0].rawFields.interval='t#99ms',
  'watchdog':i=>i.tasks[0].watchdog.enabled='True',
  'missing id':i=>delete i.tasks[0].taskId,
  'zero id':i=>i.tasks[0].taskId='00000000-0000-0000-0000-000000000000',
  'invalid id':i=>i.tasks[0].taskId='not-a-guid',
  'duplicate id':i=>i.tasks[1].taskId=i.tasks[0].taskId,
  'task added':i=>i.tasks.push({...structuredClone(i.tasks[0]),taskId:randomUUID()}),
  'task removed':i=>i.tasks.pop(),
  'path':i=>i.tasks[0].path.push('Unexpected'),
  'parent':i=>i.tasks[0].path[0]='Wrong',
  'type':i=>i.tasks[0].rawFields.priority=1,
  'missing field':i=>delete i.tasks[0].watchdog.enabled,
  'incomplete':i=>i.coverageComplete=false,
  'read failure':i=>i.resolutionReadFailures.push({message:'injected'}),
  'unavailable':i=>i.tasks[0].unavailableFields.push('watchdog'),
  'unknown field':i=>i.tasks[0].future=[null,'','None']
};
for(const tool of ['append','replace'])for(const stage of ['immediate','reopened'])
for(const [label,mutate] of Object.entries(callInventoryFaults)){
 test('call inventory '+tool+' rejects '+stage+' '+label,async t=>{
   const key=stage==='immediate'?(tool==='append'?'afterAppend':'afterReplace'):'after';
   const x=await context(t,callInventorySeed,r=>{if(r.status==='succeeded')mutate(r.data[key]);return r;});
   const args=callInventoryArgs(x,tool),r=await x.call('task_call_'+tool,args);
   assert.equal(r.status,'unknown',JSON.stringify(r));
   assert.deepEqual(await x.call('task_call_'+tool,args),r);
   const saved=await readFile(x.file),op=await x.service.store.operation(r.operationId);
   const attempts=await readdir(path.join(op.bridge.directory,'task-call-service'));
   assert.equal(attempts.length,1);
   const evidence=path.join(op.bridge.directory,'task-call-service',attempts[0]);
   const observed=JSON.parse(await readFile(path.join(evidence,'task-call-service-observed.json'),'utf8'));
   const check=JSON.parse(await readFile(path.join(evidence,'task-call-service-verification.json'),'utf8'));
   assert.equal(check.status,'failed');assert(check.checks[key]);
   assert.equal(observed.result.status,'succeeded'); // Raw bridge reply retained, not accepted as overall success.
   await assert.rejects(x.call('task_call_'+tool,{...args,requestId:randomUUID()}),{code:'PENDING_UNKNOWN'});
   assert.equal(x.writes.length,1);
   assert.deepEqual(await readFile(x.file),saved); // no recovery save/rollback
 });
}
for(const tool of ['append','replace'])for(const label of ['source','language','identity']){
 test('call inventory '+tool+' retains PROGRAM '+label+' guards',async t=>{
   const x=await context(t,callInventorySeed,r=>{
     if(r.status==='succeeded'){
       if(label==='source')r.data.program.contentHash='0'.repeat(64);
       if(label==='language')r.data.programEmbeddedObjectTypes=[];
       if(label==='identity')r.data.program.objectId=randomUUID();
     }return r;
   });
   assert.equal((await x.call('task_call_'+tool,callInventoryArgs(x,tool))).status,'unknown');
 });
}
for(const tool of ['append','replace'])for(const copy of [false,true]){
 test('call inventory '+tool+' publication failure freezes '+copy,async t=>{
   const x=await context(t,callInventorySeed,undefined,{copy});
   x.service.publishTaskCallEvidence=async()=>{throw Error('injected disk publication failure');};
   const args=callInventoryArgs(x,tool),r=await x.call('task_call_'+tool,args);
   assert.equal(r.status,'unknown',JSON.stringify(r));
   assert.equal(r.error.code,'TASK_CALL_EVIDENCE_PUBLICATION_FAILED');
   const saved=await readFile(x.file);
   assert.deepEqual(await x.call('task_call_'+tool,args),r);
   await assert.rejects(x.call('task_call_'+tool,{...args,requestId:randomUUID()}),{code:'PENDING_UNKNOWN'});
   assert.equal(x.writes.length,1);assert.deepEqual(await readFile(x.file),saved);
 });
 test('call inventory '+tool+' restart rejects same invalid evidence '+copy,async t=>{
   const x=await context(t,callInventorySeed,async(r,req,dir)=>{
     if(r.status==='succeeded'){
       r.data.after.tasks[0].rawCalls[0][1]='wrong on saved reopen';
       await writeFile(path.join(dir,'result.json'),JSON.stringify(r));
     }return r;
   },{copy});
   const args=callInventoryArgs(x,tool),r=await x.call('task_call_'+tool,args);
   assert.equal(r.status,'unknown',JSON.stringify(r));const saved=await readFile(x.file);
   const op=await x.service.store.operation(r.operationId);
   const root=path.join(op.bridge.directory,'task-call-service'),first=(await readdir(root))[0];
   const firstBytes=await readFile(path.join(root,first,'task-call-service-verification.json'));
   await x.service.store.release();
   const adapter=new FixtureAdapter(),restarted=new EngineeringService(x.service.config,{
     execute:async()=>{assert.fail('must not redispatch');},reconcile:d=>adapter.reconcile(d)});
   t.after(()=>restarted.store.release());
   await assert.rejects(restarted.operation({operationId:r.operationId,reconcile:true}),/桥接结果/);
   assert.deepEqual(await restarted.call('task_call_'+tool,schemas['task_call_'+tool].parse(args)),r);
   assert.equal((await restarted.store.operation(r.operationId)).status,'unknown');
   assert.equal((await readdir(root)).length,2);
   assert.deepEqual(await readFile(path.join(root,first,'task-call-service-verification.json')),firstBytes);
   assert.deepEqual(await readFile(x.file),saved);
 });
}
for(const tool of ['append','replace'])for(const label of ['duplicate','missing','invalid','calls','coverage']){
 test('call inventory '+tool+' preflight '+label+' has zero dispatch and unchanged file',async t=>{
   const x=await context(t,p=>{
     callInventorySeed(p);
     if(label==='duplicate')p.tasks[1].taskId=p.tasks[0].taskId;
     if(label==='missing')delete p.tasks[1].taskId;
     if(label==='invalid')p.tasks[1].taskId='invalid';
     if(label==='calls')p.tasks[1].rawCalls[0][1]=null;
     if(label==='coverage')p.tasks[1].callsComplete=false;
   },undefined,{inspect:false});
   const disk=await readFile(x.file);
   const r=await x.call('task_call_'+tool,callInventoryArgs(x,tool));
   assert.notEqual(r.status,'succeeded',JSON.stringify(r));
   const op=await x.service.store.operation(r.operationId);
   if(op.bridge)await assert.rejects(access(path.join(op.bridge.directory,'task-'+tool+'-dispatched.json')));
   assert.deepEqual(await readFile(x.file),disk);
 });
}

for(const tool of ['append','replace'])test('call inventory '+tool+' publication failure retains first validation error',async t=>{
  const x=await context(t,callInventorySeed,r=>{r.data.after.tasks[0].rawCalls[0][1]='wrong';return r;});
  x.service.publishTaskCallEvidence=async()=>{throw Error('secondary publication error');};
  const r=await x.call('task_call_'+tool,callInventoryArgs(x,tool));
  assert.equal(r.status,'unknown');
  assert.equal(r.error.code,'RESULT_CONTRACT_MISMATCH');
  assert.match(r.error.message,/桥接结果/);assert.match(r.error.message,/secondary publication error/);
});


// PROGRAM catalog ordering has no task execution semantics (0.34.3 supplement).
for(const tool of ['create','append','replace'])
for(const stage of tool==='create'?['reopened']:['immediate','reopened'])
for(const order of ['programs','tasks','both']){
 test('program directory '+tool+' '+stage+' accepts '+order,async t=>{
  const key=stage==='immediate'?(tool==='append'?'afterAppend':'afterReplace'):'after';
  const x=await context(t,callInventorySeed,r=>{
   if(order!=='tasks')r.data[key].programs.reverse();
   if(order!=='programs')r.data[key].tasks.reverse();
   return r;
  });
  const args=tool==='create'?x.args:callInventoryArgs(x,tool);
  const r=await x.call('task_'+(tool==='create'?'create':'call_'+tool),args);
  assert.equal(r.status,'succeeded',JSON.stringify(r));
  const secondary=r.data.after.tasks.find(row=>row.path.at(-1)==='Secondary');
  assert.deepEqual(secondary.rawCalls,[['Other','保留'],['Last','None']]);
  const expected=structuredClone(r.data.before.tasks.find(row=>row.taskId===x.appendArgs.taskId).rawCalls);
  if(tool==='append')expected.push(['PRG_S8Probe','']);
  if(tool==='replace')expected[0]=['PRG_S8Probe','中文'];
  assert.deepEqual(r.data.after.tasks.find(row=>row.taskId===x.appendArgs.taskId).rawCalls,expected);
 });
}
const programCatalogFaults={
 'missing directory':i=>delete i.programs,
 'null directory':i=>i.programs=null,
 'add':i=>i.programs.push({...i.programs[0],objectId:randomUUID()}),
 'remove':i=>i.programs.pop(),
 'identity':i=>i.programs[0].objectId=randomUUID(),
 'duplicate':i=>i.programs.push(structuredClone(i.programs[0])),
 'case duplicate':i=>i.programs.push({...i.programs[0],objectId:i.programs[0].objectId.toUpperCase()}),
 'missing id':i=>delete i.programs[0].objectId,
 'invalid id':i=>i.programs[0].objectId='invalid',
 'zero id':i=>i.programs[0].objectId='00000000-0000-0000-0000-000000000000',
 'null id':i=>i.programs[0].objectId=null,
 'path':i=>i.programs[0].path.push('Wrong'),
 'missing path':i=>delete i.programs[0].path,
 'path type':i=>i.programs[0].path='Wrong',
 'unknown field':i=>i.programs[0].future=[null,'','None']
};
for(const tool of ['create','append','replace'])
for(const stage of tool==='create'?['reopened']:['immediate','reopened'])
for(const [label,change] of Object.entries(programCatalogFaults)){
 test('program directory '+tool+' '+stage+' refuses '+label,async t=>{
  const key=stage==='immediate'?(tool==='append'?'afterAppend':'afterReplace'):'after';
  const x=await context(t,callInventorySeed,r=>{
   // JSON IPC yields separate captured paths; do not mutate the baseline through fixture aliases.
   const reply=JSON.parse(JSON.stringify(r));change(reply.data[key]);return reply;
  });
  const name='task_'+(tool==='create'?'create':'call_'+tool),args=tool==='create'?x.args:callInventoryArgs(x,tool);
  const r=await x.call(name,args);assert.equal(r.status,'unknown',JSON.stringify(r));
  assert.deepEqual(await x.call(name,args),r);
  const bytes=await readFile(x.file);
  await assert.rejects(x.call(name,{...args,requestId:randomUUID()}),{code:'PENDING_UNKNOWN'});
  assert.equal(x.writes.length,1);assert.deepEqual(await readFile(x.file),bytes);
 });
}
