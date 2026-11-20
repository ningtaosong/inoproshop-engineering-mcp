# task_create 0.34.1 隔离提交及真实复验（2026-11-20）

固定产品来源为 `672e1856e2ec0d1ca58d42c93ed12e23e83b2e8d`，实现为 `bd10bbfd47b34da8ab3c6a0c58d2e4aa441ce19c`。0.34.1 候选版、37 项工具；本轮未改产品、Schema、初始化指令及日常 DSH/Codex 配置，未合并 main。此前 Node 530/530、Python 248/248 和默认环境 200 ms 首败按原提交归档，本轮未重跑回归。

## 隔离提交与保全

计划 `0e8d3bc9-8b75-498d-b59a-4e38dd2508c5`，证据版本 `78c77a0082a01bbf7001149aa6760e145c304e28b04a411f19c912aa64494ee3`。重核文件身份和范围后，通过正式入口提交一次，`deduplicated=false`、`state=committed`。唯一实际路径为 `D:\InoPro-OfflineAcceptance-20261120\AM610_AlarmAcceptance.project`，原操作为 `78715c58-ce22-44e9-9a98-ca87ef41c04e`，未扩大授权。

提交后立即核对 12,733 个既有文件，只有隔离账本发生授权变化；工程、IPC、检查点、原操作账本和旧隔离记录保持。正式隔离保护对目标返回 PROJECT_ISOLATED，原操作仍为 unknown，未打开或复制封存工程。

**后续 CLI 破坏了原操作账本保持不变的边界。** 模型对五项历史 unknown 调用 `operation_status(reconcile=true)`，收到 unknown 后仍继续新工程。三份历史账本哈希变化：`7247cab3-…`、`78715c58-…`、`b7c438ed-…`。前两份从隔离日志副本取得精确事前字节（只读归档，未回写账本），确认仅 finishedAt 和校验值变化；第三份保留事前/事后指纹及当前结果，未取得与事前哈希一致的原字节，不能推断其变化范围相同。五项状态仍为 unknown，原工程、IPC 和检查点未变。没有恢复账本或改写终态。隔离提交时的保全结论与 CLI 后的变化分开记录。

## 独立真实 MCP

工程：`D:\InoPro-TaskCreate-Recheck-20261120\AM610_TaskCreate_Recheck.project`。

真实 MCP 原生新建工程及根级 ST PRG_TaskCreateRecheck。task_create 操作 `d45caad4-5172-4f4f-9ed0-842098586f74` 新建 ProbeTask 50 ms，绑定正确，原 MainTask → PLC_PRG 的配置及调用保持。创建后和重开即时清单、两个 verification 均归档且无差异。

14 项正式工程操作全部 succeeded。编译、显式保存关闭重开、必要保存版复编及最终任务/源码读回通过；两次编译均为 0 错误、0 警告。最终文件和保存版编译 SHA-256：`5503228fdbaddd2c3dd88db80b8d0f50bcf15dcd655825fbeee5aea34a3f854e`，任务配置版本相符。服务通过 stdin EOF 退出，退出码 0，无强制结束。

即时两份清单都为 MainTask、ProbeTask，未在该核验中观察到换序。本套各 IDE 的退出及退出后哈希由桥接取证，未独立采集每个 IDE 的 OS 退出码，不补称所有退出码均为 0。

## 一次 DSH CLI 综合任务

工程：`D:\InoPro-Alarm-Recheck-20261120\AM610_AlarmRecheck.project`。

