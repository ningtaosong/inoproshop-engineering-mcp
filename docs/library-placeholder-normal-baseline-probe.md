# 清除应用级覆盖：恢复已测正常解析基线

2026-11-23，在本机 InoProShop 1.9.1.6、AM610 设备描述 3.5.11.11 的独立夹具，公开 `set_redirection(None)` 正式派发一次。普通自建 `CAA Mathematics` 占位符的 ID、名称、默认声明和命名空间保留，显式覆盖回到原生 null，is_redirected=false，实际有效解析恢复到 CAA Mathematics 3.5.11.0，resolution_info 为“设备解析”。引用 ID 为 3880672626；应用覆盖此前为本机已安装的 3.5.7.0。

该正例先建立并编译、保存、独立重开未覆盖状态，才设置覆盖。正式清除后的即时读回在公开加载前就已恢复解析；随后预先限定的一次 get_libraries(True) 没有改变采集结果。因此不能说加载是恢复原因或必要修复。未覆盖基线、清除即时、加载后、保存后、独立重开及保存版编译后，完整受检状态相等。

八个独立 IDE 进程都有绑定操作、launchId、PID、创建身份与脚本指纹的正常退出证据。准备阶段保存3次、编译5次；正式阶段清除1次、保存1次、编译2次。七次编译各0错误、0警告，最终保存版编译对应文件哈希 a6905b4f3a63ff6dae024de73fb0adcad602e3665870bdeb3f702af96bc95bb1。

工程：`D:\InoPro-PlaceholderClear-20261123-150000\engineering\AM610_PlaceholderClear.project`。独立操作：`0cf29f90-cda7-4024-b949-eb337cbd8c3e`。本工程不再用于后续写入。

## 范围及缺口

本结果只为该精确组合提供产品化原生依据，没有交付清除 MCP 工具，没有真实 MCP 或 DSH CLI 清除验收。普通用户工程不一定有本探测建立的“未覆盖历史基线”；产品化必须独立解决当前句柄的预计恢复解析证据，不能照抄夹具历史或假定 default_resolution 是回退保证。

此前 ClearProbeOwned 未覆盖时本来就是未解析，清除后恢复了同样的未解析读数。安装件解析链会考虑应用、设备目标设置、配置文件等来源；默认声明不是通用保证。四份旧独立现场与历史 MCP unknown、隔离、锁、检查点及退出缺口不改判。本次成功不说明旧进程全部异常的唯一根因已经确认。

本轮保护保留完整清单、原生字段类型、任务内调用顺序、源码、已读设备字段、版本、同句柄重查和检查点。阶段异常停止，无重试、回滚或恢复性保存。唯一旧登记变化是服务失效租约由原 Store 身份机制归档，字节和文件身份保留；其余35441项既有文件不变，本次租约正常释放。新增两份 .opt 和一份 .projectbackup 单列；不宣称目录未变。

## 验证归属和入口

本次独立离线组分别为正常基线25/25、清除守卫30/30、稳定化/阶段证据32/32、记录器12/12、固定加载器11/11、Node阶段28/28、退出观察21/21；IronPython 2.7.7.0六项纯编译通过。各组不相加，替身不冒充原生验收。首次测试输入错误与控制台编码失败保持。

原始实际脚本按运行字节固定在复核包；Git正常化换行后的提交指纹不代替原执行指纹。此前九项未提交补丁原文已单独备份。

- [原探测及首败](library-placeholder-clear-probe.md)
- [启动与取证修正](library-placeholder-startup-evidence.md)
- [IronPython兼容修正](library-placeholder-ironpython-compatibility.md)
- [实际原生阶段脚本](../scripts/probes/library-placeholder-clear-native.py)
- [阶段守卫](../scripts/probes/library_placeholder_clear_guard.py)
- [新增离线用例](../scripts/probes/test_placeholder_normal_baseline.py)
- 本地完整报告：`D:\InoPro\deliveries\placeholder-baseline-restore-20261123-142255\REVIEW.md`
- 复核ZIP：`D:\InoPro\deliveries\InoPro-placeholder-normal-baseline-review-20261123-150049.zip`
- ZIP SHA-256：`c2cca5b9457248b8196a95dd96ad2ecfabbc8b6cd03ccdc89996e7e048c25f21`

产品维持0.36.0、37项工具，日常入口和私人配置未变。没有PLC；S9在线阶段暂缓，未连接、下载、运行或仿真。默认性能、崩溃根因、CmpLog、脚本信任及Desktop连接限制继续保留。
