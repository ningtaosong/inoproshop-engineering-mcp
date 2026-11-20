# S8c 首轮：EtherCAT PDO 只读可行性

2026-11-20，基于 main 32612d9950cb8d7611dcff83012e9b70482a589b。结论为 **③：缺少已确认的正常工程实例，且工程当前 PDO 的可信脚本读取路径尚未核实，停止依赖这些条件的采集**。已读到一个精确安装描述的 PDO 定义，未读到工程当前启用的 PDO 配置，不具备开发工程 PDO 只读工具的证据。

产品仍为 0.34.0 候选版、37 项工具。只新增独立探测脚本与记录，不注册 MCP 工具，不更改产品、Schema、初始化指令、固定构建或 DSH／Codex 配置。S8b 写入前置阻断、S6b 挂接证据缺口及历史 unknown 继续保留，见[前置收尾](io-mapping-write-probe-closeout.md)与[设备添加探测](device-add-probe.md)。

## 三项条件

| 条件 | 本次实际证据 | 结论 |
| --- | --- | --- |
| 已安装、身份明确的 EtherCAT 描述 | 本机 Repository/Devices 中解析到 9 个 type 64 主站和 68 个 type 65 从站包装 XML。9 个主站精确身份与 S6b 历史 installedMatches 对应；从站由当前仓库 XML 内容及明确引用的 ESI 确认。 | 成立于已检查安装文件；没有重跑原生目录。729 只是旧原生总数，不能冒充已保存的 729 行完整清单。 |
| 正常、非隔离、含目标设备的工程实例 | 复用 68 节点的旧样例结构、13 份 OEM 样例索引、四对象原生导出摘要，并检查 194 个旧 ZIP 中 977 份文档的候选线索。 | 尚未确认。名称无匹配及文件名都不能证明不存在或证明有可用实例；未打开这些工程。 |
| 从实例读取当前 PDO 的可信只读入口 | 本机帮助、16 个程序集的有界元数据及 9 条选定 CIL 路径；公开脚本设备参数/导出读取可作候选，但 PDO 当前选择的来源与解码关系未验证。 | 尚未成立；没有运行时调用，也不宣称所有版本均不支持。 |

正常实例搜索只覆盖已列明的样例与归档，未扫描全部用户工程，也未读取三个独立 unknown 或原移除失败工程的内容。后续需要一个已正常保存关闭、明确授权读取的工程，实际包含主站和身份可对应的从站，例如下面精确 IS620N 描述的实例；不能为此添加从站、猜测挂接或修改工程文件。

## 所选设备描述与三层证据

包装文件位于安装仓库：

D:\InProShop\CODESYS\Repository\Devices\65\100000_000C010800010001\Revision%3D16%2300010001\device.xml

包装中的 LocalFile 明确引用同目录 IS620N-Ecat_v2.6.9.xml；不是根据附近文件名猜测关联。

| 字段 | 实读原值 | 来源 |
| --- | --- | --- |
| 原生描述 type / ID / version | 65 / 100000_000C010800010001 / Revision=16#00010001 | 包装 DeviceIdentification |
| 描述型号 | IS620N_ECAT_v2.6.9 | 包装与 ESI Name |
| ESI Type | IS620N | ESI Device/Type |
| Vendor ID | #x00100000 | ESI Vendor/Id |
| 厂商 | Inovance / 汇川技术 | ESI 两个带 LcId 的 Name |
| ProductCode / RevisionNo | #x000C0108 / #x00010001 | ESI Type 属性；不是实际固件 |
| 描述连接器 | Child / 1 / Common.Ethercat | 包装连接器；不代表工程挂接 |
| 包装 SHA-256 | 169f43a0896b397120fe8e62010a685fe37c104b6238655b46e8aac393aad8d5 | 当前文件 |
| ESI SHA-256 | e848af691936c0ff4e5388dbc3ac7d8d905d825e221ee65758170d1849e9d2d5 | 当前文件 |

本次数据均属于①设备描述定义。②工程保存配置／当前句柄 PDO 没有取得，③在线设备状态没有读取。描述的默认 Sm、Enable、Fixed、Exclude 等字段不能当成当前工程的启用、分配或运行状态。

## 逐项定义读取

