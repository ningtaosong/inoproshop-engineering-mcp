# S6a 本机设备描述目录

`device_catalog` 只读查询本机 InoProShop 设备仓库，适用于没有活动工程的会话。

> 不打开任何工程。请从本机已安装的设备描述中查找 AM610，列出实际匹配的型号、厂商和设备描述版本。如果同一型号有多个版本，请分别列出。挑一条给出原生设备类型和 ID，并说明这些信息能否证明现场 PLC 的实际固件版本。若未找到或查询不完整，按实际结果回答。

## 查询与覆盖

- `query` 默认按原生型号名称做不区分大小写的子串筛选。用 `field` 切换到厂商、描述版本、原生类型、ID 或仓库来源。候选保留同名不同版本；同一精确身份来自不同仓库时也会分别列出。
- 按实际 `page.nextOffset` 续页，传上一页的 `version` 为 `expectedVersion`，保持原筛选条件。每次重新读取仓库。目录内容或覆盖变化会使旧页失效。响应体积也可能缩小当页条数。
- 详情使用结果中的 `type`、`id`、`deviceDescriptionVersion` 作为 `detail`。身份保持原生文本。只有完整枚举确认该身份唯一且 `get_device` 核对一致才报告 `detailVerified`。
- `scope` 分开报告枚举、字段、筛选覆盖和截断。字段读取失败、原生空值、超出字段上限时返回 `null` 并列入 `unavailableFields`，不猜测内容。最多检查 64 个仓库来源和 10,000 条原生记录，字段上限 256 个 UTF-16 单元。底层失败或筛选字段不可读时，`page.total` 为 `null`；零命中仅指本次查到的范围。
- 设备安装目录、工程中的设备实例和现场固件是不同的数据。原有 `device_inspect` 继续查工程中的设备及可读离线参数；`device_catalog` 的 `firmwareStatus` 始终为 `not-read`。未验证实际 PLC、设备添加、参数写入、设备包安装或 I/O。

## 原生依据

InoProShop 1.9.1.6／ScriptEngine 3.5.11.10 在无活动工程时支持 `device_repository.sources` 与 `get_all_devices(source=source)`。设备身份由 `device_id.type/id/version` 返回，型号及厂商由 `device_info.name/vendor` 返回。来源为原生仓库名称及内部来源标志；不返回仓库地址、不通过文件名反推来源。使用 `create_device_identification(type, id, version)` 与 `get_device` 验证精确读回。

独立原生探测查询到 729 条描述，AM610 型号命中 8 条。同一台机器、同一安装及其当时的仓库是此次结果的范围。原生 API 参考见 [设备仓库](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceRepository.html) 和 [设备描述](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceDescription.html)。

返回结果只陈述本机仓库当时可见的描述。设备描述版本不能用于证明现场 PLC 固件版本。

## 2026-11-18 验收

- 产品提交 `520aa89f6a74e802bbf6fba77668f53d6381f479`，0.29.0 候选版、32 项工具。对照 main 导出的 Schema，原 31 项输入与输出逐项相同。构建和类型检查通过，初始化指令按本机 DSH 标题计为 60,304 UTF-8 字节，上限 65,536。
- 真实 MCP 在原登记目录中两次调用新工具，查询结果与独立原生探测的 8 条 AM610 记录逐项一致。以类型 `4102`、ID `10f4 0002`、描述版本 `3.5.10.40` 做精确详情读回，通过原生核对。未打开工程。
- DSH CLI 只提交一次用户任务。正式连接得到 0.29.0、32 项工具；两次模型调用均为 `device_catalog`。先列出 AM610-CPU1608TP 的 8 条描述，再按原生身份核实 `3.5.11.11`。原答复的“也用到了工程工具”表述易误读，实际只有两次全局目录查询。原文和勘误分开归档，固件未读取。
- Node 完整回归在独立测试 TEMP/TMP 下 457/457；Python 桥接替身 213/213。初次定向的服务替身遗漏了 Schema 默认参数，修正后 7/7。最初默认环境运行在旧工具数量断言调整前已出现失败，未作为本提交的完整回归结论。未改变历史默认环境的状态查询限制。
- 验收使用原日常登记目录。原登记、会话、隔离账本及历史 unknown 保留。日常 0.28.0 入口的桌面及服务子进程已恢复，最终握手和工具接收未取证。未永久部署候选版。
