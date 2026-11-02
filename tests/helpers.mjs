import { mkdtemp,writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
export const app='10000000-0000-4000-8000-000000000001';
export const app2='10000000-0000-4000-8000-000000000002';
export const obj='20000000-0000-4000-8000-000000000001';
export const obj2='20000000-0000-4000-8000-000000000002';
export async function setup(extra={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'InoPro 中文 测试 '));
  const source=path.join(dir,'原工程.json');
  await writeFile(source,JSON.stringify({testFixture:true,applications:[{applicationId:app,path:['设备','应用一']},{applicationId:app2,path:['设备','应用二']}],objects:[
    {objectId:obj,applicationId:app,path:['设备','应用一','Main'],declaration:'PROGRAM Main\nVAR\n计数: INT;\nEND_VAR',implementation:'计数 := 计数 + 1; // 中文'},
    {objectId:obj2,applicationId:app2,path:['设备','应用二','Main'],declaration:'PROGRAM Main\nVAR\nEND_VAR',implementation:'// 另一个同名对象'}
  ],...extra}));
  return {dir,source,dataDir:path.join(dir,'服务数据')};
}
export async function connect(dataDir,extraEnv={}) {
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/server.js')],cwd:process.cwd(),env:{...process.env,INOPRO_DATA_DIR:dataDir,INOPRO_TEST_MODE:'fixture',INOPRO_RESPONSE_WAIT_MS:'15',...extraEnv},stderr:'pipe'});
  let stderr=''; transport.stderr?.on('data',b=>stderr+=b.toString());
  const client=new Client({name:'phase1-contract-tests',version:'1.0.0'});
  await client.connect(transport);
  const call=async(name,args={},options)=> (await client.callTool({name,arguments:args},undefined,options)).structuredContent;
  const done=async result=> {
    for(let i=0;result.status==='running' && i<200;i++) {
      await new Promise(r=>setTimeout(r,15));
      result=await call('operation_status',{operationId:result.operationId});
    }
    return result;
  };
  return {client,transport,call,done,stderr:()=>stderr};
}
