# DSH 连续两轮客户端准备（2026-11-26）

本轮只准备客户端，未执行 InoProShop 工程任务。当前产品仍为 `3f8c421afebb7605fd233061efb6150fc84c54d0`、0.40.0候选／38工具，107份固定构建文件重新核对一致；main仍为 `55bb58fc97b266215ad536b6b0f9d4f66c80670f`，未合并或部署。

**结论：安装版 DSH 的官方 `sdk` 常驻stdio入口可用于后续限定验收。** 已用纯测试MCP完成两条分别发送的模型请求，确认同一SDK进程、同一会话及同一正式MCP连接。它不是本产品38工具的握手，也不代表DSH工程连续编辑已通过。真实工程服务保持原状。

## 入口依据与本轮首败

本机安装版0.2.1-rc.5：

- `dsh --profile headless` 读取一个任务后退出。`--session-id`可恢复历史，不能保持前一进程及MCP连接。
- 帮助中的`tui`只是自定义profile示例，本机未安装该profile／应用。此结论不推广到其他入口。
- 安装件`dsh-app-boot`的`PROFILE_TEMPLATES`实际包含`sdk`、`acp`；本轮选用官方`sdk`，未运行ACP。
- `dsh-sdk-app`及`dsh-sdk-jsonrpc-server`文档明确支持同一进程中多次`session/prompt`。`initialize`等插件树加载完成；prompt回应仅为入队回执，必须另等`turn/end`的completed及`session/wait`返回。正常结束使用协议`shutdown`或stdin EOF。

只读分析使用本机安装件及REA，源码、说明、来源路径与SHA-256索引保留在复核包。没有修改安装件、headless生命周期或账号。首次`--dump-default-config`按官方模板生成了用户目录下的新`sdk`profile；原desktop/headless/web/inopro-validation共12份既有profile文件指纹一致。未改变权限策略、日常配置、Codex配置或工程登记目录。

第一次启动已成功SDK初始化及测试MCP工具清单读取，但观察脚本错误断言“全部子进程start数量必须为1”：PID71416只执行`server/discover`，PID73900才是完成`initialize`和`tools/list`的正式连接。断言`2 !== 1`发生于任何`session/prompt`之前，**模型任务0次**。原脚本及失败记录保留；SDK75428正常shutdown并退出0，正式替身73900退出0。发现连接退出事件缺失，不补造。

补修只按完整协议识别正式连接，发现连接单列；两轮调用仍必须落在同一正式PID／connectionId。离线9/9覆盖原归档及合成反例，包括缺少初始化／清单、两个正式连接、错连接调用、重复轮次和额外工具。随后保持相同临时配置及替身指纹，仅修正观察脚本、另建证据子目录，执行唯一一次真正两轮预检。未重发任何模型任务。

另保留准备脚本的辅助首败：未安装的`yaml`模块改用本机已随应用提供的`js-yaml`；配置生成后的摘要变量拼写错误；固定构建清单相对路径曾错误落在工作区，改为明确固定根路径后107份核对通过。均未派发工程操作，不覆盖原记录。

## 两轮无工程结果

| 证据 | 本次实际值 |
| --- | --- |
| 官方SDK宿主 | PID71928，创建时间2026-11-26T07:28:43.8085350Z |
| 会话 | `c66c816c-b07b-46f9-926c-ec4ced4d630c` |
| 正式测试MCP | PID49344，创建时间2026-11-26T07:28:45.7142240Z，父PID71928 |
| 正式连接 | `0d57e4b7-4d16-40f7-bdcf-413e8ef07f9c` |
| 工具清单 | 仅`continuity_marker`，真实工程MCP及19项默认工具插件均禁用 |
| 第一条 | 模型调用一次`round=1`，完成seq22；wait返回后才发送第二条 |
| 第二条 | 同会话、同正式连接调用一次`round=2`，完成seq37 |
| 返回 | 两次均`NO_ENGINEERING`；同connectionId／PID，callOrdinal依次1、2 |
| 正常结束 | SDK收到shutdown回执、退出0／无signal；正式替身stdin EOF、退出0 |
| 发现连接 | PID70992仅`server/discover`，返回-32601，退出事件缺失；后查已不在进程列表，不等同取得正常退出回执 |

原始SDK协议、模型工具调用与答复、两条输入、正式MCP的initialize/tools/list/tools/call，以及发送时序均留存。没有仅凭prompt入队或空闲通知判断回答完成，也没有用两次headless拼接。工具与系统正文只属于纯测试替身，不能冒充0.40.0实际工具或模型接收证据。

两轮前后22,034项原登记材料无新增、无缺失、无字节变化；原工程主文件、驱动control和三个存活进程创建身份保持。没有打开、新建、读取或修改工程，没有保存、编译、关闭、finish、历史reconcile或租约处理。

