# 本机启动检查与 DSH／Codex 正常移交

保持0.15.0候选版、二十项MCP工具。本文和[本地诊断脚本](../scripts/check-local-startup.mjs)不改变工程服务、租约、恢复协议或工程操作，也不提供自动移交控制器。原Codex0.14.0、0.15.0固定工作区及专用配置分别保留，一次只允许一个客户端使用同一工程登记目录。

## 先区分失败发生在哪一层

| 记录或现象 | 能确认的事实 | 不能据此断言 |
| --- | --- | --- |
| 0.12.0历史辅助脚本拒绝 | Windows PowerShell5.1、当时CurrentUser为RemoteSigned；原日志有SecurityError/UnauthorizedAccess；仅子进程临时设置后回归成功 | 当时未保留下载标记，部分中文错误已乱码；不能补造区域/签名根因，也不能说临时设置消除了根因 |
| 多轮DSH辅助pwsh退出3221225794 | 原工具结果伴Crashpad管道错误；该退出值为0xC0000142，NTSTATUS含义是DLL初始化失败 | 工具名pwsh没有证明实际解释器路径、版本或工作目录；不能把它当成执行策略拒绝，更不能猜是哪一个DLL失败 |
| Codex模型目录不可用、WebSocket超时 | 与MCP工程操作分开；既有记录有客户端自动回退HTTPS后完成原任务 | 不能据此重投写入任务、扩大工具超时或断言工程保存失败 |
| 服务占用、租约或未决操作 | 应核对实际进程身份、原登记、隔离和操作终态 | PID是线索；不能删锁、清空登记、换空数据目录或把已隔离unknown当成已恢复 |

执行策略及Process作用域依据[Microsoft说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)。退出码的含义依据[NTSTATUS定义](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55)。含义不是根因诊断；本轮没有为这些历史辅助失败修改DSH终端插件、系统DLL或机器/用户策略。

## 无绕过的本地检查

使用明确的Windows Node和固定检出。以下都是示例路径，须替换为本机已核对的路径；不要覆盖已有目录：

```powershell
Set-Location 'D:\InoPro-Fixed'
& 'C:\Program Files\nodejs\node.exe' scripts/check-local-startup.mjs
```

默认只读检查Node/Windows PowerShell路径、实际新子进程、各作用域策略、两个必要脚本的SHA-256、签名状态及下载区域信息。不读取私有客户端配置或登记，不启动MCP/IDE，不修改策略或文件信任。脚本仅清除自己诊断子进程继承的临时PSExecutionPolicyPreference；不改父进程、注册表或服务环境。父进程仍带Bypass/Unrestricted时明确失败，不把干净诊断子进程冒充正常启动环境。

