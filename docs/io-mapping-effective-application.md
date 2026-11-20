# 当前有效 I/O Application：入口核查

本次结论为 **③：在已核查的本机入口中，尚未确认脚本可可信调用的完整目标通道选择链**。没有打开工程。这里的“未确认”不表示运行时已经证明该 CLR 成员不可访问，也不推广到所有 InoProShop 版本。

基线为探测提交 294b7adf01ae64df49e5116b6e933dc0795ad055，main 仍为 4070d1a88bf035e89fc91ab2aabfbca2930f1660。产品保持 0.34.0 候选版、37 项工具；产品、Schema、初始化指令和日常入口均未改变。本次只回答有效 Application 的读取入口，不改变[写入前置核查](io-mapping-write-precheck.md)的整体只读评估结论。

## 本次新增的接口证据

| 层 | 实际接口与结果 | 已确认范围 |
| --- | --- | --- |
| 文档化脚本接口 | IScriptDeviceObject5.driver_info → IScriptDriverInfo.io_application，返回 System.Guid | 属性确实存在；不是返回 Application 对象。脚本接口 token 0x060001b7。 |
| 脚本实现 | ScriptDriverInfo.get_io_application，0x0600018a | 先 GetReadable<IDriverInfo2>；CanSetIoApplication 为 true 才读 IoApplication，false 直接返回 Guid.Empty。没有父 provider 委托。 |
| OEM DriverInfo | get_IoApplication，0x06000aaf | 对设备 owner 检查 ConfigModeApplication；非空且非 ParamModeGuid 时优先返回，否则读保存字段。因此它也不能简单称为纯持久化字段。 |
| 原生完整选择 | IIoProvider.GetApplication → ConnectorBase.GetApplication，0x060002fd | 使用 GetIoProviderParent，再委托父 provider。没有父对象时返回 null。 |
| 原生 Application 选择 | DeviceObject.GetApplication，0x0600081e；GetApplicationObject，0x06000860 | 查实际 PlcLogic/Application 对象，并包含配置模式优先选择；无有效对象可返回 null。返回 IMetaObject。 |
| 候选脚本到原生桥梁 | ScriptDeviceConnector.ParameterSet → ParameterSet.IoProvider → GetApplication | get_ParameterSet 方法为 public（0x060000a0），但其声明类 ScriptDeviceConnector 非公开，公开 IScriptConnector / IScriptDeviceConnector 接口没有该成员。脚本层可调用性及支持性未成立。 |

本机 ScriptEngine.chm 对 io_application 的说明是负责 I/O handling 的应用对象 GUID。帮助的参考版本为 3.5.9.0；安装 ScriptDriverDeviceObject 为 3.5.11.0，OEM 为 1.9.1.6，版本分别留证。文档没有解释完整的父级 fallback 和多应用选择，不能仅凭属性说明越过实现中的 CanSetIoApplication 分支。

Connector 的 get_device_object() 返回设备只读副本；脚本 parent 表示连接器集合，不是 IIoProvider 的父级。当前公开脚本面的读取不能通过“取 parent 再找同名 Application”代替原生选择。

## 完整原生链已查到什么

ParameterSet.get_IoProvider（0x06000fa4）直接返回其 provider 字段。ScriptDeviceConnector.get_ParameterSet 经内部 get_Connector，按当前对象的 handle/GUID 取得 GetObjectToRead，再按连接器 ID 取得 HostParameterSet。已查 getter 链没有调用可写副本、SetObject、保存或编译。

Connector.GetIoProviderParent（0x06000290）按原生连接器角色、HostPath、所属对象及适配器关联取得父 provider；并非仅按显示树向上找根设备。完整 GetApplication 再处理父级委托、PlcLogic 与应用选择。这些已安装实现说明为何根设备、子设备或连接器的零 GUID 都不能独立证明没有有效应用。

GetApplicationObject 的配置模式分支检查内存表及相应对象。之后按实际 Application 对象遍历：未显式选择时可能取首个有效对象，已选择时按 GUID（或空 GUID 的 fallback）判断。接口选中一个对象，不等于应用名称在所有表达式来源中唯一。未来检查必须将原生返回 GUID 与同句柄实际清单逐项对应；不能自己挑一个应用补成结果。

当前 ConfigModeApplication 值没有读取，不填写“未启用”。它属于已查原生选择链，不是旧原生导出中的持久化 IoApp。配置模式帮助涉及 PLC 连接与隐藏 Application，本轮没有进入、退出或改变该模式。

## 阻断位置和停点

