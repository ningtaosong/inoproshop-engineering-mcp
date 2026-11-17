# S5b 第一子阶段：已有占位符的应用级显式解析

## 2026-11-17 整合复核

独立复核分支 `codex/s5b-library-dialog-integration` 从 S5b `13d8912` 整合提示处理分支 `16aebdf`；保持 0.28.0 候选版、31 项工具。31 项输入与原 S5b 产品逐项一致。相对 0.27.3，29 项旧输入完全相同；`library_inspect.fieldRead.field` 保留 S5b 原有的加法扩展 `explicit_redirection`，另新增 `library_placeholder_resolve`。精确提示处理仍只授权直接 `project_open` 的 `initial-open`。下文旧测试与真实工程记录不自动归属本次整合。

代码复核发现后续验收缺口：`library_inspect` 和 `library_placeholder_resolve` 各自派发新的原生打开，前一次只读 `project_open` 不会保存占位符修复，也不会留下可供后续调用复用的 IDE 工程。服务不给这两项操作附加提示确认策略，桥接也只允许 `inspect` 接收该策略。因而若后续打开再次出现同一库加载提示，本次整合不会自动处理，原超时与 `unknown` 规则仍适用。这是明确的覆盖范围及风险，尚非这两个调用的新一次实机超时证据。

在后续调用的提示处置方案得到独立验证前，不将此前的只读打开成功当作 S5b 完整工程验收通过。本轮先完成离线整合复核，不派发可能再次留下未决状态的真实写入或 DSH CLI 工程任务。不得用预先设置目标覆盖的夹具、手工代做业务写入或放宽未知提示确认，代替首次有效写入和保存重开的验收。

整合产品提交为 `fbe8fafc2044033fe023b5be995d4849bc773bad`。构建、类型检查及指令大小检查通过；独立测试临时目录中的完整顺序 Node 回归为 **452/452**，Python 为 **195/195**，两者及历史计数不相加。Node 使用原 `npm test` 命令，仅为该测试子进程设置独立 `TEMP/TMP`，避免合成隔离夹具与日常全局隔离目录混用。它不构成真实服务换数据目录或绕过工程隔离；本轮没有启动候选的真实工程操作。

同一整合代码在本机默认临时目录单独运行原并发状态查询测试，仍失败于既有 **200 毫秒**断言，没有放宽该阈值。只读测量显示：包含 4 个现有全局隔离索引时，空本地登记的 `session_status` 每次读取 45 个文件，三次耗时约 234/214/226 毫秒；空独立临时目录中读取 3 个文件，约 2.47/2.51/0.56 毫秒。这将现有隔离核验读取开销列为可复现影响因素，不证明全部耗时原因，也不代表日常性能问题已修复。旧 0.27.3 的 435/438、三项复测及本次默认环境失败均保留，不能合称所有环境全绿。

原复核 ZIP 的总 SHA-256、68 项清单内文件、源文件与 `16aebdf` 的对应（规范化换行后）、入口链接均核对通过。原两次工程主文件仍与初始哈希一致，两项操作仍为 `unknown`；本轮前后核对的两项原操作、隔离账本及三个独立记录共 6 项哈希不变。日常 DSH 配置哈希与原恢复记录一致，原应用与固定服务进程仍在；本轮没有取得新的握手或模型接收证据。未合并 main、未永久部署，S5b 真实工程与模型验收仍未完成。

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

## 合入隔离修复后的再次验收（2026-11-16）

功能分支正常合入 main 的 0.27.1 登记前直接打开隔离修复，合并提交为 996a34992fff7eba2600b94745dfae22488c8cc0。合并冲突只涉及 0.28.0 版本和工作指令首句；resolve_placeholder 的隔离操作映射、检查点识别与异常路径保留，v1/v2 隔离账本仍可读取。独立固定构建从该合并提交生成，版本 0.28.0、31 项工具；原 30 项输入仍兼容，library_inspect 仅扩展一个可选字段值。构建、类型检查、指令大小检查、Python 桥接 181 项及 Node 定向 49 项通过。完整回归及其最终结果见本轮复核记录，不能把旧 437 项称为合并后的结果。

