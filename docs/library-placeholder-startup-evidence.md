# 占位符探测启动与退出取证补修（2026-11-23）

历史说明：本页记录先前的简单无工程验证；后续新增的[IronPython 兼容修复及实际辅助模块加载验证](library-placeholder-ironpython-compatibility.md)另行归档。本页当时未验证的辅助加载和未定位原因不作为当前结论，原 unknown 不改判。

本轮从 `dead85a49551c6c1313ab4cd8a10090c21efc9d5` 继续，仅修正独立探测设施。产品仍为 **0.36.0 候选版、37 工具**，产品桥接、租约实现、初始化指令、日常固定入口及 DSH／Codex 配置未改。本轮没有工程打开、新建、占位符查询或设置、编译、保存、DSH 模型任务或 PLC 操作。

**唯一一次无工程启动通过**：最早入口、必要模块加载、主线程往返、中文结果发布和外部读回、正常进程退出均有对应记录。这只证明本次启动及取证链路可用；原 prepare 仍为 unknown，占位符清除与持久化仍未验。

## 保留原现场与定位范围

原独立操作 `96060196-cd1b-4a03-97ed-92e6785d5350` 的封存工程和整个原输出目录未改、未重开。原进程最后已证实的阶段仍是启动身份及 stdout 的 AddedToUI；**首个缺失阶段是原脚本进入**，之后的模块加载、业务执行及正常退出均缺证。原始准备是否发生内存修改不能由磁盘未变判断。

旧启动器实际代码片段的离线复现确认：240 秒超时分支发布 unconfirmed 后直接抛错，即使之后收到 close(0, null)，也不会再发布退出回执。复现只注入虚拟进程事件和缩短的离线计时器，未运行旧脚本。原生脚本的模块加载和项目辅助模块导入均在旧业务函数的异常保护之外，因此这些阶段失败时可能没有业务异常记录。这是取证缺口，不是原失败唯一根因的证明。

原封存路径：`D:\InoPro-PlaceholderClear-20261123-004500\engineering\AM610_PlaceholderClear.project`。原记录入口见[首次探测](library-placeholder-clear-probe.md)；原 ZIP 为 `D:\InoPro\deliveries\InoPro-review-20261123-095302.zip`，SHA-256 `755b9a248d680a672741d92be7dfe02ccfd4c6d1fabfb5561d67272bb08cef45`。本轮不回填原阶段、退出码或成功结果。

## 设施改动及离线检查

- [原生记录器](../scripts/probes/probe_startup_trace.py)：项目辅助模块前的入口和脚本指纹，分开记录模块加载、主线程进入／返回、结果发布／读回、退出请求；捕获入口、导入、回调异常及可取得的 .NET InnerException。记录器失败追加次级错误，首个异常不被覆盖；文件及 stderr 均不可用时如实缺证。
- [退出观察器](../scripts/probes/probe-exit-observer.mjs)：绑定 operationId、launchId、脚本 SHA、PID 和 OS 创建身份。业务期限 240 秒；超时即禁止继续派发，最多再作 60 秒只读观察。超时、迟到结果、实际 exit 事件和期限届满各写新文件，不覆盖原超时。迟到退出码 0 也不升级 unknown。句柄清理异常另记，不替换首错。
- [原探测入口](../scripts/probes/library-placeholder-clear-native.py)和[启动器](../scripts/probes/library-placeholder-clear-launch.mjs)接入上述记录。没有重跑 prepare，也未改变清除、保存或工程守卫语义。原 `__name__` 条件仍保留，并新增未选择业务入口时的记录。
- [无工程脚本](../scripts/probes/native-startup-smoke.py)只导入 `scriptengine.system`；[一次启动器](../scripts/probes/native-startup-launch.mjs)使用原登记目录及现有 Store 租约机制，不取得封存工程的源文件锁。

| 验证集 | 结果及归属 |
| --- | --- |
| [退出观察及清理](../scripts/probes/test-probe-exit-observer.mjs) | 最终 19/19；覆盖迟到／非零／信号／缺失退出、PID／创建身份／launch／脚本不符、结果读取及证据发布失败、清理保留首错。首次 15/17 的两项失败是测试将字符串传给 assert.match 的 RegExp 参数；原日志保留。中间 17/17 单列，不相加。 |
| [入口记录](../scripts/probes/test_probe_startup_trace.py) | 11/11；覆盖最早入口、原生模块及项目辅助导入失败、中文结果、发布失败、原始异常保留、主线程往返、退出请求与退出回执区别、无工程调用静态边界。 |
| 原清除守卫 | 30/30 相关回归；业务守卫未改，不代表真实清除成功。 |
| [旧启动器离线复现](../scripts/probes/reproduce-startup-evidence-gap.mjs) | 生产片段的超时后缺少迟到退出记录已复现；不证明原进程实际正常退出。 |

