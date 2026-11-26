# 0.41 常驻内存编译真实首轮：编译完成，保全核对停止

本轮受验产品为 `2eb3d5cf2854e4cf675245eb744e3f97367eb655`，固定目录 `D:\InoPro-ResidentBuild-Real-20261126\fixed-2eb3d5cf2854`，0.41.0候选／38工具。基于交付 `ea3b66e223b0b967810b2c0a1f8ba6b3ac9d02b0` 继续，仅补真实记录和文档；本轮未改产品、守卫、Schema或初始化指令，未合并main、未部署、未发送DSH模型任务。

**结论：一次原生内存编译完成，完整诊断为0错误／0警告；MCP编译操作因直接库清单变化返回unknown，整轮未通过。** 没有执行后续TRUE修改，也没有保存、重编或关闭新实例。原首败和所有历史unknown不改判。

## 授权及旧会话移交

旧IDE67788此前已按明确授权不保存正常退出0。旧辅助控制器finish首败和最小兼容补修见[移交记录](resident-build-handoff-fix.md)。随后用户明确允许“仅结束旧辅助控制器并继续”；本轮重新核对创建身份、无在办以及三个进程的父子关系，重新挂持有进程句柄的独立退出观察，再只结束旧控制器48624。没有向SDK14220或MCP68004发强制结束。

| 原进程 | 创建身份 | 实际退出证据 |
|---|---|---|
| 辅助控制器48624 | 639312773144474596 | 2026-11-26 21:59:51中国时间，退出码−1，明确标为授权终止，非正常退出 |
| SDK14220 | 639312773164212845 | 同一独立观察器取得退出码0；未直接终止该进程 |
| MCP68004 | 639312773185279553 | 同一独立观察器取得退出码0；未直接终止该进程 |

Windows观察依据是实际进程句柄及退出码，不能把进程消失充作退出证明。没有补造SDK／MCP自身的shutdown完成回执；旧服务锁仍在，不能报告正常释放。随后补修产品的完整 `verifyClosedResident` 以原8项请求、结果、完成回执、原IDE正常退出及未变磁盘文件核对通过。新服务通过原有租约取得机制归档旧stale锁并发布自己的租约，源锁同样保留旧原文；没有手工删除、释放或编辑租约。

发现另一个既有Node进程60892，父进程61480为 `tests/stdio-observer.test.mjs`，该路径使用fixture和独立临时目录，非本次实际登记的拥有者；未碰该测试现场。没有启动Desktop或做界面操作。

## 实际连接与六项原生请求

工程：`D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`。

沿用登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。正式MCP的原始initialize和完整tools/list已留存，实际0.41.0／38工具。初始化正文65135字节，含实际客户端标题65162／65536字节。使用固定安装SDK相同转换器逐项核对全部76份输入输出Schema，协议原文一致；这不是DSH模型接收或日常客户端验收。

同一launch：`fa06d1d6-eedc-4d35-846e-3162dfeb8b7d`，同一工程句柄0。新驱动66352／创建身份639312985988993186；MCP67192／639312985991677407；IDE66304／639312986237949757。请求归属、指纹、完成回执、服务验证及进程身份均单列核对，六项请求的完成取证成立不等于第六项业务成功。

| 序号 | 工具与实际动作 | 结果 |
|---|---|---|
| 1 | project_open，显式resident和实际Application | succeeded |
| 2 | object_list，完整限定对象清单 | succeeded |
| 3 | object_read，实际读到5秒／FALSE | succeeded |
| 4 | code_apply_change，仅将ProbeDelay的T#5s改为T#7s | succeeded，声明、FALSE及两条中文保持 |
| 5 | 独立object_read | succeeded，确认7秒／FALSE及原文保持 |
| 6 | project_build，带第5项的当前residentVersion | 原生编译1次，MCP unknown |

正式编译操作 `bf310d71-3e21-421b-9c78-233f4a72dd17`，requestId `resident-build-once-2eee43f5-640f-4786-9c39-b27a1cc851af`。36次状态查询全部对应这六项新操作；running查询原操作，没有重发写入或查询历史unknown。

## 精确差异及诊断

首次异常来自 `bridge/resident_core.py` 的 `build_conservation`：`Compiler changed existing node: 5d558397-776b-478d-ab91-fa36aca5d60a`。

该节点为 `Device / Plc Logic / Application / 库管理器`，原生类型 `adb5cb65-8e1d-4a00-b70a-375ea27582f3`。其唯一变化字段是 `directLibraries`：**17→18项**。按原生引用ID核对，原17项逐字段一致、相对顺序不变、无删除；末尾新增：

