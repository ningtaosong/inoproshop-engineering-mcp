import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainError,type Reply} from './contracts.js';
import {assertNotIsolated} from './isolation.js';
import {pathKey,digest,codeHash,type Store,type Operation,type Registry,type Session} from './storage.js';

export const AM610_PRESET='am610-minimal-v1';
const exists=async(p:string)=>fs.lstat(p).then(()=>true,(e:any)=>{if(e.code==='ENOENT')return false;throw e;});
// Resolve the existing ancestor before creating directories. Do not invent a
// Session/source hash for a file that does not exist yet.
export async function reserveProject(store:Store,op:Operation,r:Registry) {
  const input=op.args.projectPath;
  if(!path.isAbsolute(input) || (process.platform==='win32'&&!/^[A-Za-z]:[\\/]/.test(input)))
    throw new DomainError('failed','ABSOLUTE_PATH_REQUIRED','新工程须为本机盘符完整绝对路径');
  const parts=input.slice(path.parse(input).root.length).split(/[\\/]/);
  if(parts.some((s:string)=>!s||s==='.'||s==='..'||/[<>:"|?*\x00-\x1f]/.test(s)||/[. ]$/.test(s)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s)) || path.extname(input).toLowerCase()!=='.project')
    throw new DomainError('failed','CREATE_PATH_INVALID','仅接受无路径别名/特殊段的 .project 新文件路径');
  let ancestor=path.dirname(input);const tail:string[]=[];
  while(!await exists(ancestor)){tail.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}
  const parent=path.join(await fs.realpath(ancestor),...tail),target=path.join(parent,path.basename(input));
  if(pathKey(target)!==pathKey(input))throw new DomainError('conflict','CREATE_PATH_ALIAS','指定新路径包含目录别名；请使用已核实的实际完整路径，不会静默重定向');
  await assertNotIsolated(store,undefined,[input,target]);
  if(r.projects.some(s=>[s.sourcePath,s.workingPath].some(p=>pathKey(p)===pathKey(target))))
    throw new DomainError('conflict','CREATE_PATH_REGISTERED','指定路径已有工程登记；请核对后使用 project_open');
  await store.acquire(target);
  op.creation={projectId:randomUUID(),sessionId:randomUUID(),projectPath:target,preset:AM610_PRESET};
  await store.saveOp(op);
  await guardNewPath(target);
  await fs.mkdir(parent,{recursive:true});
  if(pathKey(await fs.realpath(parent))!==pathKey(parent))throw new DomainError('conflict','CREATE_PATH_CHANGED','新工程父目录实际路径已变化，未派发');
  await guardNewPath(target);
  return target;
}
export async function guardNewPath(target:string) {
  if(await exists(target))throw new DomainError('conflict','PROJECT_ALREADY_EXISTS','目标已存在；不会覆盖，请使用 project_open');
  for(const suffix of ['.lock','.lck','.~lock','.~u'])if(await exists(target+suffix))
    throw new DomainError('conflict','PROJECT_BUSY','目标存在占用标记；未接管或删除标记');
}
export async function createdSession(store:Store,op:Operation,result:Reply):Promise<Session|undefined> {
  if(result.operationId!==op.operationId)throw new DomainError('unknown','RESULT_ID_MISMATCH','新建结果与原操作不匹配');
  if(result.status!=='succeeded')return;
  const c=op.creation,d=result.data as any,e=d?.creationEvidence;
  const invalid=()=>{throw new DomainError('unknown','CREATE_EVIDENCE_INVALID','新工程创建、路径或保存重开证据不完整，保留文件并冻结');};
  if(!c||!e||d.projectPath!==c.projectPath||e.preset!==AM610_PRESET||e.publishedExclusively!==true||e.reopened!==true||e.noBusinessCopy!==true||
    e.device?.type!==4102||e.device?.id!=='10f4 0002'||e.device?.version!=='3.5.11.11'||
    !Array.isArray(d.applications)||d.applications.length!==1||e.applicationId!==d.applications[0].applicationId||
    e.plcPrg?.pouType!=='program'||e.plcPrg?.declaration!=='PROGRAM PLC_PRG\nVAR\nEND_VAR'||e.plcPrg?.implementation!==''||
    e.plcPrg?.contentHash!==codeHash(e.plcPrg?.declaration??'',e.plcPrg?.implementation??'')||
    e.task?.interval?.toLowerCase()!=='t#20ms'||e.task?.kind!=='Cyclic'||e.task?.calls?.length!==1||e.task.calls[0][0]!=='PLC_PRG'||
    !/^[a-f0-9]{64}$/.test(d.snapshot??'')||!/^[a-f0-9]{64}$/.test(d.diskHash??'')||d.postExitDiskHashObserved!==true||e.savedDiskHash!==d.diskHash)invalid();
  const actual=await fs.realpath(c!.projectPath);
  if(pathKey(actual)!==pathKey(c!.projectPath)||digest(await fs.readFile(actual))!==d.diskHash)invalid();
  const registry=await store.registry();
  if(registry.projects.some(s=>s.projectId!==c!.projectId&&pathKey(s.workingPath)===pathKey(actual)))invalid();
  return {projectId:c!.projectId,sessionId:c!.sessionId,storageMode:'direct',editMode:'direct',directPath:actual,
    sourcePath:actual,workingPath:actual,sourceHash:d.diskHash,diskHash:d.diskHash};
}
