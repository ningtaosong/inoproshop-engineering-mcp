# 0.37.0 占位符覆盖清除：实现及验收归属

2026-11-23，功能分支 `codex/library-placeholder-clear`。产品受验提交 `f944b55339e65acce1a1f1fd2f6ef72e6c1e26f7`，基于 main `da87ac1d553a3a009a5bdb170b47a370924a0d3a`。0.37.0 候选版、38 项工具；本段保留原验收时尚未合并、未永久部署的归属。后续[合并与固定入口收尾](library-placeholder-clear-0370-merge.md)不重放本轮任务。原生探测收尾提交 `7c700dc77783354816570a129b631a3b785227c2` 独立保留。

## 结论和范围

真实 MCP 与唯一一次 DSH CLI 的限定工程闭环均通过。两者各清除一次应用显式覆盖，保留同一占位符、默认声明和命名空间；即时及保存重开均为原生 `explicit_redirection=null`、`is_redirected=false`，实际有效解析为 `CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)`，来源原文为“设备解析”。这些是实际读回，不是产品对任意工程默认回退的保证，也不是独立库加载或 PLC 运行证据。

范围仍为本机 InoProShop 1.9.1.6、AM610 `4102 / 10f4 0002 / 3.5.11.11`，普通非系统、非托管 CAA Mathematics，默认 3.5.11.0、原覆盖 3.5.7.0、命名空间 MATH。原 `library_placeholder_resolve` 不变。无显式覆盖写前拒绝；不删除引用、卸载库、修改默认声明或主动加载。声明合法不保证有效解析或依赖完整。

## 准备与正式执行分别计数

两份夹具均来自同一核实中性种子：`InoPro-review-20261109-132658.zip` 内 `projects/AM610_Minimal_MCP.project`，种子 SHA-256 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。仅测试准备复制，不改变产品直接编辑指定文件的流程。

| 项目 | MCP | CLI |
| --- | --- | --- |
| 新夹具目录 | `D:\InoPro-PlaceholderClear-20261123-170201` | `D:\InoPro-PlaceholderClear-20261123-170202` |
| 准备阶段 | stabilize、stable、declare、normal、prepare、baseline | 同左 |
| 准备原生进程／保存／编译 | 6／3／5 | 6／3／5 |
| 准备编译诊断 | 五次各 0 错误、0 警告 | 五次各 0 错误、0 警告 |
| 准备变更 | 声明普通占位符一次，设置覆盖一次；公开加载一次；清除 0 次 | 同左 |
| 正式清除 | 1 次 `library_placeholder_clear` | 模型实际调用 1 次 `library_placeholder_clear` |
| 正式 IDE 操作 | 8 次，均有绑定请求和进程身份的正常退出 | 7 次，均有绑定请求和进程身份的正常退出 |
| 正式保存重开 | 清除工具内及随后 project_save 均通过 | 同左 |
| 正式编译 | 清除后一次，后续保存改变磁盘字节后必要复编一次；各 0 错误、0 警告 | 同左 |
| 最终读回 | 全库两页、任务及完整清除证据核对 | 模型全库两页；工具内部源码／任务保全核对 |

MCP 清除操作 `e79fedf2-48fb-4c51-9637-22c53313c479`；CLI 清除操作 `e8b0daeb-87f7-4b68-aeba-c5e5fd4e4693`。每项正式 IDE 操作均核对 operationId、requestId、requestFingerprint、launchId、PID、创建身份、process-start/exit、result；退出码均为 0、signal 为 null。缓存续页没有 IDE 派发，不能算成新进程。

完整 before/immediate/after 保留在操作记录与 IPC，桥接和服务端独立校验通过。目标仅四个 rawFields（explicit_redirection、is_redirected、effective_resolution、resolution_info）及相应派生版本改变；19 项引用均保留，其余引用、命名空间、已读源码与任务配置保全。任务集合和 PROGRAM 目录仅在比较视图按唯一身份对齐，调用列表仍严格有序。

## 最终工程与保存版编译

- [MCP 工程](D:/InoPro-PlaceholderClear-20261123-170201/engineering/AM610_PlaceholderClear.project)：`D:\InoPro-PlaceholderClear-20261123-170201\engineering\AM610_PlaceholderClear.project`。
  最终 SHA-256：`8d094b717ba9e9b7a6746a5e1513edce426e92c3ae97616c9469ad58ce2b03c8`。
  保存版编译操作：`a3bdf246-fda6-4f31-9aca-979ff2ad0766`。
- [CLI 工程](D:/InoPro-PlaceholderClear-20261123-170202/engineering/AM610_PlaceholderClear.project)：`D:\InoPro-PlaceholderClear-20261123-170202\engineering\AM610_PlaceholderClear.project`。
  最终 SHA-256：`775dd3b45704e829feaea78df54c507ed43b7c10aaad6d8982f653495c91c608`。
  保存版编译操作：`8cba6a1b-e6c8-43ba-b6db-d5008db94797`。

两套 diagnosticsComplete=true，最终编译的磁盘哈希对应最终实际文件；保存后的只读查询没有再改变主文件。两套主文件和 projectbackup 字节随授权保存改变。MCP 两个 opt 文件字节保持、仅修改时间变化；CLI 的用户级 opt 文件字节改变，AllUsers.opt 字节保持而时间变化，未据此推断 IDE 私人选项的语义。前后四文件清单分别归档，不能称整个工程目录未变。

## 模型与客户端验收

