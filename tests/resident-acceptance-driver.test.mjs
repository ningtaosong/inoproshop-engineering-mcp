import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {ResidentAcceptanceRounds} from '../scripts/lib/resident-acceptance-rounds.mjs';
import {submitControl,runDriver} from '../scripts/resident-acceptance-driver.mjs';
import {residentHash} from '../dist/resident.js';
const archive=JSON.parse(await fs.readFile(new URL('fixtures/resident-first-list-20261126.json',import.meta.url)));
const [old,current]=archive.snapshots,APP=current.dependencies.applications[0];
const OBJ=Object.keys(current.dependencies.nodes).find(id=>current.dependencies.nodes[id].path.at(-1)==='PLC_PRG'&&current.dependencies.nodes[id].parentId===APP&&typeof current.dependencies.nodes[id].implementation==='string');
const SOURCE=current.dependencies.nodes[OBJ].implementation;
const LIB=Object.keys(current.dependencies.nodes).find(id=>current.dependencies.nodes[id].directLibraries);
function fake(){
 let sequence=0,state=structuredClone(current),source=SOURCE;
 const n={calls:[],writes:0,finish:0,fault:null,late:null,sequence:0};
 const version=()=>residentHash({dependencies:state.dependencies,diskHash:state.diskHash});
 const make=(args,d={},status='succeeded')=>({status,operationId:randomUUID(),requestId:args.requestId??randomUUID(),data:{
  saved:false,closed:false,reopened:false,saveCalls:0,compileCalls:0,closeCalls:0,exitCalls:0,diskHash:state.diskHash,residentVersion:version(),
  residentEvidence:{launchId:'10000000-1111-2222-3333-000000000001',sequence:++sequence,requestHash:'a'.repeat(64),requestCompleted:true,ideExitRequested:false,processIdentity:{pid:1234,startId:'999999'}},...d}});
 const object=()=>({objectId:OBJ,applicationId:APP,declaration:state.dependencies.nodes[OBJ].declaration,implementation:source,contentHash:residentHash(source)});
 const rejected=(args)=>make(args,{recoverableRejection:true,firstError:{dispatched:false,message:'old version'},secondaryErrors:[]},'conflict');
 n.call=async(name,args)=>{
  n.calls.push({name,args:structuredClone(args)});
  if(name==='operation_status')return n.late;
  let r;
  if(name==='project_open')r=make(args,{projectPath:args.projectPath,applicationId:APP,session:{projectId:'20000000-1111-2222-3333-000000000001'},residentVersion:old.residentVersion});
  else if(name==='object_list'){
   if(args.expectedResidentVersion&&args.expectedResidentVersion!==version())return rejected(args);
   if(n.fault==='conflict'){n.fault=null;return rejected(args);}
   const all=[{objectId:OBJ},{objectId:'30000000-1111-2222-3333-000000000001'}],selected=all.slice(args.offset,args.offset+args.limit),next=args.offset+selected.length<2?args.offset+selected.length:null;
   r=make(args,{objects:selected,total:2,complete:true,nextOffset:next});
   if(n.fault==='page-change'&&args.offset===0)state.dependencies.nodes[LIB].directLibraries.push({...state.dependencies.nodes[LIB].directLibraries[0],id:'changed'});
   if(n.fault==='missing')delete r.data.residentEvidence;
   if(n.fault==='duplicate')r.data.objects=[{objectId:OBJ},{objectId:OBJ}];
  }else if(name==='object_read')r=make(args,object());
  else if(name==='code_apply_change'){
   if(n.fault==='write-conflict')return rejected(args);
   assert.equal(args.expectedResidentVersion,version());assert.equal(args.expectedHash,residentHash(source));
   n.writes++;source=args.implementation;state.dependencies.nodes[OBJ].implementation=source;r=make(args,object());
   if(n.fault==='unknown')r=make(args,{firstError:{dispatched:true,message:'original write error'},recoverableRejection:false,secondaryErrors:[]},'unknown');
   if(n.fault==='postread-mismatch')state.diskHash='b'.repeat(64);
   if(n.fault==='throw')throw Error('FIRST after native modification');
  }else throw Error('Forbidden tool '+name);
  if(n.fault==='running'&&name==='object_read'){n.fault=null;n.late=r;return {status:'running',operationId:r.operationId};}
  return r;
 };
 n.controller=new ResidentAcceptanceRounds({call:n.call,pollMs:0,timeoutMs:200,record:async(event,data)=>n.events.push({event,data}),
  finish:async()=>{n.finish++;if(n.finishError)throw n.finishError;return {code:0,signal:null};},observeExit:async()=>n.exit??null});
 n.events=[];n.command=(kind,extra={})=>({id:randomUUID(),ticket:n.controller.ticket,kind,authorization:'explicit offline test entry',...extra});
 n.open=()=>n.controller.submit(n.command('open',{projectPath:current.dependencies.projectPath,applicationId:APP}));
 n.edit=(extra={})=>n.command('edit',{objectId:OBJ,beforeImplementation:SOURCE,afterImplementation:SOURCE.replace('T#5s','T#7s'),...extra});
 return n;
}
test('actual archive 12→17 only selected dependency delta, original hashes preserved',()=>{
 for(const s of archive.snapshots)assert.equal(residentHash({dependencies:s.dependencies,diskHash:s.diskHash}),s.residentVersion);
 assert.equal(old.dependencies.nodes[LIB].directLibraries.length,12);assert.equal(current.dependencies.nodes[LIB].directLibraries.length,17);
 const expected=structuredClone(old.dependencies);expected.nodes[LIB].directLibraries=current.dependencies.nodes[LIB].directLibraries;assert.deepEqual(expected,current.dependencies);
 assert.deepEqual(current.dependencies.nodes[LIB].directLibraries.slice(0,12),old.dependencies.nodes[LIB].directLibraries);
});
test('old driver first-page request reproduces rejection with actual archive versions; new first page reads current',async()=>{
 const n=fake();const previous=await n.call('object_list',{offset:0,limit:200,expectedResidentVersion:old.residentVersion});assert.equal(previous.status,'conflict');assert.equal(n.writes,0);
 await n.open();const r=await n.controller.submit(n.edit({limit:1}));assert.equal(r.status,'succeeded');
 const pages=n.calls.filter(c=>c.name==='object_list').slice(1);assert.equal(Object.hasOwn(pages[0].args,'expectedResidentVersion'),false);assert.equal(pages[1].args.expectedResidentVersion,current.residentVersion);
 assert.equal(n.calls.find(c=>c.name==='code_apply_change').args.expectedResidentVersion,current.residentVersion);assert.equal(n.writes,1);
});
test('stale continuation rejects, never silently restarts first page or writes',async()=>{
 const n=fake();await n.open();n.fault='page-change';const r=await n.controller.submit(n.edit({limit:1}));assert.equal(r.status,'round-rejected');assert.equal(n.writes,0);assert.equal(n.calls.filter(c=>c.name==='object_list').length,2);
});
for(const fault of ['conflict','write-conflict'])test('proven zero-dispatch '+fault+' waits for a new explicit ticket, no retry',async()=>{
 const n=fake();await n.open();n.fault=fault;const cmd=n.edit(),r=await n.controller.submit(cmd);assert.equal(r.status,'round-rejected');assert.equal(n.writes,0);
 const count=n.calls.length;await new Promise(r=>setTimeout(r,15));assert.equal(n.calls.length,count);
 assert.equal(await n.controller.submit(cmd),r);await assert.rejects(n.controller.submit({...cmd,id:randomUUID()}),/Stale/);
 n.fault=null;assert.equal((await n.controller.submit(n.edit())).status,'succeeded');assert.equal(n.writes,1);
});
test('successful round waits, explicit second round reuses same SDK connection and current write version',async t=>{
 const n=fake(),server=new Server({name:'offline-acceptance-fixture',version:'0.40.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[]}));server.setRequestHandler(CallToolRequestSchema,async req=>{const result=await n.call(req.params.name,req.params.arguments);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};});
 const [ct,st]=InMemoryTransport.createLinkedPair();const client=new Client({name:'offline-driver-test',version:'1'});await server.connect(st);await client.connect(ct);t.after(async()=>{await client.close();await server.close();});
 let calls=0;n.controller.call=async(name,args)=>{calls++;return (await client.callTool({name,arguments:args})).structuredContent;};
 await n.open();assert.equal((await n.controller.submit(n.edit())).status,'succeeded');const first=calls;await new Promise(r=>setTimeout(r,15));assert.equal(calls,first);
 const firstSource=SOURCE.replace('T#5s','T#7s');assert.equal((await n.controller.submit(n.edit({beforeImplementation:firstSource,afterImplementation:firstSource.replace('FALSE','TRUE')}))).status,'succeeded');assert.equal(n.writes,2);
 assert.equal(n.calls.filter(c=>c.name==='project_open').length,1);
});
for(const fault of ['unknown','throw','missing','duplicate','postread-mismatch'])test(fault+' freezes business, finish stays reachable',async()=>{
 const n=fake();await n.open();n.fault=fault;const cmd=n.edit(),r=await n.controller.submit(cmd);assert.equal(r.status,'frozen');const first=n.controller.firstError,count=n.calls.length;
 await assert.rejects(n.controller.submit(n.edit()),/not permitted/);assert.equal(n.calls.length,count);assert.equal(n.controller.firstError,first);
 assert.equal((await n.controller.submit(n.command('finish'))).status,'finished');assert.equal(n.finish,1);assert.equal(n.calls.length,count);
});
test('write-after exception retains first error even when evidence publisher fails',async()=>{
 const n=fake();await n.open();n.fault='throw';n.controller.record=async event=>{if(event==='frozen')throw Error('SECOND recording error');};
 assert.equal((await n.controller.submit(n.edit())).status,'frozen');assert.match(n.controller.firstError.message,/FIRST/);assert.match(n.controller.recordError.message,/SECOND/);assert.equal(n.writes,1);
});
test('running polls only original operation without reconcile or replay',async()=>{
 const n=fake();await n.open();n.fault='running';assert.equal((await n.controller.submit(n.edit())).status,'succeeded');
 assert.equal(n.calls.filter(c=>c.name==='operation_status').length,1);assert.equal(n.calls.find(c=>c.name==='operation_status').args.reconcile,undefined);assert.equal(n.writes,1);
});
test('finish deadline is bounded, late exit appends facts and retains first cleanup error',async()=>{
 const n=fake();await n.open();n.finishError=Error('EOF exit unconfirmed; no kill');const r=await n.controller.submit(n.command('finish'));assert.equal(r.status,'finish-pending');
 await assert.rejects(n.controller.submit(n.edit()),/not permitted/);n.exit={code:0,signal:null};const late=await n.controller.submit(n.command('observe-exit'));assert.equal(late.status,'finished-with-prior-error');assert.match(late.firstCleanupError.message,/unconfirmed/);
 assert.equal(n.finish,1);assert.deepEqual(n.calls.map(c=>c.name),['project_open']);
});
test('external submit atomically binds one current ticket, cannot queue the next round',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'resident-control-'));await fs.mkdir(path.join(root,'commands'));const ticket=randomUUID();
 await fs.writeFile(path.join(root,'control.json'),JSON.stringify({ticket,allowed:['edit','finish']}));
 const plan={kind:'edit',authorization:'new explicit instruction',beforeImplementation:'a',afterImplementation:'b'};
 const a=await submitControl(root,plan);assert.equal(a.ticket,ticket);await assert.rejects(submitControl(root,plan),/EEXIST/);
 assert.equal((await fs.readdir(path.join(root,'commands'))).length,1);
});

