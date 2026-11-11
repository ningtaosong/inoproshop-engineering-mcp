# S4a 变量级编辑（开发分支候选）

`variable_edit` 以 `add` 或 `set-initializer` 为动作，服务在受管理队列内重新读取目标声明，再生成插入单条声明或替换显式初始化值的最小源码差异。它沿用完整对象哈希、工程快照、磁盘哈希、写前检查点、请求去重、保存关闭重开及读回。调用者提供精确 Application 和对象身份；用户只需说明工程和目标。

首版只接受普通 ST PROGRAM／FUNCTION／FUNCTION_BLOCK 的 `VAR` 局部声明，以及 Application 根 GVL 的 `VAR_GLOBAL`。新增必须给出 `BOOL`、`DINT` 或 `TIME` 类型及初值。变量名限定 ASCII 字母或下划线起始，后续为字母、数字或下划线。BOOL 为 `TRUE`／`FALSE`，DINT 为 -2147483648..2147483647 的规范十进制整数，TIME 为非负整数 `T#...ms`／`T#...s`，服务限 0..60000 ms。本机真实编译已覆盖 `T#0ms`、`T#10ms`、`T#60000ms`、DINT 两端值及 BOOL；这是服务允许范围与代表性边界的验证，不是厂商 TIME 全部取值范围的结论。

候选版内名称边界修正：新增变量名按不区分大小写的完整词元拒绝 ST 语法、类型、运算和 CODESYS 保留名称（例如 `IF`、`END_IF`、`CASE`、`AND`、`FOR`、`BOOL_TO_INT`）；连续下划线和其他非首版普通标识符形式也拒绝。`IfEnabled`、`CaseCount`、`ForDelay` 之类含关键字子串的名称可以使用。规则参考 CODESYS 官方的[关键字](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_keywords.html)、[变量命名规则](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_rules.html)和[保留名称诊断](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_error_c0543.html)。本服务只允许首版普通 ASCII 名称，不支持反引号转义、厂商扩展标识符，也不声称已枚举 InoProShop 所有专有名称。此校验在派发写入前执行，不以写入后编译判断名称是否合法。

现有变量仅替换一个已明确声明的显式字面初值。联合声明、多个合适声明块、无显式初值、特殊修饰、AT、结构体聚合成员、数组元素、访问器内变量、类型或名称修改均拒绝。变量表是源码声明解析，不是原生符号表、语义引用分析或运行变量采集。

编译、保存和目标读回仍须按任务执行；本工具写后保存重开不代替编译。默认流程不采集比较基线。候选固定构建已在原 DSH 登记数据目录用独立工程完成真实 MCP 类型边界验证，并由一次 DSH CLI 模型任务完成 GVL 初值修改、新增及第二路调用接入；保存前与保存版各一次编译，均为 0 错误、1 条 CmpLog 警告。开发端第一次闭环误用另一份历史数据目录，其证据单列且不算原目录验收。CLI 另有一次辅助 IPC 文件过早读取失败，随后使用原操作状态取得终态；模型增加若干不必要的辅助查询，答复没有附完整覆盖证明。CLI 不等于桌面交互或运行验证，日常 DSH 仍使用原 0.22 固定入口。

名称边界修复前定向首败为 8/10（规划器和服务层各一项失败）；修复后构建、类型检查、定向 10/10、完整回归 373/373 通过，定向属于完整集合，不累加。原真实 MCP 和 DSH CLI 正向工程证据仍归属修复前候选提交，并非本次修改后的重新实测。本次不向真实 IDE 提交非法名称，也不重放原模型任务。
