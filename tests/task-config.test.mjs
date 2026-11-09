import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,access,realpath} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';import path from 'node:path';
import {setup} from './helpers.mjs';import {EngineeringService} from '../dist/service.js';import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {schemas} from '../dist/contracts.js';import {digest} from '../dist/storage.js';
import {taskConfigurationVersion} from '../dist/task-config.js';
async function ctx(t,mutate=()=>{}) {
 const e=await setup(),adapter=new FixtureAdapter();let dispatches=0;
 const s=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},{execute:(...a)=>{dispatches++;return adapter.execute(...a)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>s.store.release());const call=(n,a)=>s.call(n,schemas[n].parse(a));
 const made=await call('project_create',{requestId:randomUUID(),projectPath:path.join(await realpath(e.dir),'Task.project')});assert.equal(made.status,'succeeded',JSON.stringify(made));
 const session=made.data.session,p=JSON.parse(await readFile(session.workingPath,'utf8'));mutate(p);await writeFile(session.workingPath,JSON.stringify(p));
 session.diskHash=digest(await readFile(session.workingPath));await s.store.saveSession(session);
 const target={projectId:session.projectId,applicationId:session.applicationId};const read=()=>call('task_inspect',target);
 const before=await read();assert.equal(before.status,'succeeded');
 const args={...target,taskId:p.tasks[0].taskId,requestId:randomUUID(),expectedTaskVersion:before.data.configurationVersion,expectedDiskHash:before.data.diskHash};
 return {e,s,call,read,target,args,before,p,session,dispatches:()=>dispatches};
}
for(const patch of [{intervalMs:10},{priority:0},{intervalMs:10,priority:12},{intervalMs:20,priority:1}])test('task patch preserves unprovided fields and readbacks: '+JSON.stringify(patch),async t=>{
 const x=await ctx(t),text=x.p.objects,old=x.before.data.tasks[0],r=await x.call('task_config_update',{...x.args,...patch});assert.equal(r.status,'succeeded',JSON.stringify(r));
 const row=r.data.after.tasks[0];assert.equal(row.rawFields.interval,patch.intervalMs===undefined?old.rawFields.interval:'t#'+patch.intervalMs+'ms');assert.equal(row.rawFields.priority,patch.priority===undefined?old.rawFields.priority:String(patch.priority));
 assert.deepEqual(row.rawCalls,old.calls.map(c=>c.raw));assert.deepEqual(row.watchdog,old.watchdog);assert.equal(row.rawFields.core_binding,old.rawFields.core_binding);
 assert.deepEqual(JSON.parse(await readFile(x.session.workingPath,'utf8')).objects,text);
 assert.equal(r.data.taskConfigurationVersion,taskConfigurationVersion(r.data.after));
 if(patch.intervalMs===20){assert.equal(r.data.changed,false);assert.deepEqual(r.data.actions,[]);assert.equal(r.data.reopened,false);assert.equal(r.data.diskHash,x.args.expectedDiskHash);}
 else {assert.equal(r.data.changed,true);assert.equal(r.data.reopened,true);await access(r.data.checkpoint);}
 const count=x.dispatches();assert.deepEqual(await x.call('task_config_update',{...x.args,...patch}),r);assert.equal(x.dispatches(),count);
});
test('invalid inputs reject at schema boundary and never dispatch; priority zero is present',async t=>{
 const x=await ctx(t),n=x.dispatches();for(const p of [{},{intervalMs:0},{intervalMs:60001},{intervalMs:1.5},{priority:-1},{priority:32},{priority:null},{priority:'12'},{priority:true},{priority:12,calls:[]},{priority:12,watchdog:{}}]){
  assert.equal(schemas.task_config_update.safeParse({...x.args,...p}).success,false,JSON.stringify(p));
 }assert.equal(x.dispatches(),n);assert(schemas.task_config_update.safeParse({...x.args,priority:0}).success);
});
test('native decimal interval plus explicit ms unit: no-op keeps raw text, changed period uses fixed TIME setter',async t=>{
 const x=await ctx(t,p=>p.tasks[0].rawFields.interval='20');const noOp=await x.call('task_config_update',{...x.args,intervalMs:20});assert.equal(noOp.status,'succeeded');assert.equal(noOp.data.changed,false);assert.equal(noOp.data.after.tasks[0].rawFields.interval,'20');
 const changed=await x.call('task_config_update',{...x.args,requestId:randomUUID(),intervalMs:10});assert.equal(changed.status,'succeeded');assert.equal(changed.data.after.tasks[0].rawFields.interval,'t#10ms');assert.equal(changed.data.after.tasks[0].rawFields.interval_unit,'ms');
});
for(const [label,mutate,code] of [
 ['non-cyclic',p=>p.tasks[0].rawFields.kind_of_task='Event','TASK_NOT_CYCLIC'],
 ['missing getter',p=>p.tasks[0].unavailableFields=[{field:'priority',reason:'unreadable'}],'TASK_CONFIGURATION_INCOMPLETE'],
 ['calls incomplete',p=>p.tasks[0].callsComplete=false,'TASK_CONFIGURATION_INCOMPLETE'],
 ['unit unknown',p=>p.tasks[0].rawFields.interval_unit='us','TASK_UNITS_UNCONFIRMED'],
 ['read-only',p=>p.taskReadOnly=true,'TASK_PROJECT_READ_ONLY'],
 ['duplicate identity',p=>p.tasks.push(structuredClone(p.tasks[0])),'TASK_NOT_UNIQUE']])test('confirmed rejection '+label,async t=>{
 const x=await ctx(t,mutate),bytes=await readFile(x.session.workingPath),r=await x.call('task_config_update',{...x.args,priority:12});assert.equal(r.error.code,code);assert.notEqual(r.status,'unknown');assert.deepEqual(await readFile(x.session.workingPath),bytes);
 const op=await x.s.store.operation(r.operationId);assert.equal(await access(path.join(op.bridge.directory,'checkpoint.project')).then(()=>true,()=>false),false);
});
test('project, Application and task identity and stale configuration/disk reject without writes',async t=>{
 const x=await ctx(t),n=x.dispatches();for(const p of [{projectId:randomUUID()},{applicationId:randomUUID()}]){
  const r=await x.call('task_config_update',{...x.args,requestId:randomUUID(),priority:12,...p}).catch(e=>({status:e.status}));assert.equal(r.status,'conflict');
 }assert.equal(x.dispatches(),n);
 for(const p of [{expectedTaskVersion:'a'.repeat(64)},{taskId:randomUUID()},{expectedDiskHash:'b'.repeat(64)}]){const r=await x.call('task_config_update',{...x.args,requestId:randomUUID(),priority:12,...p});assert.equal(r.status,'conflict');}
 await writeFile(x.session.workingPath,(await readFile(x.session.workingPath,'utf8'))+' ');const count=x.dispatches(),r=await x.call('task_config_update',{...x.args,requestId:randomUUID(),priority:12});assert.equal(r.error.code,'TASK_DISK_CHANGED');assert.equal(x.dispatches(),count);
});
for(const stage of ['save','close','reopen','field','wrong-readback'])test('uncertain '+stage+' freezes original request, no retry/rollback',async t=>{
 const x=await ctx(t,p=>{if(stage==='field')p.failTaskField='priority';else if(stage==='wrong-readback')p.wrongTaskReadback=true;else p.failTaskLifecycle=stage;});
 const a={...x.args,intervalMs:10,priority:12},r=await x.call('task_config_update',a);assert.equal(r.status,'unknown',JSON.stringify(r));const n=x.dispatches(),bytes=await readFile(x.session.workingPath);
 assert.deepEqual(await x.call('task_config_update',a),r);assert.equal(x.dispatches(),n);await assert.rejects(x.call('task_config_update',{...a,requestId:randomUUID()}),/未决/);assert.deepEqual(await readFile(x.session.workingPath),bytes);
});
test('task-only edit invalidates identical-ST old build; new build and saved version bind task configuration',async t=>{
 const x=await ctx(t),build=()=>x.call('project_build',{...x.target,requestId:randomUUID()});const b=await build();assert.equal(b.status,'succeeded');assert.equal((await x.s.store.session()).buildApplicable,true);
 const change=await x.call('task_config_update',{...x.args,intervalMs:10,priority:12});assert.equal(change.status,'succeeded');assert.equal(change.data.snapshot,b.data.snapshot);assert.equal(change.data.buildApplicable,false);assert.equal((await x.s.store.session()).buildApplicable,false);
 const next=await build();assert.equal(next.data.taskConfigurationVersion,change.data.taskConfigurationVersion);assert.equal((await x.s.store.session()).buildApplicable,true);
 const save=await x.call('project_save',{...x.target,requestId:randomUUID(),expectedSnapshot:next.data.snapshot});assert.equal(save.status,'succeeded');assert.equal(save.data.taskConfigurationVersion,next.data.taskConfigurationVersion);assert.equal(save.data.buildApplicable,true);
});
test('production Python task setters and lifecycle fault coverage (API doubles, not IDE)',()=>{
 const r=spawnSync('python',['tests/bridge_task_config_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
