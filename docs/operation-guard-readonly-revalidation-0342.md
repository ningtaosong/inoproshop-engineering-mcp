# 0.34.2 最小真实只读复验（2026-11-20）

本轮候选为 `dbb3e2bf6e3c38ce84722638c63fcbda791ab528`，产品实现归属 `2f6285c4937f1c274bc1ff4a3d7d36f1d5644f91`；依赖原 0.34.1 task_create 任务集合核对补修。本轮仅增加验收文档，产品、Schema、初始化指令和日常配置未改。

结论：六次已隔离历史查询无副作用；开发端两次真实只读操作均取得可信正常退出证据；唯一一次 DSH CLI 只读任务完成，实际模型请求含 37 项工具。CLI 协议观察器漏建日志目录，未保留原始 initialize/tools/list 数据包；该缺口单列，没有借用开发端握手冒充 CLI 握手。

## 条件与固定构建

- main 核对为 `5b3e5b06580c1ee6a981f4a3fafa46c767bc7513`；沿用 `codex/operation-reconcile-exit-guard`，保留其他工作区。
- 独立固定构建：`D:\InoPro-OperationGuard-Real-20261120-161934\fixed-0342`，从候选 Git archive 生成。53 个产品源文件与候选字节一致；构建、类型检查通过，37 项输入/输出 Schema 与前次 0.34.1 清单一致。
- 0.34.2 候选版、37 项工具；实际指令含客户端标题 63,036／65,536 字节。
- 原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。开始和结束均未运行 Desktop、日常工程服务；没有要求退出或启动 Desktop。
- 日常 DSH 与 Codex 配置前后 SHA-256 一致。临时 CLI 配置由上轮已验配置派生，保留三项账号服务、deepseek-account / deepseek-flash、原登记目录和 65,536 上限；私人配置未提交或打包。
- 未重跑全量回归。此前离线 Node 567/567、Python 248/248 仍归原实现和交付，默认环境 200 ms 失败不改判、不重测或降阈值。

## 正式隔离查询

通过候选的正式 isolationState 读取链，先核对本地账本、意向、全局锚点、证据摘要及操作/工程绑定，三项均有完整 committed 隔离归属：

| operationId | 隔离计划 |
| --- | --- |
| 7247cab3-a49a-4e3f-8ed5-73f47850a91f | 63d567cd-0bd3-4552-9e22-de60ddf13453 |
| 78715c58-ce22-44e9-9a98-ca87ef41c04e | 0e8d3bc9-8b75-498d-b59a-4e38dd2508c5 |
| b7c438ed-0d5c-43bb-b921-3ae5681f49a0 | c018a06f-0be7-49c3-904a-a331841a9f9c |

每项按 operationId 普通查询一次、reconcile=true 一次。每次返回原 unknown，finishedAt 未刷新。每次立即复核 1,533 项当前材料的字节摘要：历史操作、IPC、检查点、相关工程、登记、隔离账本/意向/锚点及原证据列出的租约；全部无变化。WMI 过程观察和即时进程检查均未发现这六次查询启动 IDE。

这不是恢复旧账本。三份在上一轮已被改写的账本以本轮开始的当前字节为基准，未改回旧值。两份有原文的差异与第三份缺少事前原文的缺口继续保留。本轮真实查询未覆盖 requestId 查询、隔离并发变化或损坏情形；这些仍只有原离线覆盖，不扩大真实结论。

后续四项新只读操作正常新增四份账本，登记 revision 1305→1309，活动工程切至本次指定工程，服务租约按既有机制更新。所有无关工程登记及原有历史账本/IPC/工程/隔离材料保持。不能把正常新登记变化误报成历史 reconcile 副作用，也不能宣称整个登记目录零变化。

## 开发端真实 MCP

工程：`D:\InoPro-TaskCreate-Recheck-20261120\AM610_TaskCreate_Recheck.project`。

主文件前后 SHA-256：`5503228fdbaddd2c3dd88db80b8d0f50bcf15dcd655825fbeee5aea34a3f854e`。当前文件 ID `3318604606:1407374883988428`，登记 projectId `2128519f-da7d-4740-ad0d-87d1bdda1817` 与原验收对应，无隔离及新未决操作。

| 操作 | operationId | IDE PID | 退出 |
| --- | --- | --- | --- |
| project_open | 570ba93f-05bf-4e7a-b48c-4e709cf1f1ad | 12492 | 0，无信号 |
| task_inspect | 5692b02b-1263-47b4-a99f-b7daf05821de | 39308 | 0，无信号 |

独立 stdio 同连接取得 0.34.2 和完整 37 项工具。每项均保留 requestId、operationId、launchId、请求指纹、process-start、process-exit、请求/派发/结果文件哈希和阶段记录；生产 exitVerdict 校验通过，WMI 启动父进程与退出事件独立对应。退出身份包含 Windows 进程创建时间标识，不仅是 PID。

