# 占位符独立探测：IronPython 兼容补修

2026-11-23，从 `760cbd750f0f1a76cca51fa8d56cb18ca4107d52` 继续。本轮只修改独立探测设施，产品保持 **0.36.0 候选版、37 项工具**；产品桥接、Schema、初始化指令、日常固定入口及 DSH／Codex 配置不变。

**两份原脚本的解析缺陷已复现并修正；唯一一次无工程实测已完成实际固定辅助模块加载、主线程往返、中文结果读回和可信正常退出。** 本轮没有 prepare、工程打开或创建、占位符查询或清除、工程编译或保存。没有清除及保存持久化正例，不能进入清除工具开发。

## 原归档与同版解析复现

使用本机 Windows PowerShell 5.1／.NET Framework 加载安装目录中的 IronPython，语言版本与程序集版本均为 `2.7.7.0`。运行时为：

`D:\InProShop\CODESYS\PlugIns\dc937c18-e9f0-434d-85b7-1b8f499e378a\3.5.11.10\IronPython.dll`

SHA-256：`dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`。其余加载程序集的版本、指纹及原始异常链见 `ironpython-before-final.json`、`ironpython-after.json`。

| 原归档 | ZIP SHA-256 | 实际原脚本 SHA-256 | 同版解析结果 |
| --- | --- | --- | --- |
| InoPro-review-20261123-095302.zip | `755b9a248d680a672741d92be7dfe02ccfd4c6d1fabfb5561d67272bb08cef45` | `653447c74df82d2529ebb6597ba9d44300ca0b9c5d001487aa66bb8db6331bb8` | `run` 定义第 18 行失败 |
| InoPro-review-20261123-110317.zip | `837fc11acdc65e1c2013c56f46abc0b32fbb341c4fa8efb4bbfc189cbe814151` | `6fa04c98781436b4dcb4cf84786355a6966c7e12074db3298cd268818c0defce` | `run` 定义第 43 行失败 |

原 ZIP 位于 `D:\InoPro\deliveries`。从 ZIP 提取实际脚本字节并与各自启动 intent 指纹核对；原脚本仅调用 `ScriptSource.Compile()`，**未执行正文**。两份完整脚本及最小反例都得到：

```text
unqualified exec is not allowed in function 'run' because it contains a nested function with free variables
```

这是已确认的脚本解析缺陷，可以阻止该完整脚本执行最早入口。它不独立证明旧原生进程全部超时、提示、日志及退出行为的唯一原因；没有补写旧阶段或退出回执。此前仅用 Python 3 解析通过的记录保留原时点，不再作为 IronPython 兼容证明。

## 最小修复与命名空间

[固定辅助加载器](../scripts/probes/probe_fixed_helpers.py)将两处固定代码执行移至不含嵌套函数或闭包的 `execute_fixed_source`。`run` 不再包含 `exec`。只执行已校验指纹的固定 worker 辅助前缀和 library_reference；worker 业务派发尾部不执行，不引入用户文本求值。

加载顺序仍为 guard → worker 辅助前缀 → library_reference；两段代码继续共用同一 `api` 全局字典，保留 `__file__` 和原生 `projects`、`system`、`librarymanager` 对象。加载器自身也增加指纹约束。原生业务脚本从 `publish, sha = ...` 开始的后续内容与基线一致，清除、保存、守卫、unknown 和租约机制没有改变。

[无工程脚本](../scripts/probes/native-startup-smoke.py)只读取本轮诊断启动 intent，实际加载上述固定辅助模块，检查八个辅助函数的 `func_globals` 指向同一字典，并在主线程调用纯文本 `content_hash` 验证跨函数调用。它不导入或执行 prepare 业务入口，不读取旧夹具 intent；载入工程 API 对象不等于调用工程方法。

加载异常和指纹变化继续向外传播，不能捕获忽略后报告成功。首错记录及有界退出观察规则保持：业务超时停止后续派发，迟到结果和退出单独追加，不能将 unknown 自动升级成功。

## 检查归属与首败

| 检查 | 本轮结果／实际范围 |
| --- | --- |
| 同版 IronPython 编译 | 9 项应通过的完整脚本／必要模块均通过；两份原脚本与最小反例共 3 项应失败的检查均确认预期错误。没有执行原 native 脚本正文。 |
| 同版 IronPython 合成加载用例 | **11/11**；共享全局、跨函数调用、加载顺序、业务尾部不执行、指纹变化、导入／解析／执行异常及记录器失败保留首错。只执行审阅过的合成测试模块。 |
| CPython 加载用例 | **11/11**，独立记录，不能代替 IronPython。 |
| CPython 入口记录用例 | **12/12**，包括入口、导入、发布失败和无工程边界。 |
| Node 退出观察用例 | **19/19**，包括超时后迟到退出、非零／信号／缺失退出和证据发布失败。 |

