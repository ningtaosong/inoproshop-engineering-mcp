import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainError} from './contracts.js';
import {observeLeaseOwner,ownProcessIdentity,probeProcess,sameProcess,sealLease,type ProcessProbe} from './lease-process.js';

const stop=(code:string,message:string):never=>{throw new DomainError('unknown',code,message);};
interface Image {raw:string;record:any;fileId:string;}
async function image(file:string):Promise<Image|undefined> {
  let f;
  try {
    f=await fs.open(file,'r');const s=await f.stat({bigint:true});
    if(!s.isFile()||s.ino===0n)stop('LOCK_RECORD_INVALID','租约文件身份无法核实，保留现场');
    const raw=await f.readFile('utf8');return {raw,record:JSON.parse(raw),fileId:`${s.dev}:${s.ino}`};
  }catch(e:any){if(e.code==='ENOENT')return undefined;if(e instanceof DomainError)throw e;return stop('LOCK_RECORD_INVALID','租约无法完整读取，保留文件及接管标记');}
  finally {await f?.close();}
}
const equal=(a:Image|undefined,b:Image|undefined)=>!!a&&!!b&&a.raw===b.raw&&a.fileId===b.fileId;
export interface LeaseOptions {probe?:ProcessProbe;}
// Every cooperating acquire/reclaim/recheck/release uses the same exclusive
// sidecar. A leftover/replaced sidecar is never reclaimed automatically.
export class LeaseFiles {
  private held=new Map<string,Image>();
  private transitions:Promise<unknown>=Promise.resolve();
  private probe:ProcessProbe;
  constructor(private root:string,options:LeaseOptions={},private foreign:(owner:any,source?:string)=>Promise<void>) {this.probe=options.probe??probeProcess;}
  private async identity() {
    const id=await ownProcessIdentity(this.probe);
    if(!id)stop('LEASE_IDENTITY_UNCONFIRMED','无法核实本服务进程创建身份，停止租约操作');
    return id!;
  }
  private async guard(file:string) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    const id=await this.identity(),guardPath=file+'.reclaim';let handle;
    try {handle=await fs.open(guardPath,'wx');}
    catch(e:any){if(e.code==='EEXIST')throw new DomainError('conflict','LOCK_RECLAIM_BUSY','租约排他核对标记存在；不自动删除或接管标记');return stop('LOCK_GUARD_UNCONFIRMED','无法取得租约排他控制');}
    const raw=JSON.stringify({kind:'lease-transition',leaseId:randomUUID(),pid:process.pid,processIdentity:id,createdAt:new Date().toISOString()});
    let expected:Image;
    try {await handle.writeFile(raw);await handle.sync();const s=await handle.stat({bigint:true});expected={raw,record:JSON.parse(raw),fileId:`${s.dev}:${s.ino}`};}
    catch {await handle.close();return stop('LOCK_GUARD_UNCONFIRMED','排他标记写入不确定，保留标记');}
    const verify=async()=>{if(!equal(await image(guardPath),expected)||!sameProcess(id,await this.identity()))stop('LOCK_GUARD_CHANGED','排他标记或本进程身份已变化，保留现场');};
    return {verify,close:async()=>{try {await verify();await fs.unlink(guardPath);}finally{await handle.close();}}};
  }
  private async owned(file:string) {
    const expected=this.held.get(file),current=await image(file),id=await this.identity();
    if(!equal(current,expected)||!sameProcess(expected!.record.processIdentity,id))stop('LOCK_CHANGED','已持有租约被替换，停止并保留全部租约');
    return current!;
  }
  private serial<T>(run:()=>Promise<T>):Promise<T> {
    const next=this.transitions.then(run);this.transitions=next.catch(()=>{});return next;
  }
  async acquire(file:string,source?:string) {return this.serial(()=>this.acquireOne(file,source));}
  private async acquireOne(file:string,source?:string) {
    const guard=await this.guard(file);let primary:unknown;
    try {
      if(this.held.has(file)){await this.owned(file);return;}
      const owner=await image(file);
      if(owner) {
        const before=await observeLeaseOwner(owner.record,this.probe);
        if(before.state==='active')throw new DomainError('conflict','SESSION_BUSY',`另一服务进程实例仍持有租约：${file}`);
        if(before.state!=='stale')stop('LEASE_IDENTITY_UNCONFIRMED',`租约拥有者身份不能确认（${before.reason}），保留原租约`);
        await this.foreign(owner.record,source);
        await guard.verify();
        if(!equal(await image(file),owner))throw new DomainError('conflict','LOCK_CHANGED','核对期间租约内容或文件身份改变，拒绝接管');
        // Foreign pending/ownership rules are unchanged, but checked again at
        // commit rather than relying on an earlier filesystem observation.
        await this.foreign(owner.record,source);
        const after=await observeLeaseOwner(owner.record,this.probe);
        if(after.state!=='stale'||JSON.stringify(after)!==JSON.stringify(before))
          throw new DomainError('conflict','LOCK_OWNER_CHANGED','核对期间进程实例证据改变，拒绝接管');
        await guard.verify();
        if(!equal(await image(file),owner))throw new DomainError('conflict','LOCK_CHANGED','接管提交前租约改变');
        await fs.rename(file,file+'.stale.'+randomUUID());
      }
      const record=sealLease({leaseVersion:2,leaseId:randomUUID(),pid:process.pid,dataDir:this.root,createdAt:new Date().toISOString(),processIdentity:await this.identity()});
      await guard.verify();let f;
      try {f=await fs.open(file,'wx');}
      catch(e:any){if(e.code==='EEXIST')throw new DomainError('conflict','SESSION_BUSY','发布前已有另一实例取得租约；不覆盖');return stop('LOCK_WRITE_UNCONFIRMED','租约发布失败，保留已有证据');}
      try {
        const raw=JSON.stringify(record);await f.writeFile(raw);await f.sync();const s=await f.stat({bigint:true});
        const expected={raw,record,fileId:`${s.dev}:${s.ino}`};
        if(!equal(await image(file),expected))stop('LOCK_CHANGED','新租约读回或文件身份不符');
        this.held.set(file,expected);
      }catch(e:any){if(e instanceof DomainError)throw e;stop('LOCK_WRITE_UNCONFIRMED','租约写入结果不确定，保留文件，不覆盖重试');}
      finally {await f.close();}
    }catch(e){primary=e;throw e;}finally {
      try {await guard.close();}catch(cleanup){if(primary){const e=new DomainError('unknown','LOCK_CLEANUP_UNCONFIRMED','租约操作及排他标记清理均失败，保留两个异常和现场');Object.assign(e,{cause:primary,cleanup});throw e;}throw cleanup;}
    }
  }
  async release(files?:string[]) {return this.serial(()=>this.releaseOwned(files??[...this.held.keys()]));}
  private async releaseOwned(files:string[]) {
    const selected=[...new Set(files)].filter(f=>this.held.has(f)).sort(),guards=[];let primary:unknown;
    try {
      for(const f of selected)guards.push(await this.guard(f));
      // Preflight all locks before releasing any of them (including same-PID
      // replacements); guards stay held until the whole release is finished.
      for(const f of selected)await this.owned(f);
      for(const g of guards)await g.verify();
      for(const f of selected){await this.owned(f);await fs.unlink(f);this.held.delete(f);}
    }catch(e){primary=e;throw e;}finally {
      const cleanup=[];for(const g of guards.reverse())try{await g.close();}catch(e){cleanup.push(e);}
      if(cleanup.length){const e=new DomainError('unknown','LOCK_CLEANUP_UNCONFIRMED','租约释放的排他标记无法全部确认，保留现场');Object.assign(e,{cause:primary,cleanup});throw e;}
    }
  }
}
