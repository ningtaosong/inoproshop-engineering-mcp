# S8b · 已保存的非空 I/O 映射

在 InoProShop 1.9.1.6 的独立 AM610 夹具中，公开 setter 派发一次后，目标映射成功保存。另一个 IDE 在同一磁盘版本上读回了首项表达式 Application.GVL_IOProbe.Input0。同状态原生导出中目标列表恰有一条，其余 25 项为空。首次读回停在设备位置核对。后续独立操作重开了同一保存文件并完成一次编译，0 错误、0 警告。两次操作各自保留原始结果。

## 未映射控制补证

[原操作](io-mapping-compiled-control.md)保留原始停止记录。归档 B、C 的设备 GUID、父对象、描述 40005 / 10F4 0005 / 00.00.00.10、原生类型和两个连接器均一致。重开后，HwConfiguratioinDevice 在父节点下从索引 8 移至 6，只跨过 Resources List 和 HardWare Configuration。新守卫仅在指定的保存重开阶段推导这一移动后的完整预期树，仍比较每个节点的身份、内容、顺序及连接器归属。编译时新增设备仍须位于追加位置，同句柄前后保全继续按原位置校验。[阶段守卫](../scripts/probes/io_mapping_phase_guard.py) · [归档正例及反例](../scripts/probes/test_io_mapping_saved_placement.py)

新补证操作为 158f1ed6-eb22-46f1-a634-f897eb713966。它用归档哈希、原始执行脚本指纹、旧操作 3613a01f-48bb-420b-bdba-297bea5f1f20 和文件身份绑定上轮结果。独立进程重开控制文件，与原 C 核对后编译一次，0 错误、0 警告。编译前后该设备的 GUID 均为 04d1db87-e030-46c5-9073-df66a1b4f522，位于索引 6，26 项映射均为空。工程正常关闭，退出码 0，setter 及保存均为 0 次。磁盘哈希始终为 0b569b51e267993c3bcb686b464ef882354795b4c05befbd3df93d976f62403c。新观测独立记账，旧阶段没有补填。[历史证据校验](../scripts/probes/io_mapping_control_history.py)

## 新映射夹具

独立操作为 e81c282d-d409-4c1d-b2f7-a311d92cbec0，工程位于 D:\InoPro-S8b-Positive-20261120-094036\engineering\AM610_IO_Positive.project。根据该工程的 Application 对象、GVL 归属和已有普通 BOOL 声明生成限定表达式。目标完整键为 HIGH_SPEED_IO 的设备实例 bf0d0fd8-de24-465d-a555-4bb14a9a8f37、连接器 2、参数 13 / InputData、成员 Bit0。设置前同句柄已编译，确认 26 项完整空列表后建立检查点。

| 阶段 | 原生读回 / 编译 |
|---|---|
| 写前基线 | 0 错误、0 警告。准备版和写前检查点 SHA-256 为 86ff404a3c53627957504bf7f8c9680a1f5b494c2d1061d589699400539171b0。 |
| 设置及写后编译 | 一次 setter。getter 首项与完整导出列表的唯一条目相符。CreateVariable 为 false，仅目标的 DefaultVariable 由 null 成为空串，原 GVL、已读源码、任务配置及其余通道通过检查。内存版编译 0 错误、0 警告。随后保存一次并正常关闭，退出码 0。 |
| 独立进程打开保存文件 | 再次读到相同的首项和导出条目，DefaultVariable 仍为确切空串。保存前及独立重开的 XML 导出 SHA-256 均为 8f06e6358248b5a1694fa1167ae4f35711e35f3f89e7b119a746bdcf4495a5c8。 |
| 重开守卫与保存版编译 | 同一设备 4d305b14-a78d-4664-8bb5-5fe9f4c6d0ab 从 8 移至 5。HIGH_SPEED_IO、MODBUS_TCP、ConfigStorage 分别从 5、6、7 移至 6、7、8。守卫拒绝这项额外变化，原文为 “Saved position would cross different siblings”。保存版未复编。该进程正常关闭，退出码 0，读回操作状态为 failed。 |

保存前与独立重开后的 26 项 getter、26 项导出、已读源码、任务配置一致。设备与连接器的枚举顺序发生变化，按原生身份逐项复核，其字段一致。完整快照和原始次序均在复核包中。本次只读回未改写主文件，保存及重开关闭后的 SHA-256 均为 cf1cf53f17397fc46641572ef6f068ea0a7754e708f06aecc009e4feef02b371。管理员 .opt 和 .projectbackup 有内容变化，AllUsers.opt 的修改时间有变化。复核包的两个操作分别记录进程身份、工程关闭、退出及租约释放。[离线对照脚本](../scripts/probes/io-mapping-stage-review.py)

## 非空保存版的独立补证

操作 `3e3d10be-ce9b-41db-9ae5-690920d63c06` 在新 IDE 进程 51964 中打开原保存文件。写入和成功保存归属前一操作 `e81c282d-d409-4c1d-b2f7-a311d92cbec0`。启动前校验了旧归档、三个历史进程的退出记录、文件身份及磁盘 SHA-256。两组实际保存重开快照均用原始顺序复查，空映射夹具的派生设备从 8 到 6，非空夹具从 8 到 5。

守卫逐层检查连续的兄弟索引。仅对这个已识别的设备，按实读位置推导跨重开后的整棵预期树，再逐项对照。设备 GUID、父 GUID、原生类型、描述、两端口及其归属均参与检查。设备视图按唯一 GUID 对齐，连接器按所属设备 GUID 和原生连接器 ID 对齐。其他兄弟的相对次序、全部子树、源码、任务调用及逐通道映射仍须符合原有校验。同句柄编译前后保留原顺序。[阶段比较与覆盖检查](../scripts/probes/io_mapping_phase_guard.py)

本次编译前后，getter 的首项均为 `Application.GVL_IOProbe.Input0`。两个阶段的 XML 导出 SHA-256 均为 `8f06e6358248b5a1694fa1167ae4f35711e35f3f89e7b119a746bdcf4495a5c8`。按设备、连接器、参数及成员键核对，目标列表恰有一条，`CreateVariable=false`，`DefaultVariable=""`，其余 25 项列表为空。保存版编译的诊断收集完整，结果为 0 错误、0 警告。派生设备编译前后均位于索引 5，已读任务、源码及通道保全检查通过。

此次 setter 和保存均为 0 次。工程正常关闭，IDE 退出码为 0，服务及夹具租约已释放。主文件 SHA-256 从打开前至退出后均为 `cf1cf53f17397fc46641572ef6f068ea0a7754e708f06aecc009e4feef02b371`。管理员 .opt 内容改变，AllUsers.opt 和 .projectbackup 仅修改时间改变。

本轮得到一个可以按文件版本独立复查的已保存非空映射样例。getter 只读首项，完整列表计数来自同状态导出。尚未取得变量声明的原生绑定 ID、最终自动地址、方向参照方及 PLC 运行证据。产品维持 0.33.0 候选版、36 项工具。三个旧独立 unknown 现场、四项 MCP 历史 unknown 及其隔离记录保留。