1. 文档化 GUID getter 可读，但它没有目标连接器的完整父级选择语义。即使未来观察到非空 GUID，也须说明调用对象和覆盖范围。
2. 完整选择方法存在于公开原生接口，但从实际脚本连接器取得对应原生 provider 的可信公开入口还未确认。
3. 候选 ParameterSet 入口位于非公开具体类。不能将方法的 public 标志当成公开脚本契约，也不能从未调用推出“实际必定报 AttributeError”。本轮未使用 NonPublic 反射、私有服务定位器、插件注入或进入配置模式取得对象。
4. 已检查 ScriptEngine 公开设备、连接器、DriverInfo、对象及 System 接口，以及安装的 10 个 ScriptDriver 插件中与 Application、原生对象及 provider 相关的入口。搜索边界与完整匹配清单保存在包内 script-route-search.json；名称搜索的无匹配不证明所有其它入口不存在。

因此，实际只读采集的入口条件尚未满足，没有消耗一次工程打开。只做文件系统及现有隔离／租约只读检查：指定控制工程仍为原路径、文件身份和预期哈希，未隔离，未见活动工程服务或未处置的 MCP unknown。旧 stale 租约保持原样；没有取得、回收或释放租约。

本轮打开、setter、保存、编译、模型任务均为 0。没有新的 IDE 进程、工程关闭或退出码记录；不得把缺少这些记录写成“本次正常关闭”。三处独立 unknown、四项历史 MCP unknown、隔离和原失败现场均未改写。主附文件及配置的保全清单分别留证。

## 离线证据合同

[判定脚本](../scripts/probes/effective_application_evidence.py)不调用 native API，只验证将来证据对象的结构。[27 项用例](../scripts/probes/test_effective_application_evidence.py)全为合成数据，不能代替实际 ScriptEngine 调用。

可信入口的语义须先独立确认，不能把输入 JSON 中的 publicEntryConfirmed=true 当作现场证明。该脚本只给出当前选择证据是否足够，始终 writeAuthorized=false。

| 情形 | 处理 |
| --- | --- |
| 当前句柄的有效返回，唯一对应实际 Application GUID、所属工程及设备 | 认可该打开阶段的选择证据；不保证后续句柄或写入阶段 |
| 返回 GUID 与持久化 IoApp 不同，但完整 API 及身份都可信 | 保留差异，不强制改回保存字段，也不擅自断言配置模式已启用 |
| 当前清单含多个 Application，原生准确返回其中一个 | 按原生 GUID 对应；表达式名称唯一性仍属后续独立检查 |
| 返回对象不在清单、属于其它工程／设备，名称或父对象不符 | 拒绝身份不一致 |
| 返回 null、字段缺失、读取异常 | 分别记录，均不给有效选择结论；不补默认应用 |
| 旧操作、PID 复用、旧句柄／打开序号、旧文件版本或阶段变化 | 拒绝旧证据 |
| 只提供持久化字段、无父级／配置模式逻辑、脚本入口未确认 | 保留缺口，不给有效选择结论 |

本次 27/27 仅为这份证据规则的离线检查。此前写入前置评估的 30/30 和历史真实映射正例仍归属各自提交，没有重跑工程或产品全量回归。

## 收尾引用

2026-11-20 文档收尾仅复用本次 27/27 及接口归档，没有进行运行时调用。[收尾说明](io-mapping-write-probe-closeout.md)列出与前置判定 30/30 分开的提交归属，以及恢复开发的全部条件。

## 最小下一步

需取得或由厂商确认一个在当前 ScriptEngine 对象上可调用的只读入口，能把**目标连接器当前原生 provider**交给完整 GetApplication；或者明确验证现有具体 CLR 桥梁的受支持访问方式。只确认根 driver_info 的 GUID 不足以替代这一条件。

入口成立后，仍只安排本用户指定控制工程的一轮独立读取，采集实际项目句柄、进程创建身份、有效返回、同句柄应用清单及阶段；零值、异常或归属不符时停止。未来写前必须重新读取，不能复用旧句柄结果。

即便后续得到①，也只消除有效应用选择这一个缺口。应用级重复映射覆盖、输入变量的程序写引用仍是独立待办，S7a 限定静态结果不能当作全工程证明。映射写工具、在线功能与 EtherCAT PDO 编辑均未交付。

本轮证据目录：D:\InoPro-S8b-EffectiveApp-20261120。复核包保留本机帮助原文与哈希、当前安装件身份、方法 token/CIL、旧导出关联索引、判定测试和未执行原因；不回填旧操作。
