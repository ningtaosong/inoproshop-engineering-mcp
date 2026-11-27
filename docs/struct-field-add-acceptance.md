# 0.39.0 结构体字段新增：离线通过，真实验收在准备阶段停止

受验实现 `42bd55b0b5f44ee74112d1bd90ef45235f472aed`，基线 main `55bb58fc97b266215ad536b6b0f9d4f66c80670f`，功能分支 `codex/struct-field-add`。产品候选 0.39.0／38 项工具，未合并或部署。[限定实现与保护](struct-field-add.md)仍须完成独立 MCP 正式新增及一次 CLI 验收，当前不能报告为已验证的产品工程闭环。

## 离线与契约

完整 Node **1290/1290** 来自四组不重叠测试文件及独立临时目录；Python **665/665** 单独记录，均归属上述实现提交。此前定向91/91、契约6/6和生产桥接各次4/4按原时点保存，不与完整计数相加。首次默认临时目录定向82项中68通过、14失败：新增测试错误地期待后续写入返回unknown，生产路径实际抛出 `PENDING_UNKNOWN`；已改为断言抛错，保留首败。该目录运行缓慢，独立TEMP通过不消除默认环境历史200ms性能问题。

固定构建 `D:\InoPro-StructFieldAdd-20261125\fixed` 来自实现提交的 `git archive`，构建、类型检查、本机 IronPython 2.7.7.0 对完整桥接的 Compile-only 均通过。固定初始化正文含客户端标题实测 **64,973／65,536字节**。开发工作区换行计数不同，不混用。

其他37项工具输入Schema及全部38项输出Schema保持。`variable_edit`明确新增动作；initializer从全局必填改为按动作校验，新动作禁止传入、旧动作仍必需。旧动作语义和原保护不变，不能称全部38项输入Schema逐字不变。

## 本轮实际工程步骤

原生准备工程：`D:\InoPro-StructFieldAdd-20261125\mcp-project\AM610_StructField.project`。从新路径 `project_create` 创建，未复制任何旧工程；随后创建 `ST_Config`、`GVL_Struct`，准备PLC_PRG实例访问，再执行准备版编译。任务、源码的完整验收基线尚未采齐。

| 阶段 | 实际结果 |
| --- | --- |
| 准备原生操作 | 8项；前7项取得可信正常退出，第8项保存操作unknown |
| 准备编译 | 1次，buildPassed=true、诊断完整，0错误／0警告 |
| 准备显式project_save | 1次；桥接发布保存关闭重开读回，但整体退出无法确认 |
| 新动作正式派发 | **0次** |
| 正式编译／保存版复编 | **未执行**；不填写错误或警告数 |
| 第二份CLI工程 | 未创建 |
| DSH CLI模型任务 | **0次**；仅准备临时配置及dump-config预检 |

准备编译适用磁盘哈希为 `3623ef6d107ec8834bb4d4da64948d9e584d30fa613a60c6918e5e7cc2ba354a`。停止时工程哈希为 `e8411a3bdb4e19db3b461de344b15dd84431defae599cf8d7a89c9840fb5e547`，已与准备编译文件不同；不能把准备编译写成当前保存文件已编译通过。主文件、projectbackup及两份opt附属文件指纹已保存；首次创建前目录不存在，本轮没有伪造额外前态。

## 停止证据和现场

操作 `1a422703-1f36-492a-9789-c6bb649c7d64`，requestId `ff3eb2af-d66e-4c27-939f-f1384730f799`，launchId `9d52d7ce-03e4-4958-9a81-24c465a01688`，IDE PID60144、创建身份 `639311673817743400`。按原IPC时间（UTC）：

- 01:36:21.772 记录process-start。
- 01:36:36.693 桥接发布succeeded，内容为已保存、关闭、重开。
- 01:36:36.758 记录正常关闭调用返回标记；它不等于进程已经退出。
- 01:38:23.479 服务记录 `unknown / IDE_TIMEOUT`；随后仅查询该原操作取得终态，没有reconcile或重派发。
- 客户端关闭时已发送EOF，15秒内未确认服务退出，记录原始 `EOF exit unconfirmed; no kill`；启动器以1退出。
- 后续只读观察时IDE和服务PID均已消失，但 `process-exit.json` 仍缺失，服务退出码也未取得。未知终态保持，不补造正常退出、不自动升级为成功。

首个业务不确定原因是期限内缺少进程退出；验收器另记录退出核对断言，收尾另记录EOF超时，三者分别保存。没有证据将其认定为新增字段实现错误、原崩溃根因或某一OEM调用的唯一因果结论。本轮停止在准备保存，尚未执行新动作。

事前保全57,895项既有材料。停止后逐文件核对中，除允许路径内的registry.json和service.lock之外，历史操作、IPC、检查点等材料没有字节变化。此处“允许路径”是检查规则，不是已完成登记内容逐字段核验：没有留存事前registry全文，不能证明其中全部旧登记字段未变；session.json此次没有变化。原stale租约字节已在正式机制生成的归档中核对一致。新增账本与IPC属于本轮，不称整个登记目录不变。最后观察无IDE、Desktop或工程服务，租约stale未清理，本次未隔离unknown继续阻断后续派发。旧unknown／隔离／锁／账本不恢复、不手工清理。

另保留本地摘要脚本首次使用默认GBK读取UTF-8日志的失败；仅改摘要读取编码，没有重放工程步骤。日常DSH、Codex配置及0.38固定入口均保持。临时CLI模板已核对已验账号依赖、原登记目录、64,973字节指令和候选入口；未发送业务任务，不代表CLI模型接收新动作。

## 下一次真实复验前提

2026-11-25追加[本次退出缺口的只读诊断](struct-field-save-exit-diagnosis.md)：已核对超时后同一IDE仍在运行，EOF不等于服务shutdown，后续退出码及先后顺序仍缺证。本次unknown不改判；诊断没有启动工程或修改退出设施。

随后另经授权进行[退出观察与命令行收尾的离线补修](exit-observation-maintenance.md)。该补修没有重放本次工程、隔离或模型任务；本页原停止结果不变，新的真实验收仍待另行安排。

先独立核对本次unknown及退出缺口；若需隔离，必须通过正式维护计划和明确授权。本轮不修复退出设施、不提交隔离、不重开该工程、不换工程或数据目录绕过。排他和保护条件明确满足后，再另行安排准备成功、三种字段的真实MCP及一次CLI闭环；不能把离线替身结果或准备编译替代这些证据。

本轮证据根目录：`D:\InoPro-StructFieldAdd-20261125`。入口为 `blocked-audit.json`、`prepare/transcript.json`、`prepare/calls/11-result.json`、`prepare/exit-verdicts.json`、`evidence/launcher-exit-observation.json`、`history-after-stop.json`、`offline/validation-summary.json` 和 `fixed-check.json`。交付包另提供原始本轮IPC与逐文件清单，不含私人配置或历史账本全文。

默认性能、历史unknown、崩溃根因、CmpLog、脚本信任、Desktop最终日常连接和PLC运行等原边界保持。S4b未全部完成。
