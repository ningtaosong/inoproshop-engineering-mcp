# DSH 常驻串行调用补证与一次真实内存编译

2026-11-27。本轮延续 `codex/resident-mcp-session`，实际工程产品仍为固定提交 `02e50993aebb5c02a6fdb6e8bc1998cc8a1c292a`，0.41.0 候选、38 项工具。main、日常入口和私人配置未改；不合并、不部署。此前[DSH 任务首败](dsh-resident-build-20261127.md)保留原结论。本轮修正独立替身的协议输出及事后审计，不修改产品业务、Schema、并发、隔离或工程守卫。

## 结论

修正后的替身由一次模型任务完成串行打开、目录、读取、单处修改、模拟编译和独立读回；随后按已授权顺序，向**原先保留的同一 SDK 会话、正式 MCP 连接及 IDE**提交一次新的真实任务。真实任务完成 `ProbeDelay := T#5s` → `T#7s`，`ProbeEnable := FALSE`、声明及两条中文注释保持；一次内存编译 **0 错误、0 警告**，最终独立读回一致。

保存、关闭、退出均为 0。当前工程保持打开，7 秒／FALSE 在内存中；磁盘主文件仍为原保存版本。此结果证明本次限定调用顺序和真实内存闭环，不证明模型遇到任何异常都必然停止，也不证明保存持久化、PLC 运行或全部工具均支持 resident。

## 替身首败及最小修正

全部原脚本、原结果及失败均保存在 `D:\InoPro-DSH-ResidentSequence-20261127`，没有用后来的通过覆盖旧文件。

| 阶段 | 实际结果 | 证据边界 |
| --- | --- | --- |
| `mock` | 环境及错误响应缺少正式契约必需字段，模型未进入模拟工程 | 前置 8/8 内部测试不足；原失败及正常 SDK 退出保留 |
| `mock-repaired` | 内部 62/62 通过，但客户端拒绝 `session_status` 输出 | 第二次模型明确提到该错误后仍继续模拟打开；未完成读改编译，不能判通过 |
| `mock-wire-fixed` | 修正实际输出后，完整模拟流程完成 | 原事后检查又因只接受 operationId 失败；独立补证核对合法 requestId 后确认串行成立，没有重发该任务 |

已证实第二次错误的具体原因：`session_status.outputSchema.properties.data.additionalProperties=false`；实际发送的 `structuredContent.data` 多出 `fixtureOnly`、`realIde`。替身调用 `outputSchemas[name].parse(value)` 后丢弃了返回值，内部解析会剔除额外字段，但线上仍发送未剔除的对象。最小修正是发送解析后的结果，错误响应也经相同输出规范化；没有删除工具或调整业务守卫。

验证使用正式的 38 项输入／输出 Schema，增加 JSON Schema 验证及实际 MCP SDK Client 的 stdio 检查。覆盖全局响应、全部工具的停止／错误响应、各运行状态、完整异步序列，以及 text 与 structuredContent 的一致性。异步操作保留实际计时器，先返回 running；只有查询原操作并收到终态后才允许下一项业务调用。不是把所有调用改成即时成功。

分别记录：原有替身测试 **62/62**；新增线传／实际客户端检查 **53/53**；查询身份核对 **10/10**。不相加，不作为产品全量回归或真实编译证据。此前 62/62 不能证明当时的实际线传输出合规。

修正后模型连接收到完整 38 项工具，所有 48 份工具响应通过实际线传 Schema 核对。6 个异步业务结果均由客户端实际收到成功终态，下一业务请求才开始。39 次状态查询中，10 次使用 requestId，均唯一对应当时 pending 的 operationId；没有历史／外来查询、unsupported、冲突或缺证。原 `result.json` 的过窄断言失败保留；`posthoc-request-identity-audit.json` 与 `client-order-audit.json` 为独立事后补证。

三次替身模型任务各自只有一次提交，测试装置缺陷修正后的重验在本轮必要修复范围内分别执行，原记录保留；不是一次任务反复重发来改善展示。第三次的 SDK69836、正式替身12828正常退出0。三次 SDK 和正式替身的退出分别有记录；发现连接的 `server/discover` 拒绝及缺少退出事件仍单列，不称全部连接成功。

## 唯一一次新真实任务

模拟完成及正常退出后，再次核对原 22,518 项登记材料无变化、主工程哈希、固定107文件和四个进程创建身份，才提交新的真实任务。未重开工程、热更新构建或创建替代连接。

| 项目 | 实际身份 |
| --- | --- |
| SDK | PID61000，创建身份 `639313441745201932` |
| 会话 | `dc141d88-28c4-4014-af22-b0f8505717b7` |
| 正式 MCP | PID72960，创建身份 `639313441767957126` |
| 正式连接 | `72960-c5b5496e-f7eb-4f79-a459-996e87c8e7be` |
| IDE | PID24836，创建身份 `639313442253127005` |
| 原生 launch | `dc18680c-a312-4da2-9c41-c6a5558a9bff` |
| 保留驱动 | PID22724，创建身份 `639313441725492118` |

