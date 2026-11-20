# S8b 限定映射写入前置核查

本轮结论为 **② 目前只适合写前只读评估**。已有样例证明指定 BOOL 映射可设置、编译、保存并独立重开。要把它做成写工具，还须补齐当前有效 I/O Application 选择及同一应用的重复目标检查覆盖证明。本轮交付合同草案和离线判定样例，产品保持 0.34.0 候选版、37 项工具，映射写工具未交付。

## 已有证据和本轮执行范围

基线为 main 4070d1a88bf035e89fc91ab2aabfbca2930f1660。复用探测提交 4307d8da511e68aea81f21a002995b2d9aea8171 的原始记录，以及产品提交 8473f0982ec4935b07bdfda9c594364fd5d44825 的只读采集实现。原先三次未知现场保持各自 unknown，后续正例只归属其自己的操作。

| 证据 | 实际含义 |
| --- | --- |
| e81c282d-d409-4c1d-b2f7-a311d92cbec0 | 一次 setter，随后编译和保存成功。原独立读回因阶段位置守卫停止，旧结果保留。 |
| 3e3d10be-ce9b-41db-9ae5-690920d63c06 | 同一保存文件后续独立读回及保存版编译通过，0 错误、0 警告。这是历史编译。 |
| 非空保存文件 cf1cf53f17397fc46641572ef6f068ea0a7754e708f06aecc009e4feef02b371 | 首项及同状态导出均读到 Application.GVL_IOProbe.Input0，目标完整列表一条，其他 25 项为空。 |
| 空映射保存文件 0b569b51e267993c3bcb686b464ef882354795b4c05befbd3df93d976f62403c | 已确认正常关闭的控制文件。此次只用其归档数据做离线评估。 |
| 已交付 io_mapping_inspect | 同句柄 getter 与导出按通道键关联，分页使用同一归档清单并检查磁盘版本。 |

本轮 IDE 打开、setter、工程保存、工程编译均为零次，未发送模型任务。安装件、帮助和归档已能回答本轮问题，因此没有追加真实采集。工程文件仅做文件系统指纹核对。

## 四项写前依据

### Application 与变量

原生 Application GUID、名称、类型和设备归属来自实际对象。I/O Application 选择来自同状态导出中每个设备或连接器自己的 DriverInfo，必须按所属 GUID 定位 IoAppSet 与 IoApp。不能取导出中第一个同名字段。

已验结构中，AM610 根设备 IoAppSet=True，IoApp 等于目标 Application GUID。目标 HIGH_SPEED_IO 设备及连接器 2 均为 IoAppSet=False、零 GUID。这是持久化选择字段和层级关联，不能单独当作有效 Application 已读回。安装件 DeviceObject.GetApplicationObject（0x06000860）先尝试 ConfigModeApplication，随后才按 PlcLogic 子对象、IoApplicationSet 与 GUID 选择；DriverInfo.get_IoApplication（0x06000aaf）也可能优先返回配置模式应用。ConfigModeApplication 是静态内存 Hashtable（0x060009c1），旧导出没有采集。公开原生 DeviceObject.GetApplication／IIoProvider.GetApplication 可见，但脚本层可调用的封装尚未验证。必须补证这一选择链在当前打开状态中的结果，或将所有选择条件纳入可核验的限定前提，不能把子设备零 GUID 解释为已经证明继承。子设备、连接器单独选择、多个 Application 的复杂继承及覆盖均不在已验范围。

GVL 的 GUID、原生类型 ffbfa93a-b94d-45fc-a329-229860183b1d、parentGuid、路径和全文属于对象证据。变量的名称、BOOL 类型、声明区及原文位置来自限定 ST 声明解析。拟议定位为工程身份、Application GUID、GVL GUID、声明全文版本、变量名和位置。变量级原生绑定 ID 尚未取得，也不作为已经存在的字段返回。

同一 Application 根级 GVL 名按 ST 大小写规则检查唯一性，声明内同名变量也按大小写不敏感匹配。实际名称用于生成表达式，保留原拼写。只支持普通标识符组成的 Application.GVL.Variable，拒绝多段成员、转义名、数组、AT、别名、属性、库变量、修饰声明、多名共用声明及解析不完整。限定解析不足以证明编译器语义绑定，后续真实编译仍独立判定。

本机 codesys.chm 的 _cds_edt_device_io_mapping.htm 给出 application name.module name.variable name；_cds_operator_namespace_gvl.htm 给出 GVL 名限定成员。OEM GetApplication 0x060012fe 取首个句点之前的应用名，GetPlainVariableName 0x06001301 取其余原文。AddIoLanguageModel 0x06000832 使用 Application GUID 和名称建表，AddVariableMappings 0x06000344 检查应用。旧短表达式 GVL_IOProbe.Input0 的编译失败保留，完整表达式的后续成功已有独立证据。

### 通道方向与 BOOL 类型

