import {canonical,digest} from './storage.js';
import {DomainError} from './contracts.js';

export const TASK_CONFIGURATION_SCHEME='task-configuration-v1';
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