只读检查确认原 v2 计划 711062e0-eb1c-492f-a875-5cd6b17548a4 已提交、原操作 7ca58d12-737e-4534-a21f-8178a4c2b580 仍为 unknown，隔离路径守卫返回 PROJECT_ISOLATED；另有旧 v1 隔离记录仍可读取。没有打开、复制或重放该隔离工程。独立夹具 D:\InoPro-S5b-MCP-Resume-20261116\AM610_PlaceholderMCP_Resume.project 从正常双路样例准备；原生 add_placeholder 仅用于夹具准备，记录了非系统占位符 #S5bDemo 的身份、结构与保存重开，不属于 MCP 的占位符创建能力。

对该夹具的首次真实 MCP project_open 已派发，操作 3b418879-dc72-4d64-a19b-bad9c75a46b7、请求 d6883202-abd6-457d-9820-ca13039c3186 在 IDE 超时后为 unknown。IPC 有请求与派发标记，stdout 只有 AddedToUI，没有可信结果。打开期间 IDE 出现“加载一个或多个库失败”的信息提示；本次未取得其与超时的因果证据。工程主文件 SHA-256 仍为 F711E91765D2A8B6108DE6A03F0B202C8FD659DC6A542831B2396E874A6B9D73，附属文件另有变化；相同主文件哈希不能确定 IDE 操作终态。服务与桥接退出后，没有重试首次打开，没有调用 library_placeholder_resolve、编译、保存或 DSH CLI 模型任务。新 unknown 与旧隔离记录都保留；继续 S5b 工程验收需要先按现有维护机制核清或处置新操作，且不能因此宣布旧 IDE 超时原因已解决。

完整 JavaScript 回归于合并产品提交 996a34992fff7eba2600b94745dfae22488c8cc0 上新跑 446/446 通过；Python 桥接 181/181、Node 定向 49/49 单独记录，彼此不累加。验收停止后正常启动原日常 DeepSeek Harness；窗口空白新会话可见，进程从原 0.27.1 固定入口启动，未修改私人配置。最终连接的 initialize、30 项工具接收、模型遵循和工程租约取得均未观察到，不能以进程和窗口代替。候选残留租约仍由原机制管理，没有人工删除或改写；新的 unknown 继续限制工程派发。

## 2026-11-17 精确提示覆盖整合

本节记录 `codex/s5b-library-dialog-integration` 的后续修正，保留上文旧提交与故障记录的原归属。`library_catalog` 只查询本机库目录，不打开工程，也不启用提示处理。每次下列工程工具派发都会由独立 IDE 子进程执行一次原生 `initial-open`；占位符设置、源码修改和工程保存还会在本次操作内保存、关闭并执行 `reopen`：

| S5b 步骤 | MCP 工具 | 原生打开阶段 |
| --- | --- | --- |
| 选定工程和定位对象 | `project_open`、`project_structure`、`object_list`、`project_search` | `initial-open` |
| 库和源码读回 | `library_inspect`、`object_read` | `initial-open` |
| 设置应用级显式覆盖 | `library_placeholder_resolve` | `initial-open`、`reopen` |
| 接入最小调用 | `code_apply_change` | `initial-open`、`reopen` |
| 离线编译 | `project_build` | `initial-open` |
| 保存并核对最终文件 | `project_save` | `initial-open`、`reopen` |

服务只为这些工具的**直接编辑**请求传递固定阶段策略；历史 `project_open_copy`、其他工程工具、`library_catalog` 和 `recovery-reopen` 不启用。桥接再次核对命令、直接工程守卫、阶段清单和截止时间，不能由请求任意扩大处理范围。仅匹配本机 InoProShop 1.9.1.6 的精确库加载信息提示、当前服务启动的 IDE 进程实例、模态窗口结构及唯一确认按钮。每项操作的每个列明打开阶段最多确认一次，总量至多两次，共用原操作截止时间；阶段观察线程结束后才能进入下一阶段。操作记录已转 `unknown`、身份或记录无法核实、提示不匹配或观察线程未能退出时停止自动处理，保留原始提示、阶段及错误记录。确认信息按钮不代表库已解析或工程操作成功；原生调用、写后核对、关闭、结果发布和退出后的磁盘证据仍各自决定结果。Windows 以外平台、其他提示、其他打开工具及恢复性重开未纳入本次承诺。

