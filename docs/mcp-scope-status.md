# MCP 当前范围与剩余主线

当前工作分支另有[0.41.0／38工具常驻合并准备候选](resident-merge-preparation.md)，尚未合入main或部署。下表保留0.38.0已合并工具及batch范围；不能据表在resident调用未迁移工具。常驻仅适配显式打开、列举／读取、根普通ST POU实现区修改及明确请求的内存编译，不自动保存关闭；[合并前复核](resident-premerge-review.md)区分范围、证据和未验事项。

2026-11-25 文档核对，基于 main `b664e15e6ceaa83ecb36c313176a68db346c36be`：**0.38.0 候选版、38 项工具**。本轮只整理状态，不改产品、Schema、初始化指令、固定构建或配置，不重新验收工程。功能入口见 [README](../README.md#已完成功能main)，使用方式见[简明指南](getting-started.md)，阶段细节见[路线图](../agent.md#2-路线与优先级)。

## 产品边界

交付范围是 MCP 工程能力、契约、InoProShop 适配及必要保护；复用 DSH／Codex 的聊天、模型和执行循环。独立 GUI、代码工作台、自建 Agent 客户端提议已作废，不进入当前路线。产品不新增通用 Agent／多 Agent 框架、向量库、插件市场或远程部署平台。使用现成聊天协调开发不等于在产品内建设这些能力。

已验范围仍以本机 InoProShop 1.9.1.6、具体对象／设备及各工具限制为准。下面的归类不是 38 项工具所有路径的质量复验，也不补造对历史每次操作的授权。

## 38 项工具的完整对应

核对来源为[当前契约快照](tool-schemas.json)、[注册入口](../src/server.ts)、[契约定义](../src/contracts.ts)，并比对 [0.17 基线 22 项契约](https://github.com/ningtaosong/inoproshop-engineering-mcp/blob/dc4f462570717c14a818648e4f62d3226c4eb045/docs/tool-schemas.json)及[首次入库阶段路线图](https://github.com/ningtaosong/inoproshop-engineering-mcp/blob/3876c3bbde2ba3a8593b9cf8a3cbf18f13f426b1/agent.md)。每个工具在本表只列一次。

| 工具 | 范围归属 | 当前能力入口或关键限制 |
| --- | --- | --- |
| `environment_inspect` | 0.17 既有基线 | 服务及环境信息；能力审计未验证项不能写成工程验收通过 |
| `session_status` | 0.17 既有基线 | 会话与冻结状态；不处理历史工程 |
| `project_list` | 0.17 既有基线 | 已登记工程及身份 |
| `project_create` | 0.17 既有基线 | [固定最小 AM610 原生新建](project-create.md)，不是任意设备工程生成器 |
| `project_open` | 0.17 既有基线 | [直接打开指定工程](direct-project-edit.md)，默认编辑原指定路径 |
| `project_open_copy` | 0.17 既有基线 | 显式旧副本接口兼容保留，不作为默认流程 |
| `project_activate` | 0.17 既有基线 | 显式切换已登记工程 |
| `object_list` | 0.17 既有基线 | 对象定位、分页及覆盖缺口 |
| `object_read` | 0.17 既有基线 | 受支持对象的声明／实现与版本 |
| `project_search` | 0.17 既有基线 | [字面及标识符词元](identifier-search.md)，不是语义绑定 |
| `variable_inspect` | 0.17 既有基线 | [声明与初始化成员定位](variables.md)，保留解析缺口 |
| `variable_usages` | 原路线 S7a | [限定 ST 静态用法查询](variable-usages.md)，不能证明全工程无引用 |
| `library_inspect` | 0.17 既有基线 | [引用、默认声明、显式覆盖和有效解析](library-inspect.md)分别读取 |
| `library_catalog` | 原路线 S5a | [本机已安装库身份目录](library-reference-add.md)，不代表工程已引用 |
| `library_reference_add` | 原路线 S5a | [精确直接库引用添加](library-reference-add.md)，不是安装／卸载库 |
| `library_placeholder_resolve` | 原路线 S5b | [普通占位符应用级显式覆盖](library-placeholder-resolve.md) |
| `library_placeholder_clear` | S5 后续细分 | [限定组合的覆盖清除](library-placeholder-clear.md)，保留引用，不保证默认回退 |
| `task_inspect` | 0.17 既有基线 | [任务可读配置和调用](task-config.md)，非空备注解析边界按原记录保留 |
| `task_config_update` | 原路线 S1 | [已有周期任务的周期和优先级](task-config.md) |
| `task_create` | 原路线 S8a | [新建周期任务并绑定首个 PROGRAM](task-create.md) |
| `task_call_append` | 原路线 S8a | [末尾追加 PROGRAM](task-call-append.md)，保留原调用顺序与备注 |
| `task_call_replace` | S8a 后续细分 | [原位置替换一条调用](task-call-replace.md)，旧 PROGRAM 定义保留 |
| `project_compare` | 0.17 既有基线 | [按需比较](post-change-baseline-compare.md)，仅支持源码及可读任务配置 |
| `project_structure` | 0.17 既有基线 | 原生对象树、身份及覆盖缺口，包含非 ST／未知节点 |
| `folder_create` | 原路线 S3 | [Application 根文件夹创建](object-organize.md) |
| `object_move` | 原路线 S3 | [同 Application 限定 ST 对象移动](object-organize.md)，不提供调用重排 |
| `device_catalog` | 原路线 S6a | [本机设备描述目录](device-catalog.md)，描述版本不是现场固件 |
| `io_mapping_inspect` | 原路线 S8b | [已验 AM610 HIGH_SPEED_IO 连接器 2 只读查询](io-mapping-inspect.md) |
| `device_inspect` | 0.17 既有基线 | 目标设备的可访问身份、连接器和离线参数，不等于完整配置 |
| `pou_create` | 0.17 既有基线 | 根级 ST POU 创建；PROGRAM 不自动绑定任务，FUNCTION 返回类型有限定 |
| `declaration_create` | 0.17 既有基线 | 根 GVL／结构体及[限定枚举](enum-dut.md)、[一维数组 DUT](array-dut.md) |
| `method_create` | 原路线 S2a | [PUBLIC ST Method](methods.md)，void／DINT |
| `property_create` | 原路线 S2b | [PUBLIC DINT Property/Get/Set](properties.md)，不自动改造已有属性 |
| `code_apply_change` | 0.17 既有基线 | 受保护的限定源码修改，子对象范围见各专题，不是任意工程配置写入 |
| `project_build` | 0.17 既有基线 | 实际离线编译及诊断；编译通过不是 PLC 运行验证 |
| `variable_edit` | 原路线 S4，含后续细分动作 | [限定变量、初值、类型与聚合直接成员编辑](variable-edit.md)，S4b 未全部完成 |
| `project_save` | 0.17 既有基线 | 保存关闭重开及读回，编译证据须对应最终文件 |
| `operation_status` | 0.17 既有基线 | 查询原操作；正式隔离仅观察，reconcile 不重放 |

合计 **22 项基线＋14 项原阶段工具＋2 项后来细分工具＝38 项**。后两项是占位符覆盖清除、任务调用替换；原路线未逐字单列它们，不改写其追加时点。0.35／0.36／0.38及原独立分支0.39（本候选未纳入）是 `variable_edit` 的动作／作用域细分，没有增加工具数。此计数不能换算阶段完成率。

## 兼容接口与证据边界

- 默认直接修改用户指定工程；`project_open_copy` 仍是显式兼容接口，新源创建受管理副本，已有登记复用原副本，不覆盖来源。不因文档整理删除该接口。
- `project_compare` 只在用户明确要求比较时使用。`capture` 采集精确 Application 的受支持源码与实际可读任务配置，直接编辑用 `current-project`；`working-copy` 保留旧兼容语义，`registered-source` 仅适用于有独立来源的旧副本。`compare` 引用两项成功采集记录，按应用相对路径和类型匹配，不猜重命名；设备／I/O、其他对象和运行行为不在范围内。修改前快照不能事后补造，比较版本不替代操作快照或磁盘版本。
- 新增初值、源码初值、任务周期及调用顺序属于离线配置。只有任务集合与 PROGRAM 身份目录按唯一身份对齐，任务内调用顺序、备注、绑定、源码和配置仍严格核对；不提供重排工具。
- `io_mapping_inspect` 的首项 getter 与同状态导出完整列表是两层证据；变量声明原生绑定身份、最终自动地址、方向参照方与 PLC 运行仍缺证。26 项只是原夹具的两个参数根和 24 个 BOOL 成员，不是所有工程的物理点数。
- 占位符覆盖清除已交付；普通直接引用移除未交付。历史[移除探测](library-reference-remove-probe.md)中“清除覆盖未实现”只描述当时状态，不撤销后来的[0.37 交付](library-placeholder-clear-0370-merge.md)。

## 剩余主线与恢复条件

当前完整分类见 [README 剩余事项](../README.md#未完成功能与计划阶段)，不把已交付的清除覆盖、静态用法查询或调用替换继续列为未完成。执行顺序和范围变更规则只在 [agent.md 前部](../agent.md#当前路线与范围变更规则)集中维护；后续任务须明确要求先读最新 main 的 agent.md 与 README，规划文件不会自动注入运行时。

1. **待开发且需限定范围：** 文档复核合并已完成；[S4b普通结构体字段新增](struct-field-add.md)在原0.39功能分支实施但真实验收未完成；已从本次常驻合并准备候选移除，原分支与首败保留。其余 S4b／S5 离线子项逐项限定；S6 离线参数等与 S7 按明确业务需求推进；S2／S3 更广扩展尚未安排。
2. **受阻／暂缓：** S5 普通库移除须补精确原生选择与使用／反向依赖覆盖；S6b 设备添加须有实际对端连接器与父设备归属证明；S7 须有原生或明确受限的引用身份与覆盖，再评估安全重命名／删除。S8 任务移除须厂商修复或修正的公开接口，重排须可信公开行级操作；映射写入须有效 I/O Application、重复映射和输入变量写引用证据；PDO 须正常实例及可信当前配置读取入口。S8 只在有新证据时恢复，不反复扫描旧归档或通过写入绕过前提，不阻塞离线交付。
3. **S9 在线后续：** 因没有测试 PLC 暂缓。将来只读连接／监控、限定运行参数写值、Online Change 分别验证，不以编译成功替代实机证据，也不自动退化为下载、启停或复位。

文档合并完成状态以 Git 和收尾记录为准，已完成步骤不重复。既定下一项不在本轮执行，其他事项仍是候选方向，没有日期承诺。调整顺序或新增能力须按 agent.md 说明关系、影响与必要性，并经用户明确同意；不能以旧原型、助手建议或探测受阻自行扩展范围。原 S1–S9 未全部完成，当前候选也不等于正式发布或生产验收。

## 辅助维护、客户端与历史记录

DSH 欢迎页／认证、CLI 接入及转储／故障采证单列辅助维护；它们不计入 MCP 业务工具完成率。租约、去重、检查点、隔离、可信退出及异常冻结是现有必要保护，不因归类而删除或放宽。独立探测脚本不是任意执行、设备添加或映射写入 MCP 工具。

沿用[0.38.0 合并记录](fb-interface-initializer-0380-merge.md)：日常配置已指向 `D:\InoPro-Fixed\0.38.0-b664e15e6cea\dist\server.js`，独立连接取得 0.38.0／38 工具；Desktop 最终日常连接、模型实际接收完整初始化正文仍未验。本轮不重取握手或修改 DSH／Codex 配置。早期 CLI 接入及工程闭环仍属于各自受验产品，不用当前独立握手替代。

README 的折叠阶段记录及 agent.md 的历史段落保留原文、失败、测试计数和提交归属。旧专题的版本和“当前／未实施”按原时点解释，当前功能以本表和 README 为准。unknown、隔离、锁、封存工程、默认环境性能、崩溃根因、CmpLog、脚本信任、Desktop 与实际运行边界均保留；本轮不修改历史终态，不重跑任何工程或模型任务。

## 核对来源

仓库内契约、各专题及固定历史 Git 路线图是可直接复核的主入口。补充本地范围审计为 `D:\InoPro-ScopeAudit-20261124-174442\AUDIT.md` 和 `tool-scope-matrix.json`；它记录界面提议作废、来源指纹和逐工具分类。本页不是只依赖本地目录的产品说明。

最初开发提示词明确复用 DSH、不开发独立前端或通用 Agent 框架；总体规划曾将定制界面列为未来另议，本次已作废。两份本地历史材料不是不可变的历史 Git 文件，其归档 SHA-256 分别为 `673c5402dde3a21e97ef01054c374ddf51e5d9273bcdb9d534af4426f151b672`、`ef99896511b016f528b1be069350737240a2b8258bfea7b689d59ecc50b1a0a3`。本轮核对来源及范围，不据此追认所有历史授权。

本轮仅做文档／链接、工具清单覆盖和产品未变检查；没有启动服务、IDE、Desktop 或模型，没有修改工程、登记、租约、隔离或日常入口，也没有新功能实现。
