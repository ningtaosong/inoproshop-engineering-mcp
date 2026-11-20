# task_create 任务清单换序补修（0.34.1 候选）

本轮仅完成代码修复和离线验证，保持 37 项工具。原工程未打开、编译、保存或复制用于续试；未启动真实工程服务、IDE 或 DSH 模型任务，未修改日常入口或处理 unknown。

## 原证据及复现边界

- 产品基线 main：`5b3e5b06580c1ee6a981f4a3fafa46c767bc7513`。
- 原综合验收文档提交：`5b7930326bb386ed30364aa69891a17e28643828`，保留在 `codex/offline-alarm-acceptance`。
- 原 ZIP：`D:\InoPro\deliveries\InoPro-review-20261120-135513.zip`；SHA-256：`661f97b0d6ae3c4b2fbf16c6bcca72e0195d52c3426f1814e6d515885be0c4aa`。
- 原操作：`78715c58-ce22-44e9-9a98-ca87ef41c04e`，正式结果仍为 `unknown / TASK_CREATE_INCOMPLETE`。
- 原错误：`Reopened inventory differs from the task binding readback`。
- 封存工程：`D:\InoPro-OfflineAcceptance-20261120\AM610_AlarmAcceptance.project`。

`task-after-bind.json` 的顺序是 MainTask、StatusTask，异常后另读的 `partial` 是 StatusTask、MainTask。按 taskId 对齐后任务记录逐字段一致，其余清单字段也一致。原记录包含成功保存、关闭及重开阶段，不能称为“未产生修改”。最终磁盘主文件 SHA-256 为 `76afe927020671df68956aae98c9c2cf08c8707e47670af52da16277c63db7bc`。

即时比较失败的 `after` 没有独立发布。异常后的 partial 不是当时快照，不能证明原故障的唯一原因。新的离线回放将归档 partial 明确作为模拟重开输入，直接运行生产 `task_create`，并以替身承担创建、保存及句柄行为。原版返回同一错误；补修版对该输入通过。替身的工厂、绑定和保存计数不代表本轮真实工程操作。

归档输入见 [固定回归材料](../tests/fixtures/task-create-inventory-order.json)，生产路径回放见 [Python 回归入口](../tests/bridge_task_inventory_order_test.py)。首次回放脚本因加载原版定义覆盖了发布替身而出现 System.Text 导入错误，已保留于复核包；修正的是测试装配，没有启动 IDE。

## 修复范围

任务清单属于身份集合；当前任务配置版本 `task-configuration-v1` 原本就按 taskId 排序。它不表示任务实际调度顺序。每个任务内部的 PROGRAM 调用序列具有顺序语义，仍逐项核对名称、备注与目标。

1. 桥接 `task_create` 在创建后保全旧任务、保存重开后核对全清单时，仅将顶层 tasks 映射为按唯一、非空 taskId 索引的比较视图。校验数量和集合、路径及所属配置节点、工程和 Application、所有已读配置及未知新增字段，不修改原始清单顺序。
2. 服务端 `task_create` 成功结果复核同步采用该视图。其余工具不套用这一规则。PROGRAM 清单原有检查、源码快照、原生 ST 标识、版本、检查点和磁盘校验保持。
3. task_create 单独复用已验证的严格原生调用行读取：记录必须是两字段元组或列表，名称及备注必须为文本。空备注、中文及字面文本 `"None"` 保留；原生 null、缺字段及错误类型不能先转换成文本通过。
4. 不递归排序列表；调用顺序、备注、绑定、null／空串／字面文本／不同类型仍可区分。版本方案和版本计算函数没有变更。
5. 实际用于比较的原始清单在校验之前写入 `task-create-after-bind-observed.json` 或 `task-create-reopen-observed.json`。对应 `*-verification.json` 记录阶段、首个具体字段差异或原始读取异常、预期证据。后续异常处理中的 partial 是另一次读取，不能替代这些快照。
6. 发布失败和 partial 读取失败另记 `diagnosticErrors`，不能覆盖先发生的原生或校验异常。证据发布自身失败也不判成功。已派发后仍返回 unknown；不删除任务、不反向写入、不恢复性保存。服务端去重与冻结机制保持，直接编辑和旧副本模式均覆盖。

