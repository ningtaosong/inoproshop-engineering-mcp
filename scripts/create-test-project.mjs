// 显式开发入口；既有测试工程保持原状。不是 MCP 任意执行工具。
import {access,readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {configuration,ROOT} from '../dist/adapter.js';
const source=path.join(ROOT,'.local/sample/Phase1Block.project');
if(await access(source).then(()=>true,()=>false)) {
  console.error('保留现有测试工程：'+source);
} else {
  await mkdir(path.dirname(source),{recursive:true});
  const config=configuration();
  const quote=(key,value)=>`--${key}="${value}"`;
  const child=spawn(config.executable,[quote('profile',config.profile),quote('runscript',path.join(ROOT,'bridge/create_tiny_block.py'))],{cwd:path.dirname(config.executable),windowsHide:true,windowsVerbatimArguments:true,shell:false,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const result=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/tiny-block.json'),'utf8'));
  if(code!==0 || !result.created || !result.saved) throw new Error('测试工程未确认创建保存；请检查 tiny-block 证据，不要覆盖已有内容');
  console.error('已创建测试工程：'+source+'；请继续 npm run test:ide 验证编译。');
}
