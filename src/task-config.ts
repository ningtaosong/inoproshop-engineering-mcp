import {canonical,digest} from './storage.js';
import {DomainError} from './contracts.js';

export const TASK_CONFIGURATION_SCHEME='task-configuration-v1';
export const TASK_CREATE_ST_IMPLEMENTATION_TYPE='3b83b776-fb25-43b8-99f2-3c507c9143fc';
export function isTaskAppendCall(row:unknown):row is [string,string] {
  return Array.isArray(row)&&row.length===2&&typeof row[0]==='string'&&row[0].length>0&&typeof row[1]==='string';
}

// task_create only: tasks are an identity set, while every nested array (especially
// rawCalls) remains ordered. Keep the original inventory and all unknown fields intact.
export function taskCreateInventoryView(inventory:any):any|undefined {
  const fields=['kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task'];
  const watchdog=['enabled','time','time_unit','sensitivity'];
  if(!Array.isArray(inventory?.tasks)||inventory.coverageComplete!==true||
     inventory.enumerationFailures?.length!==0||inventory.resolutionReadFailures?.length!==0)return;
  const entries=inventory.tasks;
  if(entries.some((t:any)=>!t||typeof t.taskId!=='string'||!t.taskId||
     !Array.isArray(t.path)||!t.path.length||t.path.some((x:unknown)=>typeof x!=='string'||!x)||
     t.callsComplete!==true||t.unavailableFields?.length!==0||
     !Array.isArray(t.rawCalls)||!t.rawCalls.every(isTaskAppendCall)||
     fields.some(k=>typeof t.rawFields?.[k]!=='string')||
     watchdog.some(k=>typeof t.watchdog?.[k]!=='string'))||
     new Set(entries.map((t:any)=>t.taskId)).size!==entries.length)return;
  return {...inventory,tasks:Object.fromEntries(entries.map((t:any)=>[t.taskId,t]))};
}

// The task version covers the full ordered inventory; the caller also identifies
// the exact raw row and both definitions. A qualified lookalike blocks the edit.
export function validReplacement(inv:any,a:any,old:any,next:any):boolean {
  const unique=(p:any)=>Array.isArray(p?.path)&&
    canonical(inv.programs.filter((x:any)=>x.path.at(-1)?.toLowerCase()===p.path.at(-1)?.toLowerCase()))===
    canonical([{objectId:p.objectId,path:p.path}]);
  const fields=['kind_of_task','priority','interval','interval_unit','event_pou_guid','event','external_event','core_binding','parent_synchron_task'];
  const watchdog=['enabled','time','time_unit','sensitivity'];
  if(inv.enumerationFailures?.length!==0||inv.resolutionReadFailures?.length!==0||
    inv.tasks.some((t:any)=>fields.some(k=>typeof t.rawFields?.[k]!=='string')||watchdog.some(k=>typeof t.watchdog?.[k]!=='string')))return false;
  if(!unique(old)||!unique(next)||old.objectId===next.objectId||inv.coverageComplete!==true||
     inv.tasks.some((t:any)=>!t.callsComplete||t.unavailableFields?.length!==0||!Array.isArray(t.rawCalls)||
       !t.rawCalls.every(isTaskAppendCall))||new Set(inv.tasks.map((t:any)=>t.taskId)).size!==inv.tasks.length)return false;
  const row=inv.tasks.find((t:any)=>t.taskId===a.taskId);
  if(row?.rawFields?.kind_of_task!=='Cyclic')return false;
  const calls=row.rawCalls as [string,string][], oldName=old.path.at(-1).toLowerCase(),newName=next.path.at(-1).toLowerCase();
  if(!calls.every(([name])=>/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)))return false;
  const names=calls.map(([name])=>name.split('.').at(-1)!.toLowerCase());
  return calls[a.expectedCallOrder]?.[0].toLowerCase()===oldName&&
    canonical(calls[a.expectedCallOrder])===canonical(a.expectedCall)&&
    names.filter(n=>n===oldName).length===1&&!names.includes(newName);
}

export function configuredIntervalMs(fields:any):number|undefined {
  if(fields?.interval_unit!=='ms')return;
  const m=/^(?:t#(\d+)ms|(\d+))$/i.exec(fields.interval??'');
  return m?Number(m[1]??m[2]):undefined;
}
// Native raw configuration only; independent of ST text and derived call resolution.
export function taskConfigurationVersion(d:any):string {
  return digest(canonical([TASK_CONFIGURATION_SCHEME,d.projectId,d.applicationId,
    [...d.tasks].sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0),d.enumerationFailures]));
}
export function validateTaskPatch(a:any) {
  if(a.intervalMs===undefined&&a.priority===undefined ||
    a.intervalMs!==undefined&&(!Number.isInteger(a.intervalMs)||a.intervalMs<1||a.intervalMs>60000) ||
    a.priority!==undefined&&(!Number.isInteger(a.priority)||a.priority<0||a.priority>31))
    throw new DomainError('failed','INVALID_TASK_PATCH','至少指定 intervalMs=1..60000 整数毫秒或 priority=0..31 整数；不支持其他任务字段');
}
export function buildApplies(s:any,d:any):boolean {
  const b=s?.lastBuild;
  return !!b&&b.applicationId===s.applicationId&&(b.targetKind||'application')===(s.targetKind||'application')&&
    b.snapshot===d.snapshot&&b.diskHash===d.diskHash&&
    (!s.taskConfigurationVersion||b.taskConfigurationVersion===s.taskConfigurationVersion)&&
    (!d.taskConfigurationVersion||b.taskConfigurationVersion===d.taskConfigurationVersion);
}
