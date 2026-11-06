# InoProShop Engineering MCP

通过 DeepSeek Harness（DSH）或 Codex 调用本地 InoProShop，辅助读取、限定修改、编译、保存重开和比较离线工程。

**本功能分支提供 0.16.0 候选版、二十一项 MCP 工具，契约 1.0.0；尚未合并 main。适用于本机、限定范围的日常离线试用，不是正式 v1.0 或生产使用认证。** 已验环境为 Windows、InoProShop 1.9.1.6；Node.js 要求 22 或以上。IDE、客户端、设备包和库需自行准备，其他电脑和安装组合未完成部署验收。

## 从这里开始

1. 阅读[安装与日常使用](docs/getting-started.md)，确认环境和直接编辑指定工程的使用方式。
2. 选择一个客户端：[DSH 接入](docs/getting-started.md#接入-dsh)或 [Codex 固定版本接入](docs/codex-integration.md)。已有部署沿用原登记数据目录；一次只允许一个客户端占用工程服务。
3. 首次从[只读任务](docs/getting-started.md#首次试用)开始。需要修改时，说明目标、当前值、允许改动和必须保留的内容，按[日常修改闭环](docs/getting-started.md#日常修改闭环)执行。
4. 遇到运行中、冲突、unknown 或冻结，按[停止与保全](docs/getting-started.md#停止与保全)处理。切换客户端先走[正常服务移交](docs/startup-handoff.md#正常移交步骤与停止条件)，保留用户输入，确认原服务退出。

配置模板：[DSH](config/dsh.example.patch.yml)、[Codex 0.14.0](config/codex.example.toml)、[Codex 0.15.0](config/codex-write-validation.example.toml)。模板路径是明确标注的示例，不能直接视作本机或同事电脑的真实路径。固定构建的实际本机位置及已执行命令保留在本地复核包，不提交私人配置。

## 直接编辑指定工程

默认 `project_open(projectPath)` 打开用户指定文件，后续修改、保存回同一路径，不创建业务副本。修改前后用 `project_compare` 的 `origin=current-project` 采集历史快照；后台检查点保留，但不是另一份交付。旧 `project_open_copy` 保持显式复制语义，旧登记和隔离不迁移。详见[直接编辑设计与验收](docs/direct-project-edit.md)。

本分支的验证结果与下列旧版本证据分别记录，固定客户端不会因仓库版本变化自动升级。

首次直接打开后，登记容器升级为 v2；原记录和文件保留。同一数据目录的所有客户端须使用 0.16.0 或更高兼容服务，旧二进制会拒绝新登记，防止把直接工程误当副本。下表 0.14.0/0.15.0 入口保留为历史证据，不能直接接管已升级的数据目录。

## 推荐入口及验证范围

| 入口 | 已有证据 | 使用前提与边界 |
| --- | --- | --- |
| 本分支 0.16.0 直接编辑入口 | 真实 MCP 23 项与一次 DSH CLI 22 项成功工程操作；各自指定文件原位完成 5→8 秒、编译、保存重开和前后比较 | 登记 v2，服务入口须兼容；两套各两次 0 错误/1 条 CmpLog 警告。桌面业务、Codex 直接编辑及运行未验，见[验收说明](docs/direct-project-edit.md#验证记录) |
| DSH 现有接入与安装版自带 CLI | 查询、创建及限定修改闭环；最近一次三路报警试用为 0.15.0、22 项成功工程操作 | 使用已核对的固定构建和原数据目录；根路径脚本信任拒绝仍未解决，不能承诺任意目录可用。CLI 不等于桌面交互 |
| Codex 固定 0.14.0 入口 | CLI 模型只读任务：13 次 MCP 调用，对应 8 项成功工程操作 | 原工作区、构建和项目配置单独保留；该入口没有修改闭环验收 |
| Codex 固定 0.15.0 入口 | CLI 模型独立副本修改闭环：25 项成功工程操作，第二路初始化 5→8 秒 | 与 0.14.0 分开配置；使用前正常移交服务，不自动切换 Codex 桌面端 |
| DSH → Codex CLI → DSH | 一次正常释放、接入、退出和恢复通过；接入后仅三个状态查询 | 不证明多客户端并发、所有启动情形或历史信任/崩溃根因解决 |

以上是各次已有证据，数量不相加，也不是本轮重新验收。启动、接入及取证缺口分别见 [Codex 说明](docs/codex-integration.md)和[启动诊断记录](docs/startup-handoff.md)。

## 能力与验证边界

| 状态 | 能力 | 实际范围或缺口 |
| --- | --- | --- |
| 已在限定场景验证 | DSH 查询、创建与接入、修改、编译、保存关闭重开、最终比较 | ST POU、GVL、限定 DUT；历史枚举 CLI 已验，数组修复后为独立 MCP 闭环，旧数组 CLI 仍归属修复前提交，不追溯改称修复后实测 |
| 已在限定场景验证 | 变量声明与显式初始化成员定位 | 声明解析；真实成员场景为 GVL 的短值，复杂/长值等另有夹具证据。不是原生符号表、类型成员校验或运行值采集 |
| 已在限定场景验证 | 字面与完整标识符检索 | literal 包括注释/字符串；identifier 跳过它们及支持的直接地址，未知边界报告缺口。st-identifier-v2 是词元检索，不是语义交叉引用 |
| 已在限定场景验证 | 前后工程比较 | 受支持源码及实际可读任务配置；设备参数、I/O、库配置及其他非 ST 内容不在比较范围 |
| 已实现，仍有验证缺口 | 结构、设备参数与库直接引用只读查询 | 返回实际可取得的字段和覆盖状态；固件、完整设备配置、完整传递依赖和独立库加载/缺失状态未验证。库详情 55 字符单片段通过，不代表长值多片段桌面重组通过 |
| 已实现，仍有验证缺口 | 客户端接入和答复 | Codex CLI 已有只读及一次修改闭环；Codex 桌面调用、链接点击、完整初始化指令进入模型上下文仍未验证。工具流程通过不代表全部回答质量通过 |
| 尚未提供 | 语义交叉引用、变量专用写入/重命名/删除、设备/任务/I/O 配置写入、自动回滚、多客户端并行工程执行 | 现有 code_apply_change 仅在原白名单内按完整源码及授权修改，不是变量事务 |
| 尚未完成验证 | PLC 在线、下载、仿真、实际运行、计时行为、生产使用、跨机部署 | 编译成功和源码初始化不能替代这些验收 |

支持 POU 的 FUNCTION_BLOCK、PROGRAM，以及显式返回 DINT/BOOL/INT/REAL/TIME 的 FUNCTION 创建；PROGRAM 不会自动加入周期任务。DUT 创建包括结构体、普通枚举（显式整数 -32768..32767、成员名和值不重复、无属性或显式基类型）和一维定长 DINT 数组（显式边界 0..255、最多 256 项）。这些是创建白名单，不收窄既有对象的读取范围。

## 三路报警样例

[样例说明及源码片段](docs/getting-started.md#三路独立延时报警样例)记录已有 DSH CLI 试用：三路源码初始化分别为 10、18、20 秒，使用独立实例与输入；复位或失能清除保持报警。22 项工程操作成功，两次编译各 0 错误、1 条 CmpLog 警告；保存重开、保存版复编及最终比较通过。只修改 GVL 和 PLC_PRG，结构体、功能块及实际可读任务配置一致。

工程二进制和完整证据保留在本机复核包，仓库不包含它们。原交付工程、独立测试源和修改后的受管理副本分别保留，不移动或覆盖。20 秒只是源码初始化设定，未做实际计时或生产验证。

## 工具与深入说明

| 用途 | 工具 |
| --- | --- |
| 环境、状态和操作证据 | environment_inspect、session_status、operation_status |
| 直接打开、登记和切换；显式旧副本 | project_open、project_list、project_activate、project_open_copy |
| 对象与声明 | object_list、object_read、variable_inspect |
| 限定修改与创建 | code_apply_change、pou_create、declaration_create |
| 编译和保存重开 | project_build、project_save |
| 检索、结构和配置只读 | project_search、project_structure、task_inspect、device_inspect、library_inspect |
| 当前工程历史快照和比较 | project_compare |

[工具 Schema](docs/tool-schemas.json) · [Agent 工作指令](instructions/inoproshop-workflow.md) · [变量与成员定位](docs/variables.md) · [检索模式](docs/identifier-search.md) · [修改前基线与比较](docs/post-change-baseline-compare.md) · [库查询](docs/library-inspect.md) · [枚举](docs/enum-dut.md) · [数组](docs/array-dut.md)。各专题保留其历史提交、首败、修正和验证归属，不简单累加不同阶段测试数量。

## 保留限制

CmpLog 警告及相关越界/除零诊断日志限制仍在；本次四次真实编译均为 0 错误、1 条警告。原路径脚本拒绝已在有限对照中复现：Windows PowerShell5.1将其文件区域判断为Internet，RemoteSigned下未签名助手受阻，即使没有Zone.Identifier。诊断已补充区域判断并提前拒绝；原路径仍未解锁，区域差异来源及历史辅助崩溃等其他根因仍未确认，见[启动排查](docs/startup-handoff.md#原路径信任续次排查2026-11-06)。固定入口成功不代表全部问题解决。原隔离工程仍为 unknown 且未恢复，旧锁、检查点、失败记录及历史 11/12 回答质量结论保留。原始答复与勘误分开保存，简洁展示及部分措辞仍有未遵循问题。

此前启动诊断和状态移交属于历史证据。本分支新增直接编辑能力并完成上述离线验收，仍是候选交付，不是正式发布。仓库不捆绑厂商软件、真实工程、私人配置和凭证；当前未提供 LICENSE，不自动授予开源许可。
