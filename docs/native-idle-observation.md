# 无工程公开生命周期观察：唯一启动在窗口列表检查停止

2026-11-25，本轮接续[FileExit取消链诊断](native-close-cancel-diagnosis.md)，只准备并尝试一次独立无工程观察。没有修改产品退出路径，没有工程、库或 PLC 操作。当前功能分支仍为 0.39.0／38 项工具；main、日常入口及 Codex 配置不变。

最终实际范围：IDE启动一次，FileExit为0；工程打开、创建、保存及编译均0。入口、辅助模块、主线程空工程检查和OpenForms类型列表已取证；没有到达公开忙碌getter、Idle、FormClosing／FormClosed或正常退出。原生首错与父退出观察超时分别保留。本轮只改诊断设施，未修产品退出路径。

## 第一次父观察器预检（IDE为0）

启动诊断父观察器一次，**IDE启动0、FileExit0，工程打开／创建／保存／编译均0**。尚未进入原生脚本，没有取得公开 Frame、Idle、FormClosing／FormClosed 或 IDE 退出证据。

|UTC，2026-11-25|记录|结果|
|---|---|---|
|05:35:10.0065924|启动器回执|Node观察器PID20808，创建身份639311817100196880；即时IsProcessInJob=false。|
|05:35:10.514|观察器自身检查|同PID、同创建身份，IsProcessInJob=true。|
|05:35:10.518|首错|PREFLIGHT_STOP，Job归属及退出生存条件尚未确认。|
|05:35:10.521|未启动记录|launches=0，未保留IDE派发名额、未取得本轮只读排他句柄。|
|05:36:43.1335431|系统只读观察|父观察器、IDE、工程服务和Desktop均未运行；这不是父进程退出码回执。|

原首错文字使用 `outer job`，保留原文件。准确含义仅是 **`IsProcessInJob(handle,NULL)` 返回属于某个Job**；它不标识Job来源，也不能独立说明kill-on-close行为。两次读数差异的原因还需按实际Node版本及生命周期核查，不能直接归因外层宿主或将进程消失当正常退出。

该次没有新增MCP业务unknown；独立诊断ID只写入新输出目录。原保存unknown `1a422703-1f36-492a-9789-c6bb649c7d64`、新建unknown `b80105f3-55b9-4570-b450-f62e5028b707` 和待确认隔离计划均保持原状。该次先停止并封存run-01；随后仅按明确授权修正诊断器错误假设，完成纯Node验证、再经技术复核进入唯一一次实际IDE启动。

## 诊断器Job假设的限定更正

