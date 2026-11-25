# 无工程连续请求：初始化守卫分项诊断

2026-11-25，分支`codex/struct-field-add`，承接`aab80be06a59ba3a59857a08cff28a5867b93644`及[首轮记录](resident-two-read-validation.md)。目标为同一自有IDE连续处理两次独立无工程只读请求，结束后保持打开。没有接入产品、工程编辑或DSH多轮；产品、Schema、初始化正文及日常配置不变。

## 原现场与本轮预检

原IDE41396／观察器47044由主协调正常维护关闭，旧run-01追加07:22:05 UTC的IDE exit/close0、只读句柄退出0。观察器runtime exit0与独立OS回执分别解释。原初始化失败、两条请求未发送的结论不变，旧ZIP不覆盖。

新目录`D:\InoPro-ResidentTwoRead-Recheck-20261125`。与旧保全144项比较，143项未变，Codex配置出现外部指纹变化。旧全文未保留，不能定位内容或归因。本诊断显式使用固定PowerShell→Node→IDE链，不加载Codex配置，原登记目录不变；当前配置未发现InoPro MCP条目，本轮未修改配置，只按现有字节重新记录保全基线。首次预检停止和脱敏核对脚本的编码拼写错误分别保留。

## 实际IronPython检查

同版IronPython2.7.7.0、DLL SHA-256 `dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`。完整原生脚本仅解析编译；独立审阅的测试执行函数定义与替身，不执行其入口正文。增加真实System.Windows.Forms.Form属性、Handle/IntPtr、程序集身份、StackTrace和CLR回调检查，Form未显示、未运行消息循环，最后Dispose，不启动OEM IDE。

进入本轮run-01前IronPython47/47、CPython44/44分别通过；观察器未改，Node24/24。离线实际Form互操作正常，并未复现OEM MainForm初始化错误。

## 本轮run-01：主线程已进入，自有检查拒绝

冻结intent `f8049d9c0dfcbb0bc8b06617fb89963edbf7a2bab18e68878f197806252cb75b`，原生脚本`6a629bc9c39c06d2f996519a846fdefac754b2a7465daa3e1db7f3bccb2af224`。操作cf3484a2-cc09-4433-88c0-34322afe3fd4，launch9d538bcf-496a-4f4d-a113-03e4ab5f02f3，IDE66160创建身份639311888138995777，观察器5076。

入口、模块、initialization-entered均取得。首次错误明确为`TwoReadProbe.capture`第193行`ValueError: Owned MainForm identity or thread unavailable`，Python原始traceback及公开CLR链完整，未被OEM外层包装取代。**这是探测自身的复合守卫拒绝，不能解释为公开主线程入口不可调用。** 该版尚未记录比较两侧值，具体哪项不符仍缺证。

ready与两条请求均未发布，工程／保存／编译／FileExit=0。保留首错及15秒有界迟到观察。主协调随后正常维护已知空IDE，07:35:28 UTC取得exit/close0及只读句柄退出0；不改判本次失败。144项本轮保全材料无字节变化。

## 分项取证改动

将原复合检查拆为独立`validate_frame`。保持路径、MVID、类型的精确比较及IsDisposed、InvokeRequired、线程要求；仅在抛错前发布实际值、预期值与具体差异。记录失败仍抛错，不吞异常或继续接收。原始快照不改写，不直接放宽路径规则。

分项正反例新增后IronPython55/55、CPython52/52，分别归属`ironpython-manifest-03.json`／`ironpython-03.json`及`python-03.json`。新冻结原生脚本SHA-256 `5ba47f6d9cdb6a0d4b276c5da3b8664cb3a47378049c0849989610ba55e635e5`；run-02 intent `28805e5e4084176b7559b69c2ee3cd50f9e5f80c5727a6929f05fa4b4489fb6e`。运行结果另列，不能用离线通过代替实际连续请求。

## 生命周期目标

当前[设计](resident-project-lifecycle-plan.md)及README、agent规则已同步为：默认同句柄读取／编辑／读回，不保存、不关闭；编译按需，保存由用户明确决定。用户手动修改、保存或关闭后先重读状态，不覆盖或回滚。旧自动保存工具逐项适配前不得用于新模式，不假报未保存或reopened=true。该目标未实现，旧工程验收仍归原版本。

## run-02决定性证据与限定修复

实际IDE61644／创建身份639311891789730624，观察器52532。`run-02/native-0004-frame-identity-rejected.json`原始差异只有path：实际`d:\inproshop\codesys\plugins\55da38af-e78a-46ae-915b-7686657f6fac\3.5.11.10\frame.plugin.dll`，预期为同一路径的混合大小写。MVID均`907636ac-aa7c-498c-953a-7c3b30b2e75c`，原生类型一致，IsDisposed=false、InvokeRequired=false、两个线程号均1。

这证实本次初始化守卫把本机Windows路径大小写当成身份变化。不能反向补填第一轮未记录的字段或认定旧所有IDE异常均同根因。run-02仍为失败、请求0次，记录和已审字节保留。07:41:32 UTC主协调正常维护后取得IDE exit/close0、只读句柄退出0；144项本轮保全未变。

修正只限完整程序集路径：通过公开`Path.GetFullPath`与`StringComparer.OrdinalIgnoreCase`比较，同时实际读取两条路径的SHA-256，均须等于已冻结安装件`2378cfee54890563bb494d5427ae99950ab3ea3064c8280e73c35966eabe67fe`。原始路径、规范化路径及哈希均返回；不同目录／文件／哈希／MVID／类型／线程仍拒绝，文件读取失败也停止。没有修改OEM安装件或产品桥接。

