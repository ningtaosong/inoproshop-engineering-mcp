# S5b DSH CLI 单次模型验收记录（2026-11-17）

本轮沿用 `codex/s5b-library-dialog-integration` 的产品提交 `b9d3a6bdcc34128bf65e7e3cbc544e1707299f3b`，版本 0.28.0、31 项工具；未修改产品、合并 main 或永久部署候选。实际登记与四项既有隔离所在目录为 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。另一条 `D:\InoPro.local\...` 路径不是同一目录。

## 独立夹具

目标为 `D:\InoPro-S5b-CLI-Final-20261117\AM610_Placeholder_CLI.project`。从已验正常样例复制时，主文件 SHA-256 为 `5e93ac6bc08f4b15986a118c86f2b0a4e7fbda7f68a8c054b21570522ef531d`。原生准备脚本只添加普通 `#S5bDemo` 占位符、保存、关闭和发布结果，没有设置显式覆盖、接入最小调用或额外重开。脚本结果 `passed=true`，阶段包括 catalog、open、inspect-before、add-placeholder、save、inspect-after-add、close、result-publish；监测器记录 IDE PID 60952 的进程创建身份、退出码 0、结果发布完成、`status=succeeded` 和租约释放。准备后主文件 SHA-256 为 `84c36bf721f45d25122ae5af5746a72556de96927f2c6e5071f0999180b5cb99`。这仅证明夹具准备，不是 S5b MCP 写入或 CLI 验收通过。

## 唯一一次 CLI 任务

任务原文保存在 `dsh-task.txt`，SHA-256 为 `b4c5234fdc14bef8b82174da49415cd93db1f629c373e00b375b155d22b8882e`。命令行使用官方 `dsh.cmd --profile headless --patch <临时覆盖> --json -`，UTF-8 任务从文件经标准输入传入。临时覆盖把 MCP 入口指向上述固定构建，并沿用实际登记目录；未修改 DSH Desktop 私人配置。静态组合配置核对到了候选入口与模型路由，**不能代替客户端实际初始化或工具接收证据**。

CLI 原始事件给出会话 `session-a07b3aba-1324-4633-9b40-2eba27006c2d`，随后在第一步结束前报 `ACCOUNT_SIGN_IN_REQUIRED`：账号提供方要求在该请求目标完成 DeepSeek 登录。进程退出码 1，最终答复为空。没有模型工具调用、`project_open`、`library_placeholder_resolve`、源码修改、编译、保存或读回；因此工程闭环、流程遵循与答复展示均**未验收通过**。本轮没有重交任务、切换模型或权限，也没有用外部脚本代替模型执行目标修改。主文件在 CLI 前后保持上述准备后 SHA-256。登记只读查询未见本次新增工程操作；四项历史 `unknown` 与四项正式隔离保持。

## 服务收尾与后续条件

候选 CLI 退出后无候选服务进程或服务锁。按原私人配置正常启动 DSH Desktop，观察到 PID 55520 的 Node 服务入口为 `direct-open-daily-fixed-0271\InoPro\dist\server.js`；未取得这次最终连接的初始化握手、30 项工具接收或模型遵循证据。Codex 0.16 入口未改。

后续需要在 DSH CLI 所用账号提供方的请求目标完成登录或配置可用的既有路由，再在新的明确授权下安排模型验收。无需在聊天或复核包提供凭证。原真实 MCP 正向工程闭环仍归属 `b9d3a6b`，不能替代本次 CLI。默认环境 200 毫秒状态查询性能失败、历史 `unknown`、隔离、CmpLog、脚本信任、设备/I/O、桌面交互、链接点击及实际运行限制继续保留。
