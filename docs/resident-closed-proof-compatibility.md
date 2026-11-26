# 已关闭 resident 会话的历史证明兼容（2026-11-26）

继续0.40.0候选／38工具，未合并或部署。本轮按明确授权正常关闭IDE64528且不保存；原生退出0、signal null。驱动56920的正常finish发送EOF，服务70268及驱动均OS退出0。服务记录shutdown-completed，但原释放条件pendingCount=8，明确记录lease-retained；没有手工清锁或改变历史unknown。主文件仍为`8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。

随后固定941a079重新显式打开同一文件，操作`34d1bbd4-0437-48a0-946f-287a6fb52bb4`在IDE派发前返回conflict／`RESIDENT_RECONNECT_UNSUPPORTED`：`Prior resident reopen proof unavailable: Excluded object coverage differs`。它没有resident标志、bridge或IPC目录，没有新IDE、写入、保存或编译。原驱动又将这个服务端冲突显示为完成证据缺失；原始MCP结果仍在journal，不能把本次写成IDE unknown。

## 两项最小修复

1. `verifyClosedResident` 原先调用当前 `verifyResidentResult`，使用新ST规则重算旧版列表的excluded，因旧版曾排除正常PLC_PRG而拒绝。只读重放相同归档：旧db647验证接受，新941拒绝。现在抽出稳定完成回执核对，历史证明仍核对原operation/request、指纹、原生result、completed、passed service-verification及两侧哈希、序号、创建身份、正常退出、原服务退出和文件身份／磁盘版本。历史业务分类以当时绑定的验证记录为依据，不再用新版规则重判旧列表。当前请求仍调用完整业务校验。缺证、哈希不符、unknown、未确认退出或活实例仍拒绝，不重写任何历史记录。
2. 验收驱动遇到没有residentEvidence的服务端非成功结果时，保留完整原结果和原错误码／消息，停止业务并保留finish。缺少原生回执不构成零派发证明，也不据此自动重试或允许下一业务轮。

原related扫描只包含resident操作；本次未派发冲突不属于原生序列。保留这一语义并加回归，没有扩大修改范围。

## 验证归属及下一步

[真实旧会话输入](../tests/fixtures/resident-closed-list-20261126.json)保留15份源文件指纹；离线用例仅替换文件／进程环境，不改旧版分类结果。生产关闭证明首败1项、驱动原错误保留首败1项分别归档。补修后resident、历史证明和驱动定向 **122/122**；构建、类型检查通过。此前产品两端ST补修的Node141/141、CPython37/37、IronPython37/37各属原阶段，本轮未改Python或重跑全量。

新旧业务校验的边界用例同时断言：新业务验证仍拒绝旧excluded列表，而历史完成证明在完整归属链下通过且文件字节不变。请求／结果／完成哈希、验证缺失、错误退出、活实例和unknown反例仍拒绝；未派发冲突不进入旧序列。

本阶段补修不代表首轮5秒→7秒已经执行。当前无IDE的941驱动／服务按已有正常收尾授权使用finish；随后仅使用新固定构建、新请求号和原文件继续已授权首轮。成功后保持打开、不保存、不编译、不自动提交第二轮；失败保留原始结果，不盲目重放或换夹具。实际结果另行归档。