本机 ScriptDeviceParameter.get_channel_type 0x060000de 直接返回 IParameter.ChannelType，未进行方向反转。ScriptEngine 帮助把该字段定义为 I/O 通道类型。随安装的设备 I/O Mapping 帮助说明这些是控制器地址与应用变量的映射，Addresses 页把 I 定义为输入、Q 定义为输出。因此本轮已取得控制器／应用编程模型参照的文档及实现链路。它不等于验证了本机现场端子、信号流或接线。

该精确通道原生返回 Input、成员 base_type=BOOL、bit_size=1。已有 GVL 声明由限定解析确认 BOOL；其配置编译曾被本机接受。这三项分别说明字段、声明类型和编译接受。其他成员、OutputData 和其他设备仍在拟议首版之外。本机帮助还要求输入映射变量不由程序写入，一个已有变量只映射到一个输入。本轮未取得全工程写引用分析；限定声明可定位不等于已经证明没有别名或程序写入。后续合同须声明这项覆盖和拒绝条件，不能借用 S7a 的有限静态结果作全工程保证。

### 地址保留与 setter 语义

ScriptIoMapping.set_variable 0x0600014f 验证标识符并取得可写副本，回调 0x0600027c 在完整列表为空且表达式非空时 AddMapping(value, !value.Contains('.'))。包含点号时 CreateVariable=false。该路径不接收变量声明 GUID。非空旧列表与空表达式会走其他修改或删除分支，拟议工具必须在调用前拒绝。

可写定位依据工程句柄、设备 GUID、连接器 ID、参数 ID 与成员 identifier。Commit 将设备对象交回对象管理器，后续异常不能解释为没有内存变化。即使回调中没有直接地址赋值，也须核对提交和通知之后的实际状态。

本机帮助补充了地址 getter 的含义。manual_iec_address 在自动模式下可以返回自动分配的 IEC 地址，get_manual_iec_address 0x0600014b 读取 IIoMapping.IecAddress。不能仅因属性名就称它是未生效的手动槽位。设置该属性或自动标志会切换地址模式，这些 setter 均不属于拟议写工具。

已有正例的写前、写后、保存前和独立重开快照中，26 项通道的 automatic_iec_address、manual_iec_address 均保持，目标为 True 和 %IX0.0。首版须逐项保留已读取的模式、地址 getter 原文及导出地址字段，字段失败时停止。最终分配、后续设备布局变化、现场接线及运行仍待验证；此限制不要求本轮检查所有设备地址。

default_variable 是映射元数据。只允许指定完整空列表目标首次创建映射时由原生 null 变为确切空串，且同状态导出 DefaultVariable 相同。其他通道、已有非空默认文本、缺失和读取失败不适用这一例外。它不能当作 BOOL 初始化值或实际运行值。

### 已有映射与重复目标

空目标必须由同句柄完整导出列表的零条记录和首项 getter 空状态共同证明。getter 的 Id=-1 或 maps_to_existing_variable=True 单独都不充分。写前还须证明参数根与目标成员不会发生已映射父子覆盖。安装帮助要求聚合根和成员互斥，本机 Input 路径的 CheckMappingUpAndDown 0x06000150 提前返回，不能依赖该 setter 完成这项保护。

逐行按设备 GUID、连接器 ID、参数 ID、成员路径关联，完整列表的每条原文都参与重复检查。受支持的完整三段名可按 ST 大小写规则比较；不明表达式、别名或解析失败保留为覆盖缺口。命中目标表达式即拒绝。零命中只说明受检查列表内未发现。

现有产品导出选中的 HIGH_SPEED_IO，采集其连接器 2 的 host_parameters 及可映射成员。历史 Supplement 导出另有更广证据：四个设备条目与同快照设备树逐 GUID 对齐，覆盖四个 DeviceParameterSet 及八个连接器 HostParameterSet；递归读取 8578 个所属元素，仅发现目标一条映射。另一个 HSIO 条目含专用计数器／轴字段，没有通用参数集。此结论是这份快照的常规已序列化参数来源内未见第二条，不能简写为其它连接器未读，也不能推广为任意 provider、别名及整个 I/O Application 语义来源全部覆盖。产品当前输出与归档 XML 审计的覆盖必须分开。

拟议合同采用“不会把已存在的目标变量再接入第二处 I/O 映射”的前提。为兑现这一前提，下一步需把本次导出来源清单与有效 I/O Application 关联，核实特殊 provider 和其它表达式来源的边界，将各设备、连接器、参数视图的枚举终点及缺口纳入当前句柄采集，并用已有映射样例核对跨来源重复查找。当前证据不足以对应用全范围作无重复结论，这是暂留只读评估的具体阻断。它不要求采集在线值、验证所有设备地址或新增映射正例。

## 最小合同草案

建议未来工具名 io_mapping_set_existing_bool，名字和输入仍待产品实现阶段确定。本轮没有注册该工具。用户只需说明工程、InputData.Bit0 和已有 GVL 变量，Agent 负责获取内部证据。

