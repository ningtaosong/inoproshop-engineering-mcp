// Deliberately outside MCP. No default commit and no IDE adapter import.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { evaluateIsolation,generatePlan,commitIsolation } from './isolation.js';
import { canonical,digest,pathKey } from './storage.js';
const [command='evaluate',...args]=process.argv.slice(2);
const option=(key:string)=>{const i=args.indexOf('--'+key);return i>=0?args[i+1]:undefined;};
const output=option('out');
async function checkOutput(root:string) {
  if(!output)return;
  const actualRoot=await fs.realpath(root),parent=await fs.realpath(path.dirname(path.resolve(output)));
  if(pathKey(parent)===pathKey(actualRoot)||pathKey(parent).startsWith(pathKey(actualRoot)+path.sep))throw Error('评估/计划/回执输出必须在现场数据目录之外（含路径别名）');
}
try {
  let result:any;
  if(command==='commit') {
    const file=option('plan');if(!file)throw Error('commit 必须显式提供 --plan');
    const r=JSON.parse(await fs.readFile(file,'utf8'));
    if(r.schemaVersion!==1||r.checksum!==digest(canonical(r.value)))throw Error('计划文件校验失败');
    await checkOutput(r.value.dataDir);
    result=await commitIsolation(r.value);
  }else {
    const root=option('data-dir');if(!root||!path.isAbsolute(root))throw Error('--data-dir 必须为绝对路径；不从 DSH 配置推断');
    await checkOutput(root);
    if(command==='evaluate')result=await evaluateIsolation(root,option('operation'));
    else if(command==='plan') {
      const op=option('operation'),reason=option('reason');if(!op||!reason)throw Error('plan 必须提供 --operation 和 --reason');
      const value=await generatePlan(root,op,reason);result={schemaVersion:1,checksum:digest(canonical(value)),value};
    } else throw Error('仅支持 evaluate、plan、commit；没有原工程恢复或重放命令');
  }
  const text=JSON.stringify(result,null,2)+'\n';
  if(output)await fs.writeFile(path.resolve(output),text,{flag:'wx'});
  else process.stdout.write(text);
}catch(e:any){process.stderr.write(JSON.stringify({status:'rejected',code:e.code??'MAINTENANCE_ERROR',message:e.message})+'\n');process.exitCode=1;}
