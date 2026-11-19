# S8a 原生单条任务调用移除诊断

**本机 InoProShop 1.9.1.6 的整数重载跨两个集合使用了同一个元素引用。** 它先从只读任务的列表取出目标，再要求可写任务的列表移除该对象。可写列表逐项克隆，元素按对象身份比较。这解释了为什么索引 1 上的名称、注释和 PROGRAM 都已核实，集合仍会报找不到该项。没有找到满足本次限定条件的公开脚本入口，本轮停在只读诊断。

适用范围为本机安装件和原独立 AM610 夹具。产品基线为 `9d89652e2646d78f0879e2670edc1bbf44c4456f`，0.32.0，35 项工具。上轮记录见[原生探测与原始验收边界](task-call-remove-probe.md)。

## 从选择到异常

| 步骤 | 本机安装件可复核的行为 | 对原故障的意义 |
| --- | --- | --- |
| 选择 | `ScriptPouObjectList.remove(int)` 在调用可写回调之前，通过 `GetReadable().POUs[index]` 取得原生调用元素并捕获为 `pouObj` | 传入参数是零基索引，闭包中保存的是列表元素。用于展示的名称/注释元组及根级 PROGRAM 对象均与这个元素不同 |
| 取得可写对象 | `GetModifyable` 按工程句柄及任务 GUID 调用对象管理器的 `GetObjectToModify`。本机检查的两套对象管理器均有复制路径。任务字段的深复制与 `PouObjectList.Clone` 会创建新列表并克隆其中的每个元素 | 副本中保存相同数据的行拥有新的对象身份 |
| 实际比较 | 回调取可写任务的 `POUs`，直接执行 `Remove(捕获的 pouObj)`。具体列表转发到 `IList.Remove(Object)`。框架先用 `IndexOf` 查找元素，未找到时抛 `ArgumentException`。该调用元素及其基类没有重写按名称、ID 或注释比较的实例 `Equals(Object)` | 可写列表里的克隆元素无法与读侧原引用相等；这条路径没有在可写列表按索引重新取项 |
| 异常传播 | 整数重载没有捕获区。可写包装器先 Invoke，正常返回才 Commit，finally 做 Dispose | 原记录里出现了 `IList.Remove` 和 `PerformWithWriteableCopy` 的真实异常栈；缺少异常后的内存列表读回和正常退出证据 |
| 名称重载 | `GetByName` 返回读侧首个字符串相等的名称。其回调与整数重载调用同一 `IPouObjectList.Remove`。捕获区覆盖查找及修改，处理器捕获 `System.Object` 后丢弃异常并返回 | 同名时不能指定第几行；即使名称唯一，正常返回也可能隐藏移除失败。本轮没有调用该重载 |

这是用安装件控制流解释上轮异常。原进程没有留下两份列表/元素引用的运行时比较，也没有留下异常后的调用顺序。原操作终态保持 `unknown`。

## 其他入口的边界

本机 `ScriptEngine.dll` 的 `IScriptPouObjectCollection` 声明了两种 remove，以及 add、insert、replace、索引读取和长度读取。脚本契约没有暴露在可写副本中取项再删除的公共方法。厂商文档也把集合的移除参数限定为索引或名称。[CODESYS 调用集合说明](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptTaskConfigObject.html)

编辑器的私有按钮处理器 `OnRemovePOUCallButtonClicked` 给出了实现上的对照。它先取得可修改的任务，在该任务的列表按索引取出元素，再从同一任务的列表删除。这个处理器不属于公开脚本接口。通用树对象的 `ScriptObject.remove()` 调用 `IPSNode.Remove`，适用对象是树节点；本机任务同步器的 `EqualizeTaskCallList` 路径包含 Clear 后按子节点重新 Add。现有证据不足以将删除树节点作为保持原列表并精确移除一行的操作。

恢复开发须先取得修正后的受支持公开接口或厂商修复，再在独立夹具中验证只移除精确选中的目标行，三个 PROGRAM 定义和源码均保留，剩余调用的名称、注释及顺序保持。保存关闭后须用独立 IDE 重开核对，并取得对应保存文件的编译结果。不得通过私有接口、清空重建调用列表或删除 PROGRAM 绕过限制。

唯一一次真实移除抛出异常。0 错误、0 警告仅属于移除前已保存基线的编译，9/9 仅属于离线守卫用例。缺少异常后列表、正常关闭和退出码证据，进程已消失及租约 stale 均不足以确认回滚或内存状态。诊断与收尾均未再次派发移除。

## 原现场

原独立探测操作 `d304195f-2b67-466a-aca2-6cec9af4ded3` 只有一次派发。原生结果与旧 ZIP 的对应字节一致。核对的 49 份生命周期记录均与归档匹配，未发现迟到的终态文件。原 IDE 的创建身份为 PID 69636、UTC ticks `639306703678682474`；本轮没有观察到该实例，原退出码缺失。

原工程与检查点 SHA-256 均为 `4ea4215fc81097d4ed428ddc6388516f62cbd3d24780a803b3ed5bcd9313c7ba`。含原生占用标记在内的五份工程目录文件与上轮停止后的清单一致。原租约仍在，现有租约观察器将其判为 `stale / owner-pid-exited`。登记中的四项历史 `unknown` 和隔离账本指纹保持一致。本次独立探测的操作 ID 没有进入 MCP 操作登记。原工程继续封存。

## 复查方法

补充复核包的入口列出原派发与异常、现场指纹、脚本重载、对象复制、框架相等性及编辑器路径。方法 token 仅在各自文件指纹和 MVID 下有效。复核时可沿以下位置对应回安装件。

| 程序集 | 方法 token | 检查内容 |
| --- | --- | --- |
| ScriptDriverProjects.plugin.dll | `060001CD`、`060001D2`、`060001D3`、`0600042C`、`0600042E` | 读侧集合、两个重载及闭包中被传给 Remove 的字段 |
| ScriptDriverProjects.plugin.dll | `06000090–06000092`、`060001CE`、`06000426` | 获取读写任务、回调接收的列表及 Commit/Dispose 次序 |
| TaskObject.plugin.dll | `060000E8`、`060000E9` | 按对象移除和逐元素克隆 |
| TaskEditor.plugin.dll | `0600026D` | 编辑器内部从可写任务取项的实现 |
| ScriptDriverProjects.plugin.dll / TaskObject.plugin.dll | `06000240` / `06000085`、`0600008B` | 树节点删除与任务同步器重建调用列表的路径 |
