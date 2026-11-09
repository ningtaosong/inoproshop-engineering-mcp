// Local maintenance only. Never changes an original operation, registry, project or source lock.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, canonical, digest, pathKey, readJson, atomicJson, type Operation, type Session } from './storage.js';
import { DomainError } from './contracts.js';

export const maintenanceGate = path.join(os.tmpdir(),'inoproshop-mcp-locks','maintenance.gate');
export const isolationDirectory = path.join(os.tmpdir(),'inoproshop-mcp-isolations');
function problem(code:string,message:string):never {throw new DomainError('unknown',code,message);}
const exists = async(p:string)=>fs.access(p).then(()=>true,(e:any)=>{if(e.code==='ENOENT')return false;throw e;});
export function processState(pid:unknown):'exited'|'active'|'unconfirmed' {
  if(!Number.isInteger(pid) || Number(pid)<=0)return 'unconfirmed';
  try {process.kill(Number(pid),0);return 'active';}
  catch(e:any){return e.code==='ESRCH'?'exited':'unconfirmed';}
}
export async function maintenanceGuard() {
  if(await exists(maintenanceGate))problem('MAINTENANCE_EXCLUSIVE','维护排他标记存在；工程派发暂停，须核对维护记录，不能自动删除标记');
}
export async function fileIdentity(p:string) {
  try {
    const s=await fs.stat(p,{bigint:true});
    if(!s.isFile())problem('IDENTITY_UNCONFIRMED','工程路径不是普通文件：'+p);
    return {path:path.resolve(p),key:pathKey(p),realPath:await fs.realpath(p),fileId:s.ino!==0n?`${s.dev}:${s.ino}`:null,
      bytes:String(s.size),sha256:digest(await fs.readFile(p))};
  }catch(e:any){if(e.code==='ENOENT')return {path:path.resolve(p),key:pathKey(p),missing:true};throw e;}
}
type Identity = Awaited<ReturnType<typeof fileIdentity>>;
function sameFile(a:Identity,b:Identity) {
  return a.key===b.key || (!!a.realPath && !!b.realPath && pathKey(a.realPath)===pathKey(b.realPath)) || (!!a.fileId && a.fileId===b.fileId);
}
function binding(op:Operation,s:Session) {
  return {operationId:op.operationId,requestId:op.requestId,tool:op.tool,fingerprint:op.fingerprint,startedAt:op.startedAt,
    projectId:s.projectId,sessionId:s.sessionId,sourcePath:s.sourcePath,workingPath:s.workingPath};
}
export function ownedProject(op:Operation,projects:Session[]) {
  const matches=projects.filter(s=>op.args.projectId?s.projectId===op.args.projectId:
    op.tool==='project_open_copy'&&op.args.sourcePath&&[s.sourcePath,s.workingPath].some(p=>pathKey(p)===pathKey(op.args.sourcePath)));
  if(matches.length!==1)problem('ISOLATION_OWNERSHIP','原操作不能唯一对应已登记工程');
  const s=matches[0];
  if(op.project && (op.project.projectId!==s.projectId || op.project.sessionId!==s.sessionId ||
    pathKey(op.project.sourcePath)!==pathKey(s.sourcePath)||pathKey(op.project.workingPath)!==pathKey(s.workingPath)))
    problem('ISOLATION_OWNERSHIP','操作绑定与工程登记不一致');
  if(op.fingerprint!==digest(canonical({tool:op.tool,args:op.args})))problem('ISOLATION_OWNERSHIP','原请求指纹无法核实');
  return s;
}
export interface IsolationPlan {
  version:1; kind:'project-isolation'; planId:string; createdAt:string; dataDir:string; reason:string;
  operationId:string; projectId:string|null; operationIds:string[]; bindings:any[]; aliases:Identity[];
  evidenceVersion:string; evidence:any; eligible:boolean; blockers:string[]; canReleaseOtherProjects:boolean;
  prohibitedActions:string[]; recoveryMissing:string[];
}
interface Entry {state:'prepared'|'committed';plan:IsolationPlan; committedAt?:string;}
interface Ledger {version:1;revision:number;entries:Entry[];}
const journalName=(id:string)=>'isolation-journal/'+id+'.json';
const anchorName=(root:string,id:string)=>path.join(isolationDirectory,digest(pathKey(root)+':'+id)+'.json');
async function envelope(p:string) {
  const r=await readJson(p);
  if(r===undefined)return undefined;
  if(r.schemaVersion!==1 || r.checksum!==digest(canonical(r.value)))problem('ISOLATION_RECORD_CORRUPT','隔离记录校验失败：'+p);
  return r.value;
}
async function writeEnvelope(p:string,value:unknown){await atomicJson(p,{schemaVersion:1,checksum:digest(canonical(value)),value});}
async function holdEvidence(plan:IsolationPlan) {
  if(process.platform!=='win32')problem('MAINTENANCE_PLATFORM','当前维护提交仅实现在 Windows；其他平台不降级为无排他文件保护的提交');
  const script=fileURLToPath(new URL('../scripts/maintenance-read-lock.ps1',import.meta.url));
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let error='';child.stderr.on('data',b=>error+=b.toString());
  const completion=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(error||'文件排他读取失败')));});
  // Observe failures while waiting for readiness too; no detached helper on a failed acquisition.
  completion.catch(()=>{});
  const paths=[...new Set(plan.evidence.files.filter((f:any)=>!f.missing && f.path!==maintenanceGate &&
    !f.path.includes(path.sep+'isolation-journal'+path.sep) && path.basename(f.path)!=='isolation-ledger.json').map((f:any)=>f.path))];
  child.stdin.write(JSON.stringify(paths)+'\n');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([new Promise<void>((resolve,reject)=>{
      let text='';child.stdout.on('data',b=>{text+=b.toString();if(text.includes('\n')){try{if(JSON.parse(text.trim()).ready===true)resolve();else reject(new Error('文件锁响应异常'));}catch(e){reject(e);}}});
    }),completion.then(()=>problem('EVIDENCE_LOCK','文件保护未发布就已退出')),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('维护文件保护等待超过 10 秒，未提交')),10000);})]);
  }catch(e){child.stdin.end();await completion.catch(()=>{});throw e;}finally{if(timer)clearTimeout(timer);}
  return async()=>{child.stdin.end('\n');await completion;};
}
async function localEntries(store:Store):Promise<Entry[]> {
  const ledger:Ledger|undefined=await store.get('isolation-ledger.json');
  const names=await fs.readdir(store.file('isolation-journal')).catch((e:any)=>{if(e.code==='ENOENT')return [];throw e;});
  if(!ledger && !names.length)return [];
  if(!ledger || ledger.version!==1 || !Number.isInteger(ledger.revision) || !Array.isArray(ledger.entries) ||
    ledger.entries.some(e=>!e.plan || !/^[a-f0-9-]{36}$/i.test(e.plan.planId)) ||
    new Set(ledger.entries.map(e=>e.plan.planId)).size!==ledger.entries.length || names.length!==ledger.entries.length)
    problem('ISOLATION_INCOMPLETE','隔离登记与独立意向记录不完整；全局冻结');
  const registry=await store.registry();
  for(const e of ledger.entries) {
    const p=e.plan,j=await store.get(journalName(p.planId));
    if(e.state!=='committed' || !e.committedAt || !j || canonical(j)!==canonical(p) || p.kind!=='project-isolation' || p.version!==1 || !p.eligible ||
      pathKey(p.dataDir)!==pathKey(store.root) || p.evidenceVersion!==digest(canonical(p.evidence)) || !p.operationIds.length ||
      !p.aliases.length || p.bindings.length!==p.operationIds.length)
      problem('ISOLATION_INCOMPLETE','隔离提交未确认或记录不一致；全局冻结');
    for(const b of p.bindings) {
      const op=await store.operation(b.operationId);
      if(!op || !p.operationIds.includes(op.operationId))problem('ISOLATION_OWNERSHIP','隔离原操作记录缺失');
      const s=ownedProject(op,registry.projects);
      if(s.projectId!==p.projectId || canonical(binding(op,s))!==canonical(b))problem('ISOLATION_OWNERSHIP','隔离工程或原操作绑定改变');
    }
    const anchor=await envelope(anchorName(store.root,p.planId));
    if(!anchor || anchor.state!=='committed' || anchor.planId!==p.planId || anchor.evidenceVersion!==p.evidenceVersion || pathKey(anchor.dataDir)!==pathKey(store.root))
      problem('ISOLATION_INCOMPLETE','隔离全局路径登记缺失或未提交；全局冻结');
  }
  return ledger.entries;
}
export async function isolationState(store:Store) {
  const own=await localEntries(store);
  const names=await fs.readdir(isolationDirectory).catch((e:any)=>{if(e.code==='ENOENT')return [];throw e;});
  const all:Entry[]=[];const seen=new Set<string>();
  for(const name of names) {
    if(!name.endsWith('.json'))problem('ISOLATION_INCOMPLETE','隔离全局登记中存在未确认文件');
    const a=await envelope(path.join(isolationDirectory,name));
    if(!a || a.state!=='committed' || typeof a.dataDir!=='string' || !path.isAbsolute(a.dataDir) ||
      typeof a.planId!=='string' || path.basename(anchorName(a.dataDir,a.planId))!==name)
      problem('ISOLATION_INCOMPLETE','隔离全局登记不完整；全局冻结');
    const key=pathKey(a.dataDir);
    const entries=await localEntries(new Store(a.dataDir));
    if(!entries.some(e=>e.plan.planId===a.planId && e.plan.evidenceVersion===a.evidenceVersion))
      problem('ISOLATION_INCOMPLETE','全局隔离所指的数据目录或记录缺失；不能推断已解除隔离');
    if(!seen.has(key)){seen.add(key);all.push(...entries);}
  }
  // A local commit without its global anchor must never disappear from effective state.
  for(const e of own)if(!all.some(x=>x.plan.planId===e.plan.planId && pathKey(x.plan.dataDir)===pathKey(store.root)))
    problem('ISOLATION_INCOMPLETE','本地隔离缺少全局路径保护');
  return {own,all};
}
export async function assertNotIsolated(store:Store,projectId?:string,paths:string[]=[]) {
  const state=await isolationState(store);
  const identities=await Promise.all(paths.map(fileIdentity));
  for(const e of state.all) {
    const current=await Promise.all(e.plan.aliases.map(a=>fileIdentity(a.path)));
    if((pathKey(e.plan.dataDir)===pathKey(store.root) && projectId===e.plan.projectId) ||
      identities.some(i=>[...e.plan.aliases,...current].some(a=>sameFile(i,a))))
      throw new DomainError('conflict','PROJECT_ISOLATED','工程已受控隔离，原操作终态仍按原记录；禁止激活、导入及工程派发，不能换编号重试');
  }
}

