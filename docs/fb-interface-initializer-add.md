# FB 输入／输出缺失显式初值补写

0.38.0 候选版／38 项工具，功能分支 `codex/fb-interface-initializer-add`，基于 main `be6850bf875a00d2a6321aef6adfc0090d59839a`。未合并、未部署；S4b 尚未全部完成。

## 限定用法

> 在指定工程的 FB_InitProbe 中，给 VAR_INPUT 的 DelayTime 补写 T#3s 初值。先确认原声明没有显式初值；保留其他源码、调用实参和子对象，编译并保存重开核对。

Agent 读取对象、Application、源码版本及原生 ST 身份，调用 variable_edit 的 add-initializer，显式传 section=VAR_INPUT 或 VAR_OUTPUT。用户不需填写内部标识。原声明须为普通用户 FUNCTION_BLOCK 中已有、唯一、完整、无修饰的目标区，目标是唯一 BOOL、DINT、TIME 单变量。只在可信分号前插入 ` := 字面量`，保留原文及 CRLF、注释、空白和其他源码。

已有初值（即使与请求相同）、重复区、修饰区、歧义、联合声明、AT、RETAIN/PERSISTENT、别名、数组、聚合、VAR_IN_OUT、Method/Property 内变量、非原生 FB/ST 或不完整解析均拒绝。省略 section 仍是原 VAR／根 GVL 范围；旧 add、set-initializer、set-type 和成员动作不扩展。其他37项工具及全部输出 Schema 不变；新参数组合只扩展 variable_edit 的 refinement。

输入初值是实例初始化，不改变显式调用实参或 PLC 当前值。此次不提供运行写值、类型/方向修改。

## 保护与证据

复用0.25接口区唯一性守卫和0.36完整声明插入规则。队列重读后，在实际写入句柄再次核对磁盘、源码、Application/FB/ST 身份。仅新 section+add-initializer 路径读取完整受支持 Method/Property/Get/Set 子树的原生身份、父关系、原文哈希及元数据，写后及保存重开严格核对。未知子对象、父关系异常、重复身份或读取缺口不会视为空子树。子对象身份目录不表示执行顺序，调用原文不排序。

检查点、去重、原始异常、unknown冻结及可信进程退出沿用现有机制。直接与旧副本路径均不反向写回或恢复性保存。拒绝和部分写入测试分别取证。历史隔离/unknown、默认环境200ms性能、崩溃根因、CmpLog、脚本信任、Desktop及PLC运行限制保留。

## 验证归属

实现、离线测试、真实 MCP 与唯一一次 CLI 的实际结果在执行后补充；此处不预填工程通过。日常入口保持0.37.0，Codex入口不改。