修正后IronPython62/62、CPython59/59，正例直接使用归档中的两个路径并读取安装件真实字节；反例及主体采集路径替身分别保留，Node24/24归属未变观察器。run-03冻结脚本`86bd80b7cf92eb4fd721fc4f90e40cd19cf66b8f7c4cc120979674197154a9eb`，intent`458197365096d0b34866fdf08ad5154c970407c3dc42ebeb5cc2c0c8eb3ad910`。各组不相加，不作为工程验收。

## run-03：第一条原生读取完成，外部同类比较遗漏

IDE52996、观察器65152。取得initialization、receiver-started、ready及request-1/result-1，回调在启动栈退栈后通过公开主线程完成；返回无工程、mainEnabled=true、线程1、中文结果和完整程序集文件证据。此时外部`accept`仍逐字比较path，于07:45:22 UTC记录`Installed frame identity differs`。观察器停止后原生接收器记录停止，第二条未发送；不能把这一轮算作完整两次成功。

这是同一大小写规则在外部校验端的漏修，独立于原生入口生命周期。修复前生产语句及完整实际ready/request/result已保留为脱敏[离线输入](../scripts/diagnostics/resident_frame_case_fixture.json)。主协调随后正常维护已知空IDE，07:48:55 UTC取得exit0/signalnull及相应close、句柄回执；不改判原失败。

外部新增`verifyInstalledFrame`，在ready与每次结果接收时均按Windows完整路径、固定SHA-256、MVID与类型验证；读取实际路径及预期路径文件字节，不能仅信任原生报告的哈希。原`sameNativeContext`仍严格比较同实例的实际主线程、窗口句柄和程序集身份。`verifyAcceptedResponse`把原响应、安装件及上下文比较连在实际生产接收路径，完整归档正例贯穿验证；负例经过串行收发入口，断言首个拒绝后不发送第二条。

最终Node50/50（`node-05.tap`）对应冻结观察器`16ad3d01a74bd58d21d6b733f6b97b64568fc1a510a0a41011138b9f9cd1608c`；原生脚本未变，沿用IronPython62/62与CPython59/59，不叠加。run-04 intent `17c1b4160348d372abb2af3c1a7ef2dc11b75410258f722c29857cee11cac05d`，53项固定文件含完整脱敏输入，144项保全。

此处测试名称中的production/accept均指**实际执行的独立诊断实现路径**，不指产品MCP已迁移。最终两个校验端均以真实归档作输入，不再只测试原生局部比较器。

## run-04：两次独立请求通过，IDE保持打开

该版经过单独技术复核、即时53项固定文件和144项保全核对、无占用检查后启动一次。操作`93b950f5-326c-4fb6-8550-755c1c52636f`，launch`435ee8cb-2294-4278-9df1-6f6876d677d1`。下列为实际证据：

| 证据 | 实际结果 |
|---|---|
| 原生进程 | PID64176，创建身份639311898512120181；两次结果及外部存活核对一致 |
| 主线程与窗口 | 两次thread=1、mainHandle=54464642；同一实际程序集身份 |
| ready | `ready.json`与`parent-0006-ready-observed.json`；启动栈已退栈，无工程、主窗启用、无可见模态窗口 |
| 请求1 | 31453484-f7ea-468c-9bf3-7f2a74aa00e1；`result-1.json`与`parent-0008-result-accepted.json` |
| 请求2 | 1e756aa0-c5d3-4092-80ac-01d3d13fccde；第一条验证成功后发送；`result-2.json`与`parent-0010-result-accepted.json` |
| 先后绑定 | 第二条previousResultSha256为092a85b853ad292351c9f58222561bfbb8180d32b422dce80db9d5aa92ac7877，等于第一条原始结果文件哈希 |
| 接收循环结束 | `native-0011-receiver-stopped.json`：completed=2、firstError=null、ideExitRequested=false |
| 最终外部判定 | `two-read-result.json`：two-read-observed、results=2、ideRetained=true |
| 写入／退出范围 | 工程、保存、编译和FileExit均0；没有DSH任务或产品MCP工程请求 |

本轮四次启动按不同诊断版本分别保存；前3次失败经主协调正常维护后才继续，未覆盖首败。只在run-04取得完整两请求正例，不把run-03的单条返回补判为两条成功。

归档时空IDE64176、父观察器38664及只读句柄辅助进程27252保持；接收线程已经结束，没有后台业务处理循环继续派发。未为取得退出码而关闭成功实例，不能宣称本次已有正常退出回执；不得先停父观察器导致其Job子进程结束。已有144项历史保全材料与本轮新基线一致；新诊断输出另存，未修改锁、租约、账本、隔离、私人配置或原工程。

**结论：已修复独立探测两端的Windows程序集路径大小写误判，并取得同一自有IDE连续两次无工程读取正例。** 尚未验证同一工程句柄的未保存编辑、编译、显式保存、用户手动动作后的版本重读、产品38项工具迁移、客户端EOF重接或DSH多轮。无工程正例不解决原退出根因，不改判任何旧unknown，也不推进占位符清除或S4b工程验收。

原始目录：`D:\InoPro-ResidentTwoRead-Recheck-20261125`，各run与各固定脚本目录独立；入口、失败、离线记录和最终保全索引均随本轮复核ZIP保存。默认性能、CmpLog、脚本信任、Desktop及PLC运行边界继续保留。
