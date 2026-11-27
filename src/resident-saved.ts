import {promises as fs} from 'node:fs';
import path from 'node:path';
import {digest,pathKey,readJson,type Store,type Session} from './storage.js';
import {residentHash,residentDependencies,residentVersion} from './resident.js';
import {buildStateView} from './resident-build.js';

// A consistent file observation, not proof of who saved it or of full memory/disk equivalence.
export async function residentDisk(file:string) {
 const realPath=await fs.realpath(file),link=await fs.lstat(file,{bigint:true});
 if(link.isSymbolicLink()||!link.isFile()||link.ino===0n||link.nlink!==1n||pathKey(realPath)!==pathKey(file))throw Error('Ambiguous saved file path/identity/alias');
 const handle=await fs.open(file,'r');
 try {
  const a=await handle.stat({bigint:true}),bytes=await handle.readFile(),b=await handle.stat({bigint:true}),c=await fs.stat(file,{bigint:true});
  const view=(s:typeof a)=>({fileIdentity:`${s.dev}:${s.ino}`,size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),links:String(s.nlink)});
  if(!a.isFile()||residentHash(view(a))!==residentHash(view(b))||residentHash(view(a))!==residentHash(view(c))||a.ino!==link.ino||a.dev!==link.dev)throw Error('File changed while observing saved candidate');
  return {...view(a),realPath,diskHash:digest(bytes)};
 }finally{await handle.close();}
}
export function savedBaselineId(request:any){return residentHash({scheme:'resident-user-confirmed-baseline-v1',requestHash:residentHash(request)});}
export async function savedRegistryBinding(store:Store,session:Session) {
 const registry=await store.registry(),current=registry.projects.find(s=>s.projectId===session.projectId);
 if(registry.activeProjectId!==session.projectId||!current||residentHash(current)!==residentHash(session)||session.storageMode!=='direct'||session.sessionMode!=='resident'||pathKey(session.sourcePath)!==pathKey(session.workingPath)||pathKey(session.directPath??'')!==pathKey(session.workingPath))throw Error('Saved registry/active project binding differs');
 const image=await residentDisk(session.workingPath),aliases=[];
 for(const s of registry.projects){
  if(s.projectId===session.projectId)continue;
  for(const file of [...new Set([s.sourcePath,s.workingPath])]){
   const st=await fs.stat(file,{bigint:true}).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(st){const real=await fs.realpath(file),fileId=`${st.dev}:${st.ino}`;aliases.push({projectId:s.projectId,file,real,fileId});
    if(pathKey(real)===pathKey(image.realPath)||fileId===image.fileIdentity)throw Error('Saved file aliases another registered project');}
  }
 }
 const leases=await Promise.all([store.file('service.lock'),store.sourceLock(session.sourcePath)].map(async p=>({path:p,sha256:digest(await fs.readFile(p))})));
 return {registryHash:residentHash(registry),image,aliases,leases,sourceHash:session.sourceHash,projectId:session.projectId,sessionId:session.sessionId,leaseBasis:'same canonical source path; owner lock retained without identity rewrite'};
}
export async function verifySavedAcceptance(request:any,data:any,directory:string,before:any) {
 const old=request.savedBaseline;
 if(request.args.userConfirmedSaved!==true||!old||old.priorResidentVersion!==request.args.expectedResidentVersion||old.priorBaselineId!==(request.acceptedBaseline??null)||old.candidateDisk?.diskHash!==request.diskHash||old.candidateDisk?.fileIdentity!==request.fileIdentity)throw Error('Saved baseline request binding differs');
 const [first,second,candidate,receipt]=await Promise.all(['saved-read-first','saved-read-second','saved-candidate','saved-acceptance'].map(n=>readJson(path.join(directory,n+'.json'))));
 const clean=(r:any)=>r&&r.dirtyBefore===false&&r.dirtyAfter===false&&r.state;
 const view=(r:any)=>({...r,state:buildStateView(r.state)});
 if(!clean(first)||!clean(second)||!Number.isSafeInteger(old.priorProjectHandle)||first.state.projectHandle!==old.priorProjectHandle||residentHash(first.state)!==residentHash(before.state)||residentHash(view(first))!==residentHash(view(second)))throw Error('Saved current handle/dirty/snapshot evidence differs');
 const deps=residentDependencies(first.state),id=savedBaselineId(request),version=residentVersion(deps,request.diskHash,id);
 const expected={scheme:'resident-user-confirmed-baseline-v1',requestHash:residentHash(request),prior:old,
  snapshot:residentHash(deps),projectPath:first.state.projectPath,projectHandle:first.state.projectHandle};
 if(residentHash(candidate)!==residentHash(expected))throw Error('Saved candidate evidence differs');
 const accepted={...expected,baselineId:id,residentVersion:version,basis:'user-confirmed',nativeSaveProven:false,fullDiskMemoryEquivalenceProven:false};
 if(residentHash(receipt)!==residentHash(accepted)||residentHash(data.savedBaselineAcceptance)!==residentHash(accepted)||data.baselineAccepted!==true||data.memoryModified!==false||data.persistedToProject!==false||data.persistedToWorkingCopy!==false)throw Error('Saved acceptance receipt/result differs');
 return id;
}
