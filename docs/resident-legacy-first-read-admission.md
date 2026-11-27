# 旧首次读取失败的限定兼容与新观察准备

2026-11-27，`codex/resident-user-save-continuation`，基于 `cd8865f2c9a01d4abbdc0a4b760a13b476e38afd`。保持 **0.41.1 候选版、38 项工具**；main、Schema、初始化正文、日常 DSH 0.38.0 和 Codex 配置不变。只完成兼容补修、离线验证及真实目录只读准入评估；没有启动 IDE、取得租约、打开工程、修改、编译、保存或发送模型任务。

## 已解决与尚未执行

旧诊断首查缺少原始 `ownership` 和 `before`，上一轮因此拒绝，见[当时记录](resident-early-read-reopen.md)。本轮利用原固定脚本、完整原异常栈及既有正常退出证据，限定证明该版代码已从工程归属校验返回，然后在保存观察器导入处失败。可以为同一未变保存文件评估一个新的明确 resident 打开；没有恢复旧会话、补造原生句柄值或改判 unknown。

实际登记目录的最终只读评估：旧操作影响范围为本工程，`globalFrozen=false`；同一路径的新 resident 请求可通过该准入检查，batch、旧 requestId 仍拒绝。这里只调用生产判定函数，没有受理工程请求或启动服务。未来真正派发前仍须复核完整证据、进程和租约。新计划及固定构建仅供复核，`approvedForLaunch=false`，本轮不执行。

用户手动保存后的来源事件链、同会话继续修改尚未实测或实现。新的观察会是同一保存文件的新实例，不冒充已结束的旧实例。

## 固定旧控制流证据

原操作 `21483495-6efb-44ba-af19-2c1865548a9c`、请求 `ced632e5-6a71-4643-b9c0-294d9dcb4bba`、launch `bfe675e3-b285-400d-bdde-eb66d2b5dcb5` 均保留。原错误仍为 `ImportError: No module named _3S.CoDeSys.Core`。

| 原代码位置 | 证明范围 |
| --- | --- |
| 固定 `resident_core.py:447` → `snapshot:181` | 第一次 inspect 进入快照前置流程，未取得完整快照 |
| 固定诊断 `resident_host.py:67` | 此处调用 observer.install 前，未捕获异常的 base `_owned` 已返回 |
| 固定 core `_owned` | 实际打开返回对象、primary、all 的路径、分类、句柄唯一性及额外非库工程校验先于返回 |
| 固定 `resident_save_observer.py:146` | 导入失败发生在取得 engine manager 和挂接保存事件之前 |

这是**控制流推导**，不是原始 returned/primary/all 数值。原日志没有这些读数，本轮没有生成它们。完整四帧路径、行号、语句和错误类型均核对；同文案的其他错误不适用。

生产兼容判断固定五个代码角色的 SHA-256，并固定完整清单索引（仅排除固定目录绝对根）：

| 角色 | SHA-256 |
| --- | --- |
| 诊断入口 | dcd16c6ecba2b0cb7acbdffacb2ddfb334d10de2080346ffe972278ccfaf6a0a |
| 原 core | cea41379f4f5d068552f5995e0b0bd99533fd0f0041d7d44604da657634052e5 |
| 原 host | d9beab321ecb4a7af96fafea0c53f679c6a403220158afe1952404dce32998d6 |
| 原 observer | ecd40955fda95c21d3950ea568a84dc2d3dda24f722e416b0a98ba7e7bcbb500 |
| 原 client | 32b0c5e5e8ba4d59214e47d3fd74ec032ce8d10558bc92f7b62e0b4c74cb30b0 |
| 完整 manifest 规范内容 | dc70ce55cecec2acaf183675e03e204d92cab4b692fabe9251ff24b3eaff47cf |

计划的目标、固定角色、数据目录及旧版本必须一致。计划和清单同时保留语义指纹与原字节指纹，返回的 recheck 直接复读两者原字节，连空白变化也拒绝，不依赖调用方缓存。五份源码也重读；非普通文件或路径别名拒绝。离线归档核对了原固定目录全部 123 项；产品兼容路径读取五个相关代码角色并固定完整索引，不声称每次读取全部 123 项。

