# 0.34.2 合并复核与固定入口

本次将 `codex/operation-reconcile-exit-guard` 的完整祖先链正常合并 main，保持 0.34.2 候选版、37 项工具。复核起点 main 为 `5b3e5b06580c1ee6a981f4a3fafa46c767bc7513`，受验功能分支为 `71e341016e5b23a4cdf729eaebe618be11ff9f47`。本次只补收尾说明，不改变受验产品、桥接、Schema 或初始化指令，不启动后续功能。

## 纳入的两部分修复

- `bd10bbfd47b34da8ab3c6a0c58d2e4aa441ce19c`：0.34.1 task_create 按可信唯一 taskId 核对无顺序语义的任务集合，保留任务数量、集合、归属、全部已读字段及覆盖要求。任务内部调用顺序、备注和绑定继续严格核对；原始枚举顺序留证。创建后旧任务保全和重开整体清单都适用，实际比较快照在异常前发布。
- `2f6285c4937f1c274bc1ff4a3d7d36f1d5644f91`：0.34.2 对正式隔离操作仅观察；相同终态证据不刷新 finishedAt；真实迟到结果仍按既有规则核对。原请求、launchId、PID 和进程创建身份绑定的退出证据参与终态判定，成功文件不能覆盖异常/不明退出。
- `dbb3e2bf6e3c38ce84722638c63fcbda791ab528` 与 `71e341016e5b23a4cdf729eaebe618be11ff9f47` 的离线及只读复验记录保留原提交归属。没有只摘取最后文档或退出保护而遗漏 task_create 补修。

原 main 的 37 项输入、输出 Schema 与候选一致；Schema 文档只更新 serverVersion。初始化正文保持。内部退出凭据及账本可选 launchId 不要求用户填写，也不提供新的 MCP 工具。

## 验证归属

| 证据 | 实际覆盖与限制 |
| --- | --- |
| 最终离线 Node 567/567 | 四组独立 TEMP/TMP：133、156、163、115，65 个测试文件不重叠且完整；不与定向计数相加 |
| Python 248/248 | 独立记录；不并入 Node 计数 |
| 六次正式隔离查询 | 三项操作各普通/reconcile 一次，原 unknown 和完成时间保持，查询阶段 1,533 项材料无字节变化，无 IDE 派发 |
| 四次真实只读操作 | 开发端和 CLI 各 project_open、task_inspect 一次，真实进程正常退出凭据与请求和文件对应；没有重新验证写入 |
| 唯一一次 CLI 任务 | 同次原生会话 request/header 证实实际送给模型 37 项工具；环境查询返回 0.34.2，实际只读调用完成 |
| CLI 协议日志缺口 | 漏建观察目录，原始 initialize/tools/list 包未保留；不能用独立 SDK、会话头或本次部署初始化冒充该历史协议日志 |
| 后续正常只读登记 | 新增四份账本，登记 revision 1305→1309，并更新租约；不能说整个数据目录未变 |
| 0.34.1 原写入复验 | task_create、写入、编译和保存证据仍属于原固定产品/原操作；原 CLI 综合验收失败不改判 |

原真实复验 ZIP：

`D:\InoPro\deliveries\InoPro-review-20261120-163426.zip`

SHA-256：`df065cbf79ae8a8a6fb936f6ae9c938c8cd2ea7cdf9910ffcfe7e0f555b7c6fc`。

本次复核其可读取性、清单和逐文件哈希。复用既有全量及成功真实验收，不重跑工程、模型或全量回归。合并提交、双父关系、远端、产品树及本次必要构建/类型/链接/指令检查的实际结果，见本地交付记录。

## 固定入口与连接证据

从实际 main 合并结果准备独立固定构建；源文件和编译产物分别与受验固定构建比较。仅在产品一致、版本和契约核对通过后更新入口。指令仍按客户端含标题的 UTF-8 口径检查，保持 maxInstructionBytes=65536，不扩大上限。

日常配置只更新 `mcp-inoproshop` 的服务入口与工作目录，备份当前配置，保留旧 0.34.0 构建、原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`、账号、其他插件及 Codex 配置。实际配置差异、备份位置和构建路径由交付记录提供，不提交私人配置。

没有 Desktop 或工程服务占用时，只做离线配置更新，不启动 Desktop。可以在无并行服务时做一次独立 stdio initialize/tools/list，不调用工程工具、不查询或 reconcile 历史 unknown。独立连接证据与最终日常连接分开报告；未启动 Desktop 时，日常连接待验证，不为补证重启或诊断欢迎页。

本次记录入口：`D:\InoPro-0342-Merge-20261120-164436\REVIEW.md`。其中分别列出 main 合并推送、固定构建、配置更新、独立初始化、日常连接五项实际状态，以及复核 ZIP 和 SHA-256。

## 保留的限制

不恢复三份曾被改写的历史账本，不改变任何历史 unknown、隔离、锁或封存工程，不手工清理 stale 租约。正常退出正例不代表 IDE 崩溃根因已解决，有限只读任务遵循不代表任务级强制停止保证。

默认环境 200 ms 性能失败、CmpLog、脚本信任、Desktop 欢迎页及运行验证限制均保留。task_call_append／task_call_replace 的任务集合顺序风险仍是独立待办，本次不修改。原综合验收失败不改判；未观测实际 PLC 调度、完整设备/I/O、桌面交互或链接点击。不发布 Release，不更新文章。

- [task_create 清单补修](task-create-inventory-order.md)
- [0.34.1 原真实复验](task-create-revalidation-0341.md)
- [0.34.2 保护实现与离线验证](operation-reconcile-exit-guard.md)
- [最小真实只读复验](operation-guard-readonly-revalidation-0342.md)
