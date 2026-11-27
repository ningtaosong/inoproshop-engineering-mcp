# DSH 常驻工程第一轮实测（2026-11-26）

受验产品为 `3f8c421afebb7605fd233061efb6150fc84c54d0`，0.40.0 候选／38 工具，固定目录 `D:\InoPro-ResidentDriver-Fix-20261126\fixed-3f8c421afebb`。本轮只增加验收文档，main、产品、Schema、初始化正文及日常配置未改，未合并或部署。

**DSH 第一条工程任务通过。** 安装版官方 SDK 常驻入口实际调用产品 MCP，打开指定保存文件，在同一 IDE／句柄中只将 PLC_PRG 实现区的 `ProbeDelay := T#5s` 改为 `T#7s`，再独立读取。`ProbeEnable := FALSE`、声明、两条中文注释及快照其余字段保持。只提交一次模型业务任务，一次源码修改；保存、编译、关闭及第二轮均为 0。未执行编译，不填写错误或警告数。

```st
// Native-created project: continued direct edit validation.
ProbeDelay := T#7s; // 离线测试延时设定
ProbeEnable := FALSE; // 离线测试使能
```

工程：[AM610_ResidentMCP.project](D:/InoPro-ResidentMCP-Acceptance-20261126/engineering/AM610_ResidentMCP.project)。完整路径 `D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`。磁盘仍为原5秒／FALSE保存版，SHA-256为 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。本次不证明保存持久化、编译或实际运行。

## 正式连接与请求证据