本机Node24.15.0／libuv1.51.0对应的[官方process.c](https://raw.githubusercontent.com/nodejs/node/v24.15.0/deps/uv/src/win/process.c)会在非detached派生时初始化自己的Job并加入Node自身；[spawn_sync.cc](https://raw.githubusercontent.com/nodejs/node/v24.15.0/src/spawn_sync.cc)调用同一uv_spawn路径。原观察器用execFileSync派生PowerShell查询，查询本身可以改变状态。[微软接口说明](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob)明确NULL只问“任何Job”。这是对应版本的源码解释，未取得本次Job句柄归属实测，也不是IDE退出故障。

更正后，外部不可覆盖回执在Node派生任何帮助进程前绑定intent／脚本／Node／启动器指纹、PID、创建身份及启动时Job=false。缺失、错误或启动时在Job均拒绝；后续inAnyJob仅记录并核对同一进程，不再误称为外层Job。纯Node替身独立确认启动命令结束后父子仍在、期限后迟到退出仍被记录，原超时不升级。原run-01、旧固定字节和失败文件不修改。

## 唯一实际IDE启动（run-02）

|UTC，2026-11-25|阶段|证据|
|---|---|---|
|05:48:33.141|IDE派发|PID62052；创建身份639311825131405750；与独立process-start及原生绑定一致。|
|05:48:39.229／.417|入口／加载|固定Python脚本与策略指纹匹配，实际加载完成。|
|05:48:39.480|主线程入口|线程1；projects.primary为None、all数量0；当前栈仍包含Execute／OnApplicationReady／OnLoad。|
|05:48:39.537|窗口列表|唯一MainForm，以及Inovance.InoPro.DeviceConfigurationEditor.HardwareConfigOutputInfoWnd。|
|05:48:39.713|原生首错|脚本额外要求整个OpenForms只有一项，因此setup停止，FileExit0。|
|05:49:03.156|父观察期限|30秒到期，退出证据缺失；发布停止标记，记录EXIT_DEADLINE。|
|05:49:18.159|迟到观察到期|再过15秒仍无exit／close；停止文件观察，仅保留OS退出监听。|

`HardwareConfigOutputInfoWnd`只取得类型和程序集名，没有读取Visible／Modal／Owner，**尚未证明它是阻塞弹窗**。这是诊断脚本“OpenForms总数必须为1”的假设触发停止，既不是MainForm不唯一，也不是原IDE关闭故障根因。实际启动后没有改条件、重新启动或补发关闭命令。

保全时IDE62052、父观察器33384（创建身份639311825053973444）、只读句柄帮助进程17060仍存活。原生Timer／Idle订阅尚未建立；父进程仅空回调保活和退出监听，持有本次service.lock／registry／isolation-ledger的只读句柄，未改写租约。**仍需另行安排可信正常收尾**，不能先结束父观察器：它管理的子进程Job可能随之被终止。本轮不强杀、不代点、不自动清理；若之后自行退出，只追加迟到证据、不升级本次失败。

## 工程冻结与无工程授权分开

生产 `assessPending` 的globalFrozen继续限制工程派发。`src/service.ts`的guardPending不因诊断被修改。既有独立无工程启动记录明确不取得服务／工程租约，工程仍冻结；当前用户授权同性质的一次观察。没有将工程派发冻结新解释为禁止所有无工程接口观察，也没有将无工程授权解释为允许业务操作。

准备的入口保持原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`，要求旧进程身份结束、无活动IDE／服务／Desktop及在办操作。run-01在这一步前停止；run-02取得既有机制的只读句柄防止竞争写入，不接管或改写旧锁。144项约定保全材料的字节均未改变。

## 独立脚本及已完成检查

- [原生观察脚本](../scripts/diagnostics/native_idle_probe.py)：只读唯一MainForm的公开Boolean getter及公开事件，入口和派发前均确认无工程。实验触发点要求脚本尾部标记、自然Idle、busy=false及原执行栈已退；不宣称这是充分产品就绪条件。
- [候选判定](../scripts/diagnostics/native_idle_policy.py)：Timer不派发；10秒内未满足则停；最多一次FileExit。三个阻止帧的程序集、完整类型及方法与已归档IL相符。
- [父观察器](../scripts/diagnostics/native_idle_observer.mjs)及[启动器](../scripts/diagnostics/start_native_idle_observer.ps1)：spawn后同步绑定事件。绝对UTC派发期限及同绑定停止标记防止迟到入口重置计时；业务30秒、迟到观察15秒，期限届满不强杀、不重试，保留空回调保活及OS退出监听。独立启动关系不明确即预检停止。
- [IronPython检查入口](../scripts/diagnostics/check_native_idle_ironpython.ps1)、[Python用例](../scripts/diagnostics/test_native_idle.py)、[Node用例](../scripts/diagnostics/test_native_idle_observer.mjs)均为独立诊断资产，不进入产品构建、MCP注册或日常入口。

|来源|结果和范围|
|---|---|
|安装版IronPython 2.7.7.0|三个完整脚本解析编译；28/28定义／替身检查。实际执行中文JSON发布、独占创建、重复拒绝及Windows句柄关闭；公共Boolean getter、WinForms事件委托和订阅解绑。未执行原生入口、未创建Form或启动IDE。|
|CPython|27/27，单列，不与IronPython相加。|
|Node初版|11/11，含首错、晚退出、非零／信号、缺回执、源码顺序检查及主发布／备用日志同时失败时不逃出记录器。保留原归属。|
|Node回执更正|30/30，另含外部启动回执的缺失／逐字段不符／启动Job状态拒绝。与初版计数不相加。|
|纯Node进程替身|100+50ms缩短期限后保留到3秒晚退出，取得code0／无信号，原超时保持。此替身没有执行本轮相同的后置Job自检，不能替代真实预检或覆盖本轮差异。|

测试首败保持：CPython测试默认GBK读回；IronPython测试读取句柄未显式关闭；Node静态断言误把注释当调用。只修测试设施后通过，不回填旧记录。公开事件的离线订阅可达不等于OEM实际MainForm绑定已通过。

## 证据入口与尚缺事项

完整材料根目录：`D:\InoPro-NativeIdle-Observation-20261125`。从 `REVIEW.md` 看固定意图、启动命令及版本指纹，从 `RESULT.md` 看本次原始停点；`launch-intent.json` SHA-256为`bb08ec51ac0ecce318c572d13eb3f37408bbb63dfc4b59f37a6f576829278d99`。执行版本保存在fixed-scripts，不改写已执行字节。原取消链复核包仍为 `D:\InoPro\deliveries\InoPro-review-20261125-124508.zip`，SHA-256 `8bcbd45710a3344a432840ed3f278a7922aab187323d1815aee4a9cddc105ea9`。

更正计划为`launch-intent-v2.json`，SHA-256 `403948f383efbdf7c0a0c6460615568c0d349a620d89ace0afd01b4942095bc3`；`native-timeline.json`及`preservation-after-native.json`保留实际阶段及144项保全结果。源码解释和纯Node生存试验已补齐诊断器Job假设；仍未取得OEM关闭充分就绪条件、额外Form性质、公开忙碌getter、空闲栈、关闭事件和可信IDE退出。

本次证据足以说明入口／加载和主线程无工程读取可用，并精确指出新的脚本停止点，**不足以支持把候选Idle条件接入产品，或开始工程复验**。先正常处理当前保留进程，再另行复核窗口判定方案；不在本轮继续实验。原工程仍封存，不补判unknown，不清锁，不提交隔离或恢复记录。历史性能、CmpLog、脚本信任、Desktop与PLC运行边界继续保留。
