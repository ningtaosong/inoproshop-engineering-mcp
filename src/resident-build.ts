import path from 'node:path';
import {readJson} from './storage.js';
import {residentDependencies,residentHash} from './resident.js';

const eq=(a:any,b:any)=>residentHash(a)===residentHash(b);
const DEVICE='225bfe47-7336-4dbc-9419-4105a7c831fa';
const ROOT={type:'4102',id:'10f4 0002',version:'3.5.11.11'};
const DERIVED={type:'40005',id:'10F4 0005',version:'00.00.00.10'};
const PORTS=[{id:1,role:'Child',interface:'Common.PCI',hostPath:-1},{id:2,role:'Parent',interface:'Inovance:System',hostPath:1}];
export const COMPILER_LIBRARY_ARTIFACTS:Record<string,string>={
 'InoSymbolObject.plugin':'91e06b3aa1548a4076535cf68df3bb2f41c9445e7c196a553687c50b9d609c48',
 'InoLibManObject.plugin':'7fbdf3fd2728e19e737fa3b672da89d4ec9582efc3060ef896a5b44a62b111a6'};
const IEC_COMPILER_REFERENCE={is_redirected:false,explicit_redirection:null,is_managed:false,is_placeholder:true,
 name:'#IecVarAccess',optional:false,qualified_only:false,effective_resolution:'IecVarAccess, 3.5.11.0 (System)',
 resolution_info:'库配置文件解析',default_resolution:'IecVarAccess, 3.3.1.20 (System)',resolver_guid:'b303f5ce-75ff-4668-a777-7da8debb449c',
 namespace:'IecVarAccessLibrary',system_library:true,placeholder_name:'IecVarAccess'};
