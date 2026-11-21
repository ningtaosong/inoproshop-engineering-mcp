# 0.34.3 补充：PROGRAM 身份目录的枚举顺序

本补修继续在 codex/task-call-inventory-order，基于 f286e08d92b94dd967c23de1e71bbcfe61a19e92。保持 0.34.3 修复候选版、37 项工具、原输入输出 Schema、初始化正文及 task-configuration-v1 版本算法。

## 依据和影响范围

[首次真实复验](task-call-inventory-order-real.md)在正式追加前停止。准备快照和 task_inspect 原始结果中的六个 PROGRAM 身份与路径相同，枚举顺序不同；任务集合和内部调用没有变化。旧档案保留，未重开工程复现已知差异。

worker 的 task_inventory 将原生 POU 定义中可读 PROGRAM 声明的 objectId、path 收集到 programs；它是名称解析所需的定义目录。任务实际调用顺序来自各任务 rawCalls，与定义目录枚举顺序不同。归档输入经过生产比较器，修复前追加／替换及 task_create 比较均返回 programs[0].objectId 差异。

task_create 同类问题也已确认：旧任务保全阶段自行排序 programs，但缺少严格目录身份验证；保存重开整体比较仍有序，服务端还直接比较 before.programs 与 after.programs。本轮将三条路径统一使用同一个比较语义。

## 最小规则

- tasks 继续按唯一 taskId 建立比较视图。
- 仅 programs 字段按唯一原生 objectId 建立比较视图。缺失、非法、零 GUID、重复及大小写变体重复身份拒绝；缺失或无效路径拒绝。
- 每条目录记录的全部原始字段保留。增删、身份替换、路径及其他字段变化仍有差异；原始数组不排序、不改写。
- rawCalls 及所有其他数组仍有序，名称、备注、绑定、任务配置、完整性、源码与原生 ST 标识继续核对。null、空文本、字面文本 None 不合并。
- 桥接在同句柄上下文及派发前拒绝无效目录；写后或重开后缺证沿用 unknown、冻结及首次异常保全，不自动回滚或恢复性保存。
- 服务端独立核对使用同一视图。task_create 去掉的是已被完整身份视图覆盖的额外有序比较，未删除 PROGRAM 保全核对。
- 验收脚本调用固定候选的生产比较函数，不另设更宽的比较器。

这不提供任务调用重排，也不改变 PLC 调度语义。没有扩大其他工具范围。

## 验证归属

新增归档夹具保留来源文件 SHA-256、原 MCP operationId 所在结果路径和原包哈希。比较输入仅将准备操作所用 projectId 重新绑定到该次实际 MCP 登记 ID；原始材料不改动。

修复前桥接定向 156 项中 24 项失败，包括换序误判和目录身份拒绝缺口。修复后桥接定向 156/156。服务定向首次有 3 项故障注入因替身共享路径数组同时改变基线而未检出；改成实际 JSON IPC 的独立对象语义后，新定向 Node 101/101。首次日志保留，未放宽产品判断。旧原生替身中的占位 program/old ID 已改成明确的测试 GUID，其他参数语义不变。

完整回归、最终受验提交、固定构建和真实验收结果在后续验收段单独列出；不能用离线结果替代真实写入、保存或编译。

默认环境 200 ms 问题未改阈值或清理历史。既有 0.34.2 隔离只观察、终态幂等、请求绑定和可信退出保护保持。原历史 unknown、隔离、崩溃根因、CmpLog、脚本信任及运行边界保留。


## 本轮最终离线与真实验证（2026-11-21）

受验产品和独立固定构建均来自 **ecc1db45f084ec1218a9c3b0ab93012ab204d0e1**。之后只补充本节验收文档。固定目录为 `D:\InoPro-ProgramInventory-20261121-135004\real\fixed-0343`，未覆盖旧候选或日常入口。

