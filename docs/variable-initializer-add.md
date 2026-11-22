# 普通变量补写显式初值（0.36.0 候选）

分支 codex/variable-initializer-add，基线 f1b10cc2bb994a495c256eee03b7fc774a6493cf，37 项工具。新增 variable_edit 的独立 add-initializer 动作；其他 36 项工具及所有输出 Schema 不变，旧动作保持。范围见[变量编辑说明](variable-edit.md)。

服务完整解析原文，确认唯一普通声明没有初始化，仅在真实分号前插入。新动作的内部只读预检取得原生对象／Application／ST 实现证据，在实际写句柄及重开后再次核对；原始声明和实现区均有原文哈希。不会以固定 language:ST、文本实现存在或分页缺值代替判断。直接和旧副本部分写入均返回 unknown 并冻结，不反向编辑或恢复性保存。

离线测试、真实 MCP、唯一一次 DSH CLI 及产品提交分别归属。新建夹具准备与正式编辑分开，旧失败与历史限制保留。本分支不合并 main、不永久部署，不连接 PLC 或宣称运行效果。

## 提交与离线验证归属

- 实现及完整回归提交：9667e8934dbcbf4b8cfdd85fe92d8206533263e1。独立临时目录 Node 957/957，Python 623/623；定向 Node 154/154、Python 4/4 分别记录，不相加。
- 实际受验产品：ea3d08a9b33943cb96985b7fe4efb1a2cc7bdaae。产品唯一后续差异为服务 VERSION 常量从遗漏的 0.35.0 修正为 0.36.0；构建、类型通过，最终定向 97/97，版本与旧契约 2/2。原36项输入及全部输出 Schema 不变，variable_edit 只增独立动作与其参数约束。
- 第一次 Python 扩展用例因测试预期写成转义 CRLF 而失败；修正测试期望后通过。首次连接在初始化版本断言停止，零工程请求，服务正常退出。新增版本测试另有一次 fs 未定义的测试代码错误，默认环境 96/97；改用已导入的 readFile 后，最终定向通过。原日志保留，不算真实工程失败或默认200ms性能问题已解决。
- 固定目录为本轮 fixed-v2，没有覆盖首个固定目录或日常 0.35.0。实际初始化含标题 63,752/65,536 字节；本轮不升级上限。

## 真实 MCP

准备操作单列：原生新建 AM610、根 GVL_Edit、PLC_PRG 声明、基线编译。正式 add-initializer 共六次，每次仅派发一次：

| 作用域 | 变量及请求字面值 |
|---|---|
| 根 GVL VAR_GLOBAL | Flag → TRUE；Count → -2147483648；Delay → T#60000ms |
| PROGRAM VAR | LocalFlag → FALSE；LocalCount → 2147483647；LocalDelay → T#8s |

写后及重开原文与生产规划的单次插入完全一致；原有 Keep/KeepLocal、中文注释、多行声明、空白、实现及任务保持。六次写入分别完成原生身份／ST 标识及原始文本读回，未从 variable_inspect 的缺值推断缺少初始化。

准备编译一次、正式修改后编译一次、保存版复编一次，各0错误／0警告，分用途记录。最终保存文件 SHA-256：e3c307533e9ad8ebb9187901c853a92199af61f6260d26860c495e9e17e16757。保存版编译的 diskHash 与之相同。

工程：[打开 MCP 工程](D:/InoPro-VariableInitializerAdd-20261122-194910/mcp-fixture/engineering/AM610_Initializer_mcp-fixture.project)。

本轮真实普通 POU 样例是 PROGRAM。FUNCTION、FUNCTION_BLOCK 的普通 VAR 保护在离线生产桥接替身中核对，不把它们写成本轮新增真实工程验收。

## 一次 DSH CLI 验收

另一个独立夹具由 MCP 准备好后，仅发送一次自然语言任务。模型实际使用一次 add-initializer，把 GVL_Edit.Delay 的缺失初值补为 T#8s；没有创建变量、改类型或修改其他内容。完整原文与生产规划一致，最终 PLC_PRG 源码和任务配置与准备基线一致。

