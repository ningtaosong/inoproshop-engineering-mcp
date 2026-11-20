# S8b 映射写入前置探测收尾

2026-11-20：只读功能已交付，映射写入探测受阻，日常入口未变。本次仅整理和合并探测文档、独立判定脚本及验证记录；不增加产品能力。产品保持 0.34.0 候选版、37 项工具。

## 三项状态

| 状态 | 证据及边界 |
| --- | --- |
| 已交付限定只读查询 | [io_mapping_inspect](io-mapping-inspect.md) 查询已验 AM610 的 HIGH_SPEED_IO 连接器 2；首项 getter 与同状态导出列表分别提供证据，声明级原生绑定身份未取得。 |
| 已有原生正例 | InputData（参数 13）/ Bit0 到已有 BOOL 的完整表达式 Application.GVL_IOProbe.Input0 曾完成设置、保存、独立重开及保存版编译。保存操作 e81c282d-d409-4c1d-b2f7-a311d92cbec0 与后续独立补证 3e3d10be-ce9b-41db-9ae5-690920d63c06 分别归档；不把后续成功补填原失败。 |
| 写工具暂未开发 | 尚缺可信、可调用的完整有效 I/O Application 选择入口；应用级重复映射来源覆盖及输入变量的程序写引用分别缺证。当前只能只读评估，writeAuthorized=false。 |

保存正例的最终主文件 SHA-256 为 cf1cf53f17397fc46641572ef6f068ea0a7754e708f06aecc009e4feef02b371。其编译结果只归属历史探测，不表示当前条件已足以交付通用写工具。本次没有打开该文件或执行 setter、保存、编译。

## 有效 Application 的接口差别

[有效 Application 单项核查](io-mapping-effective-application.md)的结论③只针对入口可信性：

- 文档化 driver_info.io_application 返回 GUID。CanSetIoApplication=false 时返回零 GUID，没有目标连接器的完整父 provider 委托；不能把零值当成有效应用不存在或已证明继承。
- 完整原生 GetApplication 选择链存在，包含父级委托及 ConfigModeApplication 分支。旧导出中的 IoAppSet、IoApp 是持久化选择字段，不足以推定当前有效结果。
- 从当前脚本对象取得目标 provider 的可信访问路径尚未确认。候选 getter 的 public 标志不能替代脚本契约；其声明类为非公开具体类。本次未进行运行时调用，不能宣称已证明 CLR 成员不可访问，更不能推广为所有版本均不支持。

[整体前置评估](io-mapping-write-precheck.md)维持②：只能做写前只读评估。该整体结论与入口单项③并不冲突。

## 恢复开发的最低条件

1. 取得厂商确认的公开脚本入口，或经明确验证的受支持 CLR 访问方式，能从目标连接器当前 provider 取得完整有效选择，包含父级和配置模式语义。
2. 在实际目标连接器及当前工程句柄中读取有效 Application，并与实际 Application 对象清单、工程身份和当前文件版本逐项对应。旧句柄、零值、读取失败或归属不符须拒绝，未来写前必须重读。
3. 完成拟定单通道范围所需的重复映射来源覆盖检查。已观察重复须拒绝；零命中只能说明已覆盖来源内未发现，不能补成应用全范围无重复。
4. 明确输入变量程序写引用的可验证范围、缺口及拒绝规则。S7a 限定 ST 静态结果不能代替全工程保证。

条件未满足时，独立判定脚本始终返回 writeAuthorized=false。合同草案不是已注册工具，不提供映射新增、替换、清除或自动回滚。

## 资料解释与证据时点

2026-11-20 前置资料核查新增了控制器／应用编程模型的 Input、Output 方向依据，以及 automatic 模式下 manual_iec_address getter 可以返回自动分配 IEC 地址的说明；详见[方向与地址依据](io-mapping-write-precheck.md)。这是安装帮助和实现链的解释，不是本次现场信号观测。最终自动地址、设备布局后的分配结果、现场接线和 PLC 运行仍未验证。

只读产品原答复及验收记录保持原文；不把后续资料发现回填为旧验收已确认。变量表达式与名称一致、编译接受，均不能冒充取得变量声明的原生 GUID。

## 验证归属与首次记录

| 记录 | 提交归属 | 输入及日志 | 本次处理 |
| --- | --- | --- | --- |
| 前置判定 30/30 | 脚本 f8d037b2a5fc1abd15a611e58ad187ec4efe9207；说明交付 294b7adf01ae64df49e5116b6e933dc0795ad055 | [判定器](../scripts/probes/io-mapping-write-preflight.mjs)、[合成用例](../scripts/probes/test-io-mapping-write-preflight.mjs)；原归档 offline-final-after-review.txt | 复用，未重跑；此前 29/29 与新增父参数占用用例前后的日志分别保留。 |
| 有效 Application 证据结构 27/27 | f14b064351640662755a448f7fcf09c01faa0e66 | [判定器](../scripts/probes/effective_application_evidence.py)、[合成用例](../scripts/probes/test_effective_application_evidence.py)；原归档 offline-tests.txt | 复用，未重跑；没有实际原生调用。 |

两组不相加，不作为真实 IDE 验收。原归档转换输入及结果保留为事后评估。打包预检曾因 utf8-sig 编码名停止、静态分析曾因工具路径及命令长度停止，均在原包保留；这些不是新的工程失败。三次独立 unknown、四项历史 MCP unknown、隔离记录、原移除探测现场、锁和 stale 租约均不清理或改写。

独立脚本只解析输入证据：mjs 依赖既有纯解析／哈希模块，Python 使用标准库。产品 TypeScript 构建仅包含 src/**/*.ts，工具从 contracts.ts 注册，日常入口为固定 dist/server.js；这些路径没有引用本次 scripts/probes 下的判定器或用例。产品实现、输入输出 Schema、初始化指令、固定构建和 DSH／Codex 配置不变，因此无需部署或握手。

## 复核入口与本次检查

- 前置核查原包：D:\InoPro\deliveries\InoPro-review-20261120-114318.zip
  SHA-256：da974608fc53a748c6172f17a344c742b6d125a1def16b6e2478660897267469。
- 有效 Application 原包：D:\InoPro\deliveries\InoPro-review-20261120-123139.zip
  SHA-256：4241d7e0478399144d359fd030954d4a3e354f85c3cdf6c464a540c44fa5b9fa。
- 本次收尾包记录最新 main 与分支、正常合并父提交及远端、完整变更树、脚本隔离、文档链接、产品不变指纹及逐文件清单。上述原包和实际检查结果随收尾包保存，不修改旧包。

仅执行文档、语法、链接、版本及范围静态检查，不重跑产品回归、IDE 或模型任务。未启动/重启 Desktop，未执行工程打开、映射 setter、保存、编译或 PLC 操作。配置、租约及封存文件只核对指纹。

S8c 仅作为后续独立只读可行性候选：须先有已安装且身份明确的设备描述、已有正常设备实例和可信公开只读接口，核实 PDO 索引、子索引、位宽和方向。需要新增设备时，S6b 对端挂接证据缺口继续适用。该候选不代表已有 PDO 编辑或映射写入能力，本轮不启动 S8c、设备添加或在线功能。
