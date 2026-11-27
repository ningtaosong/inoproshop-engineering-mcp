# 常驻登记查询与显式新打开的状态一致性

2026-11-28，`codex/resident-user-save-continuation`。候选仍为 **0.42.0、38 项工具**，未合并或部署。日常 DSH 0.38.0 与 Codex 配置保持。本文是本轮独立记录，不改写旧 unknown 或原验收。

## 首次模型任务及实际阻断

固定产品 `eb746c827042c6593baabb5d4a363af7604ccbcf`，准备提交 `d6ab640905b32b61b2f8987f819758d19b85fdee`。唯一第一轮 DSH 任务只调用 `environment_inspect`、`session_status`、`project_list`，没有打开、读取源码、修改、保存或编译工程。第二轮未发送，原提示、回复和停止结果保留。

正式连接 `49140-63aa234d-707b-400d-86ce-c4a0b80564e2` 的 initialize/tools/list 取得0.42.0、完整38工具。原工作指令正文65004字节，客户端含标题65031／65536字节。发现连接另有 `server/discover` 拒绝及退出事件缺口。环境能力审计仍为 unverified；客户端 system/message 包含说明正文不等于证明模型内部上下文。

`session_status` 实际返回 `writeFrozen=true`、`globalFrozen=false`；目标登记在 `project_list` 为 active/unresolved。模型据此停止有服务端依据。原回复将 active 登记解释为仍打开的 IDE 不准确：旧 IDE 此前已经正常关闭，本轮没有启动新 IDE。`project_list` 的客户端文本存在截断，保留原文，不补造完整接收证据。

旧会话已确认保存文件：`D:\InoPro-Resident-UserSave-20261127\engineering\AM610_UserSave.project`，SHA-256 `284d58d08aea312d4da09a50a809d463669e77f7751e812a06fc7f7d3e28d87b`。该原工程仍只含之前两轮MCP的中文注释，未添加本轮模型提示要求的注释。

## 确认的代码缺口与最小修改

`guardPending` 已根据严格验证的 `earlyProof` 和 `continuedBy`，限定到相同 projectId、sessionId 与路径判断旧 unknown 的影响。原 status/list 则直接使用 `related(...).length`，遗漏这一已有规则。

本轮以原固定代码对真实登记目录做只读评估：状态冻结，但原 `guardPending(project_open)` 和 `verifyClosedResident` 均通过；22,785份登记材料逐文件字节不变，零派发。该结果与三条生产路径离线反例共同证明状态判定不一致，不能据此把任意历史 unknown 解除。

补修只提取原 `pendingBlockers` 供查询和派发共用，**派发的条件不变**。本服务没有持有 resident 通道时，查询实际执行原 `verifyClosedResident`：正常退出、进程创建身份、原请求与回执、完整保存版本链、当前文件身份/哈希均通过，才显示 `availability=explicit-open-required`，明确 `memoryAvailable=false`、必须显式 `project_open`。`writeFrozen=false` 此时仅表示该登记没有被未决影响阻断，绝不表示可以直接向已结束句柄写入。

后续打开仍重新执行原证明，不缓存查询为授权。文件改变、退出或请求证据缺失、异常退出、身份/会话变化、重复路径、仍有旧服务或进程不明均拒绝。本服务持有通道也只报告 owned-channel，不声称查询已验证内存健康。原 session 和全部 pending 仍按原记录返回。

查询期间登记、操作或隔离证据变化返回 `conflict / STATUS_EVIDENCE_CHANGED`，仅作废本次快照；正常在办操作刚完成不被改判为 unknown，也不误报全局冻结。真实损坏或无法确认的原保护仍保留。

修后真实目录只读返回 `explicit-open-required`、`writeFrozen=false`，仍含11项历史 pending，原派发与保存链证明通过；相同22,785份材料无字节变化，零工程派发。这不是修后模型验收或新工程闭环。

## 验证归属与首败

| 记录 | 结果与范围 |
| --- | --- |
| 默认 TEMP 的首次回归 | 保留原始失败：Windows短路径与realpath身份不同导致IPC别名拒绝；不当作已到达状态缺陷的复现 |
| 明确长路径临时目录，修前 | 三条真实生产比较路径均复现：派发准入通过但status冻结 |
| 新状态定向检查 | 最终14/14；含退出、版本、身份、并发完成及“查询后文件变化仍零派发”；保留首次11/13、随后12/13的测试预期错误 |
| 最终相关Node回归 | 390/390，七个文件：resident、pending范围、隔离观察与退出核对；先前389记录单独保留，不累加 |
| 无工程结束及既有结束路径 | 62/62；独立辅助器验证，不冒充产品工程验收 |
| 构建、类型 | 通过；Schema、初始化正文、版本及桥接未变 |

