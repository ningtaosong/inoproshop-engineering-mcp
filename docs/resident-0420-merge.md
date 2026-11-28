# 0.42.0 常驻自动保存候选合并与离线入口收尾

2026-11-28。本轮按明确授权正常合并`codex/resident-user-save-continuation`，保留当前测试工程和持续验收会话，不发送工程／模型请求，不关闭、保存或编译。合并前main为`a536de33457ccec662bce7ab53e78d281f51ea80`，原交付`0afc1e84a655993273b8953cb7477fcd78ab173d`，实际受验产品`704009a1ece3760bad16dede9d3955f693f71dca`；本次收尾只改文档，最终提交、父提交、远端和固定路径以本轮复核包记录为准。

## 产品边界和证据归属

0.42.0候选版、38项工具。限定同一MCP服务、自有IDE、指定工程的Application根普通ST POU实现区；实际修改后严格读回并自动保存原路径，保存核实成功才返回，继续保持工程打开。只读和无修改请求不保存，编译仅按明确要求执行。保存提交当前工程全部未保存内容，不只本次目标对象。

本轮不扩展声明、变量、任务、设备或库等写工具的resident支持，不把旧batch成功记录等同于常驻能力。外部文件变更、缺证、冲突和unknown仍按原保护停止，不回滚、不恢复性保存、不接管用户IDE。手动接纳工具已撤出最终候选，38项工具不含`project_accept_saved_version`。独立GUI、工作台、自建Agent框架等路线仍已撤销。

复用[实际受验704009a的两轮DSH证据](dsh-resident-autosave-704009a.md)：8项工程操作、2次code_apply_change、各1次自动保存及独立后读，同一SDK／MCP／IDE／工程句柄；本次只新增测试注释，没有编译或运行验证。第一轮110次、第二轮95次状态查询和第二轮答复漏写`DSH`前缀单列；工程和协议通过，流程效率／展示部分通过。正式连接原始initialize及38项tools/list属于704009a验收连接，不是新日常连接。

离线验证按[实现与前驱链记录](resident-autosave.md)、[输出契约补修](resident-status-wire-contract.md)分别归属。最后协议补修的392/392相关检查与早期453/453、469/469、154/154、Python及同版IronPython组分别记录，不相加。本轮产品与受验候选一致时只做新固定构建、类型、文件树、契约、文档链接和指令大小检查，不重跑全量回归或真实成功任务。

## 合并、固定构建和日常配置

从确认的正常合并提交导出独立`D:\InoPro-Fixed\0.42.0-<main短号>`，不使用正在变化的工作区产物，不覆盖0.38.0回退`D:\InoPro-Fixed\0.38.0-b664e15e6cea`。固定源码、bridge、dist、38项Schema和初始化正文与704009a逐文件或逐结构核对；main旧38项契约的验证结构继续保持，project_open的描述同步自动保存语义。

日常文件为`C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml`。先重新核对写前指纹并备份，仅更新唯一`mcp-inoproshop`条目的服务入口和工作目录；保留原登记目录`D:\InoPro\.local\dsh-phase4-repair-20261028-A1`、`maxInstructionBytes: 65536`、账号、其他插件和Codex配置。完整私人备份仅留本机，复核包只收指纹、脱敏差异及全部其他字段／字节保留证明。

固定正文预期65004字节、含已验客户端标题65031／65536字节，最终以新构建实测为准，不提高上限。新日常配置不能自行触发热加载或当前验收SDK切换；当前SDK使用本轮独立私有patch，不引用Desktop日常patch。

当前验收MCP仍持有原登记目录，IDE与SDK均保持打开。因此本轮**不启动新服务、独立stdio、Desktop或模型任务**；只做离线产品和配置核对。新日常握手／工具接收待针对当前实例的正常移交后另行验证，不能用文件检查、旧验收连接或构建成功代替。日常配置更新不等于活动实例已经换版。

## 当前现场和保全

保持打开的实例为IDE4504、MCP70264、SDK10220、驱动1884；PID须与各自创建身份一起核对，不能仅凭数字判定。工程`D:\InoPro-Resident-UserSave-20261127\engineering\AM610_UserSave.project`最后保存哈希为`e82cb458647ac8379dc83ae7917abdcd3774b65bbc75104927a90590dd2b3e93`。本轮没有关闭授权，不结束这些实例，不调用历史reconcile或释放旧锁。

旧MCP29236退出1、发现连接错误和退出事件缺口、所有unknown／隔离、原账本与首败保持；本次不修复服务生命周期、默认性能、崩溃根因、CmpLog、脚本信任、Desktop或PLC运行问题。进程存活、工程文件和保护材料在操作前后分别取证，未保存的活动句柄不因Git合并而改变。

## 本轮复核入口

`D:\InoPro-Merge-0420-20261128`：

- `evidence/git-before.json`、`merge.json`：全部工作区状态、合并父提交／树与远端；其他工作区未提交内容保留。
- `evidence/prior-review.json`：原ZIP SHA-256、清单和可读取性复核。
- `evidence/fixed-source.json`、`build-results.json`、`fixed-checks.json`、`tool-schemas.json`：新固定来源、构建／类型、受验产品一致性、38项契约与指令口径。
- `evidence/config-before.json`、`daily-entry-before.json`、`config-switch.json`：写前指纹、私人备份证明及唯一条目的脱敏变化。实际是否完成切换以config-switch记录为准。
- `evidence/protected-before.json`、`final-check.json`：当前实例、工程及原登记保全；新日常连接未启动的边界。

收尾ZIP的START_HERE、MANIFEST和SHA256SUMS逐项重读验证，不重复包含私人配置或工程二进制。不发布Release或文章，不开始下一阶段。
