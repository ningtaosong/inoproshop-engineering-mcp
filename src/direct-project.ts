import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainError} from './contracts.js';
import {digest,pathKey,type Operation,type Registry,type Session,type Store} from './storage.js';
import {assertNotIsolated} from './isolation.js';

export async function bindDirect(store:Store,op:Operation,registry:Registry,testMode:boolean):Promise<Session> {
  const requested=op.args.projectPath;
  if(!path.isAbsolute(requested))throw new DomainError('failed','ABSOLUTE_PATH_REQUIRED','工程必须使用绝对路径');
  const actual=await fs.realpath(requested);
  if(!testMode&&path.extname(actual).toLowerCase()!=='.project')throw new DomainError('unsupported','PROJECT_FORMAT','仅接受 .project 工程');
  const stat=await fs.stat(actual,{bigint:true});
  if(!stat.isFile())throw new DomainError('failed','PROJECT_FORMAT','工程必须是普通文件');
  await assertNotIsolated(store,undefined,[requested,actual]);
  // Match the actual editable file only. A copy's source alias must never redirect
  // project_open to that copy. Existing copy bindings retain their provenance.
  const resolved=await Promise.all(registry.projects.map(async s=>({s,actual:await fs.realpath(s.workingPath).catch((e:any)=>{if(e.code==='ENOENT')return undefined;throw e;})})));
  let selected=resolved.find(row=>row.actual&&pathKey(row.actual)===pathKey(actual))?.s;
  for(const s of registry.projects) {
    if(s===selected)continue;
    const other=await fs.stat(s.workingPath,{bigint:true}).catch((e:any)=>{if(e.code==='ENOENT')return undefined;throw e;});
    if(other&&stat.ino!==0n&&other.dev===stat.dev&&other.ino===stat.ino)
      throw new DomainError('conflict','PROJECT_PATH_ALIAS','指定文件是另一已登记工程的文件别名；请使用已核实的实际路径');
  }
  if(!selected)selected=(await store.operations()).find(o=>o.tool==='project_open'&&o.project&&
    ['APPLICATION_SELECTION_REQUIRED','APPLICATION_NOT_FOUND'].includes(o.response?.error?.code||'')&&pathKey(o.project.workingPath)===pathKey(actual))?.project;
  if(selected) {
    if(selected.directPath&&pathKey(selected.directPath)!==pathKey(actual))throw new DomainError('conflict','PROJECT_PATH_CHANGED','原直接编辑绑定的实际路径已变化');
    selected={...selected,editMode:'direct',directPath:actual};
  }
  else {
    await store.acquire(actual);
    const hash=digest(await fs.readFile(actual));
    selected={projectId:randomUUID(),sessionId:randomUUID(),storageMode:'direct',editMode:'direct',directPath:actual,
      sourcePath:actual,workingPath:actual,sourceHash:hash,diskHash:hash};
  }
  // Preserve the chosen identity before dispatch, including a failed first open.
  op.project={...selected};await store.saveOp(op);
  return selected;
}

export async function guardDirect(store:Store,s:Session) {
  await store.acquire(s.sourcePath);
  await store.acquire(s.workingPath);
  const actual=await fs.realpath(s.workingPath);
  if(!s.directPath||pathKey(actual)!==pathKey(s.directPath))throw new DomainError('conflict','PROJECT_PATH_CHANGED','工程实际路径已变化，未派发');
  for(const suffix of ['.lock','.lck','.~lock','.~u']) {
    const exists=await fs.lstat(s.workingPath+suffix).then(()=>true,(e:any)=>{if(e.code==='ENOENT')return false;throw e;});
    if(exists)throw new DomainError('conflict','PROJECT_BUSY','工程存在外部占用标记；请先确认保存并正常关闭，不会接管或删除标记');
  }
  const current=digest(await fs.readFile(s.workingPath));
  if(!s.diskHash||current!==s.diskHash)throw new DomainError('conflict','PROJECT_FILE_CHANGED','指定工程在外部发生变化，未派发；请核对文件和原登记');
  return current;
}