未重跑全量产品回归，没有调整200ms历史性能阈值或清理历史目录。

## 无工程连接的正常结束入口及新退出缺口

原验收driver的 finish 假定本轮打开过IDE，不能把旧登记launch用作本次结束依据。最小补修在首次动态加载的辅助模块增加显式 `no-engineering-plan:` 分支；运行中的driver正文未改、不热替换。原已开工程分支保持。新分支要求本次driver/SDK/MCP创建身份、已完成轮次、完整三项全局查询、没有下一轮/工程队列、登记与工程文件保全，并禁止传入任何native launchId。

本次实际通过该证据门，返回明确 `no-native/no-engineering`，随后原driver发官方SDK shutdown和stdin EOF。独立观察器在结束前持有三层进程句柄，记录：

| 实例 | PID | 实际退出 |
| --- | --- | --- |
| 正式MCP | 49140 | **1，非正常** |
| DSH SDK | 33628 | 0，signal=null |
| 验收driver | 53732 | 0，signal=null |

不能以SDK/driver正常或 finish-completed覆盖MCP非零退出。曾在中间汇总误写三者都为0，读取独立句柄记录后立即更正；原始记录不改。

MCP生命周期只留有 `shutdown-requested(stdin-end)` 和 `observations-settled`；下一阶段为状态读取，没有status完成、租约释放或shutdown-completed回执。其约2秒后退出1。本轮没有新工程操作/unknown，停止后续模型验收。driver后置 `readAfterShutdown` 是旧会话保存链复核，不能作为本次服务的native退出证据。

随后只读核对安装版 `app.asar`（SHA-256 `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`）：`@deepseek-ai/dsh-mcp-client` 0.2.1-rc.5 的 dispose 调用 generation.close；其实际依赖 `@modelcontextprotocol/client` 2.2.0 的 `dist/stdio.mjs` 第181–202行明确执行 EOF、等待2000ms、仍未退出则SIGTERM，再等2000ms后SIGKILL。该成员SHA-256 `26bba09797abb03929888ce234141ab89e5456a8ff3cdf5fadcb522d42f4ba3e`，归档绝对偏移127587755。只解析提取的精确模块，没有执行安装件。REA父证据 `ev_a060b6239dee751bf4e332aefde121e106c0b509925ca169be26df5ffddf0515` 保留静态边界。

实际先前status/list分别耗时13.386秒、14.366秒；EOF后MCP约2秒退出与上述机制吻合，支持“客户端结束期限与服务收尾的全历史状态查询耗时冲突”的解释。尚无OS级终止调用事件，**没有把发起方及唯一根因写成动态已证实**，也不修改安装件、超时阈值或全局生命周期。本退出1保留为收尾失败；若所有实例已退出、材料保全及原生产新开证明均通过，不凭该质量缺口另造工程冻结条件。

此前维护中的旧IDE33620正常退出0；旧辅助进程52028仅经明确授权结束，退出−1，不能写成正常；旧MCP72076有独立退出0但内部EOF/租约释放链缺口。以上与本次49140退出1分开记录。

## 证据入口与后续条件

本地原始根目录：`D:\InoPro-Resident-Autosave-Handoff-20261128`。入口：

- `round1-sdk-completed.json`、`round-1-status-basis.json`、`traces/`：原模型任务及正式连接；私人SDK协议/YAML仅本地保留，不进入公开提交。
- `status-repair/before-real.json`、`after-real.json`：真实目录只读复现、原派发判定和逐文件保全；不是新IDE验收。
- `status-repair/*tests*.txt`：所有测试首败与最终结果，按各次代码时点保留。
- `no-engineering-finish-plan-v2.json`、`authorized-finish-proof.json`、`status-repair/query-only-process-exits.jsonl`：本次无工程结束的计划、判断与三层退出。
- `finish-after-service-proof.json`：只复核旧会话保存链。
- [原两轮MCP](resident-autosave-real-20261127.md)、[原移交准备](resident-autosave-client-handoff.md)：保留各自时点，不补写当时未做的模型结果。

修后模型任务须使用新的固定构建和独立记录，经复核后另行安排；原第一轮不重发、不自动发送第二轮。尚未证明自动保存DSH两轮闭环、当前Desktop日常握手或PLC运行。历史unknown、隔离、锁、CmpLog、脚本信任、默认性能和退出根因边界保持。
