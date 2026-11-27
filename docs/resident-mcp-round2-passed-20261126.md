# 同一常驻 MCP 实例的第二轮（2026-11-26）

用户在[第一轮](resident-mcp-round1-passed-20261126.md)完成后明确指示继续第二轮。本次只做一次正式MCP修改及独立读回；产品保持受验提交 `3f8c421afebb7605fd233061efb6150fc84c54d0`、0.40.0候选／38工具，没有产品修改、重新构建、全量测试、合并或部署。DSH模型连续操作未验收。

## 进入条件与实际结果

复用固定目录 `D:\InoPro-ResidentDriver-Fix-20261126\fixed-3f8c421afebb`、原登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1` 及原 `formal-3f8` 驱动。107份固定构建文件指纹一致；无queued/running操作，control为waiting且firstError=null，服务租约属于原服务。没有重新打开工程或启动IDE／服务。

三者创建身份与第一轮完全一致：IDE75528／`639312714197567046`，服务25884／`639312713471506276`，驱动65144／`639312713469044542`。launch仍为 `eb542eb8-3c46-4af2-87b1-6e81eed15195`，projectHandle仍为0。

新命令／requestId为 `9528fe77-a646-474d-aa03-ec3fb9574946`；授权原文要求保留首轮实际读回的全部源码，仅将FALSE改TRUE。驱动重新首查和现读，写入绑定本轮实际版本与源码哈希，没有携带第一轮旧写入版本或重试旧请求。

| 工具 | operationId | 同一launch序号 | 结果 |
| --- | --- | --- | --- |
| object_list | `1bbb54d8-c897-4ab3-afb9-9f152c2d2969` | 6 | 完整首查 |
| object_read | `1bf9c901-4e68-4878-9ac1-90ab3dba6ec6` | 7 | 7秒／FALSE原文 |
| code_apply_change | `38d0e98f-daec-40e7-9edc-960930e615ef` | 8 | 一次FALSE→TRUE |
| object_read | `defa0533-0b09-48da-82d1-43e43486966c` | 9 | 独立读回7秒／TRUE |

最终实现区：

```st
// Native-created project: continued direct edit validation.
ProbeDelay := T#7s; // 离线测试延时设定
ProbeEnable := TRUE; // 离线测试使能
```

固定产品的完整 `verifyResidentResult` 对四项原生请求再次只读核对通过，request/result/completed及service-verification哈希和实例归属吻合。首次读回目标与第一轮最后读回相同；写前与临派发快照严格一致；写后完整快照只变目标implementation；独立读回快照与写后完全相同。声明、7秒、两条中文、全部其他已采集字段和顺序保持，没有放宽比较。

本轮源码修改1次；当前launch两轮累计2次。保存、编译、关闭、退出均0，未调用finish、未执行第三轮。没有编译结果，不填写错误／警告数。当前IDE／服务／驱动仍运行，control返回waiting且firstError=null，等待用户下一条明确指令。

## 文件与历史保全

工程为 `D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`。主文件SHA-256始终为 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`，本轮没有保存到该文件。

本次预检实际取得8份工程目录文件的事前指纹。IDE的 `.project.autosave` 和 `.~u` 字节发生后台变化；两份 `.project-*.opt` 仅修改时间变化，字节不变；其他原文件保持。它们分别记录，不把主文件未变写成整个目录未变，也不将自动恢复文件等同于已保存交付工程。

21,997份既有登记材料没有缺失，仅registry因本轮正常请求更新；原账本、IPC、检查点、隔离和service.lock字节不变。本轮四项操作及证据正常新增。没有历史reconcile、恢复或手工清锁，最终无在办操作且原服务租约保持。

## 证据与边界

本地证据根 `D:\InoPro-ResidentDriver-Fix-20261126`：`round2/before.json`保存本轮进入条件及实际指纹，`round2/plan.json`为唯一新命令，`round2/audit.json`记录生产校验、严格差异及文件保全；`formal-3f8`继续保留同一正式连接的原initialize、38工具、两轮命令和全部请求结果。第二轮没有再初始化，工具清单归属原连接。

本次只执行相关证据核对和文档／链接检查，没有新离线产品测试。第一轮修复测试、首败、正常移交及[原复核包](resident-mcp-round1-passed-20261126.md)继续保留原归属；第二轮通过不覆盖旧失败或unknown。

可确认同一产品MCP服务、同一IDE和工程句柄支持本次两轮分别授权的内存修改及独立读回。尚不能据此宣称DSH模型连续验收、跨客户端重接、保存／编译持久化或实际PLC运行通过。旧unknown、默认性能、CmpLog、脚本信任、未定位崩溃根因及Desktop限制保持。第三轮没有自动授权。
