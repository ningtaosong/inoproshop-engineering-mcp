# 0.34.3 离线试用接入确认（2026-11-21）

同事从[简明试用指南](getting-started.md)开始；[headless 增量模板](../config/dsh.headless-trial.example.patch.yml)无凭证，填写本机已核实路径并与现有配置按 id 合并。本轮只做一次模型环境查询及文档整理，不执行指南中的三个工程示例。

## 版本与边界

- 基线及固定构建来源：0a927d85768122bf5906910b0fb517c0cf22a5b3，0.34.3 修复候选版、37 项工具。
- 固定入口：D:\InoPro-Fixed\0.34.3-0a927d857681\dist\server.js。
- 原登记目录：D:\InoPro\.local\dsh-phase4-repair-20261028-A1。
- 固定源码 288 项及 dist 58 项与[合并记录](task-inventory-0343-merge.md)指纹逐项一致。没有重建或部署，也没有重跑回归。
- 本机 Node v24.15.0；安装版 DSH 文件版本 0.2.1-rc.5。复用已有 headless／deepseek-account／deepseek-flash 配置，credentials、authorization、deepseek-account 均启用。
- 最终合成配置仅一个目标 MCP、无其他执行工具；上限 65,536，正文 63,009、按客户端加标题后 63,036 UTF-8 字节。合成预检不发送模型任务。
- 日常 DSH 仍指向该固定版本，配置字节未改。0.34.2 回退构建保留。Codex 全局无 InoProShop 条目；已查项目级历史 0.16.0 配置仍启用，0.14.0／0.15.0 停用；未升级或启动 Codex，不推定其当前运行时加载版本。

## 唯一任务与同连接证据

> 请仅调用一次 InoProShop 的 environment_inspect，报告实际服务版本。不要打开或读取工程，不查询历史操作，不编译、保存、修改或连接 PLC。

会话 session-bc4405df-bc32-4337-99af-c3abc35b917e；正式连接 11728-55938390-a03a-489b-820c-49c593859daf。下列三项来自该连接及该会话，不使用发现子进程拼接：

| 核对项 | 实际结果 |
| --- | --- |
| initialize | serverVersion 0.34.3 |
| tools/list | 37 项唯一名称、无续页；完整名称及 Schema 指纹在复核包 review/result.json |
| 模型调用 | 一次 mcp__inoproshop__environment_inspect，输入 {}，结果 succeeded／0.34.3 |
| 工程操作 | 0；无历史查询、编译、保存、修改或 PLC 调用 |
| 收尾 | CLI 退出码 0，正式服务退出码 0；事后未发现 Desktop、IDE 或工程服务 |

本轮沿用已验证且内容未改的独立日志观察器，预先确认日志目录存在且可写。日志保留请求方法、连接、工具名称、结果及指纹等脱敏元数据，**不是完整原始 JSON-RPC 报文**。没有证据证明指令全文进入模型上下文，也没有 Desktop 最终日常连接、界面或链接点击证据。

独立发现进程 PID 4952 的 server/discover 返回 -32601，保留首次记录；它与正式 PID 11728 不同。未取得发现进程退出事件，事后进程检查已不在；不补写其退出码。正式初始化、清单及模型调用成功，不为补日志重发任务。

## 原答复与限制

原答复在复核包 review/original-answer.md；完整环境结果在 review/environment-result.json。答复正确报告 0.34.3，并保留能力审计未验证项：

- IDE 已安装、Profile 存在。
- scriptLaunch、projectRead、projectWrite、build、saveReopen 均为 unverified，原因为“当前可执行文件/Profile 与已有证据未匹配”。
- 这不是本次工程验收，本轮也未修正审计匹配。既有工程正例继续按原产品提交归属，不能由本次环境查询覆盖。
- 展示勘误：原答复的“客户端环境 InoProShop(V1.9.1.6)”实际为 IDE Profile 名；DSH 客户端版本另行取证。

接入、限定流程和版本答复通过；未验证工程修改能力、37 项工具的全量行为、Desktop 或运行效果。历史 unknown、隔离、CmpLog、脚本信任、默认环境 200 ms 性能、IDE 崩溃根因及欢迎页故障均保留。

## 保全与复核入口

本轮首次任务前无活动工程服务／IDE、无未隔离在办操作，租约文件不存在。5 项历史 unknown 均有正式隔离归属；只读预检，没有通过 MCP 查询或 reconcile 历史操作。事后 27,663 项历史保全路径字节未变，操作账本文件名及 IPC 目录集合未增减；旧 0.34.2 构建 336 项指纹未变。日常 DSH 与 Codex 全局配置字节保持，已查项目配置未编辑。未创建或清理历史锁。

本地原始工作目录：D:\InoPro-OfflineTrial-0343-20261121-170956。复核包入口 INDEX.md；主要记录为：

- checks：Git／固定构建关系、文档／模板检查、前后保全摘要。
- cli/config-preflight.json：合成配置的脱敏检查，不含私人配置或凭证。
- cli/cli-task.txt、cli/cli-exit.json、traces/*.jsonl：唯一任务、退出及分进程元数据。
- review/cli-events.jsonl、result.json、environment-result.json、original-answer.md：模型真实调用、结果和原答复。只去除 thinking 事件，工具及答复原文保留。
- 私人 patch、合成配置和完整私人会话均不入库或入包。

指南精简前的正文原样保存于[历史使用说明](getting-started-history.md)，旧结论不改写。公开模板仅作离线解析和结构检查，本次真实 CLI 使用的是复用的私人配置。产品、桥接、Schema、初始化指令、日常入口与版本未变；本分支不合并 main。
