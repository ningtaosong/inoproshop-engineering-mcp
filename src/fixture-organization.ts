import {randomUUID} from 'node:crypto';
import {canonical,codeHash,digest,atomicJson} from './storage.js';
import {FOLDER_NATIVE,ORGANIZATION_SCHEME,organizationVersion} from './organization.js';
import {reply} from './contracts.js';
import {promises as fs} from 'node:fs';
import path from 'node:path';
export function fixtureOrganization(p:any,aid:string){
 const app=p.applications.find((a:any)=>a.applicationId===aid);if(!app)throw Error('Application missing');
 const rows=[{objectId:aid,parentId:null,name:app.path.at(-1),path:app.path,nativeTypeId:'6396f47c-0382-45c1-b8b6-42db71c19a6b',isFolder:false,sourceHash:null},...(p.folders??[]).filter((f:any)=>f.applicationId===aid).map(({applicationId,...f}:any)=>f),...p.objects.filter((o:any)=>o.applicationId===aid).map((o:any)=>({objectId:o.objectId,parentId:o.parentId??(p.folders??[]).find((f:any)=>canonical(f.path)===canonical(o.path.slice(0,-1)))?.objectId??aid,name:o.path.at(-1),path:o.path,nativeTypeId:o.nativeTypeId??'6f9dac99-8de1-4efc-8465-68ac443b7d08',isFolder:false,sourceHash:codeHash(o.declaration,o.implementation)}))].sort((a,b)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0);
 const v={scheme:ORGANIZATION_SCHEME,applicationId:aid,nodes:rows,version:''};v.version=organizationVersion(v);return v;
}
export async function fixtureOrganize(p:any,req:any,dir:string,snapshot:()=>string,taskInventory:()=>any){
 const a=req.args,moving=req.command==='move_object',before=fixtureOrganization(p,a.applicationId),reject=(status:any,code:string)=>({...reply(status,code),error:{code,message:'Fixture rejection; no write'}});
 const container=(id:string)=>before.nodes.find(n=>n.objectId===id&&(id===a.applicationId||n.isFolder&&n.parentId===a.applicationId));
 if(a.expectedStructureVersion!==before.version)return reject('conflict','ORGANIZATION_VERSION_CHANGED');
 const target=container(moving?a.targetParentId:a.parentId),object=p.objects.find((o:any)=>o.objectId===a.objectId&&o.applicationId===a.applicationId),source=before.nodes.find(n=>n.objectId===a.objectId);
 if(!target||!moving&&a.parentId!==a.applicationId||moving&&(!source||!container(a.sourceParentId)||source.parentId!==a.sourceParentId))return reject('unsupported','ORGANIZATION_TARGET_OR_PERMISSION');
 if(moving&&a.sourceParentId!==a.applicationId&&a.targetParentId!==a.applicationId&&a.sourceParentId!==a.targetParentId)return reject('unsupported','ROOT_FOLDER_ONLY');
 if(moving&&(!object||!/^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+[A-Za-z_]/i.test(object.declaration)||!['st_pou','function_block',undefined].includes(object.objectType)))return reject('unsupported','ORGANIZATION_TARGET_OR_PERMISSION');
 if(p.organizationReadOnly||object?.readOnly||p.organizationPermissionDenied)return reject('unsupported','ORGANIZATION_TARGET_OR_PERMISSION');
 const name=moving?source!.name:a.name;if(before.nodes.some(n=>n.parentId===target.objectId&&n.objectId!==a.objectId&&n.name.toLowerCase()===name.toLowerCase()))return reject('conflict','ORGANIZATION_NAME_EXISTS');
 const changed=!moving||a.sourceParentId!==a.targetParentId,taskBefore=taskInventory();if(!taskBefore.coverageComplete)return reject('unsupported','ORGANIZATION_TASK_COVERAGE');
 if(changed)await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));
 let id=a.objectId;
 if(changed&&moving){const old=object.path,next=[...target.path,name];for(const o of p.objects)if(canonical(o.path.slice(0,old.length))===canonical(old)){o.path=[...next,...o.path.slice(old.length)];if(o.parentPath)o.parentPath=o.path.slice(0,-1);if(o.propertyPath)o.propertyPath=[...next,...o.propertyPath.slice(old.length)];}object.parentId=target.objectId;}
 if(changed&&!moving){id=randomUUID();(p.folders??=[]).push({applicationId:a.applicationId,objectId:id,parentId:a.parentId,name,path:[...target.path,name],nativeTypeId:FOLDER_NATIVE,isFolder:true,sourceHash:null});}
 if(changed)await atomicJson(req.projectPath,p);
 const after=fixtureOrganization(p,a.applicationId),row=after.nodes.find(n=>n.objectId===id),full=moving?{...object,nativeTypeId:row!.nativeTypeId,contentHash:row!.sourceHash,pouType:/^\s*FUNCTION_BLOCK\b/i.test(object.declaration)?'function_block':/^\s*FUNCTION\b/i.test(object.declaration)?'function':'program'}:row;
 const d={projectId:a.projectId,applicationId:a.applicationId,changed,noOp:!changed,reopened:changed,beforeStructure:before,afterStructure:after,taskBefore,taskAfter:taskInventory(),snapshot:snapshot(),object:full,actions:changed?[{action:moving?'move':'create_folder',status:'returned'}]:[],...(changed?{checkpoint:path.join(dir,'checkpoint.project'),persistedToWorkingCopy:true}:{})};
 if(p.organizationFailure)return {...reply('unknown','Fixture partial native/save/reopen/readback failure',{...d,stage:p.organizationFailure,automaticRollback:false}),error:{code:'ORGANIZATION_INCOMPLETE',message:'Preserved partial result'}};
 return reply('succeeded','Fixture native organization; not real IDE evidence',d);
}
