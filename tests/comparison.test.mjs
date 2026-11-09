import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,connect,app,app2,obj,obj2} from './helpers.mjs';
import {schemas,outputSchemas} from '../dist/contracts.js';
import {comparisonItems,textChange,compareReply} from '../dist/comparison.js';
const taskId='30000000-0000-4000-8000-000000000001';
const task=(over={})=>({taskId,applicationId:app,path:['设备','应用一','任务配置','周期任务'],rawFields:{kind_of_task:'Cyclic',priority:'10',interval:'20',interval_unit:'ms'},watchdog:{enabled:'False'},rawCalls:[['Main','']],unavailableFields:[],callsComplete:true,...over});
async function ctx(t,extra={}){const e=await setup({tasks:[task()],...extra}),c=await connect(e.dataDir);t.after(()=>c.client.close());return {e,c};}
async function open(c,source,applicationId=app){const r=await c.done(await c.call('project_open_copy',{sourcePath:source,applicationId,requestId:randomUUID()}));assert.equal(r.status,'succeeded',JSON.stringify(r));return r.data.session;}
async function capture(c,s,more={}){return c.done(await c.call('project_compare',{projectId:s.projectId,applicationId:s.applicationId,mode:'capture',...more}));}
async function compare(c,s,b,t,more={}){return c.done(await c.call('project_compare',{projectId:s.projectId,applicationId:s.applicationId,mode:'compare',baselineOperationId:b.operationId,targetOperationId:t.operationId,...more}));}
async function pair(t,edit,extra={}){const {e,c}=await ctx(t,extra),a=await open(c,e.source),b=await capture(c,a);assert.equal(b.status,'succeeded',JSON.stringify(b));const source=path.join(e.dir,'B.json'),p=JSON.parse(await readFile(e.source));edit(p);await writeFile(source,JSON.stringify(p));const s=await open(c,source),v=await capture(c,s);assert.equal(v.status,'succeeded',JSON.stringify(v));return {e,c,a,s,b,v};}

