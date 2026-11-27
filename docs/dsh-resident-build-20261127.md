# DSH 常驻内存编译任务：读取后冲突停止（2026-11-27）

本次唯一业务任务**未完成修改和编译**。固定受验产品为 `02e50993aebb5c02a6fdb6e8bc1998cc8a1c292a`，0.41.0 候选／38 工具，目录 `D:\InoPro-ResidentBuild-Recheck-20261127\fixed-02e5099`。安装版 DSH 0.2.1-rc.5 官方 SDK 在同一正式连接取得初始化及完整工具清单；三项原生读取成功。模型没有等前一读操作终态便发额外 `variable_inspect`，收到 `conflict / PENDING_UNKNOWN` 后没有继续写入。没有新 unknown；没有编辑、编译、保存、关闭或第二次业务任务。本轮未执行编译，不填写错误和警告数。

[前一真实 MCP 复验](resident-build-scalar-recheck-20261127.md)的一次7秒内存编译0错误／0警告及独立读回仍保持原归属。本次失败不是新的编译失败，不能用旧MCP结果将本次DSH闭环判为通过。早期unknown、标量上下文首败和旧DSH两轮均保留原结论。

## 精确时序及直接错误

| UTC 时间／SDK序号 | 观察 |
| --- | --- |
| 02:43:21.543 | `project_open` 操作 `890a6073-6090-45ac-80d5-28568140849b` 开始 |
| seq64／02:44:00.511登记 | 原打开最后仍返回running时，模型提交 `object_list`：`1326c3bb-9b89-4b5b-9c57-9f7483f1bfe7`；实际原生按序执行 |
| 02:44:43.388 | `object_read` 操作 `2083265e-8dcb-4201-bcb6-f5854b7f7e51` 开始 |
| seq122、128、134 | 对该读取的三次查询均返回running；最后一次为02:44:54.281 |
| seq142／02:44:57.859 | 模型另外提交 `variable_inspect`，name为`Probe` |
| 02:45:04.720 | 原 `object_read` 账本记录succeeded终态 |
| seq143／02:45:06.668 | 额外变量查询返回 `conflict / PENDING_UNKNOWN`，无operationId、无原生派发 |
| seq148、149／02:45:19.477 | 冲突后，模型再查询一次本轮原读取，取得succeeded及完整5秒／FALSE原文 |
| seq153及turn/end | 原答复报告停止、未修改和未编译；SDK回合completed不等于工程目标通过 |

原错误为：`未派发：未决证据或目标身份无法确认：unresolved set changed during assessment`。它不是 `RESIDENT_TOOL_NOT_ADAPTED`。本轮没有返回目标GUID、源码或磁盘身份确实变化的证据。

受验代码中，`EngineeringService.accept` 先调用 `guardPending`；`assessPending` 读取未决记录、检查证据，再比较未决集合。`execute` 中的resident工具范围检查发生在其后。因而范围外的变量查询在本次先遭未决检查拒绝，未到范围检查。前一个读取在这段时间完成，与报错时间吻合；评估两端的输入及实时running集合未单独发布，不能将推测的内部交错写成已捕获的唯一原因，也不能认为全部历史unknown发生变化。此轮不改并发、隔离或准入守卫，不开放resident变量查询。

## 连接、原生读回与当前现场

| 对象 | 实际身份 |
| --- | --- |
| 官方SDK会话 | `dc141d88-28c4-4014-af22-b0f8505717b7` |
| 正式MCP连接 | `72960-c5b5496e-f7eb-4f79-a459-996e87c8e7be` |
| 官方SDK | PID61000／创建身份`639313441745201932` |
| MCP服务 | PID72960／创建身份`639313441767957126` |
| IDE | PID24836／创建身份`639313442253127005` |
| 原生launchId | `dc18680c-a312-4da2-9c41-c6a5558a9bff` |
| 有限验收驱动 | PID22724／创建身份`639313441725492118` |

三项原生请求序号1、2、3分别是inspect、list、read。原请求、requestId、指纹、进程创建身份、完成回执、结果与服务校验逐项对应，独立审计重新运行固定产品 `verifyResidentResult`，没有新工程派发。目录与后续读回的受检依赖一致；PLC_PRG仍是：

```st
PROGRAM PLC_PRG
VAR
    ProbeDelay : TIME;
    ProbeEnable : BOOL;
END_VAR
```

```st
// Native-created project: continued direct edit validation.
ProbeDelay := T#5s; // 离线测试延时设定
ProbeEnable := FALSE; // 离线测试使能
```

实际工程为 [AM610_ResidentBuild.project](D:/InoPro-ResidentBuild-Recheck-20261127/engineering/AM610_ResidentBuild.project)，完整路径 `D:\InoPro-ResidentBuild-Recheck-20261127\engineering\AM610_ResidentBuild.project`。磁盘SHA-256仍为 `ecc5978e7c5dd252e7531c570ca92e886b3b5a093ccde4db5392a97aea4742f6`。

复核时四个进程均保持运行，驱动停在`awaiting-next-explicit-instruction`，没有next-round或finish命令。IDE保持打开、内存5秒／FALSE，无本轮源码修改；没有新退出回执是本轮明确保持打开的状态，不能写成正常退出已验证。下一条业务仍须新指令，打包或说明补修不授权再次提交任务或关闭工程。