测试夹具中的五份源码只作为字节材料，不能导入或执行。`.gitattributes` 禁止换行转换；原目录、旧 client 和清单均未覆盖。

## 仍严格拒绝

- 非唯一首次 inspect、额外队列、额外写入/编译证据、secondary error、保存或重开记录；错误字段、完整栈或源码不符。
- 原进程仍在或身份不明、退出非零或缺失、服务收尾不完整；仅进程消失不能通行。
- 文件身份或版本变化；计划/清单/源码在判断中变化；不支持的元数据字段。
- 旧 requestId、旧会话请求、batch 或文件别名。新会话还需其自身归属、读回与当前版本保护。

原 native ownership receipt 路径的证明结构和哈希语义保持不变。仅 legacy 分支增加 `legacy-fixed-control-flow`、`nativeRawOwnershipAvailable=false` 等明确标记；两种证明不混同。

## 遗留 Node 进程归属

PID 60892 的 .NET 创建标识 `639312602842523432` 与 2026-11-26 原 transport start 一致；父 PID 61480 对应 `stdio-observer.test.mjs`，其父 PID 15844 为当时完整离线测试。三者与原归档创建身份一致。原测试目录只有合成工程 JSON 与 service-start，未建立服务数据目录；真实登记没有由 60892/61480 持有的操作，当前旧服务/源锁归属 69356。

所以无需为本轮接管该离线测试进程。本轮不连接、不终止它；原 transport 没有退出回执，未声称已经正常退出，也未根据当前磁盘 dist 推断其已加载版本。CIM 时间截断与精确 .NET ticks 的差别原样保留。

## 验证归属及首败

| 检查 | 本轮结果 |
| --- | --- |
| 构建、类型检查 | 通过 |
| pending/history/client 相关 Node 集 | **137/137**；独立临时目录，生产服务替身及判定路径，不是真实 IDE |
| 当前会话版本/缺证冻结定向 | **3/3**，单独记录，不与上行相加 |
| 真实目录最终只读评估 | 新 resident 准入通过；旧 request/batch 拒绝；22,610 项保全材料无字节变化 |
| 工程动作 | 打开、修改、编译、保存、reconcile、租约取得均为 0 |

保留第一次 123 项受影响测试中 122 通过、计划复查反例失败：第二次全新评估接纳未知字段，且 helper 自身还需直接字节复核。随后限定已审核字段，补齐计划和清单直接字节复查及独立反例，最终以上 137 项通过。另保留只读保全收集器并发读取触发 EMFILE 的首败，发生在准入评估前；改为顺序读取后通过。两项均未启动 IDE，未更改历史数据。

未重跑无关全量、Python 或真实工程验收。先前默认 200 ms／临时目录问题不因本轮通过而消失。

## 新诊断入口准备

当前诊断 client 原来写死 0.41.0，已改为严格核对新计划 `expectedServerVersion`、固定 manifest 中唯一 package.json 的字节及版本、实际握手版本和完整工具名。新计划必须明确写 0.41.1；缺失、范围字符串、其他版本或错固定入口拒绝。只改诊断入口，旧固定 client 字节仍供历史控制流核对。

同一目标：`D:\InoPro-Resident-UserSave-20261127\engineering\AM610_UserSave.project`，文件身份 `3318604606:844424934751332`，SHA-256 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。原账本 SHA-256 `65a1d471366ae4d6d045cbd64f156e34234f3fc31bd56032ba4f61f33e0ed946` 保持。没有复制或新建工程。新固定代码、诊断包装差异及准备计划在复核包中逐项列出，实际启动尚未执行。

旧证据入口：[观察准备](resident-user-save-continuation.md)、[原导入失败与补修](resident-save-observer-import-recheck.md)、[上轮新归属取证](resident-early-read-reopen.md)。旧 unknown、隔离、账本、锁和退出缺证不修复或回填；默认性能、CmpLog、脚本信任、崩溃根因、Desktop 和 PLC 运行边界保留。
