# 0.34.2 单次 CLI 离线报警综合验收（2026-11-20）

本轮使用已合并 main `aaf1363557ccddf9a2c584564509ec2b985d39c6` 的固定产品，0.34.2 候选版、37 项工具。只增加本验收文档，不改变产品、Schema、初始化指令、日常配置或 main，不重跑全量回归。

## 三项结论

| 项目 | 结论 | 依据与限制 |
| --- | --- | --- |
| 工程功能与保存闭环 | 限定离线范围通过 | 原生创建、参数及程序接入、任务创建、两次实际编译、保存关闭重开、五个对象最终读回；22 次 IDE 操作均有可信退出码 0、无退出信号 |
| 限定流程与停止规则 | 部分通过 | 一次业务任务；无历史查询/reconcile、比较、工程副本或在线操作；无新 conflict/unknown。有一次参数拒绝、29 次状态查询和一次超出必要对象范围的完整结构查询，不能称简化流程全部通过；本次未触发异常停止分支，不证明模型强制停止 |
| 最终答复 | 核心事实相符，展示部分符合 | 参数、任务、编译和运行边界正确；答复偏长，且链接由工具返回的实际路径组成，工具未返回独立打开 URL，不能说是原生返回的 URL；未测试点击 |

[工程文件](D:/InoPro-OfflineAcceptance-0342-20261120/AM610_AlarmAcceptance_0342.project)

完整路径：`D:\InoPro-OfflineAcceptance-0342-20261120\AM610_AlarmAcceptance_0342.project`。

最终 SHA-256：`96295144fe05f63b746ce100e55782f6d0796b85cdfc0a72a15bc1a452500572`。

## 准备、一次提交与连接归属

- 新路径事前不存在，外层未创建工程或程序内容。实际 `project_create` 由模型调用，工程 projectId 为 `b3f5f224-3f7b-4900-bf30-25e52f2d650c`，Application 为 `66ccd3c6-08f3-45d5-9f21-cae77a3fe21a`。
- 固定入口：`D:\InoPro-Fixed\0.34.2-aaf1363557cc\dist\server.js`。110 项已归档源文件/构建产物指纹在前后复核一致，没有借用变化中的工作区。
- 本机自带 dsh.cmd，headless，deepseek-account / deepseek-flash。临时配置由已验配置派生，credentials、authorization、deepseek-account 启用；仅候选 MCP 工具启用，原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。日常 DSH、Codex 配置均保持。
- 安装版 CLI `--dump-config` 仅合成配置；含客户端标题的指令 63,036／65,536 字节。没有发送额外账号/连通性模型请求。
- 业务日志目录预先创建，并用无工程、无租约的替身检验同一观察脚本可保存 initialize、tools/list 和退出元数据，不污染 stdout。替身不是产品连通性证据。
- 业务任务仅一次，原文及唯一提交标记见复核包。CLI 会话 `session-9daf3b9d-e8aa-437b-a569-c87774f9e54e`。
- 正式服务 PID 42688、连接 `42688-eacbdd25-d02f-48d8-bce6-7fb61b4e25a4`：2026-11-20 17:07:12 返回 0.34.2，tools/list 完整 37 项，无续页；同连接记录全部 55 次 tools/call。观察保存的是协议元数据、完整工具名及 Schema 摘要，不是完整协议正文。
- DSH 本次原生会话的 request/header 另证实实际提供给模型的 37 项工具；完整解码 194 个压缩帧，只导出工具元数据，未打包私人会话或凭证。
- 发现进程 PID 42652 的 server/discover 返回 -32601，未调用工程工具。它与正式连接分开，不跨连接拼接证据。

## 实际程序与任务

最终五个对象的源码读回均对应最终文件哈希，源码原文附于复核包：

