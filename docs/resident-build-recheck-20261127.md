# 常驻编译复验：写前类型元数据冲突及离线补修

2026-11-27，分支 `codex/resident-mcp-session`，0.41.0候选、38项工具。main仍为 `55bb58fc97b266215ad536b6b0f9d4f66c80670f`；未合并、未部署、没有DSH模型任务。此记录接续[编译依赖补修](resident-compiler-library-fix.md)，不覆盖旧unknown或原编译结果。

## 本轮实际结果

新的唯一工程：`D:\InoPro-ResidentBuild-Recheck-20261127\engineering\AM610_ResidentBuild.project`。来自已核实中性ZIP中的 `projects/AM610_Minimal_MCP.project`，种子SHA-256 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`，没有复制unknown工程。使用原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。

| 阶段 | 实际结果 |
| --- | --- |
| 准备 | 原生打开、列出、读取；一次源码准备为5秒／FALSE，一次保存并重开核对。四次batch IDE均取得请求绑定的正常退出0；准备编译0次。 |
| 正式打开及读取 | 固定产品 `02c8edff97685df696b9124ca76db187160881e0`，同一MCP连接、IDE61896、launch `b3c47d3c-01be-4d89-af02-82a43fda8ec2`，实际读到5秒／FALSE。 |
| 正式修改及独立读回 | 只派发一次5→7修改，声明、FALSE及两条中文保持；独立object_read确认7秒／FALSE，磁盘未变。 |
| project_build | 操作 `d127e6f2-7518-41bf-af4c-cb8e290217ee` 返回 `conflict / RESIDENT_PRECONDITION`，`dispatched=false`。复查差异发生在原生编译前；无dispatch、build-call或compiler-result，真实编译0次，错误／警告数不适用。 |
| 停止 | 驱动停止后续派发；未重发编译、未进行TRUE修改、保存或关闭，没有本轮新unknown。新IDE及连接仍保留。 |

准备后的磁盘SHA-256为 `ecc5978e7c5dd252e7531c570ca92e886b3b5a093ccde4db5392a97aea4742f6`，正式停止后保持。磁盘保存内容仍为5秒／FALSE；7秒／FALSE是未保存内存状态。正式阶段保存／关闭／退出均0。附属文件单列：新增两份用户选项文件、autosave及`.~u`占用文件，projectbackup仅修改时间变化；不能说整个目录未变。

正式共五项操作，四项成功、一项写前conflict；准备四项。状态查询准备41次、正式37次，原始协议与每项结果均保留。未取得编译后独立读回、保存版编译或IecVarAccess写后保全结果。

## 旧实例维护与必要准入补修

按明确授权，核对原IDE66304、驱动66352、MCP67192的创建身份后，正常关闭原IDE并选择不保存。IDE退出0；随后精确结束获授权旧驱动（观察码-1），MCP因EOF自然退出0，没有强制结束IDE或MCP。两个UI取证定位失败保留，未因此自动增加工程操作。独立.NET观察器的ExitTime给出1601哨兵值，保留原值；有效观察时间和原服务退出事件另列，未把哨兵值当真实退出时间。

原操作 `bf310d71-3e21-421b-9c78-233f4a72dd17` 仍为unknown。原工程SHA-256仍为 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。维护后22,201项既有材料仅原接收器stdout追加退出输出，新增其process-exit；无账本改判或历史恢复。

首次只读正式准入因resident请求没有batch的`exitEvidenceVersion/resultPath`字段而全局拒绝。已在提交 `02c8edff97685df696b9124ca76db187160881e0` 增加限定的已结束resident归属证明：原请求、完整连续队列、模块指纹、进程创建身份及正常退出、完整请求完成和服务校验、原文件身份／哈希均对应，且旧IDE和原服务实例均已结束，才收敛到原工程及别名。缺证、活动实例、额外队列、范围或文件变化仍全局拒绝。不是成功、恢复、重开或释放租约证明，原unknown不变。249/249相关Node检查归该提交。

本轮最终相对维护前材料，既有变化仅registry、service.lock及原stdout，另有186项新文件；新操作正常更新登记和租约。历史操作账本、原IPC、检查点及隔离材料无字节变化，原source锁保留。没有手工删锁、改登记、历史reconcile或换数据目录。

## 当前冲突的确定原因及修复

原始before和predispatch递归比较只发现MainTask `78d0f4f0-33ac-4194-ab0a-f8f8fdb32867` 的11项 `nativeType` 变化：

- `taskFields.core_binding`：null→`System.Int32`。
- `taskFields.event/external_event/interval/interval_unit/parent_synchron_task/priority`：null→`System.String`。
- `watchdog.enabled`：null→`System.Boolean`；`sensitivity/time/time_unit`：null→`System.String`。

所有`kind`、`pythonType`、`value`、源码、调用、直接库、设备／连接器上下文及磁盘哈希均保持。本轮尚未进入编译，更没有触及IecVarAccess写后差异。编译前两份已加载OEM程序集的版本与指纹实读匹配既有依据；编译后侧证未取得。

用本机IronPython 2.7.7.0及原固定加载器，在无IDE进程的隔离运行时复现：core初始模块上下文尚未显露CLR `GetType`；第一次`compiler_library_support()`中的`from System import AppDomain`使同模块原始标量暴露CLR类型，未改值也改变记录。CLR可见后原代码还会在原生null上尝试GetType并抛TypeError。这解释了本次已留存的采集变化，不推广为OEM崩溃或全部旧unknown的原因。

产品补修提交 `02e50993aebb5c02a6fdb6e8bc1998cc8a1c292a` 仅在IronPython模块加载时先`import clr`，使首次快照已取得同一类型证据，并在GetType之前明确处理null。没有删除nativeType、没有把null与任意CLR类型等价、没有放宽比较或重写旧快照。服务端仍严格拒绝类型、值、未知字段及覆盖变化；原本不支持的CLR Int64包装值继续拒绝，不借此扩大支持类型。

新独立固定目录 `D:\InoPro-ResidentBuild-Recheck-20261127\fixed-02e5099` 相对本轮实际运行的fixed-02c8edf，产品仅`bridge/resident_core.py`改变。107项产品文件指纹已核对；38项输入／输出Schema及初始化正文不变，正文65,135、含客户端标题65,162／65,536字节。未启动该新构建的连接或IDE，未向当前实例热加载。

## 验证归属和首败

| 验证 | 结果及边界 |
| --- | --- |
| 同版IronPython生产固定加载及编译 | 核心37/37、编译16/16、库依赖37/37、新标量9/9；分别记录。生产ResidentSession替身经过首次程序集读取仍可完成内存编译；无真实IDE。 |
| CPython相关集 | 99项，95通过、4项明确仅适用于IronPython而跳过；不能替代同版CLR验证。 |
| 受影响Node集 | 391/391；随后修正服务反例的替身输入，使写前版本保持不变，最终服务库校验集75/75。两组不累加；两次间产品未变。 |
| 开发／新固定构建 | 构建、类型检查、契约及指令指纹通过；无全产品回归。 |
| 新固定模块无工程复现 | 12个原值在程序集读取前后完全一致，null、空串、字面文本None及确切中文分别保留。不是新IDE验收。 |

首败不删除：准备队列读取JSON时默认GBK解码失败（派发前）；首个标量复现遇到None.GetType；测试替身缺少requestId；测试误期望原本不支持的CLR Int64通过。随后只修测试输入或预期，没有放宽产品范围。首两份诊断脚本中文常量在PowerShell输入时变为“涓枃”，不能当作中文送达证据；原样保留，后续用ASCII Unicode转义构造并断言“中文”。真实MCP中的两条中文注释另有原始读回证据。默认环境性能及200ms阈值未调整。

## 当前保留现场及下一步条件

IDE61896／创建身份 `639313400007783152`、MCP28312／`639313395438897107`、驱动68036／`639313395436351401`仍运行。原生接收器没有首错或stop标记；本次可恢复写前conflict不等于unknown。验收队列驱动已经按约定冻结，未派发第六项请求。

仅准备了只读维护评估，没有执行新实例收尾。当前队列驱动没有finish控制入口，仓库另一驱动的finish命令不能指向该连接。现有`readBeforeShutdown`辅助虽然允许conflict终态，但Application核验要求结果data.applicationId；该写前conflict只返回请求绑定和错误，因此该辅助也不能直接证明当前会话可收尾。本轮只记录此限制，不扩大修改范围。尚无已核实的命令行正常IDE关闭入口，不能把窗口维护步骤或终止驱动写成正常finish命令。

后续须明确这一个新实例的未保存内容处理及正常维护授权，再核对上述身份、文件版本、无活动请求和完整五项证据。新补修应在新的固定产品会话中复验；不得热加载、不以本轮冲突为理由自动重读并重发。当前7秒内存未保存，不能宣称保存版已编译或本轮内存编译通过。

历史unknown、隔离、原失败现场、旧锁、默认性能、崩溃根因、CmpLog、脚本信任、Desktop与PLC运行边界保留；未合并main、未部署日常入口、未进行FALSE→TRUE后续轮次。
