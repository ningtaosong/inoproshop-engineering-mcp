# 0.34.2：隔离操作观察保护与 IDE 退出证据

本补修在 `codex/operation-reconcile-exit-guard` 开发，基于 `c9ea1a6f4086c97f4a7ccb1addb27e8601b55faf`，包含 0.34.1 的 task_create 任务集合比较补修（实现 `bd10bbfd47b34da8ab3c6a0c58d2e4aa441ce19c`）。不是从 main 单独摘取的两处改动。保留原候选分支，不合并、不部署。

## 原问题及证据边界

[0.34.1 真实复验记录](task-create-revalidation-0341.md)及原复核包 `D:\InoPro\deliveries\InoPro-review-20261120-151015.zip`（SHA-256 `5dec7901ebe71a852c6f29868e45b72b0981141aec5300325bd396593861ffeb`）继续有效。

- 已隔离的历史 unknown 仍可经 operation_status(reconcile=true) 进入 adapter.reconcile 和 finish。7247cab3-…、78715c58-… 的两份前后原文确认仅 finishedAt 和 checksum 改变。b7c438ed-… 只有前后指纹及事后原文，不能推断变化范围相同。
- task_inspect `427069dd-21a4-4597-b0aa-e4f477ce6f1c` 发布 succeeded 后，其 IDE PID 41248（2026-11-20 15:01:30.506851 创建）以 `3221226525 / 0xC000041D` 退出。归档阶段、结果、Windows 事件及进程观察相互对应。Font.GetHeight / ThreadExceptionDialog 栈不是已经证实的最初异常根因，本补修不改字体或 GUI。
- 已发生的 task_create 保存及真实正向证据保留。原 CLI 整轮失败仍为失败。本轮没有修复真实历史账本，也没有重开任何验收工程。

离线复现使用原 unknown 响应及原 task_inspect JSON，通过旧固定 0.34.1 与本分支的生产 finish / IdeAdapter 路径。进程是替身，工程文件是无业务内容的测试文件；路径、磁盘哈希和新的请求绑定明确替换，原任务清单、调用、PROGRAM 证据和原生状态保留。旧版刷新完成时间并接受成功文件＋异常退出，新版不刷新相同终态，并返回 unknown。

## 服务端隔离保护

普通查询及 reconcile=true 均先读取正式隔离账本、原操作绑定、提交日志和全局锚点，按原 operationId 归属判断；requestId 查询须唯一。记录缺失、损坏或归属不一致时拒绝核对，不根据名称或当前活动工程猜测。

已正式隔离的操作只返回原记录，不取得工程租约、不进入适配器、不修改操作/IPC/检查点/登记/隔离记录、不启动 IDE。请求去重也走同一观察入口。

核对未隔离操作前取得既有服务排他租约；取得后、进入适配器前和 finish 前再次确认隔离状态。正式维护提交同样受维护 gate 和服务租约约束，覆盖首次检查后的并发提交窗口。不新增全局锁或永久冻结机制。

相同终态响应重复核对时不更新 finishedAt，不重写操作账本。未隔离操作的真实迟到结果仍可核对；只有证据完成变化才提交新结果。清除持久化故障状态时排除已正式隔离的历史 unknown，其他未决操作仍阻止派发；隔离不等于全局禁止无关工程。

## 退出证据与状态

服务为每次原生进程启动建立独立 launchId，绑定 operationId、requestId、原请求指纹及 request.json 哈希。`process-start.json` 保存 PID 和 OS 创建身份；`process-exit.json` 保存实际 code、signal、观察时间、启动证据哈希及原结果/派发文件哈希。两份记录有内容校验值。创建身份未能在进程存活期间确认时保留 unconfirmed，不以 PID 存在或结果文件代替。

| 实际证据 | 判定 |
| --- | --- |
| 绑定一致、退出码 0、无信号、原结果和派发/文件证据完整 | 继续原有结果、版本、只读哈希及保存证据校验；不是无条件成功 |
| 已派发后非零退出或信号退出 | unknown / IDE_ABNORMAL_EXIT，保留原生结果和现场 |
| 创建身份、退出状态、归属或证据缺失/损坏 | unknown；不能从成功结果文件升级 |
| 超时仍可能运行 | IDE_TIMEOUT；不 kill、不重放，继续留存原进程最终退出证据；等待显式核对 |
| 原进程身份仍在且无退出回执 | 继续报告原进程存在，不认定完成 |
| 确认已结束但已派发、结果缺失 | unknown / RESULT_MISSING |
| 确认未启动或已结束，且未发布派发标记、无结果 | failed / NOT_DISPATCHED；桥接在访问工程前必须发布标记 |
| 证据发布失败 | unknown；保留发布异常及已取得的原始结果/退出观察 |

重启 reconcile 使用同样退出规则。不会信任旧 observed-after-exit 的成功缓存来绕过退出证据；结果或派发文件在退出取证后变化也拒绝。已读数据、原生异常、清理异常和阶段文件继续保留，服务不会反向操作或恢复性保存。

历史记录没有新字段时仍可读，已有 succeeded 不批量改判，unknown 不批量迁移。显式核对缺少可确认退出证据的历史未隔离请求只报告缺证；不会补造 code=0。正式隔离记录始终只观察。

## 兼容性与验证归属

0.34.2 候选版、37 项工具。全部输入/输出 Schema 保持；初始化指令正文保持。内部 IPC 新增退出证据，操作账本 bridge.launchId 为可选字段，不要求用户填写。FixtureAdapter 仍是离线替身，不可当作实际 OS 退出证据。

最终测试、契约指纹、指令字节数及提交归属见本次复核包 REVIEW.md / validation.json。定向与完整计数分别记录，不相加。默认环境 200 ms 历史性能失败单列，未降低阈值或清理历史目录。

原 Python/原生桥接未改。本轮仅运行构建、类型检查、替身/归档复现与离线回归，没有启动真实 IDE、实际工程服务或模型业务任务，没有改日常 DSH/Codex 配置及固定入口。

## 后续真实复验条件与未解决事项

待本补修复核后，按正式排他和隔离规则另行安排独立真实验证：正常退出 receipts 与相应 operation/request/进程创建身份一致；实际 IDE 异常终态不能被成功文件覆盖；已有隔离查询无副作用。不得重放或复制封存工程绕过冻结。

本轮不宣称 IDE 崩溃根因已修复、历史账本已恢复、综合验收已通过，或模型遇到任意冲突会强制停止。task_call_append / task_call_replace 的任务集合顺序风险仍待独立评估。默认环境性能、历史 MCP unknown 和独立探测 unknown、隔离与锁、CmpLog、脚本信任、Desktop 欢迎页、最终日常握手及实际运行/设备 I/O 边界均保留。

- [0.34.1 task_create 补修](task-create-inventory-order.md)
- [原真实复验及首败](task-create-revalidation-0341.md)