export function checkedCompilerLibrarySupport(p:any){
 if(!p||!eq(Object.keys(p).sort(),['assemblies','scheme'])||p.scheme!=='resident-compiler-library-support-v1'||!Array.isArray(p.assemblies)||p.assemblies.length!==2||!eq(p.assemblies.map((r:any)=>r.name).sort(),Object.keys(COMPILER_LIBRARY_ARTIFACTS).sort()))throw Error('Compiler library support evidence missing');
 for(const r of p.assemblies)if(!eq(Object.keys(r).sort(),['name','path','sha256','version'])||r.version!=='1.9.1.6'||typeof r.path!=='string'||!r.path||r.sha256!==COMPILER_LIBRARY_ARTIFACTS[r.name])throw Error('Unverified compiler library implementation');
 return residentHash(p);
}
function compilerReferenceAddition(before:any,after:any,pre:any,aid:string|undefined,support:any){
 checkedCompilerLibrarySupport(support);
 if(!aid||!before.applications.includes(aid))throw Error('Compiler library Application differs');
 const managers=Object.values<any>(before.nodes).filter(r=>r.applicationId===aid&&r.nativeTypeId==='adb5cb65-8e1d-4a00-b70a-375ea27582f3');
 const changed=Object.keys(before.nodes).filter(id=>!eq(before.nodes[id],after.nodes[id]));
 if(managers.length!==1||!eq(changed,[managers[0].objectId]))throw Error('Compiler library change is not confined to unique Application manager');
 const m=managers[0],updated=after.nodes[m.objectId];if(m.parentId!==aid)throw Error('Compiler library manager is not Application child');
 let root=before.nodes[aid];const visited=new Set();
 while(root.parentId!==null){if(visited.has(root.objectId))throw Error('Cyclic Application ancestry');visited.add(root.objectId);root=before.nodes[root.parentId];}
 if(!eq(pre.devices[root.objectId]?.identity,ROOT))throw Error('Compiler library change outside verified AM610');
 const {directLibraries:old,...rest}=m,{directLibraries:next,...updatedRest}=updated;
 if(!eq(rest,updatedRest))throw Error('Compiler changed library manager fields');
 if(!Array.isArray(old)||!Array.isArray(next)||next.length!==old.length+1||!eq(next.slice(0,-1),old))throw Error('Compiler changed original library references/order');
 const ids=new Set();for(const r of next){if(typeof r.id!=='string'||!/^\d+$/.test(r.id)||BigInt(r.id)<=0n||ids.has(r.id))throw Error('Invalid or duplicate native reference identity');ids.add(r.id);}
 if(old.some(r=>(r.name??'').toLowerCase()==='#iecvaraccess'||(r.placeholder_name??'').toLowerCase()==='iecvaraccess'))throw Error('Compiler dependency already present');
 const {id,...ref}=next.at(-1);if(!eq(ref,IEC_COMPILER_REFERENCE))throw Error('Unexpected compiler library reference');
 return {libraryManagerId:m.objectId,applicationId:aid,index:old.length,reference:next.at(-1),supportHash:residentHash(support)};
}
export function buildSourceVersion(s:any,aid:string){return residentHash({applicationId:aid,projectPath:s.projectPath,projectHandle:s.projectHandle,sources:Object.fromEntries(Object.entries<any>(s.nodes).filter(([,r])=>r.declaration!==null||r.implementation!==null))});}
export function residentBuildApplies(session:any,data:any){
 const b=session?.lastBuild,launch=data?.residentEvidence?.launchId;
 return !!b&&typeof launch==='string'&&b.buildEvidenceScope==='resident-memory'&&b.completed===true&&b.diagnosticsComplete===true&&b.residentEvidence?.launchId===launch&&b.residentVersion===data.residentVersion&&b.snapshot===data.snapshot&&b.diskHash===data.diskHash&&b.applicationId===session.applicationId;
}
export function buildStateView(s:any){residentDependencies(s);const {openedProjects,...view}=s;return view;}
export function validateBuildContext(s:any,c:any){
 if(c?.scheme!=='resident-build-context-v1'||!eq(Object.keys(c).sort(),['children','devices','scheme'])||!c.children||!c.devices||!eq(Object.keys(c.children).sort(),[...Object.keys(s.nodes),'$project'].sort()))throw Error('Build tree coverage incomplete');
 const seen:string[]=[];
 for(const [parent,ids] of Object.entries<any>(c.children)){
  if(!Array.isArray(ids))throw Error('Unordered build children');
  for(const id of ids){if(!s.nodes[id]||s.nodes[id].parentId!==(parent==='$project'?null:parent))throw Error('Build ancestry differs');seen.push(id);}
 }
 if(new Set(seen).size!==seen.length||!eq(seen.sort(),Object.keys(s.nodes).sort()))throw Error('Duplicate/missing build tree identity');
 if(!eq(Object.keys(c.devices).sort(),Object.keys(s.nodes).filter(k=>s.nodes[k].nativeTypeId===DEVICE).sort()))throw Error('Device coverage differs');
 for(const d of Object.values<any>(c.devices)){
  if(!eq(Object.keys(d).sort(),['connectors','identity'])||!eq(Object.keys(d.identity??{}).sort(),['id','type','version'])||Object.values(d.identity).some(x=>typeof x!=='string'||!x)||!Array.isArray(d.connectors))throw Error('Incomplete device identity');
  const ids=[];
  for(const p of d.connectors){if(!eq(Object.keys(p).sort(),['hostPath','id','interface','role'])||!Number.isSafeInteger(p.id)||!Number.isSafeInteger(p.hostPath)||typeof p.interface!=='string'||typeof p.role!=='string')throw Error('Incomplete connector');ids.push(p.id);}
  if(new Set(ids).size!==ids.length)throw Error('Duplicate connector');
 }
}
export function buildConservation(before:any,after:any,pre:any,post:any,aid?:string,support?:any){
 residentDependencies(before);residentDependencies(after);validateBuildContext(before,pre);validateBuildContext(after,post);
 const old=before.nodes,next=after.nodes,added=Object.keys(next).filter(k=>!old[k]).sort();
 if(added.length>1)throw Error('Unexplained compiler-generated nodes');
 for(const id of Object.keys(old))if(!next[id])throw Error('Compiler removed original node: '+id);
 const changed=Object.keys(old).filter(id=>!eq(old[id],next[id])),libraryAdditions:any[]=[];
 if(changed.length){if(!support)throw Error('Compiler changed existing node: '+changed[0]);libraryAdditions.push(compilerReferenceAddition(before,after,pre,aid,support));}
 for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(!['nodes','openedProjects'].includes(k)&&!eq(before[k],after[k]))throw Error('Build state changed: '+k);
 for(const [id,d] of Object.entries(pre.devices))if(!eq(d,post.devices[id]))throw Error('Existing device/connector changed');
 if(!eq(Object.keys(post.devices).filter(k=>!pre.devices[k]).sort(),added))throw Error('Additional device coverage differs');
 if(added.length){
  const id=added[0],r=next[id],parent=old[r.parentId];
  const expected={objectId:id,path:parent?[...parent.path,'HwConfiguratioinDevice']:[],parentId:r.parentId,nativeTypeId:DEVICE,applicationId:null,declaration:null,implementation:null,embeddedObjectTypes:[]};
  if(!parent||parent.parentId!==null||!eq(pre.devices[r.parentId]?.identity,ROOT)||!eq(r,expected)||!eq(post.devices[id],{identity:DERIVED,connectors:PORTS})||Object.values<any>(pre.devices).some(d=>eq(d.identity,DERIVED))||!eq(post.children[id],[]))throw Error('Unproven compiler-derived device');
 }
 for(const [p,ids] of Object.entries(pre.children))if(!eq(post.children[p].filter((id:string)=>!added.includes(id)),ids))throw Error('Compiler reordered existing siblings');
 return {passed:true,addedDeviceIds:added,sourceUnchanged:true,directLibrariesUnchanged:!libraryAdditions.length,taskCallsUnchanged:true,
  ...(libraryAdditions.length?{originalDirectLibrariesUnchanged:true,compilerAddedDirectLibraries:libraryAdditions}:{})};
}
export function checkedDiagnostics(v:any,aid:string){
 if(v?.applicationId!==aid||v.completed!==true||v.diagnosticsComplete!==true||!Array.isArray(v.categories)||!v.categories.length||!Array.isArray(v.diagnostics))throw Error('Incomplete compiler invocation/diagnostics');
 const keys=v.categories.map((g:any)=>g.category);
 if(new Set(keys).size!==keys.length)throw Error('Duplicate compiler category');
 for(const g of v.categories)if(typeof g.category!=='string'||!g.category||g.endObserved!==true||!Number.isSafeInteger(g.count)||g.count!==v.diagnostics.filter((r:any)=>r.category===g.category).length)throw Error('Compiler category incomplete');
 for(const r of v.diagnostics)if(!keys.includes(r.category)||!['fatalerror','error','warning','information','text'].includes(r.severity)||typeof r.text!=='string')throw Error('Invalid compiler diagnostic');
 const errorCount=v.diagnostics.filter((r:any)=>['fatalerror','error'].includes(r.severity)).length,warningCount=v.diagnostics.filter((r:any)=>r.severity==='warning').length;
 return {errorCount,warningCount,buildPassed:errorCount===0};
}
export async function verifyResidentBuild(request:any,data:any,directory:string,before:any,version:string){
 const get=(n:string)=>readJson(path.join(directory,n+'.json'));
 const [context,checkpoint,pre,after,check,dispatch,compiler,cleared,called,returned,observed,input]=await Promise.all(['build-context-before','checkpoint','predispatch','after','verification','dispatch','compiler-result','diagnostics-cleared','build-call','build-returned','build-after-state','build-input'].map(get));
 const aid=request.args.applicationId,sourceVersion=buildSourceVersion(before.state,aid);
 if(request.args.expectedResidentVersion!==version||(request.args.targetKind??'application')!=='application'||!before.state.applications.includes(aid))throw Error('Build precondition differs');
 if(!eq(checkpoint,{request,state:before.state,diskHash:before.diskHash,residentVersion:version})||!eq(buildStateView(pre?.state),buildStateView(before.state))||pre.diskHash!==before.diskHash||!eq(pre.buildContext,context))throw Error('Build checkpoint/predispatch differs');
 if(!eq(buildStateView(input?.state),buildStateView(before.state))||input.diskHash!==before.diskHash||!eq(input.buildContext,context))throw Error('Actual build input memory differs');
 if(!eq(dispatch,{operationId:request.operationId,requestId:request.requestId,action:'build-application',applicationId:aid,inputResidentVersion:version,sourceVersion})||!Array.isArray(cleared?.categories)||cleared.categories.some((x:any)=>typeof x!=='string'))throw Error('Build dispatch/diagnostic clearing differs');
 if(after?.diskHash!==before.diskHash||!eq(called,{applicationId:aid})||!eq(returned,called)||!eq(observed,{state:after.state,diskHash:before.diskHash}))throw Error('Build return/state/disk evidence differs');
 const support=await get('compiler-library-support-before');
 const proof=buildConservation(before.state,after.state,context,after.buildContext,aid,support),counts=checkedDiagnostics(compiler,aid);
 if(proof.compilerAddedDirectLibraries){
  if(!eq(support,await get('compiler-library-support-after')))throw Error('Compiler library implementation changed during build');
 }
 if(!eq(check,proof)||!eq(data.buildConservation,proof)||data.builtSourceVersion!==sourceVersion||buildSourceVersion(after.state,aid)!==sourceVersion||data.buildInputResidentVersion!==version||data.buildEvidenceScope!=='resident-memory'||data.persistedToProject!==false||data.persistedToWorkingCopy!==false||data.compilerResultHash!==residentHash(compiler)||data.targetKind!=='application'||data.completed!==true||data.diagnosticsComplete!==true||!eq(data.diagnostics,compiler.diagnostics))throw Error('Build memory/source/diagnostics binding differs');
 for(const [key,value] of Object.entries(counts))if(data[key]!==value)throw Error('Compiler result differs: '+key);
 return after.state;
}
