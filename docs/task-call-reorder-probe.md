# S8a 探测：已有周期任务的调用重排

**结论：暂不开发限定重排工具。** 在本机 InoProShop 1.9.1.6 检查的公开脚本接口中，未找到一次即可将现有调用行连同备注和绑定移动到指定位置的操作。0.33.0 候选版仍有 36 项 MCP 工具。本轮在第一道接口检查处停止，未创建 AM610 夹具。

## 检查了哪些入口

| 入口 | 本机安装件的读数 | 对本次请求的意义 |
| --- | --- | --- |
| `task.pous` | `ScriptEngine.dll` 中的 `IScriptTaskObject.get_pous` 返回 `IScriptPouObjectCollection`，未声明对应 setter。该集合只有 `add(name, comment)`、`insert(index, name, comment)`、`replace(index, name, comment)`、两种 `remove`、`__len__()` 和整数索引读取。两个继承接口提供枚举。具体的 `ScriptPouObjectList` 也只额外公开枚举器。 | 可按零基位置读取原始行。索引器的实现读取名称与备注并构造 Python 元组，未返回带移动方法或行 GUID 的调用对象。没有可核实的重排源／目标索引约定、提交点或异常契约。 |
| 通用工程树 `ScriptObject.move(new_parent, new_index)` | 两个公开重载分派到 `IPSNode.Move`。其索引属于目标父节点的子节点。任务同步器按变更对象及其父链选择同步方向，其中 `EqualizeTaskCallList` 的修正分支先清空任务列表，再按子对象重建名称、ID 和备注，最后提交；该方法还有异常处理分支。 | 树节点的位置无法独立证明配置中的同一调用行已精确移动。不能把这一同步路径认定为保留原列表的单项重排。实际工程触发哪条分支未经观测。 |
| 编辑器的“上移／下移” | 两个按钮处理器均为私有方法。它们读取界面选中项和可写任务，按索引取项、移除后插入，再提交。底层 `IPouObjectList` 还公开了供插件使用的索引 setter；脚本集合没有将它暴露为重排操作。 | 本轮排除私有处理器、移除后插入、清空重建和多次替换。没有调用上述写入路径。 |

复查时可在对应安装件上定位以下方法 token。每份文件的 SHA-256、MVID、签名、访问级别及选定方法的 CIL 位置均收录在复核包的原始清单中。

| 安装件 | 方法 token | 核对内容 |
| --- | --- | --- |
| ScriptEngine.dll | `06000339`、`06000342–06000348` | 任务属性和集合完整声明 |
| ScriptDriverProjects.plugin.dll | `060001CF`、`06000241`、`06000242` | 名称／备注元组和两种通用树移动 |
| TaskObject.plugin.dll | `06000085`、`06000089`、`0600008B` | 结构变更分支、调用比较及列表同步 |
| TaskEditor.plugin.dll | `0600026F`、`06000270` | 私有按钮处理器中的移除、插入及提交 |

附带 ScriptEngine 帮助中的通用移动两页注明文档程序集版本为 3.5.9.0，方法归属于工程树对象。本轮以安装件中的实际签名和实现为依据。检查范围还包括本机 ScriptDriver 插件的有关类型、直接接口引用及 OEM 任务配置契约，结论限于该版本和已检查的公开接口。[CODESYS 任务集合文档](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptTaskConfigObject.html) · [CODESYS 工程树对象文档](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptObject.html)

## 执行范围和恢复条件

预定的配置变化是从 `PLC_PRG → PRG_OrderA → PRG_OrderB → PRG_OrderC` 调整为 `PLC_PRG → PRG_OrderC → PRG_OrderA → PRG_OrderB`。这两行是验收规格。本轮没有实测的调用列表、备注移动或程序绑定读回；重排派发和保存次数均为 0。基线编译、保存版编译、工程关闭、第二个 IDE 进程重开及运行调度均未执行，错误数与警告数不适用。

探测归档分别记录了八项安装件元数据静态核对和五项离线反例。五项反例仅变更元数据记录，验证证据变化会触发重新复查；两组结果都没有工程写入或持久化实测。

探测时复查了安装件证据及历史现场指纹。四项 MCP 历史 unknown 与隔离账本保留，原独立移除操作仍为 unknown。此次未取得工程租约，没有相应的释放事件。原移除探测和已交付单条替换各保留原有结论。[移除缺陷](task-call-remove-diagnosis.md) · [单条替换能力](task-call-replace.md)

恢复开发需要本机可核验的公开行级移动接口或厂商确认的等价操作，明确源行身份、目标位置、备注保留、提交和异常行为；再在独立夹具上验证同句柄读回、独立进程保存重开及保存版编译。届时应核对全部名称／备注对、绑定、源码和任务配置，离线验证写前拒绝及部分写入保护。

[安装件元数据采集脚本](../scripts/probes/task-call-reorder-metadata.py) · [归档证据核对脚本](../scripts/probes/task-call-reorder-check.py)
