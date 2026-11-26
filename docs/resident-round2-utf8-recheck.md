# 同一 IDE 的第二轮未保存修改复验

2026-11-26，在第一轮成功且等待明确提交后，按用户再次“继续”的授权，只提交第二轮一次。受验固定实现仍为 `c8d4b9adff44831b5e9346651003e23e354e8d79`；未改产品或诊断代码，分支仍为0.39.0候选版、38项工具，未合并或部署。

**第二轮通过。** 步骤4的写前读取和内存检查点与第一轮result3的编辑依赖一致，保留第一条中文；只追加第二条，步骤5独立读取后取得正式round2及五请求完成回执。最终实现原文：

```iecst
// Native-created project: continued direct edit validation.

(* 未保存连续请求：第一处注释 *)

(* 未保存连续请求：第二处注释 *)
```

只改变授权目标的实现文本，其余编辑依赖保持；完整原始观察保留，不把非依赖后台观察概括为整个工程状态不变。第二轮open=0、read=5、replace=1；两轮累计open=1、read=12、replace=2。compile／save／close／exit均为0，没有编译结果，不填写错误或警告数。

## 同一实例与停止边界

- IDE `12176 / 639312571935094656`、观察器 `36348 / 639312571795594874`、只读保护助手 `52968 / 639312571869323009` 均与第一轮相同；launchId为 `524a59a2-0586-40cf-8938-f527af145070`，projectHandle保持0。
- 固定目录仍为 `D:\InoPro-ResidentRound1-Utf8-20261126\fixed-c8d4b9adff44`。唯一提交为该目录的 `submit_resident_round.mjs`、原intent及参数2；退出码0。没有新IDE、工程请求重放或第三轮。
- `native-0044-receiver-stopped.json`明确completed=5、firstError/sessionError=null、ideExitRequested=false。固定五步接收器完成停止；IDE、工程和两次未保存修改继续保留，观察器及保护助手未退出。
- **通过范围仅为独立原生两轮诊断，不是已交付的正式MCP／DSH连续会话，也不能直接接受第三轮或无限对话。** 下一步产品接入另行限定；本轮没有保存或关闭授权。

## 保全、首败与证据

工程为 `D:\InoPro-ResidentMemory-20261125\engineering\AM610_ResidentMemory.project`，fileId `3318604606:281474980984855`；主文件SHA-256保持 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。实际登记目录仍为 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。

本轮前后262项保护材料、82份第一轮已发布文件、107项固定文件及两份租约字节保持。工程附属 `.project.~u` 内容和时间发生变化，前后指纹单列；不宣称整个目录未变，也不手工清理锁或租约。没有历史reconcile、隔离变更或旧结果改判。

两个取证准备错误分别为Node ESM的Windows绝对路径导入形式和对附属目录作文件读取；均在第二轮提交前停止，原脚本和错误记录保留。修正的只是离线取证，未改原生守卫或重发业务请求。随后只对已发布证据进行复核，未再采集工程、重跑测试或模型任务。

新证据目录：`D:\InoPro-ResidentRound2-Utf8-20261126`。入口为 `preflight.json`、`submit-round2-exit.json`、`round2-verification.json`、`preservation-final.json` 和 `processes-final.json`。原生新增证据仍在第一轮的 `run-01`：步骤4／5请求、检查点、派发、前后原文、完成哈希、`round-2-result.json`、`resident-result.json`及接收器停止记录。核对工具只读取这些原记录。

[第一轮说明](resident-round1-utf8-recheck.md)及其原ZIP `D:\InoPro\deliveries\InoPro-review-20261126-103903.zip`（SHA-256 `31d07239d4586d08b7322f8cdb8e0989e69b2c8bb1c9f437440fe1c0604720ec`）保持原字节和当时结论，不回填第二轮。加载补修的离线测试仍归[原实现](resident-loader-utf8-fix.md)。原编码首败、历史unknown、默认性能、崩溃根因、CmpLog、脚本信任、Desktop、PLC运行及跨服务重连限制继续保留。