for(const initializationFailure of [false,true])test('actual SDK stdio driver exposes normal finish after '+(initializationFailure?'precheck failure':'initialization')+', no engineering tools',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'resident-sdk-finish-')),directory=path.join(root,'control'),entry=path.resolve('tests/resident-driver-child-fixture.mjs');
 const config={directory,entry,cwd:process.cwd(),dataDir:path.join(root,'unused-fixture-only'),entrySha256:createHash('sha256').update(await fs.readFile(entry)).digest('hex'),version:initializationFailure?'wrong':'0.40.0',toolCount:1,toolNames:['fixture_only']};
 const originalExitCode=process.exitCode;const running=runDriver(config);
 let control;for(let i=0;i<200;i++){control=await fs.readFile(path.join(directory,'control.json'),'utf8').then(JSON.parse,()=>null);if(control)break;await new Promise(r=>setTimeout(r,20));}
 assert(control);assert.equal(control.state,initializationFailure?'frozen':'waiting');
 await submitControl(directory,{kind:'finish',authorization:'offline test explicit finish'});
 assert.equal((await running).state,'finished');process.exitCode=originalExitCode;
 const events=await Promise.all((await fs.readdir(path.join(directory,'journal'))).map(async n=>JSON.parse(await fs.readFile(path.join(directory,'journal',n),'utf8'))));
 assert.equal(events.filter(x=>x.event==='mcp-request').length,0);
 const observer=await Promise.all((await fs.readdir(path.join(directory,'transport'))).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await fs.readFile(path.join(directory,'transport',n),'utf8'))));
 assert(observer.some(x=>x.value.event==='service-exit'&&x.value.data.code===0&&x.value.data.signal===null));
 assert.equal(await fs.stat(config.dataDir).then(()=>true,()=>false),false);
});

test('publication failure before write prevents dispatch; result publication failure freezes next round',async()=>{
 for(const stage of ['write-plan','command-result']){
  const n=fake();await n.open();n.controller.record=async event=>{if(event===stage)throw Error('publication fault '+stage);};
  assert.equal((await n.controller.submit(n.edit())).status,'frozen');assert.equal(n.writes,stage==='write-plan'?0:1);
  await assert.rejects(n.controller.submit(n.edit()),/not permitted/);
 }
});

test('unproven recovery claim or cleanup error cannot restart a round',async()=>{
 for(const mutation of [d=>delete d.firstError.dispatched,d=>d.firstError.dispatched=true,d=>d.secondaryErrors.push({message:'lost evidence'}),d=>delete d.residentEvidence]){
  const n=fake();await n.open();n.fault='conflict';const call=n.call;n.controller.call=async(name,args)=>{const r=await call(name,args);if(r.status==='conflict')mutation(r.data);return r;};
  assert.equal((await n.controller.submit(n.edit())).status,'frozen');assert.equal(n.writes,0);
 }
});
