# 结构体字段候选：范围补修与独立复验

2026-11-25，`codex/struct-field-add`，0.39.0候选／38工具；未合并main，未部署日常入口。普通结构体新增字段仍未完成真实验收。

## 实现与离线归属

`08e222302e851b6495c79fd8209e9ead60937444`收敛历史未决结果影响范围；`594c5f77e30a56a092fb96988e7695964fc16a52`保留无未决项时原路径校验。最终固定来源`c075520698b70c50b1b6b601c661bcf8da2839d7`，相对594c只有测试变化。38项输入／输出Schema与本分支此前候选一致；实际初始化指令含客户端标题64,968／65,536字节。

原请求、进程创建身份与当前工程归属都可信，且原进程已结束时，旧unknown仅阻止原工程及身份别名。缺证、进程仍活跃或身份冲突仍保守停止。共享判定用于状态、列表、受理、队列与原生派发前；新请求未派发时返回conflict，已派发原操作保持unknown。不提交新的隔离计划，不恢复旧结果，详见[判定说明](pending-operation-scope.md)。

| 验证 | 归属与结果 |
| --- | --- |
| 首次开发目录完整运行 | c02ae：期间误在开发目录执行npm ci，出现依赖缺失和连接关闭；另有真实路径兼容缺陷及旧状态断言。全部首败保留，不作为通过记录。 |
| 固定目录Node完整覆盖 | 594c：83文件、1,366项；1,360通过、6项旧后续请求状态预期失败。四组309、259、433、365项；分别304、258、433、365通过。 |
| 相关修正复验 | c075：recovery／organization 23／23。6个首败名称均在复验中通过，并核对零新增派发、原操作字节不变。产品141项指纹与594c相同。不能写成单次1,366全绿，也不把23叠加进总数。 |
| Python完整回归 | c02ae：665／665；到c075桥接与Python源码未变，单独沿用。 |
| 构建、类型、契约 | 最终固定目录通过；所有38项输入输出保持。默认环境200ms历史问题不改阈值、不改判。 |

原始日志：`D:\InoPro-PendingScope-20261125-1131`，汇总`node-complete.json`。固定目录：`D:\InoPro-StructFieldRecheck-20261125\fixed-c075520698b7`。

## 最小真实只读通过

使用既有正常文件`D:\InoPro-FBInterfaceInit-Recheck-20261124\mcp-project\AM610_FBInterfaceInit.project`，哈希`7132813246d984224233b5890cb5ffa2798036c5cf93ee6812191ea8c1adfdc5`与原验收相符。只进行environment／session／registry查询、一次直接打开与一次task_inspect；未查询或reconcile历史操作。

- 打开：`9e49b44d-7973-4b22-aed7-279ab0f81c62`。
- 任务读取：`b406ce92-9b45-4ec4-a33d-fa316dba1bce`。
- 两次均有绑定原请求、launch、PID创建身份的process-exit与正常关闭证据，退出码0、无信号；任务配置版本与原记录一致。
- 工程主文件未变；附属文件逐项见`readonly/outcome.json`。修改、编译和保存均0次。返回会话含旧编译信息不代表本次又编译。
- 正式服务收到EOF后退出码0、无信号。只证明该独立MCP连接，不是Desktop或模型验收。

## 新夹具准备停止：原生结果与整体终态分开

之后只对新路径`D:\InoPro-StructFieldRecheck-20261125\mcp-project\AM610_StructField.project`派发一次project_create。原生阶段返回新建、默认初始化保存、指定路径发布、重开与关闭完成，result.json为succeeded；04:05:25Z正常关闭回调记录openProjectCount=0、primaryIsNone=true。但始终没有process-exit.json，所以MCP在04:07:13Z返回unknown／IDE_TIMEOUT。

| 身份／证据 | 实际值 |
| --- | --- |
| operationId | b80105f3-55b9-4570-b450-f62e5028b707 |
| requestId | db02cc88-c5fa-468d-8a69-a59202bb955e |
| launchId | 0ed25150-fd3c-4595-92db-6c8ce7dd0136 |
| IDE | PID56568；创建身份639311763077344241 |
| 服务 | PID61560；创建身份639311762877967591 |
| 新文件SHA-256 | 629e435f2706ef1d3c012d42dbda9a6d287b69cdf6b0c5f8b0847b4914c0c51a |
| 后续执行 | DUT／GVL准备未执行；正式字段新增0；编译0（无本轮错误／警告数）；CLI提交0；第二夹具未创建。 |

验收器保留原MCP超时响应、退出核对错误及EOF清理错误；30秒关闭观察后再只读观察15秒，期限届满仍无exit／close事件。稍后OS查询服务和IDE均已退出，但没有正常退出码或租约释放回执，当前租约stale。进程消失、noProject回调和结果文件不能代替完整正常退出证据，不补判成功。

新工程停止并保留，不重开、不重放、不回滚或恢复性保存，不换工程绕过新unknown。未强杀、删锁、修改策略或执行历史reconcile；未进一步扩大退出根因诊断。

## 保全与限制

原封存操作`1a422703-1f36-492a-9789-c6bb649c7d64`及原工程不动；原六项正式隔离、其他历史unknown继续保留。全量事前字节表58,183项中58,180项相同；变化三项为正常只读工程的登记、当前服务租约及其源锁。两种旧锁字节均在正式机制生成的stale归档中找到；非“整个数据目录不变”。原90项专门保护表的88项不变，另外两项正是允许正常更新的登记与当前租约。DSH／Codex配置及日常固定入口未变。

`readonly-history-check.json`首次宽泛断言把两项预期可变文件一并判为变化；后续按原授权分类记录在`readonly-history-final.json`，没有恢复任何字节。准备新建过程形成的新账本、IPC、工程和租约单列。

[原准备失败](struct-field-add-acceptance.md)、[退出诊断](struct-field-save-exit-diagnosis.md)、[退出观察维护](exit-observation-maintenance.md)保持原时点。OEM退出根因、默认环境性能、CmpLog、脚本信任、Desktop最终连接、实际内存布局与PLC运行均未验证或未解决。本轮不等于S4b交付完成；新不确定现场的后续处理需单独诊断，不在本轮继续工程任务。

复核材料根目录：`D:\InoPro-StructFieldRecheck-20261125`。收尾ZIP入口与逐文件清单由本次delivery.json记录；不包含私人账号配置、整个历史登记目录或封存工程二进制。
