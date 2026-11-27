// Explicit control entry for the acceptance test. Never edits source except via
// the product MCP tool. The installed product entry must be a pinned build.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {ObservedStdioTransport} from './lib/observed-stdio.mjs';
import {ResidentAcceptanceRounds} from './lib/resident-acceptance-rounds.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,v)=>fs.writeFile(p,JSON.stringify(v,null,2),{flag:'wx'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const error=e=>({name:e.name,message:e.message,stack:e.stack});
export async function submitControl(directory,plan){
 const state=await read(path.join(directory,'control.json'));
 if(!state.allowed.includes(plan.kind))throw Error('Current control does not allow '+plan.kind);
 if(typeof plan.authorization!=='string'||!plan.authorization.trim())throw Error('Explicit authorization reference required');
 // The ticket is read only when a human/operator invokes this separate entry.
 const command={...plan,id:plan.id??randomUUID(),ticket:state.ticket};
 const file=path.join(directory,'commands',state.ticket+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
 await write(tmp,command);
 try{await fs.link(tmp,file);}finally{await fs.unlink(tmp);} // atomic, no overwrite
 return {commandId:command.id,ticket:command.ticket,path:file};
}
export async function runDriver(config){
 for(const k of ['directory','entry','cwd','dataDir'])if(typeof config[k]!=='string'||!path.isAbsolute(config[k]))throw Error('Absolute '+k+' required');
 if(sha(await fs.readFile(config.entry))!==config.entrySha256)throw Error('Pinned service entry fingerprint differs');
 if(typeof config.version!=='string'||!Number.isInteger(config.toolCount)||!Array.isArray(config.toolNames))throw Error('Expected version and complete tool names required');
 await fs.mkdir(config.directory); // a new diagnostic directory, never a new registry
 for(const sub of ['commands','results','journal'])await fs.mkdir(path.join(config.directory,sub));
 let sequence=0,journalError;const protocolPending=new Set();
 const settleProtocol=async()=>{await Promise.allSettled([...protocolPending]);if(journalError)throw journalError;};
 const record=async(event,data)=>{
  try{await write(path.join(config.directory,'journal',String(++sequence).padStart(6,'0')+'.json'),{at:new Date().toISOString(),event,data});}
  catch(e){journalError??=e;process.stderr.write(JSON.stringify({kind:'record-failed',event,error:error(e)})+'\n');throw e;}
 };
 const transport=new ObservedStdioTransport({command:process.execPath,args:[config.entry],cwd:config.cwd,stderr:'pipe',
  env:{INOPRO_DATA_DIR:config.dataDir,INOPRO_TIMEOUT_MS:'120000',INOPRO_RESPONSE_WAIT_MS:'800'}},
 {directory:path.join(config.directory,'transport'),entryFile:config.entry,closeTimeoutMs:15000});
 const client=new Client({name:'resident-explicit-round-acceptance',version:'2.0.0'});
 const controller=new ResidentAcceptanceRounds({record,finish:()=>transport.close(),observeExit:()=>transport.observeLate(15000),
  call:async(name,args)=>{
   await settleProtocol();
   await record('mcp-request',{name,args});
   const raw=await client.callTool({name,arguments:args},undefined,{timeout:180000});
   await settleProtocol();
   await record('mcp-result',{name,raw});
   if(!raw.structuredContent)throw Error('Structured MCP result absent');return raw.structuredContent;
  }});
 const publish=async()=>{const tmp=path.join(config.directory,'control.'+randomUUID()+'.tmp');await write(tmp,controller.control());await fs.rename(tmp,path.join(config.directory,'control.json'));};
 const send=transport.send.bind(transport);transport.send=async message=>{await record('protocol-out',message);return send(message);};
 try{
  const connecting=client.connect(transport),receive=transport.onmessage;
  // Record errors poison the next command; still deliver protocol so the SDK
  // does not turn the original evidence failure into an unrelated timeout.
  transport.onmessage=(message,extra)=>{const p=record('protocol-in',message).catch(e=>{journalError??=e;});protocolPending.add(p);void p.finally(()=>protocolPending.delete(p));receive?.(message,extra);};
  transport.stderr?.on('data',bytes=>{void fs.appendFile(path.join(config.directory,'service.stderr.log'),bytes).catch(e=>{journalError??=e;});});
  await connecting;
  const received=[];let cursor;const cursors=new Set();
  do{const page=await client.listTools(cursor?{cursor}:{});received.push(...page.tools);cursor=page.nextCursor;
   if(cursor&&cursors.has(cursor))throw Error('Repeated tools cursor');if(cursor)cursors.add(cursor);
  }while(cursor);
  const actual=received.map(t=>t.name).sort(),expected=[...config.toolNames].sort();
  await record('initialize',{server:client.getServerVersion(),instructions:client.getInstructions(),tools:received,
   servicePid:transport.child?.pid,driverPid:process.pid,entry:config.entry,entrySha256:config.entrySha256,dataDir:config.dataDir});
  await settleProtocol();
  if(client.getServerVersion()?.version!==config.version||received.length!==config.toolCount||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Fixed version/full tool inventory mismatch');
 }catch(e){await controller.stop(e);}
 // A failure leaves a usable finish control, not an inaccessible forever loop.
 await publish();
 while(controller.state!=='finished'){
  const file=path.join(config.directory,'commands',controller.ticket+'.json');
  if(await fs.stat(file).then(()=>true,()=>false)){
   let command,result;
   try{command=await read(file);result=await controller.submit(command);await write(path.join(config.directory,'results',command.id+'.json'),{command,result});}
   catch(e){await controller.stop(e);controller.ticket=randomUUID();}
   await publish();
  }
  if(controller.state!=='finished')await pause(250);
 }
 if(controller.cleanupError||controller.firstError||journalError)process.exitCode=1;
 // Successful transport.close has already observed exit; never SDK kill fallback.
 return controller.control();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [action,target,planPath]=process.argv.slice(2);
 try{
  if(action==='start')await runDriver(await read(target));
  else if(action==='submit')console.log(JSON.stringify(await submitControl(path.resolve(target),await read(planPath))));
  else if(action==='finish')console.log(JSON.stringify(await submitControl(path.resolve(target),{kind:'finish',authorization:planPath})));
  else if(action==='observe-exit')console.log(JSON.stringify(await submitControl(path.resolve(target),{kind:'observe-exit',authorization:planPath})));
  else throw Error('Usage: start CONFIG | submit DIRECTORY PLAN | finish DIRECTORY REFERENCE | observe-exit DIRECTORY REFERENCE');
 }catch(e){process.stderr.write(JSON.stringify(error(e))+'\n');process.exitCode=1;}
}