各组不相加；输入清单和实际脚本 SHA 在原始目录与复核包中。没有重跑产品全量回归。`ironpython-after.json` 的 `compileOnly=false` 指后续显式执行了合成测试；各完整原生脚本条目的 `bodyExecuted=false`，`originalNativeBodiesExecuted=false`。

本轮检查设施首败也保留：第一次主机核对中运行时 SHA 常量手工录入错误，停在引擎创建前；随后报告匹配器用 JSON 转义文本匹配带单引号的原始异常，造成预期判定失败，真实解析异常已留下；收尾 AST 检查最初把写入口证据的 `os.open` 误排除。以上分别修正检查本身，未改运行时、产品或旧归档，也没有导致再次启动 IDE。

## 唯一一次无工程实测

本机 InoProShop `1.9.1.6`，本机时间 **11:20:40–11:20:50**：

| 项目 | 本轮实际证据 |
| --- | --- |
| operationId / launchId | `ae982f1e-498f-4545-9042-9c49ae436397` / `9ead45c5-a360-46a8-9a6d-78b8bd6869b5` |
| PID / 创建身份 | `39512` / UTC ticks `639310008409274445`，原生进程内与外部观察对应 |
| 无工程脚本 SHA-256 | `47a90aa0695767c1493b66492d0d8151b3c29b44d84c3852a0a232454631f8ba` |
| 固定辅助来源 | `D:\InoPro-Fixed\0.36.0-da87ac1d553a`；五项辅助指纹在 intent、原生结果及外部复核中一致 |
| 实际阶段 | 最早入口 → 必要模块 → 加载器 → guard → worker → library_reference → 共享命名空间 → 主线程往返 → 结果发布及读回 → 退出请求 |
| 中文读回 | `无工程辅助模块加载：主线程往返完成。` |
| 结果 SHA-256 | `1820d4c3d62266a8df44c37a7d7e32176e967e893b0df5650a20cda6832c3a23` |
| 可信退出 | 同一进程实例的外部 `child-process-exit`：**code 0、signal null**，无超时；正式服务租约随后正常释放 |

启动入口仍为 `D:\InProShop\CODESYS\Common\InoProShop.exe`，工作目录为其所在目录，既有 `--profile="InoProShop(V1.9.1.6)" --runscript="<绝对路径>"` 形式不变。只注入归档所列的 trace 环境项，继承环境未输出；没有策略绕过或提示自动操作。

本次要求的链路没有缺失阶段。`startup-verification.json` 中 `process.state=running` 是启动时取得的创建身份观察，最终退出以独立 `exit` 字段及 `process-exit.json` 为准。没有用进程消失或 exit-requested 代替退出回执。

## 保全与仍未验证的内容

沿用 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。开始和收尾均无活动 IDE／Desktop／工程服务，无本轮工程操作。现有 Store 正式归档 stale 服务租约并只释放本轮自己的服务租约；对应字节核对见 `lease-preservation.json`。没有手工删锁或释放封存工程源锁，不能把正式租约生命周期写成整个登记目录未变。

**30,663 项历史路径记录、361 项固定构建文件无字节变化**；MCP operations／IPC 文件集合未增加。两个独立 prepare unknown、原封存工程及完整输出目录、五项正式隔离的历史 MCP unknown、旧账本、IPC、检查点、源锁与 DSH／Codex 配置保持。未查询或 reconcile 历史操作。

原独立 `96060196-cd1b-4a03-97ed-92e6785d5350`、`cef2a565-4b8e-432c-a9b3-d398e5ae4ef3` 仍为 unknown，原正常退出仍缺证。没有清除、默认解析回退、保存重开或保存版编译证据。本轮没有工程编译，故不填写错误／警告数。

OEM `Program.IsDriveInstalled` 日志仍只有既有时间关联，没有新增因果证据；未改权限、驱动或执行策略。历史性能、崩溃根因、CmpLog、脚本信任、Desktop、PLC 及运行验证边界保留。后续工程探测需另行安排，本轮到此结束。

## 复核入口

原始目录：`D:\InoPro-ProbeStartup-20261123-111039`。依次核对 `archive-script-identities.json`、两份编译清单、`ironpython-before-final.json`、`ironpython-after.json`、`launch-intent.json`、实际 trace／result／process-start／process-exit、`startup-verification.json`、`preservation-after.json`、`lease-preservation.json`。原始脚本字节在 `original-sources`，本轮源文件快照在 `executed-scripts`；提交的文本换行归一化与执行字节指纹分开记录。

复核 ZIP 的 `INDEX.md`、`MANIFEST.sha256.json` 提供入口与逐文件校验。原归档不覆盖，不把新证据填入旧操作。
