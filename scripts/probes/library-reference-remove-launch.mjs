// Windows command-line run of the native fixture probe. Does not start MCP,
// claim a service lock, or alter the production registration/isolation store.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const [run,exe,store,leaseModule,...extra]=process.argv.slice(2);
if(process.platform!=='win32'||!/^D:\\InoPro-LibraryRemove-Probe-[0-9-]+$/i.test(run??''))throw Error('Requires dedicated Windows probe folder');
if(extra.length || ![exe,store,leaseModule].every(value=>typeof value==='string' && path.isAbsolute(value)) ||
   path.basename(exe).toLowerCase()!=='inoproshop.exe' || path.basename(leaseModule)!=='lease-process.js')
 throw Error('Provide absolute paths to InoProShop.exe, the actual daily data directory, and its trusted fixed build dist/lease-process.js');
const script=path.join(repo,'scripts','probes','library-reference-remove-probe.py');
const argv=['--profile="InoProShop(V1.9.1.6)"','--runscript="'+script+'"'];
const out=(n,v)=>fs.writeFileSync(path.join(run,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const fixedHash='5e93ac6bc08f4b15986a118c86f2b0a4e7fbdaf7f68a8c054b21570522ef531d';
for(const k of ['unused','used']){
 const p=path.join(run,k,'AM610_'+k+'.project');
 if(fs.existsSync(p+'.~u') || crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==fixedHash)
  throw Error('Initial occupied/changed fixture; no replay or overwrite');
}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const snapshot=label=>{
 const result={label,utc:new Date().toISOString(),markers:{},unknownOperations:{}};
 for(const name of ['service.lock','service.lock.reclaim','isolation-ledger.json','registry.json','session.json']){
  const file=path.join(store,name);
  result.markers[name]=fs.existsSync(file)?hash(fs.readFileSync(file)):null;
 }
 const operations=path.join(store,'operations');
 result.operationCount=0;
 for(const filename of fs.readdirSync(operations)){
  if(!filename.endsWith('.json'))continue;
  const contents=fs.readFileSync(path.join(operations,filename)), op=JSON.parse(contents).value;
  result.operationCount++;
  if(op.status==='running')throw Error('An engineering operation is still running');
  if(op.status==='unknown')result.unknownOperations[filename]=hash(contents);
 }
 return result;
};
const prior=snapshot('before');
if(prior.markers['service.lock.reclaim'])throw Error('A reclamation marker is present; stop');
if(prior.markers['service.lock']){
 const {observeLeaseOwner}=await import(pathToFileURL(leaseModule));
 const field=fs.readFileSync(path.join(store,'service.lock'));
 if (hash(field)!==prior.markers['service.lock'])throw Error('Lease changed during observation');
 const record=JSON.parse(field);
 const decision=await observeLeaseOwner(record);
 if(decision.state!=='stale'||path.resolve(record.dataDir)!==path.resolve(store))throw Error('Active or uncertain ownership');
 prior.lease={state:decision.state,reason:decision.reason,pid:record.pid};
}
out('daily-store-before.json',prior);
const getOwners=String.raw`Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe' OR Name LIKE 'InoProShop%' OR Name = 'node.exe'" | Where-Object { $_.Name -ne 'node.exe' -or $_.CommandLine -match '[\\/]InoPro[\\/]dist[\\/]server\.js|observe-daily\.mjs' } | ForEach-Object { $_.ProcessId }`;
const owners=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',getOwners],{encoding:'utf8',windowsHide:true}).trim();
if(owners)throw Error('Existing desktop/IDE/engineering process after handoff: '+owners);
if(JSON.stringify(snapshot('before-recheck').markers)!==JSON.stringify(prior.markers))throw Error('Ownership marks changed immediately before launch');
out('launch-intent.json',{utc:new Date().toISOString(),exe,argv,readOnlyRemovalDecision:true,mark:'one native launch only'});
const fd1=fs.openSync(path.join(run,'stdout.txt'),'wx'), fd2=fs.openSync(path.join(run,'stderr.txt'),'wx');
let proc;
try{proc=spawn(exe,argv,{cwd:path.dirname(exe),windowsVerbatimArguments:true,windowsHide:true,
 env:{...process.env,INOPRO_REMOVE_PROBE_ROOT:run,INOPRO_REMOVE_PROBE_REPO:repo},stdio:['ignore',fd1,fd2]});}
finally{fs.closeSync(fd1);fs.closeSync(fd2);}
let ended=false;
const time=setTimeout(()=>{
 if(ended)return;
 out('wait-uncertain.json',{utc:new Date().toISOString(),pid:proc.pid,status:'unknown',message:'No confirmed exit by deadline. Process not killed. Do not relaunch.'});
 proc.unref();
},240000);
proc.once('spawn',()=>out('spawned.json',{pid:proc.pid,utc:new Date().toISOString()}));
proc.once('error',e=>{ended=true;clearTimeout(time);out('process-error.json',{code:e.code,message:e.message,utc:new Date().toISOString()});process.exitCode=1;});
proc.once('exit',(code,signal)=>{ended=true;clearTimeout(time);out('process-exit.json',{pid:proc.pid,code,signal,hasResult:fs.existsSync(path.join(run,'result.json')),utc:new Date().toISOString()});try{out('daily-store-after.json',snapshot('after'));}catch(e){out('daily-store-after-error.json',{error:e.message});}process.exitCode=code??1;});