[定义采集器](../scripts/probes/ethercat_pdo_definition_probe.py)以显式路径、ESI 哈希、ProductCode 和 RevisionNo 唯一选定一个 Device；不打开项目，不根据名称选第一项。完整读取其直接 RxPdo/TxPdo 和 Entry，保留原序，不把条目对象索引当 PDO 索引。

| 原序（0 起） | 原标签 | PDO 索引 | 直接 Entry 数 | 原 Sm 属性 |
| --- | --- | --- | --- | --- |
| 0 | RxPdo | #x1600 | 3 | 缺失 |
| 1 | RxPdo | #x1701 | 4 | 2 |
| 2 | RxPdo | #x1702 | 7 | 缺失 |
| 3 | RxPdo | #x1703 | 7 | 缺失 |
| 4 | RxPdo | #x1704 | 9 | 缺失 |
| 5 | RxPdo | #x1705 | 8 | 缺失 |
| 6 | TxPdo | #x1A00 | 7 | 缺失 |
| 7 | TxPdo | #x1B01 | 9 | 3 |
| 8 | TxPdo | #x1B02 | 9 | 缺失 |
| 9 | TxPdo | #x1B03 | 10 | 缺失 |
| 10 | TxPdo | #x1B04 | 10 | 缺失 |

合计 11 个 PDO 定义、83 条直接 Entry；本范围未截断。逐条名称、原始类型、位宽、PDO 索引、Entry Index/SubIndex、序号及源 XML 路径保存在包内 definition-entries.csv 和 is620n-definition-read.json。例如 #x1600 的首条是对象 #x6040 / 子索引 0、Controlword、UINT、16 bit，二者索引分别保留。

四条 Sm 定义原文为 MBoxOut、MBoxIn、Outputs、Inputs，其地址和 Enable 等均为描述字段。仅 #x1701 和 #x1B01 有 Sm 属性；不把其余缺失值自动填为 2／3。没有得到工程的 assignment、实际主从归属、激活数量或在线状态。

读取覆盖只包括所选 Device 的直接 PDO 定义，不包含其它模块嵌套定义、对象字典全部条目或其他型号。空定义仅能表示该描述范围内没有条目，不能推出工程没有 PDO。

## 接口与方向的证据边界

[静态接口采集器](../scripts/probes/ethercat_pdo_metadata_probe.py)只解码文件中的 CLR 元数据/CIL，不加载或执行 OEM 代码。依赖已有独立元数据读取器和已安装的 dnfile/dncil，未安装新包。

| 已查入口 | 实际发现 | 不能据此声称 |
| --- | --- | --- |
| ScriptEngine.dll 与 10 个 ScriptDriver 插件 | 对 EtherCAT、PDO、SyncManager、ProcessData 名称作有界搜索，未找到专用脚本读取成员；ScriptEngine.chm 的 1618 HTML 主题亦无 PDO 专用说明。 | 不证明通用 host_parameters 或导出读取一定不可行，更不证明其它版本没有接口。 |
| EthercatModularDevice.dll 的 IPDO / IDictionaryObject | 公开原生字段包含 Index、SubIndex、Name、Type、BitSize、Entries、IOType。IModularDeviceProfile.get_PDOList 为 0x0600001c。 | 没有证明当前 ScriptEngine 对象可取得对应 profile，也不是 IS620N 当前配置实读。 |
| OEM EL6224Provider.CreateProfile（0x06000c6e） | 针对特定模块构造内存 PDO/SDO 列表，get_PDOList（0x06000c71）返回该字段。 | 不作为任意从站的当前选择枚举，不调用构造器或工厂来凑结果。 |
| OEM SyncManager.GetSyncManagersFromDevice（0x06000c3a） | 已查 CIL 从 IConnector.HostParameterSet 及成员 Value 读取字段，说明存在参数来源线索。 | 原生 IConnector 获取、参数身份和工程当前 assignment 关联仍未验证；普通参数列表不是 PDO 表。 |
| OEM EthercatProcessDataPage.get_PDOItems（0x060003e5） | 非公开成员，直接返回编辑器内部 _PDOItems。 | 不作为公开脚本入口；未创建编辑器、刷新页面或调用私有处理器。 |
| 在线 CoESdoRead、ReadRegister、Load PDO Info from Device | 需要在线上下文；帮助明确后者会替换配置列表。 | 不属于本轮离线只读采集，均未调用。 |

