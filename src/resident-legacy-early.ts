// Compatibility for one reviewed legacy diagnostic implementation, not a
// reconstruction of missing native values or an unknown-operation recovery.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {canonical,digest,pathKey,type Store} from './storage.js';
import {residentHash} from './resident.js';

const fail=(message:string):never=>{throw Error('Resident legacy first read: '+message);};
const eq=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const reviewed={
 entry:'dcd16c6ecba2b0cb7acbdffacb2ddfb334d10de2080346ffe972278ccfaf6a0a',
 core:'cea41379f4f5d068552f5995e0b0bd99533fd0f0041d7d44604da657634052e5',
 host:'d9beab321ecb4a7af96fafea0c53f679c6a403220158afe1952404dce32998d6',
 observer:'ecd40955fda95c21d3950ea568a84dc2d3dda24f722e416b0a98ba7e7bcbb500',
 client:'32b0c5e5e8ba4d59214e47d3fd74ec032ce8d10558bc92f7b62e0b4c74cb30b0',
 manifest:'dc70ce55cecec2acaf183675e03e204d92cab4b692fabe9251ff24b3eaff47cf',
};
export const legacyEarlyCandidate=(intent:any)=>intent?.scriptHash===reviewed.entry&&intent?.coreHash===reviewed.core;