当前 DSH 配置与既有隔离记录使用 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`；用户已确认本轮沿用它，不迁移或换用另一个同名目录。两份旧故障工程及其 `unknown`、v1/v2 隔离记录继续保留。默认临时目录中状态查询的 200 毫秒断言失败已在 0.27.2 基线上复现，不能因独立临时目录中的测试或后续工程闭环而抹去，也不在本次加入缓存或放宽阈值。真实 MCP、DSH CLI 及最终回归各自的结果和提交归属继续在本节追加。

### 本轮真实 MCP 首败及后续补修

独立固定候选来自 `9daebb3a2ad8d8f4e66744e7823961acf060ce9a`，版本 0.28.0、31 工具；不是日常服务。第一轮对未隔离夹具 `D:\InoPro-OpenDialog-McpDiag-20261117-104923\AM610_PlaceholderMcpDiag.project` 的 `project_open` 与 `library_inspect` 均成功，原生清单完整捕获 19 条直接引用。验证脚本却只检查首个分页的 10 条，未找到位于下一页的 `#S5bDemo` 而在写前停止。保留原脚本、原结果；另存分页修正脚本，没有掩盖这次验证失败。

分页修正后的独立调用取得完整引用分页、安装目录与精确 CAA Mathematics 3.5.11.0（CAA Technical Workgroup，命名空间 MATH）身份，并且确认该普通占位符没有显式覆盖。`library_placeholder_resolve` 请求 `e62ec594-3ae2-4c39-a98a-99142174120c`、操作 `7247cab3-a49a-4e3f-8ed5-73f47850a91f` 已派发。其 `initial-open` 观察到精确提示并于 2026-11-17 14:35:09 本地时间发送一次确认。原生进程随后报告项目切换、清理和结果发布，但提示观察线程在主线程等待时未能确认退出，正式操作返回 `unknown`，错误为 `Prompt observer did not stop; native open result is uncertain`。阶段位于目标库设置之前，`saveAttempts=0`；主文件 SHA-256 前后均为 `1f45e07eaf0f58212bb753d97cfe68a5eac794d299e61fea4f768efbcb747447`。这不等于该操作取得成功或原生内存状态已获完整确认。服务停止后只读隔离评估没有阻断，**未提交隔离**，未改写原操作。后续源码修改、编译、业务保存及 DSH CLI 任务均停止；没有换工程绕过冻结。

新失败证据指向确认后 `WindowsDialogBackend.remains` 对 UI Automation 的整棵窗口树再次枚举：观察线程可能等待 IDE 主线程，而主线程正对观察线程执行有限 `Join`。在 `9daebb3` 之后的补修改为确认后只以 Win32 `IsWindow` 和 `GetWindowThreadProcessId` 查询原窗口句柄，不重新枚举 UI Automation；窗口仍在、归属无法确认或查询异常时继续保守标为不确定。本机随 InoProShop 交付的 IronPython 3.5.11.10 程序集及 ScriptLib 环境中，独立不打开工程的探测确认 `ctypes` 能调用这两个 Win32 接口。此补修尚未在真实 IDE 上重做占位符写入。新 `unknown` 需按原维护机制另行处置，不能用离线通过或主文件未变解除冻结。

完整 Node 回归在独立测试临时目录于 `9daebb3` 产品上为 454/454；早一轮因桥接生产片段测试替身缺少 `threading` 导致 445/454，修正后受影响 20/20 及完整运行分别保留。默认 Windows TEMP/TMP 下旧 200 毫秒状态查询断言仍失败。补修后的完整 Python 桥接回归为 207/207，其中精确提示及生产阶段定向 18/18；新增定向测试首次有 2 项失败，修正测试夹具后通过。补修后的最终代码另完成隔离临时目录 Node **454/454**、构建、类型检查及指令大小检查；两轮 454 项高度重叠，不累加。

候选服务及 IDE 均退出后，旧服务租约经进程身份核对为原拥有者已退出；没有手工删除或改写锁。DSH 通过应用菜单正常退出、再按既有 desktop profile 启动。恢复配置仍指向 `C:\Users\Administrator\.codex\worktrees\direct-open-daily-fixed-0271\InoPro\dist\server.js` 和原登记目录；观察到新的 DSH 主进程 PID 66388（2026-11-17 14:56:31）及该固定入口的 Node PID 46420（14:56:34）。没有取得此最终连接的 initialize 报文或 30 项工具接收记录，也没有向模型提交业务任务；进程启动不能替代握手或模型遵循。新 `unknown` 仍限制工程派发，旧隔离与历史 `unknown` 未变化。