主工程：[AM610_ResidentBuild.project](D:/InoPro-ResidentBuild-Recheck-20261127/engineering/AM610_ResidentBuild.project)。完整路径 `D:\InoPro-ResidentBuild-Recheck-20261127\engineering\AM610_ResidentBuild.project`。点击未验证；文件链接不包含当前未保存的7秒内存状态。

| 原生序号 | 操作 | operationId | 结果 |
| --- | --- | --- | --- |
| 4 | object_list | `55778bb2-9bba-4f8a-84ae-b25accabc2a7` | succeeded |
| 5 | object_read | `4f0f9461-5993-410e-a6fe-e05f2917a6c1` | 确认5秒／FALSE |
| 6 | code_apply_change | `143bc778-982d-46e4-9fa2-3a3477b556c6` | 仅5秒→7秒 |
| 7 | project_build | `c1d30598-2205-44b4-8f27-5167af67aa44` | 内存编译1次，0错误／0警告 |
| 8 | object_read | `6ee3cd03-7107-4e87-a6ed-227267c47528` | 独立确认7秒／FALSE、声明和中文 |

每项结果与原 requestId、请求指纹、launch、顺序号、IDE创建身份及 `service-verification.json` 对应，并重新运行生产 `verifyResidentResult` 读取校验；没有重派发原生操作。写前与派发前快照相同，写后快照仅授权实施文本不同。编译证据范围为 `resident-memory`，不是保存版编译。

编译保全：原直接库及任务调用保持；编译新增 `IecVarAccess` 系统依赖，其原生字段及实际安装件支持证据通过既有规则。`directLibrariesUnchanged=false` 如实保留，不能声称整份库清单完全不变；没有新增派生设备。

## 顺序、查询及展示边界

本轮共45次工具调用：session_status 1、object_list 1、object_read 2、code_apply_change 1、project_build 1、operation_status 39。没有 variable_inspect/usages、batch回退、project_open/save/compare，未查询历史操作。每个 running 后只有本轮原操作查询；成功终态后才进入下一业务工具，没有原首败的抢先查询。

39 次查询中14次使用本轮唯一 requestId；其中另有5次按 operationId 传 `reconcile=true`，分别对应上表5个原操作。实际返回为1次succeeded、4次running，均非unknown。实际提示词禁止的是“查询/reconcile历史操作”，固定初始化第62、74行也要求查询本轮原操作，没有一概禁止本轮正常running查询的该参数。产品 `callAccepted` 对非unknown先返回原观察值，没有新增原生派发；这5次额外查询保留，不称流程效率最佳，也不外推为允许恢复unknown。

原事后审计误将“禁止全部reconcile”的替身规则带入真实核对，因此首个审计失败保留。补证将请求身份与参数分别核对，严格要求只属于本轮新操作，并逐项记录参数及结果；没有修改产品代码或历史账本。另一最终检查最初未剥离客户端文本中的摘要前缀，解析失败也单独保留，修正后仅重读证据。

原答复正确报告7秒／FALSE、0错误／0警告及未保存保持打开；其中“磁盘文件未写入”只可限定为主工程文件。实际 autosave 与 `.~u` 字节改变，两份选项文件仅修改时间变化；不能推广为目录完全未落盘。模型工程闭环和串行遵循本次通过，重复查询及上述展示限定保留。没有再发送任务改善答复。

## 保全与初始化归属

- 原登记目录仍为 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。原22,518份材料中仅当前 `registry.json` 因正常新操作改变，其他原文件字节不变；新操作账本、IPC和检查点另计。历史unknown／隔离／锁未删除、恢复或改判。
- 主文件前后 SHA-256：`ecc5978e7c5dd252e7531c570ca92e886b3b5a093ccde4db5392a97aea4742f6`。附属文件变化见 `final-checks.json`，不是主文件不变就代表目录不变。
- 模拟使用05e7003的模式与串行提示，含客户端标题 **65,346／65,536字节**，全部38工具可见。真实任务仍使用原02e5099固定实例的 **65,162字节**初始化，另接受本轮明确用户指令；未热更新，不能把结果说成新初始化正文已在这条真实连接加载。
- 当前 SDK/MCP/IDE/驱动仍为上表同一创建身份并保持打开。常驻请求完成与退出不同，本轮没有IDE退出回执，也没有要求退出；保存／关闭／退出调用均为0。

## 复核入口与后续范围

本轮本地证据根为 `D:\InoPro-DSH-ResidentSequence-20261127`：三次替身的原协议和结果、实际客户端离线记录、`before.json`、`before-real.json`、`real/audit.json`、`real/actual-calls.json`、`final-checks.json` 及实际脚本均入复核包。正式原生请求与结果按上表operationId从原登记目录归档；私人YAML、凭证和工程二进制不提交或入包。

历史[真实MCP正例](resident-build-scalar-recheck-20261127.md)、[旧DSH首败](dsh-resident-build-20261127.md)分别保留归属。默认环境性能、历史unknown、崩溃根因、CmpLog、脚本信任、Desktop、保存持久化及实际运行边界不变。后续是否保存、关闭或继续修改，等待新的明确指令；不因本轮收尾自动开展下一任务。
