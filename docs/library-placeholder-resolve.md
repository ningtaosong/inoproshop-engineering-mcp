# S5b 第一子阶段：已有占位符的应用级显式解析

功能分支 `codex/library-placeholder-resolve` 提供 0.28.0 候选版。`library_placeholder_resolve` 只对当前 Application 的原生库管理器中**已存在**且归属可确认的普通占位符设置一个精确已安装库；它不创建占位符、不把占位符转换为直接引用，也不清除覆盖。原 30 项工具仍保持原调用语义；`library_inspect` 的兼容输出新增 `explicit_redirection` 与独立占位符配置版本。

## 原生依据与边界

InoProShop 1.9.1.6 的 `IScriptPlaceholderReference` 提供 `get_redirection()`、`set_redirection(fixed_resolution)`、`default_resolution`、`effective_resolution`、`resolution_info`、`resolver_guid` 和 `is_redirected`。接口参考：[CODESYS ScriptLibManObject](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html)。[占位符设置说明](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_cmd_placeholder.html)列出应用、设备等多个解析来源；有效解析字符串不是应用级显式覆盖或运行加载证据。

本机独立探测工程 `D:\InoPro-S5b-Probe-20261116\AM610_PlaceholderNative.project` 使用原生 `add_placeholder` 仅准备验收夹具，随后对用户自建 `#S5bDemo` 调用 `set_redirection`。原生 ID `3315765126`、Application 和库管理器 GUID、默认/显式/有效解析、保存关闭重开前后读回均见探测记录。目标库由已安装库目录的独立名称、厂商、版本和默认命名空间 getter 确认：`CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)`、`MATH`。探测期间 IDE 提示一次库加载失败；按正常对话框确认后脚本完成并返回 `passed=true`。该提示与后续是否可编译分别记录，不将提示隐去。

原双路样例已有的 `#InoParamsConfigLib` 为 `system_library=true`，其默认解析和重定向来源不能归为本功能可写范围。写入时要求占位符是原生对象、`system_library=false`、非直接引用、Application 内管理器身份唯一；没有显式覆盖时若已有其他有效解析来源，拒绝推断其归属。本轮只验证该收紧的应用级场景，不开放设备、系统或未知解析来源。

## 使用流程

1. 用 `project_open` 打开用户指定工程，并选定精确 Application。用 `library_inspect` 取得完整直接引用、占位符原生 ID、库管理器 ID、`configurationVersion`、`placeholderConfigurationVersion` 和当前磁盘哈希。分页时按实际 `nextOffset` 取完整清单。
2. 用 `library_catalog` 查询本机已安装库，核对原生 `identity`、名称、厂商、版本、默认命名空间和目录版本。不能从显示串猜拆身份或自动选择最新版。
3. 只在目标占位符非系统且原生结构完整、命名空间相符时，提交 `library_placeholder_resolve`。服务在写前重新读取清单和目录，绑定两个查询操作及工程磁盘版本，检查点先于原生 `set_redirection`。相同**显式覆盖**才是 no-op；有效解析碰巧相同不算。
4. 写后及保存关闭重开后核对目标 ID、覆盖、有效解析、非目标直接引用和覆盖、源码快照及指定工程路径。库配置变化使旧编译证据失效；应真实编译并确认最终保存文件的适用性。

接口拒绝身份不明、旧版本、库目录变化、读取失败、截断、目标归属不明和命名空间冲突。已写入后无法确认返回 `unknown`，保留工程和检查点并冻结后续写入，不自动反向设置、删除或恢复性保存。直接编辑与旧副本模式执行同样的保护。查询中的“已安装”“直接引用”“占位符默认解析”“应用级显式覆盖”“有效解析”以及“实际运行加载”分别是不同事实；本阶段不审计完整传递依赖或设备 I/O，也不连接 PLC 或验证运行。

## 验证归属