需要验证生产辅助入口时，显式给一个**尚不存在、父目录已存在**的绝对目录：

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/check-local-startup.mjs --probe-dir 'C:\Temp\InoPro-Startup-20261106-01'
```

它只创建两个诊断文本文件，使用既有copy-closed-project和maintenance-read-lock脚本做一次文本复制、一次只读句柄检查；不使用.project文件，不提交维护计划，不建立替代工程数据目录。已有目录拒绝复用，不覆盖。脚本无自动重试或终止进程；超过15秒会打印原子进程PID，继续观察原进程，不能反复启动试探。这个诊断通过不证明IDE操作、工程写入或故障恢复通过。

本轮可复现的诊断问题是：Windows PowerShell5.1按名称自动装载安全模块时发生重复类型数据错误，可用模块中同时存在7.x与系统3.0模块；仅移除子进程PSModulePath没有解决。对照中显式导入`$PSHOME\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1`后策略查询通过。新诊断脚本采用该系统原生模块路径，避免沿用不确定的同名模块装载；未修改全局模块路径或安装。

本机最终检查为Windows PowerShell5.1.26100.9444、pwsh7.6.5、Windows Node24.15.0；两种PowerShell的策略分层分别记录，不能混用。5.1实际RemoteSigned来自CurrentUser，7.x实际RemoteSigned来自LocalMachine；Process均Undefined且没有临时变量。两个必要脚本未签名、当前无Zone.Identifier，最终两个文本辅助检查成功。NotSigned状态本身不等于此次被策略拒绝，不能把签名提示词当实际启动错误。

历史拒绝当时的区域信息仍缺失，无法证明根因消除。因此准确结论是：**已改善启动检查方式；本轮新子进程检查无需临时绕过，历史信任问题仍未确认。** 没有执行文件解锁，也没有将Bypass/Unrestricted写进默认入口。日后若来源或签名条件不明，先停、核验来源/哈希并保留原状态；组织签名或权限要求不能绕过。

## 固定客户端入口和配置

- DSH安装版0.2.1-rc.5的CLI为安装目录下`resources\runtime\cli\bin\dsh.cmd`，本机不在PATH不等于未安装。其既有包装器以Electron Node模式运行dsh-desktop-host；使用安装版帮助，不猜测status/submit命令。
- Codex CLI本机为0.152.1。PowerShell中的裸`codex`可能先解析到npm的codex.ps1；使用已核对的codex.cmd，或Windows Node加实际`@openai/codex/bin/codex.js`入口，区分脚本垫片与真实CLI。不能因换入口成功就认定所有历史PowerShell故障已解决。
- stdio由客户端启动固定检出的dist/server.js；command、args、cwd、IDE可执行文件和Profile必须对应真实路径。原登记目录保持不变；不同时启用两份InoProShop服务。参考[Codex配置与作用域](codex-integration.md#配置与加载)及[DSH接入](getting-started.md#接入-dsh)。
- 初始化等待、工具等待和IDE操作超时分别记录，DSH的maxInstructionBytes不属于Codex。配置写入、服务发送、客户端可观察接收和模型实际使用分别举证，不能互相代替。

## 正常移交步骤与停止条件

1. 核对现有服务PID、父进程、入口/构建及原数据目录，读取租约、登记和操作终态。历史隔离unknown与当前running分开；损坏记录、未隔离unknown或未确认停止任务时不接管。
2. 刚刚确认原客户端空闲、输入框为空、无用户正在交互后，正常退出或停用原服务。窗口提示检测到用户输入时停止自动操作、保留现场，不能以更早的空闲截图继续退出。
3. 等待原MCP子进程实际退出；PID不明或超时就记录并停，不强杀、不删锁。原生IDE进程归属也需确认，不能按历史PID结束进程。
4. 启动一个新客户端，继续使用原登记目录和固定构建。让模型只调用环境、会话和登记检查时，应使用受支持CLI入口。直接握手只算连接预检，不能冒充模型调用。确认实际版本/工具数及原隔离状态，不把只读状态查询当作取得工程写入租约或完整工程验收。
5. CLI任务或工具等待超时，查询原任务/进程/操作，不重新提交。结束后确认当前操作终止及CLI/MCP退出，再正常恢复DSH；不要自动重启Codex桌面端。

“环境/会话/登记”不会派发IDE，可能不会改变工程执行租约；遗留租约只有退出所有者并经既有保护规则核对后才能正常处理，不能手工清理。共享配置不等于共享进程，不支持DSH与Codex并发操作工程。

## 2026-11-06本轮结果与待办

启动诊断和两个文本辅助入口通过，未启动IDE或派发工程操作。原DSH配置、Codex0.14.0/0.15.0固定构建和私人配置保留。首轮采集器未及时留存stderr、诊断脚本的.NET Framework ADS读取及数组枚举偏差、Windows路径ESM导入错误均另存为本轮辅助首败；最终结果不覆盖它们。

正常移交**尚未验收**：原DSH新会话空输入曾被观察到，但后续窗口保护提示检测到用户输入活动，自动退出随即停止，更新的活动证据优先。DSH保持原实例，未应用预备的诊断配置；Codex模型检查任务只准备，未提交、未启动新的工程服务。待再次确认空闲、输入和任务终态后，才能执行DSH释放→Codex接入/释放→DSH恢复。不能用此次脚本通过替代这个待办。

历史11/12质量、原隔离unknown、旧锁、CmpLog和脚本信任根因保留。没有本轮编译诊断、PLC在线、仿真或运行结果，也未验证桌面工具、链接点击或完整设备配置。不因启动诊断成功恢复故障工程。
