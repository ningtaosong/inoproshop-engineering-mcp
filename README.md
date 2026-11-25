# InoProShop Engineering MCP

当前功能分支为 **0.39.0 候选版、38 项 MCP 工具**，基于 main 0.38.0；尚未合并或部署。新增 [普通结构体 DUT 字段](docs/struct-field-add.md)，使用 `variable_edit / add-struct-field`；[离线通过，真实验收在准备保存退出不确定时停止](docs/struct-field-add-acceptance.md)，正式新增与CLI任务均未执行。产品范围是工程工具、契约、InoProShop 适配和必要保护，客户端复用 DSH／Codex。独立 GUI、代码工作台和自建 Agent 客户端不在当前范围，相关提议已作废；使用现成聊天协调开发不等于在产品内建设多 Agent 框架。

从[简明使用指南](docs/getting-started.md)开始；查能力看下方[已交付功能](#已完成功能main)，查剩余主线看[未完成事项](#未完成功能与计划阶段)和[38 项工具范围核对](docs/mcp-scope-status.md)。默认直接编辑指定文件，必要读取后编译、保存重开及目标读回；显式旧副本接口兼容保留，工程比较仅按用户要求执行。

当前执行路线及范围变更规则统一见 [agent.md 前部](agent.md#当前路线与范围变更规则)。文档合并已完成，本分支按后续授权实施 S4b 普通结构体 DUT 新增字段：仅根普通结构体，新增无初值 BOOL／DINT／TIME 字段，保留既有字段顺序与原文；复杂声明拒绝。验收与剩余边界见[专用说明](docs/struct-field-add.md)。不表示 S4b 全部完成。

日常 DSH 配置已指向 0.38.0 固定构建，已有独立连接的版本和 38 项工具证据；**Desktop 最终日常连接及完整指令进入模型上下文未验证**。Codex 沿用其独立配置，不随 main 自动升级。详见[入口与证据口径](docs/fb-interface-initializer-0380-merge.md)。

<details>
<summary>各阶段交付与历史验收记录（按原时点保留，旧入口与“本分支”不是当前部署状态）</summary>

**当前main为0.38.0候选版、38项工具**，[普通ST FB输入／输出缺失初值补写](docs/fb-interface-initializer-add.md)已整合main 0.37.2的正常退出和维护归属保护，并完成[新的独立MCP与一次CLI工程闭环](docs/fb-interface-initializer-recheck-0380.md)。MCP六项、CLI两项补写通过，各两次正式编译均0错误／0警告；额外查询与三条输出截断使流程效率、展示仅部分通过。旧异常退出及unknown保持原记录，不恢复或重放封存工程。限定功能已正常合并；固定构建、日常配置、独立连接与Desktop连接分别见[0.38.0收尾说明](docs/fb-interface-initializer-0380-merge.md)。S4b尚未全部完成。

**S8b 首版已交付 [I/O 通道与映射只读查询](docs/io-mapping-inspect.md)。** [真实验收](docs/io-mapping-inspect-acceptance.md)

**0.37.2 已合并**，同时纳入 [0.37.1 正常退出保护](docs/native-normal-exit-guard.md)和 `variable_edit` 原请求的维护归属补修，不重建历史写入参数、不改判 unknown。[补修与原准备记录](docs/variable-edit-isolation.md)及[两阶段真实 MCP 复验](docs/native-normal-exit-recheck-0372.md)保留各自时点：获准具体隔离计划已提交，9次IDE均取得可信正常退出，一次 MainTask 20→25 ms 保存重开闭环通过，保存版编译0错误／0警告。两处验收脚本错误保留；该轮未完成的0.38候选独立保留，0.37.2结果不等同于本轮另取证的0.38功能或CLI模型验收。[合并、固定入口及连接口径](docs/normal-exit-0372-merge.md)区分独立连接和Desktop日常连接。

**0.37.0 候选版已合并**，新增独立 `library_placeholder_clear`；[真实 MCP 与一次 DSH CLI 工程闭环通过](docs/library-placeholder-clear-acceptance.md)，流程效率与展示部分通过。[固定构建、入口和连接口径](docs/library-placeholder-clear-0370-merge.md)分别记录，保留 0.36.0 回退构建。仅清除普通 CAA Mathematics 应用覆盖并报告实际解析，不承诺回到默认版本。见[接口与守卫设计](docs/library-placeholder-clear-design.md)。


已合并的 variable_edit 新增 add-initializer：只给普通原生 ST PROGRAM／FUNCTION／FUNCTION_BLOCK 的 VAR 或 Application 根 GVL 的 VAR_GLOBAL 中已有、唯一且无显式初值的 BOOL／DINT／TIME 单变量补写初值。不创建变量或改变类型；已有初值即拒绝，旧 set-initializer 仍拒绝缺初值。[范围和示例](docs/variable-edit.md) · [实现与验收归属](docs/variable-initializer-add.md)。真实 MCP 六次补写及一次 CLI 新动作闭环通过，正式各两次编译均0错误／0警告；47次状态查询、一条输出截断及初始化首败保留。本轮真实 POU 样例为 PROGRAM；FUNCTION／FUNCTION_BLOCK 普通 VAR 保护由离线测试覆盖。固定入口和独立连接状态见[0.36.0 收尾说明](docs/variable-initializer-0360-merge.md)，不把独立连接当作 Desktop 日常验收。

S4b 已交付 variable_edit 的 add-member-initializer：只向根 GVL 已有完整具名聚合补写缺失的直接 BOOL／DINT／TIME 字段初值，字段须已在同 Application 的根结构体 DUT 中声明。不创建 DUT 字段，不覆盖已有成员，保留其他原文。[范围与示例](docs/variable-edit.md)；真实 MCP 三种字段及一次 CLI 新动作闭环通过，正式各两次编译均0错误／0警告；29次状态查询与两条CLI输出截断保留。验收归属见[本轮记录](docs/aggregate-member-initializer-add.md)。S4b 其他范围仍未完成。[0.35.0 合并与固定入口说明](docs/aggregate-member-0350-merge.md)分别记录仓库、入口和连接状态。

**0.34.3 离线试用历史入口：** [简明使用指南与三条示例](docs/getting-started.md) · [headless 脱敏模板](config/dsh.headless-trial.example.patch.yml) · [本次 CLI 接入记录](docs/offline-trial-readiness-0343.md)。固定 0.34.3 已由一次 DSH CLI 模型任务实际调用 environment_inspect，同一正式连接取得 37 项工具；没有打开工程。Desktop 日常握手、指令全文进入模型上下文与运行效果未验，环境能力审计的未验证项保留。

0.34.1 当时在功能分支补修 [task_create 任务清单换序核对](docs/task-create-inventory-order.md)。[独立 MCP 最小复验通过，CLI 最终工程核对成立，但流程与完整正常退出验收未通过](docs/task-create-revalidation-0341.md)。原 unknown 未改判；CLI 历史 reconcile 引起的账本变化单列，该轮日常入口未部署本补丁；后续已随 0.34.2 合并。

0.34.2 已合入 main，包含 0.34.1 task_create 任务集合核对补修，以及[正式隔离仅观察、终态幂等和 IDE 退出证据保护](docs/operation-reconcile-exit-guard.md)。[最小真实只读复验](docs/operation-guard-readonly-revalidation-0342.md)已完成；CLI 原始协议握手缺证单列。[合并与固定入口记录](docs/operation-guard-0342-merge.md)区分配置更新、独立初始化和最终日常连接。历史账本未恢复，IDE 崩溃根因与默认环境性能问题仍未解决。该段保留 0.34.2 的验收归属；后续任务集合及 PROGRAM 目录补修见下段。

0.34.3 已完成[任务集合与 PROGRAM 目录比较补修及真实复验](docs/task-program-inventory-order.md)，已随 0.34.3 合入 main。仅顶层任务集合按唯一 taskId、PROGRAM 身份目录按唯一 objectId 对齐；任务内部调用顺序、备注、绑定、源码、配置及其他字段仍严格核对，不提供调用重排能力。追加、替换各一次真实闭环通过，保存版各编译一次、均 0 错误／0 警告；替换重开实际出现 PROGRAM 目录换序，两套任务集合未换序。task_create 同类路径已补修并离线回归，本轮无其真实写入复验。Node 802/802 与 Python 616/616 分别记录；原失败、附属文件变化和历史限制保留。[合并与固定入口说明](docs/task-inventory-0343-merge.md)区分配置、独立连接与最终日常连接。

S8b 的三项状态分别记录：`io_mapping_inspect` 已交付，范围为已验 AM610 的 HIGH_SPEED_IO 连接器 2；单个 BOOL 通道已有设置、保存、独立重开及保存版编译的原生正例；映射写工具仍未开发。当前尚缺可信、可调用的完整有效 I/O Application 选择入口，应用级重复映射覆盖和输入变量的程序写引用也是独立缺口。现阶段保持只读评估，`writeAuthorized=false`。见[前置探测收尾与恢复条件](docs/io-mapping-write-probe-closeout.md)。

S8a 已交付单条任务调用替换。在已验 AM610 设备描述 `3.5.11.11` 的普通周期任务中，可将一条调用改为同一 Application 内另一个唯一的根级 ST PROGRAM。该行的位置和备注、其余调用及旧 PROGRAM 定义均保留。[替换说明](docs/task-call-replace.md) · [工程验收与限制](docs/task-call-replace-acceptance.md)

> 在指定 AM610 工程中，把 MainTask 调用 PRG_ReplaceMe 的那一条改为调用已有的 PRG_Replacement，保留备注和其他调用顺序，编译并保存重开核对。

同一支持范围也可向已有周期任务末尾追加程序，保留原调用顺序和备注。[任务调用追加说明](docs/task-call-append.md)

> 在这个 AM610 工程里，把已有程序 `PRG_S8Append` 加到 `MainTask` 的调用列表末尾，保留原调用顺序，编译并保存重开核对。

**S8a 的 `task_create` 自 0.31.0 起已交付。** 可在同一支持范围内新建普通周期任务，绑定第一个已有根级 ST PROGRAM，并保存重开核对。见[任务创建说明](docs/task-create.md)。

> 在指定 AM610 工程中新建一个 50 ms 周期任务 `ProbeTask`，调用已有程序 `PRG_S8Probe`，编译并保存重开核对。

50 ms 是配置周期，实际调度尚未观测。

通过 DeepSeek Harness（DSH）或 Codex 调用本地 InoProShop。可以只读查询本机设备描述，也可以直接编辑指定工程、编译并保存重开。工程比较仅在用户明确要求时执行。

**S7a 自 0.30.0 候选版起已交付。** `variable_usages` 查询精确声明在普通 ST `PROGRAM` 简单赋值中的用法，区分确认位置、未知候选和未覆盖范围。结果来自限定 ST 静态推导，零结果不足以判断能否重命名或删除变量。见[声明用法查询](docs/variable-usages.md)。

> 只读查询 `PLC_PRG` 局部 `DelayTime` 的用法，列出确认位置、未知候选和未覆盖范围。

**S6a 已交付。** `device_catalog` 查询本机已安装的设备描述，无需活动工程。

> 不打开工程。请列出本机已安装的 AM610 设备描述版本，分别报告同名型号的各个版本，并说明查询覆盖是否完整。

同名多版本分别展示，续页保持原筛选条件。枚举不完整时，零命中仅表示已读取的部分没有匹配。已安装描述由 `device_catalog` 查询，工程中的设备实例由 `device_inspect` 查询，现场 PLC 固件未读取。详见[设备目录用法](docs/device-catalog.md)。

**S6b 已完成一个组合的可行性探测。** AM610 夹具上的 `SMC_FreeEncoder` 与 `Device` 父连接器 `0 / Common.SoftMotion.General` 目前只适合用独立脚本做只读选址评估。尚无设备添加或选址评估 MCP 工具，离线设备参数写入未开发。结论仅适用于该组合。见 [S6b 探测结论与证据入口](docs/device-add-probe.md#探测结论与证据入口)。

S5a 精确添加直接引用、S5b 设置普通库占位符的显式覆盖均已合并。`library_inspect` 能分别读回显式覆盖和当前有效解析。普通直接引用移除已完成可行性探测，目前只适合只读评估，未提供删除能力。本分支新增限定清除工具，验收状态与范围见[设计](docs/library-placeholder-clear-design.md)；main 的旧设置语义不变。详见[库引用添加](docs/library-reference-add.md)、[占位符解析](docs/library-placeholder-resolve.md)和[直接引用移除探测](docs/library-reference-remove-probe.md)。

真实 MCP 和一次真实 DSH CLI 工程闭环均已通过编译、保存重开、保存版复编及最终读回；真实模型在冲突后继续写入，流程未通过。补修后，独立替身正例观察到正确的分页/写入字段映射，负例观察到在首次冲突后不再写入或保存。这不构成任务级强制阻断，不等于验证完整依赖或 PLC 运行。证据归属见[合并复核](docs/s5b-merge-review.md)；早期失败和隔离历史见[真实 MCP 复核](docs/s5b-final-mcp-review.md)、[CLI 首次尝试](docs/s5b-cli-acceptance-20261117.md)及[隔离维护](docs/direct-open-isolation.md)。

S4b 第一子阶段已合并：`variable_edit` 可修改根 GVL 已有具名聚合的直接成员。第二子阶段也已合并：可显式选择普通 ST 功能块已有且唯一的 `VAR_INPUT`／`VAR_OUTPUT`，新增普通 BOOL／DINT／TIME 单变量或修改其已有显式初值。重复块、特殊修饰、属性和不完整边界在写前拒绝。其他 S4b 范围仍未完成；DSH 实际加载版本须依据固定入口与连接证据核对。范围及验收归属见[变量编辑说明](docs/variable-edit.md)。
S4b 第三子阶段已合并：普通 ST PROGRAM／FUNCTION／FUNCTION_BLOCK 的普通 VAR，及 Application 根 GVL 的普通 VAR_GLOBAL，已存在单变量且有显式字面初值时，可用 variable_edit 的 set-type 同时给出目标 BOOL／DINT／TIME 类型与新初值。服务绑定原类型、原初值、对象及磁盘版本，只改两个原文片段；不转换旧值、不重构调用或做语义引用分析。范围、旧动作兼容和验收状态见[变量编辑说明](docs/variable-edit.md)。

原固定受验产品的完整回归为 399/399；独立真实 MCP 与一次 DSH CLI 模型任务已完成限定离线编译、保存重开和目标读回。该阶段后续补修了旧 `project_open_copy` 模式中 `set-type` 部分写入异常时的自动恢复缺口，补修后完整回归 401/401、最终定向 16/16；原工程及 CLI 任务未重跑。两套业务验收均保留 1 条 CmpLog 警告；首次回归失败及一次 CLI 参数拒绝单列。原验收结束时 DSH 恢复 0.25 固定入口；2026-11-13 日常配置及进程已切到独立 0.26 固定入口，最终连接握手和工具接收仍待取证；详见[变量编辑说明](docs/variable-edit.md)。

第二子阶段的原真实 MCP 与唯一一次 DSH CLI 正向验收归属固定产品 `9b5d0fc`；两套工程各两次编译均为 0 错误、1 条 CmpLog 警告，保存重开和目标读回通过。后续声明块边界补修完成定向 36/36、完整回归 395/395，未重跑真实工程任务。Git 合并、DSH 部署、实际连接和模型遵循分别取证；详见[变量编辑说明](docs/variable-edit.md)。

</details>

已验环境为 Windows、InoProShop 1.9.1.6；Node.js 要求 22 或以上。IDE、客户端、设备包和库需自行准备。仓库合并、客户端加载、模型实际调用和运行验证是不同状态，固定客户端入口不会随 main 自动升级。

## 已完成功能（main）

下表列出 main 已合并的 38 项工具及其能力。具体受验版本和未验事项见[验证范围](#能力与验证边界)。

| 功能 | 已实现范围 | 对应工具 | 完成阶段 |
| --- | --- | --- | --- |
| 环境、会话及操作状态 | 查询服务版本、当前工程、未决操作和冻结状态；运行中查询原操作，不重复写入 | `environment_inspect`、`session_status`、`operation_status` | 基础能力 |
| 直接打开与工程切换 | 指定哪个 `.project` 就读取、修改并保存哪个文件；复用登记身份、查询工程列表、显式切换活动工程 | `project_open`、`project_list`、`project_activate` | 0.16.0 |
| 新建 AM610 工程 | 原生向导创建固定 AM610-CPU1608TP 最小预设、空 ST `PLC_PRG`、20 ms 周期任务并绑定调用；保存到指定新路径 | `project_create` | 0.17.0 |
| 显式旧副本模式 | 仅用户明确选择旧接口时创建或复用受管理副本，保留来源文件；不是默认操作流程 | `project_open_copy` | 基础能力，兼容保留 |
| 源码读取与限定修改 | 按真实对象身份读取声明、实现和内容版本，修改受支持 ST 对象；写后读回并保留检查点 | `object_list`、`object_read`、`code_apply_change` | 基础能力，随 S2 扩展子对象 |
| 创建 POU | FUNCTION_BLOCK、PROGRAM，以及显式返回 DINT／BOOL／INT／REAL／TIME 的 FUNCTION；PROGRAM 不自动绑定任务 | `pou_create` | 0.8.0–0.9.0 |
| 创建 GVL 和 DUT | Application 根节点 GVL、结构体、普通枚举、一维定长 DINT 数组；枚举显式值 -32768..32767，数组显式边界 0..255、最多 256 项 | `declaration_create` | 0.4.0、0.11.0–0.12.0 |
| 变量表与初始化成员定位 | 查询声明的类型、显式初始化值及原文位置；可提取最外层命名初始化成员，提供分页、详情和解析缺口 | `variable_inspect` | 0.13.0、0.15.0 |
| 按声明查询限定 ST 用法 | 以精确声明为目标，推导普通 ST `PROGRAM` 简单赋值中的局部变量、根 GVL 和结构体直接字段用法，分别报告未知候选和覆盖缺口 | `variable_usages` | **S7a / 0.30.0，已交付**，见[分页和适用范围](docs/variable-usages.md) |
| 限定变量级编辑 | S4a：普通 POU VAR 或根 GVL VAR_GLOBAL 的 BOOL／DINT／TIME 单变量新增及显式字面初值修改；S4b 第一子阶段：根 GVL 已有聚合直接成员；第二子阶段：普通 ST FB 已有唯一 VAR_INPUT／VAR_OUTPUT 的单变量新增与显式初值修改；0.26.0 已交付普通 VAR／根 VAR_GLOBAL 中 BOOL／DINT／TIME 的限定 set-type；已交付 0.35.0 支持向已有聚合补写缺失的直接字段初值；已合并 0.36.0 支持给普通 VAR／根 VAR_GLOBAL 已有无初值 BOOL／DINT／TIME 单变量补写初值。已合并 0.38.0 候选扩展显式 FB VAR_INPUT／VAR_OUTPUT 缺失初值补写。TIME 限 0..60000 ms，名称在写入前校验 | `variable_edit` | **S4a / 0.23.0；S4b 第一、第二子阶段 / 0.24.0、0.25.0；已交付补写聚合成员 / 0.35.0；已合并普通变量补写 / 0.36.0；已合并FB接口补写 / 0.38.0**，见[范围](docs/variable-edit.md) |
| 源码检索 | 字面子串和完整标识符词元检索；支持分页、原文位置和缺口报告。词元检索不是语义交叉引用 | `project_search` | 基础检索、0.14.0 标识符扩展 |
| 本机设备描述只读目录 | 不打开工程；查询精确原生设备类型、ID、型号、厂商、仓库来源及描述版本。支持过滤、分页和按身份读回 | `device_catalog` | **S6a / 0.29.0，已完成**，见[查询示例和说明](docs/device-catalog.md) |
| 查询已验 HIGH_SPEED_IO 通道与现有映射 | 查看工程内的通道身份、原生字段、首项及完整映射列表 | `io_mapping_inspect` | S8b 首版 / 0.34.0，已交付 |
| 原生结构与设备只读查询 | 保留非 ST 和未知节点，读取可访问的设备标识、描述版本、连接器及离线参数；不等于完整设备配置或固件查询 | `project_structure`、`device_inspect` | 0.6.0 |
| 库引用只读查询 | 直接库引用、命名空间、占位符声明、显式覆盖与当前有效解析；不可取得字段明确标注 | `library_inspect` | 0.10.0；S5b 扩展覆盖读回 |
| 本机库查询与精确添加 | 查询原生安装身份；按精确库身份添加一个直接引用 | `library_catalog`、`library_reference_add` | **S5a / 0.27.0** |
| 普通占位符精确覆盖 | 支持范围内设置精确本机已安装库；显式覆盖与当前有效解析分别读回 | `library_placeholder_resolve` | **S5b / 0.28.0**，见[说明](docs/library-placeholder-resolve.md) |
| 清除普通占位符应用覆盖 | 限定 AM610/CAA Mathematics 组合，保留同一引用并返回实际解析；不保证默认回退 | `library_placeholder_clear` | **0.37.0 候选已合并，限定工程闭环通过**；[说明](docs/library-placeholder-clear.md) |
| 已有周期任务配置 | 读取任务和调用顺序；仅编辑已有周期任务的整数毫秒周期 1..60000 及优先级 0..31，不创建任务或编辑调用列表 | `task_inspect`、`task_config_update` | 查询已有；**S1 / 0.18.0** 写入，见[说明](docs/task-config.md) |
| 创建周期任务并绑定程序 | AM610（设备描述 `3.5.11.11`）Application 内新建一个周期任务，绑定一个已有根级 ST PROGRAM；创建前、绑定后及重开后核验原生 ST 标识，保留原任务和调用顺序 | `task_create` | **S8a 首项 / 0.31.0，已交付**，见[说明](docs/task-create.md) |
| 追加已有周期任务调用 | AM610（设备描述 `3.5.11.11`）Application 内给已有普通周期任务末尾追加一个已有根级 ST PROGRAM，保留原调用名称、注释和顺序，保存重开核对 | `task_call_append` | **S8a 追加已交付**；0.34.3 清单补修已验，见[说明](docs/task-call-append.md) |
| 替换周期任务的一条调用 | 在原位置换成同一 Application 的唯一根级 ST PROGRAM，保留备注和其余调用 | `task_call_replace` | **S8a 替换 / 0.33.0，已交付**，见[说明](docs/task-call-replace.md) |
| FB 原生方法 | PUBLIC ST Method 的创建、读取和修改，返回值限 void／DINT；绑定父 FB 身份 | `method_create`，读取和修改复用源码工具 | **S2a / 0.19.0**，见[说明](docs/methods.md) |
| FB 原生属性 | PUBLIC DINT Property/Get/Set 创建及访问器独立读写；旧调用默认只读 Get，显式指定才创建 Get/Set，不自动转换已有属性或补建 Set | `property_create`，读取和修改复用源码工具 | **S2b / 0.20.0–0.21.0**，见[说明](docs/properties.md) |
| 文件夹与对象整理 | Application 根节点创建文件夹；同一 Application 的根与直接文件夹间移动 ST PROGRAM／FUNCTION／FB；支持的 Method、Property 子对象随 FB 保持身份和源码 | `folder_create`、`object_move` | **S3 / 0.22.0**，见[说明](docs/object-organize.md) |
| 真实编译与保存重开 | 返回实际编译错误、警告；保存、关闭重开、目标读回，必要时对保存版本复编 | `project_build`、`project_save` | 基础离线闭环 |
| 按需版本比较 | 用户要求比较时采集支持源码与实际可读任务配置，引用成功采集记录比较；按应用相对路径和类型匹配，不猜重命名，不覆盖设备／I/O或运行行为；支持分页及详情 | `project_compare` | 0.7.0，默认不调用；[精确范围](docs/mcp-scope-status.md#兼容接口与证据边界) |

库使用情况可组合既有只读工具收集，见[只读示例](docs/getting-started.md#只读检查库的使用情况)；这不是新增工具，也不证明可以安全移除库。

此外，已实现版本与磁盘变化校验、写前检查点、请求去重、冲突检测、unknown 冻结及受控隔离。0.20.1 修复租约 PID 复用误判：租约绑定进程创建身份，身份不能确认时停止。这些机制不提供自动回滚或多客户端并发操作，原隔离工程也没有因此恢复。租约、退出保护与故障诊断属于支撑工程工具的保护和维护，不另计业务工具完成数。

## 未完成功能与计划阶段

以下只列剩余事项，**不是完成日期、可用性承诺或本轮开发授权**。S4／S5 尚未整体完成，S8 的受阻子项不阻塞已交付的限定离线流程。已交付的占位符覆盖清除、限定 ST 用法查询和任务调用替换均在上表，不再作为待开发项。

### 待开发且需限定范围

| 剩余能力 | 阶段 | 进入开发前须限定的内容 |
| --- | --- | --- |
| 更多聚合、类型与声明区专用编辑 | S4b，离线主线优先 | 限定 DUT 字段新增见0.39.0功能分支；嵌套／数组成员、更广类型、RETAIN／PERSISTENT 等仍未交付；逐项确定语法、身份、原文边界与保全要求。已有 BOOL／DINT／TIME set-type、聚合直接成员编辑及缺失初值补写不重复立项，见[变量编辑](docs/variable-edit.md) |
| 离线设备参数写入 | S6，按业务需求选择 | 先限定真实参数身份、可写语义、类型、单位与保存读回；不推断任意设备或完整 I/O 可写 |
| 更多方法／属性及组织范围 | S2／S3，未安排具体子阶段 | 更多类型、访问级别、继承／接口、嵌套文件夹、GVL／DUT 移动均须另定支持范围；不纳入当前已交付表 |

### 受阻或暂缓，须先补证

| 剩余能力 | 当前缺口 | 恢复条件与依据 |
| --- | --- | --- |
| 普通直接库引用移除（S5） | 当前仅适合只读移除评估，未提供删除工具 | 将原生选择器与精确引用一对一绑定，并说明使用关系及反向依赖的覆盖；见[探测](docs/library-reference-remove-probe.md)。限定占位符覆盖清除已交付，不能替代引用移除 |
| 限定设备添加（S6b） | 仅单一组合的独立只读选址评估，无添加或选址 MCP 工具 | 在已知正确挂接实例上读回对端连接器 ID 及所属父设备，并区分同接口的不同连接器；见[证据缺口](docs/device-add-probe.md#探测结论与证据入口) |
| 原生语义引用与安全重命名／删除（S7） | 尚无完整原生绑定与相关引用来源覆盖；S7a 静态查询不提供全工程保证 | 取得可复查的声明／使用身份及明确覆盖与拒绝规则，再评估写入；见[限定静态范围](docs/variable-usages.md) |
| 单条任务调用移除（S8a） | 本机 1.9.1.6 原生对象身份缺陷；原实际调用结果仍为 unknown | 取得修正的受支持公开接口或厂商修复，独立验证精确移除、剩余顺序与备注、保存重开及保存版编译；见[诊断](docs/task-call-remove-diagnosis.md) |
| 任务调用重排（S8a） | 本机已查公开入口不满足行级移动要求 | 取得可核验的公开入口或厂商确认的等价操作，明确源行、目标位置、备注与异常语义，再独立验收；见[探测](docs/task-call-reorder-probe.md) |
| I/O 映射写入（S8b） | 仅有单通道原生保存正例；写工具未开发，writeAuthorized=false | 补齐当前句柄有效 I/O Application 的可信入口、应用级重复映射来源覆盖及输入变量程序写引用；见[恢复条件](docs/io-mapping-write-probe-closeout.md) |
| 工程当前 EtherCAT PDO 查询／编辑（S8c） | 仅已读取 IS620N 描述的 11 个 PDO 定义与 83 条直接 Entry；正常实例及当前配置入口缺证 | 取得已正常保存关闭、获准读取且主从站身份对应安装描述的工程，通过受支持接口或公开参数与同状态导出核对当前配置；见[前置核查](docs/ethercat-pdo-inspect-probe.md) |

上述缺口仅限具体本机版本、设备及已查入口，不推断所有版本均不支持。S8c 的描述版本、RevisionNo、ESI 默认 Sm 不是实测固件或工程当前配置；14/14 仅属离线报告规则检查。恢复时用户提供工程路径、设备型号等业务信息，内部身份由工具读取，不要求用户填写 GUID。不通过添加设备、试写、在线扫描或私有编辑器绕过缺少样例／入口的条件。

### S9 在线后续：没有测试 PLC，暂缓

| 剩余能力 | 进入条件 | 边界 |
| --- | --- | --- |
| S9a 在线连接与只读状态、变量实际值 | 明确型号／固件的独立测试 PLC，验证目标身份、读取及正常断开 | 未实现、未实机验收 |
| S9b 限定运行参数写值 | S9a 通过，再限定类型、范围、预期旧值与写后读回 | 不含强制，不默认修改源码初值 |
| S9c Online Change | 可信在线会话、运行应用版本对应及厂商接口证据 | 不自动退化为完整下载、启停或复位 |

推进顺序按 [agent.md 的当前路线](agent.md#当前路线与范围变更规则)：**本分支实施已授权 S4b 普通结构体 DUT 新增字段，完成后先复核，不自动合并；其余 S4b／S5 离线子项逐项限定，S6／S7 按明确需求，S8 补齐恢复条件后继续且不阻塞离线交付，S9 因缺少测试 PLC 暂缓。** 调整顺序或新增范围须经用户明确确认，不承诺日期。详见[范围状态](docs/mcp-scope-status.md)。

DSH 欢迎页／认证、CLI 接入、转储诊断和采证属于辅助维护；租约、去重、隔离与退出保护属于必要工程保护，不作为新增业务功能计入完成率，也不删除其实现。通用图形语言编辑、普通下载／运行控制、强制、仿真、自动回滚及多客户端并发工程执行没有当前交付承诺。

## 从这里开始

1. 阅读[安装与日常使用](docs/getting-started.md)，确认环境和直接编辑指定工程的使用方式。
2. 选择一个客户端：[DSH 接入](docs/getting-started.md#接入-dsh)或 [Codex 固定版本接入](docs/codex-integration.md)。已有部署沿用原登记数据目录；一次只允许一个客户端占用工程服务。
3. 在客户端指定 `.project` 文件或提供完整路径，说明要改什么，按[日常修改闭环](docs/getting-started.md#日常修改闭环)执行；有原值条件或保留项时一并说明。也可先做[只读解释](docs/getting-started.md#首次试用)，但不是修改前置任务。
4. 遇到运行中、冲突、unknown 或冻结，按[停止与保全](docs/getting-started.md#停止与保全)处理。切换客户端先走[正常服务移交](docs/startup-handoff.md#正常移交步骤与停止条件)，保留用户输入，确认原服务退出。

### 已验综合流程

可以通过 DSH CLI 用自然语言要求：在指定路径原生新建 AM610 工程、编写双路延时报警、创建任务并绑定 PROGRAM、编译及保存关闭重开。见 [0.34.2 单次综合工程验收](docs/offline-alarm-acceptance-0342.md)。

> 请在指定新路径创建 AM610 离线报警工程：两路延时分别为 7 秒、8 秒，功能块延时输入初值为 3 秒；保留 MainTask 的 20 ms 周期及 PLC_PRG 调用，创建 50 ms 的 StatusTask 调用 PRG_Status。编译、保存关闭重开并读回核对，不连接 PLC。

本机限定场景的工程闭环通过：两次编译各 0 错误、0 警告，22 次 IDE 操作均有可信正常退出证据。流程与展示部分通过，参数拒绝、额外查询和输出截断等记录保留。该结果不代表全部 37 项工具或所有工程均已全面验证，也不证明实际计时、调度、完整设备/I/O、桌面交互或链接点击；此前失败、勘误及历史限制不变。

配置模板：[DSH](config/dsh.example.patch.yml)、[Codex 当前 0.16.0](config/codex-direct-edit.example.toml)。[Codex 0.14.0](config/codex.example.toml)和[0.15.0](config/codex-write-validation.example.toml)仅保留历史用途，不能接管登记 v2。模板路径是需替换的示例，固定构建的本机位置和已执行命令保留在本地复核包，不提交私人配置。

## 直接编辑指定工程

需要从新路径开始时，使用[新建最小 AM610 工程](docs/project-create.md)的 `project_create`；仅固定预设，不复制既有用户工程。已有文件使用 `project_open`。新建预设中的固定任务不代表已经提供任意任务、设备或 I/O 编辑。

客户端使用前先核对实际服务版本及工具清单。DSH 的固定构建须正常部署后才生效；Codex 当前固定入口仍为 0.16.0／21 项工具，需要单独升级、正常移交和验收，不能直接使用本页新增的全部能力。

默认 `project_open(projectPath)` 打开用户指定文件，后续修改、保存回同一路径，不创建业务副本。日常流程为：指定文件和需求 → 必要读取定位 → 修改 → 编译 → 保存关闭重开 → 必要复编及目标读回 → 简短报告。不默认通读全工程、采集比较基线或执行前后比较；只有用户明确要求比较时才用 `project_compare`。版本校验、内部文本快照、写前检查点及冲突保护保留，检查点不是另一份交付。旧 `project_open_copy` 保持显式复制语义，旧登记和隔离不迁移。详见[直接编辑设计与验收](docs/direct-project-edit.md)。

0.16.0 的验证结果与下列旧版本证据分别记录，固定客户端不会因仓库版本变化自动升级。

首次直接打开后，登记容器升级为 v2；原记录和文件保留。同一数据目录的所有客户端须使用 0.16.0 或更高兼容服务，旧二进制会拒绝新登记，防止把直接工程误当副本。下表 0.14.0/0.15.0 入口保留为历史证据，不能直接接管已升级的数据目录。

## 推荐入口及验证范围

| 入口 | 已有证据 | 使用前提与边界 |
| --- | --- | --- |
| 0.18.0 S1已有周期任务编辑 | MCP验证周期、优先级及保存版编译；DSH CLI新工程MainTask配置10ms/12并完成离线闭环 | 最终分组250/250，另复用同版15项隔离通过记录；保留首败及展示限制，未实测调度或扫描周期，见[任务配置](docs/task-config.md) |
| 0.17.0 新建最小AM610预设 | 真实MCP 11项成功工程操作、另1项正常拒绝；DSH CLI 21项成功工程操作，含业务创建接入 | 两套各两次0错误/0警告；参数拒绝、驱动首败和答复勘误保留，不消除历史CmpLog限制，见[新建说明](docs/project-create.md) |
| 0.16.0 直接编辑历史验收 | 真实 MCP 23 项与一次 DSH CLI 22 项成功工程操作；各自指定文件原位完成 5→8 秒、编译、保存重开和前后比较 | 登记 v2，服务入口须兼容；两套各两次 0 错误/1 条 CmpLog 警告。桌面业务及运行未验，见[验收说明](docs/direct-project-edit.md#验证记录) |
| Codex 固定 0.16.0 入口 | CLI 模型通过 project_open 直接编辑指定测试文件：21 项成功工程操作，原路径完成 5→8 秒及完整闭环 | 原两份旧入口已停用，构建保留；两次编译各 0 错误/1 条 CmpLog 警告。仅本场景 CLI 通过，见[升级与验收记录](docs/codex-integration.md#0160-cli直接编辑验收2026-11-09) |
| DSH 现有接入与安装版自带 CLI | 查询、创建及限定修改闭环；早期三路报警试用为 0.15.0、22 项成功工程操作 | 使用已核对的固定构建和原数据目录；根路径脚本信任拒绝仍未解决，不能承诺任意目录可用。CLI 不等于桌面交互 |
| Codex 固定 0.14.0 历史入口 | CLI 模型只读任务：13 次 MCP 调用，对应 8 项成功工程操作 | 原工作区和构建保留，旧服务条目已停用；该入口没有修改闭环验收，不能接管登记 v2 |
| Codex 固定 0.15.0 历史入口 | CLI 模型独立副本修改闭环：25 项成功工程操作，第二路初始化 5→8 秒 | 与 0.14.0 分开保留，旧服务条目已停用；原证据不追溯记为 0.16.0 直接编辑验收 |
| DSH → Codex CLI → DSH | 一次正常释放、接入、退出和恢复通过；接入后仅三个状态查询 | 不证明多客户端并发、所有启动情形或历史信任/崩溃根因解决 |

以上证据按客户端和版本分别归属，数量不相加；Codex 0.16.0 行来自 2026-11-09 的接入验收，该阶段的合并仅复核已有记录。0.17.0的新建验证另记，不能倒写成旧客户端已加载新工具。启动、接入及取证缺口分别见 [Codex 说明](docs/codex-integration.md)和[启动诊断记录](docs/startup-handoff.md)。

## 能力与验证边界

| 事项 | 已有证据与仍需完成的验证 |
| --- | --- |
| S4a 变量编辑 | 原真实 MCP 和一次 DSH CLI 正向闭环归属名称补修前候选；最终文件与保存版编译对应，两次 CLI 编译各 0 错误、1 条 CmpLog 警告。最终名称补修有相关 29/29；此前完整 373/373 属于上一提交。未重跑最终补修后的真实工程或 CLI，详见[证据归属](docs/variable-edit.md) |
| S4b 第二子阶段 | 原真实 MCP 与唯一 DSH CLI 正向闭环归属 `9b5d0fc`；两套各两次 0 错误、1 条 CmpLog 警告，保存重开和读回通过。最终声明块补修后定向 36/36、完整回归 395/395；定向不另累加，真实工程任务未重跑，首败、参数拒绝及展示偏差保留 |
| S1–S3 及其他基础能力 | 有各自限定场景的 MCP／DSH CLI 证据；最终守护修正、复用测试和未重跑范围按各专题保留，不把不同提交、客户端的数量累加成一次全量通过 |
| 客户端 | DSH 与 Codex CLI 均有模型实际调用及离线修改闭环记录；固定入口版本不同。进程存在、初始化握手、客户端收到工具、模型收到并遵循指令须分别核对；新一轮桌面业务、完整指令进入模型上下文及链接点击仍待验 |
| 覆盖范围 | 变量查询是声明解析，检索是字面或词元匹配；比较只覆盖受支持源码和实际可读任务配置。固件、完整设备配置／I/O、库完整传递依赖和独立运行加载状态均未得到完整验证 |
| 运行结果 | 编译通过、保存读回及源码初始化值不能证明实际扫描周期、报警计时或现场行为正确；PLC 在线、仿真、完整运行和生产使用未验 |
| 后续验收工作 | 客户端升级、桌面交互、跨机部署、回答质量及生产适用性需独立验收，不随 S4–S9 功能合并自动完成，也未承诺完成日期 |

## 三路报警样例

[样例说明及源码片段](docs/getting-started.md#三路独立延时报警样例)记录已有 DSH CLI 试用：三路源码初始化分别为 10、18、20 秒，使用独立实例与输入；复位或失能清除保持报警。22 项工程操作成功，两次编译各 0 错误、1 条 CmpLog 警告；保存重开、保存版复编及最终比较通过。只修改 GVL 和 PLC_PRG，结构体、功能块及实际可读任务配置一致。

工程二进制和完整证据保留在本机复核包，仓库不包含它们。原交付工程、独立测试源和修改后的受管理副本分别保留，不移动或覆盖。20 秒只是源码初始化设定，未做实际计时或生产验证。

## 工具与深入说明

全部工具按用途列于[已完成功能](#已完成功能main)。当前输入与输出定义以[源码契约](src/contracts.ts)及客户端实际加载的 Schema 为准。

[Agent 工作指令](instructions/inoproshop-workflow.md) · [完整开发路线图](agent.md) · [变量与成员定位](docs/variables.md) · [变量编辑](docs/variable-edit.md) · [检索模式](docs/identifier-search.md) · [按需基线与比较](docs/post-change-baseline-compare.md) · [库查询](docs/library-inspect.md) · [枚举](docs/enum-dut.md) · [数组](docs/array-dut.md)。各专题保留其历史提交、首败、修正和验证归属；历史版本数字不表示当前客户端已经加载该版本。

## 保留限制

CmpLog 警告及相关越界/除零诊断日志限制仍在；0.16.0 MCP/DSH 两套既有验收的四次编译、2026-11-09 Codex 验收的两次编译分别记录，均为 0 错误、1 条警告，不相加作质量评分。原路径脚本拒绝已在有限对照中复现：Windows PowerShell5.1将其文件区域判断为Internet，RemoteSigned下未签名助手受阻，即使没有Zone.Identifier。诊断已补充区域判断并提前拒绝；原路径仍未解锁，区域差异来源及历史辅助崩溃等其他根因仍未确认，见[启动排查](docs/startup-handoff.md#原路径信任续次排查2026-11-06)。固定入口成功不代表全部问题解决。原隔离工程仍为 unknown 且未恢复，旧锁、检查点、失败记录及历史 11/12 回答质量结论保留。原始答复与勘误分开保存，简洁展示及部分措辞仍有未遵循问题。

此前启动诊断、状态移交和Codex0.16.0合并属于历史证据。main另包含project_create及分别归档的新建验证；仍是候选交付，不是正式发布。仓库不捆绑厂商软件、真实工程、私人配置和凭证；当前未提供 LICENSE，不自动授予开源许可。

S4a 及 S4b 前两个限定子阶段已合并不代表 S4 整体完成；S4b 其余范围、S5–S8 以及 S9a／S9b／S9c 的状态见上方[阶段计划](#未完成功能与计划阶段)。本页状态更新不触发工程操作、客户端部署或在线设备连接。