1. 绑定工程真实路径、文件唯一身份、磁盘 SHA-256 和登记 projectId。核对本机版本、AM610 4102 / 10f4 0002 / 3.5.11.11、子设备 40600 / 10F4 0600 / 00.00.00.20、父设备 GUID、连接器 2 / Common.inovance2 和所属设备。目标键精确为参数 13 / Bit0，展示名称只作复核。
2. 绑定 Application 的原生选择和所有相关 DriverInfo、GVL GUID／类型／父对象、全文哈希、解析规则版本及唯一普通 BOOL 的位置。工程、声明、通道清单、完整映射列表和覆盖清单分别具有版本。行动摘要还须包含原生目标键、授权表达式、来源 operationId 和原地址证据，不能仅接收名称或裸索引。
3. 在实际写入句柄中重新采集全部写前证据。旧页、外部文件变化、错属、重名、非 BOOL、解析不完整、既有映射、父子占用、已发现重复及覆盖缺口都在派发前具体拒绝。重复 requestId 与相同指纹返回原操作；同 requestId 异参返回 conflict。不同 requestId 也不能绕过当前已有映射和版本检查。
4. 按现有工程机制建立并核验检查点，持久记录派发意图，再调用一次公开 variable setter。只接受从已核实名称生成的非空完整表达式，禁止创建变量、修改地址、重建列表或替换既有映射。
5. 写后同句柄核对 getter、同状态完整导出、唯一目标记录、CreateVariable=false、精确空串默认字段。保留目标外所有已检查列表、父参数、相邻成员、地址字段、变量全文和可读任务配置。原生映射 Id 单独记账，不标为声明 ID。
6. 核对成功后才进入用户授权的编译及保存关闭重开，原生结果状态和 buildPassed 独立判断。编译派生设备按对应阶段比较；跨重开仅应用已验证的具体设备身份和相对顺序规则，同句柄不套用换位例外。重开再次核对 I/O Application、声明、通道和完整映射，最终编译证据对应磁盘文件。此流程沿用正例已验证的阶段关系，具体产品集成仍待测试。
7. setter 可能已生效后发生异常、读回矛盾、字段或覆盖证据丢失、清理或发布失败时，按原机制 unknown 并冻结。保留首次异常、清理异常、检查点、派发及退出证据，不自动清除映射、反向设置或恢复性保存。直接编辑和旧副本路径都须覆盖。当前服务去重及冻结位置见 src/service.ts 的 requestId/fingerprint 与 PENDING_UNKNOWN 分支。

## 可复查判定与验证

[离线判定脚本](../scripts/probes/io-mapping-write-preflight.mjs)只接收证据对象，复用声明解析和哈希，没有 IDE、服务或写入入口。所有结果 writeAuthorized=false。它的 local-candidate 仅表示限定已读范围通过，不能作为实际写入授权或产品就绪证明。[用例](../scripts/probes/test-io-mapping-write-preflight.mjs)使用改名的合成 Application、GVL 和变量，逐项检查拒绝原因及输入未被修改。

| 输入情形 | 离线结果 |
| --- | --- |
| 合成普通 BOOL，目标完整空列表 | local-candidate，明确只检查选定连接器 |
| 原控制归档，实际 Application/GVL/Input0 | local-candidate，26 项内未发现重复 |
| 原非空归档，同一目标已有一条 | TARGET_ALREADY_MAPPED |
| 错误类型、AT、数组、别名或多名声明 | VARIABLE_NOT_PLAIN_BOOL |
| 变量重名／缺失，GVL 重名或错属 | VARIABLE_NOT_UNIQUE 或 GVL_OWNERSHIP_OR_NAME |
| Application 选择或覆盖方式不同 | APPLICATION_NOT_UNIQUE / APPLICATION_OWNERSHIP / APPLICATION_OVERRIDE_UNSUPPORTED |
| 声明、磁盘、列表或覆盖变化后沿用版本 | EVIDENCE_CHANGED |
| 其他行已有同名完整表达式（含大小写变体） | DUPLICATE_VARIABLE_OBSERVED |
| 父参数已有映射 | RELATED_PARAMETER_MAPPED |
| 列表不完整、截断、字段失败、getter 与导出不一致 | 按具体缺口拒绝 |

最终相关用例 30/30。local-candidate 仍缺有效 Application 及应用级覆盖证据，始终 writeAuthorized=false。先前 29/29 记录保留，之后补入父参数占用用例。多来源及异常形态属于离线替身；本轮没有新增真实工程验收。归档转换及结果是事后评估，不改写历史 unknown 或旧编译字段。

## 证据入口与下一步

复核包包含来源指纹、安装帮助片段、setter 与命名控制流索引、地址逐阶段对照、实际归档的规范化输入、判定结果及文件保全清单。原始归档继续保留于 D:\InoPro-S8b-Supplement-20261120-093923、D:\InoPro-S8b-Supplement-20261120-100548 及对应的历史探测目录。

下一步只读补齐有效 I/O Application 选择、映射来源覆盖与跨设备重复目标判断，确认无法解析的表达式和不可枚举来源如何阻止派发，再决定是否进入上述单一组合的写工具开发。现有 io_mapping_inspect 的范围与契约继续有效，映射写入、EtherCAT PDO 编辑、设备添加及在线功能仍按各自阶段处理。历史 unknown、隔离、原移除失败、CmpLog、脚本信任与运行限制保留。