- 夹具准备编译一次；CLI 正式编译及保存版复编各一次，均0错误／0警告。保存关闭重开通过，最终源码和任务均已读回。
- 最终文件 SHA-256：b9b5c42ad763988e6224690d3823c307dcaaf9bfee3a8e33cb2be7314c230424。最后一次编译的 diskHash 与最终文件一致。
- 同一正式连接 initialize 返回0.36.0、tools/list取得37项且无续页，Schema摘要与开发端相同。只记录了CLI协议元数据，不冒充完整原始协议正文；模型实际调用新动作有原始调用记录。
- 没有参数拒绝、新冲突或新 unknown；没有历史 operation_status/reconcile、project_compare、业务副本或在线动作。47次状态查询均指向本任务，效率仍部分通过。project_list 有一条CLI输出截断，保留原文。
- 另一个发现连接 server/discover 返回 -32601，未记录到该连接退出事件。正式连接与CLI均正常退出0；不能写成所有连接均完整成功。
- 原答复实质结果准确。其行内声明示意压缩了原始多行与空白，不能作为逐字原文；实际文本以最终 object_read 为准。工程链接依据工具返回路径生成，未验证桌面点击。原答复不修改。
- 两套验收共49次实际IDE操作（开发端38、CLI11）均取得绑定请求及进程创建身份的正常退出证据。不是只凭 result.json 的 succeeded 判定。

工程：[打开 CLI 工程](D:/InoPro-VariableInitializerAdd-20261122-194910/cli-fixture/engineering/AM610_Initializer_cli-fixture.project)。

## 文件与现场保全

工程闭环通过；限定流程按观察遵循，效率及展示部分通过。本轮没有触发真实新的 unknown，不能由此证明模型在任何不确定场景都能强制停止。写前拒绝、部分写入及证据缺失的冻结来自单列的离线生产路径测试。

两份工程的主文件因授权修改和保存而变化，各自的用户 .opt 和 .projectbackup 也有字节变化；AllUsers.opt 仅时间变化。MCP工程在CLI任务期间四个文件的字节和时间均保持。附属文件没有混入源码保全结论。

28,991项历史保全路径记录除正常 registry.json 更新外保持；日常0.35.0固定目录355项文件指纹、DSH和Codex配置保持。新操作、IPC及正常登记/租约变化单列，不宣称整个数据目录不变。最终无Desktop、IDE或候选服务进程、无未隔离在办操作；原stale租约按现场保留，没有手工删锁或历史reconcile。

实际沿用的登记目录是 D:\InoPro\.local\dsh-phase4-repair-20261028-A1；请求中的 D:\InoPro.local 同名路径不是本次已有日常登记来源。本轮依据已核实配置保持原目录，未切换到另一目录。

本分支不合并main、不永久部署。日常入口仍为 D:\InoPro-Fixed\0.35.0-f1b10cc2bb99\dist\server.js。Desktop日常连接、完整初始化指令进入模型上下文、链接点击、PLC运行及实际初值效果未验证。历史unknown、隔离、默认200ms性能、崩溃根因、CmpLog和脚本信任限制保留。

## 复核入口

本地证据根：D:\InoPro-VariableInitializerAdd-20261122-194910。复核ZIP的 INDEX.md 提供：
- 本实现差异和兼容性用例；
- 离线测试归属、首败及首次初始化版本停止；
- MCP完整协议、六次正式修改、准备与正式编译分组；
- CLI唯一任务、真实调用、原答复及展示说明；
- 每次IDE退出证据、工程/附属文件指纹和历史保全；
- 清单、逐文件SHA-256、ZIP可读取性及入口检查。

S4b没有全部完成。仅补写既有普通 BOOL/DINT/TIME 单变量的缺失初值；不扩展接口区、Method/Property、别名、数组、聚合或特殊声明，也不改变旧set-initializer对无初值声明的拒绝语义。
