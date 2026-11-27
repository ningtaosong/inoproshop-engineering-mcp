# 用户保存后继续同一 resident 会话：阻断定位与观察准备

本轮对应 `agent.md` 当前路线第 6 项。基线为 main `a536de33457ccec662bce7ab53e78d281f51ea80`，分支 `codex/resident-user-save-continuation`。目标是用户在两次已完成请求之间正常保存到原路径后，下一次新请求重新读取并继续修改或明确请求的内存编译。

**本轮尚未交付保存后续改能力。** 产品保持 0.41.0 候选版、38 工具；产品、桥接、Schema、初始化正文及版本不变。已定位拒绝路径、核查本机公开接口及保存时序，准备独立只读观察入口并离线验证。当前真实实例仍有未保存内容，未获保存、关闭或移交授权，因此未启动新 IDE，也未向当前实例派发请求。

## 已确认的阻断和保存时序

| 证据 | 本机实际含义 | 不能据此推断 |
| --- | --- | --- |
| `src/resident.ts` 的 `originalFileId` 检查 | 与启动时文件身份不同即拒绝 | 不能单纯刷新身份来接受用户保存，也不能放行外部替换 |
| `bridge/resident_core.py` 的 `previous_disk` 检查 | 跨请求磁盘哈希变化即冲突 | 不能只将新哈希写回会话来绕过冲突 |
| 公开 `IScriptProject.dirty` | 自上次保存后的修改状态 | `false` 不是持久化完成回执；底层 `SetDirty(false)` 也可改变它 |
| `IObjectManager.ProjectSaving/ProjectSaved` | 包含工程句柄、流、流名及工作目录 | 不直接提供最终文件哈希或文件提交成功状态 |
| 本机 `ObjectManager.SaveProject` | 先序列化到传入流，再触发 `ProjectSaved` | 事件名不等于原路径已完成文件提交 |
| OEM `ProjectEx.OnPrjSaved` | 对匹配句柄调用 `SetDirty(false)` | 此时物理文件复制可能尚未进行 |
| OEM `ProjectEx.method_2` | 委托写临时流之后才关闭流、检查文件并复制到目标路径；后续仍有异常分支 | 不能以较早的 `ProjectSaved` 或 dirty=false 认定最终成功 |
| 公开 `ICommandManager3.CommandExecuted` | 有 `Exception` 和原生拼写 `ExcecutionCancelled` 字段 | 尚未证明桌面原路径保存必经这条事件链，或事件与目标文件最终提交的对应 |

独立公开访问候选为 `SystemInstances.Engine.Projects.GetProjectByHandle(handle)`、`SystemInstances.ObjectMgr`、`SystemInstances.Engine.CommandManager`。Core 元数据确认这些接口和方法为 public；没有访问 ScriptProject 私有 CoreProject、内部 APEnvironment 或私有写接口。**尚未在真实脚本上下文订阅或调用这一候选链，不能将 CLR 元数据存在写成脚本接入通过。**

安装件依据（完整哈希和方法切片见复核包）：

- `Core.dll` SHA-256 `b9169084ad15230ea9be121d026d80a2a4f71e020c424959dd2090385e8430ca`；公开接口元数据。
- `ScriptDriverProjects.plugin.dll` SHA-256 `3f2472c176f082477ecd8c940d0daffe2436a62ebfafc84d8812661ef605a143`；dirty 转发和 Save 返回值处理。
- `ObjectManager.plugin.dll` SHA-256 `066dda02a8c59b646d90ed748b170bf80581d4874b6a5c979f4658ee4fa67f56`；`SaveProject` 方法 `0x060000df/e0`，`OnProjectSaved` `0x060000f0`。
- `InoEngine.plugin.dll` SHA-256 `98db00c656cbb5c00d534c80cf3e70f832bca763d9270999a1659214b52560a2`；`ProjectEx.method_2` `0x0600027d`、`OnPrjSaved` `0x0600027c`、`method_29` `0x06000287`；命令派发 `0x0600004a` 在 ExecuteBatch 返回后通知 CommandExecuted，并有取消/异常分支。
- `InoProjectCommands.plugin.dll` SHA-256 `424aa9aa9a07d5e12e156f01f6d3a97eb5b0f44cb287058f449033ab0abcddfa`；FileSaveCommand 的静态读取遇到混淆及无效 token。该部分仅支持定位候选类，**不作为完整桌面调用链证明**。

REA 的 Core/Engine/ProjectCommands 元数据表示上限、传输上限，以及只读反射的类型加载缺口均保留。随后仅对相关方法读取静态 CIL，不执行 OEM 程序集正文。分析工具的警告和诊断脚本首败与 IDE 失败分开记录。

## 准备好的最小观察

- [只读观察器](../scripts/diagnostics/resident_save_observer.py)：保留 CommandExecuting、ProjectSaving、ProjectSaved、CommandExecuted 的原始顺序、句柄、原路径、线程、流元数据、当时磁盘哈希、取消及异常状态。保留 null、空串、缺字段和异常的区别。不读取命令参数，不消费/移动流，不刷新或释放 OEM 流。
- [独立诊断入口](../scripts/diagnostics/resident_save_probe_entry.py)：固定原接收器、核心及观察器指纹；仅允许 inspect/list/read，拒绝修改和编译。新计划默认未获启动授权。它不注册 MCP 工具、不进入产品构建、不在日常启动路径中。
- [离线用例](../tests/test_resident_save_observer.py)：观察及加载规则替身，并调用生产 ResidentSession 复现保存后磁盘变化仍冲突、旧版本请求零修改零保存。不是原生保存成功证据。

