# S5a：本机已安装库与精确直接引用（分支候选）

`codex/library-reference-add` 提供 0.27.0 候选版、30 项工具。`library_catalog` 只读本机原生库目录，不需要工程身份；`library_reference_add` 是独立写工具。原 28 项工具输入保持兼容，`library_inspect` 仍只读当前 Application 的直接引用及可取得的原生解析原文。

## 使用范围

1. 用 `library_catalog` 的 `query` 过滤并按页取得已安装库的原生显示名、独立厂商／标题／版本／默认命名空间 getter、文件路径及精确身份。过滤只是定位辅助，不代替精确身份；分页受同一目录版本约束。字段读取失败或身份重复时不用于写入。
2. 打开用户指定工程，选定实际 Application；用 `library_inspect` 取得完整直接引用、库管理器身份及配置版本。占位符、直接引用和间接依赖分别报告。
3. 精确指定已安装库身份和命名空间，提交两个原查询操作引用、当前工程磁盘哈希和直接引用版本。服务在写前重新枚举目录、直接引用和管理器；同名其他版本、命名空间及占位符冲突拒绝。已存在完全相同的直接引用是可核对的 no-op，不伪造保存。
4. 原生 `IScriptLibManObject.add_library(ManagedLib)` 写入后立即读回，保存、关闭重开再读回。变化使旧编译证据失效；按最终文件完成真实编译，必要时保存版复编。部分结果不确定时保留原文件、检查点和异常，返回 `unknown`，不自动移除或恢复写入。

用户只需说明工程和所需库；Agent 查询内部身份和版本。日常不默认采集比较基线，`project_compare` 的源码／任务覆盖不等于库配置验证。S5a 不安装、下载、卸载、移除、替换版本、改占位符解析或自动选最新版，也不核对完整传递依赖及运行加载状态。

## 本机原生依据与开发端验收

本机 InoProShop 1.9.1.6 的原生脚本接口提供 `librarymanager.repositories`、`get_all_libraries(False)`、`get_file_path(ManagedLib)`、ManagedLib 的 `displayname`／`company`／`title`／`version`／`default_namespace`，以及 Application 库管理器的 `references` 与 `add_library(ManagedLib)`。库直接引用的独立版本／厂商 getter 未核实，因此不从引用的显示串猜拆这些字段。

独立原生探测工程中，已安装的 **CAA Mathematics 3.5.11.0，CAA Technical Workgroup，默认命名空间 MATH** 从原生目录精确选取；添加前 18 个、保存重开后 19 个直接引用，原引用保持。独立最小调用 `MathSign := MATH.sgn(lr := 1.0);` 在该本机版本编译为 0 错误、1 条历史 CmpLog 警告，并已保存重开。

独立真实 MCP 工程 `D:\InoPro.local\library-reference-add-20261113\AM610_LibraryMCP.project` 直接打开指定文件，调用两个新工具添加同一精确库，再通过既有源码工具接入上述最小调用。真实编译及保存版复编均为 0 错误、1 条 CmpLog 警告；保存关闭重开及最终源码读回成功。首次目录查询的空工程路径处理错误、首次添加缺少桥接读取上限参数的写前失败，已保留原始记录并修正；前者原操作已按 IPC 终态核对，后者未写工程。

最终产品提交 `d109da06fc652118199bbb162b151e4ccb6cdf39` 的自动化回归为 409/409；同版库相关定向测试为 19/19，属于完整回归的子集。之前两轮回归中的固定工具数量断言、测试维护门冲突，以及新加的过期证据和 no-op 测试首败均保留在交付记录中，不累加为最终通过数。最终代码又在独立的 `AM610_LibraryMCPFinal.project` 完成原生身份添加、示例调用、编译、保存重开和保存版复编；两次编译各为 0 错误、1 条 CmpLog 警告。最终直接引用清单已按页读完 19 条，精确目标引用 1 条；交付文件哈希与保存版编译证据相符。

DSH CLI 临时 profile 的第一次命令在参数解析前拒绝，纠正后默认模型路由缺少 API 密钥。仅切换账户路由仍无法启动，因为 headless profile 默认禁用本机凭据服务；依据 DSH 官方 headless 说明在本轮临时 profile 启用已有凭据服务后，模型才实际运行。前述失败均发生在 MCP 工程操作前，原始记录保留。日常 DSH 固定入口和私人配置未调整。

唯一一次进入模型的 DSH CLI 任务在独立 `AM610_LibraryDSH.project` 上完成直接引用及最小调用：16 项成功工程操作，另有 2 次写前 `LIBRARY_REFERENCE_EVIDENCE` 冲突（模型先误用库清单分页版本，随后改用直接引用配置版本）。两次编译各为 0 错误、1 条 CmpLog 警告；保存关闭重开后复编的磁盘哈希与交付文件一致；最终直接引用 19 条按两页取完，精确目标 1 条。没有调用 `project_compare`，没有生成业务副本。工程闭环通过；必要定位、编译与保存流程基本遵循，存在额外辅助读取和两次无写入冲突，因此流程只部分通过。退出候选 CLI 后，原 DSH 0.26 桌面及服务进程已正常恢复；该最终连接的握手和模型接收未另行取证。