本机 headless / deepseek-account / deepseek-flash，三项认证依赖、原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1` 及 65,536 字节上限均预检通过，含标题指令 63,036 字节。业务只发一次，外层未代做程序。

正式连接 `10188-2e62d973-b612-4d27-a547-59def19efb9d` 实际 initialize 为 0.34.1，收到 37 项工具，97 次模型调用与同连接协议记录对应。单独发现连接的 server/discover -32601 保留，不与正式连接拼证据。

最终工程文件核对成立：

- FB 输入 DelayTime 初值 T#3S；每个实例独有 TON 和 AlarmState。源码实现复位/停用清零、故障持续计时、故障消失清计时且保留锁存报警。只有源码和编译证据，没有运行验证。
- PLC_PRG 有两个独立实例、分别 Enable=TRUE、Fault=FALSE、Reset=FALSE。全局延时初始 5 s / 8 s，成功 variable_edit 明确记录 T#5S → T#7S；最终 7 s / 8 s，FB 初值 3 s。
- PRG_Status 只读两路报警并写 AnyAlarm。
- MainTask 20 ms → PLC_PRG；StatusTask 50 ms → PRG_Status，优先级 1、watchdog enabled=False 等原生默认值读回。
- task_create `58f34a1f-33a9-4e7e-8dc9-e80373f29124` 的创建后、保存重开核对成功；两次编译各 0 错误、0 警告，最终四份源码和任务读回对应保存文件。
- 最终 SHA-256 `b72f614cac5fb0b1956e77ce791400954e5eb178813b2b342552057fe9c0e7cd` 对应保存版编译 `9c1e37b8-1273-4453-9500-2fcd1a20035e` 及最终任务配置版本。

即时 task_create 顺序均为 MainTask、StatusTask；后续独立 task_inspect 顺序为 StatusTask、MainTask，按 taskId 对齐可读字段和调用一致。后续换序不能冒充即时 task_create 核验中已复现换序。

**整轮 CLI 验收未通过，工程结果与流程分别判定：**

- 历史 unknown 的 reconcile 及继续派发违背停止/保全要求。没有第二次业务任务或事后恢复账本。
- code_apply_change 一次输入 Schema 拒绝；variable_edit 一次 unsupported / VARIABLE_DECLARATION_UNSUPPORTED。模型移除其自行创建 GVL 的 qualified_only 属性后，再用 variable_edit 改初值。首败与额外源码修改保留，不能算最简流程通过。
- 共 59 次 operation_status、11 次 session_status，不判定效率通过。原答复工程参数和编译结果准确，但较长且遗漏历史 reconcile、首次拒绝及异常退出，展示只部分满足要求。
- 中间 task_inspect `427069dd-21a4-4597-b0aa-e4f477ce6f1c` 被产品报为 succeeded，具有结果、关闭和退出后只读哈希；对应 IDE PID 41248（15:01:30.506851 创建）却退出为 `0xC000041D`。Windows 1000/1001/1026 记录 InoProShop 1.9.1.6 崩溃及 System.Drawing.Font.GetHeight / ThreadExceptionDialog 栈。该栈不足以断言最初异常原因，succeeded 不代替正常退出证据。
- 发现流程偏差后只查已安装 CLI 帮助寻找正常停止入口，未找到外部会话停止命令。没有强杀或界面操作，已提交 CLI 自行达到终态，外层未再派发工程请求。

CLI 和正式 MCP 子进程均退出码 0，最终无残留 IDE/服务。OS 观察记录 CLI 的 24 个 IDE 退出：23 个 0、1 个上述非零。service 和 CLI 工程源租约为 stale/owner-pid-exited，**不是已释放**；正式规则显示无未隔离 pending、无当前活跃租约，未手工清理。日常入口未启动、未切换。

## 边界及复核入口

最小 MCP 功能复验通过；CLI 最终保存文件核对成立；CLI 流程和完整正常退出验收未通过。任务级停止/历史 reconcile 范围保护及中间 IDE 异常退出应单独评估，本轮未改产品。追加/替换工具的类似枚举顺序风险未修复。

默认环境 200 ms 性能失败、历史 unknown/隔离、独立探测 unknown、移除接口缺陷、CmpLog、脚本信任、Desktop 欢迎页、最终日常握手和运行/设备 I/O 限制保留。周期是配置，不证明实际调度或 PLC 行为。

- 本地入口：`D:\InoPro-TaskCreate-Revalidation-20261120-143938\REVIEW.md`。
- 复核包：`D:\InoPro\deliveries\InoPro-review-20261120-151015.zip`，清单及 ZIP SHA-256 见旁置核验记录。
- [离线补修与原故障边界](task-create-inventory-order.md)。原离线计数不与本轮工程次数相加。
