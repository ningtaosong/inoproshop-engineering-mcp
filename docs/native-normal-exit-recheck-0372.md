# 0.37.2 正常退出及单参数保存闭环复验

2026-11-24，基于用户对具体隔离计划和两阶段方案的明确确认，使用固定候选 `D:\InoPro-Fixed\0.37.2-a9d9a9a348a3`，来源 `a9d9a9a348a321893afe38595624748dd244771c`。0.37.2／38 工具；产品、Schema、初始化正文及日常入口本轮未改。本记录提交在 `codex/variable-edit-isolation`，不合并 main、不部署。先前实现、离线验证和受阻计划见[维护补修与准备](variable-edit-isolation.md)，正常退出实现见[0.37.1 说明](native-normal-exit-guard.md)。

**结论：正式隔离提交、限定真实 MCP 只读退出、一次 MainTask 周期修改的保存闭环均通过；验收执行有两处脚本错误，原始失败保留。** 没有 DSH CLI 模型任务或 Desktop 验收，也不证明原崩溃根因已解决。

证据目录：`D:\InoPro-NormalExit-Recheck-0372-20261124\evidence`。实际采用四个开发端 stdio 连接，均保存原始 initialize、tools/list、请求与结果；四个服务实例均通过 stdin EOF 正常退出，退出码 0、无信号，没有强制终止。

## 正式隔离与历史保全

正式维护入口提交计划 `e9297c3b-d9b3-4d86-912a-f3dd9b4d5a50` **一次**，`deduplicated=false`。提交前再次确认范围、文件身份及证据版本 `3edad265e30a6e3abdc7deb7609b9ffc0009c4a612212df333dfbcfb58f7ffdd` 未变。仅涉及：

- 原操作 `b1c4b21b-7884-4082-839e-0529b2645512`。
- 工程 `D:\InoPro-FBInterfaceInit-20261123-220000\mcp-project\AM610_FBInterfaceInit.project`，身份 `3318604606:281474980737811`；source/working 两个记录角色对应同一个路径。
- 原工程哈希 `2a6a0726e1cca45fb2134dd8863700829ef184c615d4d861d1666fb8e6fdd212` 保持。原操作仍 unknown，已有保存事实不撤销，不回滚、不重放或改写旧账本。

提交后正式派发守卫对该身份返回 `PROJECT_ISOLATED`，本轮没有打开封存工程。提交阶段核对的 31,938 项旧材料中，仅隔离账本发生正式预期更新；其他旧文件字节保持。新的隔离日志、锚点和回执独立保留，原受阻计划没有覆盖。

工程复验结束后，原操作账本、IPC、检查点、封存工程、其他历史记录及私人配置字节继续保持。74个历史工程登记逐项保持，仅新增本轮两份工程并正常更新活动身份/登记版本。正常复验新增登记材料 266 个文件并更新 registry、service.lock；隔离账本已因授权提交更新。因此不能声称整个数据目录未变。没有手工删除锁或释放租约。最后观察无相关 IDE、DSH 或工程服务进程；服务锁及两份测试工程来源锁按正式机制留存为 stale，原封存工程来源锁也保持。stale 不是原 unknown 成功的依据。

## 两个独立测试文件

两份文件均由已核验的中性种子唯一成员准备，没有复制封存工程，也未覆盖已有路径。种子为 `D:\InoPro\deliveries\InoPro-review-20261109-132658.zip` 的 `projects/AM610_Minimal_MCP.project`，归档 SHA-256 `c67abad48bef4bc410d72020d89f1452772f04a007f4622e490c90e815d597f0`，成员 SHA-256 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。提取仅为获准测试准备，不改变产品直接编辑指定路径的流程。

| 阶段 | 实际路径 | 结果 |
| --- | --- | --- |
| 只读 | `D:\InoPro-NormalExit-Recheck-0372-20261124\readonly\AM610_NormalExit_ReadOnly.project` | 直接打开、读取 MainTask 成功；主文件仍为种子哈希，无编译或保存调用 |
| 单参数 | `D:\InoPro-NormalExit-Recheck-0372-20261124\write\AM610_NormalExit_OneParameter.project` | MainTask 实读20 ms后，仅改为25 ms；工具保存关闭重开、保存版编译及最终读回通过 |

两份目录都由 IDE 新增两个 `.opt` 和一个 `.projectbackup`，在 `engineering-files-summary.json` 中单列内容哈希、长度和时间。只读工程主文件未变，不代表目录无变化。写入工程最终主文件 SHA-256：

`cf268524312340395022604dd0da319245faf15fbaa130f71a1dd73b9637fe68`

## 实际操作与退出证据

每条真实操作均独立核对原 request、requestId、指纹、launchId、PID 创建身份、process-start、process-exit，以及 preflight / queue / queued / callback / dispatch / returned。生产 `exitVerdict` 和 `normalCloseVerdict` 均通过，非 legacy，公开关闭各派发一次；9个 IDE 实例全部退出码0、无信号。接口返回或结果文件本身不作为唯一完成证明。