## 已准备的真实候选配置与命令（未启用）

脱敏模板：[官方SDK的resident候选配置](../config/dsh.sdk-resident-prepared.example.patch.yml)。保留已验账号服务依赖，不含凭证；实际固定入口和原登记目录：

- `D:\InoPro-ResidentDriver-Fix-20261126\fixed-3f8c421afebb\dist\server.js`
- `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`
- `maxInstructionBytes: 65536`；正文按固定文件口径65143字节（含客户端标题），尚未在SDK真实工程连接中发送。

模板的`mcp-inoproshop`刻意保持`disabled: true`，防止当前服务仍占用时误启动第二个服务。只有明确获准移交、正常关闭旧实例并确认原服务退出后，才在独立临时副本中启用该条目。不是日常配置更新，不得套用全局权限更改。

受支持的启动命令如下。stdin/stdout必须由有限验收取证脚本持续持有，传输官方JSON-RPC；这不是向命令行直接粘贴自然语言的headless模式，也不新增聊天客户端产品。

```powershell
& 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' --profile sdk --patch '<已核对的临时SDK配置绝对路径>'
```

协议顺序：`initialize`传入真实工作目录、`provider=deepseek-account`、`model=deepseek-flash`、`reasoningEffort=max`；等待成功及真实MCP版本／38工具确认。对一个新sessionId发送第一条`session/prompt`，等待completed的`turn/end`和`session/wait`。返回首轮结果后保持宿主和输入通道，等待用户第二条明确指令，**不自动发送第二条，不因固定延时派发**。获准后对同session发送第二条。每个工程工具running只查本轮原操作；冲突／unknown／缺证停止。

留证包括SDK宿主PID及创建身份、会话和两个messageId，正式MCP进程及initialize／tools/list，首次正式答复早于第二条输入；两轮真实工具请求、IDE launchId／创建身份／句柄／序号、读改读及项目磁盘哈希。发现连接与正式连接分别记录。不得把本轮替身的标识、工具数或返回值填入真实结果。

## 两条工程提示词（均未发送）

第一条仅在当前未保存实例已经按另行决定正常移交、且保存文件仍为5秒／FALSE时适用：

> 请通过InoProShop MCP直接打开 `D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`，使用resident模式并保持打开。必要读取PLC_PRG，确认实现区唯一的ProbeDelay赋值为T#5s、ProbeEnable为FALSE，只把ProbeDelay改为T#7s。保留声明、其他原文和两条中文注释，按当前版本修改并独立读回。不要保存、编译、关闭、重新创建工程或调用比较。条件不符、冲突、unknown或证据缺失就停止，不自动重试或回滚。报告本轮实际结果后等待下一条指令。

第二条必须等第一条正式答复完成，并另获明确发送指令：

> 继续同一连接和仍打开的工程，先读取PLC_PRG，确认ProbeDelay仍为T#7s、ProbeEnable为FALSE。只将ProbeEnable改为TRUE，保留T#7s、声明、两条中文及其余原文，并独立读回。不要保存、编译或关闭；若原会话／句柄已失去，停止，不重新打开。running只查询本轮原操作；冲突、unknown或不确定就停止，不重试写入。完成后保持打开并等待下一条指令。

## 当前实例收尾是下一项明确决定

IDE75528、服务25884、驱动65144仍打开；当前内存7秒／TRUE，磁盘仍5秒／FALSE，SHA-256为`8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。本轮没有授权或执行其保存、编译、关闭、第三次修改或接管。

若用户选择**不保存正常关闭**，先保留既有读回证据，再按原已核实正常维护方式关闭当前工程／IDE，取得真实退出和关闭证据，然后让原验收驱动正常完成、关闭stdio并确认服务及租约收尾；不删锁、不强杀。仍未正常退出或退出缺证则停止移交。若选择保存，应另外核实支持路径及保存证据；不能假装磁盘仍为5秒／FALSE，不能偷偷重置源码配合上述提示词。

真实DSH验收中也不能照抄本次无工程预检的自动shutdown。正式工程第二轮后应保持IDE、服务、SDK宿主及输入通道，等待用户下一条决定。只有获准正常收尾并确认工程处理完成后才用官方shutdown／EOF；当前resident EOF本身不授权保存或关闭IDE。未获决定时停在等待状态，不跨客户端重接。

本地复核根为 `D:\InoPro-DSH-Continuous-Prep-20261126`。原首败位于根目录，修正后的唯一两轮记录位于`attempt2`；原SDK/MCP协议、检查与脚本指纹、9/9记录、模板和来源索引由收尾包统一索引。当前产品代码、Schema、初始化正文、日常入口均未变；未运行产品全量测试。历史unknown、隔离、锁、默认性能、CmpLog、脚本信任、崩溃根因、Desktop及PLC运行边界保持。