只发送一次任务；正式连接 `9656-b3306fe1-dbce-41c2-b2f7-f14b53cea469` 记录 initialize 0.37.0、完整 38 项 tools/list、Schema 摘要以及实际新工具调用。它与独立初始化、MCP 开发端连接分别归属。固定构建实际含客户端标题指令 64,431／65,536 字节；未调高上限。旧 37 项输入／输出契约一致。

模型核心流程遵循：直接打开指定第二份工程；取得目标页及版本；清除一次；编译、保存关闭重开、必要复编、完整续页读回。未查历史操作、未 reconcile、未调用 project_compare 或业务副本路径；没有参数拒绝、新 conflict/unknown，未重发业务任务。26 次状态查询均针对本次 operationId 或 requestId；没有以等待超时作为重发授权。

流程效率与展示仅部分通过：26 次查询、五条 CLI 工具结果输出截断，最终答复较长。新工具紧凑清除摘要未被截断。原答复与逐条调用保留，不为展示重跑。勘误：原文“无截断”只能指原生枚举覆盖，不代表 CLI 输出无截断；“19 条引用未修改”应理解为保留引用与非授权字段，目标四字段确有授权改变。工程链接按实际路径生成，未测试点击。

独立发现连接 `16868-9a5ab152-6b59-441c-9dbb-d7e265e0f536` 的 server/discover 返回 -32601，缺少退出事件；不能写成所有连接成功。CLI 与正式服务均正常退出；Desktop 未启动，日常握手、完整指令实际进入模型上下文仍未验证。

## 离线验证及首败

各组独立记录，不累加：

- 完整 Node 四组最终 180/180、551/551、139/139、134/134，共覆盖 1004 个不同用例。首次第一组为 179/180，其他组已通过；同产品独立目录仅复测失败组，180/180。原失败保留。
- Python 630/630 独立记录；早期定向 Node 92/92。
- 随后的仅客户端摘要投影修改由最终定向 64/64 覆盖，不能把完整回归说成发生在投影修改之后。所有最终源码指纹归档；固定构建来自 f944b553。
- 构建、类型、旧契约、固定指纹通过；本机 IronPython 2.7.7.0 编译检查通过。准备六阶段替身 6/6，真实验收闸门代码片段 11/11，仅验证设施规则，不算工程成功。

首轮 POU 测试在 open 未完成时读取 session，原操作耗时 1091 ms；初始返回瞬间未独立留存，不能补造原 running 响应。默认环境历史 200 ms 性能问题未修复，未调整阈值或清理历史目录。替身 undefined 序列化、缺字段负例设置、摘要测试仍访问完整字段、错误目标页等首次离线失败均保留。

辅助首败另列：初始化检查器先误认 JSON Schema 方言，复查原连接日志后更正，无再次握手；CLI 配置 dump 引号失败未启动模型；MCP 准备入口斜杠格式拒绝发生在 operationId/租约/IDE 之前，修正原路径写法后才执行；CLI runner 首次用 GBK 读取 UTF-8 中文准备记录，发生在提交之前，保留原 runner 并仅修正五处读取编码，实际任务仍只有一次。事后只读审阅脚本亦有外层账本 envelope、requestId 状态查询遗漏和终端编码等解析错误，保留记录；这些没有派发工程，也不改写业务终态。

## 保全与证据入口

登记沿用 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。35,443 项事前指纹核对后，原操作账本、IPC、检查点、封存工程、隔离和私人配置无字节变化；本轮新增工程操作及登记更新单列。MCP/CLI 服务正常退出后各留下本次新 service.lock，因现有 shutdown 的 pending 集合仍含历史隔离项而未 release。原保全检查器将“事前不存在的新锁”列为 unexpected，原检查结果保留；后续按 ownerPid、进程创建身份和退出记录独立归属，不当成历史文件改写。

MCP 的 stale 租约由下一准备阶段通过原 Store.acquire 正式验证并归档，再正常释放；CLI 结束的新 stale 租约保留，未手工删除。最终无活动 IDE、工程服务或未隔离 pending。五项历史 MCP unknown、四份独立探测封存状态和旧退出缺口不改判，不执行历史 reconcile。

本地总入口：[验收目录](D:/InoPro-PlaceholderClearProduct-20261123-170200)。关键证据：

- `acceptance-plan.json`、`product-origin.json`、`fixed-check.json`、`initialize-check.json`。
- `mcp-preparation-final.json`、`cli-preparation-final.json` 与两工程根目录的阶段原始结果。
- `mcp-review.json`、`mcp/` 请求、原始协议、三阶段目标、编译和退出验证。
- `cli-review.json`、`cli-exit-verdicts.json`、`cli-flow-review.json`、`cli/cli-evidence.jsonl`、`cli/traces/` 和未改写的最终答复。
- `history-*.json`、两份 `*-new-lease-review.json`、`*-files-before/after.json`。
- 离线原始日志位于 `D:\InoPro\deliveries\placeholder-clear-product-offline-20261123`。

复核包仅包含必要本轮证据、项目和脱敏配置摘要；不包含私人账号配置、凭证或模型思考字段。原始文件保留本地且记录哈希。日常固定 0.36.0 和 Codex 配置未切换。历史 CmpLog、脚本信任、崩溃根因、默认性能、Desktop 与实际运行限制继续保留，S9 暂缓。

[工具范围](library-placeholder-clear.md) · [写前设计](library-placeholder-clear-design.md) · [README](../README.md)
