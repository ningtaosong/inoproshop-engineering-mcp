# HIGH_SPEED_IO 通道与已有映射

示例：“只读查看这个 AM610 工程的 HIGH_SPEED_IO 通道及已有映射，列出实际结果、字段缺口和方向、地址的限制。”

打开用户指定的工程后，用 `io_mapping_inspect` 传活动 `projectId`。仅支持 InoProShop 1.9.1.6、AM610 根设备描述 `4102 / 10f4 0002 / 3.5.11.11` 下的直接子设备 `40600 / 10F4 0600 / 00.00.00.20`，以及该实例实际拥有的连接器 2、接口 `Common.inovance2`。名称用于展示。多个符合条件的实例需要用实际设备 GUID（deviceId）区分。

清单来自该连接器的 host_parameters 及其可映射成员。通道键由设备 GUID、连接器 ID、参数 ID 和原生成员路径组成。按实际 page.nextOffset、相同设备筛选和 expectedVersion=version 续页；详情使用同一版本及原行 channelKey 作为 detail。续页和详情使用首查归档的同一清单，重新检查磁盘版本。page.observed 包括参数根和复合成员，不能换算成物理点数。

每行 getter 提供首项映射的原文、映射 ID、变量创建标志及地址字段。exportedMappings 是同一打开句柄内公开原生导出的有序列表。只有 exportState 为 verified 才报告 mappingCount，0 表示该行列表确实为空。遇到矛盾或缺失时仍给出已取得的两侧数据和覆盖缺口。原生 null、空串、字面文本、缺失和读取异常分别呈现；超过 JavaScript 精确整数范围的数值用十进制原文保存。复合根通过参数类型字段描述，叶成员可读取 base_type。枚举、字段及列表覆盖分别查看。

Input、Output 按原生字符串显示，其参照方尚未确认。automatic_iec_address 与 manual_iec_address 无法证明最终自动分配地址。映射 ID 仅属于映射记录。变量声明的原生绑定身份、实际接线、信号及 PLC 运行值尚未取得。映射修改和 EtherCAT PDO 编辑未开发。

原生证据来自探测分支 `codex/io-mapping-inspect-probe` 提交 `4307d8da511e68aea81f21a002995b2d9aea8171`。其一次保存版编译属于探测历史。产品查询只打开、读取、导出并关闭。

[真实 MCP、DSH CLI 与回归记录](io-mapping-inspect-acceptance.md)
