# S7 语义引用证据可行性探测

**建议②：目前只能对明确限定的 ST 子集提供静态绑定结果。** 三个同名声明经原生源码读回，标识符模式同时命中局部、全局和成员。限定规则在夹具中区分了局部读写、显式 GVL 和直接结构体成员。`Configs[1].DelayTime` 虽能编译，仍只有词元命中，静态绑定记为未知。完整逐位置结果和源对象身份见[证据表](semantic-reference-evidence.md)。本次探测独立于 MCP，产品保持 0.29.0、32 项工具。

## 本机原生接口

基线为 `e29a8bcaefffe671443c2526ba2db383e3542d9d`。环境为 InoProShop 1.9.1.6、ScriptEngine 插件 3.5.11.10。安装文件的接口和调用边显示，`CrossReferenceView.dll` 的 `PerformSearchForSymbol` 由 IDE 视图实现；Inovance 视图还使用 `LanguageModelUtilities` 的编译模型及交叉引用服务。只读重开进程确认对应程序集已加载。元数据证据包含 `ICrossReferenceService`、`GetCrossReferenceNodesWithinApplication` 和 `IPrecompileCrossReferenceService`，这些是进一步定位的线索。该视图有按声明筛选和跳到使用位置的命令，视图入口本身没有提供脚本可消费的绑定行。 [CODESYS 交叉引用视图](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_cmd_view_cross_reference_list.html)

在本机实际脚本对象上检查了 `scriptengine`、`system`、`projects`、工程、Application、三个源对象及 `PLC_PRG` 的两个文本区域。测试过的候选属性中没有取得能按使用位置查询声明或按声明查询使用位置的可调用入口。成员探查与装配元数据不等于执行内部服务；本次未直接调用视图内部依赖。Application 上 `create_symbol_config` 的实际签名要求 `Guid`；夹具准备中的可选符号配置调用传入空值，返回 `expected Guid, got NoneType`，直接子对象身份核对显示该调用未创建对象。两程均未取得符号配置实例，因此 `get_all_signatures(False)` 没有实际可用返回；错误保留，不据此判断该接口不可用。公开接口描述的是编译器／配置签名和变量列表。即使读到这些条目，仍需独立验证是否能定位使用位置。结论限于本机版本和已测脚本入口。 [CODESYS 符号配置脚本参考](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptSymbolConfigObject.html)

## 独立夹具和定位依据

夹具路径为 `D:\InoPro-S7-ReferenceProbe-20261118-165924756\engineering\AM610_S7_ReferenceProbe.project`。来源为原归档中性 AM610 样例，种子 SHA-256 为 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。预期声明、表达式位置及明确非引用在 IDE 启动前独立登记。第一程仅在新夹具中准备 `PLC_PRG`、`GVL_Config` 和 `ST_S7Config`，离线编译一次，**0 错误、0 警告**，随后保存退出。该编译只证明夹具语法通过。

第二程只读打开已准备的工程，确认 Application GUID、三个原生对象 GUID、声明与实现、当前源码内容哈希和工程快照，与准备阶段一致。证据绑定精确工程路径与文件哈希、Application 路径及 GUID、对象路径及 GUID、声明区及名称的 UTF-16 位置和对象内容哈希。静态变量身份来自这些字段，未取得原生变量 ID 或原生引用位置。第二程前后主文件 SHA-256 均为 `672cd61f8d443a67875ba91ab3363e5bf316f5cf8b8d27f0213f3e8b69d284bf`。准备阶段新增两份 `.opt` 和 `.projectbackup`；只读重开阶段管理员 `.opt` 和 `.projectbackup` 指纹变化，附属文件单独报告。两程正常退出。

## 两个使用问题

- **搜局部 `DelayTime` 会把同名全局或成员算进去吗？** 现有 `project_search` 的 `identifier` 模式会一并返回它们作为词元候选。本轮在原生只读清单上调用同一结果计算函数，得到 8 处词元命中，其中 3 处是声明。另外 3 处注释或字符串仅被 `literal` 命中。限定静态规则只把 `PLC_PRG` 实现第 1、2 行归到局部，另两处分别静态归到显式 GVL 和结构体字段，数组元素成员留为未知。原生绑定行数为 0。
- **没返回引用代表什么？** `NeverUsed` 的零命中只说明已读的实现文本没有该词元。`Configs[1].DelayTime` 有词元命中却没有静态绑定，是明确的覆盖缺口。零结果不能证明整个工程无引用，也不能推断删除或重命名安全。

静态探测只处理这三个对象的普通 ST 声明及简单赋值内的局部未限定名称、唯一 Application 根 GVL 的显式成员、唯一结构体类型的直接局部实例成员。大小写不敏感。同名限定前缀、未知类型或语法、无法划界的字符串、数组下标、嵌套表达式、间接访问和跨作用域绑定没有可靠证据时保持未知。词元检索继续按原有范围输出候选，`variable_inspect` 继续定位原文声明。

| 范围 | 实际覆盖 |
| --- | --- |
| 可视化 | 属性表达式、画面对象和绑定未读 |
| 其他语言 | LD、FBD、SFC 等非 ST 源没有参与这次静态推导 |
| 编译库 | 无库内部源码或传递调用绑定；未限定库名调用不能靠拼写排除 |
| 任务调用 | 原生树可枚举任务配置节点，本次源码推导未解析其调用边 |
| 设备配置 | 设备参数、I/O 地址、映射和配置引用不在本次覆盖内 |

同一组断言在离线夹具和保存后只读回读上均通过，包括未解析类型、数组成员、复合表达式、未闭合字符串等反例。没有执行 DSH 模型任务或 PLC 操作。两程集中完成后恢复日常 DSH 0.29.0 固定入口的进程，配置及登记指纹未变，握手和工具清单未取证。下一轮如继续原生验证，需先确认符号配置实际接受的布局计算器 `Guid`，并找到可绑定当前编译源码版本的只读交叉引用结果入口。