| 验证集 | 结果 | 归属及范围 |
| --- | --- | --- |
| 修复前归档重放 | 生产比较器返回 programs[0].objectId 差异 | 首次准备快照／task_inspect 已有原件；不重新打开工程复现 |
| 修复前桥接定向 | 156 项中 24 项失败 | 包括仅换序误判与身份校验缺口；原日志保留 |
| 修复后桥接定向 | 156/156 | create、append、replace 生产桥接＋原生替身 |
| 补修服务定向 | 101/101 | 工程服务结果校验；早于最后 GUID 尾换行反例，最终完整组覆盖该反例 |
| 最终完整 Node | 802/802 | 67 个文件，四组独立 TEMP/TMP：397、134、154、117；full-node-verified-* |
| 最终完整 Python | 616/616 | 独立临时环境；full-python-0.log |
| 构建／类型检查 | 通过 | 工作分支及独立固定构建 |
| 契约与初始化 | 37 项输入输出 Schema、初始化正文未变 | 与 f286e08 及其 main 基线的既有口径核对 |

定向与完整测试不累加，Node 中的 Python 包装测试也不与 Python 总数合算。默认环境 200 ms 问题未重测、未降阈值，独立临时环境通过不能替代默认环境性能结论。最初服务故障注入的三个失败、所有中间测试结果均保留，最终采用 verified 日志。

真实 MCP 同一 stdio 连接记录 initialize 0.34.3 和完整 37 项 tools/list，并逐项核对 SDK 实际 Schema。初始化正文 63,009 字节，按已验 DSH 去尾空白＋标题口径为 **63,036 / 65,536 字节**。本轮没有 DSH 模型任务或日常连接。

### 工程闭环

沿用用户授权的两份正常关闭准备工程，未新建或重新准备夹具。使用前重新取得本轮目录指纹、完整原生源码／ST／调用绑定，主文件分别匹配 ce8a7e… 和 62bd95… 的原准备哈希。两份旧准备编译仍属于原轮，不算本轮编译。

| 项目 | 追加 | 替换 |
| --- | --- | --- |
| 正式工具派发 | task_call_append 1 次 | task_call_replace 1 次 |
| 原 MainTask | PLC_PRG → PRG_Keep → PRG_Existing | PLC_PRG → PRG_ReplaceMe → PRG_Keep |
| 最终 MainTask | PLC_PRG → PRG_Keep → PRG_Existing → PRG_Append | PLC_PRG → PRG_Replacement → PRG_Keep |
| 备注 | 空串、中文保留、字面文本 None 保持；新行空串 | 第二行“替换此行，保留中文备注”保持；其他行空串／None 保持 |
| SecondaryTask | 两条调用、中文／空备注及所有可读配置保持 | 同左 |
| 工具内保存／关闭／重开 | 各 1 次，读回成功 | 各 1 次，读回成功 |
| 本轮保存版真实编译 | 1 次，0 错误／0 警告，诊断完整 | 1 次，0 错误／0 警告，诊断完整 |
| 编译后独立只读核对 | 通过，未保存／编译／写入 | 通过，未保存／编译／写入 |
| 顶层任务集合换序 | 未观察到 | 未观察到 |
| 正式写前→写后→重开 PROGRAM 换序 | 未观察到 | 保存重开时实际观察到 |

追加操作 `102f3b61-852f-4ae6-8df6-2a3164a85b22`；替换操作 `2e250870-1d85-4970-8375-e16319143a3f`。桥接派发前、即时、重开核对，以及服务端独立核对均留下成功验证记录和原始快照。

替换的 PROGRAM 原始枚举为：PLC_PRG、PRG_SecondaryKeep、PRG_Secondary、PRG_Replacement、PRG_Keep、PRG_ReplaceMe；即时读回相同。重开后为：PRG_Secondary、PRG_ReplaceMe、PRG_Replacement、PRG_SecondaryKeep、PLC_PRG、PRG_Keep。六条原生 objectId、路径和全部目录字段按身份对齐一致；原始顺序没有被改写。任务集合始终为 SecondaryTask、MainTask。

这是真实 PROGRAM 目录换序下的替换正向闭环，不是实际任务调用重排。顶层任务换序的反例仍来自离线测试。本轮 task_create 的必要补修只有离线回归，未重做 task_create 真实写入。

两份工程所有六个根级 PROGRAM 的原生对象身份、完整源码、原生 ST 标识均在本轮操作前后独立读回并与准备证据核对；旧 PROGRAM 定义仍保留。MainTask 20 ms、SecondaryTask 50 ms、优先级／看门狗等可读字段保持。每次编译的磁盘哈希、源码快照及 task-configuration-v1 版本对应最终文件；之后的只读打开未改变主文件。未做额外恢复性保存、编译或 project_compare。

