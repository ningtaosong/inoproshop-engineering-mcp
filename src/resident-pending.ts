// Read-only impact proof for an ended resident launch. Never a success,
// reopen, recovery or lease-release proof. Original unknowns remain unchanged.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {canonical,digest,pathKey,type Store,type Operation,type Session} from './storage.js';
import {fileIdentity,ownedProject} from './isolation.js';
import {sameProcess,validProcessIdentity,type ProcessProbe} from './lease-process.js';
import {replySchema} from './contracts.js';
import {residentHash} from './resident.js';

const fail=(s:string):never=>{throw Error('Resident pending scope: '+s);};
const eq=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const uuid=(v:any)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v);
const hash=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const commands:Record<string,string>={project_open:'inspect',object_list:'list',object_read:'read',code_apply_change:'change',project_build:'build'};

export async function residentPendingScope(store:Store,op:Operation,s:Session,projects:Session[],read:(p:string)=>Promise<any>,probe:ProcessProbe){
 const launch=op.bridge?.launchId;
 if(op.resident!==true||!uuid(launch)||s.sessionMode!=='resident'||s.storageMode!=='direct'||s.editMode!=='direct'||
  !s.directPath||![s.sourcePath,s.directPath].every(p=>pathKey(p)===pathKey(s.workingPath)))fail('resident/project binding incomplete');
 const root=store.file('resident/'+launch);
 if(pathKey(await fs.realpath(root))!==pathKey(root))fail('launch directory alias');
 const [intent,start,exit,ready,entry,modules,stopped]=await Promise.all(['intent.json','process-start.json','process-exit.json','ready.json','entry.json','modules-loaded.json','receiver-stopped.json'].map(n=>read(path.join(root,n))));
 const identity=start?.processIdentity,native={pid:identity?.pid,startId:identity?.startId};
 if(!validProcessIdentity(identity,op.bridge?.pid??-1)||identity.platform!==process.platform||identity.host!==os.hostname().toLowerCase()||
  start.launchId!==launch||intent?.launchId!==launch||pathKey(intent?.directory??'')!==pathKey(root)||pathKey(intent?.projectPath??'')!==pathKey(s.workingPath)||
  !hash(intent?.scriptHash)||!hash(intent?.coreHash)||start.scriptHash!==intent.scriptHash||start.coreHash!==intent.coreHash||
  !path.isAbsolute(start.entry??'')||!path.isAbsolute(intent.corePath??'')||entry?.pid!==identity.pid||entry.scriptSha256!==intent.scriptHash||
  modules?.launchId!==launch||modules.coreHash!==intent.coreHash||!eq(modules.processIdentity,native)||
  ready?.launchId!==launch||!eq(ready.processIdentity,native)||ready.state?.startup!==false)fail('launch/start/module identity incomplete');
 if(!exit||exit.launchId!==launch||exit.pid!==identity.pid||!eq(exit.processIdentity,identity)||exit.code!==0||exit.signal!==null||
  !Number.isSafeInteger(exit.lastSequence)||exit.lastSequence<1||!Number.isFinite(Date.parse(exit.at))||
  !stopped||stopped.completed!==exit.lastSequence||stopped.ideExitRequested!==false||stopped.projectClosed!==false||stopped.firstError!==null)fail('normal exit or receiver coverage incomplete');
 const gone=async(pid:number,who:any)=>{
  if(!validProcessIdentity(who,pid)||who.platform!==process.platform||who.host!==os.hostname().toLowerCase())fail('process creation identity missing');
  const now=await probe(pid);
  if(now.state==='exited')return;
  if(now.state==='running'&&validProcessIdentity(now.identity,pid)&&now.identity.platform===who.platform&&now.identity.host===who.host&&!sameProcess(now.identity,who))return;
  fail('original process still active or unconfirmed');
 };
 await gone(identity.pid,identity);await gone(op.ownerPid!,op.ownerIdentity);
 const current=await fileIdentity(s.workingPath);
 if(current.missing||!current.realPath||!current.fileId||current.fileId!==intent.originalFileId||pathKey(current.realPath)!==pathKey(s.workingPath)||current.sha256!==s.diskHash)fail('original saved file identity/version changed');
 const all=await store.operations(),rows=all.filter(o=>o.bridge?.launchId===launch);
 if(rows.length!==exit.lastSequence||!rows.some(o=>o.operationId===op.operationId))fail('operation coverage differs');
 const queueNames=async()=> (await fs.readdir(root)).filter(n=>/^request-.*\.json$/.test(n)).sort();
 const expected=Array.from({length:rows.length},(_,i)=>`request-${i+1}.json`).sort();
 if(!eq(await queueNames(),expected))fail('queue coverage differs');
 const sequences=new Set<number>();
 for(const row of rows){
  const ipc=store.file('ipc/'+row.operationId),owned=ownedProject(row,projects);
  const entries=await fs.readdir(ipc,{withFileTypes:true});
  if(entries.some(e=>e.isSymbolicLink()||e.isDirectory()))fail('operation evidence aliases or nested requests unsupported');
  if(row.resident!==true||owned.projectId!==s.projectId||owned.sessionId!==s.sessionId||row.ownerPid!==op.ownerPid||!eq(row.ownerIdentity,op.ownerIdentity)||
   row.bridge?.pid!==identity.pid||pathKey(row.bridge?.directory??'')!==pathKey(ipc)||pathKey(await fs.realpath(ipc))!==pathKey(ipc)||
   row.fingerprint!==digest(canonical({tool:row.tool,args:row.args}))||all.filter(o=>o.requestId===row.requestId).length!==1||
   !['succeeded','conflict','unknown'].includes(row.status)||!replySchema.safeParse(row.response).success||row.response?.status!==row.status||row.response?.operationId!==row.operationId||row.response?.requestId!==row.requestId||
   !Number.isFinite(Date.parse(row.finishedAt??''))||Date.parse(row.finishedAt!)>Date.parse(exit.at))fail('operation ownership/status differs');
  const ledger=await read(store.file('operations/'+row.operationId+'.json'));
  if(ledger?.schemaVersion!==1||!eq(ledger.value,row)||ledger.checksum!==digest(canonical(row)))fail('operation ledger differs');
  const [req,result,completion,check,entered,before]=await Promise.all(['request.json','result.json','completed.json','service-verification.json','request-entered.json','before.json'].map(n=>read(path.join(ipc,n))));
  const args={...req?.args};delete args.residentLeases;
  if(!req||req.operationId!==row.operationId||req.requestId!==row.requestId||req.requestFingerprint!==row.fingerprint||req.launchId!==launch||
   req.command!==commands[row.tool]||!commands[row.tool]||!eq(args,row.args)||!Number.isSafeInteger(req.sequence)||req.sequence<1||req.sequence>rows.length||sequences.has(req.sequence)||
   pathKey(req.directory??'')!==pathKey(ipc)||pathKey(req.projectPath??'')!==pathKey(s.workingPath)||req.fileIdentity!==current.fileId||req.diskHash!==current.sha256||
   !Array.isArray(req.leases)||req.leases.length!==2||!eq(req.leases,req.args.residentLeases)||req.leases.some((x:any)=>!x||!path.isAbsolute(x.path??'')||!hash(x.sha256))||
   pathKey(req.leases[0].path)!==pathKey(store.file('service.lock'))||pathKey(req.leases[1].path)!==pathKey(store.sourceLock(s.workingPath)))fail('request/file/argument binding differs');
  sequences.add(req.sequence);
  if(!eq(await read(path.join(root,`request-${req.sequence}.json`)),req))fail('queue/request differs');
  const rh=residentHash(req),e=result?.data?.residentEvidence;
  if(!replySchema.safeParse(result).success||result.status!==row.status||result.operationId!==row.operationId||result.requestId!==row.requestId||
   !eq(e,row.response?.data?.residentEvidence)||e?.launchId!==launch||e?.sequence!==req.sequence||e?.requestHash!==rh||!eq(e?.processIdentity,native)||e?.requestCompleted!==true||e?.ideExitRequested!==false||
   !eq(entered,{launchId:launch,requestHash:rh,processIdentity:native})||
   !eq(completion,{launchId:launch,sequence:req.sequence,processIdentity:native,requestHash:rh,resultHash:residentHash(result)})||
   check?.passed!==true||check.launchId!==launch||check.sequence!==req.sequence||check.requestHash!==rh||check.resultHash!==residentHash(result)||!eq(check.processIdentity,identity)||check.processState!=='running'||check.exitRequiredForRequest!==false||check.diskHash!==current.sha256)fail('request completion/service binding differs');
  const state=before?.state,opened=state?.openedProjects,primary=opened?.[String(state?.projectHandle)];
  if(before?.diskHash!==current.sha256||pathKey(state?.projectPath??'')!==pathKey(s.workingPath)||!Number.isSafeInteger(state?.projectHandle)||state.projectHandle<0||!opened||Array.isArray(opened)||
   !primary||primary.handle!==state.projectHandle||primary.primary!==true||primary.library!==false||pathKey(primary.path??'')!==pathKey(s.workingPath)||
   Object.entries<any>(opened).some(([k,v])=>!v||!Number.isSafeInteger(v.handle)||String(v.handle)!==k||typeof v.path!=='string'||typeof v.primary!=='boolean'||typeof v.library!=='boolean'||(v!==primary&&(v.primary||!v.library))))fail('native project ownership incomplete');
 }
 const recheck=async()=>{
  await gone(identity.pid,identity);await gone(op.ownerPid!,op.ownerIdentity);
  if(!eq(await queueNames(),expected)||!eq(await fileIdentity(s.workingPath),current)||
   !eq((await store.operations()).filter(o=>o.bridge?.launchId===launch),rows))fail('launch coverage/file/operations changed during assessment');
 };
 await recheck();
 return {basis:'resident-ended-launch-binding-v1; current unchanged file identity; outcome remains unknown',recheck};
}
