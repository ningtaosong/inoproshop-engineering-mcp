# S8b · Application 限定名和保存前的设备树核对

在 InoProShop 1.9.1.6 的新 AM610 夹具中，编译器接受了 `Application.GVL_IOProbe.Input0`。公开 setter 仅派发一次。编译前后的 I/O 映射读数一致，保存前设备树增加了一个可见设备和两个连接器，探测按原守卫停止。保存后的非空映射、独立重开及保存版编译仍待验。

## 表达式如何确定

随安装的英文帮助 `codesys.chm` 在设备 I/O Mapping 页（`_cds_edt_device_io_mapping.htm`）给出已有变量格式「应用名.模块名.变量名」。GVL 命名空间页（`_cds_operator_namespace_gvl.htm`）以「GVL 名.变量名」引用成员。对于本次三个普通标识符，拼接的是 Application 对象名与该应用中的变量路径，设备、Plc Logic 和任务路径均不进入表达式。

本机 OEM `InoDeviceObject.plugin.dll` 中，`GetApplication`（0x060012fe）读取首个句点之前的部分，`GetPlainVariableName`（0x06001301）返回其余原文。`AddIoLanguageModel`（0x06000832）以实际 Application 对象的 GUID 和名称建立应用表，`AddVariableMappings`（0x06000344）核对应用并处理剩余表达式。setter 能写入带点的字符串。编译器有独立的名称解析步骤；上轮短名 `GVL_IOProbe.Input0` 的诊断为 `Invalid application <GVL_IOProbe> in mapping <GVL_IOProbe.Input0>`。当时桥接调用完成，`buildPassed=false`，实际 1 错误、0 警告。[原失败及其归属](io-mapping-default-variable.md)

本次先在打开的工程中定位唯一原生 Application，再核对导出中根设备本身的 `Object/DriverInfo/IoAppSet=True` 与 `IoApp` GUID；候选子设备及其连接器 2 均未设置单独的应用。实际 Application 位于 `Device/Plc Logic/Application`，GUID 为 `e88ddc35-95de-4cd2-886e-100ccb300ecf`。其根级 GVL 对象 `0e1be047-0c43-4efb-8b7e-9f57e2645410` 的原文声明为 `Input0 : BOOL := FALSE;`，无 AT 地址。用该工程自己的读数生成并复核授权表达式，不接受缺失前缀、错误 Application、GVL 归属不唯一或类型不符。继续严格区分默认变量字段的原生 null 和空字符串。[守卫及字段校验](../scripts/probes/io_mapping_positive_guard.py) · [导出解析](../scripts/probes/io_mapping_export_guard.py)

## 一次真实验收

独立工程为 `D:\InoPro-S8b-Positive-20261120-000457\engineering\AM610_IO_Positive.project`，操作标识为 `96e00833-2300-458c-b860-1521841a4631`。设备描述为 `4102 / 10f4 0002 / 3.5.11.11`。沿用中性种子、原登记目录和正式租约机制。两个既有 unknown 夹具保持封存。

| 项目 | 结果 |
|---|---|
| 准备版 | 保存新 GVL 后编译一次，0 错误、0 警告，正常关闭，准备进程退出码 0。 |
| 写入及即时核对 | 对 HIGH_SPEED_IO 设备实例 `bf0d0fd8-de24-465d-a555-4bb14a9a8f37`、连接器 2、参数 13 InputData、成员 Bit0 设置一次。getter 首项为 `Application.GVL_IOProbe.Input0`。同状态原生导出只有该通道的完整列表含 1 条，CreateVariable 为 false；目标 DefaultVariable 为空串。其余 25 项列表为空。 |
| 编译器验收 | 未保存的映射状态真实编译一次，`buildPassed=true`，诊断完整，0 错误、0 警告。该状态编译输入导出 SHA-256 为 `f07412235b376389ecd1eaf0fa4320932eb26e8fe4e131843a835c1ad579c0b0`。 |
| 保存前 | 同一句柄的设备数由 3 变为 4，连接器数由 6 变为 8。新增可见设备 `Device/HwConfiguratioinDevice`（描述 `40005 / 10F4 0005 / 00.00.00.10`），其连接器为 1 / Common.PCI 和 2 / Inovance:System。原设备和连接器按身份逐项一致，原顺序保留。26 项通道 getter、对应的 26 份映射列表、声明、已读源码和任务配置在编译前后逐项一致。 |
| 保存和重开 | 保全核对未通过，映射阶段终态 unknown，保存 0 次。未执行保存后独立重开或保存版编译。磁盘主文件仍是已保存准备版，SHA-256 与写前检查点均为 `ce7b4bb1848071e7e17ed89909806491231cb38bdd0f129a6a4a3df2c2d2b8d9`。 |

上述设备在本次编译后可见。已有[独立的阶段可见性探测](device-add-visibility.md)也报告过这个路径；该记录没有测量本夹具编译后持久化的设备树。没有按名称排除该设备或它的连接器。若继续验收，宜先取得同一夹具未映射时在编译前、编译后的可比设备和连接器证据，明确哪些原生读数足以区分临时可见与配置变化，再决定是否允许保存。

## 进程、租约与文件保全

保存前守卫停止后，监测期限内未取得工程正常关闭或映射进程的退出码；随后核对该进程已退出。服务及本次夹具租约均为 stale，未取得正常释放回执。两份旧夹具的文件、原生记录、检查点和占用标记与各自归档一致，旧服务租约按正式机制归档，旧工程锁保留。MCP 登记中的四项历史 unknown 和隔离记录仍在。

相对本次映射派发前，主文件与两份 .opt 的字节和修改时间均未变，.projectbackup 的内容更新为准备版本，另有 .project.~u 占用标记。未启动 DSH 或其他工程服务。

## 查询证据的边界

非空表达式和原生标志来自首项 getter。完整条数来自逐设备、连接器、参数及成员关联的原生导出。GVL GUID 来自源码对象定位，未取得映射记录直接指向变量声明的原生对象 ID。本次未验证特殊转义名、嵌套应用、现场信号、Input/Output 参照方、最终自动地址、接线或 PLC 运行。未开发产品工具，版本仍为 0.33.0 候选版、36 项工具。
