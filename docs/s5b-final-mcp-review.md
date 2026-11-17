# S5b 最终补修的真实 MCP 验证（2026-11-17）

本记录属于 `codex/s5b-library-dialog-integration` 的产品提交 `b9d3a6bdcc34128bf65e7e3cbc544e1707299f3b`。本轮只补充验证与记录，未修改产品逻辑，未合并 main，未永久部署 0.28.0，也未执行 DSH CLI 模型任务。实际登记目录按原操作与 DSH 配置为 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`；它与 `D:\InoPro.local\...` 不是同一目录。

## 正式隔离与保全

用户此前明确授权计划 `63d567cd-0bd3-4552-9e22-de60ddf13453` 的后续单独提交。本轮先核对完整计划文件 SHA-256 `623625ea65da449002e561c9ecebb7915dbca23bff6e71292ac5644fb536e8b9`，经正式维护入口重新评估：证据版本 `50cd48549393d649b0953afdd1f0e7e013c7c51907a50cdc254b78f02829341d`、工程身份、绑定和文件别名均匹配，`eligible=true`、无阻断。随后只提交一次，回执 `committed`、`deduplicated=false`，提交时间 2026-11-17 08:09:29 UTC。维护入口在排他控制下再次复核现场。

原操作 `7247cab3-a49a-4e3f-8ed5-73f47850a91f` 仍为 `unknown`；目标 `D:\InoPro-OpenDialog-McpDiag-20261117-104923\AM610_PlaceholderMcpDiag.project` 和同一文件身份别名由正式守卫返回 `PROJECT_ISOLATED`。原三项隔离与本项共四项均显示 committed。按计划原证据逐文件核对，原工程、该操作 IPC 与检查点等 24 个文件 SHA-256 均未变。隔离没有恢复原工程或改变原操作结果。

## 最终固定产品与两类只读打开

从上述产品提交创建独立固定工作树 `C:\Users\Administrator\.codex\worktrees\s5b-final-fixed-028\InoPro`，重新 `npm ci`、构建、类型检查及指令大小检查。服务为 0.28.0、31 项工具；初始化正文 59,329 / 65,536 字节。`dist/server.js` SHA-256 为 `8df880561e4d3db7d9efbd768f2cc6c8169a3a544869a6462b5e175675eab5cc`；`bridge/library_info_prompt.py` 为 `13bd90966ac9652cc7bb812aaff93da961272d566aa551c588aa8dd233956fb5`。没有使用旧候选 dist。

- 普通对照 `D:\InoPro-OpenDialog-Controlled-20261117\AM610_Control.project`：`project_open` 操作 `7a74d5e7-116c-4fad-9efc-3d2c56128711` 正式 succeeded；无提示确认，观察线程明确 stopped，原生阶段、结果发布及退出后记录存在。主文件前后 SHA-256 均为 `5e93ac6bc08f4b15986a118c86f2b0a4e7fbdaf7f68a8c054b21570522ef531d`。
- 已完整准备且未隔离的普通占位符夹具 `D:\InoPro-S5b-CLI-20261116\AM610_PlaceholderDSH.project`：原生准备结果 `passed=true`、正常退出码 0、租约释放，显式覆盖为 null。`project_open` 操作 `8753d237-dfce-452f-89cc-62461169e9c2` 正式 succeeded；产品精确观察到库加载信息提示，自动确认一次，随后 `window-state-after-confirmation.remains=false`、观察线程 stopped、`evidenceError=null`。元数据读取、清理和结果发布完成，主文件前后 SHA-256 均为 `0dd8ba8a93d4c99b7c391ca2df23e6f2f98b9cb19c359cc17f54e58e14cfe8b2`。未用人或外部电脑控制补点。

## MCP 设置、编译与保存

第一次写前请求错误地引用了库清单第一页的操作编号，而目标 `#S5bDemo` 位于下一页。操作 `4fa998ed-11a2-4a56-9cf5-bbf78142a3ef` 返回 `conflict / PLACEHOLDER_REFERENCE_EVIDENCE`，**未派发 IDE**、未修改文件、未产生 unknown。保留该首次参数拒绝。核对服务校验规则后，新请求引用目标所在页的真实查询操作，不重发已拒绝的请求。

更正后的真实 MCP 闭环使用同一独立夹具，未预置目标覆盖。库清单两页完整取得 19 条；安装目录确认唯一 `CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)`，默认命名空间 `MATH`。`library_placeholder_resolve` 操作 `1e01a7c0-fb66-4c59-94a7-3e636216d431` 返回 `changed=true`、`reopened=true`；首次打开的精确提示由产品自动确认一次并核实窗口消失，随后重开观察线程也明确退出。显式覆盖与当前有效解析分别在最终清单核对，目标原生 ID `3607926379` 恰好一条。

`PLC_PRG` 的源码通过 `code_apply_change` 接入经本机验证的 `MATH.sgn(lr := 1.0)` 最小调用。首次编译操作 `3ae6a780-c948-472e-beae-b2a80c4b5e49`：**0 错误、1 条 CmpLog 警告**。`project_save` 操作 `d8a7f2e3-29fd-4d33-a048-d8136342947d` 返回 `saved=true`、`reopened=true`、`buildApplicable=false`；因此再对保存版编译，操作 `63d7ab83-dcc3-4aa6-9f46-6d9749d06151` 同样 **0 错误、1 条 CmpLog 警告**。最终源码读回与提交文本一致，库清单按 10＋9 两页读完，目标覆盖唯一。保存版编译所报 diskHash 与最终工程 SHA-256 同为 `840c50976cbe89a72735071ba2a87e436fbc82c8c555fb81b1fb3e8a902008b2`。

候选服务和 IDE 测试进程随后退出，无新增 unknown；原四项 unknown 仍由四项 committed 隔离处置覆盖。DSH 已正常启动，配置仍指向日常 0.27.1 固定入口，观察到该入口的 Node 进程；**未取得最终 DSH 连接的初始化握手或工具接收记录**，也未发模型业务任务。候选 MCP 的 31 工具清单不能作为日常 DSH 接收证据。

## 边界

本轮没有重跑上一提交的全量回归；其 Python 211/211、Node 定向 19/19 和更早隔离环境 Node 454/454 各保留原归属。默认 TEMP/TMP 的状态查询 200 毫秒性能失败未解决，不以独立测试环境通过覆盖。提示自动确认只适用于已列明的精确信息提示与受控打开阶段，不能证明具体失败库、历史两次超时的唯一根因或所有对话框均能处理。此次离线编译与持久化不证明传递依赖完整、设备/I/O、PLC 扫描或程序运行。可另行安排一次 DSH CLI 模型验收，须先正常移交候选服务并核对该连接实际接收的新工具；本轮未执行。
