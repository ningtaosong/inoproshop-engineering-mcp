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
 const n={calls:[],writes:0,builds:0,finish:0,fault:null,late:null,sequence:0};
 const version=()=>residentHash({dependencies:state.dependencies,diskHash:state.diskHash});
 const make=(args,d={},status='succeeded')=>({status,operationId:randomUUID(),requestId:args.requestId??randomUUID(),data:{
  saved:false,closed:false,reopened:false,saveCalls:0,compileCalls:0,closeCalls:0,exitCalls:0,diskHash:state.diskHash,residentVersion:version(),
  residentEvidence:{launchId:'10000000-1111-2222-3333-000000000001',sequence:++sequence,requestHash:'a'.repeat(64),requestCompleted:true,ideExitRequested:false,processIdentity:{pid:1234,startId:'999999'}},...d}});
 const object=()=>({objectId:OBJ,applicationId:APP,path:state.dependencies.nodes[OBJ].path,nativeTypeId:state.dependencies.nodes[OBJ].nativeTypeId,embeddedObjectTypes:state.dependencies.nodes[OBJ].embeddedObjectTypes,language:'ST',objectType:'st_pou',hasImplementation:true,declaration:state.dependencies.nodes[OBJ].declaration,implementation:source,contentHash:residentHash(source)});
 const rejected=(args)=>make(args,{recoverableRejection:true,firstError:{dispatched:false,message:'old version'},secondaryErrors:[]},'conflict');
 n.call=async(name,args)=>{
  n.calls.push({name,args:structuredClone(args)});
  if(name==='operation_status')return n.late;
  let r;
  if(name==='project_open')r=make(args,{projectPath:args.projectPath,applicationId:APP,session:{projectId:'20000000-1111-2222-3333-000000000001'},residentVersion:old.residentVersion});
  else if(name==='object_list'){
   if(args.expectedResidentVersion&&args.expectedResidentVersion!==version())return rejected(args);
   if(n.fault==='conflict'){n.fault=null;return rejected(args);}
   const {declaration,implementation,...listed}=object();const all=[listed,{objectId:'30000000-1111-2222-3333-000000000001'}],selected=all.slice(args.offset,args.offset+args.limit),next=args.offset+selected.length<2?args.offset+selected.length:null;
   r=make(args,{objects:selected,total:2,complete:true,nextOffset:next});
   if(n.fault==='page-change'&&args.offset===0)state.dependencies.nodes[LIB].directLibraries.push({...state.dependencies.nodes[LIB].directLibraries[0],id:'changed'});
   if(n.fault==='library-after-list'&&next===null)state.dependencies.nodes[LIB].directLibraries.push({...state.dependencies.nodes[LIB].directLibraries[0],id:'later-current-read'});
   if(n.fault==='missing')delete r.data.residentEvidence;
   if(n.fault==='duplicate')r.data.objects=[{objectId:OBJ},{objectId:OBJ}];
  }else if(name==='object_read'){
   r=make(args,object());
   if(n.fault==='library-after-read'){state.dependencies.nodes[LIB].directLibraries.push({...state.dependencies.nodes[LIB].directLibraries[0],id:'after-read'});n.fault=null;}
  }
  else if(name==='code_apply_change'){
   if(n.fault==='write-conflict')return rejected(args);
   if(args.expectedResidentVersion!==version())return rejected(args);
   assert.equal(args.expectedResidentVersion,version());assert.equal(args.expectedHash,residentHash(source));
   n.writes++;source=args.implementation;state.dependencies.nodes[OBJ].implementation=source;r=make(args,object());
   if(n.fault==='unknown')r=make(args,{firstError:{dispatched:true,message:'original write error'},recoverableRejection:false,secondaryErrors:[]},'unknown');
   if(n.fault==='postread-mismatch')state.diskHash='b'.repeat(64);
   if(n.fault==='library-after-write')state.dependencies.nodes[LIB].directLibraries.push({...state.dependencies.nodes[LIB].directLibraries[0],id:'after-write'});
   if(n.fault==='throw')throw Error('FIRST after native modification');
  }else if(name==='project_build'){
   assert.equal(args.expectedResidentVersion,version());n.builds++;
   r=make(args,{applicationId:APP,compileCalls:1,buildInputResidentVersion:args.expectedResidentVersion,buildEvidenceScope:'resident-memory',completed:true,diagnosticsComplete:true,buildPassed:true,errorCount:0,warningCount:0,diagnostics:[],buildConservation:{passed:true,sourceUnchanged:true,taskCallsUnchanged:true},persistedToProject:false,persistedToWorkingCopy:false});
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
test('a separate current object read may observe later library dependencies than completed list',async()=>{
 const n=fake();await n.open();n.fault='library-after-list';const r=await n.controller.submit(n.edit({limit:1}));assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(n.writes,1);
 const pages=n.calls.filter(c=>c.name==='object_list');assert.equal(pages.length,2);assert.equal(pages[1].args.expectedResidentVersion,current.residentVersion);
 const write=n.calls.find(c=>c.name==='code_apply_change');assert.notEqual(write.args.expectedResidentVersion,current.residentVersion);assert.equal(write.args.expectedResidentVersion,r.before.data.residentVersion);
 assert.equal(n.calls.filter(c=>c.name==='object_read').length,2);assert.equal(n.calls.filter(c=>c.name==='code_apply_change').length,1);
 const plan=n.events.find(e=>e.event==='write-plan').data;assert.equal(plan.listedVersion,current.residentVersion);assert.equal(plan.expectedResidentVersion,r.before.data.residentVersion);
});
for(const [key,value] of [['objectId',APP],['applicationId',OBJ],['path',['Different','PLC_PRG']],['nativeTypeId',APP],['embeddedObjectTypes',[]],['language','FBD'],['objectType','method'],['hasImplementation',false],['implementation','changed source'],['diskHash','f'.repeat(64)]])test('fresh read still rejects changed target/source/disk: '+key,async()=>{
 const n=fake();await n.open();n.fault='library-after-list';const call=n.call;n.controller.call=async(name,args)=>{const r=await call(name,args);if(name==='object_read')r.data[key]=value;return r;};
 const r=await n.controller.submit(n.edit());assert.notEqual(r.status,'succeeded');assert.equal(n.writes,0);assert.equal(n.calls.filter(c=>c.name==='code_apply_change').length,0);
});
test('fresh read cannot omit native identity evidence',async()=>{
 const n=fake();await n.open();const call=n.call;n.controller.call=async(name,args)=>{const r=await call(name,args);if(name==='object_read')delete r.data.nativeTypeId;return r;};
 assert.equal((await n.controller.submit(n.edit())).status,'frozen');assert.equal(n.writes,0);assert.equal(n.calls.filter(c=>c.name==='code_apply_change').length,0);
});
test('dependency change after current read still conflicts without retry',async()=>{
 const n=fake();await n.open();n.fault='library-after-read';const r=await n.controller.submit(n.edit());assert.equal(r.status,'round-rejected');assert.equal(n.writes,0);assert.equal(n.calls.filter(c=>c.name==='code_apply_change').length,1);assert.equal(n.calls.filter(c=>c.name==='object_read').length,1);
});
test('dependency change after write still freezes without refresh or replay',async()=>{
 const n=fake();await n.open();n.fault='library-after-write';const r=await n.controller.submit(n.edit());assert.equal(r.status,'frozen');assert.equal(n.writes,1);await assert.rejects(n.controller.submit(n.edit()),/not permitted/);assert.equal(n.calls.filter(c=>c.name==='code_apply_change').length,1);
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
test('predispatch MCP conflict without resident receipt retains its original error and stays stopped',async()=>{
 const n=fake(),command=n.command('open',{projectPath:current.dependencies.projectPath,applicationId:APP}),original={contractVersion:'1.0.0',status:'conflict',operationId:randomUUID(),requestId:command.id,error:{code:'RESIDENT_RECONNECT_UNSUPPORTED',message:'Prior resident reopen proof unavailable: Excluded object coverage differs'}};
 n.controller.call=async()=>original;const result=await n.controller.submit(command);assert.equal(result.status,'frozen');assert.deepEqual(result.originalResult,original);assert.equal(result.error.message,original.error.message);assert.equal(result.writeAttempted,false);
 await assert.rejects(n.controller.submit(n.edit()),/not permitted/);assert.equal((await n.controller.submit(n.command('finish'))).status,'finished');assert.equal(n.writes,0);
});

test('explicit build uses latest read version once and independent source read; finish remains available',async()=>{
 const n=fake();await n.open();await n.controller.submit(n.edit());
 n.fault='library-after-list'; // build does not list or reuse an old open version
 const cmd=n.command('build',{objectId:OBJ,expectedImplementation:SOURCE.replace('T#5s','T#7s')});
 const start=n.calls.length,r=await n.controller.submit(cmd);assert.equal(r.status,'succeeded',JSON.stringify(r));
 assert.deepEqual(n.calls.slice(start).map(x=>x.name),['object_read','project_build','object_read']);
 assert.equal(n.calls.find(x=>x.name==='project_build').args.expectedResidentVersion,r.before.data.residentVersion);
 assert.equal(n.builds,1);assert.equal(r.compileCalls,1);assert.equal(r.saveCalls,0);assert.equal(n.controller.state,'waiting');
 assert.equal(await n.controller.submit(cmd),r);assert.equal(n.builds,1);
 assert.equal((await n.controller.submit(n.command('finish'))).status,'finished');assert.equal(n.finish,1);
});
for(const fault of ['wrong-source','missing-field','disk-change','publication'])test('explicit build precheck '+fault+' dispatches zero compile/save',async()=>{
 const n=fake();await n.open();await n.controller.submit(n.edit());const call=n.call;
 n.controller.call=async(name,args)=>{const r=await call(name,args);if(name==='object_read'){if(fault==='wrong-source')r.data.implementation='other';if(fault==='missing-field')delete r.data.embeddedObjectTypes;if(fault==='disk-change')r.data.diskHash='f'.repeat(64);}return r;};
 if(fault==='publication')n.controller.record=async event=>{if(event==='build-plan')throw Error('FIRST build plan publication');};
 const r=await n.controller.submit(n.command('build',{objectId:OBJ,expectedImplementation:SOURCE.replace('T#5s','T#7s')}));
 assert.equal(r.status,'frozen');assert.equal(n.builds,0);assert.equal(n.calls.some(x=>/save/.test(x.name)),false);
});
for(const [key,value] of [['compileCalls',0],['diagnosticsComplete',false],['buildPassed',false],['buildConservation',{}],['buildEvidenceScope','disk'],['persistedToProject',true],['applicationId',OBJ],['buildInputResidentVersion','f'.repeat(64)]])test('build incomplete/failed '+key+' freezes without readback/replay; normal finish remains',async()=>{
 const n=fake();await n.open();await n.controller.submit(n.edit());const call=n.call;
 n.controller.call=async(name,args)=>{const r=await call(name,args);if(name==='project_build')r.data[key]=value;return r;};
 const start=n.calls.length,cmd=n.command('build',{objectId:OBJ,expectedImplementation:SOURCE.replace('T#5s','T#7s')}),r=await n.controller.submit(cmd);
 assert.equal(r.status,'frozen');assert.equal(n.builds,1);assert.deepEqual(n.calls.slice(start).map(x=>x.name),['object_read','project_build']);
 assert.equal(await n.controller.submit(cmd),r);assert.equal(n.builds,1);assert.equal((await n.controller.submit(n.command('finish'))).status,'finished');
});
test('build unknown retains original result and cannot replay; postbuild source drift also freezes',async()=>{
 for(const fault of ['unknown','post-source','post-version']){
  const n=fake();await n.open();await n.controller.submit(n.edit());const call=n.call;let built=false,original;
  n.controller.call=async(name,args)=>{const r=await call(name,args);if(name==='project_build'){built=true;if(fault==='unknown'){r.status='unknown';r.data.firstError={message:'FIRST compiler exception',dispatched:true};original=r;}}else if(name==='object_read'&&built){if(fault==='post-source')r.data.implementation='other';if(fault==='post-version')r.data.residentVersion='f'.repeat(64);}return r;};
  const r=await n.controller.submit(n.command('build',{objectId:OBJ,expectedImplementation:SOURCE.replace('T#5s','T#7s')}));assert.equal(r.status,'frozen');assert.equal(n.builds,1);
  if(original)assert.deepEqual(r.originalResult,original);await assert.rejects(n.controller.submit(n.command('build')),/not permitted/);
 }
});
test('non-build request must retain zero compile calls',async()=>{
 const n=fake(),call=n.call;n.controller.call=async(name,args)=>{const r=await call(name,args);r.data.compileCalls=1;return r;};assert.equal((await n.open()).status,'frozen');assert.equal(n.builds,0);
});