test('project_compare: eighteen tools, readonly schema; no arbitrary text/path snapshot inputs',async t=>{
 const {e,c}=await ctx(t);await open(c,e.source);const tools=(await c.client.listTools()).tools;assert.equal(tools.length,21);const tool=tools.find(x=>x.name==='project_compare');assert(tool.annotations.readOnlyHint);assert(tool.inputSchema.properties.mode);assert(tool.outputSchema);
 for(const a of [{mode:'compare'},{mode:'capture',text:'pretend source'},{mode:'capture',sourcePath:'x'},{mode:'capture',targetKind:'pool'}])assert.equal(schemas.project_compare.safeParse({projectId:app,applicationId:app,...a}).success,false);
});
test('real text differences preserve comments/space, positions and implementation; GUID equality is not matching',async t=>{
 const p=await pair(t,x=>{x.objects[0].implementation+='\n// 保留空格 ';x.objects[0].declaration+='\n ';x.objects[0].objectId=randomUUID();});
 const r=await compare(p.c,p.s,p.b,p.v);assert.equal(r.status,'succeeded',JSON.stringify(r));assert(outputSchemas.project_compare.safeParse(r).success);
 assert.equal(r.data.counts.object.modified,1);assert.equal(r.data.counts.task.unchanged,1);const m=r.data.items.find(x=>x.kind==='object');assert.equal(m.changes.length,2);assert(m.changes[1].after.text.endsWith(' '));assert.notEqual(m.beforeIdentity[0].objectId,m.afterIdentity[0].objectId);
 assert.deepEqual(textChange('a\r\nb\r','a\nb\n'),null);assert(textChange('a // x','a // y'));assert(r.data.excluded.includes('Device parameters'));
});
test('complete enumeration supports addition/deletion with source content; no rename guessing',async t=>{
 const p=await pair(t,x=>{x.objects[0].path[2]='Other';x.objects[0].declaration='PROGRAM Other\nVAR\nEND_VAR';});const r=await compare(p.c,p.s,p.b,p.v);
 assert.equal(r.data.counts.object.added,1);assert.equal(r.data.counts.object.deleted,1);assert.equal(r.data.counts.object.modified,0);assert(r.data.items.filter(x=>x.kind==='object').every(x=>x.changes.length));
});
test('cross Application same-name and cross-project identical GUID remain explicitly bound',async t=>{
 const {e,c}=await ctx(t),a=await open(c,e.source),b=await capture(c,a);const s=await open(c,e.source,app2),v=await capture(c,s),r=await compare(c,s,b,v);
 assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.baseline.applicationId,app);assert.equal(r.data.target.applicationId,app2);assert.deepEqual(r.data.items.find(x=>x.kind==='object').relativePath,['Main']);assert.equal(r.data.counts.object.modified,1);
 const bad=await compare(c,s,v,b);assert.equal(bad.error.code,'COMPARE_TARGET_MISMATCH');
});
test('ambiguous relative path/type is incomparable, never merged by name or GUID',async t=>{
 const p=await pair(t,x=>x.objects.push({...x.objects[0],objectId:randomUUID()}));const r=await compare(p.c,p.s,p.b,p.v);assert.equal(r.data.counts.object.incomparable,1);assert.equal(r.data.counts.object.unchanged,0);
});
test('read or enumeration failures forbid inferred addition/deletion, known intersection still compared',async t=>{
 for(const mode of ['read','tree']){const p=await pair(t,x=>{if(mode==='read')x.objects[0].queryReadError='真实接口错误替身';else{x.objects.splice(0,1);x.treeReadError='branch read failed';}});const r=await compare(p.c,p.s,p.b,p.v);assert.equal(r.data.coverageComplete,false);assert.equal(r.data.counts.object.deleted,0);assert.equal(r.data.counts.object.incomparable,1);assert(r.data.gaps.count>0);}
});
test('GVL and structure declaration only; nested/unsupported declaration is skipped without edit widening',async t=>{
 const p=await pair(t,x=>x.objects.find(o=>o.objectType==='gvl').declaration='VAR_GLOBAL\n  Wait : TIME := T#9s;\nEND_VAR',{
  objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Config'],objectType:'gvl',declaration:'VAR_GLOBAL\n  Wait : TIME := T#4s;\nEND_VAR',implementation:''},
   {objectId:obj2,applicationId:app,path:['设备','应用一','Settings'],objectType:'structure',declaration:'TYPE Settings : STRUCT\n Wait : TIME;\nEND_STRUCT END_TYPE',implementation:''},
   {objectId:randomUUID(),applicationId:app,path:['设备','应用一','Folder','Nested'],objectType:'gvl',declaration:'VAR_GLOBAL END_VAR',implementation:''}]});
 const r=await compare(p.c,p.s,p.b,p.v);assert.equal(r.data.counts.object.modified,1);assert.equal(r.data.counts.object.unchanged,1);assert.equal(r.data.baseline.coverage.skippedObjects,1);assert.equal(r.data.items.find(x=>x.category==='modified').changes[0].region,'declaration');
});
test('task order compared as config raw values, not resolved target GUID or scan measurement',async t=>{
 const p=await pair(t,x=>{x.tasks[0].rawCalls=[['Second',''],['Main','']];x.tasks[0].rawFields.interval='50';});const r=await compare(p.c,p.s,p.b,p.v);const changed=r.data.items.find(x=>x.kind==='task');assert.equal(changed.category,'modified');assert.deepEqual(changed.changes.map(x=>x.field),['calls','rawFields.interval']);assert.match(r.data.taskMeaning,/not measured scan/);
 const q=await pair(t,x=>{x.tasks[0].rawCalls.reverse();},{tasks:[task({rawCalls:[['Main',''],['Second','']]})]});const order=await compare(q.c,q.s,q.b,q.v);assert.equal(order.data.counts.task.modified,1);
});
test('unreadable task field/calls stays incomparable with preserved gaps, no filled defaults',async t=>{
 const p=await pair(t,x=>{delete x.tasks[0].rawFields.priority;x.tasks[0].unavailableFields=[{field:'priority',reason:'unavailable'}];x.tasks[0].callsComplete=false;});const r=await compare(p.c,p.s,p.b,p.v);assert.equal(r.data.counts.task.incomparable,1);assert.equal(r.data.coverageComplete,false);assert(r.data.items.find(x=>x.kind==='task').reasons.length);
});
test('paging/detail reuse immutable capture; expected version required; long values explicit previews',async t=>{
 const p=await pair(t,x=>{x.objects[0].implementation='// '+('中文😀'.repeat(1500));});const r=await compare(p.c,p.s,p.b,p.v,{limit:1});assert(r.data.page.hasMore);assert.equal(r.data.items[0].changes[0].after.text.complete,false);assert(Buffer.byteLength(JSON.stringify(r.data))<16000);
 const opsBefore=(await readdir(path.join(p.e.dataDir,'ipc'))).length;
 const page=await compare(p.c,p.s,p.b,p.v,{offset:r.data.page.nextOffset,expectedVersion:r.data.version});assert.equal(page.status,'succeeded');assert.equal(page.data.version,r.data.version);
 const item=r.data.items[0],actual=JSON.parse(await readFile(path.join(p.e.dataDir,'ipc',p.v.operationId,'observed-after-exit.json'))).data.sourceInventory.corpus[0].implementation;let text='',offset=0;
 do{const detail=await compare(p.c,p.s,p.b,p.v,{expectedVersion:r.data.version,detail:{itemIndex:item.index,changeIndex:0,side:'after',offset,limit:1024}});assert.equal(detail.status,'succeeded');text+=detail.data.detail.text;offset=detail.data.detail.nextOffset;}while(offset!==null);
 assert.equal(text,actual);assert.equal((await readdir(path.join(p.e.dataDir,'ipc'))).length,opsBefore);
 assert.equal((await compare(p.c,p.s,p.b,p.v,{offset:1})).error.code,'COMPARE_VERSION_REQUIRED');assert.equal((await compare(p.c,p.s,p.b,p.v,{expectedVersion:'0'.repeat(64)})).error.code,'COMPARE_VERSION_CHANGED');
});
test('registered-source capture does not replace working version/build state; repeat request returns original operation',async t=>{
 const {e,c}=await ctx(t),s=await open(c,e.source),original=await readFile(s.workingPath),before=(await c.call('session_status')).data.session;
 const a=await capture(c,s,{origin:'registered-source',requestId:'capture-source'}),b=await capture(c,s,{origin:'registered-source',requestId:'capture-source'});assert.equal(a.status,'succeeded',JSON.stringify(a));assert.equal(a.operationId,b.operationId);assert.equal(a.data.snapshot.projectPath,s.sourcePath);assert.deepEqual((await c.call('session_status')).data.session,before);assert.deepEqual(await readFile(s.workingPath),original);
 const target=await capture(c,s),r=await compare(c,s,a,target);assert.equal(r.data.counts.object.unchanged,1);
});
test('registered original and edited workcopy are distinct versions of the same project; build applicability retained',async t=>{
 const {e,c}=await ctx(t),s=await open(c,e.source),read=await c.done(await c.call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj}));
 const change=await c.done(await c.call('code_apply_change',{requestId:'edit-fixture',projectId:s.projectId,applicationId:app,objectId:obj,expectedHash:read.data.contentHash,declaration:read.data.declaration,implementation:read.data.implementation+'\n// new version'}));assert.equal(change.status,'succeeded');
 const build=await c.done(await c.call('project_build',{requestId:'build-fixture',projectId:s.projectId,applicationId:app}));assert.equal(build.status,'succeeded');const before=(await c.call('session_status')).data.session;
 const baseline=await capture(c,s,{origin:'registered-source'}),target=await capture(c,s),r=await compare(c,s,baseline,target);assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.counts.object.modified,1);assert.notEqual(r.data.baseline.diskHash,r.data.target.diskHash);assert.deepEqual((await c.call('session_status')).data.session,before);
});
test('queued capture cannot be redirected by activation; missing IPC cannot silently recapture',async t=>{
 const {e,c}=await ctx(t,{delayMs:100}),s=await open(c,e.source);const pending=await c.call('project_compare',{projectId:s.projectId,applicationId:app,mode:'capture'});assert.equal(pending.status,'running');
 const rejected=await c.done(await c.call('project_activate',{projectId:s.projectId,requestId:'concurrent-switch'}));assert.equal(rejected.error.code,'PENDING_OPERATION');const baseline=await c.done(pending);assert.equal(baseline.status,'succeeded');
 await rm(path.join(e.dataDir,'ipc',baseline.operationId,'observed-after-exit.json'));const failed=await compare(c,s,baseline,baseline);assert.equal(failed.error.code,'COMPARE_EVIDENCE_INVALID');assert.equal(failed.status,'unknown');
});
test('version drift rejects pages/read before dispatch; retained baseline is explicitly historical',async t=>{
 const p=await pair(t,x=>{x.objects[0].implementation+=' ';}),r=await compare(p.c,p.s,p.b,p.v,{limit:1});await writeFile(p.s.workingPath,(await readFile(p.s.workingPath,'utf8'))+' ');
 const failed=await compare(p.c,p.s,p.b,p.v,{offset:1,expectedVersion:r.data.version});assert.equal(failed.status,'conflict');assert.equal(failed.error.code,'COMPARE_DISK_CHANGED');assert.equal((await capture(p.c,p.s)).error.code,'COMPARE_DISK_CHANGED');
});
test('missing baseline clear failure; corrupt/missing raw evidence freezes, no recapture',async t=>{
 const p=await pair(t,()=>{});assert.equal((await compare(p.c,p.s,{operationId:randomUUID()},p.v)).error.code,'COMPARE_BASELINE_MISSING');
 const file=path.join(p.e.dataDir,'ipc',p.b.operationId,'observed-after-exit.json'),raw=JSON.parse(await readFile(file));raw.data.sourceInventory.corpus[0].declaration+=' tampered';await writeFile(file,JSON.stringify(raw));
 const failed=await compare(p.c,p.s,p.b,p.v);assert.equal(failed.status,'unknown');assert.equal((await p.c.call('session_status')).data.globalFrozen,true);const record=JSON.parse(await readFile(path.join(p.e.dataDir,'operations',failed.operationId+'.json'))).value;assert.equal(record.bridge,undefined);
});
test('read-time file mutation freezes; restart compares same snapshots without IDE',async t=>{
 const {e,c}=await ctx(t,{readMutatesFile:true}),s=await open(c,e.source),failed=await capture(c,s);assert.equal(failed.status,'unknown');assert.equal(failed.error.code,'READ_ONLY_FILE_CHANGED');assert.equal((await c.call('session_status')).data.globalFrozen,true);
 const p=await pair(t,()=>{});await p.c.client.close();const restarted=await connect(p.e.dataDir);t.after(()=>restarted.client.close());const r=await compare(restarted,p.s,p.b,p.v);assert.equal(r.status,'succeeded');assert.equal(r.data.counts.object.unchanged,1);
});
