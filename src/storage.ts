import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DomainError, type Reply } from './contracts.js';

// 对象哈希固定为 UTF-8 JSON 数组 [声明, 实现]，只把 CRLF/CR 规范为 LF。
export const normalize = (s: string) => s.replace(/\r\n?/g, '\n');
export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const codeHash = (d: string, i: string) => digest(JSON.stringify([normalize(d),normalize(i)]));
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function atomicJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = file+'.'+randomUUID()+'.tmp';
  const f = await fs.open(temp, 'wx');
  try { await f.writeFile(JSON.stringify(value,null,2), 'utf8'); await f.sync(); }
  finally { await f.close(); }
  // Windows 的读取句柄/索引器可能短暂阻止替换。只重试同一完整文件的发布，绝不重放工程动作。
  for(let attempt=0;;attempt++) {
    try { await fs.rename(temp,file); break; }
    catch(e:any) {
      if(!['EPERM','EACCES','EBUSY'].includes(e.code) || attempt>=6) throw e;
      await new Promise(resolve=>setTimeout(resolve,10*2**attempt));
    }
  }
}
export async function readJson(file: string): Promise<any | undefined> {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch(e: any) { if(e.code==='ENOENT') return undefined; throw new DomainError('unknown','CORRUPT_RECORD',`记录无法读取，已冻结写入：${file}`); }
}
export const alive = (pid: number) => { try { process.kill(pid,0); return true; } catch(e: any) { return e.code==='EPERM'; } };
export interface Operation {
  schemaVersion: 1; operationId: string; requestId: string; tool: string; args: any;
  fingerprint: string; status: Reply['status']; startedAt: string; ownerPid: number;
  response?: Reply; bridge?: { directory: string; pid?: number }; finishedAt?: string;
  registryVersion?: 1;
  project?: Session;
  activation?: { previousActiveProjectId: string|null; revision: number };
}
export interface Session {
  // Missing storageMode is the historical copy binding. sourceHash is the
  // registration-time provenance hash; diskHash is the current editable file.
  storageMode?: 'direct'; editMode?: 'direct'; directPath?: string;
  projectId: string; sessionId: string; sourcePath: string; workingPath: string;
  sourceHash: string; targetKind?: 'application'|'pool'; applicationId?: string|null; applications?: any[]; lastBuild?: any;
  snapshot?: string; diskHash?: string; buildApplicable?: boolean; lastStateOperationId?: string;
}
export interface Registry {
  version: 1|2; revision: number; activeProjectId: string|null; projects: Session[];
  lastTransitionOperationId?: string;
}
export const pathKey = (p:string) => path.resolve(p).toLowerCase();
export class Store {
  private held = new Set<string>();
  constructor(readonly root: string) {}
  file(name: string) { return path.join(this.root,name); }
  async put(name: string, value: unknown) {
    await atomicJson(this.file(name), {schemaVersion:1,checksum:digest(canonical(value)),value});
  }
  async get(name: string): Promise<any | undefined> {
    const r = await readJson(this.file(name));
    if(r===undefined) return undefined;
    if(r.schemaVersion!==1 || r.checksum!==digest(canonical(r.value)))
      throw new DomainError('unknown','CORRUPT_RECORD',`记录校验失败，保留原文件并冻结写入：${name}`);
    return r.value;
  }
  async operations(): Promise<Operation[]> {
    const names = await fs.readdir(this.file('operations')).catch((e:any)=> { if(e.code==='ENOENT') return []; throw e; });
    const rows: Operation[] = [];
    for(const f of names.filter(x=>x.endsWith('.json'))) {
      const op=await this.operation(f.slice(0,-5));
      if(!op) throw new DomainError('unknown','CORRUPT_RECORD','操作记录在读取期间消失');
      rows.push(op);
    }
    return rows;
  }
  async operation(id:string):Promise<Operation|undefined> {
    if(!/^[a-f0-9-]{36}$/i.test(id)) throw new DomainError('unknown','CORRUPT_RECORD','无效操作记录身份');
    const op=await this.get('operations/'+id+'.json');
    if(op!==undefined && (op.operationId!==id || typeof op.requestId!=='string' || typeof op.tool!=='string' ||
      !op.args || typeof op.fingerprint!=='string' || !['running','unknown','succeeded','failed','conflict','unsupported'].includes(op.status) || !Number.isInteger(op.ownerPid)))
      throw new DomainError('unknown','CORRUPT_RECORD','操作记录结构损坏');
    return op;
  }
  async saveOp(op: Operation) { await this.put('operations/'+op.operationId+'.json',op); }
  private validateSession(s:any) {
    if(!s || typeof s.projectId!=='string' || typeof s.sessionId!=='string' || typeof s.sourcePath!=='string' ||
      typeof s.workingPath!=='string' || !path.isAbsolute(s.sourcePath) || !path.isAbsolute(s.workingPath) || !/^[a-f0-9]{64}$/.test(s.sourceHash))
      throw new DomainError('unknown','CORRUPT_REGISTRY','工程登记结构损坏，停止工程操作');
    if((s.storageMode!==undefined && s.storageMode!=='direct') || (s.editMode!==undefined && s.editMode!=='direct') ||
      (s.editMode==='direct' && (typeof s.directPath!=='string'||!path.isAbsolute(s.directPath))) ||
      (s.storageMode==='direct' && (s.editMode!=='direct' || pathKey(s.sourcePath)!==pathKey(s.workingPath))))
      throw new DomainError('unknown','CORRUPT_REGISTRY','直接工程绑定模式或路径损坏');
  }
  async registry():Promise<Registry> {
    const r=await this.get('registry.json');
    if(r!==undefined) {
      if(![1,2].includes(r.version) || !Number.isInteger(r.revision) || r.revision<0 || !Array.isArray(r.projects) ||
        !(r.activeProjectId===null || typeof r.activeProjectId==='string'))
        throw new DomainError('unknown','CORRUPT_REGISTRY','工程登记结构损坏');
      r.projects.forEach((s:any)=>this.validateSession(s));
      if(r.version===1&&r.projects.some((s:Session)=>s.editMode==='direct'||s.storageMode==='direct'))
        throw new DomainError('unknown','CORRUPT_REGISTRY','直接编辑登记必须使用 v2；禁止旧格式误识别为副本');
      if(new Set(r.projects.map((s:Session)=>s.projectId)).size!==r.projects.length ||
        new Set(r.projects.filter((s:Session)=>s.storageMode!=='direct').map((s:Session)=>pathKey(s.sourcePath))).size!==r.projects.filter((s:Session)=>s.storageMode!=='direct').length ||
        new Set(r.projects.map((s:Session)=>pathKey(s.workingPath))).size!==r.projects.length ||
        (r.activeProjectId!==null && !r.projects.some((s:Session)=>s.projectId===r.activeProjectId)))
        throw new DomainError('unknown','CORRUPT_REGISTRY','工程登记身份或活动指针不一致');
      if(r.projects.length) await fs.access(this.file('operations')).catch(()=>{throw new DomainError('unknown','RECORDS_MISSING','工程操作记录目录缺失，保持冻结');});
      return r;
    }
    // 旧文件只读兼容；真正迁移只在取得服务锁且无未决操作后进行。
    if((await this.operations()).some(o=>o.registryVersion===1))
      throw new DomainError('unknown','REGISTRY_MISSING','新格式登记文件缺失，不能退回旧 session 推测状态');
    const legacy=await this.get('session.json');
    if(legacy) {
      this.validateSession(legacy);
      await fs.access(this.file('operations')).catch(()=>{throw new DomainError('unknown','RECORDS_MISSING','旧工程操作记录目录缺失，不能推断无未决操作');});
    }
    return {version:1,revision:0,activeProjectId:legacy?.projectId || null,projects:legacy?[legacy]:[]};
  }
  async ensureRegistry() {
    const r=await this.registry();
    if(await this.get('registry.json')===undefined) await this.put('registry.json',r);
    return r;
  }
  async session():Promise<Session|undefined> {
    const r=await this.registry();return r.projects.find(s=>s.projectId===r.activeProjectId);
  }
  async saveSession(s:Session) {
    this.validateSession(s);
    if(await this.get('registry.json')===undefined) return this.put('session.json',s);
    const r=await this.registry();const i=r.projects.findIndex(p=>p.projectId===s.projectId);
    if(i<0) throw new DomainError('unknown','PROJECT_RECORD_MISSING','缺少原工程登记');
    r.projects[i]=s;r.revision++;await this.put('registry.json',r);
  }
  async activate(s:Session,op:Operation) {
    this.validateSession(s);const r=await this.registry();
    if(r.lastTransitionOperationId===op.operationId) {
      const committed=r.projects.find(p=>p.projectId===s.projectId);
      if(r.activeProjectId!==s.projectId || !committed || committed.lastStateOperationId!==op.operationId)
        throw new DomainError('unknown','TRANSITION_MISMATCH','原切换提交状态无法确认');
      return committed;
    }
    if(!op.activation || r.revision!==op.activation.revision || r.activeProjectId!==op.activation.previousActiveProjectId)
      throw new DomainError('unknown','TRANSITION_CONFLICT','切换前登记已改变，保持冻结');
    const i=r.projects.findIndex(p=>p.projectId===s.projectId);
    if(i<0)r.projects.push(s);else r.projects[i]=s;
    // Older binaries reject v2 rather than silently treating direct bindings as copies.
    // Original records are retained verbatim; only the registry envelope is upgraded.
    if(s.editMode==='direct')r.version=2;
    r.activeProjectId=s.projectId;r.revision++;r.lastTransitionOperationId=op.operationId;
    await this.put('registry.json',r);return s;
  }
  sourceLock(source:string) {return path.join(os.tmpdir(),'inoproshop-mcp-locks',digest(pathKey(source))+'.lock');}
  async lease(file: string, source?:string) {
    if(this.held.has(file)) {
      const owner=await readJson(file);
      if(owner?.pid!==process.pid || typeof owner.dataDir!=='string' || pathKey(owner.dataDir)!==pathKey(this.root))
        throw new DomainError('unknown','LOCK_CHANGED','已持有的锁发生外部变化');
      return;
    }
    await fs.mkdir(path.dirname(file),{recursive:true});
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const f = await fs.open(file,'wx');
        try { await f.writeFile(JSON.stringify({pid:process.pid,dataDir:this.root,createdAt:new Date().toISOString()})); await f.sync(); }
        finally { await f.close(); }
        this.held.add(file); return;
      } catch(e:any) {
        if(e.code!=='EEXIST') throw e;
        const owner = await readJson(file);
        if(!Number.isInteger(owner?.pid) || typeof owner.dataDir!=='string' || !path.isAbsolute(owner.dataDir))
          throw new DomainError('unknown','LOCK_RECORD_INVALID','锁归属记录损坏，不能自动接管');
        if(alive(owner.pid)) throw new DomainError('conflict','SESSION_BUSY',`工程或数据目录被另一服务实例占用：${file}`);
        // 其他数据目录遗留的工程锁仅在没有未决操作且记录完好时允许接管。
        if(pathKey(owner.dataDir)!==pathKey(this.root)) {
          const foreign=new Store(owner.dataDir);
          await fs.access(foreign.file('operations')).catch(()=>{throw new DomainError('unknown','FOREIGN_RECORDS_MISSING','原锁所属目录或操作记录缺失，不能推断无未决操作');});
          const registry=await foreign.registry();
          if(!source || !registry.projects.some(p=>pathKey(p.sourcePath)===pathKey(source)))
            throw new DomainError('unknown','FOREIGN_RECORDS_MISSING','原锁缺少可确认的工程归属记录');
          const pending = await foreign.operations();
          if(pending.some(x=>x.status==='running'||x.status==='unknown'))
            throw new DomainError('unknown','FOREIGN_PENDING','另一服务数据目录存在未决操作，须先在原目录核对');
        }
        // 接管也必须排他，否则两个重启进程可能把彼此刚建立的新锁当作旧锁移走。
        const guardPath=file+'.reclaim';
        let guard;
        try { guard=await fs.open(guardPath,'wx'); }
        catch { throw new DomainError('conflict','LOCK_RECLAIM_BUSY','另一实例正在核对遗留锁；若接管进程崩溃须人工核对 reclaim 标记'); }
        try {
          await guard.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})); await guard.sync();
          const current=await readJson(file);
          if(current?.pid && alive(current.pid)) throw new DomainError('conflict','SESSION_BUSY','工程锁已经被另一存活实例取得');
          if(current && canonical(current)!==canonical(owner)) throw new DomainError('conflict','SESSION_BUSY','遗留锁已改变，请重新查询状态');
          try { await fs.rename(file,file+'.stale.'+randomUUID()); }
          catch(e:any) { if(e.code!=='ENOENT') throw e; }
        } finally { await guard.close(); await fs.unlink(guardPath); }
      }
    }
    throw new DomainError('conflict','SESSION_BUSY','未取得排他锁');
  }
  async acquire(source?: string) {
    // Maintenance takes a separate gate and then verifies no live service lease.
    // Check both sides of lease acquisition so neither side can win an unchecked race.
    const {maintenanceGuard}=await import('./isolation.js');
    await maintenanceGuard();
    await this.lease(this.file('service.lock'));
    if(source) await this.lease(this.sourceLock(source),source);
    await maintenanceGuard();
  }
  async releaseSource(source:string) {
    const file=this.sourceLock(source);if(!this.held.has(file))return;
    const owner=await readJson(file);
    if(owner?.pid!==process.pid || typeof owner.dataDir!=='string' || pathKey(owner.dataDir)!==pathKey(this.root))throw new DomainError('unknown','LOCK_CHANGED','源锁归属无法确认');
    await fs.unlink(file);this.held.delete(file);
  }
  async release() {
    // 退出前先核对全部归属，不能因 PID 相同就删掉已被替换的锁，也不先释放部分保护。
    for(const file of this.held) {
      const owner=await readJson(file);
      if(owner?.pid!==process.pid || typeof owner.dataDir!=='string' || pathKey(owner.dataDir)!==pathKey(this.root))
        throw new DomainError('unknown','LOCK_CHANGED','退出时锁归属无法确认，保留全部锁');
    }
    for(const file of this.held) await fs.unlink(file);
    this.held.clear();
  }
}
