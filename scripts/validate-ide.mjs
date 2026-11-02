// 使用官方 MCP 客户端执行真实 IDE 验收；默认失败即停止并保存证据，不回退到模拟。
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const source=process.argv[2] || 'D:\\InoPro\\.local\\sample\\Phase1Block.project';
const evidence=path.resolve('docs/evidence/ide-validation-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
const records=[];
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server.js')],cwd:process.cwd(),env:{...process.env,INOPRO_TEST_MODE:'',INOPRO_DATA_DIR:process.env.INOPRO_DATA_DIR || path.resolve('.local','ide-validation-'+randomUUID())},stderr:'pipe'});
let stderr=''; transport.stderr?.on('data',b=>stderr+=b.toString());
const client=new Client({name:'inoproshop-real-ide-validation',version:'1.0.0'});
let passed=false;
async function call(name,args={}) {
  let r=(await client.callTool({name,arguments:args})).structuredContent;
  records.push({name,args,result:r});
  const deadline=Date.now()+180000;
  while(r.status==='running' && Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,500));
    r=(await client.callTool({name:'operation_status',arguments:{operationId:r.operationId}})).structuredContent;
  }
  records.push({name:name+':final',result:r});
  if(r.status!=='succeeded') throw new Error(name+': '+r.status+' '+r.summary);
  return r.data;
}
try {
  await client.connect(transport);
  records.push({tools:(await client.listTools()).tools.map(x=>x.name)});
  await call('environment_inspect');
  const opened=await call('project_open_copy',{requestId:randomUUID(),sourcePath:source,...(process.env.INOPRO_APPLICATION_ID?{applicationId:process.env.INOPRO_APPLICATION_ID}:{})});
  const s=opened.session; const target={projectId:s.projectId,applicationId:s.applicationId,targetKind:s.targetKind || 'application'};
  const objects=await call('object_list',{...target,offset:0,limit:200});
  const selected=process.env.INOPRO_OBJECT_ID?objects.objects.find(x=>x.objectId===process.env.INOPRO_OBJECT_ID):objects.objects[0];
  if(!selected) throw new Error('未找到指定 ST 测试对象');
  const original=await call('object_read',{...target,objectId:selected.objectId});
  const baseline=await call('project_build',{...target,requestId:randomUUID()});
  if(!baseline.buildPassed || !baseline.diagnosticsComplete) throw new Error('基线工程没有确认编译通过，停止修改');
  const change={...target,objectId:selected.objectId,declaration:original.declaration};
  const bad=await call('code_apply_change',{...change,requestId:randomUUID(),expectedHash:original.contentHash,implementation:original.implementation+'\nINOPRO_PHASE1_BAD_TOKEN := ;'});
  const errors=await call('project_build',{...target,requestId:randomUUID()});
  if(errors.buildPassed!==false || !errors.diagnosticsComplete || !errors.diagnostics.some(x=>['error','fatalerror'].includes(x.severity))) throw new Error('可控语法错误未被真实诊断识别');
  const fixed=await call('code_apply_change',{...change,requestId:randomUUID(),expectedHash:bad.contentHash,implementation:original.implementation+'\n// 第一阶段验证：中文读写、编译、保存重开。'});
  const build=await call('project_build',{...target,requestId:randomUUID()});
  if(!build.completed || !build.diagnosticsComplete || !build.buildPassed || build.snapshot!==fixed.snapshot) throw new Error('修复后编译证据不完整');
  const saved=await call('project_save',{...target,requestId:randomUUID(),expectedSnapshot:build.snapshot});
  if(!saved.saved || !saved.reopened || saved.snapshot!==build.snapshot) throw new Error('保存重开证据不一致');
  if(!saved.buildApplicable) {
    const finalBuild=await call('project_build',{...target,requestId:randomUUID()});
    if(!finalBuild.buildPassed || !finalBuild.diagnosticsComplete || finalBuild.snapshot!==saved.snapshot || !finalBuild.postExitDiskHashObserved) throw new Error('最终磁盘快照未通过编译');
  }
  passed=true;
} catch(e) { records.push({error:e.message}); console.error(e.message); process.exitCode=1; }
finally {
  await mkdir(path.dirname(evidence),{recursive:true});
  await writeFile(evidence,JSON.stringify({executedAt:new Date().toISOString(),mode:'real-ide',passed,source,records,stderr},null,2));
  await client.close(); console.error('验收证据：'+evidence);
}