观察器每条记录均为 `writeAuthorized=false`。记录失败保留首次异常及次级错误，不抛入 OEM 保存事件以干扰用户保存；下一诊断请求拒绝继续。即使观察顺序看似完整，也不能由这个脚本自行解除产品保护。

未来一次限定实测应先确认当前未保存内容的处置及正常移交，然后在新的自有诊断接收器中：

1. 固定本机安装件、脚本及进程创建身份，确认公开订阅成功、原路径与当前句柄对应；不接管旧运行实例。
2. 使用另获授权的唯一独立正常夹具，不复制当前未保存现场继续试验。先读回唯一根级ST PROGRAM及全文，确认不存在标记 `// INOPRO_SAVE_OBSERVER_20261127`。由用户在该夹具实现区末尾单独增加这条无运行作用的注释，暂不保存；助手再只读核对新增注释、其余全文不变、dirty=true、磁盘哈希仍等于打开前版本。若没有确切的未保存改动，停止；不依赖“打开自然变dirty”，也不以干净工程的空操作保存作为正例。
3. 用户正常保存原路径一次。助手不调用 ScriptProject.save、不执行 FileSave 命令、不关闭、不模拟键鼠。两者虽可能共享底层方法，脚本保存不能代替真实桌面保存的入口证据。观察器在命令完成事件中仅进行原生只读快照，记录标记仍在、其余源码保持、dirty=false和实际磁盘哈希。应观察到新磁盘版本；若原文件哈希未变、事件未覆盖桌面入口、内存读回不完整或回调缺失，均不判通过。各事件的错误/取消字段、流状态和文件时间线必须能对应本句柄，不能只看最终一个哈希。
4. 仅在来源链确实足够后实施最小产品接入：保存回执绑定 launchId、PID/创建身份、工程句柄、原路径、保存序列及磁盘版本；新请求重新读取内存，旧请求版本仍拒绝；保存中、另存为、外部替换及缺证继续停止。
5. 产品接入后再独立验证“新读→改→用户保存→新读→下一次明确修改”，与来源探测分开。此时才可报告同一会话续改通过。

离线固定观察构建已准备在 `D:\InoPro-Resident-UserSave-20261127\diagnostic-fixed`，`prepared-plan.json` 记录宿主/核心/观察器/入口指纹，`approvedForLaunch=false`、目标工程尚未指定。不是产品固定入口，不覆盖当前运行构建；未启动、未初始化。未来完成明确移交后，创建新的独立夹具及全新 resident intent，临时服务环境设置 `INOPRO_SAVE_OBSERVER_PLAN` 指向经复核的计划，并沿用原登记目录；现有原生启动器仍执行 profile/runscript 及租约/排他校验。不得将旧 intent 指向新入口，不用原工程验证。

正常收尾也须另有明确关闭决定：确认测试注释已经用户保存且无在办请求后，由用户正常关闭该测试 IDE；记录真实退出码和创建身份，再使用现有 `finish`/EOF 有界观察结束 SDK/服务，租约只能由现有正常释放机制处理。该诊断入口没有自动保存/关闭/退出。若关闭取消、还有未保存内容、退出缺证或释放门不满足，则保留实例/租约及日志，不补造回执、不强制关闭；需要再次读取时也不能绕开原产品的磁盘版本保护。

这不是要求厂商补充整个接口，也不涉及跨客户端恢复、任意 IDE 接管、自动保存关闭或新 GUI。当前决定性缺口是**一次真实桌面原路径保存中，公开命令完成事件与对象保存事件及最终文件版本的可核对关联**。如果该链确实不覆盖桌面入口，则需厂商支持的最终保存完成通知；不能以文件稳定等待或 dirty=false 替代。

## 验证归属与保全

本轮新增观察/生产拒绝回归 15/15，原 resident Python 回归 37/37，独立临时目录中的相关 Node 替身回归 11/11，分别记录，不相加。Node 默认环境回归在首个服务用例长时间未完成后正常中断，保留日志及测试进程退出；没有认定其根因，也没有修改超时或性能阈值。独立目录仅用于离线替身，不用于真实工程派发。

本机 IronPython 2.7.7.0 仅对两份新诊断脚本做解析编译，未执行入口正文。构建、类型检查通过。初始化正文没有修改；工作区 CRLF 含标题口径为65,234字节，固定LF口径为64,921字节，均低于65,536；不混用换行计数，也不提高上限。产品未改，未重跑无关全量回归。

当前 IDE24836、MCP72960、SDK61000及驱动22724保持，7秒/FALSE 为此前已验未保存内存状态，本轮不再次读取它。原路径磁盘为5秒/FALSE，原主文件哈希 `ecc5978e7c5dd252e7531c570ca92e886b3b5a093ccde4db5392a97aea4742f6`；每个进程的创建身份及前后文件保全另记。日常 DSH 0.38.0、Codex、原登记目录、历史 unknown、隔离和锁不改动。真实工程保存、修改、编译、关闭及模型任务均为0。

前后22,577项原登记材料和13,484项已有全局保护材料字节保持；默认环境的离线替身另产生1份新测试锁，原样保留，不将它混称为历史记录改写。日常配置/Codex及固定构建共10,646项与前次保全记录一致。仍在运行的原IDE使 `.autosave`、`.~u` 字节改变，两个 `.opt` 仅时间变化，主文件未变；不声称整个工程目录未变。

本轮未修复原 IDE 崩溃、默认环境性能、CmpLog、脚本信任、Desktop 欢迎页或实际 PLC 运行问题。旧失败和旧成功均保留原归属。
