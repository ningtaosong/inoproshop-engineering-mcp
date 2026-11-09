import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect} from './helpers.mjs';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';
import {Store,digest} from '../dist/storage.js';
import {schemas} from '../dist/contracts.js';

async function ctx(t,adapter=new FixtureAdapter()){
 const e=await setup(),s=new EngineeringService({dataDir:e.dataDir,testMode:true,responseWaitMs:1000,executable:'fixture',profile:'fixture',noUI:false,timeoutMs:1000},adapter);
 t.after(()=>s.store.release());const target=path.join(await realpath(e.dir),'新目录','Minimal.project');
 return {e,s,target,args:{requestId:randomUUID(),projectPath:target}};
}
const call=(s,n,a)=>s.call(n,schemas[n].parse(a));
test('project_create stdio: new specified path, native preset substitute, v2 identity reused by direct open',async t=>{
 const e=await setup(),c=await connect(e.dataDir);t.after(()=>c.client.close());
 const args={requestId:randomUUID(),projectPath:path.join(await realpath(e.dir),'new','Minimal.project')};
 const made=await c.done(await c.call('project_create',args));assert.equal(made.status,'succeeded',JSON.stringify(made));
 assert.equal(made.data.projectPath,args.projectPath);assert.equal(made.data.session.workingPath,args.projectPath);assert.equal(made.data.editMode,'direct');
 const again=await c.done(await c.call('project_create',args));assert.deepEqual(again,made);
 const opened=await c.done(await c.call('project_open',{requestId:randomUUID(),projectPath:args.projectPath}));
 assert.equal(opened.status,'succeeded');assert.equal(opened.data.session.projectId,made.data.session.projectId);
 const r=await new Store(e.dataDir).registry();assert.equal(r.version,2);assert.equal(r.projects.length,1);
 assert.equal(await access(path.join(e.dataDir,'projects')).then(()=>true,()=>false),false);
 const op=await new Store(e.dataDir).operation(made.operationId);assert.equal(await access(path.join(op.bridge.directory,'checkpoint.project')).then(()=>true,()=>false),false);
 const target={projectId:r.projects[0].projectId,applicationId:r.projects[0].applicationId};
 const objects=await c.done(await c.call('object_list',target));assert.equal(objects.data.total,1);
 const obj=await c.done(await c.call('object_read',{...target,objectId:objects.data.objects[0].objectId}));
 const change=await c.done(await c.call('code_apply_change',{...target,requestId:randomUUID(),objectId:obj.data.objectId,expectedHash:obj.data.contentHash,declaration:obj.data.declaration,implementation:'// continued direct edit'}));assert.equal(change.status,'succeeded');assert.equal(change.data.persistedToProject,true);
 const build=await c.done(await c.call('project_build',{...target,requestId:randomUUID()}));assert.equal(build.status,'succeeded');
 const save=await c.done(await c.call('project_save',{...target,requestId:randomUUID(),expectedSnapshot:build.data.snapshot}));assert.equal(save.status,'succeeded');
});
test('existing file never overwritten or natively dispatched',async t=>{
 let dispatch=0;const c=await ctx(t,{execute:async()=>{dispatch++;throw Error('unexpected');}});await mkdir(path.dirname(c.target));await writeFile(c.target,'preserve');
 const r=await call(c.s,'project_create',c.args);assert.equal(r.status,'conflict');assert.equal(r.error.code,'PROJECT_ALREADY_EXISTS');assert.equal(dispatch,0);assert.equal(await readFile(c.target,'utf8'),'preserve');
});
test('busy marker rejects before factory and preserves marker',async t=>{
 let dispatch=0;const c=await ctx(t,{execute:async()=>{dispatch++;}});await mkdir(path.dirname(c.target));await writeFile(c.target+'.lock','external');
 const r=await call(c.s,'project_create',c.args);assert.equal(r.error.code,'PROJECT_BUSY');assert.equal(dispatch,0);assert.equal(await readFile(c.target+'.lock','utf8'),'external');
});
for(const input of ['relative.project','C:\\new\\bad.txt','C:\\new\\..\\X.project','C:\\new\\NUL.project','C:\\new\\X.project:stream','C:\\new\\X.project.'])test('invalid new path rejected without native creation: '+input,async t=>{
 let calls=0;const c=await ctx(t,{execute:async()=>{calls++;}});const r=await call(c.s,'project_create',{...c.args,projectPath:input});assert.equal(r.status,'failed');assert.equal(calls,0);
});
test('registered missing target rejects rather than inventing replacement identity',async t=>{
 const c=await ctx(t);const r=await c.s.store.ensureRegistry();await mkdir(c.s.store.file('operations'));r.version=2;r.projects=[{projectId:randomUUID(),sessionId:randomUUID(),storageMode:'direct',editMode:'direct',directPath:c.target,sourcePath:c.target,workingPath:c.target,sourceHash:'a'.repeat(64)}];await c.s.store.put('registry.json',r);
 const made=await call(c.s,'project_create',c.args);assert.equal(made.error.code,'CREATE_PATH_REGISTERED');
});
test('invalid native task evidence freezes without registration; partial target preserved and request never replayed',async t=>{
 let calls=0;const adapter=new FixtureAdapter(),c=await ctx(t,{execute:async(...args)=>{calls++;const r=await adapter.execute(...args);r.data.creationEvidence.task.interval='t#200ms';return r;}});
 const r=await call(c.s,'project_create',c.args);assert.equal(r.status,'unknown');assert.equal(r.error.code,'CREATE_EVIDENCE_INVALID');const hash=digest(await readFile(c.target));
 assert.equal((await c.s.store.registry()).projects.length,0);await call(c.s,'project_create',c.args);assert.equal(calls,1);assert.equal(digest(await readFile(c.target)),hash);
 await assert.rejects(call(c.s,'project_create',{...c.args,requestId:randomUUID(),projectPath:path.join(c.e.dir,'another.project')}),/未决/);
});
test('lost result reconciles original native evidence and binds original reserved identity, no new factory',async t=>{
 let calls=0;const adapter=new FixtureAdapter();const c=await ctx(t,{execute:async(...args)=>{calls++;await adapter.execute(...args);throw Error('connection lost after publication');},reconcile:dir=>adapter.reconcile(dir)});
 const first=await call(c.s,'project_create',c.args);assert.equal(first.status,'unknown');const op=await c.s.store.operation(first.operationId);op.ownerPid=2147483647;await c.s.store.saveOp(op);
 const recovered=await c.s.operation({operationId:op.operationId,reconcile:true});assert.equal(recovered.status,'succeeded');assert.equal(recovered.data.session.projectId,op.creation.projectId);assert.equal(calls,1);
});
test('incomplete result absent: unknown blocks subsequent creation and preserves request evidence',async t=>{
 const c=await ctx(t,{execute:async()=>{throw Error('uncertain native state');},reconcile:async()=>undefined});const r=await call(c.s,'project_create',c.args);assert.equal(r.status,'unknown');
 assert.equal((await c.s.store.registry()).projects.length,0);assert((await c.s.store.operation(r.operationId)).creation);
});
test('native creation route has no overwrite/save_as, pre-create checkpoint or user template',async()=>{
 const source=await readFile('bridge/project_create.py','utf8');assert.match(source,/File\.Copy\(scratch,target,False\)/);assert.match(source,/len\(m\.GetParameters\(\)\)==5/);assert.match(source,/set_redirection\(LIBRARY\)/);
 assert.doesNotMatch(source,/save_as|checkpoint\.project|project_open_copy|\.remove\(|os\.unlink|os\.remove|shutil/);
});