export async function legacyEarlyOwnership(store:Store,req:any,result:any,intent:any,start:any,read:(p:string)=>Promise<any>){
 const first=result?.data?.firstError,e=result?.data?.residentEvidence;
 if(!legacyEarlyCandidate(intent)||req.command!=='inspect'||req.sequence!==1||result.status!=='unknown'||
  result.error?.code!=='RESIDENT_PRECONDITION'||first?.type!=='ImportError'||first.message!=='No module named _3S.CoDeSys.Core'||result.error.message!==first.message||
  !eq(Object.keys(first).sort(),['dispatched','message','traceback','type'])||first.dispatched!==false||
  !eq(Object.keys(result.data).sort(),['closed','firstError','recoverableRejection','reopened','residentEvidence','saved','secondaryErrors'])||
  !eq(Object.keys(e??{}).sort(),['ideExitRequested','launchId','processIdentity','requestCompleted','requestHash','sequence'])||
  result.data.recoverableRejection!==false||!eq(result.data.secondaryErrors,[])||
  ['saved','reopened','closed'].some(k=>result.data[k]!==false)||Object.hasOwn(e??{},'ownershipRecords'))fail('not the reviewed legacy failure');
 const bridge=path.dirname(start.entry),fixed=path.dirname(bridge),base=path.dirname(fixed);
 const paths={entry:path.join(bridge,'resident_host.py'),core:path.join(bridge,'resident_core.py'),host:path.join(bridge,'resident_host_original.py'),
  observer:path.join(bridge,'resident_save_observer.py'),client:path.join(fixed,'scripts/diagnostics/resident_save_observation_client.mjs')};
 const planPath=path.join(base,'prepared-plan.json'),manifestPath=path.join(base,'diagnostic-fixed-manifest.json');
 const regularFile=async(p:string)=>{
  const st=await fs.lstat(p);
  if(!st.isFile()||st.isSymbolicLink()||pathKey(await fs.realpath(p))!==pathKey(p))fail('fixed source or metadata alias/unavailable');
 };
 for(const p of [planPath,manifestPath])await regularFile(p);
 const plan=await read(planPath),manifest=await read(manifestPath);
 const metadataBytes=new Map<string,string>();
 for(const [p,value] of [[planPath,plan],[manifestPath,manifest]] as const){
  const bytes=await fs.readFile(p);
  if(!eq(JSON.parse(bytes.toString('utf8')),value))fail('fixed metadata changed while reading');
  metadataBytes.set(p,digest(bytes));
 }
 const planFields=new Set(['admissionEvidence','approvedForLaunch','authorization','authorizationAt','clientDirectory','clientHash','clientPath','coreHash','corePath','entryHash','entryPath','env','executable','expectedProjectSha256','expectedToolNames','fixedManifest','hostHash','hostPath','launched','maxInstructionBytes','newResidentIntentRequired','normalLaunchArguments','observationDirectory','observerHash','observerPath','oldMcpExitCode','oldMcpNormalReleaseConfirmed','preSaveMarker','profile','purpose','registry','reuseOldIntent','serverPath','shutdown','source','sourceCommit','targetProgramName','targetProject','workingDirectory']);
 if(!plan||Object.keys(plan).some(k=>!planFields.has(k)))fail('unreviewed plan field');
 const samePath=(a:any,b:string)=>typeof a==='string'&&path.isAbsolute(a)&&pathKey(a)===pathKey(b);
 if(!samePath(start.entry,paths.entry)||!samePath(intent.corePath,paths.core)||
  !plan||plan.approvedForLaunch!==true||plan.newResidentIntentRequired!==true||plan.reuseOldIntent!==false||
  !samePath(plan.registry,store.root)||!samePath(plan.env?.INOPRO_DATA_DIR,store.root)||!samePath(plan.env?.INOPRO_SAVE_OBSERVER_PLAN,planPath)||
  !samePath(plan.targetProject,req.projectPath)||plan.expectedProjectSha256!==req.diskHash||
  !samePath(plan.fixedManifest,manifestPath)||!samePath(plan.workingDirectory,fixed)||!samePath(plan.serverPath,path.join(fixed,'dist/server.js'))||
  !samePath(plan.clientDirectory,path.join(base,'future-client'))||!samePath(plan.observationDirectory,path.join(base,'future-authorized-observation'))||
  !manifest||!samePath(manifest.fixed,fixed))fail('fixed plan/manifest selection differs');
 const {fixed:ignored,...contents}=manifest;
 if(digest(canonical(contents))!==reviewed.manifest)fail('reviewed fixed manifest changed');
 // The complete archived manifest is pinned. Only these five code roles govern
 // the inferred pre-snapshot path; no archived code is evaluated here.
 const raw=new Map<string,string>();
 const inspectFile=async(p:string,expected:string)=>{
  await regularFile(p);
  const bytes=await fs.readFile(p),hash=digest(bytes);
  if(hash!==expected)fail('fixed source changed');raw.set(p,hash);
 };
 for(const role of ['entry','core','host','observer','client'] as const){
  if(!samePath(plan[role+'Path'],paths[role])||plan[role+'Hash']!==reviewed[role])fail('fixed role selection differs');
  const relative=path.relative(fixed,paths[role]).split(path.sep).join('/');
  const rows=manifest.files.filter((f:any)=>f.path.replaceAll('\\','/')===relative);
  if(rows.length!==1||rows[0].sha256!==reviewed[role])fail('fixed role manifest incomplete');
  await inspectFile(paths[role],reviewed[role]);
 }
 // A complete exact traceback, including source lines, proves the reviewed
 // base _owned/validate_owned_projects returned BEFORE observer installation.
 // It does not reveal handle/primary/all values or prove a successful snapshot.
 const traceback='Traceback (most recent call last):\n'+
  `  File "${paths.core}", line 447, in handle\n    before=self.adapter.snapshot();disk=self.disk_hash();deps=dependencies(before)\n`+
  `  File "${paths.core}", line 181, in snapshot\n    self._owned();nodes={};objects={};apps=[]\n`+
  `  File "${paths.entry}", line 67, in _owned\n    self.save_observer = observer['install'](self.project, binding, publish, fallback,\n`+
  `  File "${paths.observer}", line 146, in install\n    from _3S.CoDeSys.Core import SystemInstances\n`+
  'ImportError: No module named _3S.CoDeSys.Core\n';
 if(first.traceback!==traceback)fail('complete reviewed control-flow traceback differs');
 const evidence={scheme:'legacy-fixed-control-flow',nativeRawOwnershipAvailable:false,ownershipValidationReturnedByInference:true,
  snapshotSucceeded:false,priorOutcome:'unknown',requestHash:residentHash(req),resultHash:residentHash(result),
  tracebackHash:digest(traceback),planHash:residentHash(plan),manifestHash:residentHash(manifest),
  metadataBytes:Object.fromEntries(metadataBytes),
  sources:Object.fromEntries(raw)};
 const recheck=async()=>{
  for(const [p,hash] of metadataBytes){
   await regularFile(p);
   if(digest(await fs.readFile(p))!==hash)fail('fixed metadata bytes changed during recheck');
  }
  for(const [p,hash] of raw)await inspectFile(p,hash);
 };
 return {ownershipHash:residentHash(evidence),evidence,recheck};
}