## 连接证据与流程判断

正式连接原始initialize为0.41.0，完整tools/list共38项，无续页；输入、输出Schema与既有固定产品相同。实际初始化原文65,135字节，客户端加标题65,162／65,536字节。官方SDK的system/message中存在完整固定正文；不据此声称服务商内部上下文或Desktop日常连接通过。

本次23次工具调用：environment_inspect 1、session_status 3、project_list 1、project_open 1、object_list 1、object_read 1、variable_inspect 1、operation_status 14。所有状态查询只指向上述三项当前操作，无历史查询或reconcile。唯一业务提示词、实际工具参数和原答复全部保留。

- **工程目标未完成**：只打开、列出和读取，0修改、0编译、0保存。
- **流程未完全通过**：未等终态便调用额外工程查询；还存在额外会话查询。冲突后只再观察本轮原读操作，无后续写入、重试或换工程。
- **答复主要结果准确，原因需限定**：正确报告仍为5秒／FALSE、未编译及保持打开。其“目标身份无法确认”来自通用错误消息，不是目标已损坏或GUID变化的独立结论。工程链接由模型据实际路径生成，未点击。
- project_list的49,933字符工具展示不能解析成完整JSON，原文保留；不据截断展示宣称登记清单全部展示。独立发现连接PID61572的`server/discover`返回-32601，未捕获退出事件；不能写成所有连接均成功。

## 限定说明补修与验证归属

说明补修提交 `05e7003637a0fe52ade9ca5c4292c693cb4502bc`，与本轮实际受验02e5099分开。原顶部已限定resident工具，但紧接及后续变量定位段未再次标明模式，两个变量工具的短说明也无resident边界。仅修改初始化文字及`variable_inspect`、`variable_usages`描述：明确仅batch；resident定位用object_list/read，running仅轮询原操作，succeeded后才发下一工程请求。没有改Schema、工具数量、队列、守卫、原生桥接、版本或数据。

构建、类型检查通过。静态逐项核对38项输入和38项输出完全一致，其他服务实现无差异；受验固定107文件仍与原清单一致。新正文含标题65,346／65,536字节，剩190字节。当前运行连接仍加载旧65,162字节正文，未热更新、未重发任务，说明补修的模型遵循效果待另验。不将静态核对写成新的连接或真实工程验收。

另有本轮验收正常收尾辅助函数16/16离线检查，覆盖“旧IDE正常退出→服务仍活时核对→官方shutdown/EOF→退出后再核对”的顺序。此辅助检查不是产品全量回归或本次业务成功证据。未重跑全量测试、Python或真实工程验收。准备过的成功专用`audit-round.mjs`没有执行；实际使用`audit-stopped-round.mjs`核对停止结果。一次本地读取命令因多余方括号解析失败，未读写工程，修正后只读分析；原取证命令失败单列保留。

## 旧实例正常移交与保全

本次业务前，按明确授权不保存正常关闭前一MCP测试IDE72140，旧内存7秒未写回，保存文件保持5秒／FALSE。随后旧驱动只提交一次finish，通过正常EOF完成旧服务移交。Windows进程句柄观察到IDE72140、MCP67608、驱动71748均退出0；原生退出回执及生产关闭证明覆盖旧8项请求。保存提示的已授权“不保存”维护单独记录，不混入本次模型工程操作；本次未启动或处理DSH Desktop。

新SDK启动前保全22,485份登记材料。本轮后仅活动`registry.json`及`service.lock`字节更新，其余既有操作账本、IPC、检查点、隔离等材料无缺失或字节改变。三项新成功账本及IPC另计，不称整个目录未变。七份原工程文件内容不变，projectbackup修改时间变化；新建`.~u`占用文件另列，保持原样。

继续使用 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。没有手工删锁、清租约、改判旧unknown或隔离；本轮未更改日常DSH/Codex入口、账号或配置。旧默认性能、CmpLog、脚本信任、崩溃根因、Desktop欢迎页及PLC运行均保持原边界。源码赋值与编译证据不等于实际计时或调度。

## 复核入口与下一步

本地记录根：`D:\InoPro-DSH-ResidentBuild-20261127`。包内提供`stopped-round-audit.json`、原SDK协议和答复、正式连接原始清单、三个原生请求及服务校验、维护退出证明、文件保全清单、说明补修差异、构建／类型／契约／字节检查。私有账号配置不入包，仅保留脱敏摘要和指纹。新增相对链接通过；agent.md中两条既有`.local/new-build-test-review-20261109`历史链接在当前工作区缺失，单列保留，未扩展修改旧记录。

前一成功MCP复核包 `D:\InoPro\deliveries\InoPro-review-20261127-103012.zip`，SHA-256 `0ecb7f34b1de973ce52ba9bc2d4e7515df06e2e5a213f0ddaa840ad3e01f38bf`，保持独立归属。本轮仅推送功能分支，未合并main或部署。后续若验证新说明，须另行明确业务及现有实例的处理决定；不以本轮首败为理由自动重发、放宽准入或增加隔离／并发框架。
