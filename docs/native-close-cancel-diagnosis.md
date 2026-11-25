# 新建工程退出超时：关闭被取消的只读诊断

本轮基于 `codex/struct-field-add` 的 `91318737e2b774dda16ef66400f62554fbaa2fe0`，承接[独立复验](struct-field-recheck-20261125.md)。只分析现有 IPC、OEM 日志及安装件，运行离线替身；没有启动 IDE、工程服务、Desktop 或模型，没有打开、创建、修改、保存、编译工程，也没有执行历史 reconcile、提交隔离或修改租约。产品仍为 0.39.0 候选版／38 项工具；main、固定入口和私人配置不变。

## 结论到哪一层

新建操作 `b80105f3-55b9-4570-b450-f62e5028b707` 的业务结果已发布，指定文件确已创建并保存；整体仍是 `unknown / IDE_TIMEOUT`，缺少可信进程退出回执。**本次找到的直接取消证据是 OEM Frame 在退出命令期间记录 `_bCanClose=False`，对应安装件分支设置 `Cancel=true` 后返回。** 不能再把这次超时笼统描述为完全没有定位，但也不能据此认定后来进程消失的原因、原字体异常或所有历史超时都已解决。

当前桥接只确认无打开工程、UI 存在及 FileExit 身份，随后一次异步排队。它没有确认原生进度处理已恢复关闭许可。生产帮助函数的离线替身可确定性复现“收到 returned、未退出”；外部退出证据保护仍正确拒绝整体成功。本轮没有把固定延时、重复 FileExit 或内部状态修改加入产品。

## 同一候选上的真实证据对照

固定构建为 `D:\InoPro-StructFieldRecheck-20261125\fixed-c075520698b7`。以下均为已有真实记录，不是本轮重跑。时间为 UTC；OEM 本机时间为 UTC+8。

| 项目 | `project_open` | `task_inspect` | `project_create` |
| --- | --- | --- | --- |
| operationId | `9e49b44d-7973-4b22-aed7-279ab0f81c62` | `b406ce92-9b45-4ec4-a33d-fa316dba1bce` | `b80105f3-55b9-4570-b450-f62e5028b707` |
| FileExit dispatch | 04:02:50.807 | 04:03:27.693 | 04:05:25.141 |
| FileExit returned | 04:02:50.908 | 04:03:27.783 | 04:05:25.152 |
| 差值 | 约 101 ms | 约 90 ms | 约 11 ms |
| 原生工程清理 | 无打开工程 | 无打开工程 | 无打开工程 |
| 可信退出 | code 0，无信号 | code 0，无信号 | 缺失，不能补造 |
| 整体结果 | succeeded | succeeded | unknown / IDE_TIMEOUT |

11 ms 本身只是一条线索，取消判断来自下面的原始日志与控制流。新建请求为 `db02cc88-c5fa-468d-8a69-a59202bb955e`，launch 为 `0ed25150-fd3c-4595-92db-6c8ce7dd0136`；IDE PID 56568、创建身份 `639311763077344241`。服务 PID 61560、创建身份 `639311762877967591`。这些身份由原 IPC / 观察器绑定，不从 OEM 日志的线程编号推断。

OEM 原始位置：

- `D:\InProShop\CODESYS\Log\Info\2026-11-25_010.log:1761–1762`：12:05:25.148 进入退出命令，12:05:25.151 返回。
- `D:\InProShop\CODESYS\Log\Info\2026-11-25_011.log:799`：12:05:25.150，`Frame OnClosing _bCanClose=[False]`。
- 同文件 800–806 行：12:05:25.182，进度 `Finish` 的栈包含 `Execute → Execute → OnApplicationReady`。取消发生在这条结束记录之前。

两份 OEM 文件不含 PID；关联依据是原排他记录、启动序列和与请求回执吻合的毫秒时间窗。完整选中日志块、原行号和源文件 SHA-256 在 `oem-blocks.json`；不把时间关联升级为不存在的进程字段。

## 安装件解释及公开接口边界

只读解析本机安装件，没有加载执行目标 DLL、修改 OEM、安装工具或产生新转储。复用 2026-11-24 的原静态包并重新核对当前 SHA-256；新增 IL 使用同一只读 `PEReader` 提取器。

`Frame.plugin.dll` 为 3.5.11.10，SHA-256 `2378cfee54890563bb494d5427ae99950ab3ea3064c8280e73c35966eabe67fe`，MVID `907636ac-aa7c-498c-953a-7c3b30b2e75c`。下列 token 仅在该指纹下有效：

