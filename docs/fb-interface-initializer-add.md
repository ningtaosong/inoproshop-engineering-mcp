# FB 输入／输出缺失显式初值补写

## 2026-11-24整合与新复验

继续原功能分支，正常合入main `769b513b4ec8559228da3dbc78e70cc5fa7b2af5` 的0.37.2保护，保持0.38.0／38工具。固定产品 `da82ae09d2e7fa960fe080a0754367aea0b6bdf4` 已取得[新独立工程的MCP六项及一次CLI两项补写闭环](fb-interface-initializer-recheck-0380.md)，各两次正式编译均0错误／0警告；额外查询、三条CLI截断和辅助审计首败保留。原失败操作保持unknown，获准具体隔离已于0.37.2复验轮正式提交；封存工程不打开。日常0.37.2与Codex入口不变。下文为此前实现和首次失败的原时点记录，不以本轮结果改写。

## 首次交付及失败记录（保留）

0.38.0 候选版／38 项工具，功能分支 `codex/fb-interface-initializer-add`，基于 main `be6850bf875a00d2a6321aef6adfc0090d59839a`。未合并、未部署；S4b 尚未全部完成。

## 限定用法

> 在指定工程的 FB_InitProbe 中，给 VAR_INPUT 的 DelayTime 补写 T#3s 初值。先确认原声明没有显式初值；保留其他源码、调用实参和子对象，编译并保存重开核对。

Agent 读取对象、Application、源码版本及原生 ST 身份，调用 variable_edit 的 add-initializer，显式传 section=VAR_INPUT 或 VAR_OUTPUT。用户不需填写内部标识。原声明须为普通用户 FUNCTION_BLOCK 中已有、唯一、完整、无修饰的目标区，目标是唯一 BOOL、DINT、TIME 单变量。只在可信分号前插入 ` := 字面量`，保留原文及 CRLF、注释、空白和其他源码。

已有初值（即使与请求相同）、重复区、修饰区、歧义、联合声明、AT、RETAIN/PERSISTENT、别名、数组、聚合、VAR_IN_OUT、Method/Property 内变量、非原生 FB/ST 或不完整解析均拒绝。省略 section 仍是原 VAR／根 GVL 范围；旧 add、set-initializer、set-type 和成员动作不扩展。其他37项工具及全部输出 Schema 不变；新参数组合只扩展 variable_edit 的 refinement。

输入初值是实例初始化，不改变显式调用实参或 PLC 当前值。此次不提供运行写值、类型/方向修改。

## 保护与证据

复用0.25接口区唯一性守卫和0.36完整声明插入规则。队列重读后，在实际写入句柄再次核对磁盘、源码、Application/FB/ST 身份。仅新 section+add-initializer 路径读取完整受支持 Method/Property/Get/Set 子树的原生身份、父关系、原文哈希及元数据，写后及保存重开严格核对。未知子对象、父关系异常、重复身份或读取缺口不会视为空子树。子对象身份目录不表示执行顺序，调用原文不排序。

检查点、去重、原始异常、unknown冻结及可信进程退出沿用现有机制。直接与旧副本路径均不反向写回或恢复性保存。拒绝和部分写入测试分别取证。历史隔离/unknown、默认环境200ms性能、崩溃根因、CmpLog、脚本信任、Desktop及PLC运行限制保留。

## 验证归属

实现与离线验证通过；真实 MCP 在第二次正式补写后遇到 IDE 异常退出并按规则停止，工程闭环未通过，CLI 任务未发送。日常入口保持0.37.0，Codex入口不改。

| 检查 | 结果与归属 |
| --- | --- |
| 产品实现及实际固定构建 | `0c05d28b62219909325a9e4d98b423ee36eb2a68`，0.38.0／38 工具；后续 `fdc5b6ac27f3caef9a966d5388cb1244dc3d60da` 仅文档与补充用例 |
| Node 完整回归 | 1108/1108，实现提交0c05d28；独立临时目录，不消除默认环境200ms历史问题 |
| Python 完整回归 | 633/633，同一实现；不与 Node 计数相加 |
| 补充定向 | 111/111，fdc5b6a 的测试补充，产品与0c05d28一致；不加入完整回归数量 |
| 构建、类型、IronPython | 通过；固定桥接由本机 IronPython 2.7.7 仅解析编译，不执行业务 |
| 契约 | 38项工具的 JSON输入／输出Schema哈希保持；仅 variable_edit 的运行时 refinement 接受新的 section+add-initializer 组合，旧动作规则保留 |
| 初始化指令 | 固定构建含客户端标题64,547/65,536字节；不是开发工作区CRLF口径。独立MCP连接确认0.38.0／38工具；没有CLI模型接收证据 |

