// Lease ownership only. Operation/bridge/native-marker PID recovery deliberately
// continues to use its existing rules; a lease decision is not an operation result.
import {execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

export interface ProcessIdentity {version:1;platform:'win32'|'linux';host:string;pid:number;startId:string;}
export type ProcessObservation = {state:'running';identity:ProcessIdentity}|{state:'exited'}|{state:'unconfirmed';reason:string};
export type ProcessProbe = (pid:number)=>Promise<ProcessObservation>;
export interface LeaseRecord {leaseVersion:2;leaseId:string;pid:number;dataDir:string;createdAt:string;processIdentity:ProcessIdentity;checksum:string;}
function stable(v:any):string {return v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'):JSON.stringify(v);}
export function sealLease(record:Omit<LeaseRecord,'checksum'>):LeaseRecord {return {...record,checksum:createHash('sha256').update(stable(record)).digest('hex')};}
export type OwnerObservation = {state:'active'|'stale'|'unconfirmed';reason:string;process?:ProcessObservation};
export function validProcessIdentity(v:any,pid:number):v is ProcessIdentity {
  return v?.version===1 && ['win32','linux'].includes(v.platform) && typeof v.host==='string' && v.host.length>0 &&
    v.pid===pid && typeof v.startId==='string' && /^[0-9]+(?::[0-9a-f-]+)?$/i.test(v.startId);
}
export function sameProcess(a:ProcessIdentity,b:ProcessIdentity) {
  return a.version===b.version&&a.platform===b.platform&&a.host===b.host&&a.pid===b.pid&&a.startId===b.startId;
}
// StartTime is the OS process creation FILETIME (UTC ticks), not a lease write
// time, process name or command line. No scripts, Profile, Bypass or policy change.
export const probeProcess:ProcessProbe=async pid=>{
  if(!Number.isInteger(pid)||pid<=0)return {state:'unconfirmed',reason:'invalid-pid'};
  // An explicit OS ESRCH is sufficient proof that this PID currently has no
  // process. Liveness/EPERM is never sufficient proof of lease ownership.
  try {process.kill(pid,0);}catch(e:any){if(e.code==='ESRCH')return {state:'exited'};}
  if(process.platform==='win32') {
    const command=`$ErrorActionPreference='Stop'; try { $p=[System.Diagnostics.Process]::GetProcessById(${pid}) } catch { if ($_.Exception.InnerException -is [System.ArgumentException]) { '{"state":"exited"}'; exit 0 }; throw }; try { @{state='running';startId=$p.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json -Compress } finally { $p.Dispose() }`;
    const env={...process.env};delete env.PSExecutionPolicyPreference;
    try {
      const stdout=await new Promise<string>((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,maxBuffer:32768,encoding:'utf8',env},(e,out)=>e?reject(e):resolve(out)));
      const r=JSON.parse(stdout.trim());
      if(r.state==='exited')return {state:'exited'};
      if(r.state==='running'&&typeof r.startId==='string'&&/^\d+$/.test(r.startId))
        return {state:'running',identity:{version:1,platform:'win32',host:os.hostname().toLowerCase(),pid,startId:r.startId}};
      return {state:'unconfirmed',reason:'invalid-system-response'};
    }catch(e:any){return {state:'unconfirmed',reason:'windows-identity-query-failed:'+String(e.code??e.name)};}
  }
  if(process.platform==='linux') {
    try {
      const boot=(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();
      const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8');
      const fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),start=fields[19];
      if(!/^\d+$/.test(start)||!/^[0-9a-f-]+$/.test(boot))throw Error('invalid-proc-identity');
      return {state:'running',identity:{version:1,platform:'linux',host:os.hostname().toLowerCase(),pid,startId:start+':'+boot}};
    }catch(e:any){return e.code==='ENOENT'?{state:'exited'}:{state:'unconfirmed',reason:'proc-identity-query-failed'};}
  }
  return {state:'unconfirmed',reason:'unsupported-process-identity-platform'};
};
let self:Promise<ProcessObservation>|undefined;
// A process cannot change its own birth identity. Cache only this process, never
// another PID, a failed observation, or a synthetic test probe.
export async function ownProcessIdentity(probe:ProcessProbe=probeProcess) {
  const r=probe===probeProcess?await(self??=probe(process.pid)):await probe(process.pid);
  if(r.state!=='running'||!validProcessIdentity(r.identity,process.pid)) {if(probe===probeProcess)self=undefined;return undefined;}
  return r.identity;
}
export async function observeLeaseOwner(owner:any,probe:ProcessProbe=probeProcess):Promise<OwnerObservation> {
  if(!owner||!Number.isInteger(owner.pid)||owner.pid<=0||typeof owner.dataDir!=='string'||!path.isAbsolute(owner.dataDir)||
    typeof owner.createdAt!=='string'||!Number.isFinite(Date.parse(owner.createdAt)))
    return {state:'unconfirmed',reason:'invalid-lease-record'};
  const modern=owner.leaseVersion!==undefined||owner.leaseId!==undefined||owner.processIdentity!==undefined||owner.checksum!==undefined;
  if(modern&&(owner.leaseVersion!==2||typeof owner.leaseId!=='string'||! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(owner.leaseId)||!validProcessIdentity(owner.processIdentity,owner.pid)))
    return {state:'unconfirmed',reason:'invalid-lease-identity'};
  if(modern){const {checksum,...record}=owner;if(typeof checksum!=='string'||sealLease(record).checksum!==checksum)return {state:'unconfirmed',reason:'lease-checksum-mismatch'};}
  if(modern&&probe===probeProcess&&(owner.processIdentity.platform!==process.platform||owner.processIdentity.host!==os.hostname().toLowerCase()))
    return {state:'unconfirmed',reason:'identity-domain-mismatch'};
  let p:ProcessObservation;
  try {p=await probe(owner.pid);}catch{return {state:'unconfirmed',reason:'identity-probe-threw'};}
  if(p.state==='exited')return {state:'stale',reason:'owner-pid-exited',process:p};
  if(p.state!=='running'||!validProcessIdentity(p.identity,owner.pid))return {state:'unconfirmed',reason:'identity-query-unconfirmed',process:p};
  if(!modern)return {state:'unconfirmed',reason:'legacy-live-pid-has-no-birth-identity',process:p};
  if(owner.processIdentity.platform!==p.identity.platform||owner.processIdentity.host!==p.identity.host)
    return {state:'unconfirmed',reason:'identity-domain-mismatch',process:p};
  return {state:sameProcess(owner.processIdentity,p.identity)?'active':'stale',reason:sameProcess(owner.processIdentity,p.identity)?'same-process-instance':'pid-reused',process:p};
}
