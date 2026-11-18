# S7a 按声明查询限定 ST 用法

`codex/st-variable-usages` 候选版为 0.30.0、33 项 MCP 工具。本工具只读取工程，不需要编译或保存。原有 `project_search` 仍给出字面或完整词元命中，`variable_inspect` 仍解析声明。此次静态规则来自 `codex/semantic-reference-probe` 的独立夹具及逐位置预期，原探测的提交为 `fba075e00eba78c886dd1fcf18eee95e2c5c796e`。

## 操作示例

> 请查 `PLC_PRG` 局部变量 `DelayTime` 在哪里使用。列出明确位置，分别报告可能相关却不能确认的位置和未覆盖的来源。只读，不编译或保存。

用户只需指出工程与声明上下文。Agent 先通过 `variable_inspect` 定位确切对象和声明，同名时核对作用域。向 `variable_usages` 传递 `projectId`、`applicationId`，以及该行的 `objectId`、`section`、`name`、`contentHash`、`namePosition.startOffset/endOffset`。它们是选中原文声明的定位证据。不要用 `entries` 的显示索引或变量名代替位置，也不要把对象 GUID 称为原生变量 ID。

## 结果及边界

| 情形 | 首版处理 |
| --- | --- |
| 普通 ST `PROGRAM` 内的简单赋值，未限定名称 | 绑定当前程序的普通 `VAR`，保留大小写原文。 |
| 同一 Application 中的 `GVL.Variable` | 限唯一根 GVL，存在同名限定前缀或归属歧义时保持未知。 |
| `instance.field` | 限普通局部标量实例，直接字段及结构体类型均须能唯一定位。 |
| 数组下标、嵌套成员、指针、引用、类型别名、调用实参、控制流或不完整语句 | 不推断绑定。可识别的同名候选在 `unknown` 报告，不能划定的区域在 `coverage` 报告。 |

`targetDeclaration` 是目标声明；`usages` 是静态推导归到它的使用位置；`unknown` 是未绑定的同名候选。其他声明的明确用法不计入目标。声明行、注释和字符串不计为使用。每条位置包含对象路径、内容哈希、实现区域、行列及短原文。行列从 1 起，偏移从 0 起，使用 LF 源码的 UTF-16 单位，结束偏移不含。

分页复用同一目标定位。按实际 `page.nextOffset` 和 `version` 续页，`usages` 与 `unknown` 共用游标。每页重新核实只读原文、磁盘版本、源码清单指纹和规则版本。旧的声明定位或页面版本不能续用，重新定位声明后再查询。`coverage.gapCount` 是全部记录的缺口次数，`coverage.gaps` 提供至多六项示例。

零结果只表示在已读且受支持的范围内未找到目标用法。可视化、其他语言、编译库、任务调用、设备配置、I/O、声明初始化及超出首版的表达式均未覆盖。该工具提供限定静态证据，不能给出编译器绑定、全工程无引用、可安全重命名或删除的结论。
