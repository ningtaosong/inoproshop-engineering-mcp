import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DomainError, type Reply } from './contracts.js';
import { atomicJson, readJson, digest } from './storage.js';

export interface Config {
  dataDir: string; executable: string; profile: string; noUI: boolean;
  timeoutMs: number; responseWaitMs: number; testMode: boolean; fixture?: string;
}
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function configuration(env = process.env): Config {
  return {
    dataDir:path.resolve(env.INOPRO_DATA_DIR || path.join(ROOT,'.local','service')),
    executable:env.INOPRO_EXE || 'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe',
    profile:env.INOPRO_PROFILE || 'InoProShop(V1.9.1.6)',
    noUI:env.INOPRO_NO_UI==='true', timeoutMs:Number(env.INOPRO_TIMEOUT_MS || 120000),
    responseWaitMs:Number(env.INOPRO_RESPONSE_WAIT_MS || 800),
    testMode:env.INOPRO_TEST_MODE==='fixture',fixture:env.INOPRO_TEST_FIXTURE
  };
}
export interface BridgeRequest { operationId: string; command: string; projectPath: string; args: any; }
export interface Adapter {
  execute(request: BridgeRequest, directory: string, onStart: (pid:number)=>Promise<void>): Promise<Reply>;
  reconcile(directory: string): Promise<Reply | undefined>;
}
export class IdeAdapter implements Adapter {
  constructor(readonly config: Config, private readonly spawnProcess: typeof spawn = spawn) {}
  async execute(request: BridgeRequest, directory: string, onStart: (pid:number)=>Promise<void>): Promise<Reply> {
    try { await fs.access(this.config.executable); }
    catch { throw new DomainError('unsupported','IDE_MISSING',`未找到 InoProShop：${this.config.executable}`); }
    await fs.mkdir(directory,{recursive:true});
    const requestFile=path.join(directory,'request.json');
    await atomicJson(requestFile,{...request,resultPath:path.join(directory,'result.json'),checkpointPath:path.join(directory,'checkpoint.project')});
    const option=(name:string,value:string)=> {
      if(/["\r\n]/.test(value)) throw new DomainError('failed','INVALID_LAUNCH_ARGUMENT','启动参数包含不支持的引号或换行');
      return process.platform==='win32'?`--${name}="${value}"`:`--${name}=${value}`;
    };
    // 此 OEM 按 --key="value" 解析原始命令行；Node 将整个 --key=value 加引号的方式会丢失含空格参数。
    const args=[option('profile',this.config.profile),...(this.config.noUI?['--noUI']:[]),option('runscript',path.join(ROOT,'bridge','worker.py'))];
    const stdout=await fs.open(path.join(directory,'stdout.txt'),'a');
    const stderr=await fs.open(path.join(directory,'stderr.txt'),'a');
    let child;
    try { child=this.spawnProcess(this.config.executable,args,{cwd:path.dirname(this.config.executable),shell:false,windowsHide:true,windowsVerbatimArguments:process.platform==='win32',env:{...process.env,INOPRO_BRIDGE_REQUEST:requestFile},stdio:['ignore',stdout.fd,stderr.fd]}); }
    finally { await stdout.close(); await stderr.close(); }
    const completion = new Promise<number|null>((resolve,reject)=> { child.once('error',reject); child.once('exit',resolve); });
    // 在启动之后立即记录 PID；失败时调用仍被视为 unknown，不能重放。
    if(child.pid) await onStart(child.pid);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code=await Promise.race([completion,new Promise<never>((_,reject)=> {
        timer=setTimeout(()=>reject(new DomainError('unknown','IDE_TIMEOUT','IDE 超时；其操作可能仍在执行，未终止进程。请查询原操作并核对。')),this.config.timeoutMs);
      })]);
      const result=await this.reconcile(directory);
      if(!result) throw new DomainError('unknown','RESULT_MISSING',`IDE 已退出 (${code})，缺少完整结果，禁止重放`);
      if(result.data) {
        if(result.data.diskHash!==undefined)result.data.workerDiskHash ??= result.data.diskHash;
        result.data.diskHash=digest(await fs.readFile(request.projectPath));
        result.data.postExitDiskHashObserved=true;
        await atomicJson(path.join(directory,'observed-after-exit.json'),result);
      }
      return result;
    } finally { if(timer) clearTimeout(timer); }
  }
  async reconcile(directory: string): Promise<Reply | undefined> {
    const response=(await readJson(path.join(directory,'observed-after-exit.json'))) || (await readJson(path.join(directory,'result.json')));
    if(response===undefined) {
      const request=await readJson(path.join(directory,'request.json'));
      const dispatched=await readJson(path.join(directory,'dispatched.json'));
      if(request && !dispatched) return {contractVersion:'1.0.0',operationId:request.operationId,status:'failed',summary:'IDE 已退出，持久化派发标记尚未发布；工程命令未执行',error:{code:'NOT_DISPATCHED',message:'桥接保证发布派发标记后才访问工程；未重放原请求'}};
      return;
    }
    // 完整 Schema 由服务再验证；请求 ID 必须绑定当前 IPC 目录。
    const request=await readJson(path.join(directory,'request.json'));
    if(!request || response.operationId!==request.operationId)
      throw new DomainError('unknown','RESULT_ID_MISMATCH','桥接结果与原操作不匹配');
    if(['search','tasks','structure','device','libraries','compare_capture'].includes(request.command)) {
      if(response.status==='unknown'&&response.error?.code==='READ_ONLY_FILE_CHANGED')return response;
      const after=digest(await fs.readFile(request.projectPath)),e=response.data?.readOnlyEvidence;
      if(after!==request.args.readDiskHash || (response.status==='succeeded' && (!e || e.beforeDiskHash!==request.args.readDiskHash || e.afterCloseDiskHash!==after || e.unchanged!==true))) {
        const failed:Reply={contractVersion:'1.0.0',operationId:request.operationId,status:'unknown',summary:'只读操作的文件证据不一致，结果不可信，保持冻结',
          error:{code:'READ_ONLY_FILE_CHANGED',message:'未自动保存、恢复或重放；请核对原操作和文件'},data:{priorResult:response,expectedDiskHash:request.args.readDiskHash,observedDiskHash:after}};
        await atomicJson(path.join(directory,'observed-after-exit.json'),failed);return failed;
      }
      if(response.status==='succeeded') {
        response.data.workerDiskHash ??= response.data.diskHash;response.data.diskHash=after;
        response.data.readOnlyEvidence={...e,postExitDiskHash:after};response.data.postExitDiskHashObserved=true;
        await atomicJson(path.join(directory,'observed-after-exit.json'),response);
      }
    }
    return response;
  }
}
