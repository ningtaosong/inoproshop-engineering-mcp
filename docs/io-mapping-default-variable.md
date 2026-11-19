# S8b · 首个映射对象的默认变量字段与编译结果

在 InoProShop 1.9.1.6 的 AM610 测试工程中，目标成员 `InputData.Bit0` 首次建立映射时，`default_variable` 从原生 null 变为零长度字符串符合本机实现。新的独立夹具通过了严格的写后读回，随后编译器拒绝映射表达式 `GVL_IOProbe.Input0`。本次取得未保存状态下的两种读数，保存版的独立重开正例仍缺。产品保持 0.33.0 候选版、36 项工具。

## 字段依据与允许的变化

本机脚本适配器的 `get_First`（0x06000148）在集合为空时返回 null。`get_default_variable`（0x06000152）检查首项的 `IVariableMapping2` 接口，缺少适用首项时返回 null，否则调用它的 `DefaultVariable` getter。单独一个 null 不足以判断列表是否为空。

已核实的分支在完整映射列表为空、表达式非空且前置检查通过时调用 `AddMapping`。本机 OEM 实现（0x0600130b）构造 `VariableMapping(-1, expression, createVariable)`。三参数构造器（0x060012fa）在 IL_0014–0019 将零长度字符串写入字段 `_stDefaultVariable`。OEM getter（0x060012f5）直接读取该字段；序列化属性将其导出为名为 `DefaultVariable` 的字符串。此字段属于映射对象的元数据。GVL 源码中的 `FALSE` 是 BOOL 声明的初始化值，运行值未读取。已存在的映射对象、其他设置分支和不同版本均须分别验证。

[探测守卫](../scripts/probes/io_mapping_positive_guard.py)核对目标的设备 GUID、连接器、参数及成员路径。写前要求该键的完整导出列表为空，`variable` 与 `default_variable` 都有原生 null 证据。写后要求同一键仅一条指定表达式，`CreateVariable=False`、getter 为既有变量标志，且 getter 与导出均明确给出空串；导出须含唯一、有类型的字符串字段。在这些条件成立后，仅在预期写前快照的副本中更新该键这一字段，逐项对照写后状态。同阶段复查仍严格比较原值。其他通道发生相同变化、清空已有非空默认值、字段缺失或读取失败、非空新值、导出不一致、数量及表达式错误均拒绝。[离线正反例](../scripts/probes/test_io_mapping_positive_guard.py)

对[上一轮的原始快照](io-mapping-positive-probe.md)按新规则进行事后离线核对，目标字段变化可以解释。当时的正式结果仍为独立原生探测 unknown，未发现迟到结果。旧工程、检查点、占用标记及原始派发记录均保留。

## 新夹具验收

工程为 `D:\InoPro-S8b-Positive-20261119-215332\engineering\AM610_IO_Positive.project`。操作标识为 `2263c576-a60b-412a-a3fe-ca9ed3009185`。使用已核实的中性 AM610 样例建立新夹具。原登记目录为 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`。启动前四项历史 MCP unknown 均有正式隔离，原独立探测没有对应的 MCP 操作记录。

| 阶段 | 实际结果 |
|---|---|
| 夹具准备 | 在 Application 根建立 GVL_IOProbe，源码为 `Input0 : BOOL := FALSE;`，无 AT 地址。GVL 对象标识为 `7d4a1971-73f6-404c-b624-9b7de2731b0e`。保存准备版，编译为 0 错误、0 警告；正常关闭，准备进程退出码 0。 |
| 写前 | 重开后复核 BOOL 成员与声明、完整空映射列表及磁盘版本。新句柄中再次核对，建立检查点。磁盘及检查点 SHA-256 为 `1c61641926f25d1a37daa747334649ed8b3776c6d4899eeb1a748ab4c6824f12`。 |
| 写后 | setter 派发一次。设备实例 `bf0d0fd8-de24-465d-a555-4bb14a9a8f37`、连接器 2、参数 13、成员 Bit0 的 getter 首项为 `GVL_IOProbe.Input0`，Id=-1，`maps_to_existing_variable=true`。同句柄原生导出的完整列表恰有 1 条，CreateVariable 为 false，DefaultVariable 为空串。父参数、相邻成员和其余通道合计 25 项，完整列表均为空。已读源码、任务和声明均通过写后核对。 |
| 映射状态编译 | 已执行一次真实编译，诊断完整，1 错误、0 警告。编译器原文为 `Invalid application <GVL_IOProbe> in mapping <GVL_IOProbe.Input0>`。诊断对应内存中写后状态，导出 SHA-256 为 `9ea42fcd0beee3a5f2cdfa05534e43eef1711ae5c520fdd9ff68b04534097b2a`。 |
| 停止 | 已写入后的探测结果为 unknown。映射未保存，独立保存后重开和保存版编译均未执行。磁盘主文件仍为准备版；检查点、原异常及首次诊断保留。 |

编译器报告此表达式的 Application 无效；本次没有试用其他限定名。getter 表达式、导出的完整列表计数、已有 GVL 声明分别来自三个不同读回位置。它们能够说明离线配置中出现了哪些文字，尚无原生映射到变量声明的对象标识。方向的参照方、自动地址模式下的最终地址、现场接线和运行值均未核实。

## 收尾与保全

映射阶段的 IDE 在 240 秒观察期限内未报告正常关闭或退出码；后续按创建身份复核，原进程已不在。服务租约和新夹具租约均为 stale，没有正常释放回执。未启动并行服务或操作 DSH。原服务锁由既有排他机制按原字节归档，原夹具锁和占用标记保留，旧操作及四项历史 MCP 隔离记录的文件指纹均未变。

本次映射前后，新夹具的主文件哈希、文件身份和时间均未变。两份 .opt 未变；.projectbackup 内容变为准备版，另留有 .project.~u。离线守卫 19/19、导出解析 3/3、采集 10/10 分别通过。旧归档的事后解释、两次真实编译与这些离线测试分开计证。

## 下一项证据

限定只读查询还缺一份编译器接受且已保存的非空映射样例，以及由独立 IDE 重开后取得的 getter、同版导出和磁盘哈希。适合优先查阅已有可信工程或本机厂商资料来确认合法表达式。首项 getter、完整集合覆盖、变量语义绑定仍各有边界。当前未交付映射查询、写入或 EtherCAT PDO 编辑工具。