原生探测在独立工程上验证了显式覆盖的原生写入、身份保持和保存重开。服务离线夹具和生产桥接原生接口替身验证正常、no-op、写前拒绝、部分写入与不完整证据冻结；它们不等于真实 IDE 故障注入。最终产品提交 `3a6528d109a729fa4634b90a2605c757a0e218eb` 的完整 JavaScript 回归为 437/437，Python 原生接口替身为 10/10，定向 JavaScript 为 14/14，计数互不相加；首次失败和中断记录单列。

2026-11-16 的真实 MCP 验收使用独立固定 0.28.0 构建及 DSH 当前配置的数据目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。`project_open` 原操作 `7ca58d12-737e-4534-a21f-8178a4c2b580` 在 IDE 超时后终态为 `unknown`；服务与桥接进程随后退出，目标工程主文件 SHA-256 仍等于准备时的值。文件哈希不变不能证明 IDE 操作的完整终态，因此未重放原请求，也未继续调用 `library_placeholder_resolve`、编译、保存或 DSH CLI 模型业务任务。原锁和操作记录保持原样。真实 MCP 写入闭环和 DSH CLI 验收仍待完成；原生探测及离线测试不得写成这两项验收通过。

日常 DSH 0.27 入口和 Codex 0.16 入口均未因本分支永久变更。首次恢复 DSH Desktop 时，应用在插件配置组合阶段报 `cannot resolve package "@deepseek-ai/dsh-experimental-agent-team-profile"`；当时未改动配置或取得日常连接握手。后续只读核对、最小修复及恢复结果见下节；首次失败记录仍保留。

## 2026-11-16 阻断复核与 DSH Desktop 恢复

原 `project_open` 的 IPC 保留 `request.json`、`dispatched.json`、`stdout.txt` 和 `stderr.txt`，没有 `result.json` 或 `observed-after-exit.json`。派发标记和 `AddedToUI` 证明请求已进入 IDE，不能按未派发重试。原服务和桥接进程均已退出；工程主文件哈希未变，但 `.~u` 和备份附属文件发生变化，仍不足以确认原操作终态。对应时段 IDE 错误日志记录临时文件删除权限异常，信息日志随后仍有工程和库加载活动；没有证据证明先前探测中的库加载提示导致本次超时。操作继续为 `unknown`，没有重放、改写状态或打开故障工程。

现有只读隔离评估返回 `eligible=false`、`ISOLATION_OWNERSHIP`：该直接打开请求在登记前超时，暂定工程身份未写入登记，现有归属判断无法唯一绑定已登记工程。本轮未提交隔离，未删锁或解除冻结。若后续处理，需要为登记前的直接打开补齐可信归属和文件身份核对，并验证维护流程；不能套用旧副本工程的归属规则。

DSH Desktop 2.0.2 内置的 DSH 核心为 `0.1.1-rc.2`、Cordis 为 `4.0.1`。Desktop profile 的 bundle 清单引用了两个未安装、未在该 profile 依赖清单声明的包：`@deepseek-ai/dsh-experimental-agent-team-profile` 和 `@deepseek-ai/dsh-experimental-auto-review`。前者不在 InoProShop 的 `cordis.patch.yml` 或 `cordis.yml` 中；未找到可核实匹配当前核心与 Cordis 的安装版本。经用户分别授权，先备份再各移除一条缺失 bundle 引用，保留其余插件与 InoProShop 配置；没有安装未经核实的新包、重置配置或清除会话。恢复窗口先后报告这两个包缺失，第二次调整后 DSH 正常进入主界面，缺失功能目前不加载。

最终可观察到 DSH Desktop 进程及其子进程从原日常固定 `0.27.0` 路径启动 `dist/server.js`，仍使用原配置的 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。这与 `D:\InoPro.local\dsh-phase4-repair-20261028-A1` 是不同目录；按用户决定保持实际 DSH 配置，不迁移历史记录。此次没有取得最终连接的初始化握手、30 项工具接收或模型遵循证据；主界面恢复与子进程存在不能代替这些检查。原 `unknown` 及工程派发冻结仍保持，S5b 真实 MCP 写入闭环和 DSH CLI 业务验收未完成。