Python 解析与 Node 语法检查通过。没有重跑产品全量回归或工程测试。测试输入及实际脚本指纹随本轮记录归档。

## 唯一一次无工程实测

本机时间 **10:24:39–10:24:49**，InoProShop `1.9.1.6`：

| 项目 | 实际证据 |
| --- | --- |
| operationId / launchId | `6f72f357-ee12-4c1a-a307-bdd9b68e41c2` / `69d2d2a2-204e-47ed-945b-8073026d565c` |
| 进程实例 | PID `38824`；UTC ticks `639309974797453484`，原生进程内与外部 OS 查询一致 |
| 启动入口 | `D:\InProShop\CODESYS\Common\InoProShop.exe`，工作目录同目录；`--profile="InoProShop(V1.9.1.6)"`、`--runscript="<本轮绝对脚本路径>"`，正常脚本入口及既有参数；没有新增 UI 自动确认或执行策略参数 |
| 脚本 SHA-256 | `15d71db3758f2907bb8aec5da1114e86d060b290fc38c004100e48abf9fcd962` |
| 最早入口 | `startup-bootstrap-entered.txt`、`startup-entry.json`；本次 `__name__` 实读为 `__main__` |
| 主线程与发布 | necessary-modules-complete → primary-thread-entered／returned → result-publication-complete → exit-requested |
| 中文结果 | `无工程启动取证：主线程往返完成。`；原生发布后读回及外部 JSON 读取一致 |
| 结果 SHA-256 | `663ebcdbc581df903d19e26fe117ad1fa2e6d1f0e169f80f5396bc01d4254706` |
| 可信退出 | 外部子进程 exit 事件 **code 0、signal null**，绑定同一 launch／PID／创建身份；启动器退出码也是 0，无业务超时 |

本次要求的链路没有缺失阶段。`system.exit()` 后没有 exit-call-returned 文件，外部 OS 退出回执独立证明退出，不能把 exit-requested 单独视为完成。没有验证工程辅助模块在真实工程任务中的加载或运行；其失败取证只作离线验证。

启动路径、工作目录、profile 和参数形式与已有成功操作 `26d59261-4114-48c9-9597-d45d344bf4cf` 对照一致；新脚本和诊断输出路径、显式 trace 环境项另列。未输出完整继承环境或凭证。本次 `__name__=__main__` 不支持把原失败归因于名称守卫。

10:24 同时间窗 OEM 日志仍出现 `Program.IsDriveInstalled` 临时文件删除失败，随后出现驱动成功文字，但本次无工程脚本链路成功。该日志没有独立 PID 归属，不据此认定原失败根因或驱动安装实测结果；没有修改权限、驱动或执行策略。原失败的脚本进入、模块、提示／启动状态等原因仍未确认。

## 收尾、保全与复核入口

使用原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。开始前没有活动 IDE／Desktop／工程服务，MCP 无 running 或未隔离 unknown；五项历史 MCP unknown 均保留。原独立 unknown 继续单列，不等同于 MCP 操作，也未因本次无工程验证解冻。

现有 `Store.acquire()` 正式归档原 stale **服务租约**为 `service.lock.stale.a97428e5-6891-4fd2-93da-665dfcd8739c`，归档字节 SHA `28aca27846f52e9d0aec7c6c635f5057d1da472b0ab47e6f0d82e03486b642db` 与写前一致。本轮只取得服务租约，确认正常退出后通过 `Store.release()` 释放自己的租约；没有手工删锁、释放原工程锁或修改租约机制。结束时无活动相关进程、服务租约 absent。

**30,383 项历史路径记录、361 项固定构建文件指纹无变化**，原工程、整个原探测目录、原源锁、账本、IPC、检查点、隔离、配置均保全；MCP operations／IPC 文件集合未增加。正式 stale 归档及本轮服务租约生命周期单列，不能宣称整个登记目录完全未变。

收尾只读预检曾因把完整输出路径误作标签而 ENOENT，首次失败保留；只纠正该报表参数，未再次启动 IDE。没有清除、编译或保存，故无本轮编译错误／警告数。

本轮原始输出：`D:\InoPro-ProbeStartup-20261123-101352`。复核顺序：`validation-summary.json` → `launch-intent.json` → `startup-entry.json`／`startup-trace-*.json` → `startup-result.json` → `process-start.json`／`process-exit.json` → `startup-verification.json` → `preservation-after.json`／`lease-preservation.json`。ZIP 的 INDEX.md、MANIFEST.sha256.json 提供文件入口与逐文件校验。

原 unknown、默认环境 200ms 性能、历史崩溃根因、CmpLog、脚本信任、Desktop 和实际运行限制保留。后续工程／清除验证需要另行安排；本轮不继续准备或清除夹具，不合并、不部署。
