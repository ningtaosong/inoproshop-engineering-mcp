# 同一 IDE 两次无工程读取：独立入口验证

2026-11-25，承接[保持工程打开的最小设计](resident-project-lifecycle-plan.md)。工作分支 `codex/struct-field-add`，准备基线 `825b88f3d5c5a17c87b69b237938b45a179e9ac5`。只验证固定入口的生命周期，不接入产品MCP，不创建、打开、修改、编译或保存工程，不调用历史reconcile。产品、Schema、初始化正文和日常入口不变。

## 固定验证范围

一个由外部观察器启动并持有的 InoProShop 1.9.1.6 实例，后台线程串行等待结构化请求，读取只经公开 `system.execute_on_primary_thread`。只接收两条不同requestId的 `empty-project-status` 请求。第二条由外部取得并验证第一条结果、同一PID及创建身份仍存活后发送，携带第一条结果原始文件的SHA-256。没有用户文本求值或任意命令入口。

ready及两次读取均核对主线程、唯一MainForm原生类型／安装身份、当前无工程状态和调用栈。脚本尾部不是已经返回的证据；仍含已知ScriptExecutor.Execute、OnApplicationReady或MainForm.OnLoad时不发布ready。额外隐藏非模态窗口可记录，不再要求OpenForms总数为1；可见模态窗口或启动栈消失后主窗仍禁用时停止，不处理提示。

总期限60秒，ready最多30秒，每次结果最多15秒且不越过总期限。失败停止后续派发，保留15秒迟到只读观察，不重放或升级原失败。两条完成后接收线程结束；IDE及其父观察器保留，不调用FileExit，不以退出作为请求成功条件。此处不证明同一工程句柄、38项工具迁移、客户端EOF保留或跨客户端重接。

## 本轮代码与离线证据

- [固定原生入口](../scripts/diagnostics/resident_two_read_probe.py)：复用前轮经IronPython验证的排他UTF-8发布函数，其AST一致性另测；进程、请求、脚本指纹与结果绑定。
- [固定外部收发器](../scripts/diagnostics/resident_two_read_observer.mjs)：复用[原观察器](../scripts/diagnostics/native_idle_observer.mjs)的不可覆盖记录、启动回执和文件指纹函数，沿用[已验独立启动器](../scripts/diagnostics/start_native_idle_observer.ps1)及只读维护句柄，不启动旧MCP工程服务。
- [Python替身检查](../scripts/diagnostics/test_resident_two_read.py)：实际启动前CPython39项通过；本机IronPython2.7.7.0完整脚本解析通过，40项离线定义／CLR委托检查通过，未执行原生入口正文。运行后离线补修的归属见文末，不相加。
- [Node检查](../scripts/diagnostics/test_resident_two_read_observer.mjs)：24项通过，覆盖两次独立请求时序、第一条失败不发第二条、身份／线程／模态／启动栈缺证等。不是工程或模型验收。
- 首次CPython37项中1项失败是测试对派发记录发布失败的读次数期望不当；已保留原日志并区分读取前与结果发布失败。IronPython首次完整解析通过，但40项中4项因记录器嵌套 `dict(..., **fields)` 的System.String→IDictionary异常失败；首败脚本与哈希保留，改为dict后update通过。未把Python3通过替代IronPython证据。

运行时固定为已核实IronPython2.7.7.0，DLL SHA-256 `dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`。只扩展既有[离线解析检查器](../scripts/diagnostics/check_native_idle_ironpython.ps1)的审计测试文件白名单，原无工程入口不改。

## 原现场维护与本轮状态

主协调在本轮实际启动前，核对原62052／33384／17060创建身份及空工程窗口后正常关闭原IDE。执行线程仅归档既有退出回执，没有重放界面动作。原回执2026-11-25 14:31:02为IDE exit/close=0、signal=null、late=true，只读辅助进程exit=0；原final-observation仍unknown／EXIT_DEADLINE、缺result，不改判原试验，不覆盖旧ZIP。Node自身退出事件只作为runtime回调，不冒充独立OS退出回执。

