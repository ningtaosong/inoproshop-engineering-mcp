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

唯一一次进入模型的 DSH CLI 任务在独立 `AM610_LibraryDSH.project` 上完成直接引用及最小调用：16 项成功工程操作，另有 2 次写前 `LIBRARY_REFERENCE_EVIDENCE` 冲突（模型先误用库清单分页版本，随后改用直接引用配置版本）。两次编译各为 0 错误、1 条 CmpLog 警告；保存关闭重开后复编的磁盘哈希与交付文件一致；最终直接引用 19 条按两页取完，精确目标 1 条。没有调用 `project_compare`，没有生成业务副本。工程闭环通过；必要定位、编译与保存流程基本遵循，存在额外辅助读取和两次无写入冲突。PowerShell 向 CLI 传入中文任务时发生编码损坏，模型实际收到的文字及原答复均有乱码，因此**原文送达和答复展示未通过**；保留原始任务文件、实际会话文本与单独勘误，不重放已成功的业务任务。退出候选 CLI 后，原 DSH 0.26 桌面及服务进程已正常恢复；该最终连接的握手和模型接收未另行取证。

上述只证明本机离线库引用、编译和持久化。设备完整 I/O、传递依赖、PLC 连接、运行加载及实际行为没有验证；原 unknown、历史质量、脚本信任和 CmpLog 限制保持。

原生接口参考：[CODESYS ScriptingEngine 库管理对象](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html)。调用语法参考：[CAA Mathematics 的 sgn](https://content.helpme-codesys.com/en/libs/CAA%20Mathematics/Current/CAA-Mathematics/Functions/analog-monitors/sgn.html)；在线页面为 Current，实际本机编译针对上述已安装 3.5.11.0。
DSH headless 凭据配置参考：[官方 headless 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)；本轮仅使用临时 profile，不提交凭据或私人配置。
