import {canonical} from './storage.js';
import {DomainError} from './contracts.js';
import {completePlaceholderInventory,libraryConfigurationVersion,placeholderConfigurationVersion,LIB_CONFIG_SCHEME,LIB_PLACEHOLDER_SCHEME} from './libraries.js';
import {taskCallInventoryView,taskCallDifference} from './task-config.js';

export const CLEAR_DEFAULT='CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)';
export const CLEAR_OVERRIDE='CAA Mathematics, 3.5.7.0 (CAA Technical Workgroup)';
const allowed=['explicit_redirection','is_redirected','effective_resolution','resolution_info'];
const guid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function requireClear(ok:unknown,message:string):asserts ok {
  if(!ok)throw new DomainError('unknown','PLACEHOLDER_CLEAR_EVIDENCE',message);
}
export function clearTarget(inventory:any,a:any,redirected:boolean,paged=false):any {
  requireClear(completePlaceholderInventory(inventory,paged),'Incomplete native library inventory');
  requireClear(inventory.projectId===a.projectId&&inventory.applicationId===a.applicationId&&inventory.targetKind==='application'&&
    inventory.managers.length===1&&inventory.managers[0].managerId===a.managerId&&
    inventory.managers[0].path.length===inventory.applicationPath.length+1,'Library owner/manager changed');
  requireClear(inventory.referenceVersionScheme===LIB_CONFIG_SCHEME&&inventory.placeholderVersionScheme===LIB_PLACEHOLDER_SCHEME,'Unknown library version scheme');
  if(!paged)requireClear(inventory.configurationVersion===libraryConfigurationVersion(inventory)&&
    inventory.placeholderConfigurationVersion===placeholderConfigurationVersion(inventory),'Library version not reproducible');
  const ids=new Set(),names=new Set();
  for(const row of inventory.references){
    const f=row.rawFields,key=row.managerId+':'+f.id;
    requireClear(!ids.has(key),'Duplicate reference identity');ids.add(key);
    if(f.is_placeholder){
      for(const k of ['placeholder_name','default_resolution','effective_resolution','resolution_info','explicit_redirection','resolver_guid'])
        requireClear(Object.hasOwn(f,k)&&(f[k]===null||typeof f[k]==='string'),'Missing/invalid native field '+k);
      requireClear(typeof f.is_redirected==='boolean'&&typeof f.placeholder_name==='string'&&f.placeholder_name.length,'Missing placeholder identity/flag');
      const name=row.managerId+':'+f.placeholder_name.toLowerCase();requireClear(!names.has(name),'Ambiguous placeholder name');names.add(name);
    }
  }
  const rows=inventory.references.filter((r:any)=>r.managerId===a.managerId&&r.rawFields.id===a.placeholderReferenceId);
  requireClear(rows.length===1,'Target native reference is not unique');const row=rows[0],f=row.rawFields;
  requireClear(f.is_placeholder===true&&f.is_managed===false&&f.system_library===false&&f.optional===false&&f.qualified_only===false&&
    f.placeholder_name==='CAA Mathematics'&&f.name==='#CAA Mathematics'&&f.namespace==='MATH'&&f.default_resolution===CLEAR_DEFAULT,'Outside tested ordinary CAA Mathematics scope');
  if(redirected)requireClear(a.expectedExplicitRedirection===CLEAR_OVERRIDE&&f.explicit_redirection===CLEAR_OVERRIDE&&f.is_redirected===true&&
    f.effective_resolution===CLEAR_OVERRIDE,'Explicit override absent/changed');
  else requireClear(f.explicit_redirection===null&&f.is_redirected===false,'Clear is not native null/false');
  requireClear(row.resolutionStatus===(f.effective_resolution?'effective-resolution-reported':'unknown'),'Native derived field is inconsistent');
  return row;
}
export function clearResolution(row:any){
  const f=row.rawFields,v=f.effective_resolution;
  requireClear(Object.hasOwn(f,'effective_resolution')&&(v===null||typeof v==='string'),'Missing/invalid resolution');
  const valueState=v===null?'native-null':v===''?'empty-text':v==='None'?'literal-None':'text';
  return {status:valueState==='text'?'native-resolution-reported':'native-unresolved',effectiveResolution:v,
    resolutionInfo:f.resolution_info,resolverGuid:f.resolver_guid,valueState,
    source:'native effective_resolution / resolution_info / resolver_guid',loadedStatus:'not-independently-verified'};
}
function stateView(s:any,a:any){
  const n=s?.nativeScope;
  requireClear(n?.ideVersion==='1.9.1.6'&&guid(n.deviceObjectId)&&n.applicationId===a.applicationId&&n.managerId===a.managerId&&
    canonical(n.controller)===canonical({type:4102,id:'10f4 0002',version:'3.5.11.11'})&&
    Array.isArray(n.devicePath)&&n.devicePath.length>0&&canonical([...n.devicePath,'Plc Logic'])===canonical(n.applicationPath?.slice(0,-1))&&
    canonical(n.applicationPath)===canonical(s.library.applicationPath),'Native scope unsupported or incomplete');
  requireClear(s.tasks&&typeof s.tasks==='object'&&!Array.isArray(s.tasks)&&Object.hasOwn(s.tasks,a.applicationId),'Task coverage missing');
  const tasks:Record<string,unknown>={};
  for(const [id,t] of Object.entries<any>(s.tasks)){
    const view=taskCallInventoryView(t);
    requireClear(guid(id)&&t.applicationId===id&&t.projectId===a.projectId&&view,'Task evidence incomplete');tasks[id]=view;
  }
  requireClear(Array.isArray(s.sources)&&hash(s.snapshot),'Source coverage missing');const ids=new Set();
  for(const r of s.sources){
    requireClear(guid(r.objectId)&&!ids.has(r.objectId.toLowerCase())&&Array.isArray(r.path)&&r.path.length>0&&
      guid(r.nativeTypeId)&&Object.hasOwn(r,'applicationId')&&['declaration','implementation'].every(k=>Object.hasOwn(r,k)&&(r[k]===null||typeof r[k]==='string')),
      'Source evidence invalid');ids.add(r.objectId.toLowerCase());
    if(r.nativeTypeId==='6f9dac99-8de1-4efc-8465-68ac443b7d08')requireClear(Array.isArray(r.embeddedObjectTypes)&&r.embeddedObjectTypes.every(guid),'Native POU language evidence missing');
  }
  return {...s,tasks};
}
export function clearStateDifference(before:any,after:any,a:any,allowClear=false){
  const target=clearTarget(after.library,a,!allowClear),expected=structuredClone(before);
  if(allowClear){
    const row=expected.library.references[target.index];requireClear(!!row,'Target index invalid');
    for(const key of allowed)row.rawFields[key]=target.rawFields[key];
    row.resolutionStatus=target.resolutionStatus;
    expected.library.configurationVersion=libraryConfigurationVersion(expected.library);
    expected.library.placeholderConfigurationVersion=placeholderConfigurationVersion(expected.library);
  }
  return taskCallDifference(stateView(expected,a),stateView(after,a));
}
export function validateClearResult(d:any,a:any,session:any,checkpoint:string){
  requireClear(d?.projectId===a.projectId&&d.applicationId===a.applicationId&&d.managerId===a.managerId&&d.placeholderReferenceId===a.placeholderReferenceId&&
    d.changed===true&&d.cleared===true&&d.reopened===true&&d.buildApplicable===false&&d.checkpoint===checkpoint&&
    (session.editMode==='direct'?d.persistedToProject===true:d.persistedToWorkingCopy===true)&&
    hash(d.snapshot)&&d.snapshot===session.snapshot&&hash(d.diskHash)&&d.diskHash!==a.expectedDiskHash&&
    d.postExitDiskHashObserved===true&&d.workerDiskHash===d.diskHash,'Missing clear persistence/identity evidence');
  const old=clearTarget(d.before.library,a,true),immediate=clearTarget(d.immediate.library,a,false),after=clearTarget(d.after.library,a,false);
  requireClear(d.before.library.configurationVersion===a.expectedReferenceVersion&&
    d.before.library.placeholderConfigurationVersion===a.expectedPlaceholderVersion&&d.beforePlaceholderVersion===a.expectedPlaceholderVersion&&
    d.placeholderVersion===d.after.library.placeholderConfigurationVersion&&d.placeholderVersion!==a.expectedPlaceholderVersion&&
    d.before.snapshot===d.snapshot&&d.after.snapshot===d.snapshot,'Clear version mismatch');
  const differences={immediate:clearStateDifference(d.before,d.immediate,a,true)??null,
    after:clearStateDifference(d.before,d.after,a,true)??null,
    reopened:taskCallDifference(stateView(d.immediate,a),stateView(d.after,a))??null};
  requireClear(Object.values(differences).every(v=>v===null),'Clear preservation differs: '+JSON.stringify(differences));
  requireClear(canonical(d.targetBefore)===canonical(old)&&canonical(d.targetImmediate)===canonical(immediate)&&canonical(d.targetAfter)===canonical(after)&&
    canonical(d.resolution)===canonical(clearResolution(after)),'Target/resolution evidence mismatch');
  return differences;
}
