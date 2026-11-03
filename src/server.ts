import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { configuration, IdeAdapter, ROOT } from './adapter.js';
import { FixtureAdapter } from './fixture-adapter.js';
import { EngineeringService } from './service.js';
import { schemas, outputSchemas, reply, DomainError, VERSION } from './contracts.js';
import {toolOutput} from './native-output.js';

const config=configuration();
if(!Number.isFinite(config.timeoutMs)||config.timeoutMs<100||!Number.isFinite(config.responseWaitMs)||config.responseWaitMs<1)
  throw new Error('超时配置无效');
const service=new EngineeringService(config,config.testMode?new FixtureAdapter():new IdeAdapter(config));
const instructions=await readFile(path.join(ROOT,'instructions','inoproshop-workflow.md'),'utf8').catch(()=> '先查询环境和会话；读取后携带哈希修改；编译、保存并重新打开核对。');
const server=new McpServer({name:'inoproshop-engineering',version:VERSION},{instructions,maxToolInputElements:1000});
const descriptions:Record<string,string>={
  environment_inspect:'读取本机路径、版本和实测能力；初始化不会修改工程。',
  session_status:'查询受管理工程、Application 及未决请求，不进入工程队列。',
  project_list:'只读列出本数据目录已登记工程、实际副本、应用选择和各自最后确认状态；不启动 IDE。',
  project_open_copy:'新源创建独立副本并激活；已登记源或副本复用原副本，核对成功后切换。禁止覆盖源工程。',
  project_activate:'按已查询的 projectId 核对并激活原工作副本；有未决操作时拒绝，失败保留原活动工程。',
  object_list:'分页列出精确应用的 ST POU 及根节点 GVL/结构体 DUT；POU 的 pouType 区分功能块/程序/函数，保留真实 GUID、完整路径和有无实现。',
  object_read:'精确读取支持的 ST 对象及内容哈希；GVL/结构体只有声明，implementation 为空串且 hasImplementation=false。',
  project_search:'只读字面量搜索选定工程/应用中支持的对象名称、声明和实现。明确大小写、范围/失败/跳过、位置/上下文、截断和分页；续页带 expectedVersion。文本命中仅候选引用，不是语义分析。',
  task_inspect:'只读精确 Application 的真实任务身份、类型、优先级、周期/单位、看门狗与顺序调用；不可读字段单列，仅唯一核实的 PROGRAM 关联 GUID。配置不代表运行观测。',
  project_compare:'只读工程版本对比。mode=capture 在一次受管理 IDE 读取中采集精确 Application 的支持源码与任务；origin=working-copy（默认）或 registered-source（登记源原文件，不是复用修改副本）。mode=compare 引用 baselineOperationId/targetOperationId 两个本工具成功采集记录，不接收自填源码；目标属于当前工程/应用，基线可属另一登记工程。按应用相对路径+类型匹配，不猜重命名。分页使用返回 nextOffset+expectedVersion；长变更预览可用 detail 按 itemIndex/changeIndex/side/offset 分段读取，不重启 IDE。不比较设备/I/O、其他对象或运行行为。',
  project_structure:'只读活动登记工程的原生对象树（含非 ST、未知类型），返回父子关系/实际 GUID/路径、覆盖缺口与截断。页面受条数及体积双重限制，按实际 nextOffset + expectedVersion 读取原清单，不重复启动 IDE。',
  device_inspect:'从结构定位用户指定 deviceId，默认只查目标设备，不扩展子设备。读取描述/离线参数，不代表固件或完整配置。页面受体积限制，长值以 valuePreview 返回（value=null，非原值缺失）；按实际 nextOffset + expectedVersion 翻页。按需带 expectedVersion 和 valueRead:{parameterIndex,offset,limit} 分段读取原值（UTF-16偏移，使用 valueDetail.nextOffset）；外层 offset=0，原 maxParameters 不变，全程复用原清单、不启动 IDE。',
  pou_create:'在精确 Application 根节点创建 ST FUNCTION_BLOCK、PROGRAM 或 FUNCTION；pouType 显式选择，FUNCTION 必须传 returnType=DINT 且同名声明首部为 DINT，其他类型不接收 returnType。支持声明/实现，检查快照/同名冲突和检查点，保存重开核对原生身份、类型首部及全文。PROGRAM 不自动加入任务；不覆盖对象。',
  declaration_create:'仅在精确 Application 根节点创建 GVL 或结构体 DUT。objectType=gvl|structure，只提交声明；快照、同名、检查点、新 GUID/真实类型及保存重开全文核对。',
  code_apply_change:'校验旧哈希、检查点、类型和全文。POU 提供声明/实现；GVL/结构体只写声明，implementation 省略或空串，可用 objectType 限定目标。保存重开核对。',
  project_build:'按 targetKind 编译精确 Application 或无设备工程对象池；pool 的 applicationId 必须为 null。返回本次快照和诊断完整性。',
  project_save:'校验预期全工程文本快照，保存并关闭重开核对。',
  operation_status:'查询持久化原操作；reconcile 只核对原结果，绝不重放。'
};
for(const [name,inputSchema] of Object.entries(schemas)) {
  server.registerTool(name,{description:descriptions[name],inputSchema,outputSchema:outputSchemas[name],
    annotations:{readOnlyHint:['environment_inspect','session_status','project_list','object_list','object_read','project_search','task_inspect','project_compare','project_structure','device_inspect'].includes(name),destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(args:any)=> {
      let result;
      try { result=await service.call(name,args); }
      catch(e:any) { result={...reply(e instanceof DomainError?e.status:'failed',e.message),error:{code:e.code || 'TOOL_ERROR',message:e.message}}; }
      return toolOutput(result);
    });
}
// 不监听客户端取消来中断 IDE；客户端可断开，原操作继续持久化。
const transport=new StdioServerTransport();
await server.connect(transport);
let shuttingDown=false;
async function shutdown() {
  if(shuttingDown) return; shuttingDown=true;
  const status=await service.status().catch(()=>undefined);
  const pending=status?.data?.pending as any[] | undefined;
  if(status?.status==='succeeded' && status.data?.writeFrozen===false && pending?.length===0) await service.store.release().catch(()=>{});
  await server.close();
}
server.server.onclose=()=>{ void shutdown(); };
process.on('SIGTERM',()=>{ void shutdown().finally(()=>process.exit(0)); });
process.on('SIGINT',()=>{ void shutdown().finally(()=>process.exit(0)); });
