# 0.34.3 最小真实复验：在正式写入前停止

本记录属于 `codex/task-call-inventory-order`。实际受验候选为 `39e11932ff4f2d584550c464d612748736a3a476`，实现提交为 `4693d8b6d99dc769b386bf8dc8161acde3283d00`；main 保持 `fd43f679707e0f484611b7f03174fa864add316a`。2026-11-20 夜间开始，正式读取于 2026-11-21 00:00（本机 UTC+8）结束。产品为 **0.34.3 修复候选版、37 项工具**，本提交只补充验收记录。

## 结论与停止位置

**本次没有完成追加或替换的真实正向闭环。** 两份独立夹具准备成功；正式追加前的外层验收基线核对停止在 `programs[0].objectId`。MCP 只执行了追加夹具的 `project_open` 和 `task_inspect`，均正常返回并有可信退出证据。没有发送 `task_call_append` 或 `task_call_replace`，没有发送正式编译／保存请求，没有在停止后再开工程。

事后只分析已落盘的原始快照：准备保存前与独立重开后的 `programs` 数组顺序不同；按唯一 objectId 对照，六个 PROGRAM 的身份与路径集合相同。两个任务的原始枚举顺序相同，完整任务字段、内部调用行及其名称／备注完全相同；其余采集清单字段也相同。最先比较的是：

- 预期首个 PROGRAM：PLC_PRG，`76817b8e-cf3d-4b51-82a0-fb6e8bc7c778`。
- 实际首个 PROGRAM：PRG_SecondaryKeep，`a313fac0-8738-415d-b8a9-f7ce27135717`。

外层脚本直接使用固定候选的生产 `taskCallInventoryDifference`，它只对顶层 `tasks` 建立身份视图，仍严格比较 `programs` 数组。原始错误和快照未覆盖；事后身份对照仅解释停止点，**没有用它放行写入、改变比较器或改写原失败**。这不是新工具返回的 conflict／unknown，也不是已证实的产品写入失败，因为正式写工具尚未被调用。是否需要对 PROGRAM 枚举另作规则核查，须单独评估；本轮不扩大任务集合修复范围。

本次没有观察到顶层任务集合换序。旧离线换序用例仍按[原离线记录](task-call-inventory-order.md)归属；不能写成“真实正向闭环通过，换序仅由离线覆盖”，因为本次正向闭环本身未完成。

## 固定构建与独立初始化

固定目录：`D:\InoPro-TaskCallOrder-Real-20261120-234907\fixed-0343`。由指定提交的 git archive 展开，未使用正在变化的构建；282 个归档文件与固定目录逐项一致，另记录 58 个 dist 文件哈希。构建、类型和指令大小检查通过，未重跑全量回归。

最终正式读取连接取得 initialize 和完整 tools/list：版本 0.34.3、37 项工具；实际 SDK 输入输出 Schema 逐项匹配。原 main 的 37 项静态输入输出契约相同，初始化正文相同。正文含尾换行为 63,009 字节；按已验客户端去尾空白及附加标题口径为 **63,036 / 65,536 字节**。本轮没有 DSH CLI 或 Desktop 连接，不把独立连接当作日常接收证据。

首次独立初始化在工程调用前因验收脚本混用静态导出 draft-2020-12 与 SDK 实际 draft-7 口径停止。保留原协议、断言和正常退出；按本机 SDK 同一转换函数离线核对后才建立正式读取连接。没有重发工程写入。其余预检脚本的编码名、已正式释放后不存在的 service.lock、指令尾换行及 JSONL 尾空行处理错误也分别保留，不计为产品工程失败。

## 两份夹具准备与实际范围

来源为已核验中性样例归档 `D:\InoPro\deliveries\InoPro-review-20261109-132658.zip` 中的 `projects/AM610_Minimal_MCP.project`，种子 SHA-256 为 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。不是日常或封存工程。实读根设备为 `4102 / 10f4 0002 / 3.5.11.11`。

| 项目 | 追加夹具 | 替换夹具 |
| --- | --- | --- |
| MainTask 初始调用 | PLC_PRG → PRG_Keep → PRG_Existing | PLC_PRG → PRG_ReplaceMe → PRG_Keep |
| MainTask 备注 | 空串；中文保留；字面文本 None | 空串；替换此行，保留中文备注；字面文本 None |
| 待授权目标 | 已有 PRG_Append，未被调用 | 已有 PRG_Replacement，未被调用 |
| SecondaryTask | PRG_Secondary → PRG_SecondaryKeep；中文／空备注 | 同左 |
| 周期 | MainTask 20 ms；SecondaryTask 50 ms | 同左 |
| 准备编译 | 1 次，0 错误／0 警告，诊断完整 | 1 次，0 错误／0 警告，诊断完整 |
| 准备保存、关闭 | 保存 1 次，正常关闭，进程退出 0 | 保存 1 次，正常关闭，进程退出 0 |
| 正式 MCP | 打开 1 次、任务读取 1 次；写前外层停止 | 未开始 |
| 正式追加／替换 | 0 次 | 0 次 |
| 正式保存版编译 | 未执行，无错误／警告数可报告 | 未执行，无错误／警告数可报告 |
| 修改后保存重开 | 未执行 | 未执行 |

