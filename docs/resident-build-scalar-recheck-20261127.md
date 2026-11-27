# 常驻内存编译：类型上下文补修后的真实复验

2026-11-27，`codex/resident-mcp-session`，0.41.0候选版、38项工具。受验产品为 `02e50993aebb5c02a6fdb6e8bc1998cc8a1c292a`，固定入口 `D:\InoPro-ResidentBuild-Recheck-20261127\fixed-02e5099\dist\server.js`。本轮验收驱动为 `c72ccef6751b0c6217b71067649c461b3659db63`；没有修改或热加载产品，没有合并main或部署日常入口。

## 实际结论

同一正式MCP连接及同一IDE完成打开、必要读取、5秒→7秒修改、一次内存编译和独立读回，均通过。编译0错误、0警告，完整诊断已留存；声明、FALSE及两条中文注释保持。正式修改、编译各1次，保存／重开／关闭／退出均0。没有追加TRUE任务或DSH模型任务。

使用同一原保存工程 `D:\InoPro-ResidentBuild-Recheck-20261127\engineering\AM610_ResidentBuild.project`；未创建另一份夹具、未重新准备基线。主文件SHA-256前后均为 `ecc5978e7c5dd252e7531c570ca92e886b3b5a093ccde4db5392a97aea4742f6`，磁盘仍为5秒／FALSE，当前内存为7秒／FALSE。本轮证明的是内存编译，**不是保存版编译或PLC运行验证**。

| 阶段 | 原操作及读回 |
| --- | --- |
| 打开 | `b786b0db-7878-4b6a-9588-7603d91bb528`；正式关闭证明通过后打开原保存字节。 |
| 定位及写前读取 | 一次object_list、一次object_read；读到5秒／FALSE、实际原生ST身份和声明。 |
| 唯一修改 | `84b50c76-30af-4021-9916-bc5614e6408f`；只改T#5s为T#7s，随后独立object_read一致。 |
| 编译前新读取 | 读取当前7秒／FALSE，project_build绑定这一次返回的residentVersion。 |
| 唯一编译 | `a16a6e0f-c205-455c-9e63-83db61f92e94`；succeeded、completed、diagnosticsComplete均成立，0错误／0警告。 |
| 编译后独立读取 | 新object_read确认7秒／FALSE，声明、原生身份、中文、磁盘哈希和编译后residentVersion一致。 |

正式8项操作均由固定产品的 `verifyResidentResult` 事后只读复核：请求指纹、operationId/requestId、launch、顺序、进程创建身份、原生完成回执及服务独立验证均一致。58次状态查询只查询本轮原操作，没有历史reconcile或重发；不将查询数量描述为效率验收通过。

## 本次编译实际改变与保留

`before.state`与`predispatch.state`完全一致，设备上下文也一致：上一轮11项nativeType变化未再出现。程序集支持证据前后相同。旧直接库完整保持，编译在索引17新增一条系统占位符引用 `#IecVarAccess`：有效解析 `IecVarAccess, 3.5.11.0 (System)`，默认声明 `IecVarAccess, 3.3.1.20 (System)`，显式覆盖为原生null、is_redirected=false、is_managed=false、system_library=true。其他原生字段及来源均见原始记录，不能把“原引用保持”写成“整个库清单未变”。

本次没有新增派生设备。原有设备／连接器、相对树结构、源码和任务调用通过严格保全规则；未删除nativeType或忽略类型变化，也未扩大编译派生结构的允许范围。

## 维护与仍保留的实例

先按本轮明确授权，对旧IDE61896／`639313400007783152`执行正常关闭并选择不保存，实际退出码0；其launch为 `b3c47d3c-01be-4d89-af02-82a43fda8ec2`。随后只结束获授权、无正常控制入口的旧驱动68036／`639313395436351401`，观察码-1；MCP28312／`639313395438897107`随EOF自然退出0。三者均有持有进程句柄的独立退出观察及时间。没有强制结束IDE或MCP，没有调用已知不适用的旧finish辅助。

固定产品正式只读 `verifyClosedResident` 核对旧会话五项请求、零派发conflict、原文件身份／哈希和正常退出后，允许本次显式打开。没有恢复旧内存或改判旧操作。

本轮最终保留：

- IDE72140／创建身份`639313425004690376`。
- MCP67608／`639313424421375248`。
- 验收驱动71748／`639313424418410795`。
- launch：`07ac4311-0d96-445f-ad42-0d53c5640beb`。

工程、服务和连接仍打开，未保存。新实例没有退出回执是本次按授权保持打开的结果，不伪造退出码0。驱动恢复为等待明确指令，提供finish控制，但本轮没有调用；finish仅结束客户端输入，不能代替IDE保存／关闭授权或绕过服务的退出保护。

## 版本、测试及保全

- 107项固定产品文件与02e5099指纹一致；实际独立连接收到0.41.0、完整38项工具及相同输入输出Schema。初始化正文65,135字节，按已验客户端标题口径65,162／65,536；不是DSH模型接收证据。
- 本轮仅扩展已有验收驱动的显式build动作和失败后可用的finish控制，49/49定向Node检查归c72ccef。覆盖最新版本绑定、只编译一次、独立读回、缺证／失败停止、去重、发布失败与正常EOF入口；没有全产品回归。产品补修的既有IronPython、CPython及Node记录仍归[上一轮](resident-build-recheck-20261127.md)，不与49相加。
- 新预检首次把带checksum的操作账本外壳直接当作操作读取，报KeyError `status`，发生于新服务启动前；随后按value取内部记录，并由正式Store及准入再次验证。没有工程派发或历史写入。
- 维护前22,387项登记目录材料，最终22,480项。既有字节变化仅registry、service.lock和旧接收器stdout的正常退出追加；93项新增记录单列。历史操作账本、IPC、检查点、隔离及旧锁无字节变化、无缺失。登记和租约由正常新请求更新，不能说整个目录不变。
- 工程附属文件单列：当前project用户选项、autosave及`~u`占用文件字节变化；AllUsers选项和projectbackup仅时间变化。主工程字节保持；源文件初值不等于内存状态或运行值。

## 原证据与复核入口

本轮原始证据目录：`D:\InoPro-ResidentBuild-ScalarRecheck-20261127`。从 `formal-verification.json`、`initialize-check.json`、`closed-proof-and-fixed.json`、`preservation-summary.json`、`engineering-diff.json`以及MCP journal进入。编译IPC含before、predispatch、checkpoint、dispatch、compiler-result、安装件前后侧证、after和service-verification，包内按原操作分别保存。

上一轮[冲突与标量上下文补修](resident-build-recheck-20261127.md)及复核包 `D:\InoPro\deliveries\InoPro-review-20261127-095434.zip`保留，SHA-256为 `8757f35e926c5f0f96bb8d630260447491fe0fced3405183b698e7559c70ed3d`。原unknown `bf310d71-3e21-421b-9c78-233f4a72dd17`仍为unknown，原conflict仍为conflict；本次成功不补写旧编译字段或历史退出。

本轮没有DSH编译任务、保存持久化或PLC验证；0.39结构体新增字段未完成真实验收，0.41其他迁移范围不扩大。历史unknown、隔离、原故障、默认性能、崩溃根因、CmpLog、脚本信任、Desktop及运行未验证继续保留。未合并main、未部署、未开始下一轮。