本机英文 Expert Process Data 帮助保留了有歧义的原文：TxPDO(Input) 配 master→slave 的说明，RxPDO(Output) 配 slave→master 的说明。未用常识静默纠正该页，未借用 HIGH_SPEED_IO 的方向结论。当前结果仅保留 ESI RxPdo/TxPdo、Sm 原标签及来源，实际方向参照方仍需在目标实例和可信接口中另证。

已安装帮助的版本标记为 ScriptEngine 3.5.9.0，与实际脚本插件 3.5.11.0、EtherCAT 编辑器 3.5.11.10 和 OEM 1.9.1.6 分开留证。公开 CLR 方法、GUI 页面和帮助文字均不等于脚本调用已验。

## 本轮验证与保全

[14 项离线用例](../scripts/probes/test_ethercat_pdo_definition_probe.py)全部通过，覆盖索引层次、原序、重名、重复身份、缺失/空文本/字面文本、未知类型、描述 Sm 与当前 assignment 分离、错误版本、设备歧义、错误包装和 XML 失败。测试是合成 XML／报告规则，不是 IDE 验收。

实际调用为安装文件读取和静态分析。没有选定可进入 IDE 的工程，因此没有本轮工程打开前后哈希、关闭回执、退出码或租约释放记录；不能把这些空缺记为“正常关闭”。既有工程和登记／租约仅作文件系统保全核对，主文件与附属文件指纹分开留存。未启动或退出 Desktop，未获取、回收或释放租约，原 stale 锁原样保留。

本轮工程打开、设备添加、PDO/I/O 写入、工程编译、保存、模型任务及在线操作均为 0。没有工程编译错误／警告计数。其他任务的工作区改动、S8b 独立 unknown、四项历史 MCP unknown、隔离、移除失败现场及旧证据保持。

## 最小下一步

先取得一份已正常保存关闭、允许只读检查的 EtherCAT 工程，包含身份明确的主站与从站，能核对父链并对应本机已安装描述。用户提供工程路径、设备型号等业务信息即可，内部 GUID 和描述身份由工具读取，不要求用户填写。取得样例后，另行安排限定只读验证：通过受支持接口，或公开参数与同状态原生导出，建立当前 PDO 启用及 assignment 的可验证对应；不能直接用 ESI 默认值替代。条件成立后才安排一次当前句柄读取，未知或冲突时停止。

在此之前，不反复扫描相同归档，不通过添加设备、试写 PDO、在线扫描或私有编辑器操作补齐样例。S6b 挂接缺口、S8b 映射写入阻断及 S9 在线规划仍是各自独立事项。

在取得工程配置证据前，维持③，不建议开发工程 PDO 只读工具；设备描述定义分析的可用范围不扩大为配置或通信能力。S8b 映射写入、设备添加和在线功能不因此恢复。

证据根目录为 D:\InoPro-S8c-PDO-ReadProbe-20261120-130009。复核包包含本机帮助与搜索边界、安装件身份/CIL、包装与 ESI 来源、83 行定义结果、样例/归档搜索清单、实际文件读取记录、离线测试和保全核对。没有复制完整工程或私人配置。

## 2026-11-20 收尾复核与证据归属

首轮交付提交为 `877fe9148874fe8cf68415dfd63b2498d3826c97`；其 main 基线为 `32612d9950cb8d7611dcff83012e9b70482a589b`。原复核包为 `D:\InoPro\deliveries\InoPro-review-20261120-131611.zip`，SHA-256 `563df6307d9784c0fa94dcf07249d40fd1412a5e517b87d1d2bef509795583d3`。64 个归档文件及清单已逐项复核；安装描述原件与结构化结果的来源对应保持，首次静态读取错误和中文帮助提取失败保留。

14/14 归属上述首轮提交中的合成 XML 与报告规则用例，本次脚本不变、只复用记录。它不代表工程 PDO 查询、真实 IDE、通信或运行验收。没有当前启用或分配状态的工程实读，也没有实际固件、在线状态或本轮编译结果。

本次收尾仅补清暂停状态、恢复条件和证据归属，再正常合并独立探测材料。产品保持 0.34.0 候选版、37 项工具；未提供 PDO 查询或编辑工具。产品实现、Schema、初始化指令及日常固定入口不变，无需重建、部署或握手。不开 IDE、不调用模型、不调整 DSH/Codex 配置，不清理历史 unknown、隔离、锁或 stale 租约。实际合并父提交、远端与文件树检查放在本次收尾复核包，原包及历史结论不覆盖。
