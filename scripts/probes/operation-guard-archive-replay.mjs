// Offline only: archived JSON inputs, synthetic files/processes, production comparison paths.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {pathToFileURL} from 'node:url';import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
const [archive,oldBuild,out]=process.argv.slice(2);
if(!archive||!oldBuild||!out)throw Error('archive root, immutable old build, new output directory required');
await fs.mkdir(out,{recursive:true});
const current=path.resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const sourceOp='78715c58-ce22-44e9-9a98-ca87ef41c04e',exitOp='427069dd-21a4-4597-b0aa-e4f477ce6f1c';
const original=JSON.parse(await fs.readFile(path.join(archive,'historical-impact',sourceOp+'-before.json'),'utf8')).value;
const request=JSON.parse(await fs.readFile(path.join(archive,'cli/ipc',exitOp,'request.json'),'utf8'));
const result=JSON.parse(await fs.readFile(path.join(archive,'cli/ipc',exitOp,'result.json'),'utf8'));
const reports=[];
for(const [label,root] of [['before',oldBuild],['after',current]]){
 const {EngineeringService}=await import(pathToFileURL(path.join(root,'dist/service.js')));
 const {IdeAdapter}=await import(pathToFileURL(path.join(root,'dist/adapter.js')));
 const {atomicJson,readJson}=await import(pathToFileURL(path.join(root,'dist/storage.js')));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inopro-archive-replay-'));
 const service=new EngineeringService({dataDir:path.join(dir,'store')},{execute:()=>{throw Error('no dispatch');}});
 const op=structuredClone(original);await service.store.saveOp(op);
 const ledger=service.store.file('operations/'+op.operationId+'.json'),before=await fs.readFile(ledger);
 // Production finish on the exact archived unknown response; no project/registry access or source lock.
 await service.finish(op,structuredClone(original.response));
 const after=await fs.readFile(ledger);await service.store.release();
 const project=path.join(dir,'synthetic.project');await fs.writeFile(project,'offline JSON result replay');
 const diskHash=hash(await fs.readFile(project));
 const req={...request,projectPath:project,requestId:'archive-replay',requestFingerprint:'a'.repeat(64),
  args:{...request.args,readDiskHash:diskHash},fileGuard:{...request.fileGuard,expectedDiskHash:diskHash}};
 const raw=structuredClone(result);raw.data.projectPath=project;raw.data.diskHash=diskHash;
 raw.data.readOnlyEvidence={...raw.data.readOnlyEvidence,beforeDiskHash:diskHash,afterCloseDiskHash:diskHash,unchanged:true};
 const ipc=path.join(dir,'ipc');
 const adapter=new IdeAdapter({executable:process.execPath,profile:'offline',timeoutMs:2000},()=>{
  const child=new EventEmitter();child.pid=41248;
  setTimeout(async()=>{await atomicJson(path.join(ipc,'dispatched.json'),{operationId:exitOp,pid:41248});
   await atomicJson(path.join(ipc,'result.json'),raw);child.emit('exit',3221226525,null);},60);return child;
 },{probe:async()=>({state:'running',identity:{version:1,platform:process.platform,host:'offline-double',pid:41248,startId:'134396316905068510'}})});
 const observed=await adapter.execute(req,ipc,async()=>{});
 await atomicJson(path.join(out,label+'-exit-result.json'),observed);
 reports.push({label,sourceBuild:root,ledgerBeforeHash:hash(before),ledgerAfterHash:hash(after),
  originalFinishedAt:original.finishedAt,observedFinishedAt:op.finishedAt,ledgerChanged:hash(before)!==hash(after),
  nativeStatus:raw.status,injectedExitCode:3221226525,observedStatus:observed.status,observedError:observed.error?.code??null,
  testSubstitutions:['synthetic file path and matching disk/read-only hashes','mock OS process; archived PID and actual exit code','new request binding for synthetic invocation'],
  preserved:'archived tasks, rawCalls, PROGRAM evidence and original native status',engineeringOpened:false});
}
await fs.writeFile(path.join(out,'archive-replay.json'),JSON.stringify(reports,null,2));
if(!reports[0].ledgerChanged||reports[1].ledgerChanged||reports[0].observedStatus!=='succeeded'||reports[1].observedStatus!=='unknown')
 throw Error('unexpected archive replay');
console.log(JSON.stringify(reports,null,2));
