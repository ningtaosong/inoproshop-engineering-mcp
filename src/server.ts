import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { configuration, IdeAdapter, ROOT } from './adapter.js';
import { FixtureAdapter } from './fixture-adapter.js';
import { EngineeringService } from './service.js';
import { schemas, outputSchemas, reply, DomainError, VERSION } from './contracts.js';
import {toolOutput} from './native-output.js';
import {placeholderClearDelivery} from './placeholder-clear-delivery.js';
import {libraryInspectDescription, libraryPlaceholderResolveDescription,libraryPlaceholderClearDescription} from './library-guidance.js';

const config=configuration();
if(!Number.isFinite(config.timeoutMs)||config.timeoutMs<100||!Number.isFinite(config.responseWaitMs)||config.responseWaitMs<1)
  throw new Error('超时配置无效');
const service=new EngineeringService(config,config.testMode?new FixtureAdapter():new IdeAdapter(config));
const instructions=await readFile(path.join(ROOT,'instructions','inoproshop-workflow.md'),'utf8').catch(()=> '先查询环境和会话；读取后携带哈希修改；编译、保存并重新打开核对。');
const server=new McpServer({name:'inoproshop-engineering',version:VERSION},{instructions,maxToolInputElements:1000});
const descriptions:Record<string,string>={
  folder_create:'仅在精确Application根节点创建原生文件夹。先project_structure取得organizationVersions[applicationId]和diskHash，分别传expectedStructureVersion/expectedDiskHash及parentId=Application；名称为单个IEC标识符。同名拒绝，不创建嵌套文件夹，不改名或覆盖。检查结构/磁盘、权限、写前检查点、去重、保存关闭重开及原生GUID/父链/源码/可读任务保持；空文件夹不伪造ST变化。部分结果不确定冻结，无自动回滚。返回实际object及新structureVersion。默认不比较。',
  object_move:'原生移动同一Application中已验证ST PROGRAM/FUNCTION/FUNCTION_BLOCK，在Application根与其直接原生文件夹间移动。先project_structure核对实际GUID/当前父/目标父，使用organizationVersions[applicationId]与diskHash传expectedStructureVersion/expectedDiskHash；objectId/sourceParentId/targetParentId精确绑定。支持带已支持Method及PUBLIC DINT只读Get或Get+Set属性的FB整体移动，子GUID/父链/源码/访问器结构保持；未知子对象拒绝。不移动GVL/DUT/任务/设备/系统/文件夹，不跨应用，不复制删除/重命名/转换，重名拒绝。同位置返回noOp，不调用移动/保存。成功须GUID保持、原路径消失、目标唯一、源码/可读任务及保存重开核对。旧页按磁盘版本重新首查；编译仍须真实新编译，非运行验证；默认不比较。',
  environment_inspect:'读取本机路径、版本和实测能力；初始化不会修改工程。',
  session_status:'查询受管理工程、Application 及未决请求，不进入工程队列。',
  project_list:'只读列出本数据目录已登记工程、实际工程路径、应用选择和各自最后确认状态；不启动 IDE。',
  project_create:'仅新建固定 AM610-CPU1608TP 最小预设：原生 OEM 向导、已安装设备描述4102/10f4 0002/3.5.11.11（非固件），空ST PLC_PRG，20ms周期MainTask调用PLC_PRG；含OEM标准支持节点/库。只需新的本机绝对.project路径，必要目录可创建，已存在/占用/登记冲突拒绝，不覆盖或改名。原生初始化暂存仅作操作证据，排他发布到指定路径后关闭重开核对并按直接模式登记，无第二份业务副本。不提供通用设备/任务/I/O编辑。requestId复用原操作；不确定时保留文件冻结，不删除重试，无创建前检查点/原子事务/自动回滚。后续project_open复用同一路径身份；编译仍须实际project_build，未要求比较不调用project_compare。',
  project_open:'默认直接打开指定 projectPath，后续修改保存回同一文件，不创建业务副本。已登记副本路径可按原身份同路径复用；不会按来源路径重定向到旧副本。外部占用/版本冲突停止，不接管外部 IDE。',
  project_open_copy:'新源创建独立副本并激活；已登记源或副本复用原副本，核对成功后切换。禁止覆盖源工程。',
  project_activate:'按已查询的 projectId 核对并激活原登记工程（保持直接/副本模式）；有未决操作时拒绝，失败保留原活动工程。',
  library_catalog:'只读列出当前本机原生已安装库，不需要工程身份。返回原生名称、版本、厂商、默认命名空间、仓库文件与精确身份；可用 query 过滤名称/厂商/版本/命名空间，按同一目录版本分页，或用 detailIdentity 取精确详情。过滤不是精确身份判定；读取不完整或截断明确标注。此查询不代表工程已引用、解析或运行加载。',
  library_reference_add:'把先由 library_catalog 精确查询的已安装库，加入当前 Application 的指定原生库管理器。需先用 library_inspect 取得完整直接引用和配置版本；提交两个查询操作引用、库身份、默认命名空间及当前磁盘哈希。写前重新核对目录和引用，冲突拒绝；同一精确引用为 no-op。写入后保存关闭重开及读回，部分结果不确定冻结，不自动安装、升级、删除或回滚。库变动后须重新编译；默认不做 project_compare。',
  library_placeholder_resolve:libraryPlaceholderResolveDescription,
  library_placeholder_clear:libraryPlaceholderClearDescription,
  object_list:'分页列出精确应用的原生PUBLIC ST void/DINT Method、PUBLIC DINT只读Get或可读写Get+Set的Property及独立访问器，保留父链及结构，不能仅凭Get/Set名称定位；以及ST POU和根节点GVL/结构体/普通枚举/一维定长数组DUT。保留真实GUID、完整路径、有无实现及未支持子对象缺口。',
  object_read:'精确读取支持ST对象及内容哈希。Property只有声明；Get/Set独立声明和实现，返回FB→Property→访问器父链、属性哈希与访问器结构/版本。readOnly=true要求唯一Get；false要求一个Get和一个Set，不转换或补建访问器。GVL/DUT无实现区，数组边界等来自声明解析，无独立getter。',
  project_search:'只读检索选定工程/应用的支持源码。matchMode默认literal：名称/声明/实现字面子串，包含注释和字符串，areas默认全部。identifier仅接受单个完整标识符，必须显式areas=[declaration,implementation]或其非空子集，不接受name/默认全区域、正则或成员表达式；按大小写选项匹配词元，跳过注释/字符串及已支持的直接地址，未知地址和其他词法缺口独立报告，不验证地址有效性或I/O映射。保留真实身份/原文UTF-16位置/内容版本、范围/读取失败/跳过、截断和分页。按实际nextOffset+expectedVersion及原模式/条件续页，复用原清单不启动IDE；旧检索版本须重新首查，损坏证据冻结。不是语义交叉引用、读写或安全删除/重命名分析。',
  variable_inspect:'只读精确Application的支持源码声明解析（非原生符号表/运行变量）。objectId限定对象，name为父变量/字段名子串筛选。可显式includeInitializerMembers=true提取最外层(Name := Expression)的直接成员，maxInitializerMembers默认200/最大2000且仅启用时可用；成员、名称、值均返回原文UTF-16范围，父变量保留，成员/缺口单独计数，memberExtraction与声明/读取/分页完整性分开。嵌套值只保留不展开、不求值或验证类型成员；重复/混合/限定名等报告缺口，普通括号表达式不当成员。未启用保持declaration-variables-v2及旧页身份。按实际nextOffset+expectedVersion及原选项/上限续页；长原文预览用同版本sourceRead:{objectId,offset,limit}取完整声明（外层offset=0，不新启IDE）。没有初始化不补默认或运行值；不核对I/O，不修改/编译/保存。',
  variable_edit:'限定变量级写入：add-initializer仅给原生ST PROGRAM/FUNCTION/FB普通VAR或根GVL VAR_GLOBAL中已有唯一BOOL/DINT/TIME单变量补写初值；须完整原文确认无显式初值，不传type/section/旧值或成员参数。已有初值即拒绝，旧set-initializer仍只改已有值；不创建变量或改变类型，保留原文、版本及异常保护。旧add及set-initializer省略section仍处理普通POU VAR或根GVL VAR_GLOBAL；显式VAR_INPUT/VAR_OUTPUT仅支持普通ST FB已有唯一声明块。set-member-initializer只修改已有显式聚合成员；add-member-initializer仅向根GVL已有完整非空具名聚合插入尚未显式初始化的直接BOOL/DINT/TIME字段，字段必须由同Application根ST结构体DUT确认。新动作不传expectedOldInitializer；两种成员动作均传name、memberName、typeObjectId、expectedTypeHash及工程/GVL/磁盘版本，拒绝已存在、歧义、嵌套、数组、特殊声明，不创建DUT字段。新set-type仅处理普通ST PROGRAM/FUNCTION/FB的VAR或根GVL VAR_GLOBAL中已有显式字面初值的单变量，原类型及目标类型限BOOL/DINT/TIME；必须同时提供目标type、initializer及expectedOldType、expectedOldInitializer，不接受section或成员参数，不自动转换旧初值或重构使用位置。服务重读完整声明，只替换类型与初值片段，拒绝联合、特殊、重复或不完整区；写入保护、去重、读回、unknown冻结保留。编译及保存仍需单独执行，默认不比较。',
  library_inspect:libraryInspectDescription,
  task_inspect:'只读精确 Application 的真实任务身份、类型、优先级、周期/单位、看门狗与顺序调用；不可读字段单列，仅唯一核实的 PROGRAM 关联 GUID。兼容新增configurationVersion（task-configuration-v1原生配置版本），与diskHash分别用于task_config_update的expectedTaskVersion/expectedDiskHash；原version含义不变。配置不代表运行观测。',
  task_config_update:'仅修改精确Application中已有Cyclic任务的周期/优先级。先task_inspect取得taskId、configurationVersion和diskHash，分别传expectedTaskVersion/expectedDiskHash。intervalMs为整数毫秒1..60000，priority为整数0..31；至少一项，省略保持原值，0不是缺省。固定原生字符串setter，校验实际任务配置及磁盘版本、检查点、去重、写后保存关闭重开核对，原值请求不调用setter或保存。不改类型/调用/看门狗/CPU，不新建删除任务；未知单位/读取不完整/只读/歧义拒绝。修改后旧编译失效，须真实新编译及保存版本核对；部分失败保留实际动作和现场，unknown停止，不回滚。配置不是实测调度，默认不比较。',
  task_create:'在已验证 AM610 Application 新建普通 Cyclic 任务，只绑定一个同 Application 已有根级 ST PROGRAM。task_inspect 当前 configurationVersion/diskHash 对应 expectedTaskVersion/expectedDiskHash；project_structure 的已有 task 父节点 parentId 是 taskConfigurationId；object_read 的 PROGRAM 定义 objectId/contentHash 对应 programId/expectedProgramHash。不要用同名调用节点 GUID。周期为整数毫秒 1..60000。检查点、原生写后保存关闭重开校验；成功后真实编译并核对保存版和任务读回，旧编译失效，不默认比较。重名、歧义、读回不完整或版本冲突停止。running 查询原操作，unknown 保留现场，不重复创建、删除任务或恢复性保存。配置周期不是实测调度。',
  task_call_replace:'在已验 AM610 的已有普通周期任务中，仅替换一条已有 PROGRAM 调用。先 task_inspect 取 taskId、目标 calls[].order 和完整 raw、configurationVersion、diskHash；project_structure 中任务节点的 parentId 为 taskConfigurationId。object_read 分别取得原、新根级 ST PROGRAM 定义的 objectId/contentHash（新目标用 programId/expectedProgramHash）。只改名称，保留中文或空备注、顺序、可读任务配置及源码；成功即已保存并关闭重开核对，再真实编译并核对保存版。running 查原操作，冲突或 unknown 停止。',
  task_call_append:'仅在已验证 AM610 3.5.11.11 Application 的已有普通周期任务末尾追加一个已有根级 ST PROGRAM。task_inspect 取 taskId、configurationVersion 和 diskHash；project_structure 取任务父节点 taskConfigurationId；object_read 取 PROGRAM 定义的 objectId/contentHash，勿用同名调用节点。重复目标、版本冲突及证据不完整时停止。原调用顺序、名称和注释不变，写后保存关闭重开核对。成功后编译保存版并确认读回；配置顺序未作运行观测。不执行替换、删除或重排。running 查原操作，unknown 保留现场并停止。',
  project_compare:'只读工程版本对比。mode=capture 在一次受管理 IDE 读取中采集精确 Application 的支持源码与任务；直接编辑用 origin=current-project；旧副本 working-copy 默认兼容。registered-source 只用于有独立来源的旧副本，直接工程拒绝；修改前快照是真实历史记录，不是修改后的文件。mode=compare 引用 baselineOperationId/targetOperationId 两个本工具成功采集记录，不接收自填源码；目标属于当前工程/应用，基线可属另一登记工程。按应用相对路径+类型匹配，不猜重命名。分页使用返回 nextOffset+expectedVersion；长变更预览可用 detail 按 itemIndex/changeIndex/side/offset 分段读取，不重启 IDE。不比较设备/I/O、其他对象或运行行为。',
  project_structure:'只读活动登记工程的原生对象树（含原生folder、非ST和未知类型），返回父子关系/GUID/路径、覆盖缺口与截断。兼容新增organizationScheme及organizationVersions[applicationId]，是结构修改使用的工程身份/原生稳定结构/源码版本，不是分页version；与diskHash分别绑定folder_create/object_move。版本采集失败保留原树并单列organizationFailures，缺少对应版本时不能写入或猜测对象不存在。页面按实际nextOffset+expectedVersion读原清单，不重复启动IDE。',
  variable_usages:'只读查询这条精确声明在普通 ST PROGRAM 简单赋值中的用法。先用 variable_inspect 定位唯一声明，复制条目的 objectId、section、name、contentHash、namePosition.startOffset/endOffset，用户不用填写 ID。限定局部 VAR、显式根 GVL 和直接结构体字段。行列和短原文可核对；usages 是静态推导，unknown 是未绑定候选，数组成员等不得归入目标，声明本身不计。核对 coverage；零结果只在已读且受支持范围内成立。按 nextOffset 与 version 续页，每页重新取证，不编译、不保存，不是原生绑定或重命名/删除建议。',
  device_catalog:'只读查询本机 InoProShop 设备仓库中已安装的描述，无需工程身份或活动工程，不打开工程。query 默认匹配原生型号名称，可用 field 搜索厂商、描述版本、原生类型、ID 或仓库来源。同名多版本分别报告。按实际 nextOffset + expectedVersion=version 续页，保持筛选；每页核对目录。详情用原生 type/id/deviceDescriptionVersion 原值。枚举失败、截断或字段缺失时仅报告实际读到的条目。设备描述版本并非 PLC 固件版本；固件未读取，也不证明工程使用该设备。',
  io_mapping_inspect:'只读查询已验 AM610 的 HIGH_SPEED_IO 连接器 2。打开指定工程后传 projectId；按 page.nextOffset 与 expectedVersion=version 取完各页，精确详情传同版 channelKey 为 detail。getter 为首项，完整列表及条数须看同状态导出和缺口。不提供声明绑定、最终自动地址、方向参照方或 PLC 运行值。',
  device_inspect:'从结构定位用户指定 deviceId，默认只查目标设备，不扩展子设备。读取描述/离线参数，不代表固件或完整配置。页面受体积限制，长值以 valuePreview 返回（value=null，非原值缺失）；按实际 nextOffset + expectedVersion 翻页。按需带 expectedVersion 和 valueRead:{parameterIndex,offset,limit} 分段读取原值（UTF-16偏移，使用 valueDetail.nextOffset）；外层 offset=0，原 maxParameters 不变，全程复用原清单、不启动 IDE。',
  method_create:'在精确Application的用户ST FUNCTION_BLOCK下创建原生ST Method。显式access=PUBLIC、returnType=void或DINT，完整METHOD PUBLIC同名声明和实现；parentId为实际FB GUID，expectedParentHash来自当前父FB全文，expectedSnapshot绑定全工程文本含子方法，expectedDiskHash绑定磁盘。仅同父子对象命名空间查重，不覆盖或改名。工厂create_method(name,return_type,ST)没有访问级别参数，PUBLIC由原生声明设定并经编译验证；无独立访问/返回getter。检查对象权限、检查点、写后及保存重开父关系/全文；不确定保留现场冻结，不自动回滚。后续读/改复用object_read/code_apply_change，修改显式objectType=method及parentId，不支持改名/改返回类型/访问级别。',
  property_create:'在精确Application的用户普通ST FB下新建原生PUBLIC DINT属性。未提供propertyMode或read-only仍为只读Get；只有显式propertyMode=read-write才创建可读写Get+Set，必须另提供setDeclaration、setImplementation。通用字段parentId=FB、expectedParentHash/expectedSnapshot/expectedDiskHash、name、access=PUBLIC、propertyType=DINT、完整同名PROPERTY PUBLIC声明及getDeclaration/getImplementation；访问器声明仅限定VAR局部区。固定工厂create_property(name,DINT,ST)默认两访问器；可写模式保留核对两者，只读模式仅清理本请求刚新建且原生身份/默认空内容已核实的Set。返回Property、getter及可写时setter，含原生GUID/父链、结构和版本。Set用属性名读取传入值，如State := CurrentState；Get以CurrentState := State返回。无独立访问/类型getter，证据为工厂/结构/声明及编译。访问器修改复用code_apply_change显式property_get或property_set、parentId=Property、fbId及全文/属性/结构/工程/磁盘版本；另一侧和父源码须保持。不改Property声明、不转换已有属性、不补建Set、不开放通用删除。不确定冻结，检查点/去重/保存重开沿用，无自动回滚，默认不比较，编译非运行观测。',
  pou_create:'在精确 Application 根节点创建 ST FUNCTION_BLOCK、PROGRAM 或 FUNCTION；pouType 显式选择，FUNCTION 必须显式传 returnType=DINT/BOOL/INT/REAL/TIME 之一，且同名声明首部返回类型匹配；PROGRAM/FUNCTION_BLOCK 不接收 returnType。不扩展其他创建返回类型，也不限制读取既有其他类型。支持声明/实现，检查快照/同名冲突和检查点，保存重开核对原生身份、类型首部及全文。PROGRAM 不自动加入任务；不覆盖对象。',
  declaration_create:'仅在精确 Application 根节点创建 GVL、结构体、普通枚举或一维定长数组 DUT。objectType=gvl|structure|enum|array，只提交完整同名声明。枚举成员须显式十进制整数-32768..32767，名称和值不重复；使用已验证的 DutType.Enumeration、空 baseType（IDE默认），不接受属性/显式基类型/表达式/继承。原生工厂、DUT身份、声明及全文读回为证据，无独立枚举/成员/基类型getter。数组仅同名TYPE声明、ARRAY [下界..上界] OF DINT，显式十进制0<=下界<=上界<=255、最多256项，无初始化/属性/表达式/其他别名；实际Alias工厂接收完整ARRAY类型。沿用快照、同名、检查点、去重及保存重开核对。',
  code_apply_change:'校验旧哈希、检查点、类型和全文。原生PUBLIC ST Method须显式objectType=method和精确parentId，声明/实现均提供，名称/访问/返回类型保持，不能改父关系。POU 提供声明/实现；GVL/结构体/普通枚举/一维定长数组只写声明，implementation 省略或空串，可用 objectType 限定目标；枚举沿用显式整数窄范围，数组修改沿用创建边界，不转换结构体/枚举/数组，不增加属性。保存重开核对。',
  project_build:'按 targetKind 编译精确 Application 或无设备工程对象池；pool 的 applicationId 必须为 null。返回本次快照和诊断完整性。',
  project_save:'校验预期全工程文本快照，保存并关闭重开核对。',
  operation_status:'查询持久化原操作；reconcile 只核对原结果，绝不重放。'
};
for(const [name,inputSchema] of Object.entries(schemas)) {
  server.registerTool(name,{description:descriptions[name],inputSchema,outputSchema:outputSchemas[name],
    annotations:{readOnlyHint:['environment_inspect','session_status','project_list','object_list','object_read','project_search','variable_inspect','variable_usages','task_inspect','library_inspect','library_catalog','device_catalog','project_compare','project_structure','device_inspect','io_mapping_inspect'].includes(name),destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(args:any)=> {
      let result;
      try { result=await service.call(name,args); }
      catch(e:any) { result={...reply(e instanceof DomainError?e.status:'failed',e.message),error:{code:e.code || 'TOOL_ERROR',message:e.message}}; }
      return toolOutput(placeholderClearDelivery(result,config.dataDir));
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
