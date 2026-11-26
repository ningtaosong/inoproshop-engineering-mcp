# DSH 同一常驻工程第二轮实测（2026-11-26）

受验产品仍为 `3f8c421afebb7605fd233061efb6150fc84c54d0`，0.40.0候选／38工具；本轮只提交验收文档，产品、Schema、初始化正文、main及日常入口未变。

**第二轮通过，保持打开。** 在[第一轮](dsh-resident-round1-20261126.md)正式完成且用户另行明确“那就继续”后，使用原官方SDK会话发送一次第二条自然语言任务。模型实际读取当前7秒／FALSE，只将 `ProbeEnable := FALSE` 改为 `TRUE`，保留7秒、完整声明、两条中文及其余原文，随后独立读回。外层脚本只做预检、提交官方SDK请求和取证，没有代模型修改源码。

```st
// Native-created project: continued direct edit validation.
ProbeDelay := T#7s; // 离线测试延时设定
ProbeEnable := TRUE; // 离线测试使能
```

工程：[AM610_ResidentMCP.project](D:/InoPro-ResidentMCP-Acceptance-20261126/engineering/AM610_ResidentMCP.project)。完整路径 `D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`。磁盘主文件仍为5秒／FALSE保存版，SHA-256 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。当前7秒／TRUE仅属未保存编辑状态，不表示编译、持久化或PLC运行通过。

## 同一连接、不同轮次

| 项目 | 两轮共同身份或本轮时点 |
| --- | --- |
| 官方SDK / 创建身份 | PID14220 / `639312773164212845` |
| 会话 | `a6f07ab1-bfb5-40ea-947e-b52a2c08c503` |
| 正式MCP / 创建身份 | PID68004 / `639312773185279553` |
| 正式连接 | `68004-344a68d5-2dee-442e-9c49-ae374485c9b7` |
| IDE / 创建身份 | PID67788 / `639312773668125243` |
| 原生launch / 句柄 | `3e818a21-4a0d-49f7-875d-a61011024922` / 0 |
| 有限验收驱动 / 创建身份 | PID48624 / `639312773144474596` |
| 第一轮completed | 2026-11-26 16:12:06.881（北京时间），seq218；随后wait返回 |
| 第二条实际提交 | 2026-11-26 16:29:26.055，晚于首轮completed和wait返回 |
| 第二轮completed | 2026-11-26 16:31:07.275，seq359；随后wait返回 |

第二轮没有initialize、tools/list、project_open、新客户端或新IDE。两轮累计只有一次SDK initialize、同一正式MCP的0.40.0／38工具清单，以及两条分别提交的 `session/prompt`。第一轮的实际初始化原文和Schema证据继续有效，不伪造第二次握手。官方SDK保持输入管道；`session/prompt`入队回执不作完成依据。

## 原生请求与独立核对

| 本轮请求 | operationId | 原生序号 |
| --- | --- | --- |
| object_read（当前状态） | `b98df02f-4754-4bf4-aece-4ae9091fa159` | 6 |
| code_apply_change | `00abd95a-65d0-4c22-9876-d4be1a4bf7a9` | 7 |
| object_read（独立读回） | `db96e150-7d1d-4a52-866a-ef402425f9bd` | 8 |

本轮修改requestId为 `resident-edit-probeenable-20261126-02`。三个请求、检查点、派发、completed和service-verification与同一launch／PID创建身份逐项对应；复核再次使用固定产品的 `verifyResidentResult`，未发送额外工程请求。

写前与临派发快照严格相等；写前实现与第一轮末次独立读回一致。将唯一 `ProbeEnable := FALSE;` 替换为 `ProbeEnable := TRUE;` 后，预期完整快照与实际写后严格相等；再次独立读回与写后相等。未排序数组、删除字段或忽略缺证。声明、7秒、两条中文及非目标快照字段完整保持。

本轮一次修改，两轮在同一launch累计两次修改；本轮及该launch的保存、编译、工程关闭、IDE退出均为0。没有编译，不填写错误／警告数。常驻请求完成与进程退出不同；最后四个进程仍运行，没有退出回执是保持打开的预期状态。

## 模型流程与现场保全

本轮模型实际调用session_status 1次、object_read 2次、code_apply_change 1次、operation_status 18次，共22次。18次状态查询全部只关联本轮三个原操作，没有历史查询或reconcile=true；未重放修改、比较、保存、编译或重开。原答复准确说明7秒／TRUE、中文保持及未保存状态，工程链接未点击。18次状态查询保留，不宣称流程效率全部通过。

事前核对固定构建107份文件、原控制脚本指纹、四个创建身份、0项在办操作，第二轮和finish命令均未存在；再保全22,095份既有登记材料及当时工程附属文件，才提交唯一命令。不是从旧快照假定当前内存，当前源码由模型实际重读。

本轮后22,095份既有材料仅活动 `registry.json` 正常更新，其余既有账本、IPC、检查点、隔离、租约及锁字节保持；两个实际租约／锁及12份既有客户端profile均保持。新请求的账本和IPC另计，不称整个登记目录未变。

主工程文件哈希保持；IDE后台 `.autosave`、`.~u` 内容变化，两份 `.project-*.opt` 仅修改时间变化，逐项前后指纹保留。自动恢复文件不是主工程已保存的证明。未打开或处理封存现场，不恢复旧账本、不删锁、不改变隔离。

## 当前状态与下一步边界

控制状态 `two-rounds-complete-kept-open`、firstError=null。SDK14220、MCP68004、IDE67788、驱动48624仍保持；没有第三条业务或finish。现有有限驱动只验收两轮，不将两轮通过写成已实现通用聊天客户端、无限轮次、跨服务重接或38项工具全部支持resident。

用户后续的保存、关闭或其他业务决定应单独处理；不会因本次打包自动保存、编译、退出或恢复旧内容。预留官方shutdown入口仍须先有明确工程处理决定及可信关闭证明，本轮未调用。

首轮Schema口径首败、旧移交及正常退出记录继续归[第一轮说明](dsh-resident-round1-20261126.md)，不改写历史。默认性能、历史unknown、隔离、CmpLog、脚本信任、崩溃根因、Desktop日常连接与PLC运行边界保留。本轮无产品变化、没有新增测试计数或全量回归，不合并main、不部署。

复核根 `D:\InoPro-DSH-Resident-Round2-20261126`：`before.json`、`submitted-command.json`与`submission.json`为本轮事前与唯一提交；`audit.json`为生产验证及完整快照对照。原SDK持续日志位于 `D:\InoPro-DSH-Resident-Round1-20261126\attempt2`；复核包截取本轮完成时点的两轮协议、实际调用、三个IPC目录和同一launch证据，保留首轮包路径及SHA-256，不复制工程二进制或私人配置。