此前规划器对显式接口区拒绝 add-initializer 是旧范围行为，`before-rejection.json` 留作新增能力对照，不解释成旧产品故障。原始测试及辅助脚本首败保留，未用后续通过覆盖。

## 真实 MCP 实际停点

两份工程均由原生 project_create 新建，使用 AM610 描述 `4102 / 10f4 0002 / 3.5.11.11`。各有 FB_InitProbe、Method ReadCount、Property Value/Get/Set、PLC_PRG 显式调用及 MainTask。准备阶段36次IDE操作均可信正常退出；每份准备工程两次编译各0错误、0警告，共四次，全部仅属于准备版。

正式阶段按计划依次执行输入BOOL、DINT、TIME及输出BOOL、DINT、TIME。实际只派发前两项：

| 正式操作 | 实际证据 | 结论 |
| --- | --- | --- |
| InputEnable / VAR_INPUT / BOOL := TRUE | `aab9ce49-35fc-4447-b181-e582e1ce222b`；原文最小插入、保存重开、四个子对象保全，preflight及写入进程均正常退出 | 本项 succeeded |
| InputCount / VAR_INPUT / DINT := 7 | `b1c4b21b-7884-4082-839e-0529b2645512`；桥接有保存、重开、最小插入及四子对象相等记录；preflight正常，写入PID53896、launchId `f2b62aa3-f84d-4671-a385-c299d4a3f62c` 退出3221226525（0xC000041D） | 正式结果 unknown / IDE_ABNORMAL_EXIT，不因桥接 succeeded 或文件哈希相符而改判 |
| 其余四次补写、正式编译、最终完整读回 | 未执行 | 不填写错误／警告数，不宣称六项通过 |
| DSH CLI | MCP前提未通过，任务提交0次；仅已完成配置组合和候选指纹预检 | 无模型调用或CLI工程结论 |

正式阶段13份实际IDE请求中12份正常退出、1份确认异常。执行脚本在状态断言处停止，原 `mcp/exit-verdicts.json` 只收集了停止前11条；事后只读 `all-exit-verdicts.json` 从本轮IPC补齐全部13份及准备36份，不覆盖原记录。两次正式补写桥接各记录一次保存；未调用额外 project_save、未编译，不能写成“未产生修改”。候选服务通过EOF正常退出0／无信号，当前无IDE或服务进程。新增未隔离unknown继续冻结后续派发；没有隔离、reconcile、恢复、回滚或手工清锁。

MCP现场（封存，不继续打开）：`D:\InoPro-FBInterfaceInit-20261123-220000\mcp-project\AM610_FBInterfaceInit.project`。停止时主文件SHA-256为 `2a6a0726e1cca45fb2134dd8863700829ef184c615d4d861d1666fb8e6fdd212`。桥接读回包含TRUE及7，但没有适用于该保存文件的正式编译证据，异常退出根因未定位。

CLI准备工程：`D:\InoPro-FBInterfaceInit-20261123-220000\cli-project\AM610_FBInterfaceInit_CLI.project`，SHA-256 `346fb6053f6b396d085a0bed17c929814f68dde1a3a5d39cd978b06c18384d7e`。准备后本轮未再打开，四项文件字节和修改时间均保持。

MCP主文件、projectbackup及用户.opt字节变化；AllUsers.opt只有修改时间变化。49,270项事前保全材料中没有非预期字节变化；登记及本轮租约按正常操作变化，旧租约原字节可在正式归档找到，不能说整个登记目录未变。五项历史隔离unknown、独立探测unknown、锁、IPC、检查点及日常DSH/Codex配置保留。原始阶段、退出、文件指纹和结果见复核包中的 `evidence/stop-review.json`、`evidence/all-exit-verdicts.json` 及 `evidence/mcp/`。

## 后续条件（首次失败时点）

当前仅交付实现、离线结果和真实失败现场；不具备本阶段工程验收通过或合并部署结论。新增unknown须按正式维护授权另行处理；本轮不提出或提交隔离。后续经复核及正式保护条件满足后，再独立安排未完成类型、输出区、编译与CLI验证，不能换路径绕过冻结。源码初值、调用实参和运行值仍是不同结论；PLC实际行为、Desktop及链接点击未验证。
