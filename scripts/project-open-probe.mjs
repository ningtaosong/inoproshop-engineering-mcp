// One project_open only. Status polls refer to the original operation.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const [buildRoot,dataDir,target,out]=process.argv.slice(2);
if(![buildRoot,dataDir,target,out].every(Boolean))throw Error('Usage: node project-open-probe.mjs BUILD_ROOT DATA_DIR TARGET OUT');
await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const records=[];const save=async()=>writeFile(path.join(out,'mcp-open-record.json'),JSON.stringify(records,null,2));
const before=hash(await readFile(target));
const requestId=randomUUID();
records.push({stage:'prepared',at:new Date().toISOString(),buildRoot,dataDir,target,before,requestId});await save();
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(buildRoot,'dist/server.js')],cwd:buildRoot,
  env:{...process.env,INOPRO_DATA_DIR:dataDir,INOPRO_EXE:'D:\\InProShop\\CODESYS\\Common\\InoProShop.exe',
    INOPRO_PROFILE:'InoProShop(V1.9.1.6)',INOPRO_NO_UI:'false',INOPRO_TEST_MODE:''},stderr:'pipe'});
let stderr='';transport.stderr?.on('data',b=>{stderr+=b.toString();writeFile(path.join(out,'service-stderr.txt'),stderr).catch(()=>{});});
const client=new Client({name:'inoproshop-controlled-open-probe',version:'1.0.0'});
try{
  await client.connect(transport);records.push({stage:'connected',at:new Date().toISOString()});await save();
  const tools=(await client.listTools()).tools;records.push({stage:'tools',count:tools.length,names:tools.map(x=>x.name)});await save();
  let r=(await client.callTool({name:'project_open',arguments:{requestId,projectPath:target}})).structuredContent;
  records.push({stage:'project-open-response',at:new Date().toISOString(),response:r});await save();
  const original=r?.operationId,deadline=Date.now()+180000;
  while(r?.status==='running'&&original&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,1000));
    r=(await client.callTool({name:'operation_status',arguments:{operationId:original}})).structuredContent;
    records.push({stage:'original-operation-status',at:new Date().toISOString(),response:r});await save();
  }
  const after=hash(await readFile(target));records.push({stage:'final',at:new Date().toISOString(),status:r?.status??'unconfirmed',before,after});await save();
  console.log(JSON.stringify({status:r?.status??'unconfirmed',operationId:original,before,after,toolCount:tools.length}));
  if(r?.status!=='succeeded')process.exitCode=1;
}catch(e){records.push({stage:'client-error',at:new Date().toISOString(),error:String(e),outcome:'unconfirmed'});await save();process.exitCode=1;
  console.error(String(e));}
finally{await client.close();}