// Pure observation: no mkdir, lease, migration, IDE, reconcile, or persistent write.
export async function evaluateIsolation(root:string,operationId?:string) {
  const store=new Store(path.resolve(root));const blockers:string[]=[];const files:any[]=[];
  const record=async(p:string,required=false)=> {
    const f=await fileIdentity(p);files.push(f);if(required&&f.missing)blockers.push('必要文件缺失：'+p);return f;
  };
  let registry:any,ops:Operation[]=[],state:Awaited<ReturnType<typeof isolationState>>|undefined;
  if(!await exists(store.root)||!await exists(store.file('operations')))blockers.push('数据目录或必要操作记录目录缺失；不能推断没有未决操作');
  try{registry=await store.registry();ops=await store.operations();state=await isolationState(store);}catch(e:any){blockers.push(e.code+': '+e.message);}
  const pending=ops.filter(o=>o.status==='unknown'||o.status==='running');
  const observations:any[]=[];
  for(const op of pending){try{const s=ownedProject(op,registry.projects);observations.push({operationId:op.operationId,requestId:op.requestId,status:op.status,projectId:s.projectId,sourcePath:s.sourcePath,workingPath:s.workingPath,isolated:!!state?.own.some(e=>e.plan.operationIds.includes(op.operationId))});}
    catch(e:any){observations.push({operationId:op.operationId,status:op.status,ownership:'unconfirmed',reason:e.message});blockers.push(e.code+': '+e.message);}}
  let selected:Session|undefined;const selectedOp=ops.find(o=>o.operationId===operationId);
  if(operationId){try{if(!selectedOp || !['unknown','running'].includes(selectedOp.status))problem('ISOLATION_TARGET','指定操作不存在或不是未决操作');selected=ownedProject(selectedOp,registry.projects);}catch(e:any){blockers.push(e.code+': '+e.message);}}
  const targetOps=selected?pending.filter(o=>{try{return ownedProject(o,registry.projects).projectId===selected!.projectId;}catch{return false;}}):[];
  const bindings=targetOps.map(o=>binding(o,selected!));
  // Inventory the entire registered control state; unrelated queued work changes invalidate a plan.
  const walk=async(dir:string)=>{for(const n of (await fs.readdir(dir).catch((e:any)=>{if(e.code==='ENOENT')return [];throw e;})).sort()){
    const p=path.join(dir,n);if((await fs.lstat(p)).isDirectory())await walk(p);else await record(p);
  }};
  try {
    await record(store.file('registry.json'));await record(store.file('session.json'));await walk(store.file('operations'));
    await record(store.file('isolation-ledger.json'));await walk(store.file('isolation-journal'));
  }catch(e:any){blockers.push('记录证据读取失败：'+e.message);}
  const processes:any[]=[];const locks:any[]=[];const originalRecords:any[]=[];let aliases:Identity[]=[];
  const probe=(role:string,pid:unknown)=>{const status=processState(pid);processes.push({role,pid:pid??null,state:status});if(status!=='exited')blockers.push(`${role}进程未确认退出（${pid??'未知'}，${status}）`);};
  const inspectLock=async(p:string,required=false)=>{
    await record(p,required);await record(p+'.reclaim');
    if(await exists(p+'.reclaim'))blockers.push('锁接管记录未确认：'+p+'.reclaim');
    const owner=await readJson(p);locks.push({path:p,owner:owner??null});
    if(owner!==undefined){if(!Number.isInteger(owner.pid)||typeof owner.dataDir!=='string'||pathKey(owner.dataDir)!==pathKey(store.root))blockers.push('锁归属无法核实：'+p);else probe('锁持有者 '+p,owner.pid);}
  };
  try {
    await inspectLock(store.file('service.lock'));await record(maintenanceGate);
    if(await exists(maintenanceGate))blockers.push('维护排他标记存在，需先核对');
    if(selected){
      if(state?.own.some(e=>e.plan.projectId===selected!.projectId))blockers.push('该工程已有已提交隔离；只读核对原处置，不生成第二次隔离提交');
      aliases=await Promise.all([selected.sourcePath,selected.workingPath].map(p=>record(p,true)));
      await inspectLock(store.sourceLock(selected.sourcePath),true);
      // Include registered and filesystem aliases based on path/realpath/file identity, never content hash.
      for(const s of registry.projects)for(const p of [s.sourcePath,s.workingPath]){
        const i=await fileIdentity(p);if(aliases.some(a=>sameFile(i,a))){
          if(s.projectId!==selected.projectId)blockers.push('另一个已登记工程共享同一文件身份：'+s.projectId);
          if(!aliases.some(a=>a.key===i.key))aliases.push(i);
        }
      }
      for(const op of targetOps){
        const opPath=store.file('operations/'+op.operationId+'.json'),opBytes=await fs.readFile(opPath);
        originalRecords.push({path:opPath,sha256:digest(opBytes),base64:opBytes.toString('base64')});
        probe('原服务 '+op.operationId,op.ownerPid);
        const dir=op.bridge?.directory;
        if(!dir || pathKey(dir)!==pathKey(store.file('ipc/'+op.operationId))) {blockers.push('原桥接目录绑定不完整：'+op.operationId);continue;}
        await walk(dir);probe('原 IDE '+op.operationId,op.bridge?.pid);
        for(const n of (await fs.readdir(dir)).filter(n=>n.endsWith('.json'))) {
          const raw=await readJson(path.join(dir,n));
          if(['result.json','observed-after-exit.json'].includes(n) && (!raw || raw.operationId!==op.operationId ||
            !['running','unknown','succeeded','failed','conflict','unsupported'].includes(raw.status)))blockers.push('原桥接结果身份或结构损坏：'+n);
        }
        for(const n of (await fs.readdir(dir)).filter(n=>n.endsWith('.json')||['stdout.txt','stderr.txt'].includes(n))){
          const p=path.join(dir,n),bytes=await fs.readFile(p);originalRecords.push({path:p,sha256:digest(bytes),base64:bytes.toString('base64')});
        }
        const req=await readJson(path.join(dir,'request.json')),dispatch=await readJson(path.join(dir,'dispatched.json'));
        const command=({project_save:'save',project_build:'build',code_apply_change:'change',pou_create:'create',declaration_create:'create_declaration',project_open:'inspect',project_open_copy:'inspect',project_activate:'inspect',object_list:'list',object_read:'read',project_search:'search',task_inspect:'tasks',library_inspect:'libraries'} as Record<string,string>)[op.tool];
        if(!req||req.operationId!==op.operationId||pathKey(req.projectPath??'')!==pathKey(selected.workingPath)||
          !command||req.command!==command||Object.entries(op.args).some(([k,v])=>canonical(req.args?.[k])!==canonical(v)))blockers.push('原桥接请求不完整或身份不一致：'+op.operationId);
        if(!dispatch||dispatch.operationId!==op.operationId||dispatch.pid!==op.bridge?.pid)blockers.push('原派发/PID证据不完整：'+op.operationId);
        if(['code_apply_change','pou_create','declaration_create'].includes(op.tool)){
          await record(path.join(dir,'checkpoint.project'),true);await record(path.join(dir,'before.json'),true);
        }
      }
      for(const a of aliases){
        const marker=a.path+'.~u';await record(marker);
        if(await exists(marker)){
          const lines=(await fs.readFile(marker,'utf8')).trim().split(/\r?\n/);
          if(lines.length!==4||lines[1].toLowerCase()!==os.hostname().toLowerCase()||!/^\d+$/.test(lines[2]))blockers.push('原生占用标记不能确认本机进程归属：'+marker);
          else probe('原生占用标记 '+marker,Number(lines[2]));
        }
      }
      // Foreign source locks can represent another service using a hardlink/junction or this working file.
      const lockDir=path.dirname(store.sourceLock(selected.sourcePath));
      const foreignProjects=new Map<string,Session[]>();
      for(const name of (await fs.readdir(lockDir).catch(()=>[])).filter(n=>n.endsWith('.lock')).sort()){
        const p=path.join(lockDir,name),owner=await readJson(p);
        if(!owner?.dataDir || pathKey(owner.dataDir)===pathKey(store.root))continue;
        const foreign=new Store(owner.dataDir);
        // A missing/corrupt unrelated owner directory is not reclaimed; a direct alias lock still blocks.
        const direct=aliases.some(a=>foreign.sourceLock(a.path)===p);
        let related=direct;
        try {
          const key=pathKey(owner.dataDir);
          if(!foreignProjects.has(key))foreignProjects.set(key,[...(await foreign.registry()).projects,
            ...(await foreign.operations()).filter(o=>['running','unknown'].includes(o.status)&&o.project).map(o=>o.project!)]);
          for(const s of foreignProjects.get(key)!)for(const q of [s.sourcePath,s.workingPath])
          {const i=await fileIdentity(q);if(aliases.some(a=>sameFile(a,i)))related=true;}
        }catch(e:any){if(direct)blockers.push('关联外部锁记录不完整：'+p);}
        if(related){await record(p);locks.push({path:p,owner});if(processState(owner.pid)!=='exited')blockers.push('关联外部服务未确认退出：'+p);else blockers.push('关联工程在其他数据目录登记，不能确认唯一维护归属：'+p);}
      }
    }
  }catch(e:any){blockers.push('现场证据读取失败：'+e.message);}
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const evidence={dataDir:store.root,registry:registry??null,operations:observations,files,processes,locks,originalRecords,existingDispositions:state?.own.map(e=>({planId:e.plan.planId,projectId:e.plan.projectId}))??[]};
  const unique=[...new Set(blockers)];
  const operationAssessments:any[]=[];
  if(!operationId)for(const o of pending){const a=await evaluateIsolation(root,o.operationId);operationAssessments.push({operationId:o.operationId,projectId:a.projectId,eligible:a.eligible,blockers:a.blockers,processes:a.evidence.processes,locks:a.evidence.locks,evidenceVersion:a.evidenceVersion});}
  return {version:1,evaluatedAt:new Date().toISOString(),operationId:operationId??null,projectId:selected?.projectId??null,operationAssessments,
    unknownOperations:observations,evidence,evidenceVersion:digest(canonical(evidence)),aliases,bindings,
    operationIds:targetOps.map(o=>o.operationId).sort(),eligible:!!selected&&targetOps.length>0&&unique.length===0,blockers:unique,
    canReleaseOtherProjects:!!selected&&unique.length===0&&pending.every(o=>targetOps.includes(o)||state?.own.some(e=>e.plan.operationIds.includes(o.operationId)))};
}
export async function generatePlan(root:string,operationId:string,reason:string):Promise<IsolationPlan> {
  if(!reason.trim())throw new Error('处置理由不能为空');
  const a=await evaluateIsolation(root,operationId);
  return {version:1,kind:'project-isolation',planId:randomUUID(),createdAt:new Date().toISOString(),dataDir:path.resolve(root),reason,
    operationId,projectId:a.projectId,operationIds:a.operationIds,bindings:a.bindings,aliases:a.aliases,evidenceVersion:a.evidenceVersion,evidence:a.evidence,
    eligible:a.eligible,blockers:a.blockers,canReleaseOtherProjects:a.canReleaseOtherProjects,
    prohibitedActions:['原工程所有普通读取/修改/创建/编译/保存/激活/重新导入；已识别源、副本、realpath 和文件身份别名同样禁止','不得重放原业务，不得自动解除隔离；仅原状态查询和可信原结果核对保留'],
    recoveryMissing:['原保存/关闭/重开操作的可信终态及原结果身份核对','原工程最终全文、对象集合、设备及任务配置证据','当前磁盘版本与文本快照、适用的完整编译证据；进程退出不足以恢复原工程']};
}
export async function commitIsolation(plan:IsolationPlan, hooks?:{afterStage?:(stage:string)=>Promise<void>}) {
  if(plan?.eligible===false)problem('PLAN_BLOCKED','计划不满足隔离条件，不能提交：'+(Array.isArray(plan.blockers)?plan.blockers.join('；'):'评估未通过'));
  const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
  if(!plan || !uuid(plan.planId)||!uuid(plan.operationId)||!uuid(plan.projectId)||typeof plan.dataDir!=='string'||!path.isAbsolute(plan.dataDir)||
    !plan.evidence || pathKey(plan.evidence.dataDir??'')!==pathKey(plan.dataDir)||!Array.isArray(plan.bindings)||!Array.isArray(plan.aliases)||
    !Array.isArray(plan.operationIds)||!plan.operationIds.includes(plan.operationId)||!Array.isArray(plan.evidence.files))problem('PLAN_INVALID','计划身份、路径或证据结构不合法');
  const store=new Store(path.resolve(plan.dataDir));
  if(plan.version!==1||plan.kind!=='project-isolation'||!plan.reason?.trim()||plan.evidenceVersion!==digest(canonical(plan.evidence)))problem('PLAN_INVALID','计划校验失败');
  const previous=await store.get('isolation-ledger.json');
  const duplicate=previous?.entries?.find((e:Entry)=>e.plan.planId===plan.planId);
  if(duplicate){await isolationState(store);if(canonical(duplicate.plan)!==canonical(plan))problem('PLAN_CONFLICT','计划编号已用于不同内容');return {deduplicated:true,entry:duplicate};}
  if(!plan.eligible)problem('PLAN_BLOCKED','计划不满足隔离条件，不能提交：'+plan.blockers.join('；'));
  await fs.mkdir(path.dirname(maintenanceGate),{recursive:true});
  let gate;
  try{gate=await fs.open(maintenanceGate,'wx');}catch{problem('MAINTENANCE_EXCLUSIVE','未取得维护排他控制；保留原标记');}
  try {
    const owner={pid:process.pid,dataDir:store.root,planId:plan.planId};await gate!.writeFile(JSON.stringify(owner));await gate!.sync();
    const releaseEvidence=await holdEvidence(plan);
    try {
    // Evaluation is performed under the gate. Exclude only our own gate from this comparison.
    const a=await evaluateIsolation(store.root,plan.operationId);
    a.blockers=a.blockers.filter(b=>b!=='维护排他标记存在，需先核对');
    a.evidence.files=a.evidence.files.map((f:any)=>f.path===maintenanceGate?plan.evidence.files.find((p:any)=>p.path===maintenanceGate):f);
    if(a.blockers.length || a.projectId!==plan.projectId || digest(canonical(a.evidence))!==plan.evidenceVersion || canonical(a.bindings)!==canonical(plan.bindings) ||
      canonical(a.aliases)!==canonical(plan.aliases)||canonical(a.operationIds)!==canonical(plan.operationIds))
      problem('PLAN_STALE','现场、进程、锁或归属已变化；旧计划拒绝提交，须重新评估');
    const entry:Entry={state:'prepared',plan};
    await store.put(journalName(plan.planId),plan);await hooks?.afterStage?.('journal');
    const ledger:Ledger=previous??{version:1,revision:0,entries:[]};ledger.entries.push(entry);ledger.revision++;
    await store.put('isolation-ledger.json',ledger);await hooks?.afterStage?.('prepared');
    const anchor={state:'prepared',dataDir:store.root,planId:plan.planId,evidenceVersion:plan.evidenceVersion};
    await writeEnvelope(anchorName(store.root,plan.planId),anchor);await hooks?.afterStage?.('anchor');
    entry.state='committed';entry.committedAt=new Date().toISOString();ledger.revision++;
    await store.put('isolation-ledger.json',ledger);await hooks?.afterStage?.('local-committed');
    anchor.state='committed';await writeEnvelope(anchorName(store.root,plan.planId),anchor);await hooks?.afterStage?.('committed');
    await isolationState(store);return {deduplicated:false,entry};
    } finally {await releaseEvidence();}
  } finally {
    await gate!.close();
    const owner=await readJson(maintenanceGate);
    if(owner?.pid===process.pid&&owner?.planId===plan.planId)await fs.unlink(maintenanceGate);
    else problem('MAINTENANCE_EXCLUSIVE','维护标记归属改变，保留标记并全局冻结');
  }
}
