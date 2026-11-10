import {canonical,digest,codeHash} from './storage.js';
import {DomainError,type Reply} from './contracts.js';
export const ORGANIZATION_SCHEME='application-organization-v1';
export const FOLDER_NATIVE='738bea1e-99bb-4f04-90bb-a7a567e74e3a';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
export function organizationVersion(v:any) {return digest(canonical([ORGANIZATION_SCHEME,v.applicationId,v.nodes]));}
export function verifyOrganization(v:any) {
  if(v?.scheme!==ORGANIZATION_SCHEME||!uuid.test(v.applicationId)||!Array.isArray(v.nodes)||!v.nodes.length||v.nodes.length>20000||v.version!==organizationVersion(v))throw Error('Invalid structure version');
  const ids=new Set(v.nodes.map((n:any)=>n.objectId));
  if(ids.size!==v.nodes.length||canonical(v.nodes)!==canonical([...v.nodes].sort((a,b)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0)))throw Error('Duplicate/unsorted structure identity');
  for(const n of v.nodes){
    if(!uuid.test(n.objectId)||!uuid.test(n.nativeTypeId)||typeof n.name!=='string'||!Array.isArray(n.path)||n.path.some((p:any)=>typeof p!=='string')||n.path.at(-1)!==n.name||typeof n.isFolder!=='boolean'||n.isFolder!==(n.nativeTypeId===FOLDER_NATIVE)||n.sourceHash!==null&&!hash.test(n.sourceHash))throw Error('Invalid native structure row');
    if(n.objectId===v.applicationId){if(n.parentId!==null)throw Error('Application parent invalid');}
    else {const p=v.nodes.find((p:any)=>p.objectId===n.parentId);if(!p||canonical(n.path.slice(0,-1))!==canonical(p.path))throw Error('Structure parent/path mismatch');}
    let p=n,seen=new Set();while(p.parentId!==null){if(seen.has(p.objectId))throw Error('Structure cycle');seen.add(p.objectId);p=v.nodes.find((r:any)=>r.objectId===p.parentId);if(!p)throw Error('Missing structure ancestor');}
    if(p.objectId!==v.applicationId)throw Error('Cross-Application structure');
  }
}
export function organizationResult(raw:Reply,a:any,tool:string):Reply {
  if(raw.status!=='succeeded')return raw;
  try{
    const d=raw.data as any,b=d.beforeStructure,c=d.afterStructure;verifyOrganization(b);verifyOrganization(c);
    if(b.applicationId!==a.applicationId||c.applicationId!==a.applicationId||b.version!==a.expectedStructureVersion||d.applicationId!==a.applicationId||d.projectId!==a.projectId||d.taskBefore?.coverageComplete!==true||d.taskBefore?.projectId!==a.projectId||d.taskBefore?.applicationId!==a.applicationId)throw Error('Bound evidence differs');
    const expected=structuredClone(b.nodes),container=(id:string)=>{const r=expected.find((n:any)=>n.objectId===id);if(!r||!(id===a.applicationId||r.isFolder&&r.parentId===a.applicationId))throw Error('Unsupported container');return r;};
    let target:any,changed:boolean;
    if(tool==='folder_create'){
      target=container(a.parentId);if(a.parentId!==a.applicationId)throw Error('Nested folder creation');
      if(expected.some((n:any)=>n.parentId===a.parentId&&n.name.toLowerCase()===a.name.toLowerCase()))throw Error('Name collision');
      const row=d.object;if(!row||b.nodes.some((n:any)=>n.objectId===row.objectId)||row.name!==a.name||row.parentId!==a.parentId||row.nativeTypeId!==FOLDER_NATIVE||row.isFolder!==true||row.sourceHash!==null||canonical(row.path)!==canonical([...target.path,a.name]))throw Error('Folder evidence mismatch');expected.push(row);changed=true;
    }else{
      target=container(a.targetParentId);container(a.sourceParentId);const source=expected.find((n:any)=>n.objectId===a.objectId);
      if(a.sourceParentId!==a.applicationId&&a.targetParentId!==a.applicationId&&a.sourceParentId!==a.targetParentId)throw Error('Only root-folder moves supported');
      if(!source||source.parentId!==a.sourceParentId||source.nativeTypeId!=='6f9dac99-8de1-4efc-8465-68ac443b7d08'||!source.sourceHash||d.object?.objectId!==a.objectId||!['program','function','function_block'].includes(d.object?.pouType))throw Error('Source evidence mismatch');
      if(expected.some((n:any)=>n.parentId===target.objectId&&n.objectId!==a.objectId&&n.name.toLowerCase()===source.name.toLowerCase()))throw Error('Name collision');
      changed=a.sourceParentId!==a.targetParentId;const old=source.path,next=[...target.path,source.name];
      for(const n of expected)if(canonical(n.path.slice(0,old.length))===canonical(old))n.path=[...next,...n.path.slice(old.length)];source.parentId=a.targetParentId;
      if(canonical(d.object.path)!==canonical(next)||d.object.contentHash!==source.sourceHash||d.object.applicationId!==a.applicationId||d.object.nativeTypeId!==source.nativeTypeId||typeof d.object.declaration!=='string'||typeof d.object.implementation!=='string'||codeHash(d.object.declaration,d.object.implementation)!==source.sourceHash)throw Error('Moved object source/path differs');
    }
    expected.sort((a:any,b:any)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0);
    const expectedTask=structuredClone(d.taskBefore);
    if(tool==='object_move')for(const p of expectedTask.programs??[])if(p.objectId===a.objectId)p.path=d.object.path;
    // PROGRAM enumeration order is not task call order. Keep all identities and
    // expected paths, but compare this derived catalog by GUID. Raw task calls
    // and every other task field retain their original order and exact values.
    const actualTask=structuredClone(d.taskAfter),sortPrograms=(v:any)=>{v.programs?.sort((a:any,b:any)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0);};sortPrograms(expectedTask);sortPrograms(actualTask);
    if(canonical(expectedTask)!==canonical(actualTask))throw Error('Readable tasks or unrelated PROGRAM identities changed');
    if(canonical(expected)!==canonical(c.nodes)||d.changed!==changed||d.noOp===changed||d.reopened!==changed||!Array.isArray(d.actions)||d.actions.length!==(changed?1:0)||changed&&d.actions[0].status!=='returned'||!changed&&b.version!==c.version)throw Error('Unrelated structure/source changed or no-op evidence inconsistent');
    const {beforeStructure,afterStructure,taskBefore,taskAfter,...rest}=d;
    return {...raw,data:{...rest,structureVersion:c.version,structuralEvidence:{scheme:ORGANIZATION_SCHEME,beforeVersion:b.version,afterVersion:c.version,verified:true,sourceAndChildrenPreserved:true,readableTasksPreserved:true,beforeNodeCount:b.nodes.length,afterNodeCount:c.nodes.length},buildApplicable:false}};
  }catch(e:any){throw new DomainError('unknown','ORGANIZATION_EVIDENCE_INVALID','结构/GUID/父链/源码或任务证据无法确认，保留现场：'+e.message);}
}