该修复只豁免任务集合的枚举换序，没有放宽任务内部顺序、身份、内容或覆盖要求，也没有证明其他工程结构的顺序无意义。

## 离线验证归属

产品修复提交：`bd10bbfd47b34da8ab3c6a0c58d2e4aa441ce19c`。构建、类型检查、指令大小及原 37 项输入／输出 Schema 对照通过。Schema 文件只有 serverVersion 从 0.34.0 改为 0.34.1。

测试环境为 Windows、Node v24.15.0、CPython 3.11.9。原生测试执行生产 Python 函数配合 API 替身，不代表本机 IronPython/IDE 实测。服务测试使用临时文件及 FixtureAdapter；协议测试只启动测试模式子进程，不启动真实 InoProShop 服务。

| 检查 | 环境及结果 | 归属／边界 |
| --- | --- | --- |
| Node 定向 | 独立 TEMP/TMP，82/82 | task-create、task-config 及生产桥接比较回归入口 |
| Python 定向 | 独立 TEMP/TMP，39/39 | bridge_task*_test.py；其中新增清单回归 11 项，含多组反例 |
| Node 完整回归 | 独立 TEMP/TMP，530/530 | 上述产品提交，测试期间仅编辑文档 |
| Python 完整回归 | 独立 TEMP/TMP，248/248 | 全部 *_test.py，上述产品提交 |
| 默认环境任务工具定向 | 61/61，约 541 秒 | 仅 task-create.test.mjs，不是性能通过 |
| 默认环境状态查询 | 0/1，原 <200ms 断言失败 | 阈值未修改；与其他测试并行时采集，不能据此定位唯一性能根因；历史问题仍未解决 |
| 构建／类型／Schema／指令 | 通过；37 项 Schema 精确一致；63,036 字节 | 没有启动真实工程服务或取得客户端握手 |

完整与定向计数分别列出，不相加。独立 TEMP/TMP 的通过不能替代默认环境的失败；没有清理历史隔离或登记来制造通过。

测试覆盖归档回放、多旧任务换序、任务增删和重复／缺失 ID、父路径变化、周期／优先级／看门狗、调用重排／备注／目标、PROGRAM 及原生 ST、字段缺失／覆盖／读取错误、记录发布失败与首异常保留。写前冲突为零工厂／绑定／保存，磁盘未变；写后失败仍 unknown、冻结，重复请求不派发。合法换序保留原始顺序证据，旧编译证据仍失效。

初次定向 82/82 在待提交的相同产品树上运行，复核包以逐产品文件哈希对应上述产品提交。一次 `bridge_*_test.py` 检查的 237/237 只覆盖 bridge 命名集合；另有真正覆盖全部 `*_test.py` 的完整记录，不能把前者当最终完整计数。各组不相加。

初始化指令含客户端标题为 **63,036 / 65,536 字节**，正文及工作指令未修改。产品本轮没有真实 MCP、DSH CLI 或工程复验。

## 其他路径与后续条件

代码检查发现 `task_call_append`、`task_call_replace` 在桥接及服务端也有整个清单或任务列表的顺序敏感比较，可能遇到同类换序拒绝；本轮未修复、未真实验证，需独立评估。`task_config_update` 主要使用已按 taskId 排序的版本比对，不套用本轮新增视图。不存在全局排序或共有版本方案变更。

原综合验收没有编译结果，不能填写零错误／零警告；本轮离线测试通过也不能改判原工程或综合验收通过。真实复验应在本补修获复核、原冻结按正式维护机制处理后另行授权安排。不得换登记目录、复制封存工程改名或重发原请求规避限制。

四项历史 MCP unknown 加本次原综合验收 unknown、历史隔离、三个独立 I/O 探测 unknown、原移除失败现场及所有锁保持。CmpLog、脚本信任、默认环境状态查询性能、Desktop 欢迎页、实际调度与 PLC 运行未验证边界各自保留。本轮没有部署或改变日常 DSH／Codex 配置。


## 获授权后的独立复验

2026-11-20 后续已完成正式隔离及一次 MCP、一次 CLI。最小 MCP 通过，CLI 最终保存文件核对成立；历史 reconcile/账本变化和中间 IDE 非正常退出使整轮 CLI 验收未通过。见[后续证据与边界](task-create-revalidation-0341.md)。不改写上述离线修复时点或原 unknown。
