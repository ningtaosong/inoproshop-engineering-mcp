# S8b 补充探测 · 一个非空 BOOL 映射

在本机 InoProShop 1.9.1.6 中，公开 setter 派发了一次。同一句柄内，getter 和随即从该工程导出的完整映射列表都读到了 `GVL_IOProbe.Input0`。写后守卫也检出了目标通道的另一项变化，探测随即以 `unknown` 停止。没有持久化的非空工程版本。产品仍为 0.33.0 候选版、36 项工具。

| 阶段 | 工程证据 |
|---|---|
| 准备独立夹具 | 从[首轮已核实的中性种子](io-mapping-inspect-probe.md)建立新文件。在 Application 根创建 GVL，加入 `Input0 : BOOL := FALSE;`，未声明 AT。基线保存、正常关闭，保存的基线实际编译一次，0 错误、0 警告。原 PLC_PRG 及 MainTask 调用保留。 |
| 首次写前复核 | 跨打开比较遇到两个设备枚举顺序互换，在派发前拒绝，setter 和保存均为 0。按设备 GUID 和连接器身份核对，所有记录及原生导出哈希相同。原进程正常退出，租约按原机制释放。 |
| 同一夹具正式设置 | 核验上述原始记录及文件身份后，在新的句柄中两次核对全通道和直接导出。确认目标 BOOL 声明唯一、26 个完整列表均为空。写前建立磁盘检查点，仅设置一次。 |
| 写后即时核对 | 目标首项表达式和同句柄导出一致。其余 25 项完整列表仍为空，包括父参数和相邻成员。已读源码、GVL 声明和任务配置相同。 |
| 停止条件 | 首次异常位于 `after-setter`。逐字段复核定位到目标的 `default_variable` 从原生 null 变为长度为 0 的字符串。在已允许变化之外，仅这一个字段有差异。正向读数保留；写后保全核对未通过。映射后的编译、保存、独立重开及保存版编译均未执行。 |

此处保留首次现场结论。后续独立验收核实了构造器的空串初值，并在新夹具取得真实编译诊断。[默认字段、守卫及新夹具结果](io-mapping-default-variable.md)

## 读到了什么

- 通道所属设备为 `Device/HIGH_SPEED_IO`，描述身份 `40600 / 10F4 0600 / 00.00.00.20`，根为 AM610 `4102 / 10f4 0002 / 3.5.11.11`。实际通道键为设备实例 `bf0d0fd8-de24-465d-a555-4bb14a9a8f37`、连接器 2、参数 13、成员路径 `Bit0`。原生参数名 InputData，方向原值 Input，成员类型 BOOL、位宽 1。
- 写后首项 `Id=-1`、`variable=GVL_IOProbe.Input0`、`maps_to_existing_variable=true`、`mapping_creates_variable=false`。原生导出逐通道去掉类型模板重复，目标的完整列表由 0 条变为 1 条，新记录含 `Id=-1`、`CreateVariable=False` 和空串 `DefaultVariable`。负 ID 单独不足以判断未映射。
- GVL 对象 `790208b7-b166-4010-9c37-225793e690dc` 及其 BOOL 声明由独立源码读回取得。setter 的公开参数是表达式；本机已查 getter 没有返回指向变量声明的对象标识。公开 getter 的读取范围仍为首项，完整计数来自此次三个设备的同状态原生导出。
- 自动地址模式下 `manual_iec_address` 原值为 `%IX0.0`。最终分配地址、Input/Output 的参照方、现场接线、信号和变量运行值均未验证。

## 文件与运行现场

夹具为 `D:\InoPro-S8b-Positive-20261119-211656\engineering\AM610_IO_Positive.project`。磁盘最终 SHA-256 和写前检查点均为 `a5431f07389894f0eccfbf5a28a296febef922063cd12316683a700d7a5716c3`，对应未设置映射的准备版本。相较正式派发前，两份 .opt 内容及时间相同，.projectbackup 内容相同、时间变化，另留有 .project.~u。工程主文件未变不能推断内存写入没有发生。

独立原生探测操作 `2f82583a-993f-4044-9e23-237585ae46c2` 保留 unknown。监测期限内没有正常关闭或退出码；随后按原进程身份复查已退出。原目录的服务及夹具租约仍在，正式观察结果均为 stale，未取得正常释放记录。MCP 登记仍有四项历史 unknown 和四项隔离。未启动其他工程服务，未改日常入口。

## 可开发范围与下一项证据

目前只支持得出部分读取结论。已有同句柄非空首项和导出对照，仍需从可信的、已保存的非空工程在独立 IDE 中取证，关联同版导出与磁盘哈希。若安排新的设置验收，应先明确本机默认变量字段的空值和空串语义、核准相应的写后保全条件，并另行按既有机制处理占用。当前证据不足以确认保存后的正例、全映射枚举或原生声明绑定，也未交付 MCP 映射查询、写入或 EtherCAT PDO 编辑。

[夹具原生脚本](../scripts/probes/io-mapping-positive-native.py) · [启动与排他记录](../scripts/probes/io-mapping-positive-launch.mjs) · [读取和写后核对](../scripts/probes/io_mapping_positive_guard.py) · [导出对照](../scripts/probes/io_mapping_export_guard.py) · [首轮只读证据](io-mapping-inspect-probe.md)。补充包入口列有原始阶段、首败、逐字段差异、两次采集方式、离线反例和租约观察。
