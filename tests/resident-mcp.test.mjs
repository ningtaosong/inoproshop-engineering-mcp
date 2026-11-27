import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {ResidentChannel,residentDependencies as deps,residentHash as hash,residentObject,verifyResidentResult} from '../dist/resident.js';
import {SAVE_POLICY,saveReady} from '../dist/resident-save.js';
import {ServiceLifecycle,releaseObservedLease} from '../dist/service-lifecycle.js';
import {buildConservation,buildSourceVersion,checkedDiagnostics} from '../dist/resident-build.js';
import {verifyClosedResident,closedApplicationBinding} from '../dist/resident-reopen.js';
import {EngineeringService} from '../dist/service.js';import {digest,readJson} from '../dist/storage.js';import {exclusiveJson} from '../dist/exit-journal.js';import {schemas,outputSchemas,VERSION} from '../dist/contracts.js';
import {waitForOperation} from './operation-wait.mjs';
import {statusWire} from './status-wire-helper.mjs';
const APP='10000000-0000-4000-8000-000000000001',OBJ='20000000-0000-4000-8000-000000000001',ST='3b83b776-fb25-43b8-99f2-3c507c9143fc',POU='6f9dac99-8de1-4efc-8465-68ac443b7d08';
function state(file){const row=(id,parent,name,type,d,i)=>({objectId:id,applicationId:APP,parentId:parent,path:parent?['Application',name]:['Application'],nativeTypeId:type,declaration:d,implementation:i,embeddedObjectTypes:i===null?[]:[ST]});return {projectPath:file,projectHandle:0,thread:9,applications:[APP],openedProjects:{'0':{handle:0,path:file,library:false,primary:true}},nodes:{[APP]:row(APP,null,'Application',APP,null,null),[OBJ]:row(OBJ,APP,'Logic',POU,'PROGRAM Logic\nVAR\nx: DINT;\nEND_VAR','x := 1; // 中文')}};}
test('archived native declaration and ST pair is a supported root PROGRAM',async()=>{
 const archive=JSON.parse(await fs.readFile(new URL('./fixtures/resident-first-list-20261126.json',import.meta.url),'utf8'));
 for(const {dependencies:s} of archive.snapshots){const id='76817b8e-cf3d-4b51-82a0-fb6e8bc7c778',raw=structuredClone(s),r=residentObject(s,id,s.applications[0]);assert.equal(r.objectId,id);assert.equal(r.implementation,s.nodes[id].implementation);assert.deepEqual(r.embeddedObjectTypes,s.nodes[id].embeddedObjectTypes);assert.deepEqual(s,raw);}
});
async function fixture(t,{omitApplication=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'InoPro resident ')),file=path.join(root,'case.project');await fs.writeFile(file,'fixed project');
 const identity={version:1,platform:process.platform,host:os.hostname().toLowerCase(),pid:12345,startId:'987654321'};
 const n={state:state(file),writes:0,saves:0,builds:0,requests:[],launches:0,fault:null,child:null,loops:[],running:true};
 const config={dataDir:path.join(root,'data'),executable:process.execPath,profile:'InoProShop(V1.9.1.6)',noUI:false,timeoutMs:1000,responseWaitMs:5000,testMode:true};
 const spawnHook=(_e,_a,options)=>{
  n.launches++;const child=new EventEmitter();child.pid=identity.pid;n.child=child;
  void(async()=>{
   const intent=await readJson(options.env.INOPRO_RESIDENT_REQUEST);n.intent=intent;
   // Consume the dispatched project path just as the host opens that exact request.
   // Keep the caller's original short TEMP path in `file` for same-file assertions.
   n.state.projectPath=intent.projectPath;n.state.openedProjects['0'].path=intent.projectPath;
   await exclusiveJson(path.join(intent.directory,'ready.json'),{launchId:intent.launchId,processIdentity:{pid:identity.pid,startId:identity.startId},state:{startup:false}});
   let seq=1,busy=false;const loop=setInterval(async()=>{if(busy)return;busy=true;try{
    const req=await readJson(path.join(intent.directory,`request-${seq}.json`));if(!req)return;n.requests.push(req);seq++;
    if(n.fault==='timeout')return;
    const before=structuredClone(n.state),d=deps(before),version=hash({dependencies:d,diskHash:req.diskHash}),put=(name,v)=>exclusiveJson(path.join(req.directory,name),v);
    await put('before.json',{state:before,diskHash:req.diskHash});
    const data={applications:[{applicationId:APP,path:['Application']}],applicationId:APP,projectPath:intent.projectPath,projectHandle:0,snapshot:hash(d),residentVersion:version,diskHash:req.diskHash,sessionMode:'resident',saved:false,reopened:false,closed:false,saveCalls:0,compileCalls:0,closeCalls:0,exitCalls:0,memoryModified:false,memoryEditsInSession:n.writes};
    let status='succeeded';
    if(req.command==='change'){
     if(req.args.expectedResidentVersion!==version){status='conflict';Object.assign(data,{firstError:{dispatched:false},secondaryErrors:[],recoverableRejection:true});}
     else {
      await put('checkpoint.json',{request:req,state:before,diskHash:req.diskHash,residentVersion:version});await put('predispatch.json',{state:before,diskHash:req.diskHash});
      if(req.args.implementation===before.nodes[OBJ].implementation){
       await put('no-op.json',{requestHash:hash(req),stateHash:hash(d),unchanged:true});Object.assign(data,{noOp:true,persistedToProject:false,persistedToWorkingCopy:false});
      }else{
       await put('dispatch.json',{operationId:req.operationId,requestId:req.requestId,action:'replace-implementation'});
       n.state.nodes[OBJ].implementation=req.args.implementation;n.writes++;if(n.fault==='after-embedded')n.state.nodes[OBJ].embeddedObjectTypes=[ST];const after=structuredClone(n.state),actual=deps(after);
       await put('after.json',{state:after,diskHash:req.diskHash});await put('verification.json',{equal:true,expected:actual,actual});
       if(n.beforeSave)await n.beforeSave(req);
       const ready=saveReady(req,after);await put('save-ready.json',ready);
       let authorization;const deadline=Date.now()+1500;
       while(!(authorization=await readJson(path.join(req.directory,'save-authorization.json')))){
        if(Date.now()>deadline||await readJson(path.join(intent.directory,'stop.json')))return;
        await new Promise(r=>setTimeout(r,5));
       }
       const call={requestHash:hash(req),authorizationHash:hash(authorization),projectHandle:after.projectHandle,projectPath:after.projectPath,method:'ScriptProject.save',attempt:1};await put('save-call.json',call);n.saves++;
       if(n.fault==='save-throw'){status='unknown';Object.assign(data,{firstError:{dispatched:true,message:'native save fault'},secondaryErrors:[],recoverableRejection:false,saveOutcome:'unconfirmed',saveCalls:1});}
       else{
        if(n.fault!=='save-unchanged'){
         if(n.replaceFile)await fs.rename(file,file+'.previous-'+n.saves);
         await fs.writeFile(file,JSON.stringify(n.state));
        }
        const returned={requestHash:hash(req),callHash:hash(call),returned:true};if(n.fault!=='save-return-missing')await put('save-returned.json',returned);
        const newHash=digest(await fs.readFile(file)),first={state:structuredClone(n.state),dirtyBefore:false,dirtyAfter:false,diskHash:newHash},second=structuredClone(first);
        if(n.fault==='save-dirty')second.dirtyAfter=true;
        if(n.fault==='save-missing-dirty')delete first.dirtyBefore;
        if(n.fault==='save-dirty-type')first.dirtyBefore=0;
        if(n.fault==='save-read-mismatch')second.state.nodes[OBJ].implementation='unrequested';
        if(n.fault==='save-hash-unstable')second.diskHash='c'.repeat(64);
        await put('save-read-first.json',first);await put('save-read-second.json',second);
        const receipt={scheme:SAVE_POLICY,requestHash:hash(req),callHash:hash(call),returnedHash:hash(returned),firstReadHash:hash(first),secondReadHash:hash(second),beforeDiskHash:req.diskHash,afterDiskHash:newHash,projectHandle:after.projectHandle,projectPath:after.projectPath,snapshot:hash(actual),scope:'all current unsaved project contents',reopened:false};
        if(n.fault!=='save-receipt-missing')await put('save-receipt.json',receipt);
        Object.assign(data,{snapshot:hash(actual),residentVersion:hash({dependencies:actual,diskHash:newHash}),diskHash:newHash,memoryModified:true,memoryEditsInSession:n.writes,persistedToProject:true,persistedToWorkingCopy:false,saved:true,saveCalls:1,saveReceipt:receipt});
        if(n.onSaved)await n.onSaved(req,data);
       }
      }
     }
    }
    if(req.command==='build'){
     const context=s=>{const children=Object.fromEntries(['$project',...Object.keys(s.nodes)].map(k=>[k,[]]));for(const [id,r]of Object.entries(s.nodes))children[r.parentId??'$project'].push(id);return {scheme:'resident-build-context-v1',children,devices:{}};};
     const ctx=context(before),pre=structuredClone(before);
     if(n.fault==='background-library')pre.openedProjects['7']={handle:7,path:'background.library',primary:false,library:true};
     if(n.fault==='foreign-project')pre.openedProjects['7']={handle:7,path:'foreign.project',primary:false,library:false};
     await put('build-context-before.json',ctx);await put('checkpoint.json',{request:req,state:before,diskHash:req.diskHash,residentVersion:version});await put('predispatch.json',{state:pre,diskHash:req.diskHash,buildContext:ctx});
     await put('dispatch.json',{operationId:req.operationId,requestId:req.requestId,action:'build-application',applicationId:APP,inputResidentVersion:version,sourceVersion:buildSourceVersion(before,APP)});
     await put('diagnostics-cleared.json',{categories:['c']});await put('build-call.json',{applicationId:APP});const input=structuredClone(pre);if(n.fault==='build-input-change')input.nodes[OBJ].implementation='changed during clearing';await put('build-input.json',{state:input,diskHash:req.diskHash,buildContext:ctx});n.builds++;n.built=structuredClone(n.state);
     await put('build-returned.json',{applicationId:APP});
     const rows=n.fault==='compiler-error'?[{severity:'error',text:'真实替身错误',category:'c'}]:[],compiler={applicationId:APP,completed:true,diagnosticsComplete:true,diagnostics:rows,categories:[{category:'c',count:rows.length,endObserved:true}]};
     if(n.fault==='diagnostic-gap')compiler.diagnosticsComplete=false;
     await put('compiler-result.json',compiler);
     if(n.fault==='source-change')n.state.nodes[OBJ].implementation='unauthorized';
     const after=structuredClone(n.state),post=context(after);await put('build-after-state.json',{state:after,diskHash:req.diskHash});await put('after.json',{state:after,diskHash:req.diskHash,buildContext:post});
     // A dishonest producer is intentionally tested; the Node verifier must independently reject.
     const proof={passed:true,addedDeviceIds:[],sourceUnchanged:true,directLibrariesUnchanged:true,taskCallsUnchanged:true};await put('verification.json',proof);
     Object.assign(data,{completed:true,diagnosticsComplete:true,diagnostics:rows,targetKind:'application',errorCount:rows.length,warningCount:0,buildPassed:!rows.length,compileCalls:1,buildEvidenceScope:'resident-memory',buildInputResidentVersion:version,builtSourceVersion:buildSourceVersion(before,APP),compilerResultHash:hash(compiler),buildConservation:proof,persistedToProject:false,persistedToWorkingCopy:false,snapshot:hash(deps(after)),residentVersion:hash({dependencies:deps(after),diskHash:req.diskHash})});
     if(n.fault==='wrong-build-version')data.buildInputResidentVersion='f'.repeat(64);
     if(n.fault==='wrong-source-version')data.builtSourceVersion='f'.repeat(64);
     if(n.fault==='false-pass')data.buildPassed=false;
     if(n.fault==='extra-build')data.compileCalls=2;
    }
    if(['read','change'].includes(req.command)&&status==='succeeded')Object.assign(data,residentObject(n.state,OBJ,APP));
    if(req.command==='list'){const {declaration,implementation,...o}=residentObject(n.state,OBJ,APP);Object.assign(data,{objects:[o],total:1,complete:true,nextOffset:null,excluded:[{objectId:APP,path:['Application'],reason:'not a root POU'}]});}
    if(n.fault==='wrong-path')data.path=['wrong'];if(n.fault==='saved')data.saved=true;if(n.fault==='list-row')data.objects=[];if(n.fault==='embedded-mismatch')data.embeddedObjectTypes=[ST];
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
 t.after(async()=>{n.loops.forEach(clearInterval);if(n.child&&n.running){n.running=false;n.child.emit('exit',0,null);}await channel.observe();if(n.retainChangedLease)await assert.rejects(service.store.release(),e=>e.code==='LOCK_CHANGED');else await service.store.release();});
 const done=r=>waitForOperation(service.call.bind(service),r);
 const call=async(name,args)=>{try{return await done(await service.call(name,args));}catch(e){if(typeof e.status!=='string'||typeof e.code!=='string')throw e;return {status:e.status,error:{code:e.code,message:e.message}};}};
 const opened=await call('project_open',{requestId:'open',projectPath:file,...(omitApplication?{}:{applicationId:APP}),sessionMode:'resident'});assert.equal(opened.status,'succeeded',JSON.stringify(opened));const target={projectId:opened.data.session.projectId,applicationId:APP,targetKind:'application'};
 const read=()=>call('object_read',{...target,objectId:OBJ});
 const change=(r,requestId,implementation='x := 8; // 改动')=>call('code_apply_change',{...target,objectId:OBJ,requestId,expectedHash:r.data.contentHash,expectedResidentVersion:r.data.residentVersion,declaration:r.data.declaration,implementation});
 return {root,file,n,config,channel,service,call,target,read,change,opened};
}
test('resident service: five independent edits, same owned process/handle, one save per modification and request dedup',async t=>{
 const f=await fixture(t),original=await fs.readFile(f.file);for(let i=0;i<5;i++){const r=await f.read(),text=`x := ${i+2}; // 中文`;const changed=await f.change(r,'change-'+i,text);assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.equal(changed.data.saved,true);assert.equal(changed.data.reopened,false);assert.equal((await f.change(r,'change-'+i,text)).operationId,changed.operationId);assert.equal((await f.read()).data.implementation,text);}
 assert.equal(f.n.launches,1);assert.equal(f.n.writes,5);assert.notDeepEqual(await fs.readFile(f.file),original);assert.equal(f.n.requests.length,16);assert.equal(f.n.error,undefined);
});
test('resident dispatched path: raw TEMP spelling follows owned intent through two edits',async t=>{
 const f=await fixture(t),original=await fs.readFile(f.file),canonical=await fs.realpath(f.file);
 assert.equal(f.n.intent.projectPath,canonical);assert.equal(f.n.state.projectPath,canonical);assert.equal(f.n.state.openedProjects['0'].path,canonical);
 let r=await f.read();for(const [id,text] of [['path-edit-1','x := 7; // 中文'],['path-edit-2','x := 8; // 中文']]){
  const changed=await f.change(r,id,text);assert.equal(changed.status,'succeeded',JSON.stringify(changed));r=await f.read();assert.equal(r.data.implementation,text);
 }
 assert.equal(f.n.writes,2);assert.equal(f.n.launches,1);assert.equal(f.n.error,undefined);assert.equal(f.n.requests.length,6);
 assert.ok(f.n.requests.every(x=>x.projectPath===canonical));assert.notDeepEqual(await fs.readFile(f.file),original);
});
test('resident dispatched path: genuinely different file snapshot still freezes without writing',async t=>{
 const f=await fixture(t),other=path.join(f.root,'different.project');await fs.copyFile(f.file,other);
 assert.notEqual((await fs.stat(f.file)).ino,(await fs.stat(other)).ino);
 f.n.state.projectPath=other;f.n.state.openedProjects['0'].path=other;
 const r=await f.read();assert.equal(r.status,'unknown');assert.equal(r.error.code,'RESIDENT_EVIDENCE_ERROR');assert.match(r.error.message,/another project/);
 const count=f.n.requests.length;await f.read();assert.equal(f.n.requests.length,count);assert.equal(f.n.writes,0);
});
test('resident service: stale memory is zero-write rejection; later new read and explicit change supported',async t=>{const f=await fixture(t),r=await f.read();f.n.state.nodes[OBJ].implementation='x := 3;';assert.equal((await f.change(r,'stale')).status,'conflict');assert.equal(f.n.writes,0);assert.equal((await f.change(await f.read(),'new')).status,'succeeded');});
test('resident service: unadapted save/create/copy/variables never use batch path',async t=>{const f=await fixture(t);for(const name of ['project_save','project_create','project_open_copy','variable_edit','task_inspect','library_catalog']){const r=await f.call(name,{...f.target,requestId:name});assert.equal(r.status,'unsupported',JSON.stringify(r));assert.equal(r.error.code,'RESIDENT_TOOL_NOT_ADAPTED');}assert.equal(f.n.requests.length,1);});
test('resident same-path file replacement is blocked even with identical bytes',async t=>{const f=await fixture(t);await fs.rename(f.file,f.file+'.original');await fs.copyFile(f.file+'.original',f.file);const r=await f.read();assert.equal(r.error.code,'RESIDENT_FILE_REPLACED');assert.equal(f.n.requests.length,1);});
for(const fault of ['wrong-path','saved','missing-completion','exit'])test('resident evidence failure freezes without retry: '+fault,async t=>{const f=await fixture(t);f.n.fault=fault;const r=await f.read();assert.equal(r.status,'unknown',JSON.stringify(r));const count=f.n.requests.length;await f.read();assert.equal(f.n.requests.length,count);assert.equal(f.n.launches,1);});
test('resident list independent result identity check',async t=>{const f=await fixture(t);f.n.fault='list-row';const r=await f.call('object_list',{...f.target,offset:0,limit:50});assert.equal(r.status,'unknown');});

const VAR_DECL='a9ed5b7e-75c5-4651-af16-d2c27e98cb94';
for(const parts of [[ST],[VAR_DECL,ST],[ST,VAR_DECL]])test('resident service known ST parts list/read/change retains raw evidence: '+parts.join(','),async t=>{
 const f=await fixture(t);f.n.state.nodes[OBJ].embeddedObjectTypes=parts;const before=structuredClone(f.n.state);
 const listed=await f.call('object_list',{...f.target,offset:0,limit:50});assert.equal(listed.status,'succeeded',JSON.stringify(listed));assert.deepEqual(listed.data.objects[0].embeddedObjectTypes,parts);
 const r=await f.read();assert.equal(r.status,'succeeded');assert.deepEqual(r.data.embeddedObjectTypes,parts);
 const changed=await f.change(r,'known-st');assert.equal(changed.status,'succeeded',JSON.stringify(changed));assert.deepEqual(changed.data.embeddedObjectTypes,parts);
 const expected=structuredClone(before);expected.nodes[OBJ].implementation=changed.data.implementation;assert.deepEqual(f.n.state,expected);assert.equal(f.n.writes,1);assert.equal(changed.data.saved,true);assert.equal(changed.data.compileCalls,0);
});
for(const parts of [null,[],[VAR_DECL],[ST,ST],[ST,VAR_DECL,VAR_DECL],[ST,APP],[ST,VAR_DECL,APP],[ST,null],ST,[ST,VAR_DECL.toUpperCase()]])test('resident rejects incomplete/unknown/duplicate ST parts '+JSON.stringify(parts),()=>{const s=state('x');s.nodes[OBJ].embeddedObjectTypes=parts;assert.throws(()=>residentObject(s,OBJ,APP));});
test('supported ST metadata change still invalidates old write version',async t=>{const f=await fixture(t),r=await f.read();f.n.state.nodes[OBJ].embeddedObjectTypes=[VAR_DECL,ST];assert.equal((await f.change(r,'metadata-stale')).status,'conflict');assert.equal(f.n.writes,0);});
for(const fault of ['embedded-mismatch','after-embedded'])test('resident independent ST metadata evidence mismatch freezes: '+fault,async t=>{
 const f=await fixture(t);f.n.state.nodes[OBJ].embeddedObjectTypes=[VAR_DECL,ST];const r=await f.read();assert.equal(r.status,'succeeded');f.n.fault=fault;
 const result=fault==='after-embedded'?await f.change(r,'metadata-after'):await f.read();assert.equal(result.status,'unknown',JSON.stringify(result));const count=f.n.requests.length;await f.read();assert.equal(f.n.requests.length,count);assert.equal(f.n.writes,fault==='after-embedded'?1:0);assert.equal(f.n.launches,1);
});

test('normal resident exit followed by EOF permits lifecycle release, without losing owned routing',async t=>{
 const f=await fixture(t);let released=0,closed=0;const errors=[];
 const lifecycle=new ServiceLifecycle({stopAdmission:()=>f.service.stopAdmission(),drain:()=>f.service.drain(),
  observe:()=>f.channel.observe(),status:async()=>({status:'succeeded',data:{writeFrozen:false,pending:[]}}),
  release:()=>releaseObservedLease({residentOwned:()=>f.channel.owned(),assertResidentRelease:()=>f.channel.assertReleaseReady()},async()=>{released++;}),
  close:async()=>{closed++;},record:async()=>{},failed:e=>errors.push(e)});
 const ending=lifecycle.request('stdin-end');await new Promise(r=>setTimeout(r,20));assert.equal(released,0);assert.equal(closed,0);
 f.n.running=false;f.n.child.emit('exit',0,null);await ending;
 assert.equal(released,1,JSON.stringify(errors.map(e=>e.message)));assert.equal(closed,1);assert.deepEqual(errors,[]);
 assert.equal(f.channel.owned(),true,'ownership remains a routing barrier after exit');
 await assert.rejects(f.channel.execute({operationId:randomUUID(),requestId:'no-reopen',command:'inspect',projectPath:f.file,args:{}},path.join(f.root,'no-reopen'),async()=>{}));
 assert.equal(f.n.launches,1);
});

for(const fault of ['live','nonzero','signal','null-code','close-without-exit','exit-publication','missing-start','changed-exit','changed-start','prior-unknown'])test('resident lease retained: '+fault,async t=>{
 const f=await fixture(t);let released=0;
 if(fault==='prior-unknown'){f.n.fault='wrong-path';assert.equal((await f.read()).status,'unknown');}
 if(fault==='exit-publication')await fs.mkdir(path.join(f.n.intent.directory,'process-exit.json'));
 if(fault==='live'){
  await assert.rejects(releaseObservedLease({residentOwned:()=>true,assertResidentRelease:()=>f.channel.assertReleaseReady()},async()=>{released++;}));
 }else{
  f.n.running=false;
  if(fault==='close-without-exit')f.n.child.emit('close',null,null);
  else f.n.child.emit('exit',fault==='nonzero'?23:fault==='null-code'?null:0,fault==='signal'?'SIGTERM':null);
  await f.channel.observe();
  if(fault==='missing-start')await fs.unlink(path.join(f.n.intent.directory,'process-start.json'));
  if(fault==='changed-exit'){const p=path.join(f.n.intent.directory,'process-exit.json'),r=await readJson(p);r.processIdentity.startId='different';await fs.writeFile(p,JSON.stringify(r));}
  if(fault==='changed-start'){const p=path.join(f.n.intent.directory,'process-start.json'),r=await readJson(p);r.launchId=randomUUID();await fs.writeFile(p,JSON.stringify(r));}
  await assert.rejects(releaseObservedLease({residentOwned:()=>true,assertResidentRelease:()=>f.channel.assertReleaseReady()},async()=>{released++;}));
 }
 assert.equal(released,0);assert.equal(f.channel.owned(),true);assert.equal(f.n.launches,1);
});

test('exit receipt while a resident request is in flight cannot authorize release',async t=>{
 const f=await fixture(t);f.n.fault='timeout';const pending=f.read();
 for(let i=0;i<100&&f.n.requests.length<2;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.n.requests.length,2);f.n.running=false;f.n.child.emit('exit',0,null);
 await assert.rejects(f.channel.assertReleaseReady());assert.equal((await pending).status,'unknown');await f.channel.observe();await assert.rejects(f.channel.assertReleaseReady());
});

test('lifecycle pending or frozen state retains lease even with normal resident exit',async t=>{
 const f=await fixture(t);f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();
 for(const data of [{writeFrozen:true,pending:[]},{writeFrozen:false,pending:[{operationId:'pending'}]}]){
  let released=0;const lifecycle=new ServiceLifecycle({stopAdmission:()=>{},drain:async()=>{},observe:()=>f.channel.observe(),status:async()=>({status:'succeeded',data}),
   release:()=>releaseObservedLease({residentOwned:()=>true,assertResidentRelease:()=>f.channel.assertReleaseReady()},async()=>{released++;}),close:async()=>{},record:async()=>{},failed:()=>{}});
  await lifecycle.request('stdin-end');assert.equal(released,0);
 }
});

test('owned adapter without an exit release verifier remains retained',async()=>{
 let released=0;await assert.rejects(releaseObservedLease({residentOwned:()=>true},async()=>{released++;}));assert.equal(released,0);
});

test('explicit new service project_open reaches native fresh open only after proven closed unchanged session',async t=>{
 const f=await fixture(t);f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();await f.service.store.release();
 const oldSession=await f.service.store.session();let calls=0,newRequest;
 const next=new EngineeringService(f.config,{residentOwned:()=>false,executeResident:async req=>{calls++;newRequest=req;throw Error('offline fixture stops before new native launch');},execute:async()=>{throw Error('batch forbidden');},reconcile:async()=>{throw Error('reconcile forbidden');}},
  {probe:async()=>({state:'exited'})});
 let result=await next.call('project_open',{requestId:'explicit-reopen',projectPath:f.file,applicationId:APP,sessionMode:'resident'});
 while(result.status==='running'){await new Promise(r=>setTimeout(r,5));result=await next.call('operation_status',{operationId:result.operationId});}
 assert.equal(calls,1,JSON.stringify(result));assert.equal(newRequest.command,'inspect');
 const op=await next.store.operation(result.operationId);assert.equal(op.project.projectId,oldSession.projectId);assert.notEqual(op.project.sessionId,oldSession.sessionId);
 assert.equal((await next.store.session()).sessionId,oldSession.sessionId,'failed new open must not rewrite prior registry');await next.store.release();
});

test('closed resident proof accepts original legal initial open with inferred unique Application',async t=>{
 const f=await fixture(t,{omitApplication:true});f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();
 const s=await f.service.store.session(),original=f.n.requests[0];assert.equal(Object.hasOwn(original.args,'applicationId'),false);
 const p=await verifyClosedResident(f.service.store,s,'new-explicit',async()=>({state:'exited'}));
 assert.equal(p.priorSessionId,s.sessionId);assert.equal(p.operationIds.length,1);assert.equal(f.n.launches,1);assert.equal(f.n.writes,0);assert.equal(Object.hasOwn(original.args,'applicationId'),false);
});

// Production query + production closed-session proof; the IDE is a synthetic
// producer in fixture(), never a real process or a copy of a historical ledger.
for(const defect of ['none','missing-exit','abnormal-exit','missing-request','changed-result','changed-disk','different-session','missing-anchor','duplicate-path','old-service-active','probe-unconfirmed','registry-concurrent'])test('resident query fresh-open evidence: '+defect,async t=>{
 const f=await fixture(t);f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();await f.service.store.release();
 const original=await f.service.store.session(),anchor=await f.service.store.operation(original.lastStateOperationId),dir=f.n.requests[0].directory;
 const edit=async(p,fn)=>{const v=JSON.parse(await fs.readFile(p,'utf8'));fn(v);await fs.writeFile(p,JSON.stringify(v));};
 if(defect==='missing-exit')await fs.unlink(path.join(f.n.intent.directory,'process-exit.json'));
 if(defect==='abnormal-exit')await edit(path.join(f.n.intent.directory,'process-exit.json'),v=>v.code=17);
 if(defect==='missing-request')await fs.unlink(path.join(dir,'request.json'));
 if(defect==='changed-result')await edit(path.join(dir,'result.json'),v=>v.summary='unbound changed result');
 if(defect==='changed-disk')await fs.appendFile(f.file,'external bytes');
 if(['different-session','missing-anchor','duplicate-path'].includes(defect)){
  const r=await f.service.store.registry();
  if(defect==='different-session')r.projects[0].sessionId=randomUUID();
  if(defect==='missing-anchor')delete r.projects[0].lastStateOperationId;
  if(defect==='duplicate-path')r.projects.push({...r.projects[0],projectId:randomUUID(),sessionId:randomUUID()});
  await f.service.store.put('registry.json',r);
 }
 let calls=0;const denied=async()=>{calls++;throw Error('No native request in query');};
 const next=new EngineeringService(f.config,{residentOwned:()=>false,execute:denied,executeResident:denied,reconcile:denied},{probe:async pid=>
  defect==='old-service-active'&&pid===anchor.ownerPid?{state:'running',identity:anchor.ownerIdentity}:defect==='probe-unconfirmed'?{state:'unconfirmed'}:{state:'exited'}});
 if(defect==='registry-concurrent'){
  let reads=0;const originalRead=next.store.registry.bind(next.store);
  next.store.registry=async()=>{const r=await originalRead();r.revision+=++reads;return r;};
 }
 const tree=async dir=>{const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await tree(p));else out.push([p,hash(await fs.readFile(p))]);}return out.sort();};
 const before=await tree(f.root),status=await statusWire(next);
 let listed;
 try{listed=await next.projects();}catch(e){assert.ok(['registry-concurrent','duplicate-path'].includes(defect));assert.equal(e.code,defect==='duplicate-path'?'CORRUPT_REGISTRY':'STATUS_EVIDENCE_CHANGED');}
 if(defect==='none'){
  const wireList=await statusWire(next,'project_list');assert.deepEqual(wireList,listed);
  assert.equal(status.data.availability,'available');assert.equal(status.data.writeFrozen,false);
  assert.equal(status.data.session.residentObservation.memoryAvailable,false);assert.equal(status.data.session.residentObservation.explicitOpenRequired,true);
  assert.equal(status.data.session.residentObservation.priorSessionId,original.sessionId);
  assert.equal(listed.data.projects[0].availability,'explicit-open-required');
  const {residentObservation,...registration}=status.data.session;
  assert.deepEqual(registration,original,'raw registration is retained, not rewritten as an active IDE');
 }else if(defect==='registry-concurrent'){
  assert.equal(status.status,'conflict');assert.equal(status.error.code,'STATUS_EVIDENCE_CHANGED');
  assert.equal(status.data,undefined,'stale snapshot exposes no usable session or availability');
 }else{
  assert.equal(status.data.writeFrozen,true,defect);assert.notEqual(status.data.availability,'explicit-open-required');
  if(listed)assert.ok(listed.data.projects.every(p=>p.writeFrozen===true));
 }
 assert.equal(calls,0);assert.deepEqual(await tree(f.root),before);
});

test('resident owned-channel status travels through the public MCP output contract without claiming memory verification',async t=>{
 const f=await fixture(t),raw=await f.service.store.registry(),writes=f.n.writes,saves=f.n.saves;
 const status=await statusWire(f.service),listed=await statusWire(f.service,'project_list');
 assert.equal(status.status,'succeeded');assert.equal(status.data.availability,'available');assert.equal(status.data.writeFrozen,false);
 assert.equal(status.data.session.residentObservation.state,'owned-channel');assert.equal(status.data.session.residentObservation.memoryHealthVerified,false);
 assert.equal(listed.data.projects[0].residentObservation.memoryHealthVerified,false);
 assert.deepEqual(await f.service.store.registry(),raw);assert.equal(f.n.writes,writes);assert.equal(f.n.saves,saves);
});

test('fresh-open query is not cached authorization when current disk subsequently changes',async t=>{
 const f=await fixture(t);f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();await f.service.store.release();
 let launches=0;const no=async()=>{launches++;throw Error('must not launch');};
 const next=new EngineeringService(f.config,{residentOwned:()=>false,execute:no,executeResident:no,reconcile:no},{probe:async()=>({state:'exited'})});t.after(()=>next.store.release());
 assert.equal((await statusWire(next)).data.session.residentObservation.explicitOpenRequired,true);
 await fs.appendFile(f.file,'changed after query');
 const r=await waitForOperation(next.call.bind(next),await next.call('project_open',{requestId:'fresh-open-after-disk-change',projectPath:f.file,applicationId:APP,sessionMode:'resident'}));
 assert.equal(r.status,'conflict');assert.equal(r.error.code,'RESIDENT_RECONNECT_UNSUPPORTED');assert.equal(launches,0);
});
test('archived legal inferred Application projection retains original absence and matches published selection',async()=>{
 const f=JSON.parse(await fs.readFile(new URL('./fixtures/resident-inferred-open-20261126.json',import.meta.url),'utf8'));
 const before=JSON.stringify(f);assert.equal(Object.hasOwn(f.request.args,'applicationId'),false);assert.equal(closedApplicationBinding(f.operation,f.request,f.result,f.session),true);assert.equal(JSON.stringify(f),before);
});

for(const fault of ['none','preselection-project','different-tool','different-command','later-sequence','explicit-null','explicit-other','missing-list','multiple-apps','selected-other','registered-other','anchor-list-other','missing-path','missing-response-session','different-response-session'])test('original inferred Application binding '+fault,()=>{
 const q={command:'inspect',sequence:1,args:{}},r={data:{applicationId:APP,applications:[{applicationId:APP,path:['Application']}]}},s={projectId:OBJ,sessionId:APP,applicationId:APP,applications:structuredClone(r.data.applications)},op={tool:'project_open',project:{applicationId:APP},response:{data:{session:structuredClone(s)}}};
 if(fault==='preselection-project')delete op.project.applicationId;
 if(fault==='different-tool')op.tool='object_read';if(fault==='different-command')q.command='read';if(fault==='later-sequence')q.sequence=2;
 if(fault==='explicit-null')q.args.applicationId=null;if(fault==='explicit-other')q.args.applicationId=OBJ;
 if(fault==='missing-list')delete r.data.applications;if(fault==='multiple-apps')r.data.applications.push({applicationId:OBJ,path:['Other']});
 if(fault==='selected-other')r.data.applicationId=OBJ;if(fault==='registered-other')op.project.applicationId=OBJ;
 if(fault==='anchor-list-other')s.applications=[{applicationId:OBJ,path:['Other']}];if(fault==='missing-path')delete r.data.applications[0].path;
 if(fault==='missing-response-session')delete op.response.data.session;if(fault==='different-response-session')op.response.data.session.sessionId=OBJ;
 const before=JSON.stringify([op,q,r,s]);assert.equal(closedApplicationBinding(op,q,r,s),['none','preselection-project'].includes(fault));assert.equal(JSON.stringify([op,q,r,s]),before);
});

for(const fault of ['none','live-ide','live-service','unconfirmed','missing-exit','nonzero','missing-start','exit-identity','disk-change','file-replaced','unknown','different-launch','sequence-gap','missing-completion','missing-verification','request-fingerprint','root-stop'])test('closed resident fresh-open proof '+fault,async t=>{
 const f=await fixture(t);f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();
 const s=await f.service.store.session(),anchor=await f.service.store.operation(s.lastStateOperationId),dir=f.n.intent.directory,ipc=anchor.bridge.directory;
 const change=async(file,fn)=>{const v=await readJson(file);fn(v);await fs.writeFile(file,JSON.stringify(v));};
 if(fault==='missing-exit')await fs.unlink(path.join(dir,'process-exit.json'));
 if(fault==='nonzero')await change(path.join(dir,'process-exit.json'),x=>x.code=23);
 if(fault==='missing-start')await fs.unlink(path.join(dir,'process-start.json'));
 if(fault==='exit-identity')await change(path.join(dir,'process-exit.json'),x=>x.processIdentity.startId='123');
 if(fault==='disk-change')await fs.appendFile(f.file,'changed');
 if(fault==='file-replaced'){await fs.rename(f.file,f.file+'.old');await fs.copyFile(f.file+'.old',f.file);}
 if(fault==='unknown'){anchor.status='unknown';await f.service.store.saveOp(anchor);}
 if(fault==='different-launch'){const other=structuredClone(anchor);other.operationId=randomUUID();other.requestId=randomUUID();other.bridge.launchId=randomUUID();await f.service.store.saveOp(other);}
 if(fault==='sequence-gap')await change(path.join(dir,'process-exit.json'),x=>x.lastSequence++);
 if(fault==='missing-completion')await fs.unlink(path.join(ipc,'completed.json'));
 if(fault==='missing-verification')await fs.unlink(path.join(ipc,'service-verification.json'));
 if(fault==='request-fingerprint')await change(path.join(ipc,'request.json'),x=>x.requestFingerprint='wrong');
 if(fault==='root-stop')await fs.writeFile(path.join(dir,'stop.json'),'{}');
 const probe=async pid=>fault==='unconfirmed'?{state:'unconfirmed',reason:'fixture'}:fault==='live-ide'&&pid===anchor.bridge.pid?{state:'running',identity:(await readJson(path.join(dir,'process-start.json'))).processIdentity}:fault==='live-service'&&pid===anchor.ownerPid?{state:'running',identity:anchor.ownerIdentity}:{state:'exited'};
 if(fault==='none'){const proof=await verifyClosedResident(f.service.store,s,'new-explicit',probe);assert.equal(proof.priorSessionId,s.sessionId);assert.equal(proof.diskHash,s.diskHash);}
 else await assert.rejects(verifyClosedResident(f.service.store,s,'new-explicit',probe),e=>e.code==='RESIDENT_RECONNECT_UNSUPPORTED');
 assert.equal(f.n.launches,1);assert.equal(f.n.writes,0);
});
test('resident write completion missing remains unknown, duplicate and reconcile do not rewrite',async t=>{const f=await fixture(t),r=await f.read();f.n.fault='missing-completion';const changed=await f.change(r,'uncertain');assert.equal(changed.status,'unknown');assert.equal(f.n.writes,1);assert.equal((await f.change(r,'uncertain')).operationId,changed.operationId);await f.call('operation_status',{operationId:changed.operationId,reconcile:true});assert.equal(f.n.writes,1);});
test('resident request timeout creates stop evidence, no automatic retry',async t=>{const f=await fixture(t);f.n.fault='timeout';assert.equal((await f.read()).error.code,'RESIDENT_TIMEOUT');assert.ok(await readJson(path.join(f.n.intent.directory,'stop.json')));assert.equal(f.n.writes,0);});
test('resident lifecycle observer waits for real exit and does not request it',async t=>{const f=await fixture(t);let done=false;const pending=f.channel.observe().then(()=>done=true);await new Promise(r=>setTimeout(r,30));assert.equal(done,false);assert.equal(f.n.running,true);f.n.running=false;f.n.child.emit('exit',0,null);await pending;assert.equal(done,true);});
test('resident input contract: explicit mode, version only additive; no new tools',()=>{assert.equal(VERSION,'0.42.0');assert.equal(Object.keys(schemas).length,38);assert.equal(schemas.project_open.parse({requestId:'x',projectPath:'x'}).sessionMode,undefined);assert.equal(schemas.project_open.parse({requestId:'x',projectPath:'x',sessionMode:'resident'}).sessionMode,'resident');assert.equal(Object.keys(outputSchemas).length,38);});
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

test('all main 0.38 inputs remain exact after only documented optional resident additions; outputs unchanged',async()=>{
 const {z}=await import('zod'),{withoutResidentExtension}=await import('./contract-compatibility.mjs');
 const base=JSON.parse(await fs.readFile('tests/fixtures/resident-main-0380-contracts.json','utf8'));
 for(const row of base.tools){assert.equal(hash(withoutResidentExtension(z.toJSONSchema(schemas[row.name],{io:'input'}))),row.input,row.name+' input');assert.equal(hash(z.toJSONSchema(outputSchemas[row.name])),row.output,row.name+' output');}
});

for(const mutate of [s=>s.openedProjects['0'].handle=2,s=>s.openedProjects['0'].primary='true',s=>s.thread=null,s=>s.nodes[OBJ].declaration=4,s=>s.applications.push(APP)])test('malformed ownership/source coverage never produces dependency version',()=>{const s=state('x');mutate(s);assert.throws(()=>deps(s));});

test('resident service build binds current memory and later change invalidates lastBuild, dedup compiles once',async t=>{
 const f=await fixture(t),disk=await fs.readFile(f.file);const changed=await f.change(await f.read(),'change-before-build','x := 7; // 未保存');assert.equal(changed.status,'succeeded');
 const args={...f.target,requestId:'memory-build',expectedResidentVersion:changed.data.residentVersion};
 const built=await f.call('project_build',args);assert.equal(built.status,'succeeded',JSON.stringify(built));assert.equal(built.data.buildPassed,true);assert.equal(built.data.buildEvidenceScope,'resident-memory');
 assert.equal(f.n.built.nodes[OBJ].implementation,changed.data.implementation);assert.equal((await f.service.store.session()).buildApplicable,true);
 assert.equal((await f.call('project_build',args)).operationId,built.operationId);assert.equal(f.n.builds,1);
 assert.equal((await f.read()).data.implementation,changed.data.implementation);
 assert.equal((await f.change(await f.read(),'next-memory-change','x := 8;')).status,'succeeded');assert.equal((await f.service.store.session()).buildApplicable,false);
 assert.notDeepEqual(await fs.readFile(f.file),disk);assert.equal(f.n.saves,2);assert.equal(f.n.launches,1);assert.equal(f.n.running,true);
});
test('resident service compiler errors are succeeded with failed build, allow later authorized correction',async t=>{
 const f=await fixture(t);f.n.fault='compiler-error';const r=await f.call('project_build',{...f.target,requestId:'bad-source-build',expectedResidentVersion:(await f.read()).data.residentVersion});
 assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.data.buildPassed,false);assert.equal(r.data.errorCount,1);assert.equal(r.data.diagnosticsComplete,true);
 f.n.fault=null;assert.equal((await f.change(await f.read(),'correct-source')).status,'succeeded');assert.equal((await f.service.store.session()).buildApplicable,false);
});
test('resident build stale/missing version rejected before native dispatch',async t=>{
 const f=await fixture(t);for(const v of [undefined,'b'.repeat(64)]){const r=await f.call('project_build',{...f.target,requestId:'bad-'+v,...(v?{expectedResidentVersion:v}:{})});assert.equal(r.status,'conflict',JSON.stringify(r));}
 assert.equal(f.n.builds,0);assert.equal(f.n.requests.length,1);
});
test('resident project_open cannot revive same-version build from another launch',async t=>{
 const f=await fixture(t),r=await f.read();const b=await f.call('project_build',{...f.target,requestId:'built',expectedResidentVersion:r.data.residentVersion});assert.equal(b.status,'succeeded');
 const current=await f.service.store.session();assert.equal(current.buildApplicable,true);current.lastBuild.residentEvidence.launchId=randomUUID();await f.service.store.saveSession(current);
 const opened=await f.call('project_open',{requestId:'inspect-again',projectPath:f.file,applicationId:APP,sessionMode:'resident'});
 assert.equal(opened.status,'succeeded',JSON.stringify(opened));assert.equal(opened.data.session.buildApplicable,false);assert.equal(opened.data.session.lastBuild,undefined);assert.equal(f.n.builds,1);assert.equal(f.n.launches,1);
});
test('resident build permits public background library before compile, not foreign engineering project',async t=>{
 const f=await fixture(t);f.n.fault='background-library';const r=await f.call('project_build',{...f.target,requestId:'library-load',expectedResidentVersion:(await f.read()).data.residentVersion});assert.equal(r.status,'succeeded',JSON.stringify(r));
});
for(const fault of ['foreign-project','build-input-change','source-change','diagnostic-gap','wrong-build-version','wrong-source-version','false-pass','extra-build','saved','missing-completion','exit'])test('resident build independent verifier freezes '+fault,async t=>{
 const f=await fixture(t),read=await f.read();f.n.fault=fault;const args={...f.target,requestId:'build-fault',expectedResidentVersion:read.data.residentVersion},r=await f.call('project_build',args);
 assert.equal(r.status,'unknown',JSON.stringify(r));assert.equal((await f.call('project_build',args)).operationId,r.operationId);assert.equal((await f.call('operation_status',{operationId:r.operationId,reconcile:true})).status,'unknown');const count=f.n.requests.length;await f.read();assert.equal(f.n.requests.length,count);assert.equal(f.n.builds,1);
 if(!['missing-completion','exit'].includes(fault))assert.ok((await readJson(path.join(f.config.dataDir,'ipc',r.operationId,'service-verification-failed.json')))?.firstError);
});

async function protectedFiles(f){
 const s=await f.service.store.session(),op=await f.service.store.operation(f.opened.operationId);
 return Object.fromEntries(await Promise.all([path.join(f.n.intent.directory,'intent.json'),f.service.store.file('service.lock'),f.service.store.sourceLock(s.sourcePath),f.service.store.file('operations/'+op.operationId+'.json'),path.join(op.bridge.directory,'request.json')].map(async p=>[p,digest(await fs.readFile(p))])));
}
for(const replaceFile of [false,true])test('autosave own file version chain permits second change and explicit fresh open: '+replaceFile,async t=>{
 const f=await fixture(t),old=await f.service.store.session(),prior=await protectedFiles(f);f.n.replaceFile=replaceFile;
 for(const [i,text]of ['x := 7; // 中文','x := 8; // 中文'].entries()){
  const r=await f.read(),result=await f.change(r,'auto-'+i,text);assert.equal(result.status,'succeeded',JSON.stringify(result));
  assert.equal(result.data.saved,true);assert.equal(result.data.saveCalls,1);assert.equal(result.data.reopened,false);
  const op=await f.service.store.operation(result.operationId),receipt=await readJson(path.join(op.bridge.directory,'saved-registration-committed.json'));
  assert.equal(receipt.sourceHash,old.sourceHash);assert.equal(receipt.diskHash,digest(await fs.readFile(f.file)));
  assert.equal((await f.change(r,'auto-'+i,text)).operationId,result.operationId);assert.equal(f.n.saves,i+1);
 }
 assert.deepEqual(await protectedFiles(f),prior);assert.equal(f.n.launches,1);
 f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();
 const proof=await verifyClosedResident(f.service.store,await f.service.store.session(),'new-open',async()=>({state:'exited'}));assert.equal(proof.saveVersionChain.length,2);
 assert.equal(proof.diskHash,digest(await fs.readFile(f.file)));
});
test('autosave no-op keeps unsaved user memory and disk unchanged, saves zero',async t=>{
 const f=await fixture(t);f.n.state.nodes[OBJ].implementation='user unsaved content';const r=await f.read(),disk=await fs.readFile(f.file);
 const no=await f.change(r,'noop',r.data.implementation);assert.equal(no.status,'succeeded',JSON.stringify(no));assert.equal(no.data.noOp,true);assert.equal(no.data.saved,false);
 assert.equal(f.n.writes,0);assert.equal(f.n.saves,0);assert.deepEqual(await fs.readFile(f.file),disk);
});
for(const fault of ['save-throw','save-unchanged','save-dirty','save-missing-dirty','save-dirty-type','save-read-mismatch','save-hash-unstable','save-return-missing','save-receipt-missing','missing-completion','exit'])test('autosave incomplete evidence freezes without repeat '+fault,async t=>{
 const f=await fixture(t),r=await f.read(),prior=await protectedFiles(f);f.n.fault=fault;
 const result=await f.change(r,'save-failure');assert.equal(result.status,'unknown',JSON.stringify(result));assert.equal(f.n.writes,1);assert.equal(f.n.saves,1);
 assert.deepEqual(await protectedFiles(f),prior);const count=f.n.requests.length;
 assert.equal((await f.change(r,'save-failure')).operationId,result.operationId);await f.read();assert.equal(f.n.requests.length,count);
 const op=await f.service.store.operation(result.operationId);await f.call('operation_status',{operationId:result.operationId,reconcile:true});assert.deepEqual(await f.service.store.operation(result.operationId),op);
});
for(const mutation of ['bytes','same-bytes-replacement','mtime','lease'])test('autosave pre-save external change blocks actual save '+mutation,async t=>{
 const f=await fixture(t),r=await f.read();f.n.beforeSave=async()=>{
  if(mutation==='bytes')await fs.appendFile(f.file,'outside');
  if(mutation==='same-bytes-replacement'){const b=await fs.readFile(f.file);await fs.rename(f.file,f.file+'.outside');await fs.writeFile(f.file,b);}
  if(mutation==='mtime')await fs.utimes(f.file,new Date(0),new Date(10000));
  if(mutation==='lease'){f.n.retainChangedLease=true;await fs.appendFile(f.service.store.sourceLock((await f.service.store.session()).sourcePath),' ');}
 };
 const result=await f.change(r,'external');assert.equal(result.status,'unknown',JSON.stringify(result));assert.equal(f.n.writes,1);assert.equal(f.n.saves,0);
});
for(const stage of ['registry-change','registry-publication','file-change','lease-change'])test('autosave result commit uncertainty cannot become success '+stage,async t=>{
 const f=await fixture(t),r=await f.read();f.n.onSaved=async req=>{
  if(stage==='registry-change'){const s=await f.service.store.session();s.extra='outside';await f.service.store.saveSession(s);}
  if(stage==='registry-publication')await fs.mkdir(path.join(req.directory,'saved-registration-committed.json'));
  if(stage==='file-change')await fs.appendFile(f.file,'outside');
  if(stage==='lease-change'){f.n.retainChangedLease=true;await fs.appendFile(f.service.store.sourceLock((await f.service.store.session()).sourcePath),' ');}
 };
 const result=await f.change(r,'commit');assert.equal(result.status,'unknown',JSON.stringify(result));const count=f.n.requests.length;await f.read();assert.equal(f.n.requests.length,count);assert.equal(f.n.saves,1);
});
for(const fault of ['missing-save-return','missing-channel-receipt','changed-receipt','changed-commit','wrong-chain','unknown','stopped','file-replaced'])test('closed own-save chain rejects '+fault,async t=>{
 const f=await fixture(t);f.n.replaceFile=true;const result=await f.change(await f.read(),'save-before-close');assert.equal(result.status,'succeeded');
 const op=await f.service.store.operation(result.operationId),dir=op.bridge.directory;
 f.n.running=false;f.n.child.emit('exit',0,null);await f.channel.observe();
 if(fault==='missing-save-return')await fs.unlink(path.join(dir,'save-returned.json'));
 if(fault==='missing-channel-receipt')await fs.unlink(path.join(dir,'saved-channel-accepted.json'));
 for(const [name,file]of [['changed-receipt','saved-channel-accepted'],['changed-commit','saved-registration-committed']])if(fault===name){const p=path.join(dir,file+'.json'),v=await readJson(p);v.receiptHash='f'.repeat(64);await fs.writeFile(p,JSON.stringify(v));}
 if(fault==='wrong-chain'){const p=path.join(dir,'request.json'),v=await readJson(p);v.fileIdentity='wrong';await fs.writeFile(p,JSON.stringify(v));}
 if(fault==='unknown'){op.status='unknown';await f.service.store.saveOp(op);}
 if(fault==='stopped')await fs.writeFile(path.join(f.n.intent.directory,'stop.json'),'{}');
 if(fault==='file-replaced'){const b=await fs.readFile(f.file);await fs.rename(f.file,f.file+'.external');await fs.writeFile(f.file,b);}
 await assert.rejects(verifyClosedResident(f.service.store,await f.service.store.session(),'future',async()=>({state:'exited'})),e=>e.code==='RESIDENT_RECONNECT_UNSUPPORTED');
});

test('autosave preserves and saves other current user-unsaved source without reverting it',async t=>{
 const f=await fixture(t),other='20000000-0000-4000-8000-000000000002';
 f.n.state.nodes[other]={...structuredClone(f.n.state.nodes[OBJ]),objectId:other,path:['Application','Other'],declaration:'PROGRAM Other',implementation:'(* 用户未保存的中文 *)'};
 const old=structuredClone(f.n.state.nodes[other]);const result=await f.change(await f.read(),'save-all');assert.equal(result.status,'succeeded',JSON.stringify(result));
 assert.deepEqual(f.n.state.nodes[other],old);const saved=JSON.parse(await fs.readFile(f.file,'utf8'));assert.deepEqual(saved.nodes[other],old);assert.equal(f.n.saves,1);
 assert.equal(result.data.saveReceipt.scope,'all current unsaved project contents');
});