每份准备调用了 create_pou 5 次、create_task 1 次、pous.add 4 次；为准备备注调用公开 replace 3 次，仅设置对应原行的备注。这些属于原生夹具准备，**不是正式 task_call_replace 验收**。准备阶段记录完整源码、PROGRAM 身份与原生 ST 实现标识、taskId、看门狗及所有可读任务字段、完整有序调用与唯一 PROGRAM 绑定。新辅助 PROGRAM 只设置本地 INT，不接 I/O。

追加夹具保存后被两个独立 IDE 进程只读打开；其主文件和源码快照保持。完整任务及调用行符合保存准备记录；重开后的每个 PROGRAM 原生 ST 标识尚未重新采集。替换夹具只完成准备，未独立重开。

这两次准备编译均先于准备保存，不作为正式替换后或最终保存版的编译验收。不能用准备编译填补本轮未执行的保存版编译。

## 文件与退出证据

追加工程：`D:\InoPro-TaskCallOrder-Real-20261120-234907\append\engineering\AM610_TaskCall_append.project`

SHA-256：`ce8a7e382eac01053387357e6b787069981e4c363df3911b5bf5de844a4afc60`

替换工程：`D:\InoPro-TaskCallOrder-Real-20261120-234907\replace\engineering\AM610_TaskCall_replace.project`

SHA-256：`62bd95cdc822e94ffe96c76241397bd5e258328bbc5528cadfce07d2e3ed543b`

两主文件最终哈希均等于各自准备保存记录。附属文件最终逐项记录，但**遗漏了正式读取前的附属目录指纹基线**，不能证明附属文件无变化；不以最终清单回填事前状态。

| 阶段 | operationId | IDE PID | 退出 |
| --- | --- | --- | --- |
| 追加准备 | 7995de1d-6223-44d2-82ce-41f3e207b459 | 8200 | 0、signal=null，原生正常关闭 |
| 替换准备 | 8e35160f-5e9f-4af7-a75e-adbb787e951b | 26980 | 0、signal=null，原生正常关闭 |
| MCP project_open | 4546d7de-c2b8-448d-97d3-b0387af373af | 42560 | 请求／launch／创建身份／结果哈希绑定，正常关闭，0、signal=null |
| MCP task_inspect | 5263cd7e-d2fb-4ba1-8f21-b4bff95cbe38 | 43580 | 同上 |

正式连接仅有上述两个工程请求和 14 次对本次 operationId 的 running 状态查询，没有历史查询或 reconcile。原生准备有自己的请求指纹、创建身份和退出记录，与 MCP 操作分开。

## 保全与证据缺口

沿用 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`；正式保护检查显示无未隔离在办操作，既有 unknown 均有正式隔离依据。准备与收尾使用既有 Store 租约机制，未手工删锁。

初始 27,394 项保全材料在准备后和停止后均无字节变化，包含原账本／IPC／检查点、隔离记录及锚点、旧锁、原登记工程文件和私人配置的指纹。原登记项目条目未变；本次正常新增两个 MCP 操作和一个直接打开项目登记，当前 session、登记版本和租约状态发生正常变化，不能宣称整个数据目录不变。没有新 unknown。

候选服务经 stdin EOF 正常退出，exit=0；收尾无 Desktop、工程服务或 IDE 进程。现存服务租约为 owner-pid-exited 的 stale，原样保留；此状态不能替代操作成功证据。日常 0.34.2 入口、DSH 和 Codex 配置未变；未启动日常连接。

保留默认环境 200 ms 性能问题、历史 unknown 与隔离、IDE 崩溃根因未确认、CmpLog、脚本信任及 Desktop 欢迎页问题。没有 PLC 连接、下载、运行、仿真、实际调度或计时验证。

## 复核入口与下一步

原始证据根目录：`D:\InoPro-TaskCallOrder-Real-20261120-234907`。复核包以本轮新文档提交关联，不打包私人配置或历史账本内容；历史材料仅带指纹及原证据引用。

重点依次检查：

1. `origin.json`、`static-checks.json`、固定文件指纹：构建归属、37 项 Schema、初始化。
2. `append/prepare-*.json`、`replace/prepare-*.json`：原生准备、完整源码、调用行、编译及正常退出。
3. `mcp-run/mcp-protocol.jsonl`、`mcp-stopped.json`：真实调用和首个停止。
4. `current-operation-evidence/`：仅本次两个 MCP 操作的账本、IPC、结果及退出。
5. `posthoc-review.json`：对原证据的离线身份分析，不是继续派发授权。
6. `historical-final-stopped.json`、`final-fixture-fingerprints.json`：保全与附属文件证据缺口。

本轮不修产品、不调整守卫后继续执行。后续应先独立复核 PROGRAM 清单枚举顺序与可信身份比较范围，并完善附属文件事前取证，再决定新的正式验收。原固定构建、首次失败及两份已正常关闭的准备工程保持原状；本记录不宣称任务集合补修已完成真实验收。


## 后续 PROGRAM 目录补修与复验

[2026-11-21 补修和最小真实闭环](task-program-inventory-order.md)单独记录产品提交、两套真实结果及枚举变化。本页原失败、当时范围和缺口均保留，不由后续结果回填。
