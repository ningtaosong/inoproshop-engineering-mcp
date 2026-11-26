# 常驻 MCP 第一轮修改与独立读回（2026-11-26）

0.40.0 候选／38工具，分支 `codex/resident-mcp-session`；本次受验产品 **`3f8c421afebb7605fd233061efb6150fc84c54d0`**。main、日常入口和私人配置不变，未合并或部署。该提交之后的本记录只补充验收文档。

## 实际结果

在同一新 IDE、同一工程句柄中，正式MCP完成打开、首查、源码读取、一次 `code_apply_change` 和独立 `object_read`。只将实现区 `ProbeDelay := T#5s` 改为 `ProbeDelay := T#7s`；声明、`ProbeEnable := FALSE`、两条中文注释及完整快照其余字段保持。桥接写前与临派发快照完全一致；写后与独立读回快照完全一致。

```st
// Native-created project: continued direct edit validation.
ProbeDelay := T#7s; // 离线测试延时设定
ProbeEnable := FALSE; // 离线测试使能
```

本轮只派发一次源码修改；保存、编译、工程关闭和IDE退出均为0。修改只在内存，没有第二轮、DSH任务或PLC操作。编译没有执行，不填写错误／警告数，不宣称保存持久化、实际计时或调度通过。

工程：`D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`。主文件始终为 SHA-256 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`，文件身份 `3318604606:281474981099691`。

## 新固定版本与同一实例证据

固定目录：`D:\InoPro-ResidentDriver-Fix-20261126\fixed-3f8c421afebb`。独立SDK连接实际收到0.40.0及完整38工具；初始化正文65,116字节，含客户端标题65,143／65,536字节。Schema与初始化正文没有随本次补修变化，不代表DSH模型已接收。

| 请求 | operationId | 原生序号 | 结果 |
| --- | --- | --- | --- |
| project_open | `3f375a97-eb56-47fe-b9f9-722681cf17e9` | 1 | 打开成功，未保存 |
| object_list | `5e67c6ab-b929-42b9-8fc1-a58ee4ef9581` | 2 | 目标正常列出 |
| object_read | `e3d7247d-d196-4163-b7b5-c9cee9d2258e` | 3 | 当前5秒、FALSE及中文 |
| code_apply_change | `8141f3c2-f611-4be4-8cfe-8b4dcd823cb9` | 4 | 一次5秒→7秒，未保存 |
| object_read | `c0ed399e-8d7c-4d8b-8ee7-e58b4419ba35` | 5 | 独立读回7秒及保留内容 |

正式修改 requestId／驱动命令ID为 `7af44ba0-b926-466d-a2ba-8a0ef43a9889`。它与检查点、派发记录、原生请求／结果、completed和passed service-verification逐项绑定；复核脚本调用固定产品的完整 `verifyResidentResult`，五项均通过，不仅依赖工具的succeeded。

全程 launchId `eb542eb8-3c46-4af2-87b1-6e81eed15195`，projectHandle 0：

- IDE PID75528，创建身份 `639312714197567046`。
- 服务 PID25884，创建身份 `639312713471506276`。
- 驱动 PID65144，创建身份 `639312713469044542`。

最后复核三者仍运行，控制状态waiting且firstError=null。新模式的请求完成回执与进程退出分开；本次按授权保持打开，没有新实例退出回执，也不需要退出才能报告内存请求完成。下一业务轮必须另获明确指令，不自动继续、不保存或关闭当前实例。

## 本次之前的失败与正常移交

原[首次列表版本冲突](resident-mcp-first-round-20261126.md)、[声明对象＋ST实现误排除](resident-st-parts-fix.md)仍为各自失败。经明确授权，IDE64528正常不保存关闭并取得exitCode=0、signal=null；原驱动56920正常finish，服务70268及驱动均OS退出0。旧服务记录shutdown-completed，但因pendingCount=8记录lease-retained，不能写成已释放，也没有手工删锁。

下一固定941a079的打开操作 `34d1bbd4-0437-48a0-946f-287a6fb52bb4` 在派发前conflict：新版ST分类被用于重算旧列表excluded，导致旧关闭证明失败。没有IDE、IPC或原生派发。驱动另出现笼统完成证据缺失，原始MCP冲突仍归档。服务71468正常EOF退出0，驱动63720保留首错正常退出1，无强制结束。具体修复见[历史完成证明兼容](resident-closed-proof-compatibility.md)。

最终固定3f8c421先只读验证旧关闭证明，21,943份当时既有材料字节不变；随后以新请求打开同一保存文件，执行本次首轮。旧证明仅核对稳定完成协议及原服务绑定的历史验证，不用新规则重判旧业务分类；本次新请求仍执行全部当前业务校验。未恢复、改判或reconcile旧unknown。

另保留本次取证预检的GBK默认解码失败：发生在提交新打开之前，改为明确UTF-8读取后才提交唯一打开；不是原生请求失败，也不是再次打开。

## 保全与验证归属

本次主文件不变。与 `formal-941-engineering-before.json` 比较，附属文件新增当前工程的 `.~u` 占用文件，projectbackup仅修改时间改变、字节不变，其余原有附属文件字节不变；不声称整个目录不变。

对最初移交前21,904份登记材料逐项核对，没有缺失。变化仅为正常打开／编辑更新的registry、正式机制获取的service.lock，以及先前正常关闭追加的旧launch stdout；原操作账本、IPC、检查点、隔离及其他历史字节保持。本次五项账本、检查点和原生证据正常新增；最终无running／queued操作，当前服务租约仍由25884持有，不手工释放。

| 归属 | 检查 | 结果 |
| --- | --- | --- |
| 5a528c85，两端ST组成识别 | Node定向 | 141/141 |
| 5a528c85，桥接ST识别 | CPython／本机IronPython | 各37/37，分别记录 |
| 941a079，驱动当前源码版本 | 驱动定向 | 33/33 |
| 3f8c421，旧完成证明及原错误保留 | resident／驱动／历史证明 | 122/122 |
| 3f8c421固定构建 | 构建、类型、Schema、指令大小 | 通过 |
| 3f8c421，实际同句柄首轮 | 正式MCP五请求、一次修改及独立读回 | 通过 |

各组不相加，不称全量回归；修复前失败、测试定位首败和真实停止记录保留。原默认环境性能、未知崩溃根因、CmpLog、脚本信任、Desktop及实际运行限制继续保留。

## 复核入口

本地证据根目录 `D:\InoPro-ResidentDriver-Fix-20261126`：

- `formal-3f8`：原协议、38工具、唯一首轮命令和前／后读回。
- `round1-3f8-audit.json`：固定产品完整验证、实例身份和只变实现区的严格对照。
- `round1-3f8-preservation.json`：历史保全及附属文件逐项指纹。
- `proof-3f8-readonly.json`、`proof-fixed-manifest.json`：旧关闭证明只读验证和固定构建来源。
- `formal`、`formal-941`及各before/after测试记录：原失败、正常移交和修复归属，均未覆盖。

交付包提供对应原生五请求的全部IPC、同一launch入口及完成证据，不含工程二进制、账号配置或OEM安装件。工程和服务保持打开，打包不是服务收尾或第二轮授权。
