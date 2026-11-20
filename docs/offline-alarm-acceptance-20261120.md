# DSH CLI 综合离线报警验收（2026-11-20）

结论：**工程闭环未通过，停在 task_create 的正式 unknown；停止规则在本次任务中得到遵循。** 没有重发业务任务、补编译、补保存或修复产品。产品仍为 0.34.0 候选版、37 项工具。

## 产品与同一连接

验收分支基于 main `5b3e5b06580c1ee6a981f4a3fafa46c767bc7513`。实际入口为 `C:\Users\Administrator\.codex\worktrees\s8b-daily-fixed-034\InoPro\dist\server.js`，固定构建提交 `4070d1a88bf035e89fc91ab2aabfbca2930f1660`；产品实现归属 `8473f0982ec4935b07bdfda9c594364fd5d44825`。80 个构建指纹与部署记录一致，产品路径与本次 main 无差异，未重建或运行全量回归。

使用 Windows 本机安装版 dsh.cmd、headless、deepseek-account / deepseek-flash。临时配置从已验配置派生，三项认证依赖生效、仅挂载 InoProShop MCP；实际合成配置通过检查。指令按客户端标题加 trimEnd 后正文口径为 63,036 / 65,536 字节。未改日常配置或初始化正文。

登记目录仍为此前已确认且当前配置使用的 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。本次任务文字中的 `D:\InoPro.local\...` 为另一个历史目录，未切换。启动前正式租约观察为 stale、活动操作 0、未处置 unknown 0，允许由服务按既有机制接管；无 Desktop 或其他工程服务占用，没有手动删锁。

2026-11-20 13:38:44 启动的本次 CLI 宿主 PID 6644，经其子进程 PID 6708 的连接 `6708-c45cf997-cd01-449e-baaf-e11673b64e4d`，实际取得 initialize 0.34.0、完整 37 项工具，并完成全部模型工具调用。另一 PID 41916 的发现连接返回 server/discover -32601，单独保留，不拼入正式连接。独立握手或磁盘版本没有充当本次 CLI 接收证据。

## 唯一任务及实际进度

目标是由模型原生创建两路延时报警，初始全局延时 5s/8s，经 variable_edit 只改第一路为 7s；功能块输入初值 3s；MainTask 20ms 调用 PLC_PRG，另建 StatusTask 50ms 调用 PRG_Status；最后编译、保存重开及最终读回。

指定路径原先不存在，由模型调用 project_create 原生新建：

`D:\InoPro-OfflineAcceptance-20261120\AM610_AlarmAcceptance.project`

| 内容 | 本次证据与边界 |
| --- | --- |
| 新建工程 | project_create 成功，直接模式，无业务副本。原生 MainTask 为 Cyclic、20ms，调用 PLC_PRG。 |
| FB_DelayAlarm | 创建并保存重开读回；输入 DelayTime 初值 T#3S，内部 Timer : TON 和 Alarm 输出属于各自实例。 |
| 逻辑阅读 | Reset 或失能时关闭 Timer 并清 Alarm；尚未锁存时 Timer 跟随 Fault，故障消失复位计时，Q 置位后锁存；锁存分支关闭 Timer 并保持 Alarm。这里只核对源码意图，未编译或运行。 |
| GVL_Alarm 与 PLC_PRG | 两组 Enable=TRUE、Fault=FALSE、Reset=FALSE；两独立 FB 实例；报警分别写 Alarm1、Alarm2。已成功写后保存重开读回。 |
| 参数修改 | 一次 variable_edit，原 GVL 只将 DelayTime1 的显式初值 T#5S 改为 T#7S，其余声明逐字保持；DelayTime2=T#8S。FB 输入初值仍为 T#3S。 |
| PRG_Status | 已有根级 ST PROGRAM，源码只写 AnyAlarm := Alarm1 OR Alarm2；不写故障、复位或两路 Alarm。 |
| StatusTask | create、period、bind 阶段均记录 succeeded，且内部 save、close、reopen 完成；随后整体清单核对失败，正式结果 unknown，不能判任务创建验收通过。 |
| 编译与最终闭环 | project_build=0，project_save=0；没有本轮编译错误/警告数，也没有适用于最终文件的编译证据。未完成整套最终读回。 |

