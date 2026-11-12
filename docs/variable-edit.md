# 变量级编辑：S4a 与 S4b 限定子阶段
## S4b 第三子阶段：基础类型与显式初值同步修改（0.26.0 功能分支候选）

variable_edit 的 set-type 只用于普通 ST PROGRAM／FUNCTION／FUNCTION_BLOCK 的普通 VAR，或 Application 根 GVL 的普通 VAR_GLOBAL 中已存在、唯一的单变量声明。原类型和目标类型均限 BOOL、DINT、TIME；原声明必须已有符合本服务规则的显式字面初值。调用时同时提交目标 type 与 initializer，并用 expectedOldType、expectedOldInitializer 绑定当前原文，外加已有对象哈希、工程 snapshot 与磁盘哈希。用户只需说明工程和需求，内部身份由 Agent 读取。

服务在队列内重读完整声明，确认普通且唯一的目标块、变量、原类型及初值，仅替换类型和初值两个 UTF-16 原文片段。其他声明、注释、空白和实现区保留；同类型同值返回 noOp，不伪造保存证据。新动作拒绝 section 及成员专用参数；旧 add、set-initializer、set-member-initializer 的参数语义不变。VAR_INPUT／VAR_OUTPUT、联合/特殊声明、结构体与聚合成员、数组、函数返回值、Method／Property 内声明和运行值均不在本阶段。

类型修改可能影响调用和表达式。Agent 仅在用户授权范围内按需定位并修改相关使用位置，词元检索不等于语义交叉引用；真实编译失败时报告已写入内容与诊断，不自动回滚或扩大需求。默认不采集工程比较基线；编译、保存关闭重开、必要复编和目标读回仍按日常流程执行。源码初值不是运行观测值。此前 0.25.0 的正向验收不属于本候选的真实工程验证。


## S4b 第二子阶段：功能块输入／输出（0.25.0 限定范围已合并）

`variable_edit` 的 `add`、`set-initializer` 可显式传 `section: VAR_INPUT` 或 `section: VAR_OUTPUT`，仅处理普通用户 ST FUNCTION_BLOCK 中已存在且唯一的相应声明块。新增普通 BOOL／DINT／TIME 单变量必须给出类型和受限字面初值；修改仅替换已有单变量的显式初值。服务重读实际源码和磁盘版本，检查同一功能块其他声明区的变量重名，新增前还核对直接 Method／Property 的名称和原生子对象身份。写前检查点、去重、写后读回、保存重开及结果不确定冻结沿用旧机制。省略 `section` 的旧调用仍定位普通 POU 的 VAR 或根 GVL 的 VAR_GLOBAL；`set-member-initializer` 拒绝 `section`。

缺失或重复声明块、联合声明、地址绑定、RETAIN／PERSISTENT 等特殊声明、解析缺口以及类型、名称、方向变更均不在本子阶段。VAR_IN_OUT、Method／Property 内声明、数组和结构体变量及运行值写入也不支持。功能块 VAR_INPUT 的源码初值发生于实例初始化；显式调用实参会对该次调用赋值。不能把修改初值说成调用方显式传入的时间已改变，也不能据此推断运行当前值。

候选版内声明块边界补修：显式选择 `VAR_INPUT`／`VAR_OUTPUT` 时，写前先统计源码中全部同类块，包括空块及带 `RETAIN`、`NON_RETAIN`、`PERSISTENT`、`CONSTANT` 或属性的块。只有唯一、普通且边界完整的目标块可编辑；另有同类块时，即使目标变量名唯一也拒绝。`add` 与 `set-initializer` 使用相同判定，不自动合并或重写声明块。此补修仅收紧异常声明的写前拒绝；此前真实 MCP 和 DSH CLI 正向验收归属原候选版本，补修后未重新执行工程任务。离线失败复现、修正测试和完整回归见补充复核包；原首次失败及流程、答复偏差继续保留。

