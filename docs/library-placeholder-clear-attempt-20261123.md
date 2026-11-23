# 新独立夹具清除探测：准备启动停止（2026-11-23）

后续说明：[两份归档脚本的 IronPython 解析缺陷已确认](library-placeholder-ironpython-compatibility.md)，修复后的辅助加载已由新的无工程操作验证。该事后证据不补填本页 prepare 的入口、结果或退出，不改变本页 unknown。

本轮从 `8936b80387e948c71bd031ad0f16a04f440bc2af` 继续，只使用一份新夹具，未重放旧 prepare。**结论仍为②：目前仅适合只读评估，清除及保存持久化未验。** 新 prepare 在 240 秒业务期限内没有脚本入口或结果，随后 60 秒只读观察也没有迟到结果或退出回执，记录为独立 unknown 并停止。

产品保持 0.36.0 候选版、37 项工具；没有产品、Schema、初始化指令、固定构建或 DSH／Codex 配置变化。没有 DSH CLI 模型任务、Desktop、鼠标键盘操作、PLC 连接或运行。

## 本轮范围、版本和脚本

开始时当前分支及远端均为 `8936b80387e948c71bd031ad0f16a04f440bc2af`，main 为 `da87ac1d553a3a009a5bdb170b47a370924a0d3a`，工作区干净。读取原接口依据、[首次未知记录](library-placeholder-clear-probe.md)及[无工程启动验证](library-placeholder-startup-evidence.md)，不把上轮无工程成功扩大为项目辅助模块已通过。

本轮仅补充独立脚本的辅助模块指纹校验、实际启动参数、编译派发／返回计数、保存前磁盘复查和首错发布保护。没有修改清除守卫或放宽比较；顶层任务／PROGRAM 目录继续复用已验的唯一身份比较视图，任务内部调用及已读字段仍严格核对。

- [原生脚本](../scripts/probes/library-placeholder-clear-native.py)：加载 guard、固定 worker、library_reference 和记录器前校验指纹；分别记录 guard、worker、完整辅助模块加载。计数在实际编译调用前增加，正常返回后另记完成计数。
- [启动器](../scripts/probes/library-placeholder-clear-launch.mjs)：prepare → baseline → clear → verify 严格串行，后续阶段必须前一阶段结果及可信退出都成功；每次独立进程绑定脚本／辅助模块／EXE 指纹、operationId、launchId、PID 和创建身份。每次 240 秒业务期限加最多 60 秒只读退出观察，超时不升级成功。
- 原公开清除入口仍限定 `set_redirection(None)`；未尝试空串、其他版本、删除重建或私有写接口。旧来源、系统、重复身份、完整枚举、保存重开等规则保持。

相关离线验证分别为：清除守卫 **30/30**、启动记录 **12/12**、退出观察 **19/19**；不相加，不代表真实工程通过。新增用例确认辅助模块指纹变化在导入／派发前停止。Python 解析、Node 语法检查通过；没有产品全量回归。

## 唯一新夹具及实际执行

新现场（已保留为 unknown，不能继续重开或重放）：

`D:\InoPro-PlaceholderClear-20261123-104306\engineering\AM610_PlaceholderClear.project`

来源为已核实归档 `D:\InoPro\deliveries\InoPro-review-20261109-132658.zip` 的唯一成员 `projects/AM610_Minimal_MCP.project`。归档 SHA-256 为 `c67abad48bef4bc410d72020d89f1452772f04a007f4622e490c90e815d597f0`。仅复制该中性种子作为测试准备，没有复制原 unknown 工程，不改变产品直接编辑指定工程的默认流程。

