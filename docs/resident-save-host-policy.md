# 真实脚本宿主拒绝 Core 访问：新观察停止与后续方案

2026-11-27，分支 `codex/resident-user-save-continuation`。本次实际受验产品为 `cee47d947814b04c766479a07c458925028f799e`，**0.41.1 候选版、38 项工具**。这是[旧首次读取限定兼容补修](resident-legacy-first-read-admission.md)之后另获授权的一次新观察。原离线记录的“未启动”只描述其当时阶段；未改写该记录、旧 unknown 或原归属数据。

本次已经通过旧现场准入并实际取得新工程归属原始读数，但在安装保存观察器时失败。**尚未实现或验证用户保存后继续同一会话修改。** 新旧两个 unknown 均保持；未改产品、Schema、初始化正文、main、日常 DSH 0.38.0 或 Codex 配置。

## 唯一新观察的实际停点

| 项目 | 本次证据 |
| --- | --- |
| 固定目录 | `D:\InoPro-Resident-UserSave-20261127\fresh-observation-cee47d947814\diagnostic-fixed` |
| 操作 / 请求 | `1fdf17a7-699b-4f08-a65e-854c18aa0505` / `09907b7a-83a6-4d28-8fd8-f408f3bb331d` |
| launch | `d6a0644b-b663-4bb1-ada6-899356e047de` |
| 实际原路径 | `D:\InoPro-Resident-UserSave-20261127\engineering\AM610_UserSave.project` |
| 主文件 SHA-256 | `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`，前后不变 |
| 同一新连接 | 实际返回 0.41.1、完整 38 项工具；固定 LF 初始化正文含客户端标题 64,921 / 65,536 字节 |
| 最后确认阶段 | 原生打开一次；returned、primary 与 all 中唯一目标的路径和 handle=0 一致，非库、primary=true；归属验证通过，all 共 56 项含后台库，读取错误为空 |
| 首个失败阶段 | 初次完整快照前的 `observer.install → load_public_system_instances → clr.AddReference(matches[0])` |
| 原始首错 | `ImportError: 不允许访问模块d:\inproshop\codesys\common\core.dll` |
| 正式结果 | `unknown / RESIDENT_PRECONDITION`，`phase=initial-snapshot`，`dispatched=false`；这里的 false 指尚未派发工程修改，不能解释为没有打开工程 |
| 后续派发 | `object_list=0`、`object_read=0`、修改=0、编译=0、保存=0、关闭=0、模型任务=0；仅查询本次原操作状态 15 次 |

新 `ownership-0001.json` 的原始返回已发布，不能回填到旧操作。没有 `before.json` 完整快照，也没有 observer installed 或保存事件。`service-verification.json` 通过只证明 unknown 结果的请求/进程绑定校验成立，不等于工程请求成功。

控制端 PID 55248（创建标识 `639313691379310348`）、服务 PID 43432（`639313691382100466`）、IDE PID 8128（`639313691809191972`）在失败后保留运行；接收器已停止继续接收。未请求关闭或退出，没有本次正常退出回执。后续状态以包内带时点的进程记录为准，不能据进程消失补判正常退出。

## 原因确认到哪一层

本机 `ScriptEngine.plugin.dll`，SHA-256 `c19f81d5f3bcf3c014dc2522fa471f59034dfa6a1a7dd0946c5b0e12aa67b431`，MVID `33c70038-62f1-4026-a4cc-635f31910407`；只读取安装文件的元数据和 CIL，没有在目标进程执行反射、修改导入策略或加载替代 DLL。

| 安装实现位置 | 已确认行为 |
| --- | --- |
| `ScriptExecutor::.ctor`，token `0x060000d8` | 调用 `PatchAddReferenceFunctions`，随后将 `ImportFilterActive` 设为 true |
| `PatchAddReferenceFunctions`，`0x060000f8` | 将 clr 的 AddReference / AddReferenceToFile / AddReferenceByName / AddReferenceByPartialName 接到宿主方法 |
| `AddReference`，`0x060000f4` | 接受 Assembly 或字符串，但在 DomainManager.LoadAssembly 前调用 `CheckAssemblyAccess`；传已加载 Assembly 不代表免查 |
| `CheckAssemblyAccess`，`0x060000fb` | 有 OEM customization 委托路径，也有默认检查路径 |
| `CheckAssemblyAccessDefault`，`0x060000fa` | 检查规范化后的 Assembly.Location 和 CodeBase.LocalPath；位于 Common 或 PlugIns 目录时以 `AccessToModuleX0NotPermitted` 构造 ImportError |