| 用途 | 工具 | operationId | IDE PID |
| --- | --- | --- | --- |
| 只读打开 | project_open | `85b4e7eb-fd71-4359-b916-0b8863f82a70` | 44620 |
| 只读任务 | task_inspect | `55f43955-1020-4f6e-a0bd-8431b72c13fb` | 55512 |
| 写前打开 | project_open | `823ad467-6d3e-477a-9ba2-cec861f20134` | 58992 |
| 写前任务 | task_inspect | `98479c9c-a1f5-40ee-92cc-6ad279f01e4d` | 42484 |
| 写前源码 | object_read | `60f0c06a-6d0b-43b1-8f8b-a6883a24a09b` | 38068 |
| 唯一周期修改 | task_config_update | `c67c20ca-3e23-4fde-abce-370c5683ca3f` | 47612 |
| 保存版编译 | project_build | `4b02122a-ecc6-4ad4-90ec-f3183ca039c7` | 14548 |
| 最终任务 | task_inspect | `72797a19-2d0f-46fe-80c3-04678c5f3969` | 54192 |
| 最终源码 | object_read | `42648fb5-2471-481f-9111-ef11f6efc18a` | 50684 |

MainTask 身份 `78d0f4f0-33ac-4194-ab0a-f8f8fdb32867`，仅 `interval` 从 `t#20ms` 变为 `t#25ms`。唯一调用仍为 `PLC_PRG`，空备注及程序绑定保持；优先级1、看门狗关闭、其余原生任务字段未变。程序对象 `76817b8e-cf3d-4b51-82a0-fb6e8bc7c778` 的身份、路径、声明和实现逐项保持，完整源码快照也保持。

写后和同进程保存重开后的原生任务/PROGRAM 清单均已核对；最终读取通过其他 IDE 进程。集合只按既有 taskId/objectId 身份对齐，内部调用仍有序比较，没有提供调用重排能力。

正式 task_config_update 仅一次，`saveAttempts=1`；没有独立 project_save，也没有恢复性保存。其后实际编译一次，`completed=true`、`diagnosticsComplete=true`、`buildPassed=true`，**0错误／0警告**。编译的 diskHash 与上述最终文件完全一致，taskConfigurationVersion 为 `3fda5e2de58e75a8b155acb6978b827e1744ecd1287f7c3c65da73023c0df1e8`。后续只读没有改变主文件，不需为计数追加复编。

## 两处验收脚本错误，不改写首败

1. 写前源码读取成功，但第一版验收脚本误要求 `objectType=program`。固定产品实际契约为 `objectType=st_pou`、`pouType=program`；原生类型和声明头证据齐全。此时三次只读操作全部正常退出，尚未修改、保存或编译。原脚本、failure.json 和协议保留。按契约修正独立验收脚本，归档正例及7个字段反例8/8通过，不修改产品；已成功读取按文件SHA引用，未重放。
2. 唯一修改已经成功后，验收脚本的 project_build 漏传 requestId，MCP 返回 `-32602` 输入拒绝，没有创建编译操作或启动编译 IDE。该拒绝不是编译失败，更没有可填写的错误/警告计数。保留原请求、原返回及停止记录；后续脚本只补齐尚未执行的编译与最终只读收尾，按固定 Schema 核对6种请求及原拒绝反例7/7，并限制实际工具集合和编译次数。没有再次调用修改或保存。

四版实际验收脚本均单独保存并记录指纹，不覆盖先前版本。独立复核后在同一个授权文件继续，没有换夹具或数据目录。这两组离线检查仅验证验收脚本，不是产品全量回归；本轮没有重跑无关回归。工程闭环通过不等于验收执行首次即无误。

原始协议共14次 operation_status，全部只查本轮原操作；没有历史状态查询或 reconcile。两次 project_build 请求中仅后一次进入真实编译。四个连接均实际返回0.37.2及完整38项工具，原始 initialize正文64,404字节；含客户端标题的静态口径仍64,431／65,536。没有 CLI 模型、Desktop 日常连接或完整指令进入模型上下文的证据。

## 交付边界

当前可确认固定0.37.2产品在这两份独立 AM610 文件上的正常退出、单参数保存闭环和正式维护隔离机制。不能改判原0.38失败、原两个prepare unknown，或宣称已解决原崩溃全部根因；未进行0.38 FB初始化真实复验。

未连接 PLC，未下载、运行或仿真。25 ms 是配置周期，实际调度未观测。历史 unknown、旧账本、隔离、锁、默认环境性能、CmpLog、脚本信任、Desktop欢迎页及运行验证限制继续保留。日常0.37.0固定入口和Codex配置保持，本分支未合并或部署。
