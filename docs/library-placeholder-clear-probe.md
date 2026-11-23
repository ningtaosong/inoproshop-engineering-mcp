# 普通占位符应用级显式覆盖清除探测

2026-11-23，基线 main 为 da87ac1d553a3a009a5bdb170b47a370924a0d3a；独立分支 codex/library-placeholder-clear-probe。产品保持 0.36.0 候选版、37 项工具，未注册清除工具。

## 结论：② 目前仅适合只读评估

本机公开脚本入口的清除语义已有明确依据，但本次夹具准备启动没有取得阶段、结果或可信退出回执，独立探测为 unknown。正式清除 **0 次**；没有基线、清除后或保存版编译，也没有清除后的保存持久化证据。不能将离线守卫通过、进程后来消失或主文件未变当作原生成功。

本轮没有继续第二次启动、切换参数、另建夹具、恢复性保存或回滚。既有 library_placeholder_resolve 仍只设置覆盖；其历史验收和失败结论保持原归属。

## 已确认的接口依据

| 层次 | 证据与实际含义 |
| --- | --- |
| 本机安装件 | InoProShop.exe 文件版本 1.9.1.6；ScriptDriverLibManObject.plugin 3.5.11.0；LibManObject.plugin 所在版本目录 3.5.11.10。安装件路径、SHA-256、MVID 和方法 token 在复核包中。 |
| 安装帮助归档 | IScriptPlaceholderReference.set_redirection(string fixed_resolution) 明示 None 或空串可删除重定向。使用此前从本机 ScriptEngine.chm 提取的 HTML，并记录当前 CHM 指纹；帮助页自身标注接口参考版本 3.5.9.0，不把该文字当成当前 DLL 版本。 |
| 脚本封装 | ScriptPlaceholderReference.set_redirection，token 0x06000073：取得所属库管理器的 ObjectWrite，调用 PlaceholderRedirection.SetRedirectedPlaceholderResolution(placeholder_name, fixed_resolution)，Commit，finally Dispose；没有吞异常的 catch。 |
| 本机底层实现 | LibManObject.SetRedirectedPlaceholderResolution，token 0x060001d6：检查第二个参数是否为原生 null；null 分支对重定向字典执行 Remove(name)，非 null 分支执行 set_Item(name,value)。这是安装件静态证据，不是本轮调用成功记录。 |
| 精确选择 | 公开 ref 对象可按 Application、库管理器和原生 ref.id 选择；底层字典实际使用 placeholder_name。因此还必须完整读取该管理器，拒绝重复 ID 和大小写变体重名。不能只拿一个显示名或列表位置派发。 |
| 清除后读回 | get_redirection 调用 TryGetValue；不存在条目时返回原生 null。显式覆盖、default_resolution、effective_resolution、resolution_info 和 resolver_guid 分开读取；有效解析字符串不能代替“覆盖已清除”的证据。 |

本探测选择有实现依据的显式 **set_redirection(None)**。安装帮助也提到空串，但本机所查实现的非 null 分支仍会写入字典；未验证空串的工程效果，不将它作为清除替代参数，也不进行第二种参数试验。token 仅在各自安装件 SHA-256／MVID 内有效。REA 的全程序集覆盖标为 partial，选取方法体没有指令截断；不宣称已审计全部库实现。

该路径删除的是当前库管理器中一个名称对应的应用级重定向条目，不是删除库引用、占位符声明或本机安装库。本轮只为自行建立的普通占位符设计守卫，不开放系统、设备或来源不明的目标。默认声明、显式覆盖、有效解析、直接引用和已安装目录分别取证。

## 实际执行与首次停止

工程路径（已封存，不是成功交付工程）：

`D:\InoPro-PlaceholderClear-20261123-004500\engineering\AM610_PlaceholderClear.project`

该目录名称只是探测标识；执行时间以原始 UTC／本机时间记录为准。来自正常中性 AM610 样例归档 InoPro-review-20261109-132658.zip，成员 projects/AM610_Minimal_MCP.project；作为独立验收准备复制，不改变产品直接编辑指定文件的默认流程。

准备脚本计划从本机完整原生目录确认 CAA Mathematics 的 3.5.11.0 默认版本与 3.5.7.0 显式覆盖版本，再创建 ClearProbeOwned。两个版本的目录存在，但本轮没有取得原生目录查询或占位符身份读回，不能将候选名称和版本写成已绑定目标。

