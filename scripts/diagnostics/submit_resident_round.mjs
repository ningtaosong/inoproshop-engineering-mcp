// Independent diagnostic submitter. Never opens an IDE or calls an engineering API.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as eq} from 'node:util';
import {sha,durable} from './native_idle_observer.mjs';
import {roundWaiting,roundSubmission,roundSteps,processState,version} from './resident_project_observer.mjs';

function read(file){const bytes=fs.readFileSync(file);if(bytes.length>1048576)throw Error('Receipt exceeds bound');return JSON.parse(bytes.toString('utf8'));}
export function submitRound(intentFile,round,ownerProbe=processState){
 const i=read(intentFile),root=i.directory;
 if(i.scope!=='one-owned-project-two-explicit-rounds'||i.idleMs!==null||Object.hasOwn(i,'totalMs')||!Number.isInteger(round)||round<1||round>2)throw Error('Explicit two-round intent required');
 if(fs.existsSync(path.join(root,'observer-stop.json')))throw Error('Receiver stopped; do not resubmit');
 for(const row of i.fixedFiles)if(sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Fixed diagnostic dependency changed');
 const ready=read(path.join(root,'ready.json')),observer=read(i.startupReceipt),identity={pid:ready.binding.pid,startId:ready.binding.startId};
 if(ready.binding.launchId!==i.launchId||observer.intentSha256!==sha(fs.readFileSync(intentFile)))throw Error('Launch/intent evidence differs');
 for(const expected of [{pid:observer.pid,startId:observer.startId,path:observer.nodePath},{...identity,path:i.exe}]){
  const actual=ownerProbe(expected.pid);
  if(actual.state!=='running'||actual.startId!==expected.startId||actual.path!==expected.path)throw Error('Owned observer/IDE creation identity unavailable');
 }
 const waiting=read(path.join(root,`awaiting-round-${round}.json`));
 const previous=round===2?read(path.join(root,'round-1-result.json')):null;
 const prior=round===2?read(path.join(root,'result-3.json')):null;
 if(!eq(waiting,roundWaiting(i,round,identity,previous,prior,waiting.readyId)))throw Error('Current waiting receipt differs');
 const ticket=roundSubmission(waiting),file=path.join(root,`round-${round}.json`);
 if(fs.existsSync(file)){if(!eq(read(file),ticket))throw Error('Existing round request differs');return {created:false,round,file,intent:i,ticket};}
 // Publish the complete immutable JSON atomically, without replacing an existing ticket.
 const temp=path.join(root,`round-${round}-submission-${randomUUID()}.tmp`);
 durable(temp,ticket);
 try {fs.linkSync(temp,file);} catch(error){if(error.code!=='EEXIST'||!eq(read(file),ticket))throw error;return {created:false,round,file,intent:i,ticket};}
 finally {fs.unlinkSync(temp);} // Only this newly created temporary file, never a lease/lock.
 return {created:true,round,file,intent:i,ticket};
}

export async function waitRound(submission,ownerProbe=processState){
 const {intent:i,round,ticket}=submission,root=i.directory;
 const observer=read(i.startupReceipt);let nextOwnerCheck=0;
 while(true){
  const file=path.join(root,`round-${round}-result.json`);
  if(fs.existsSync(file)){
   const result=read(file);
   if(result.status!=='round-completed'||result.round!==round||result.launchId!==i.launchId||result.submissionHash!==version(ticket)||!eq(result.processIdentity,ticket.processIdentity)||!eq(result.completedSequences,roundSteps[round-1])||result.saved!==false||result.closed!==false)throw Error('Round completion receipt differs');
   return result;
  }
  if(fs.existsSync(path.join(root,'observer-stop.json')))throw Error('Observer stopped; preserve original round evidence');
  if(Date.now()>=nextOwnerCheck){const actual=ownerProbe(observer.pid);if(actual.state!=='running'||actual.startId!==observer.startId||actual.path!==observer.nodePath)throw Error('Observer creation identity unavailable; keep submitted request, do not resubmit');nextOwnerCheck=Date.now()+1000;}
  // Per-request timeouts belong to the observer/native gate, not user idle or this client.
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [intentFile,number,...extra]=process.argv.slice(2);
 if(!intentFile||!/^([12])$/.test(number??'')||extra.length)throw Error('Usage: node submit_resident_round.mjs <intent.json> <1|2>');
 const submitted=submitRound(path.resolve(intentFile),Number(number));
 console.log(JSON.stringify({round:submitted.round,created:submitted.created,request:submitted.file}));
 console.log(JSON.stringify(await waitRound(submitted),null,2));
}