实际错误类别、Core 路径和访问点与宿主导入检查吻合，因而该次失败已定位到**宿主程序集访问限制**，不是继续猜找 Core 文件名。现有 Python 栈没有托管内部帧，未取得本次 OEM 定制分支的运行时返回，因此不声称实测证明一定走了默认分支；不推广到所有版本、全部公开 CLR 接口均不可访问。

此前 `check-core-import.ps1` 使用独立 `IronPython.Hosting.Python.CreateEngine()`，事先由 PowerShell 加载程序集。它没有构造 IDE 的 ScriptExecutor，也没有经过上述宿主替换和过滤。其成功仍是独立运行时的真实结果，**不是 IDE 脚本环境的访问许可**；原测试和首败保留。没有通过改白名单、改权限、关闭过滤器、复制换名 DLL、其他加载方式或私有反射来规避本次限制。

## 可用的公开脚本证据与缺口

本机 `Common\ScriptEngine.dll` SHA-256 `e246800601521bf4382e9618f7ef6c9ee51817099a9c664d45a8227134251475`，MVID `bdacafd3-25a4-48b9-bea4-19911ab1d701`。核对范围为 IScriptProject 1–9、IScriptProjects 1–4、IScriptTreeObject、ISystem 1–4，以及 ScriptCommand、ProjectInfo。本机已提取帮助的页面标签为 3.5.9.0，不能混作当前安装元数据的版本。

| 字段/入口 | 能提供的证据 | 不能证明 |
| --- | --- | --- |
| project.path、handle、primary、library，projects.primary/all | 同一进程和当前句柄的原路径/归属；新 ownership 已有这些实际读数 | 保存来源、提交完成或磁盘内容与整个内存工程等价 |
| project.dirty | 帮助定义为自上次 save 后是否变化；公开只读 bool | false 不是保存完成回执，也不能证明没有外部覆盖。本次在 observer 前已停止，未取得新的 dirty 实测值 |
| get_project_info().version | 可读写的工程/库版本元信息 | 不是保存计数、磁盘版本或原生提交代次 |
| system.commands | 已查接口为命令查询及名称/描述/标识 | 未在这些接口发现命令完成事件或保存事务结果；不调用命令执行保存 |
| 文件身份、哈希及已支持内存快照 | 可检查前后状态是否变化、请求是否仍针对同一版 | 稳定两次或与表达式相同都不能独立归因于用户保存 |

已查脚本接口中没有确认可调用的最终保存通知。旧安装件分析还表明 `ProjectSaved`/dirty=false 可能早于最终物理文件复制。因此继续追求 Core 事件并非已证明可行的最小路线；本轮停止这条实际接入，不再换加载方式或重启尝试。

## 原时点的最小后续方案：明确接纳新基线，待复核

以下保留当时尚未实施的方案，不是当前待用户重复确认的要求。随后用户选择一次明确保存声明的方式，本分支已完成[0.42.0限定实现与离线验证](resident-saved-version-acceptance.md)，真实验收仍待安排。原草案第3项的租约更新设想已被代码核对收窄：源锁按规范路径和服务身份绑定，不保存fileId；实际实现保留并复查原路径锁及登记别名，不释放重取、不改写旧intent或历史记录。下列“本轮不创建”及长句示例仅描述原时点；现在无需固定口令或二次确认。

用户目标是“自己保存后继续在同一聊天/服务/IDE/工程修改”。可考虑将保存来源证明与用户授权分开：由用户明确表示已完成原路径保存并授权接受该版本，系统在健康且空闲的 resident 会话中重新核对当前归属、磁盘及内存，然后建立新的后续请求基线。**这只是设计候选，尚未实现、未解除当前 unknown，也不宣称获得了原生保存回执。**

