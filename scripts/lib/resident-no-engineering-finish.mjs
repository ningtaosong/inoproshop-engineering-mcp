// Acceptance helper only. A completed global-query-only SDK turn has no native
// launch to close. Verify that fact before the existing driver's shutdown/EOF.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const tools=['environment_inspect','session_status','project_list'];
const view=rows=>rows.map(r=>[path.resolve(r.path).toLowerCase(),r.sha256.toLowerCase()]).sort((a,b)=>a[0].localeCompare(b[0]));

export function checkNoEngineeringFinish(e){
 const {plan,control,round,trace,observations}=e;
 assert.equal(plan.scheme,'sdk-global-query-only-finish-v1');
 assert.equal(control.ticket,plan.ticket);assert.equal(control.runId,plan.runId);assert.equal(control.sessionId,plan.sessionId);
 assert.equal(control.phase,'awaiting-next-explicit-instruction');assert.equal(control.firstError,null);assert.equal(control.exitInfo,null);
 assert.equal(control.driverPid,plan.driver.pid);assert.equal(control.sdkPid,plan.sdk.pid);assert.equal(control.formal.pid,plan.service.pid);
 assert.equal(control.formal.connection,plan.connection);assert.equal(round.sessionId,plan.sessionId);
 assert.equal(new Set([plan.driver.pid,plan.sdk.pid,plan.service.pid]).size,3);
 assert.equal(round.terminal.type,'turn/end');assert.equal(round.terminal.data.reason.kind,'completed');
 assert.deepEqual(round.toolCalls.map(r=>r.data.name),tools.map(n=>'mcp__inoproshop__'+n));
 assert.ok(round.toolCalls.every(r=>r.data.arguments==='{}'));
 assert.ok(trace.length>0&&trace.every(r=>r.pid===plan.service.pid&&r.connection===plan.connection));
 const calls=trace.filter(r=>r.event==='request'&&r.method==='tools/call');
 assert.deepEqual(calls.map(r=>r.tool),tools);assert.equal(new Set(calls.map(r=>r.id)).size,3);
 const requests=trace.filter(r=>r.event==='request');
 assert.ok(requests.every(r=>['initialize','notifications/initialized','tools/list','tools/call'].includes(r.method)));
 assert.equal(requests.filter(r=>r.method==='initialize').length,1);assert.equal(requests.filter(r=>r.method==='tools/list').length,1);
 for(const q of requests.filter(r=>r.id!==null)){
  const results=trace.filter(r=>r.event==='result'&&r.id===q.id);assert.equal(results.length,1);assert.equal(results[0].ok,true);
  assert.equal(results[0].method,q.method);
  if(q.method==='tools/call'){assert.equal(results[0].tool,q.tool);assert.equal(results[0].operationStatus,'succeeded');assert.equal(results[0].isError,false);}
 }
 assert.equal(trace.filter(r=>r.event==='result').length,requests.filter(r=>r.id!==null).length);
 for(const role of ['driver','sdk','service']){assert.equal(observations[role].state,'running');assert.deepEqual(observations[role].identity,plan[role]);}
 assert.equal(e.activeOperations,0);assert.equal(e.nextRoundPresent,false);
 assert.deepEqual(view(e.registryBefore),view(e.registryNow));
 assert.deepEqual(view(e.engineeringBefore),view(e.engineeringNow));
 assert.equal(e.disk.diskHash,plan.projectHash);assert.equal(e.disk.fileIdentity,plan.projectFileIdentity);
 return {mode:'no-native/no-engineering',launchId:undefined,nativeLaunches:0,engineeringOperations:0,toolCalls:tools,
  driverIdentity:plan.driver,sdkIdentity:plan.sdk,serviceIdentity:plan.service,connection:plan.connection,sessionId:plan.sessionId,
  currentDiskHash:e.disk.diskHash,currentFileId:e.disk.fileIdentity,registryFiles:e.registryNow.length,
  semantics:'normal SDK shutdown/EOF only; no new engineering session, no old launch claimed as this service'};
}