### 工程与退出证据

- [追加工程](<D:/InoPro-TaskCallOrder-Real-20261120-234907/append/engineering/AM610_TaskCall_append.project>)
- [替换工程](<D:/InoPro-TaskCallOrder-Real-20261120-234907/replace/engineering/AM610_TaskCall_replace.project>)

完整路径：

```text
D:\InoPro-TaskCallOrder-Real-20261120-234907\append\engineering\AM610_TaskCall_append.project
D:\InoPro-TaskCallOrder-Real-20261120-234907\replace\engineering\AM610_TaskCall_replace.project
```

最终 SHA-256：

```text
append  2cf43438d8c512d6c09327574989903f6deafdc2628d8f64be032fb744acb920
replace f7686f5309870b34f732adc29336ee3319a34fed629f26e161057d4037571114
```

8 次 MCP 工程操作（每份打开、task_inspect、授权写入、保存版编译各 1 次）均按 operationId、requestId、launchId、请求指纹、PID 创建身份核对 process-start／process-exit，退出码 0、signal=null。另 4 次独立原生只读采集（两份各前后一次）也有独立请求、创建身份、正常关闭和退出 0 记录，save／compile／add／replace 均为 0。

本次 MCP 状态查询 69 次，仅针对本轮实际生成的操作，不带 reconcile；未查询历史操作。没有冲突、新 unknown、异常退出或模型任务。8 次工程操作的真实 IPC 与账本另存副本，仅复制本轮材料。

### 文件和现场保全

本轮确实采集了每份工程目录事前和事后各 4 项文件。两份主文件、管理员 .opt 和 .projectbackup 字节改变；AllUsers.opt 字节不变但修改时间改变。主文件变化是授权追加／替换保存；其他文件变化独立列出，不能写成整个目录不变。旧轮缺少的附属文件事前基线仍是缺口，本轮不补填旧记录。

原登记目录保持 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。当前范围 14,066 项保全材料字节不变；与旧轮范围合并的 27,439 个路径记录也无字节或时间变化（路径计数可能包含同一文件的不同路径写法，不作为独立物理文件计数）。旧轮 521 项证据及固定构建文件未变。私人配置只比对指纹，不入包。

正常新增 8 个 MCP 操作；已有追加工程登记更新，新注册替换工程，当前登记／会话／租约按正式机制变化，不能宣称全部数据目录未变。原历史 unknown、隔离、锚点、IPC、检查点和旧锁均保留，未 reconcile、恢复或重新隔离。

候选服务 stdin EOF 正常退出 0；最终无 Desktop、工程服务或 IDE 进程，无未隔离在办操作，当前 service.lock 已由正式释放机制释放。旧 stale 文件保留，没有手工删锁。日常 DSH／Codex 配置和固定入口未改，日常握手仍未验证。

### 复核入口与限制

原始本轮证据：`D:\InoPro-ProgramInventory-20261121-135004`。

优先检查：before/after-node-replay.json、tests/fixtures/task-program-inventory-order.json、test-summary.json、full-node-verified-summary.json、real/fixed-preflight.json、real/mcp-run/mcp-protocol.jsonl、real/verification.json、real/operation-evidence/、各工程 read-before／read-after、files-before／final.json、history-union-final.json、old-round-after.json。复核包提供相对链接及逐文件 SHA-256。

[首次真实停止记录](task-call-inventory-order-real.md)及其 ZIP `D:\InoPro\deliveries\InoPro-review-20261121-001334.zip` 保留，SHA-256 为 `7f7b8550b69cb15f7489235fc36ac99e82f4367c194c1f4b5c531a2d3deb3834`。后续成功不覆盖原结论。

保留默认环境性能、历史 unknown／隔离、崩溃根因未确认、CmpLog、脚本信任及 Desktop 欢迎页边界。没有 PLC 连接、下载、运行或仿真；离线配置及编译不能证明实际调度、时序或业务运行。此轮只推送功能分支，不合并 main、不部署日常入口。