| 位置 | 已证实行为 |
| --- | --- |
| `MainForm.OnClosing` `0x0600068f`，IL_0008–0030 | `_bCanClose=false` 时记录原日志，设置 Cancel=true 并返回；无需工程仍打开才能取消。 |
| `StatusFieldManager.EnterProgressIndication` `0x060009ad` | 增加进度深度，调用 `EnableForm(false)`。 |
| `EnableForm` `0x060009bd`，IL_0096–009d | 将传入值设置到 `MainForm.CanClose`。这只是解释，未调用它。 |
| `FinishProgressIndication` `0x060009ae` | 减少深度并记恢复时间，没有立即恢复 CanClose。 |
| `MainForm.OnApplicationIdle` `0x060006b0` | 调用 `UpdatePanels`。构造函数 `0x06000650` 已向公开 .NET `Application.Idle` 注册此处理器。 |
| `UpdatePanels` `0x060009a4`，IL_0000–0052 | 有 250 ms 更新节流；深度为零且存在待恢复时间时才调用 `DoFinishProgressIndication`。 |
| `DoFinishProgressIndication` `0x060009af` | 经 `EnableForm(true)` 恢复关闭许可。 |
| `StatusBarProgressCallback.Finish/PumpMessages` `0x06000722/724` | 存在嵌套消息处理，异步排队不证明外层脚本或 OnLoad 已返回。 |

`ScriptCommand.execute` 与 OEM `FileExitCommand.ExecuteBatch` 的签名均为 `void(string[])`（元数据 `2001011D0E`）。成功返回没有“关闭成功”的布尔值；补采一个 Python `None` 也不能解决取消判断。OEM FileExit 的 UI 分支调用正常 `Close`，没有绕过取消。

**可见性勘误：** `MainForm` 类是 public，但 `get_CanClose` `0x0600068d` 和 `set_CanClose` `0x0600068e` 均是 `Assembly` 成员。不能把“public 类／可通过反射查看元数据”描述为公开 getter；早期讨论中该说法撤回。没有使用非公开反射读取或写入。

已核查 `ISystem` 至 `ISystem4`、`IScriptCommand` 和 `IScriptUI`，未取得脚本层 CanClose／命令 enabled 读取入口。Core 的 `IEngine10`／`IFrame12.LengthyOperationIsActive` 是公开原生接口；`MainForm` 也有公开实现。但该值只描述进度活动，**可以已经为 false，而 CanClose 仍在等待空闲恢复**。尚未验证从当前脚本取得当前 Frame 的受支持路径；即使取得该值，也不能单独充当关闭就绪证明。此结论只限本机和已查入口。

## 外层观察中断是另一件事

- 04:07:13.283：原业务超时，IDE 仍运行；首次原因不是后来发送 EOF。
- 04:07:13.618：服务记录 `shutdown-requested(stdin-end)`。没有 `observations-settled` 或 `shutdown-completed`；现有日志也没有阶段开始标记，不能仅凭这一行区分等待 drain 还是等待退出观察。
- 04:07:43 附近：外层 EOF 观察期限到达，随后再观察 15 秒。
- 04:07:58.653：外层记录 `exit=null / close=null`。之后 `preservePrimary` 重新抛出原业务断言，验证进程结束；其后的连续观察不再完整。
- 后续系统查询发现服务与 IDE 均消失，没有留下退出码或正常释放回执。外层宿主是否结束了其进程树缺证；不能归因为自然退出，也不能归为最初 IDE 超时原因。

现有服务实现会在 EOF 后停止新受理，等待队列及迟到退出，并以活动定时器保持观察进程。本轮未从现有材料发现一个可确定归因的父服务提前主动退出调用；不为猜测修改这条保护链。

12:02–12:11 的 Windows Application 日志只有四条 Security-SPP 事件，未取得相关崩溃／退出事件；Security 4688/4689 无匹配事件。此处“没找到”不证明正常退出。`IsDriveInstalled` 临时文件删除错误仍只作关联记录，不能据此修改驱动、权限或执行策略。

## 离线复现及保全

独立脚本：[native-close-cancellation.py](../scripts/diagnostics/native-close-cancellation.py)。它加载生产 `bridge/native_exit.py`，使用替身模拟已有安装件的进度／空闲次序，不启动 IDE，不进入产品构建或 MCP 注册。

- 5 项离线断言通过：进度未结束时取消；进度值已 false 但空闲恢复未执行时仍取消；已恢复时正常控制；嵌套回调仍可能过早；returned 回执不能区分这三种状态。**通过表示复现已证实，不表示修复完成。**
- 既有生产关闭保护定向 Python 28/28 通过，单独记录，不与上项累加；未跑完整回归。
- REA 对 Frame 全成员分析因表示大小上限未返回成员，保留这一工具限制；没有把空结果当成无接口。后续使用本机已有的按 token 提取器取得实际 IL。
- Windows 日志查询首轮因无名称 EventData 处理错误停止；只修查询器后再读取，首次错误保留。这不是 IDE 执行失败。

新建文件 `D:\InoPro-StructFieldRecheck-20261125\mcp-project\AM610_StructField.project` 保持 SHA-256 `629e435f2706ef1d3c012d42dbda9a6d287b69cdf6b0c5f8b0847b4914c0c51a`。原保存 unknown `1a422703-1f36-492a-9789-c6bb649c7d64` 和本次新建 unknown、原工程、账本、IPC、检查点及锁不改判、不恢复、不重开。租约 stale 仍不是释放回执。待确认计划 `123f81a5-e028-442f-9bc4-0a695c57ba15` 没有提交。