export async function readBeforeNoEngineeringShutdown({fixed,dataDir,expectedLaunchId,authorization,planPath}){
 assert.equal(expectedLaunchId,undefined,'No native launch may be supplied for this branch');assert.ok(authorization?.trim());
 assert.ok(path.isAbsolute(planPath));
 const planBytes=await fs.readFile(planPath),plan=JSON.parse(planBytes),root=path.dirname(planPath);
 assert.equal(path.resolve(plan.fixed).toLowerCase(),path.resolve(fixed).toLowerCase());
 assert.equal(path.resolve(plan.dataDir).toLowerCase(),path.resolve(dataDir).toLowerCase());
 assert.equal(plan.driver.pid,process.pid,'Only the existing SDK owner may request shutdown');
 const imp=n=>import(pathToFileURL(path.join(fixed,'dist',n+'.js')).href);
 const {probeProcess,validProcessIdentity}=await imp('lease-process'),{Store}=await imp('storage'),{residentDisk}=await imp('resident-saved');
 const files=new Map();
 assert.deepEqual(plan.helperFiles.map(r=>path.resolve(r.path).toLowerCase()).sort(),[import.meta.url,new URL('./resident-autosave-finish.mjs',import.meta.url).href].map(u=>path.resolve(fileURLToPath(u)).toLowerCase()).sort());
 for(const row of plan.helperFiles){assert.ok(path.isAbsolute(row.path));assert.equal(hash(await fs.readFile(row.path)),row.sha256);files.set(row.path,row.sha256);}
 const read=async n=>{const file=path.join(root,n),bytes=await fs.readFile(file);files.set(file,hash(bytes));return JSON.parse(bytes);};
 const [control,round,before,launch,formal]=await Promise.all(['control.json','round1-sdk-completed.json','before-sdk.json','driver-launch.json','formal-initialize.json'].map(read));
 assert.equal(launch.pid,plan.driver.pid);assert.equal(launch.startId,plan.driver.startId);
 assert.equal(hash(await fs.readFile(launch.script)),launch.scriptSha256.toLowerCase(),'Loaded driver source reference changed');
 assert.equal(formal.pid,plan.service.pid);assert.equal(formal.connection,plan.connection);
 const tracePath=path.join(root,'traces',formal.trace),traceBytes=await fs.readFile(tracePath);files.set(tracePath,hash(traceBytes));
 const trace=traceBytes.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse),observations={};
 for(const role of ['driver','sdk','service']){assert.ok(validProcessIdentity(plan[role],plan[role].pid));observations[role]=await probeProcess(plan[role].pid);}
 async function walk(dir){const out=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())out.push(...await walk(p));else out.push({path:p,sha256:hash(await fs.readFile(p))});}return out;}
 const registryNow=await walk(dataDir),engineeringNow=await walk(path.dirname(plan.projectPath)),store=new Store(dataDir);
 const operations=await store.operations();assert.equal(before.projectHash,plan.projectHash);
 const result=checkNoEngineeringFinish({plan,control,round,trace,observations,activeOperations:operations.filter(o=>['running','queued'].includes(o.status)).length,
  nextRoundPresent:await fs.access(path.join(root,'next-round.json')).then(()=>true,()=>false),registryBefore:before.registry,registryNow,
  engineeringBefore:before.engineering,engineeringNow,disk:await residentDisk(plan.projectPath)});
 for(const [file,digest] of files)assert.equal(hash(await fs.readFile(file)),digest,'Evidence changed while observing');
 assert.deepEqual(view(await walk(dataDir)),view(registryNow));assert.deepEqual(view(await walk(path.dirname(plan.projectPath))),view(engineeringNow));
 assert.equal(hash(await fs.readFile(planPath)),hash(planBytes));
 return {...result,authorization,planPath,planSha256:hash(planBytes),proofFiles:[...files].map(([path,sha256])=>({path,sha256}))};
}
