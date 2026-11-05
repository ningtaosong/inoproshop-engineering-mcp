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
  object_list:'分页列出精确应用的 ST POU 及根节点 GVL/结构体/普通枚举/一维定长数组 DUT；枚举明确为 objectType=enum；POU 的 pouType 区分功能块/程序/函数，保留真实 GUID、完整路径和有无实现。',
  object_read:'精确读取支持的 ST 对象及内容哈希；GVL/结构体/普通枚举/一维定长数组只有声明，implementation 为空串且 hasImplementation=false；DUT按原生身份与实际声明区分，维数/边界/元素类型来自数组声明解析，不虚构独立DUT getter。',
  project_search:'只读检索选定工程/应用的支持源码。matchMode默认literal：名称/声明/实现字面子串，包含注释和字符串，areas默认全部。identifier仅接受单个完整标识符，必须显式areas=[declaration,implementation]或其非空子集，不接受name/默认全区域、正则或成员表达式；按大小写选项匹配词元，跳过注释/字符串及已支持的直接地址，未知地址和其他词法缺口独立报告，不验证地址有效性或I/O映射。保留真实身份/原文UTF-16位置/内容版本、范围/读取失败/跳过、截断和分页。按实际nextOffset+expectedVersion及原模式/条件续页，复用原清单不启动IDE；旧检索版本须重新首查，损坏证据冻结。不是语义交叉引用、读写或安全删除/重命名分析。',
  variable_inspect:'只读精确Application的支持源码声明解析（非原生符号表/运行变量）。objectId限定对象，name为父变量/字段名子串筛选。可显式includeInitializerMembers=true提取最外层(Name := Expression)的直接成员，maxInitializerMembers默认200/最大2000且仅启用时可用；成员、名称、值均返回原文UTF-16范围，父变量保留，成员/缺口单独计数，memberExtraction与声明/读取/分页完整性分开。嵌套值只保留不展开、不求值或验证类型成员；重复/混合/限定名等报告缺口，普通括号表达式不当成员。未启用保持declaration-variables-v2及旧页身份。按实际nextOffset+expectedVersion及原选项/上限续页；长原文预览用同版本sourceRead:{objectId,offset,limit}取完整声明（外层offset=0，不新启IDE）。没有初始化不补默认或运行值；不核对I/O，不修改/编译/保存。',
  library_inspect:'只读精确 Application 的各原生库管理器直接引用。保留名称/命名空间、占位符默认与当前解析原文、解析来源及读取缺口；不把已安装/已引用/已解析混为一谈，不递归、不主动解析/修复/下载。独立版本/厂商或加载状态不可取得时明确说明，不从显示串猜字段。按实际 nextOffset + expectedVersion 和原 maxReferences 翻页；长字符串仅预览，带 expectedVersion + fieldRead:{referenceIndex,field,offset,limit} 分段读原清单（外层 offset=0，不启动 IDE）。CmpLog直接未出现不证明间接依赖不存在或历史警告已解决。',
  task_inspect:'只读精确 Application 的真实任务身份、类型、优先级、周期/单位、看门狗与顺序调用；不可读字段单列，仅唯一核实的 PROGRAM 关联 GUID。配置不代表运行观测。',
  project_compare:'只读工程版本对比。mode=capture 在一次受管理 IDE 读取中采集精确 Application 的支持源码与任务；origin=working-copy（默认）或 registered-source（登记源原文件，不是复用修改副本）。mode=compare 引用 baselineOperationId/targetOperationId 两个本工具成功采集记录，不接收自填源码；目标属于当前工程/应用，基线可属另一登记工程。按应用相对路径+类型匹配，不猜重命名。分页使用返回 nextOffset+expectedVersion；长变更预览可用 detail 按 itemIndex/changeIndex/side/offset 分段读取，不重启 IDE。不比较设备/I/O、其他对象或运行行为。',
  project_structure:'只读活动登记工程的原生对象树（含非 ST、未知类型），返回父子关系/实际 GUID/路径、覆盖缺口与截断。页面受条数及体积双重限制，按实际 nextOffset + expectedVersion 读取原清单，不重复启动 IDE。',
  device_inspect:'从结构定位用户指定 deviceId，默认只查目标设备，不扩展子设备。读取描述/离线参数，不代表固件或完整配置。页面受体积限制，长值以 valuePreview 返回（value=null，非原值缺失）；按实际 nextOffset + expectedVersion 翻页。按需带 expectedVersion 和 valueRead:{parameterIndex,offset,limit} 分段读取原值（UTF-16偏移，使用 valueDetail.nextOffset）；外层 offset=0，原 maxParameters 不变，全程复用原清单、不启动 IDE。',
  pou_create:'在精确 Application 根节点创建 ST FUNCTION_BLOCK、PROGRAM 或 FUNCTION；pouType 显式选择，FUNCTION 必须显式传 returnType=DINT/BOOL/INT/REAL/TIME 之一，且同名声明首部返回类型匹配；PROGRAM/FUNCTION_BLOCK 不接收 returnType。不扩展其他创建返回类型，也不限制读取既有其他类型。支持声明/实现，检查快照/同名冲突和检查点，保存重开核对原生身份、类型首部及全文。PROGRAM 不自动加入任务；不覆盖对象。',
  declaration_create:'仅在精确 Application 根节点创建 GVL、结构体、普通枚举或一维定长数组 DUT。objectType=gvl|structure|enum|array，只提交完整同名声明。枚举成员须显式十进制整数-32768..32767，名称和值不重复；使用已验证的 DutType.Enumeration、空 baseType（IDE默认），不接受属性/显式基类型/表达式/继承。原生工厂、DUT身份、声明及全文读回为证据，无独立枚举/成员/基类型getter。数组仅同名TYPE声明、ARRAY [下界..上界] OF DINT，显式十进制0<=下界<=上界<=255、最多256项，无初始化/属性/表达式/其他别名；实际Alias工厂接收完整ARRAY类型。沿用快照、同名、检查点、去重及保存重开核对。',
  code_apply_change:'校验旧哈希、检查点、类型和全文。POU 提供声明/实现；GVL/结构体/普通枚举/一维定长数组只写声明，implementation 省略或空串，可用 objectType 限定目标；枚举沿用显式整数窄范围，数组修改沿用创建边界，不转换结构体/枚举/数组，不增加属性。保存重开核对。',
  project_build:'按 targetKind 编译精确 Application 或无设备工程对象池；pool 的 applicationId 必须为 null。返回本次快照和诊断完整性。',
  project_save:'校验预期全工程文本快照，保存并关闭重开核对。',
  operation_status:'查询持久化原操作；reconcile 只核对原结果，绝不重放。'
};
for(const [name,inputSchema] of Object.entries(schemas)) {
  server.registerTool(name,{description:descriptions[name],inputSchema,outputSchema:outputSchemas[name],
    annotations:{readOnlyHint:['environment_inspect','session_status','project_list','object_list','object_read','project_search','variable_inspect','task_inspect','library_inspect','project_compare','project_structure','device_inspect'].includes(name),destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(args:any)=> {
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