源码文件在复核包标为 last-confirmed-source，注明各自操作与当时磁盘版本；不是失败后重新打开取得的“最终已验证源码”。工具自身累计 saveAttempts=7，包含 task_create 的 1 次保存；“未调用 project_save”不等于本轮未发生保存。未进行失败后的恢复性保存。

## 新 unknown 与已发生的保存

- 操作：`78715c58-ce22-44e9-9a98-ca87ef41c04e`。
- 错误：`TASK_CREATE_INCOMPLETE` / `Reopened inventory differs from the task binding readback`。
- 写前磁盘及检查点哈希：`260ad5ab96124e5e8a4e3fde0ffcac80f74fa4e2cffa333be311964e5424ff2e`。
- 保存后及进程退出后实读磁盘哈希：`76afe927020671df68956aae98c9c2cf08c8707e47670af52da16277c63db7bc`。
- 13:44:06 保存成功并关闭；13:44:07 重开成功；13:44:09 最终清理、结果发布完成。正式状态仍为 unknown，原异常和检查点保留。
- task-after-bind 的任务枚举次序为 MainTask、StatusTask；异常后的 partial 清单为 StatusTask、MainTask。按原 taskId 对齐，两条记录全部字段一致，其余清单字段一致。各任务内的调用顺序未因此改变。
- 固定桥接在重开 verify 后直接比较整个 inventory，归档差异与此失败位置相符。但立即 verify 返回的 after 未单独发布，partial 是异常后的再读取，不能据此改写 unknown、放宽守卫或宣称完整绑定验证已通过。本轮不修复产品。
- partial 中 StatusTask 为 50ms，原生默认 priority=1，watchdog enabled=False、time=""、time_unit=ms、sensitivity=1，调用 PRG_Status；MainTask 20ms、PLC_PRG 及可读字段保持。这些是局部读回证据，不是成功终态或调度观测。

## 流程与答复分别判定

一次业务提示词、42 次模型工具调用；15 项正式工程操作中 14 succeeded、1 unknown。22 次 operation_status、额外只读查询均保留。

首次 code_apply_change 带了当前普通 ST 修改不接受的专用版本参数，被 MCP 输入 Schema 以 -32602 拒绝，没有桥接派发。模型删除多余参数后再提交，成功；该事件不是 conflict，不与 unknown 混算。遇到 unknown 后只查询同一操作一次（reconcile=true），仍 unknown，没有新增写入、保存、编译、工程比较或回滚。未调用 project_compare 或 project_open_copy。停止规则本次遵循，简化流程保留参数拒绝及查询偏多的记录，不宣称效率完全通过。

原模型答复正确报告部分完成、unknown、未编译和路径，但较长且有歧义。勘误单独保留：
1. GVL 的 5s/8s 是初始创建值；最后成功变量读回为 7s/8s，不应并列造成最终值混淆。
2. “未执行最终保存”指未到显式 project_save/最终验收；task_create 内部已经保存重开，不能解释为任务变更没有落盘。
3. “不复位期间计时”措辞不清；实际源码是复位持续时 Timer(IN:=FALSE)，不计时。
4. 中间任务读数不能替代正式成功，模型提供的工程链接也不能视为链接点击已验证。

## 收尾与保全

CLI 和同一正式 MCP 进程均记录退出码 0；13:48 的只读进程清单未见残留 IDE/CLI/服务。worker 记录已关闭拥有的工程句柄；未单独取得每个 IDE 的退出码，不填 0。service.lock 留存为 stale（owner-pid-exited），没有手工删除或额外释放动作；新 unknown 未隔离，正式派发检查 allowed=false，因此不启动后续服务或工程任务。

此前四项 MCP unknown 与四项隔离原件哈希不变；三个独立映射探测 unknown、原移除失败现场和其它历史证据保留。配置及固定构建未变。本轮不启动 Desktop、不修复欢迎页、不处理 unknown、不修改账号或执行策略。脚本信任、CmpLog、完整设备/I/O、现场接线、PLC 运行与任务实际调度均保持未验证边界。

复核证据目录：`D:\InoPro-OfflineAcceptance-Evidence-20261120-133423`。原任务、原答复、脱敏会话、同连接工具记录、正式操作和 IPC、源码及参数核对、首次预检错误、检查点索引、终态和文件指纹均入包。私人配置、凭证与无关工程清单不入包。

本分支只提交验收说明，不改产品，不合并 main，不部署。后续若要继续，须另行处理新 unknown 及 task_create 核对缺口；本轮不提前实施。