## 下一步：先补公开就绪依据，不再试建工程

最先缺少的证据已从“退出为何不发生”收窄为：**从本机受支持接口取得关闭许可已恢复的可靠条件，或取得保证脚本进度恢复后才派发 FileExit 的公开生命周期约定。** 单次 BeginInvoke、耗时标志为 false、空工程、一次 Idle 通知或固定等待时间均不能独立保证这一点；尤其一次 Idle 可能受到 UpdatePanels 节流。

最小调度方向是让原脚本自然返回，由公开生命周期通知继续一次正常 FileExit。候选包括 .NET `Application.Idle` 及公开 Frame 接口，但当前只有接口／订阅控制流依据，没有“已经完成恢复”的充分门槛；不得把候选直接接入产品。内部 CanClose、内部 EnableForm／DoFinishProgressIndication、强制退出与重复 FileExit 全部排除。

### 待复核的一次无工程观察方案

目的只回答“公开生命周期通知能否避开本次过早关闭，以及能否实际观察取消”，不预先宣称候选条件足以产品化。以下是具体方案，**没有实现或执行**；当前不再新建工程。

1. **派发前条件。** 使用同一安装件和原登记目录，只启动一次无工程脚本。先核对排他、绑定 PID／创建身份／固定脚本指纹，并确认没有业务请求、无打开工程。父观察器须能保留子进程，不能把退出外层执行宿主当清理。若无法确认这一点，不启动。
2. **公开读取。** 在主线程只读 `System.Windows.Forms.Application.OpenForms`，要求恰好一个实际类型及程序集指纹匹配的 `MainForm`；从其公开 `LengthyOperationIsActive` getter 读取原值（只准 `BindingFlags.Public | Instance`，不回退非公开反射）。记录实际对象类型、程序集 SHA/MVID、返回类型和值。没有匹配对象、多个对象、读取失败即缺证停止；接口可见不等于实际脚本访问已通过。
3. **公开事件与采样。** 订阅 .NET `Application.Idle`、该 Form 的公开 `FormClosing`／`FormClosed`，记录当前主线程及 `System.Diagnostics.StackTrace`。用 .NET `Windows.Forms.Timer` 每 100 ms 只读采样，最多 10 秒；Timer 只驱动采样与期限，不把等待 100 ms 或等待若干次当作就绪。回调立即返回，不 Sleep、不同步等待、不调用 DoEvents，也不调用 OEM 内部恢复方法。
4. **唯一关闭尝试。** 可评审的实验触发点是：脚本尾部标记已发布，某次原生 Idle 回调中公开耗时标志为 false，当前栈不含固定安装件的 `ScriptExecutor.Execute`／`OnApplicationReady`／`MainForm.OnLoad`。这仍是**待证候选**，因为 UpdatePanels 节流可能尚未解除 CanClose。满足后注销触发订阅、先记派发，再调用一次既有公开 FileExit GUID；记录 `void` 返回和公开关闭事件。无条件则 10 秒内停止，FileExit=0。取消、异常或返回不退出均不再派发第二次，不改变原生状态。不以该条件作为产品成功或安全关闭保证。
5. **独立退出取证。** 若使用 Node ChildProcess 父观察器，在 `spawn` 返回后同步安装事件处理，任何 `await` 前完成；记录 process-start、exit、close、命令与事件时间线。业务观察上限 30 秒，再保留 15 秒迟到观察；正常退出只认同实例 code 0／无信号及完整回执。缺证时写 unknown 和首错，不抛未捕获异常结束外层宿主，不强杀或发第二次关闭命令；停止采样和一切新派发，保留 IDE 与观察宿主现场待处理。无法保证这种到期保全方式时，方案不能进入实际执行。
6. **判定限制。** 若公开耗时值=false、栈已退出但 FormClosing 仍取消，便直接否定该候选条件，停在接口缺口；不能逐步增加等待时间或新工程。若一次正常退出，仅证明这一无工程观察成功，仍需解释为什么足以覆盖进度恢复后才允许关闭，不能据单次正例直接改产品，更不能补判封存工程。

`FormClosing` 事件能否看到 legacy `OnClosing` 最终取消值、当前 Frame 的公开读取是否可达，均是本方案必须实测的事项；本轮没有伪造结果。本方案须先复核授权，当前实际启动次数为零。在仍无充分就绪条件时，它仅属于一次接口可达性／生命周期观察，不自动延伸为产品修复或业务复验。若没有可靠条件，保留已确认取消链和这些具体接口问题，不继续业务写入试验。

复核材料根目录：`D:\InoPro-CreateExit-Diagnosis-20261125`。原真实包仍为 `D:\InoPro\deliveries\InoPro-review-20261125-121612.zip`（SHA-256 `0a0df5fcd6eb54d0b5f10e857c915842bb48986f9d7ff4f18aa1a980e2f4888a`）。本轮打包只包含诊断、有限原记录副本、原始 IL 与校验结果，不复制工程二进制或私人配置。历史 unknown、隔离、默认环境性能、崩溃根因、CmpLog、脚本信任、Desktop 和 PLC 运行限制继续保留。