| 本机时间／字段 | 实际记录 |
| --- | --- |
| 10:43 后预检 | 没有活动 IDE、Desktop 或工程服务；MCP 无 running／未隔离 unknown；服务租约 absent。 |
| 本轮 operationId | `cef2a565-4b8e-432c-a9b3-d398e5ae4ef3`，不是原独立操作或任何 MCP 历史操作。 |
| launchId | `e466d1d4-036b-474a-a8c2-bb409f6a1481` |
| 10:46:52 | 仅一次 prepare 启动。PID `12740`，OS 创建身份 UTC ticks `639309988121053559`。 |
| 脚本 SHA-256 | `6fa04c98781436b4dcb4cf84786355a6966c7e12074db3298cd268818c0defce`；实际脚本字节及全部辅助指纹归档。 |
| 10:46:55 | stdout 只有 `AddedToUI`，stderr 为空。 |
| 10:50:52 | `prepare-business-timeout.json` 保留首个错误 BusinessTimeout；禁止后续派发。 |
| 10:51:52 | `prepare-exit-observation-expired.json`：resultObserved=false、exitObserved=false；`prepare-observation-complete.json` 仍为 unknown。启动器以退出码 1 停止。 |
| 之后的只读收尾 | PID 已不存在，无相关活动进程；服务及本夹具源锁的 owner 为 stale。没有原生退出码、退出信号或正常关闭证明，不能由进程消失改判。 |

最后确认阶段为原生进程启动及 stdout；**首个缺失阶段是最早脚本入口**。没有 `prepare-bootstrap-entered.txt`、`prepare-entry.json`、模块加载阶段、工程读回、原生库目录、占位符身份或准备结果。因此不能声称项目辅助模块实测通过，也没有证据将停点定位到具体模块。

本机启动入口、profile、工作目录及参数形式沿用此前已验方式，没有改变权限、驱动、全局执行策略、提示自动确认或加入 Bypass。OEM 同时间窗仍出现 `Program.IsDriveInstalled` 临时文件删除失败；成功的无工程启动也曾出现同类日志，且这些日志没有独立 PID 归属，因果关系仍未确认。

## 各阶段结论

| 项目 | 本轮实际结果 |
| --- | --- |
| 原生目录确认两个精确版本 | 未取得；`CAA Mathematics` 的 3.5.11.0 默认版本、3.5.7.0 覆盖版本仍只是该脚本的待核实候选，未猜测替代。 |
| 创建占位符、准备显式覆盖及保存 | 未确认；不能凭磁盘未变把准备写入或保存次数补成 0。 |
| 准备版独立重开／基线编译 | 未派发。 |
| 正式清除 `set_redirection(None)` | **0 次**；clear 模式未启动。覆盖是否消失、默认是否回退均未取得证据。 |
| 正式保存及独立重开 | **0 次**；后续阶段均停止。 |
| 基线／清除后／保存版编译 | 均未执行，不填写错误／警告数，也不存在本轮“0 错误、0 警告”编译结论。 |
| 原生可信退出 | 未取得；不能使用启动器退出码 1 替代 IDE 退出证据。 |

前后工程主文件均为 SHA-256：

`89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`

engineering 目录在两次采集中都只有该主文件；内容、大小、修改时间相同，附属文件差异为空。这不能证明正常关闭或内存未变化。

## 历史保全和后续前提

原独立 `96060196-cd1b-4a03-97ed-92e6785d5350` 及封存工程保持原 unknown，未重开、改判、补造回执或恢复。本次新的 unknown 单列，不能用旧无工程成功解释为已成功准备。

沿用真实登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。现有 Store 机制正常取得本轮服务租约及新夹具源锁；因终态不明，没有释放它们。没有手工改租约、删除锁、换数据目录或执行历史 reconcile。当前五项正式隔离的历史 MCP unknown 未改，MCP operations／IPC 文件集合没有新增。**30,542 项历史路径记录与 361 项固定构建文件指纹无变化**；本轮新租约／源锁另列，不能宣称整个数据目录未变。

本轮到此结束，不换夹具、改参数或重放 prepare。后续须先按正式机制核清新 unknown 和排他条件，再取得实际工程入口、模块加载及正常退出的明确证据；不能继续清除或补保存来消除本次缺口。完整库目标、清除、默认回退、保存重开和保存版编译仍缺证，不具备本轮所要求的产品化正向依据。

原 unknown、默认环境 200ms 性能、历史崩溃根因、CmpLog、脚本信任、Desktop 和实际运行边界保留。

本轮原始目录：`D:\InoPro-PlaceholderClear-20261123-104306`。从 `result-summary.json` 开始，依次查看 prepare-intent／process-start／business-timeout／exit-observation-expired／observation-complete、probe-stopped、final-observation、fixture-file-differences 和 preservation-after；复核包 `INDEX.md` 与逐文件 SHA-256 清单提供入口。旧归档不覆盖。