| 字段 | 实际值 |
|---|---|
| name／placeholder_name | #IecVarAccess／IecVarAccess |
| id | 2303837266 |
| is_placeholder／system_library | true／true |
| is_managed／is_redirected | false／false |
| explicit_redirection | 原生null |
| default_resolution | IecVarAccess, 3.3.1.20 (System) |
| effective_resolution | IecVarAccess, 3.5.11.0 (System) |
| resolution_info | 库配置文件解析 |
| namespace | IecVarAccessLibrary |
| resolver_guid | b303f5ce-75ff-4668-a777-7da8debb449c |
| optional／qualified_only | false／false |

此外 `openedProjects` 增加4个非primary、library=true的原生句柄：77 IecVarAccess 3.5.11.0、78 SymbolicVarsBase 3.5.11.0、79 Data Server Interfaces 3.5.2.0、80 Monitoring Data Interfaces 3.5.2.0，路径均来自本机安装库目录，完整原文见快照。它们和**直接引用新增**是两层证据，不能用后台库加载的既有许可来忽略直接清单变化。

没有新增或移除设备节点，`buildContext` 完全一致；其余既有节点及除openedProjects之外的状态字段一致。源码和任务调用按原有比较语义保持。此次不是早期编译派生设备位置问题，不能沿用那个例外。

`compiler-result.json` 原始UTF-8正常，`completed=true`、`diagnosticsComplete=true`；两个类别分别count0和3，均endObserved，三条均为text，包含“编译完成 -- 0错误,0警告”。编译调用和返回标记齐全。终端显示编码问题不代表原文件中文损坏。0/0只属于本次7秒／FALSE的未保存内存编译，不能作为最终TRUE版本或保存版本证据。

保全校验在建立成功编译结果之前停止，登记中的lastBuild未建立，不能声称已验证buildApplicable先true再false。编译后的完整原始快照仍显示7秒／FALSE及原声明、中文；这是失败现场快照，**没有编译后的独立object_read**，不补写为后续读改成功。

## 停止与保全

新接收器记录completed=6、ideExitRequested=false、projectClosed=false并停止收取后续请求。控制器保留首错，最后为stopped-preserved。IDE、服务和控制器仍活；没有关闭或退出请求，也不应为它们填写正常退出回执。接收器停止后无法把当前实例当作可继续接收工程请求的会话。

本轮正式修改1次、原生编译1次；后续TRUE修改0、保存0、新工程关闭0、DSH模型0。出现unknown后没有额外工程调用、重试、反向修改或恢复性保存，守卫未放宽。

主文件读取前后SHA-256：`8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。磁盘仍为原5秒／FALSE的同一保存文件；新内存最后快照为7秒／FALSE，未保存。附属 `.projectbackup` 字节不变但修改时间变化，新增 `.project.~u`；按本轮实采基线记录，不能称整个目录未变。

22,125项既有登记材料中，当前registry.json和service.lock变化，新增6项操作及其证据。22,049项历史操作／IPC／resident／隔离／旧stale锁等保护文件字节不变。源锁的旧字节被正式机制归档，未丢弃。独立主工程及本轮新unknown均保留，不恢复旧账本，不改判原失败。固定构建105项产品文件指纹保持。

## 验证归属与下一步条件

本轮没有产品改动，不重跑全量或增加产品测试。2eb3d5c的153/153定向、0a7eb05的Node1569/1569、Python718/718及IronPython37/37与16/16仍归各自提交，不相加。此次真实记录仅说明上述五项通过及第六项停止。

取证脚本的两个首次静态审计错误也保留：先错误地把服务增补后的project_open响应与原生data整体比较；随后将Zod静态draft2020-12与协议draft-07直接比较，在tuple表达方式处失败。前者改为逐项验证原生字段并单独保留服务增补字段，后者使用固定SDK相同转换器精确对照。只重跑文件审计，未重放工程请求、修改业务守卫或改变Schema。

后续先依据本轮原始前后快照及本机受支持的库解析／编译接口证据，确认新增直接引用的触发条件、归属和可精确约束的保全规则；仅有system_library=true或名称一致不够。取得依据和离线反例前不允许直接清单任意增长。当前unknown实例的维护及任何新真实轮次均须另行明确决定，本轮不自动保存关闭、重新编译或继续改TRUE。

日常入口、账号和Codex配置不变；没有新DSH模型或Desktop验收。实际调度、PLC运行、默认性能、崩溃根因、CmpLog、脚本信任及全部旧unknown和隔离边界继续保留。证据根：`D:\InoPro-ResidentBuild-Real-20261126`；原20:33复核包保留为补修前移交停点，不被此次记录覆盖。