执行前技术复核材料：`D:\InoPro-ResidentTwoRead-20261125\REVIEW.md`、`launch-intent.json`、`request-examples.json`、`review-fingerprints.json`；旧维护副本、首次失败及离线结果均在同目录。原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1` 不变，144项保全材料准备时字节一致；不删除锁、变更租约或改判unknown。

## 唯一真实启动：在初始化异常后停止

技术复核确认的intent SHA-256为 `1938d2578a064772db2664afec74fa3f87db5ea2899b0587f20a21027d1fe42f`；固定原生脚本 `f18fb558f15cff35eb3735382c090bdc4616cfac242e0a166ef96e9681a02cb4`，观察器 `6d6aec179b4adf725721a7b92776443d98c053fe8090e3031a917c762633ab47`，启动器 `4b1bd72221330b86b9385b90e2574cedc28786cef7d253ddb0c223f3517a500a`。执行前再次核对52项固定文件、144项保全材料及无占用，未更改已审字节。

| 阶段（北京时间2026-11-25） | 实际证据与结果 |
|---|---|
| 14:43:54 外部观察器启动 | PID47044、创建身份639311858342630703；外部启动回执inJob=false；随后其内部Job归属不用于推断初始化返回 |
| 14:44:00 IDE启动 | 唯一PID41396、创建身份639311858406372768；标准profile和固定runscript，未使用工程参数 |
| 脚本入口、模块加载 | `native-0001-script-entry.json`、`native-0002-modules-loaded.json`均取得；实际脚本指纹与已审一致 |
| 14:44:08 初始化 | `system.execute_on_primary_thread(_controller.initialize)`返回 `StandardError: 调用的目标发生了异常。`；首次异常原文与traceback在`native-0003-first-error.json`。没有initialization完成记录或ready |
| 停止及迟到观察 | 父观察器停止派发；14:44:23有界观察结束，未取得任一结果或退出回执。没有再次启动 |

**实际两条请求均未发送，完成数0；工程调用、保存、编译及FileExit均为0。** 当前只能确认固定入口和模块加载已发生，不能宣称持续接收或主线程两次往返已验证。主线程初始化调用的外层异常没有保留回调内部具体异常；没有证据定位到哪一个属性、守卫或回调步骤，不能把这条通用错误归因于整个公开入口不可用。原IronPython记录器缺陷已离线修正，与本次原生外层异常分别记录。

运行后首先确认的缺口是初始化回调内部的原始异常与阶段证据，本轮按下段仅离线补修；不改参数重发、不增加第二次启动、不进入工程业务或FileExit诊断。不能用本轮“进程仍活着”替代请求成功。

按运行后的技术复核意见，本轮另完成**离线最小取证补修**：初始化回调在内部捕获首错、Python traceback及公开CLR异常链，记录回调进入；记录器异常与首次异常分别保留，链缺失或字段读取失败不标完整。初始化不确定时不启动后台接收线程。该修改未用于第二次真实启动，不能补填run-01内部异常或改判真实验证。补修后CPython44项、同版IronPython46项分别通过，完整脚本仅解析编译；Node24项沿用未变观察器检查。原始stdout仅有AddedToUI一行，stderr为空，没有提供更具体根因；本地报告生成的一次UTF-8／GBK解码错误亦单列，不属于原生失败。

补修后入口SHA-256为 `6a629bc9c39c06d2f996519a846fdefac754b2a7465daa3e1db7f3bccb2af224`，对应`ironpython-manifest-04.json`／`ironpython-04.json`，只有离线验证。实际run-01仍使用前述`f18fb558...`固定版本，未被覆盖。

截至本轮事后取证，IDE41396、父观察器47044、只读句柄辅助进程2544（创建身份639311858395794359）仍存活，保留待明确正常维护，不先停父观察器；有界文件观察已结束，没有后台接收循环成功启动。144项受保护文件字节未变，无新MCP操作或历史reconcile。日常入口、旧unknown和隔离状态不变。现有运行记录见上述本地目录的`run-01`、`retained-processes-after.json`及`protected-after-failure.json`；以归档时点为准，后续自然退出须另存回执，不补判本轮成功。