验收归属：原固定产品 `9b5d0fcb08cc2e5bf80c2a63becd3ef6aa9ac3c6` 的独立真实 MCP 测试覆盖输入、输出两区的 BOOL／DINT／TIME 新增及三种已有初值修改；一次 DSH CLI 模型任务实际使用 `section` 新增两个变量、修改输入初值，并用旧源码编辑能力接入实现和调用。两套工程均真实编译、保存关闭重开、保存版复编和目标读回；各两次编译为 0 错误、1 条既有 CmpLog 警告。CLI 20 项成功工程操作之外有两次参数拒绝、一次辅助读取失败和多余辅助查找；未调用比较，未观察运行。最后的声明块边界补修另有定向36/36和完整回归395/395，计数不相加，未重跑真实工程或模型任务。原验收结束时日常 DSH 固定入口为 0.24；后续实际加载版本按部署连接证据核对，恢复进程不等于握手或模型接收。

`variable_edit` 以 `add` 或 `set-initializer` 为动作，服务在受管理队列内重新读取目标声明，再生成插入单条声明或替换显式初始化值的最小源码差异。它沿用完整对象哈希、工程快照、磁盘哈希、写前检查点、请求去重、保存关闭重开及读回。调用者提供精确 Application 和对象身份；用户只需说明工程和目标。

首版只接受普通 ST PROGRAM／FUNCTION／FUNCTION_BLOCK 的 `VAR` 局部声明，以及 Application 根 GVL 的 `VAR_GLOBAL`。新增必须给出 `BOOL`、`DINT` 或 `TIME` 类型及初值。变量名限定 ASCII 字母或下划线起始，后续为字母、数字或下划线。BOOL 为 `TRUE`／`FALSE`，DINT 为 -2147483648..2147483647 的规范十进制整数，TIME 为非负整数 `T#...ms`／`T#...s`，服务限 0..60000 ms。本机真实编译已覆盖 `T#0ms`、`T#10ms`、`T#60000ms`、DINT 两端值及 BOOL；这是服务允许范围与代表性边界的验证，不是厂商 TIME 全部取值范围的结论。

候选版内名称边界修正：新增变量名按不区分大小写的完整词元拒绝 ST 语法、类型、运算和 CODESYS 保留名称（例如 `IF`、`END_IF`、`CASE`、`AND`、`FOR`、`BOOL_TO_INT`）；连续下划线和其他非首版普通标识符形式也拒绝。`IfEnabled`、`CaseCount`、`ForDelay` 之类含关键字子串的名称可以使用。规则参考 CODESYS 官方的[关键字](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_keywords.html)、[变量命名规则](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_rules.html)和[保留名称诊断](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_error_c0543.html)。本服务只允许首版普通 ASCII 名称，不支持反引号转义、厂商扩展标识符，也不声称已枚举 InoProShop 所有专有名称。此校验在派发写入前执行，不以写入后编译判断名称是否合法。

第二轮名称边界补修将官方[内建运算符分类及转换形式](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html)纳入写前判定：算术、位移、选择、比较、地址和数值运算符（例如 `ADD`、`SIZEOF`、`SHL`、`SEL`、`ABS`），以及显式 `SOURCE_TO_TARGET` 和重载 `TO_TARGET` 类型转换。只按完整名称、大小写不敏感匹配；`AddCount`、`SizeOfBuffer`、`ToBoolFlag` 等仍可用。普通库函数名称不因属于库而整体列入禁用清单。类型集合依照所引 CODESYS V3 资料，不推断厂商专有运算符或所有目标组合均受本机编译器支持。第一轮 `IF` 缺口与本轮 `ADD` 缺口的首败记录分别保留。

S4a 的 `set-initializer` 仅替换一个已明确声明的显式字面初值。联合声明、多个合适声明块、无显式初值、特殊修饰、AT、聚合成员、数组元素、访问器内变量、类型或名称修改均拒绝。变量表是源码声明解析，不是原生符号表、语义引用分析或运行变量采集。

## S4b：已有具名聚合直接成员（0.24.0 限定范围已合并）