最小规则须至少包括：

1. 只处理本服务已经拥有且未冻结的原 launch/PID 创建身份、原生句柄、原路径；没有在办请求、未完成结果或歧义工程。旧 unknown 和当前停止接收的实例不适用。
2. 用户的一次明确保存声明即为本次基线选择授权。工具先内部生成只读待接纳证据，绑定旧/新文件身份与哈希、当前支持范围内的完整快照、dirty 及版本；用户不用填写哈希、计划 ID 或重复确认。目标、归属或覆盖存在歧义时停止；一般请求没有保存声明时仍不自动接纳磁盘变化。
3. 队列内再次取得同一证据，要求无变化、dirty=false；发布可复查的接纳记录后才更新后续版本。若原路径正常保存造成文件身份替换，必须同时设计原有源租约/别名绑定的正式更新，不能只覆盖 `originalFileId`。所有旧请求版本失效，编译证据不自动转为磁盘编译成功。
4. 请求中再出现磁盘/内存变化、读取缺证、另存为、外部变更无法解释或发布失败则停止。现有写前版本、检查点、去重、写后核对和 unknown 冻结规则继续适用。
5. 对外只承诺“经用户明确授权、核对后的新基线可用于下一请求”。现态无法独立排除确认前发生过外部替换，用户的明确确认承担当前基线选择；这不是原生保存来源证据。接纳期间及后续的外部变化继续拦截。已读 ST、任务、库之外的隐藏配置未获得全面同一性证明。若要求自动且独立地证明保存来源及最终提交，仍需受支持的完成通知或其他明确验证路径。

待确认的自然语言用法：**“已在当前窗口保存原路径，请以现在这个版本继续把 PLC_PRG 中的……改为……，不要自动保存或关闭。”** 工具内部串行取证和复核，模型处理内部引用。dirty 仍为 true、路径/句柄变化、接纳期间版本变化或证据不足时报告具体差异，不要求用户为正常情况进行第二次确认。

本轮不创建该确认动作、不扩充通用恢复/隔离系统、不热替换当前接收器。当前实例如何保存/关闭由用户另行决定；不能为测试下一方案自动处置现场。

## 证据保全和归属

旧操作 `21483495-6efb-44ba-af19-2c1865548a9c` 仍为 unknown，原账本 SHA-256 `65a1d471366ae4d6d045cbd64f156e34234f3fc31bd56032ba4f61f33e0ed946` 不变。09:53 UTC 末次核对 36,088 项原材料，原操作、IPC、检查点和隔离材料无字节改变；既有文件变化仅为正式新服务/源租约取得所更新的两个锁，和首次失败后核对相同。新增本次账本/IPC/接收器记录另列，不能称整个登记目录不变。工程目录的初次失败快照与末次快照分开保留：保持打开期间 `.autosave`、用户 `.opt`、`.project.~u` 有新增或字节变化，AllUsers `.opt` 和 `.projectbackup` 有仅时间变化；主文件不变不代表目录不变，也不等于助手派发了保存。

本轮只复用上一阶段 build/typecheck、137/137 与 3/3 记录；没有新产品改动或重跑测试。本次独立连接、原生打开与访问拒绝单独归属 cee47d9；没有编译，不填写错误/警告数。公开接口分析是安装件静态证据，未把它替代实际保存验证。

前一离线复核包：`D:\InoPro\deliveries\InoPro-review-20261127-173556.zip`，SHA-256 `7c07ec7b6238becc9e35597adb2bb1725e8f1a414657e423a1f599b7e3c69939`，保持原样。新包独立保存实际批准后的计划、唯一启动、原始 unknown/归属/进程和只读安装件核查；不覆盖之前的未批准计划时点。

旧锁、历史 MCP unknown、隔离、默认性能、CmpLog、脚本信任、崩溃根因、Desktop 和 PLC 运行限制继续保留。PID 60892 及父链仍属已归属的旧离线测试，本次没有连接或终止。