使用安装版 `DeepSeek Harness 0.2.1-rc.5` 的官方 `sdk` profile、已验账号依赖及独立临时配置。没有启动 Desktop，也没有改其欢迎页或账号。临时 MCP 指向上述固定构建，仍用原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`；没有绕过旧记录或新建空登记。

| 对象 | 本次实际身份 |
| --- | --- |
| 官方 SDK | PID14220，创建身份 `639312773164212845` |
| SDK 会话 | `a6f07ab1-bfb5-40ea-947e-b52a2c08c503` |
| 正式 MCP | PID68004，创建身份 `639312773185279553`，父PID14220 |
| 正式连接 | `68004-344a68d5-2dee-442e-9c49-ae374485c9b7` |
| IDE | PID67788，创建身份 `639312773668125243` |
| 原生 launchId | `3e818a21-4a0d-49f7-875d-a61011024922`，projectHandle 0 |
| 有限验收驱动 | PID48624，创建身份 `639312773144474596` |

同一正式连接实际收到 `initialize` 的0.40.0及完整38项 `tools/list`，无续页。被动协议记录核对实际发送的初始化原文：65,116字节，SHA-256 `546a4feddb9d5cab8b5fe4e20cacb8fe551813b555ab317849c7c6fd8769e10e`；按本客户端trim与标题口径为65,143／65,536字节。SDK `system/message` 中也存在完整固定正文；不将这一记录扩大为服务商内部上下文或Desktop日常连接验收。

| 工程请求 | operationId | 原生序号 |
| --- | --- | --- |
| project_open / resident | `b4f32904-a6bd-485f-81dd-9f8844fc8a25` | 1 |
| object_list | `5eebf1db-d6af-4bfd-a269-0ee2bce38dbf` | 2 |
| object_read（写前） | `236a23c9-de6b-4f5a-84fc-93e097c85c40` | 3 |
| code_apply_change | `27aec588-2a7d-4845-8365-6fc64683dd7f` | 4 |
| object_read（独立读回） | `3fd6dd75-54fe-4bae-93c5-1987910ed501` | 5 |

五项原请求、指纹、序号、进程创建身份、结果及 `service-verification` 逐项对应；独立复核重新使用固定产品 `verifyResidentResult`，未派发新的工程操作。写前与临派发快照完全相同，写后只变授权实现文本，独立读回与写后完整快照相同。原始快照保持采集顺序。

SDK `turn/end` seq218 于 `2026-11-26T08:12:06.881Z`（本机16:12:06）报告completed，随后 `session/wait` 返回，驱动才进入 `awaiting-next-explicit-instruction`。入队回执不作完成依据。四个进程在独立复核时均仍运行；当前没有退出回执是按授权保持打开，不是将结果文件当作正常退出。

## 流程与展示边界

一次任务实际调用：environment_inspect 1、session_status 2、project_list 1、project_open 1、object_list 1、object_read 2、code_apply_change 1、operation_status 24。状态查询只涉及本轮五项操作，无历史查询、reconcile、重新写入或第二轮。原答复准确说明7秒／FALSE、中文保留、未保存／编译／关闭，并给出工程链接；链接未点击。

工程内存修改及独立读回通过。24次状态查询、额外会话及登记读取保留，不称为高效流程；project_list 的CLI展示未构成完整JSON，原输出保留，不能据其截段声明整个登记清单已完整展示。环境能力审计的unverified仍按原值记录，不改写为全产品能力重验。旧综合任务失败、历史unknown、隔离、默认性能、CmpLog、脚本信任、崩溃根因、Desktop及PLC运行边界保持。

## 首败与比较口径修正

[客户端准备](dsh-resident-continuous-preparation.md)使用过SDK解析后的工具清单；本次被动观察器拿到原始JSON。第一空会话实际初始化成功，但预检把二者直接序列化后散列比较，因对象字段顺序差异停止，尚未提交任何 `session/prompt`，工程派发0次。

- 旧解析后摘要：`5c09ffa750fe217732c2a717bd67eb0fb3d54ce5d089c846d60d06c148755f13`。
- 旧原协议与本次原协议摘要均为：`5700c65d63cfa8a30c28200bc23c25cd1dc584904980d915b0db90990caad039`。
- 对对象键排序、保留所有数组顺序及值后，完整输入／输出Schema逐项相等，摘要 `7d4e9d5ed2adccd612df6a721ebf83485b29340a91ea1a45905bca1ef2075bcf`。

最小修正仅作用于临时验收比较视图及被动取证，另保存实际完整公开Schema。9/9离线核对包括原记录及数组换序、类型、required、null／空串和缺字段反例；不是产品回归或工程验收。首次SDK67544通过官方shutdown退出0；正式服务19872留下stdin EOF，但未取得独立进程退出码，不能补写为服务正常退出。之后正常确认原进程已不存在，再用新证据子目录重新初始化，首次真正业务提示词仅发送一次。固定产品和提示词未改。

辅助检查曾以系统Node读取Electron asar模块而失败，工程派发0；同一检查改由已安装Electron Node模式执行通过。入口预检的空进程数组输出也在启动前修正。原记录均保留。

## 旧实例移交与保全

此前[真实MCP两轮](resident-mcp-round2-passed-20261126.md)的7秒／TRUE只在旧IDE内存。随后用户明确同意不保存关闭并进行DSH第一轮。正常关闭的已识别保存提示选择“不保存”；维护过程中无效的Alt+N和一次取不到几何信息的点击保留，不视为成功。最终正常关闭IDE75528，OS退出码0及原生exit回执相符，主文件哈希保持。旧驱动只提交一次finish；服务25884、驱动65144均有OS退出0证据。

旧服务报告 `lease-retained`，pendingCount=8，并未释放原锁，不写成“租约已释放”。后续以固定产品只读验证旧关闭证明，9项旧完成证据通过、22,039份当时保全文件未变；未改判或恢复历史操作。新正式打开由产品既有规则处理旧租约，未手工删除或修改。

新业务启动前保全22,041份原登记材料。五请求后只有正常活动登记 `registry.json` 与服务租约 `service.lock` 字节更新；既有操作账本、IPC、检查点、隔离等其余文件保持。本轮新账本和IPC另计，不能称整个目录未变。工程7份既有文件内容保持，projectbackup修改时间变化；新增`.~u`占用文件另列。后续仍打开，保全结论仅属于记录时点。

## 当前等待状态与复核入口

IDE67788、MCP68004、SDK14220及驱动48624保持打开；当前内存7秒／FALSE，未保存。没有提交第二轮命令或finish。下一条业务必须另获明确指令；不能因打包或固定等待自动继续。

外层脚本仅使用官方SDK协议提交有限验收任务与取证，不实现工程功能或新聊天框架。已预留单独的正常finish入口：需另行给出工程保存／关闭决定，工程按授权正常关闭、固定产品关闭证明通过后，才可官方shutdown／EOF。它不会自动关闭IDE，也未在本次真实业务结束后触发。

本地证据根 `D:\InoPro-DSH-Resident-Round1-20261126`：根目录为旧移交与初始化首败；`attempt2`为参考口径修正后唯一工程任务。复核包索引包括原SDK协议、模型提示词／答复、被动MCP记录、五项原生请求与验证、原始前后快照、保全指纹及9/9检查。不含私人账号配置、工程二进制或OEM安装件。产品未变，不重跑全量回归；main和日常入口不变。