final-cleanup 与 result-publish 完成，ownedHandleRemaining=false、closeUnconfirmed=false、saveAttempts=0。没有凭 result.json 的 succeeded 单独判断。两个 project_open 的提示观察记录均为 confirmations=0，未发生人工补点；本轮不据此重新验收提示确认功能。

任务集合按 taskId 与原验收同层证据核对，任务内部调用顺序严格保持：

| 任务 | 配置周期 | 优先级 | 看门狗 | 顺序与绑定 |
| --- | --- | --- | --- | --- |
| MainTask | 20 ms | 1 | 未启用，时间空，灵敏度 1 | 0 → PLC_PRG，空备注 |
| ProbeTask | 50 ms | 1 | 未启用，时间空，灵敏度 1 | 0 → PRG_TaskCreateRecheck，空备注 |

PROGRAM GUID 分别为 `ea5d3b9c-1b27-4fd0-b39d-9e5941ea8458`、`a3a51c28-3dd0-4c7b-a4b6-c0dd34cddfdc`，同一 Application `630571f2-3c61-442a-804b-f32fdbaf14a1`；配置完整，唯一解析。周期是离线配置，未验证调度。

## 唯一一次 CLI 只读任务

原文见包内 `cli/cli-task.txt`。会话 `session-d28963b5-f230-4559-84ec-8228cfd9a665`，服务 PID 31576。

模型实际调用 10 次：environment_inspect、session_status、project_list、project_open、task_inspect 各一次，以及仅针对本次两个操作的 operation_status 五次。没有历史查询/reconcile，没有写工具、编译或保存，没有第二次业务提示词。

| 操作 | operationId | IDE PID | 退出 |
| --- | --- | --- | --- |
| project_open | b70fd6e5-8b23-4e87-a5c8-252aec50f228 | 1944 | 0，无信号 |
| task_inspect | 26d3abca-c429-496f-a722-30c49435286d | 15948 | 0，无信号 |

两项与开发端同样校验退出证据、阶段、原生及服务层任务读回，均通过。CLI 及候选服务正常退出码 0。没有新 unknown、冲突或冻结。

工具接收证据来自 DSH 自带的本次 session.v4.jsonl.zstd：完整解码 41 帧、73 条记录，其中 request/header 含 37 项实际送给模型的工具定义；与同会话 environment_inspect 的 0.34.2、实际调用及上述共同 ownerPid 对应。仅导出脱敏工具元数据和本次调用，没有打包完整私人会话。

独立判断：

- 工程只读结果：通过。
- 流程遵循：本次通过，五次状态查询均限于本次操作；没有遇到新的冲突，所以不证明模型在冲突时的强制停止能力。
- 答复准确性：任务周期、优先级、看门狗、绑定及离线边界符合读回。原答复较长；“文件哈希未变”只适用于已核对内容，不代表整个目录元数据未变。
- 协议取证：缺少 CLI 原始 initialize/tools/list 数据包。观察器 fail-open 没有阻断服务；本轮没有补建目录后重跑，没有用独立 SDK 补包。实际 37 工具接收可由原生会话头验证，但不改写为握手数据包已留存。发现连接的具体行为本轮未留证。

## 保全与收尾

四次工程操作均为只读。setter=0、保存=0、编译=0；没有本轮编译错误/警告数。主文件哈希、文件身份保持；两个 .opt 和 .projectbackup 仅修改时间变化，内容哈希与大小保持。原始前后目录记录在包内。

开发端服务以 stdin EOF 正常退出；CLI 自行正常结束，其服务子进程及全部 IDE 退出码 0。最终没有相关存活进程、无未隔离 pending。服务和目标源租约仍为 owner-pid-exited 的 stale 记录，不冒称租约文件已经释放删除；既有正式机制允许后续排他取得，未手工删锁。最初未运行的日常服务状态保持，未启动 Desktop；最终日常握手和工具接收未验证。

首败与取证偏差全部保留：初始构建组合命令异常退出后直接 TypeScript 检查通过；只读预检脚本导入/编码问题在工程派发前修正；协议日志缺口；事后复核最初混用了原生 rawCalls 与服务归一化 calls，保留失败脚本/日志后改为各自同层比较，通过且未新增工程操作。

仍保留历史 unknown、隔离、移除探测现场、锁、默认环境性能、CmpLog、脚本信任、Desktop 欢迎页、实际运行及设备/I/O 边界。未修复 IDE 异常退出根因，未恢复历史账本，未把原综合验收改判通过。追加/替换的任务枚举顺序风险仍另行评估。

## 复核入口

- [原补修与离线验证](operation-reconcile-exit-guard.md)
- [0.34.1 原真实复验及首败](task-create-revalidation-0341.md)
- 本轮本地证据入口：`D:\InoPro-OperationGuard-Real-20261120-161934\REVIEW.md`。
- 本轮复核 ZIP：`D:\InoPro\deliveries\InoPro-review-20261120-163426.zip`，完整提交与 SHA-256 见该入口及 ZIP 旁置校验文件。功能分支未合并 main，日常固定入口未部署。
