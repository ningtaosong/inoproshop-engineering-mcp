# S5b CLI 认证路由诊断（2026-11-17）

本轮只检查认证与执行一次无工具模型探测，没有启动候选工程服务、打开或修改工程、合并 main 或部署 0.28。原失败复核包为 `D:\InoPro\deliveries\InoPro-review-20261117-172603.zip`，SHA-256 `b2058722749e3c4214d224a6a12abd3836bab630c9670a527f8c2dda3cd4eb26`。本机为 Windows，实际用户 `BF-202605081059\Administrator`；已安装 `dsh.cmd` 入口位于 `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，版本 `0.2.1-rc.5`。该入口调用随应用安装的 Electron CLI；本轮没有使用 WSL。

## 路由与已确认原因

`dsh --profile headless` 的默认模型为 `deepseek-official / deepseek-flash`。此前临时 `--patch` 不仅插入候选 MCP，还把模型改为 Desktop 配置中的 `deepseek-account / deepseek-flash`。CLI 的 headless profile 与 Electron 管理的 Desktop profile 是两个不同配置组合；本机 CLI 明确拒绝直接以 `--profile desktop` 运行。两者都位于当前用户的 `.dsh` 根目录，但 headless 的内置组合将 `authorization`、`deepseek-account` 和 `credentials` 服务设为 disabled。Desktop 配置的账号模型选择不能证明 headless 已挂载账号认证。

已安装代码显示账号模型需调用账号服务的 `resolveToken`；该服务会检查请求目标及当前凭证。此前 `ACCOUNT_SIGN_IN_REQUIRED` 同时可能代表账号服务不可用、没有合格凭证或目标不合格，**不能单凭错误码判定用户未登录**。本机凭证容器存在账号记录这一结构事实，但本轮未读取或输出令牌，也未验证凭证有效期与目标适用性。对于首次失败，临时 patch 只改变了模型路由，没有启用 headless 已停用的账号服务，这是明确的配置缺口。

## 单次无工具探测及剩余阻断

已备份原临时 patch，另建仅用于本次探测的覆盖：继续使用 `deepseek-account / deepseek-flash`，启用 `credentials` 和 `deepseek-account`，禁用 MCP 资源及全部模型工具插件；没有向它插入 InoProShop MCP。静态组合核对显示这些覆盖生效，没有改 Desktop 的长期配置。任务原文为“请只回复：连接正常。不要调用任何工具。”

这唯一一次探测的 CLI 会话为 `session-5a68c708-a418-45b0-af82-4b40f9014592`，退出码 1、最终答复为空、工具调用为零。启动警告明确指出 `deepseek-account` 未激活，仍在等待 `authorization` 服务；headless 预设仍停用了该依赖。随后再次返回 `ACCOUNT_SIGN_IN_REQUIRED`。因此探测**没有到达预期模型路由，认证阻断未解除**。依照本轮约束，发现该失败后没有再改配置或重复发送模型请求。账号令牌本身、目标匹配和网络均仍未实测。

## 保全及后续入口

日常 DSH Desktop 及其 0.27.1 工程服务保持运行，未重启或切换。候选工程服务进程为零；原数据目录中没有本次新增工程操作，四项历史 `unknown` 与四项隔离保持。夹具 `D:\InoPro-S5b-CLI-Final-20261117\AM610_Placeholder_CLI.project` 的 SHA-256 仍为 `84c36bf721f45d25122ae5af5746a72556de96927f2c6e5071f0999180b5cb99`。此前及本轮的 CLI 原始事件、错误、临时覆盖指纹和静态摘要单独归档；私人配置及凭证不入 Git 或复核包。

后续仍应使用已核实的 `dsh.cmd` 命令行入口；**目前没有经过模型答复验证的 headless 账号配置**。在下一轮业务验收前，需要先按本机版本的 profile 依赖检查 `authorization`、账号服务和凭证读取是否可在所选 CLI 配置中共同激活，再以无工具请求验证现有账号模型；不能把本轮失败配置或仅有的 Desktop 登录状态当成已验证路由。若完整依赖生效后仍要求登录，才由用户通过本机官方交互入口自行完成，绝不在聊天中传递凭证。S5b 工程模型任务须另轮明确安排。
