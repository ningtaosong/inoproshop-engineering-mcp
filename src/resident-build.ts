import path from 'node:path';
import {readJson} from './storage.js';
import {residentDependencies,residentHash} from './resident.js';

const eq=(a:any,b:any)=>residentHash(a)===residentHash(b);
const DEVICE='225bfe47-7336-4dbc-9419-4105a7c831fa';
const ROOT={type:'4102',id:'10f4 0002',version:'3.5.11.11'};
const DERIVED={type:'40005',id:'10F4 0005',version:'00.00.00.10'};
const PORTS=[{id:1,role:'Child',interface:'Common.PCI',hostPath:-1},{id:2,role:'Parent',interface:'Inovance:System',hostPath:1}];
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
export function buildConservation(before:any,after:any,pre:any,post:any){
 residentDependencies(before);residentDependencies(after);validateBuildContext(before,pre);validateBuildContext(after,post);
 const old=before.nodes,next=after.nodes,added=Object.keys(next).filter(k=>!old[k]).sort();
 if(added.length>1)throw Error('Unexplained compiler-generated nodes');
 for(const [id,row] of Object.entries(old))if(!next[id]||!eq(row,next[id]))throw Error('Compiler changed existing node: '+id);
 for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(!['nodes','openedProjects'].includes(k)&&!eq(before[k],after[k]))throw Error('Build state changed: '+k);
 for(const [id,d] of Object.entries(pre.devices))if(!eq(d,post.devices[id]))throw Error('Existing device/connector changed');
 if(!eq(Object.keys(post.devices).filter(k=>!pre.devices[k]).sort(),added))throw Error('Additional device coverage differs');
 if(added.length){
  const id=added[0],r=next[id],parent=old[r.parentId];
  const expected={objectId:id,path:parent?[...parent.path,'HwConfiguratioinDevice']:[],parentId:r.parentId,nativeTypeId:DEVICE,applicationId:null,declaration:null,implementation:null,embeddedObjectTypes:[]};
  if(!parent||parent.parentId!==null||!eq(pre.devices[r.parentId]?.identity,ROOT)||!eq(r,expected)||!eq(post.devices[id],{identity:DERIVED,connectors:PORTS})||Object.values<any>(pre.devices).some(d=>eq(d.identity,DERIVED))||!eq(post.children[id],[]))throw Error('Unproven compiler-derived device');
 }
 for(const [p,ids] of Object.entries(pre.children))if(!eq(post.children[p].filter((id:string)=>!added.includes(id)),ids))throw Error('Compiler reordered existing siblings');
 return {passed:true,addedDeviceIds:added,sourceUnchanged:true,directLibrariesUnchanged:true,taskCallsUnchanged:true};
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
 const proof=buildConservation(before.state,after.state,context,after.buildContext),counts=checkedDiagnostics(compiler,aid);
 if(!eq(check,proof)||!eq(data.buildConservation,proof)||data.builtSourceVersion!==sourceVersion||buildSourceVersion(after.state,aid)!==sourceVersion||data.buildInputResidentVersion!==version||data.buildEvidenceScope!=='resident-memory'||data.persistedToProject!==false||data.persistedToWorkingCopy!==false||data.compilerResultHash!==residentHash(compiler)||data.targetKind!=='application'||data.completed!==true||data.diagnosticsComplete!==true||!eq(data.diagnostics,compiler.diagnostics))throw Error('Build memory/source/diagnostics binding differs');
 for(const [key,value] of Object.entries(counts))if(data[key]!==value)throw Error('Compiler result differs: '+key);
 return after.state;
}
