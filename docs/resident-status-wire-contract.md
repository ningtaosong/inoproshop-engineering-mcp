# 常驻状态查询的 MCP 输出契约补修

2026-11-28。分支 `codex/resident-user-save-continuation`，仍为 **0.42.0 候选版、38 项工具**。本补修未合并、部署或改变日常 DSH 0.38.0／Codex 配置。前一轮[查询一致性及无工程结束记录](resident-query-status-consistency.md)保留原时点与失败。

## 已确认的缺口

`802adc429463ac8af722bf324751c699b6d4f09d` 的服务内部状态补修经过直接调用测试，但未经过 MCP 输出契约。`session_status` 的公开 `data.availability` 只允许 `global-frozen`、`active-project-isolated`、`available`，新增的 `explicit-open-required`／`unresolved` 不在其中。顶层 data 不允许任意新字段，而 session 对象允许扩展；因此直接把 residentObservation 放入顶层也不完整。查询期间变化的 conflict 返回还缺少 session、pending、writeFrozen 等必需字段。

在该固定产品的真实 DSH 第一轮，三次 session_status 均产生 MCP -32602 输出校验错误。这是产品返回与已声明契约不一致，不是客户端未加载工具。此前仅比对 Schema 未变化、直接调用 service.status 的验证漏掉了返回值校验；根侧复核也未抓到该漏层，不能将此前记录写成完整协议验证通过。

## 最小补修及保护

- 原 38 项输入输出 Schema、初始化正文、版本及桥接均不变。
- session_status 保持旧 availability 枚举。无未决阻断时为 available；已关闭会话必须重新打开的说明放在 summary 与既有可扩展的 `session.residentObservation`，其中 memoryAvailable=false、explicitOpenRequired=true。它不表示存在可直接写入的内存句柄。
- 作用域内真实阻断仍为 writeFrozen=true，保留完整 pending 和原因，不谎报 available 或全局冻结；此时省略可选 availability。全局冻结与正式隔离继续使用各自原值。
- 查询过程中证据变化返回 conflict / STATUS_EVIDENCE_CHANGED，不提供可继续使用的 data 快照。该查询错误不改判正常完成的操作，也不修改任何账本。
- project_list 的项目行原本允许扩展，继续区分 explicit-open-required／unresolved 及观察依据。派发前仍独立重核实际证据。

只改返回表示，没有放宽 guardPending、保存链、隔离只观察、可信进程身份、实际修改后保存或 unknown 规则。原始登记对象不改写；响应中的 session 是副本。

## 离线验证归属

使用长路径独立临时目录，未清理历史登记或改变性能阈值。

| 记录 | 结果 |
| --- | --- |
| 修前生产 service＋真实 MCP SDK 协议路径 | 14 项中 12 失败、2 通过，保留输出契约拒绝 |
| 首次修后同组协议检查 | 14/14 |
| 最终相关七文件回归 | 392/392；包含新增空登记、owned-channel 及真实全局阻断输出校验 |
| 构建、类型检查 | 通过 |

MCP 测试使用真实 McpServer、Client、InMemoryTransport，生产 schemas／outputSchemas、service.call、toolOutput 和交付包装；没有启动 IDE。对错误结果也额外校验完整声明形状，避免依赖服务端对 isError 的跳过行为。退出、身份、磁盘、原请求、并发变化和历史保全反例保留。旧 390/390、14/14 及早期测试首败按原提交记录，不与本表累加；本轮不重跑无关全量测试。

## 802adc4 固定产品真实第一轮的实际结果

独立目录：`D:\InoPro-Resident-Autosave-DSH-20261128-802adc4`。原提示词未改变，业务任务只提交一次；出现协议错误后没有外层工程补写、重放、强制中断或第二轮任务。

正式连接 `29236-7d26d7a5-f8dd-4e6f-b4d5-63c1ef7747e4` 的 initialize/tools/list 留存 0.42.0、完整38工具。SDK会话为 `d6b8c2a2-a86a-4c62-92ff-a9a4e6fdf33a`。固定指令正文65004、含客户端标题65031／65536字节。发现连接另有 server/discover 拒绝和退出证据缺口，未改判。

| 项目 | 实际证据 |
| --- | --- |
| 工程 | `D:\InoPro-Resident-UserSave-20261127\engineering\AM610_UserSave.project` |
| 新工程操作 | 1次resident打开、1次对象列表、2次对象读取、1次code_apply_change；均成功 |
| 修改 | 仅在PLC_PRG实现末尾加入 `// DSH自动保存验证一：保持当前声明和已有注释。`；声明和其他已核对内容保持 |
| 自动保存 | 1次ScriptProject.save，returned、两次保存读回、保存回执、服务提交及独立后读对应同版本 |
| 最终主文件SHA-256 | `224251310c3b04fe0a775fe4d9a57a0cb0aac2afffd2d1f75c95ea2aa0aaafa9` |
| IDE | PID16004，launchId `ba6c408e-9c39-4167-b376-4bd64df2e6b2`，五请求同创建身份／句柄连续；保持打开，无退出回执要求或伪造退出0 |
| 未执行 | 第二轮、编译、显式project_save、复制、比较、关闭、重开及PLC操作均为0 |

工程第一轮的指定修改、自动保存和独立读回通过。**协议及流程验收不完全通过**：3次 session_status 输出错误，第三次发生在 project_open 尚 running 期间；124次本轮 operation_status 查询。原最终答复将三次错误写成“两次”，勘误在独立记录，原回复不改。模型没有查询历史操作，也没有产生新的unknown；不能把工具输出错误说成历史unknown已解除。

保全检查：22,379份历史 operation／IPC 文件字节不变。事前22,787份登记材料中，registry.json和service.lock由本轮正常操作更新；13,482份全局保护材料中仅本工程源锁由正式机制换成新owner，未手工处理。工程主文件、用户opt、projectbackup内容变化及AllUsers.opt仅时间变化分别留存，不宣称整个目录不变。新增本轮操作和IPC单独保留。

此真实工程结果属于802adc4，**不是本次协议补修后的真实客户端复验**。新补修仅完成离线协议与固定构建核对。当前IDE、MCP、SDK和驱动继续保留；若需换用新固定构建，须先有针对当前实例的正常移交授权，不能借用旧实例关闭授权，也不能重放已经成功保存的第一条修改。

## 复核入口与尚未验证项

- `round-1-independent-review.json`：五请求、原生绑定、保存链、独立后读与最终哈希；审计只读，不派发工程工具。
- `round-1-preservation-and-flow.json`、`round-1-business-events.jsonl`：实际调用、三次协议错误、原答复、勘误与保全。仅导出业务事件；私人SDK system/account及YAML留在本机，不打包。
- `status-wire-repair/before-wire-tests.txt`、`after-wire-tests-initial.txt`、`related-tests.txt`：补修前后分别归档。
- 原始已完成SDK回合、正式连接trace及五操作IPC保留；没有覆盖此前首次冻结停止、正式MCP退出1或旧unknown。

两轮DSH自动保存闭环、修后真实客户端、当前Desktop日常握手及PLC运行仍未完成。原服务结束期限缺口、默认环境性能、崩溃根因、CmpLog、脚本信任和历史隔离限制保持；不将源代码静态解释认定为全部退出异常的唯一原因。
