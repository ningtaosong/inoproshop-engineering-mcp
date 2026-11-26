import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {ResidentChannel,residentDependencies as deps,residentHash as hash,residentObject,verifyResidentResult} from '../dist/resident.js';
import {EngineeringService} from '../dist/service.js';import {digest,readJson} from '../dist/storage.js';import {exclusiveJson} from '../dist/exit-journal.js';import {schemas,outputSchemas,VERSION} from '../dist/contracts.js';
const APP='10000000-0000-4000-8000-000000000001',OBJ='20000000-0000-4000-8000-000000000001',ST='3b83b776-fb25-43b8-99f2-3c507c9143fc',POU='6f9dac99-8de1-4efc-8465-68ac443b7d08';
function state(file){const row=(id,parent,name,type,d,i)=>({objectId:id,applicationId:APP,parentId:parent,path:parent?['Application',name]:['Application'],nativeTypeId:type,declaration:d,implementation:i,embeddedObjectTypes:i===null?[]:[ST]});return {projectPath:file,projectHandle:0,thread:9,applications:[APP],openedProjects:{'0':{handle:0,path:file,library:false,primary:true}},nodes:{[APP]:row(APP,null,'Application',APP,null,null),[OBJ]:row(OBJ,APP,'Logic',POU,'PROGRAM Logic\nVAR\nx: DINT;\nEND_VAR','x := 1; // 中文')}};}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'InoPro resident ')),file=path.join(root,'case.project');await fs.writeFile(file,'fixed project');
 const identity={version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid:12345,startId:'987654321'};
 const n={state:state(file),writes:0,requests:[],launches:0,fault:null,child:null,loops:[],running:true};
 const config={dataDir:path.join(root,'data'),executable:process.execPath,profile:'InoProShop(V1.9.1.6)',noUI:false,timeoutMs:1000,responseWaitMs:5000,testMode:true};
 const spawnHook=(_e,_a,options)=>{
  n.launches++;const child=new EventEmitter();child.pid=identity.pid;n.child=child;
  void(async()=>{
   const intent=await readJson(options.env.INOPRO_RESIDENT_REQUEST);n.intent=intent;
   await exclusiveJson(path.join(intent.directory,'ready.json'),{launchId:intent.launchId,processIdentity:{pid:identity.pid,startId:identity.startId},state:{startup:false}});
   let seq=1,busy=false;const loop=setInterval(async()=>{if(busy)return;busy=true;try{
    const req=await readJson(path.join(intent.directory,`request-${seq}.json`));if(!req)return;n.requests.push(req);seq++;
    if(n.fault==='timeout')return;
    const before=structuredClone(n.state),d=deps(before),version=hash({dependencies:d,diskHash:req.diskHash}),put=(name,v)=>exclusiveJson(path.join(req.directory,name),v);
    await put('before.json',{state:before,diskHash:req.diskHash});
    const data={applications:[{applicationId:APP,path:['Application']}],applicationId:APP,projectPath:file,projectHandle:0,snapshot:hash(d),residentVersion:version,diskHash:req.diskHash,sessionMode:'resident',saved:false,reopened:false,closed:false,saveCalls:0,compileCalls:0,closeCalls:0,exitCalls:0,memoryModified:false,memoryEditsInSession:n.writes};
    let status='succeeded';
    if(req.command==='change'){
     if(req.args.expectedResidentVersion!==version){status='conflict';Object.assign(data,{firstError:{dispatched:false},secondaryErrors:[],recoverableRejection:true});}
     else {
      await put('checkpoint.json',{request:req,state:before,diskHash:req.diskHash,residentVersion:version});await put('predispatch.json',{state:before,diskHash:req.diskHash});await put('dispatch.json',{operationId:req.operationId,requestId:req.requestId,action:'replace-implementation'});
      n.state.nodes[OBJ].implementation=req.args.implementation;n.writes++;const after=structuredClone(n.state),actual=deps(after);
      await put('after.json',{state:after,diskHash:req.diskHash});await put('verification.json',{equal:true,expected:actual,actual});
      Object.assign(data,{snapshot:hash(actual),residentVersion:hash({dependencies:actual,diskHash:req.diskHash}),memoryModified:true,memoryEditsInSession:n.writes,persistedToProject:false});
     }
    }
    if(['read','change'].includes(req.command)&&status==='succeeded')Object.assign(data,residentObject(n.state,OBJ,APP));
    if(req.command==='list'){const {declaration,implementation,...o}=residentObject(n.state,OBJ,APP);Object.assign(data,{objects:[o],total:1,complete:true,nextOffset:null,excluded:[{objectId:APP,path:['Application'],reason:'not a root POU'}]});}
    if(n.fault==='wrong-path')data.path=['wrong'];if(n.fault==='saved')data.saved=true;if(n.fault==='list-row')data.objects=[];
    data.residentEvidence={launchId:intent.launchId,sequence:req.sequence,processIdentity:{pid:identity.pid,startId:identity.startId},requestHash:hash(req),requestCompleted:true,ideExitRequested:false};
    const result={contractVersion:'1.0.0',operationId:req.operationId,requestId:req.requestId,status,summary:'fixture-only',data};await put('result.json',result);
    if(n.fault==='missing-completion')return;
    await put('completed.json',{launchId:intent.launchId,sequence:req.sequence,processIdentity:data.residentEvidence.processIdentity,requestHash:hash(req),resultHash:hash(result)});
    if(n.fault==='exit'){n.running=false;child.emit('exit',1,null);}
   }catch(e){n.error=e;}finally{busy=false;}},5);n.loops.push(loop);
  })().catch(e=>n.error=e);return child;
 };
 const channel=new ResidentChannel(config,path.resolve('.'),{spawn:spawnHook,probe:async()=>n.running?{state:'running',identity}:{state:'exited'},occupancy:async()=>{}});
 const adapter={residentOwned:()=>channel.owned(),executeResident:(...a)=>channel.execute(...a),execute:()=>{throw Error('Forbidden batch fallback');},reconcile:()=>{throw Error('Forbidden exit reconcile');}};
 const service=new EngineeringService(config,adapter);
 t.after(async()=>{n.loops.forEach(clearInterval);if(n.child&&n.running){n.running=false;n.child.emit('exit',0,null);}await channel.observe();await service.store.release();});
 const done=async r=>{while(r.status==='running'){await new Promise(res=>setTimeout(res,10));r=await service.call('operation_status',{operationId:r.operationId});}return r;};
 const call=async(name,args)=>{try{return await done(await service.call(name,args));}catch(e){return {status:e.status,error:{code:e.code,message:e.message}};}};
 const opened=await call('project_open',{requestId:'open',projectPath:file,applicationId:APP,sessionMode:'resident'});assert.equal(opened.status,'succeeded',JSON.stringify(opened));const target={projectId:opened.data.session.projectId,applicationId:APP,targetKind:'application'};
 const read=()=>call('object_read',{...target,objectId:OBJ});
 const change=(r,requestId,implementation='x := 8; // 改动')=>call('code_apply_change',{...target,objectId:OBJ,requestId,expectedHash:r.data.contentHash,expectedResidentVersion:r.data.residentVersion,declaration:r.data.declaration,implementation});
 return {root,file,n,config,channel,service,call,target,read,change,opened};
}
test('resident service: five independent edits, same owned process/handle, no saves and request dedup',async t=>{
 const f=await fixture(t),original=await fs.readFile(f.file);for(let i=0;i<5;i++){const r=await f.read(),text=`x := ${i+2}; // 中文`;const changed=await f.change(r,'change-'+i,text);assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.saved,false);assert.equal(changed.data.reopened,false);assert.equal((await f.change(r,'change-'+i,text)).operationId,changed.operationId);assert.equal((await f.read()).data.implementation,text);}
 assert.equal(f.n.launches,1);assert.equal(f.n.writes,5);assert.deepEqual(await fs.readFile(f.file),original);assert.equal(f.n.requests.length,16);assert.equal(f.n.error,undefined);
});
test('resident service: stale memory is zero-write rejection; later new read and explicit change supported',async t=>{const f=await fixture(t),r=await f.read();f.n.state.nodes[OBJ].implementation='x := 3;';assert.equal((await f.change(r,'stale')).status,'conflict');assert.equal(f.n.writes,0);assert.equal((await f.change(await f.read(),'new')).status,'succeeded');});
test('resident service: unadapted build/save/create/copy/variables never use batch path',async t=>{const f=await fixture(t);for(const name of ['project_build','project_save','project_create','project_open_copy','variable_edit','task_inspect','library_catalog']){const r=await f.call(name,{...f.target,requestId:name});assert.equal(r.status,'unsupported',JSON.stringify(r));assert.equal(r.error.code,'RESIDENT_TOOL_NOT_ADAPTED');}assert.equal(f.n.requests.length,1);});
test('resident same-path file replacement is blocked even with identical bytes',async t=>{const f=await fixture(t);await fs.rename(f.file,f.file+'.original');await fs.copyFile(f.file+'.original',f.file);const r=await f.read();assert.equal(r.error.code,'RESIDENT_FILE_REPLACED');assert.equal(f.n.requests.length,1);});
for(const fault of ['wrong-path','saved','missing-completion','exit'])test('resident evidence failure freezes without retry: '+fault,async t=>{const f=await fixture(t);f.n.fault=fault;const r=await f.read();assert.equal(r.status,'unknown',JSON.stringify(r));const count=f.n.requests.length;await f.read();assert.equal(f.n.requests.length,count);assert.equal(f.n.launches,1);});
test('resident list independent result identity check',async t=>{const f=await fixture(t);f.n.fault='list-row';const r=await f.call('object_list',{...f.target,offset:0,limit:50});assert.equal(r.status,'unknown');});
test('resident write completion missing remains unknown, duplicate and reconcile do not rewrite',async t=>{const f=await fixture(t),r=await f.read();f.n.fault='missing-completion';const changed=await f.change(r,'uncertain');assert.equal(changed.status,'unknown');assert.equal(f.n.writes,1);assert.equal((await f.change(r,'uncertain')).operationId,changed.operationId);await f.call('operation_status',{operationId:changed.operationId,reconcile:true});assert.equal(f.n.writes,1);});
test('resident request timeout creates stop evidence, no automatic retry',async t=>{const f=await fixture(t);f.n.fault='timeout';assert.equal((await f.read()).error.code,'RESIDENT_TIMEOUT');assert.ok(await readJson(path.join(f.n.intent.directory,'stop.json')));assert.equal(f.n.writes,0);});
test('resident lifecycle observer waits for real exit and does not request it',async t=>{const f=await fixture(t);let done=false;const pending=f.channel.observe().then(()=>done=true);await new Promise(r=>setTimeout(r,30));assert.equal(done,false);assert.equal(f.n.running,true);f.n.running=false;f.n.child.emit('exit',0,null);await pending;assert.equal(done,true);});
test('resident input contract: explicit mode, version only additive; no new tools',()=>{assert.equal(VERSION,'0.40.0');assert.equal(Object.keys(schemas).length,38);assert.equal(schemas.project_open.parse({requestId:'x',projectPath:'x'}).sessionMode,undefined);assert.equal(schemas.project_open.parse({requestId:'x',projectPath:'x',sessionMode:'resident'}).sessionMode,'resident');assert.equal(Object.keys(outputSchemas).length,38);});
for(const change of ['wrong-app','not-root','mixed-st','child','wrong-header','wrong-type'])test('independent native whitelist rejects '+change,()=>{const s=state('x');if(change==='wrong-app')s.nodes[OBJ].applicationId=OBJ;if(change==='not-root')s.nodes[OBJ].parentId=null;if(change==='mixed-st')s.nodes[OBJ].embeddedObjectTypes.push(APP);if(change==='child')s.nodes.extra={parentId:OBJ};if(change==='wrong-header')s.nodes[OBJ].declaration='PROGRAM Another';if(change==='wrong-type')s.nodes[OBJ].nativeTypeId=APP;assert.throws(()=>residentObject(s,OBJ,APP));});
for(const event of ['spawn-error','immediate-exit','close-without-exit'])test('resident early process event is observed: '+event,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Resident early ')),file=path.join(root,'case.project');await fs.writeFile(file,'fixture');
 let launches=0,intentPath;const channel=new ResidentChannel({dataDir:root,executable:process.execPath,profile:'fixture',noUI:false,timeoutMs:300},path.resolve('.'),{
  occupancy:async()=>{},probe:async()=>({state:'exited'}),spawn:(_e,_a,opt)=>{launches++;intentPath=opt.env.INOPRO_RESIDENT_REQUEST;const child=new EventEmitter();if(event!=='spawn-error')child.pid=23456;
   queueMicrotask(()=>{if(event==='spawn-error'){child.emit('error',Error('fixture spawn failure'));child.emit('close');}else if(event==='immediate-exit')child.emit('exit',23,null);else child.emit('close');});return child;}
 });
 const req={operationId:randomUUID(),requestId:'early',command:'inspect',projectPath:file,args:{}};
 await assert.rejects(channel.execute(req,path.join(root,'op'),async()=>{}));await channel.observe();assert.equal(launches,1);
 const intent=await readJson(intentPath);if(event==='spawn-error'){for(let i=0;i<50&&!await readJson(path.join(intent.directory,'process-error.json'));i++)await new Promise(r=>setTimeout(r,2));assert.match((await readJson(path.join(intent.directory,'process-error.json'))).error.message,/fixture spawn failure/);}
 if(event==='immediate-exit')assert.equal((await readJson(path.join(intent.directory,'process-exit.json'))).code,23);
 await assert.rejects(channel.execute(req,path.join(root,'other'),async()=>{}));assert.equal(launches,1);
});

test('all 0.39 inputs remain exact after only documented optional additions; outputs unchanged',async()=>{
 const {z}=await import('zod'),{withoutResidentExtension}=await import('./contract-compatibility.mjs');
 const base=JSON.parse(await fs.readFile('tests/fixtures/resident-0390-contracts.json','utf8'));
 for(const row of base.tools){assert.equal(hash(withoutResidentExtension(z.toJSONSchema(schemas[row.name],{io:'input'}))),row.input,row.name+' input');assert.equal(hash(z.toJSONSchema(outputSchemas[row.name])),row.output,row.name+' output');}
});

for(const mutate of [s=>s.openedProjects['0'].handle=2,s=>s.openedProjects['0'].primary='true',s=>s.thread=null,s=>s.nodes[OBJ].declaration=4,s=>s.applications.push(APP)])test('malformed ownership/source coverage never produces dependency version',()=>{const s=state('x');mutate(s);assert.throws(()=>deps(s));});