**会话提取勘误。**先前临时脚本按最长 `user/message` 选取任务，误选 `source.kind=skill-catalog` 的技能提示，进而错误报告中文任务和答复乱码。旧脚本、旧提取文件和原复核 ZIP 保留。重新从会话 `session-6fec860c-0f8e-4824-a592-03a3749f3eaa` 按 `role=user`、`source.kind=user`、指定工程路径选取消息 `9e91afdf-96d9-480d-8378-9efaa1d80be4`（seq 8）；其正文与原任务文件仅在 CRLF 和末尾换行上有差异，归一化 SHA-256 均为 `e98ef89fc94911ae3b2e4e0ed86c1443bf77c2ce1b771e2d46dc7112b6740d53`。最后一次工具调用后的模型答复 `f3d2ba4f-da66-4a20-a6b6-27205f660f11`（seq 331）与旧归档答复归一化相同，中文均可解码，未含替代字符。53 次工具调用与结果按 `callId` 一一对应，其中 45 次调用 InoProShop MCP。终端或桌面显示是否另有编码异常未单独验收；不能据此宣称模型收到的正文乱码。原任务未重放。

**保存重开证据补修。**复核以生产桥接的原生接口替身和服务离线夹具证明：重开后即使引用和管理器条目相同，枚举失败也可能被旧实现当作成功。本分支补修要求写前、写后和重开后的原生库清单覆盖完整，服务对桥接返回独立复核；枚举失败、截断、必要字段失败、覆盖标记缺失或矛盾，在已写入后均返回 `unknown` 并冻结，不自动移除引用或恢复性保存。正常分页仍允许使用完整底层采集的版本证据。原 409/409 和上述真实 MCP、DSH CLI 正向验收属于补修前产品；补修测试及新的真实 MCP 证据另列，不冒充原模型任务重跑。

**登记目录勘误。**先前候选验收实际使用 `D:\InoPro.local\dsh-phase4-repair-20261028-A1`；日常 DSH 私人配置使用的是另一个既存目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。两者不能混称为同一个日常登记目录。本轮不迁移或改写任何旧登记；在后者上的独立真实 MCP 补验须另有记录，不能用旧候选结果替代。

**日常登记目录独立补验（2026-11-16）。**在确认 DSH 输入为空、由应用菜单正常退出且旧服务进程退出后，使用 `41d1764` 的独立固定 0.27.0 构建连接实际日常目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。独立测试文件 `D:\InoPro-S5a-Daily-20261116\AM610_LibraryDailyMCP.project` 从已验样例准备，创建前哈希 `5e93ac6bc08f4b15986a118c86f2b0a4e7fbdaf7f68a8c054b21570522ef531d`，没有预加目标库或业务调用。真实 MCP 精确添加本机已安装的 `CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)`，命名空间 `MATH`，在 `PLC_PRG` 接入 `MATH.sgn` 的最小调用。18 条原直接引用变为 19 条，最终按 11＋8 两页取完，目标精确一条；没有生成业务副本或调用 `project_compare`。首次编译和保存版复编均为 0 错误、1 条 CmpLog 警告；保存关闭重开、最终源码和库清单读回通过，最终工程哈希 `db54eb74bb7fa2873e2c4cda5dcf919aff71b4ba837f797555fbccc2c26e5328` 与保存版编译证据一致。IDE 新增两份 `.opt` 附属文件和 `.projectbackup`，并创建空的 `Data`、`CppProject` 目录；工程主文件的哈希结论不涵盖这些附属项。候选服务正常退出，原隔离记录哈希 `e983419b475ba032c9fe61ffd24e8c588f6cc799b9f2b1bb2ab48f2e721b28e8` 未变，历史 1 项 unknown 保留。该补验是 MCP 客户端调用，未重新执行 DSH CLI 模型任务；恢复后的 DSH 进程、握手和模型接收分别记录。

**补验后服务状态。**最终固定代码的完整回归 423/423、服务定向 22/22、桥接原生接口替身 7/7 通过；原 409/409 只归属旧候选。中间一次使用旧编译产物的完整回归为 421/423，两项不完整重开证据仍误报成功；另一次定向检查受同时运行的维护标记阻断，失败均保留。测试完成后恢复原日常 DSH 0.26 固定入口：应用主进程和对应工程服务进程可观察，未取得最终连接的初始化握手、工具接收或模型遵循证据；未执行 DSH 工程任务，也未取得新的工程租约。旧候选锁按现有机制保留，未删除。

上述只证明本机离线库引用、编译和持久化。设备完整 I/O、传递依赖、PLC 连接、运行加载及实际行为没有验证；原 unknown、历史质量、脚本信任和 CmpLog 限制保持。

原生接口参考：[CODESYS ScriptingEngine 库管理对象](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html)。调用语法参考：[CAA Mathematics 的 sgn](https://content.helpme-codesys.com/en/libs/CAA%20Mathematics/Current/CAA-Mathematics/Functions/analog-monitors/sgn.html)；在线页面为 Current，实际本机编译针对上述已安装 3.5.11.0。
DSH headless 凭据配置参考：[官方 headless 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)；本轮仅使用临时 profile，不提交凭据或私人配置。