| 本机时间／阶段 | 实际证据 |
| --- | --- |
| 09:40:42 | 通过现有 Store.acquire 取得原登记目录的租约。 |
| 09:40:44–45 | 一次 prepare 模式启动；独立操作 96060196-cd1b-4a03-97ed-92e6785d5350，IDE PID 45788，创建身份 startId 639309948449538458。 |
| 09:40:48 | stdout 只有 AddedToUI；没有 prepare 阶段文件、原生读回或结果。 |
| 09:44:45 | 240 秒期限届满，保存 prepare-unconfirmed.json 和 probe-stopped.json，unknown；未进入 baseline、clear 或 verify。 |
| 09:45 后 | 只读核对未发现该 IDE／工程服务进程；没有进程退出码或正常关闭回执，不改判成功。租约保留，观察为 owner-pid-exited／stale，未手工删除或释放。 |

同时间段 OEM 日志记录 Program.IsDriveInstalled 删除临时文件时的 UnauthorizedAccessException，随后记录驱动检测／安装成功文字。日志没有独立 PID 字段，也没有证明它导致脚本未进入的因果链；不将该文字当作驱动行为已独立验收，不修权限、驱动或提示处理。一次只读窗口文字枚举返回空列表，没有点击、键盘、焦点或窗口消息操作；不能由此认定没有出现提示。

准备阶段的原生变更和保存没有回执，记为**未确认**，不能推定为零修改。正式 clear 模式未启动，正式清除为 0；所有编译模式未启动，不填写错误／警告数。两次主文件 SHA-256 都是：

`89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`

本轮实际采集的 engineering 目录仅该文件，前后内容、大小和修改时间一致，没有附属文件差异。这不能证明内存未变化或正常退出。

## 守卫及验证归属

独立脚本：[原生阶段脚本](../scripts/probes/library-placeholder-clear-native.py)、[启动与租约保护](../scripts/probes/library-placeholder-clear-launch.mjs)、[精确守卫](../scripts/probes/library_placeholder_clear_guard.py)、[离线用例](../scripts/probes/test_library_placeholder_clear_guard.py)。脚本不进入 src 构建、MCP 注册、产品桥接派发或日常启动路径。

30/30 为合成证据的离线用例，首轮和最终轮分别保留，不相加。覆盖目标／归属／版本错误、重复身份及大小写重名、系统来源、覆盖不存在、空串与字面文本 None、缺字段、截断、读取失败、默认声明变化，以及清除后身份、其他引用、源码、任务备注和未知字段变化。写前拒绝不调用替身 setter 或派发标记；模拟派发后异常保留第一次异常且不重试。离线用例不证明真实 IDE 清除或保存。

拟定的真实阶段先保存并独立重开准备版，完成基线编译；同句柄再读全清单和磁盘版本后建立检查点，只清除一次。读回要求原生覆盖为 null、is_redirected=false、有效解析精确回到已确认默认值，其余字段严格保全；随后才允许编译、保存、独立重开及保存版编译。本次未走到这些步骤，脚本中存在的后续代码不是成功执行证据。

## 保全、登记和恢复条件

实际原登记目录仍为 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。用户文字中的 `D:\InoPro.local\...` 是另一目录；沿用已核实的日常配置和既有约定，不迁移或换目录。30,238 项既有材料路径记录及 361 项日常固定文件指纹未变；MCP operations／IPC 文件集合未新增，现有五项正式隔离的历史 unknown 未改变。当前独立探测 unknown 不写入或冒充其中任何一项 MCP 操作。

正常取得租约时的正式 stale 接管以及本轮保留的新租约单独记录；不能宣称整个登记目录完全未变。没有查询或 reconcile 历史操作，没有修改隔离、旧账本、原 IPC 或检查点；DSH、Codex 配置及 0.36.0 日常固定入口保持。

下一轮先按现有机制核清本次独立 unknown 和安全排他条件，取得脚本进入、结果发布及可信正常退出的证据；不得重放本次 prepare、直接重开封存工程或换目录绕过。之后另行授权准备正常夹具，重新确认原生目录和唯一占位符身份，才能完成一次清除及持久化验收。公开语义存在不等于这些保护条件已经满足。

没有新 MCP 工具、产品改动、DSH 模型任务、Desktop 操作或 PLC 连接。默认环境 200ms 性能、历史崩溃根因、CmpLog、脚本信任、Desktop 和运行未验边界继续保留。编译通过即使未来取得，也只能证明离线配置的编译结果。

## 本地复核入口

2026-11-23 后续仅完成[启动与退出取证补修及一次无工程验证](library-placeholder-startup-evidence.md)。该新操作取得可信正常退出，原 prepare 仍为 unknown；没有重开本节封存工程或补做清除、保存、编译。以下原探测记录保持原时点。

原始记录根目录：`D:\InoPro-PlaceholderClear-20261123-004500`。先读 result-summary.json，再核对 prepare-intent／start／unconfirmed、probe-stopped、OEM 日志来源、文件保全和接口方法证据。轻量复核包入口为 INDEX.md；逐文件哈希见 MANIFEST.sha256.json，ZIP 总哈希由最终交付另列。