| 对象 | 实际内容 |
| --- | --- |
| GVL_AlarmConfig | DelayTime1 显式 T#7S、DelayTime2 显式 T#8S |
| GVL_AlarmStatus | 全局 AnyAlarm : BOOL |
| FB_DelayAlarm | Enable/Fault/Reset/DelayTime 输入，DelayTime 显式 T#3S；Alarm/Timing 输出；实例内部 FaultTimer : TON |
| PLC_PRG | AlarmFB1/AlarmFB2 两个独立实例；独立测试输入、报警输出及 Timing 读回；分别传入全局 7S/8S。TestEnable1/2 显式 TRUE，其他测试 BOOL 未写显式初值 |
| PRG_Status | `AnyAlarm := PLC_PRG.Alarm1 OR PLC_PRG.Alarm2;` |

源码复核：复位或失能分支先清 Alarm/Timing，并调用 TON(IN:=FALSE)；故障持续分支调用 TON，Q 成立时置 Alarm；故障消失分支复位 TON、清 Timing，但不清已锁存 Alarm。两实例各有自身的 TON 和输出状态。这是源码逻辑与离线编译核对，未仿真或观测计时。

| 任务 | 原生任务 GUID | 配置周期 | 有序调用及备注 |
| --- | --- | --- | --- |
| MainTask | 0e9944a3-7a19-4947-960d-60ccf5896750 | t#20ms | 第 0 项 PLC_PRG，空备注 |
| StatusTask | bae28de2-0cf7-473d-90cd-770190c56e03 | t#50ms | 第 0 项 PRG_Status，空备注 |

均为 Cyclic，实际优先级 1；看门狗 enabled=False、time 空串、unit=ms、sensitivity=1。StatusTask 沿用原生默认优先级/看门狗，MainTask 未更新。调用分别唯一解析至 PROGRAM GUID `8f30cd91-9919-42eb-be87-011a8b6eddb2`、`ab74c08e-5c79-4bd5-814e-889e75213d97`。

task_create 操作 `c985e17b-2970-4580-8904-570bc77a1838` 的创建前、绑定后、重开后即时原生清单，以及两份 verification 均已归档。按唯一 taskId 比较任务集合，保留每个任务内部调用行的名称、备注和顺序；旧任务完整字段、PROGRAM 清单及原生 ST 证据保持。绑定后和重开后原始任务顺序均为 MainTask、StatusTask，本轮没有复现换序，不能把此正例称为真实换序复现。

## 编译、保存和最终版本

| 操作 | operationId | 结果 | 适用文件 SHA-256 |
| --- | --- | --- | --- |
| 首次编译 | 5ef05c29-2c78-4869-bea1-6a41e839bd37 | buildPassed=true，诊断完整，0 错误/0 警告 | 81c7a49c4db3608b54cb990d5c3014be2ca5fb79c6b693bc4804cb5cd82cd3a6 |
| 保存关闭重开 | 29853022-3d9f-4721-838e-3f7f0b6b4818 | saved/reopened=true；buildApplicable=false | 96295144fe05f63b746ce100e55782f6d0796b85cdfc0a72a15bc1a452500572 |
| 必要保存版复编 | 37703703-4fd9-4814-9231-8ae0fec45c4d | buildPassed=true，诊断完整，0 错误/0 警告 | 96295144fe05f63b746ce100e55782f6d0796b85cdfc0a72a15bc1a452500572 |

最终 taskConfigurationVersion 为 `6a2262e8aa4bc36a53c7b6d464352a706dd14cf171fd910c91dd432659b1ef05`，保存、保存版编译和最终 task_inspect 一致。编译自身 saveAttempts=0。模型随后读回五个对象及两个任务，没有由外层补做保存、编译或源码修改。

每次实际派发均通过产品 exitVerdict 对归档原请求、operationId、requestId、launchId、指纹、process-start/process-exit、派发和结果摘要作核对。22/22 真实 IDE 操作正常退出；独立 WMI 的父 PID、创建时间和退出 0 逐项对应。没有用 result.json 的 succeeded 单独判定。检查点只记录本轮实际副本及其指纹，不修改原检查点。

附属文件单列：本轮新目录最终还有两个 .opt 和一个 OEM .projectbackup。backup 最终与主文件同哈希，不是模型生成的业务交付副本。没有保存后附属文件逐操作事前快照，因此只列最终清单及时间，不声称附属文件全程未变。

