# S6b AM610 追加与挂接的原生可行性验收

本轮从 `9e3185d2c984357b0585a37f19ad513be8699f75` 继续。产品仍为 0.29.0、32 项工具，既有设备 GUID、兄弟顺序、任务/ST、接口和占用检查保持。变更限于独立探测及验收说明。

## 写入顺序和现场证据

离线使用 [A/A2/B/C 原生观测](device-add-visibility.md) 的归档快照验证阶段约束。B 的编译后计划无法用于 C，伪装成同阶段也会因树差异被拒绝。守卫使用实读的子节点数和追加索引，另外以合成追加索引 `10` 验证没有写死 `8` 或 `9`。同阶段设备节点增删、重排、连接器、占用及任务/ST 变化均有拒绝用例。没有按名称过滤 `HwConfiguratioinDevice`。

新夹具为 `D:\InoPro-S6b-DevicePlacement-20261118-161015037\engineering\AM610_S6b_Placement.project`，由已验证的中性 AM610 种子准备。主文件 SHA-256 为 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`，三次句柄关闭后的文件指纹均一致。基线首次打开时编译一次，诊断为 0 错误、0 警告。该句柄的编译后树出现 `Device/HwConfiguratioinDevice`，追加位置变化，随后无保存关闭。

在第二次打开、尚未编译时生成计划。精确设备描述为 `SMC_FreeEncoder`、`1152 / FFFF 0001 / 3.5.5.0`。根设备 GUID 为 `bae96937-5e0e-48a6-8b2a-2ca00576a271`，实读追加索引为 `8`，计划实例名称为 `S6bProbeDevice`。父端为 `0 / Parent / Common.SoftMotion.General`，设备描述的子端为 `0 / Child / Common.SoftMotion.General`。在第三次打开的未编译状态按原计划复核，再在同一打开句柄内坚持原索引、原接口和原计划。跨打开与同句柄复查均通过，包括原生精确描述、父设备、两端兼容性、名称、可见占用、任务及 ST 证据。

## 实际挂接的证据缺口

本机 `ScriptEngine.dll` 接口元数据和 InoProShop `1.9.1.6` 的实例成员观察均未找到可取得对端连接器的 `get_parent_connector` 或 `parent_connector` 路径。`HIGH_SPEED_IO` 和 `MODBUS_TCP` 的对照能读出树父设备以及各自的连接器元数据。接口资料将 `get_device_object()` 定义为取得连接器本身所属设备，将 `host_path` 定义为本设备上朝主机方向的下一连接器。两项都不能单独提供对端。原生 `insert` 的参数包含索引和设备身份。 [ScriptDeviceParameters](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceParameters.html) · [ScriptDeviceObject](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceObject.html)

只读原生导出额外核对了两个已有子设备的 `ParentGuid`、`ParentSVNodeGuid` 和 `HostObjectGuid`，可以绑定父设备。选中实例和父设备的导出连接器行都未给出已绑定对端 ID，`ClientConnectorId` 为 `-1`，`ClientConnectorInterface` 为空。复核包保留原生导出相关字段和原导出指纹。现有观测无法核验指定连接器上的实际挂接。 [ScriptProject](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptProject.html)

| 验收项 | 实际结果 |
| --- | --- |
| 派发一次原生 `insert` | 未派发。守卫以 `PARENT_CONNECTOR_READBACK_UNPROVEN` 停止，无派发标记。 |
| 新增实例实际挂接 | 未验证。已有实例缺少可核验的父连接器 ID 及其所属对象读回。 |
| 保存关闭重开后保持挂接 | 未验证。没有新增设备或保存。 |
| 保存版编译 | 未执行。0 错误、0 警告仅对应写入前的中性夹具基线。 |

**本组合继续只做只读评估。** 需要先在原生实例上证明可独立读取对端连接器 ID 和所属设备，再谈验证插入及保存后的关系。后续若有证据达到派发门槛，保存重开后应在复编前校验实际挂接、可读初始配置和原有任务/ST。复编引起的树变化单列，与基线编译阶段对照。

6 项归档阶段测试及 6 项既有跨打开测试通过。三个 IDE 进程在一次集中移交中正常关闭退出，夹具附属文件变化已单列。日常 DSH 0.29.0 的原入口与工程服务子进程已恢复，配置、登记、锁和隔离记录指纹在恢复前核对一致。本轮无模型任务，握手及工具清单未取证。
