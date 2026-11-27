// Prepared, explicit-control diagnostic only. Never writes/compiles/saves an
// engineering project, launches a model, closes an IDE, or adopts a new version.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {ObservedStdioTransport} from '../lib/observed-stdio.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=(p,v)=>fs.writeFile(p,JSON.stringify(v,null,2),{flag:'wx'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function checkPlan(p){
 if(p.approvedForLaunch!==true)throw Error('Prepared only; old live session has not been handed over');
 for(const k of ['targetProject','serverPath','workingDirectory','registry','observationDirectory','clientDirectory'])if(!path.isAbsolute(p[k]??''))throw Error('Missing absolute '+k);
 if(p.env.INOPRO_DATA_DIR!==p.registry||!p.newResidentIntentRequired||p.reuseOldIntent!==false)throw Error('Original registry/new intent required');
 if(!/^[a-f0-9]{64}$/.test(p.expectedProjectSha256??''))throw Error('Target fingerprint missing');
 if(!Array.isArray(p.expectedToolNames)||p.expectedToolNames.length!==38||new Set(p.expectedToolNames).size!==38)throw Error('Expected complete tool names missing');
}

export async function observe(planPath){
 const p=await read(planPath);checkPlan(p);
 if(sha(await fs.readFile(fileURLToPath(import.meta.url)))!==p.clientHash)throw Error('Fixed diagnostic client changed');
 if(sha(await fs.readFile(p.targetProject))!==p.expectedProjectSha256)throw Error('Prepared target changed');
 const manifest=await read(p.fixedManifest);
 for(const f of manifest.files)if(sha(await fs.readFile(path.join(manifest.fixed,f.path)))!==f.sha256)throw Error('Fixed diagnostic changed: '+f.path);
 await fs.mkdir(p.clientDirectory);await fs.mkdir(p.observationDirectory);
 await fs.mkdir(path.join(p.clientDirectory,'commands'));
 let seq=0,first,stopped=false;
 const record=(event,data)=>write(path.join(p.clientDirectory,String(++seq).padStart(5,'0')+'-'+event+'.json'),{at:new Date().toISOString(),data});
 const transport=new ObservedStdioTransport({command:process.execPath,args:[p.serverPath],cwd:p.workingDirectory,env:p.env,stderr:'pipe'},
  {directory:path.join(p.clientDirectory,'transport'),entryFile:p.serverPath,closeTimeoutMs:15000});
 const client=new Client({name:'resident-save-observation-only',version:'1.0.0'});
 const call=async(name,args)=>{
  if(!['project_open','object_list','object_read','operation_status'].includes(name))throw Error('Forbidden diagnostic tool');
  await record('request',{name,args});
  let r=(await client.callTool({name,arguments:args},undefined,{timeout:180000})).structuredContent;
  await record('reply',r);
  const id=r?.operationId,requestId=r?.requestId,deadline=Date.now()+180000;
  while(r?.status==='running'){
   if(!id||Date.now()>=deadline)throw Error('Original operation observation expired');
   await sleep(1000);r=(await client.callTool({name:'operation_status',arguments:{operationId:id}},undefined,{timeout:180000})).structuredContent;
   await record('original-status',r);
   if(r?.operationId!==id||r?.requestId!==requestId)throw Error('Original operation identity changed');
  }
  if(r?.status!=='succeeded')throw Error('Read did not succeed: '+JSON.stringify(r));
  return r;
 };
 let target,objectId;
 try{
  await client.connect(transport);
  const names=[],pages=[];let cursor;
  do{const page=await client.listTools(cursor?{cursor}:{});pages.push(page);names.push(...page.tools.map(t=>t.name));cursor=page.nextCursor;}while(cursor);
  await record('connection',{version:client.getServerVersion(),instructions:client.getInstructions(),pages});
  if(client.getServerVersion()?.version!=='0.41.0'||JSON.stringify(names.sort())!==JSON.stringify([...p.expectedToolNames].sort()))throw Error('Diagnostic base version/tools differ');
  const opened=await call('project_open',{requestId:randomUUID(),projectPath:p.targetProject,sessionMode:'resident'});
  target={projectId:opened.data.session.projectId,applicationId:opened.data.applicationId,targetKind:'application'};
  let offset=0,version,objects=[],total;
  do{
   const r=await call('object_list',{...target,offset,limit:200,...(offset?{expectedResidentVersion:version}:{})});
   version??=r.data.residentVersion;if(version!==r.data.residentVersion)throw Error('List version changed');
   objects.push(...r.data.objects);total=r.data.total;offset=objects.length;
   if(!Number.isInteger(total)||total<offset||(!r.data.objects.length&&offset<total))throw Error('List incomplete');
  }while(offset<total);
  const matches=objects.filter(o=>o.path?.at(-1)===p.targetProgramName);
  if(matches.length!==1)throw Error('Unique target PROGRAM not found');objectId=matches[0].objectId;
  await call('object_read',{...target,objectId});
  await record('waiting',{next:'User adds the exact marker in the independent fixture, without saving; submit before-save-read.json',marker:p.preSaveMarker});
 }catch(e){first={message:e.message,stack:e.stack};await record('first-error',first);}
 let beforeRead=false;
 while(!stopped){
  for(const command of ['before-save-read','finish','observe-exit']){
   const f=path.join(p.clientDirectory,'commands',command+'.json');
   if(!await fs.stat(f).then(()=>true,()=>false))continue;
   const receipt=f+'.received';if(await fs.stat(receipt).then(()=>true,()=>false))continue;
   const decision=await read(f);if(!decision.authorization)throw Error('Explicit control reference required');
   await write(receipt,{at:new Date().toISOString(),decision});
   try{
    if(command==='before-save-read'){
     if(first||beforeRead)throw Error('No repeat/continuation after failure');beforeRead=true;
     await call('object_read',{...target,objectId});await record('waiting',{next:'Review unsaved marker, dirty=true and unchanged disk, then user saves original path once. No further engineering request.'});
    }else if(command==='finish'){
     if(decision.ideNormallyClosed!==true)throw Error('Normal IDE close must be independently confirmed first');
     const result=await transport.close();await record('service-exit',result);if(result?.code!==0||result?.signal!==null)throw Error('Normal service exit not confirmed');stopped=true;
    }else{
     const result=await transport.observeLate(15000);await record('late-exit',result);if(result?.code!==0||result?.signal!==null)throw Error('Late normal service exit not confirmed');stopped=true;
    }
   }catch(e){first??={message:e.message,stack:e.stack};await record('control-failed',{command,error:{message:e.message,stack:e.stack},first});}
  }
  if(!stopped)await sleep(250);
 }
 if(first)process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 observe(path.resolve(process.argv[2])).catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
}