## 首败、额外查询和取证缺口

55 次 MCP 调用包含 29 次 operation_status，均仅针对本次 22 个操作的 operationId/requestId，无 reconcile；没有查询历史操作。另有两次 object_list、三次 task_inspect、一次 project_structure、六次 object_read。project_structure 读取了超过本任务所需对象的工程树，因此简化流程只部分符合。

一次 code_apply_change 带入普通 PROGRAM 不接受的访问器专用参数，返回 -32602 输入校验拒绝，无 operationId、无 IDE 派发。模型在同一次任务内去掉参数后仅成功执行一次实际源码变更。无 conflict/unknown，未触发真实失败后的停止分支；不能推断所有冲突后模型都能停止。

CLI JSON 输出中 project_list（7,780 字符）和一次 project_structure 状态结果（8,148 字符）在 JSON 中途截断。原流保持，不修补成完整正文。后者另有本次正式账本/IPC 的完整结果；前者不为补证重新查询历史登记。全树数据不用于最终工程功能结论。

本地只读复核首次把 task-before 当作裸 inventory，得到 KeyError: tasks；按实际 before 包装读取后核对通过，原证据未改。这不是工程操作失败。

原答复未改写。其核心事实与读回一致，但篇幅偏长；工程链接是从实际路径生成的 Markdown 链接，工具没有独立打开 URL。点击和桌面交互未验证。

## 保全与收尾

事前按当前字节指纹留存 1,537 项材料，结束时 1,535 项字节不变；变化只在 registry.json 和 service.lock，属于本轮正常工程登记及租约变化。1,437 份既有操作账本及所列历史 IPC、检查点、工程、隔离账本/锚点保持，未恢复此前已变化的三份账本。原 63 个工程登记逐项一致，仅新增本工程，活动工程和 revision 正常更新；不能说整个数据目录未变。

CLI 及正式 MCP 连接于 17:16:26 正常退出码 0。结束未见 IDE、DSH Desktop 或相关 MCP 服务；服务锁和本次源路径锁均为 owner-pid-exited 的 stale，原样保留，未手工删锁。发现子进程没有观察脚本退出事件，其发现阶段错误与退出缺口单列，不影响正式业务连接和 22 次 IDE 的独立退出证据。

日常配置、Codex 配置及固定构建指纹未变，未启动 Desktop，日常连接仍待验证。本次不改判此前综合验收失败，也不宣称修复 IDE 崩溃根因、默认环境 200 ms 性能问题或模型强制停止能力。历史 unknown、隔离、原失败现场、CmpLog、脚本信任、欢迎页、设备/I/O 与 PLC 运行限制继续保留。

## 复核入口

本机证据根：`D:\InoPro-AlarmAcceptance-0342-20261120-170235`。交付 ZIP 中的 `REVIEW.md` 是入口，包含逐文件摘要清单和本次分支提交；ZIP 路径及 SHA-256 见交付回执。

关键入口：

- `cli/cli-task.txt`、`cli/cli-submitted.json`：唯一业务原文与提交标记。
- `cli/traces/`、`cli/client-tools-received.json`：正式连接与模型工具清单，发现连接另列。
- `review/cli-events.jsonl`、`review/model-answer.md`：保留业务调用和原答复，仅省略模型内部推理及无关旧登记内容；原始本地流的指纹见 cli-record-origin。
- `evidence/operations/`、`evidence/ipc/`：本次 22 项正式结果、请求、退出、阶段及清单；不包含历史工程二进制或私人配置。
- `review/verdict.json`、`review/process-correlation.json`、`review/source-readback.json`、`review/builds.json`、`review/saves.json`：独立复核。
- `history/before.json`、`history/after.json`、`review/first-failures-and-gaps.json`：保全、首败和缺口。
- [0.34.2 修复后最小只读复验](operation-guard-readonly-revalidation-0342.md)、[合并部署归属](operation-guard-0342-merge.md)：旧记录保持原结论。