新 `set-member-initializer` 动作只修改 Application 根 GVL 普通 `VAR_GLOBAL` 单变量的已有最外层具名成员。父变量类型必须是同一 Application 根节点内唯一的原生 ST 结构体 DUT；字段在其真实声明中唯一，类型仅 `BOOL`、`DINT` 或 `TIME`。字段类型由服务重读 DUT 确认，不由调用者填写，也不由 `variable_inspect` 的语法成员行推断。字面量及界限沿用 S4a。调用方提供父变量 `name`、独立 `memberName`、当前 `typeObjectId`、`expectedTypeHash` 和 `expectedOldInitializer`，并提供 GVL 的 `objectId`、`expectedHash`、工程 `expectedSnapshot` 与 `expectedDiskHash`；用户不需要填写这些内部证据。

服务在原队列中重新读取 GVL，分页枚举同一 Application 的受支持对象，重读精确 DUT，解析父变量和结构体字段，再从 LF 规范原文中重算唯一字面量的 UTF-16 范围。原生写入边界再次核对结构体身份、源码哈希和工程/磁盘版本；写后核对只改变指定成员值，保存关闭重开后再次核对 DUT。相同值返回 `noOp`，不生成保存证据；重复 `requestId` 返回原操作。旧 `add`、`set-initializer` 拒绝成员专用参数，原 27 项其他工具的输入不变。

例如 `Config2 : ST_AlarmConfig := (DelayTime := T#5s);` 可在真实 DUT 的 `DelayTime : TIME` 字段与父变量原值均确认后，仅将 `T#5s` 改为 `T#8s`。`Config.DelayTime`、字段声明初值、注释、其他成员及实现不应改变。限定名称、库或命名空间限定类型、联合/特殊声明、缺失或重复成员、目标表达式或嵌套目标、数组及不完整边界都拒绝；不会补成员、修改类型或写入运行变量。这里确认的是本地声明和显式初始化语法，不是完整编译器符号解析或运行值观察。0.24.0分支的386项完整回归与其后14项定向分别通过；正确登记目录的独立真实MCP核对了三种字段及保存版编译，一次DSH CLI模型任务核对TIME目标。最初开发端误用另一份历史登记目录，且验收脚本曾因错误字段断言停止，两份原记录均保留；最终小幅冻结边界收紧后没有再次运行完整回归。CLI两次编译各0错误、1条CmpLog警告，辅助文件查找偏多，原答复将字段类型误写为`TYPE`；工程闭环通过，流程及展示保留偏差。限定功能已合并 main；日常固定入口实际加载与此次候选模型验收分别取证。

编译、保存和目标读回仍须按任务执行；本工具写后保存重开不代替编译。默认流程不采集比较基线。候选固定构建已在原 DSH 登记数据目录用独立工程完成真实 MCP 类型边界验证，并由一次 DSH CLI 模型任务完成 GVL 初值修改、新增及第二路调用接入；保存前与保存版各一次编译，均为 0 错误、1 条 CmpLog 警告。开发端第一次闭环误用另一份历史数据目录，其证据单列且不算原目录验收。CLI 另有一次辅助 IPC 文件过早读取失败，随后使用原操作状态取得终态；模型增加若干不必要的辅助查询，答复没有附完整覆盖证明。CLI 不等于桌面交互或运行验证，日常 DSH 仍使用原 0.22 固定入口。

名称边界修复前定向首败为 8/10（规划器和服务层各一项失败）；修复后构建、类型检查、定向 10/10、完整回归 373/373 通过，定向属于完整集合，不累加。原真实 MCP 和 DSH CLI 正向工程证据仍归属修复前候选提交，并非本次修改后的重新实测。本次不向真实 IDE 提交非法名称，也不重放原模型任务。

第二轮在提交 `53746dc52390cddb70dd1b40d71692ea8d388020` 上的新增首败为 9/11：规划器接受 `ADD`，离线服务夹具派发 `read`、`change` 并返回成功。补修后名称定向 11/11，含变量解析及契约的相关回归 29/29，构建和类型检查通过；这次没有重跑完整回归。上段 373/373 仅属于前一提交，不能记为本轮补修后的全量结果。旧真实 MCP 和 DSH CLI 不重放，日常 DSH 仍为 0.22，Codex 入口不变。
