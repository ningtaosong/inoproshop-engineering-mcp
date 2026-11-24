# 0.37.2 variable_edit 维护归属补修与复验准备

本文保留补修与只读准备交付时点。后续用户确认具体计划后，已完成正式隔离和两阶段真实 MCP 复验，见[独立复验记录](native-normal-exit-recheck-0372.md)；不回写下列原受阻及未执行记录。

本分支 `codex/variable-edit-isolation` 基于 `7233a2e0f633a3f345e3a2c572089148d30b8ed3`，继承 0.37.1 正常退出保护；最新已核对 main 为 `be6850bf875a00d2a6321aef6adfc0090d59839a`（0.37.0）。未合并的 0.38 FB 初始化候选 `30260cf865db0e33d6353e218d4c003569ccb1bf` 独立保留，没有纳入本补丁。38 项 MCP 工具及输入输出 Schema 不变，初始化正文只变版本号。

本轮只有代码、离线验证、正式只读维护评估和复验准备。没有启动 IDE、工程服务、Desktop 或模型任务，没有打开、修改、保存、编译工程，也没有提交隔离、恢复原工程、历史 reconcile 或修改租约。

## 现有阻断及原证据

目标操作 `b1c4b21b-7884-4082-839e-0529b2645512` 仍为 unknown；原 `variable_edit` 已保存部分修改，IDE 退出异常。目标工程为 `D:\InoPro-FBInterfaceInit-20261123-220000\mcp-project\AM610_FBInterfaceInit.project`，当前 SHA-256 `2a6a0726e1cca45fb2134dd8863700829ef184c615d4d861d1666fb8e6fdd212`。不恢复旧字节，不改判终态。

0.37.1 正式维护入口曾生成受阻计划 `1067a73b-40bc-45b7-95b6-0526e9884282`，证据版本 `90e47213ae762ebc8867ab25df62e5cc1b04f1658435e51c5447863705ddb2c3`。唯一阻断为“原桥接请求不完整或身份不一致”。该计划和原始输出保存在 `D:\InoPro-NativeExit-Recheck-Prep-20261124-134708`，不覆盖、不手工改为 eligible。

只读分析确认生产服务把 `variable_edit` 派发为 `change`，操作持久化的 `effectiveArgs` 与原 request.args 完全相等，原用户参数逐项保持。维护命令映射漏了这一工具。before.json 与服务保存的 variableOriginal 对应同一对象，原文哈希为 `60aa1bf7c8871da07d55305e36b43c7dd165d260c00d1bea67408fb91c52d117`；checkpoint.project 哈希 `7c380b54ea448ac43c2e8802d3e730efc5a4380669a12587b925b1b5a1685dd4` 等于原 expectedDiskHash。当前工程哈希不同是既有保存事实，不能要求回退。

这是维护归属遗漏的证据，不是原 IDE 异常退出全部原因的证明。原 FileExit 诊断与正常退出保护见[0.37.1 说明](native-normal-exit-guard.md)。

## 最小实现

- 仅增加 `variable_edit → change`，范围是证据完整的 `targetKind=application` 操作，不宣称所有历史 variable_edit 均可维护，不顺带启用其他遗漏工具。正式 commit 的排他锁、证据版本和二次核对代码保持原样。
- 必须存在持久化 effectiveArgs，且与桥接 args 全对象一致；所有原参数仍逐项一致。不得用当前版本规划器重建历史 0.38 VAR_INPUT 请求，也不得补造缺失参数。
- 核对 operation、request、指纹、launch、工程路径、对象、Application、结果和检查点路径。直接编辑还核对原磁盘保护字段；旧副本同样要求明确的原请求和检查点版本。
- before.json 与 variableOriginal 的对象身份、原生类型、路径、原文及内容哈希必须对应，共有额外字段也严格比较。服务附加的生命周期字段不强制存在于原生 before 中；不删除或重写任一原始记录。
- checkpoint 必须存在且完整哈希等于原 expectedDiskHash。缺文件、无效 JSON、错误参数或归属均阻止计划 eligible。当前已保存工程仍单独纳入证据版本，不与检查点混同。
- evaluate / plan 只观察；原 unknown、finishedAt、工程、IPC、锁、登记和隔离记录不改。eligible 也不代表已经提交隔离或可以直接派发工程任务。

## 离线验证归属

证据目录：`D:\InoPro-VariableEditIsolation-20261124-141500`。测试通过生产 evaluateIsolation / generatePlan，构造独立合成登记，不使用真实工程服务或旧现场写入。

- 修复前：直接编辑与旧副本两条有效证据均被生产维护路径拒绝（2 项失败），日志保留。
- 新定向：40/40。包含两种模式、原始 0.38 请求形状、请求/参数/对象/原文/检查点反例、只读字节保全、旧计划在工程变化后仍被正式提交入口拒绝。测试只对临时合成计划调用过期拒绝路径，不提交真实隔离。
- 维护、正式隔离、原操作核对、进程身份相关回归：54/54。
- 正常退出、变量规划及服务、FB 旧动作相关回归：48/48。
- 构建、类型检查和初始化大小检查通过；各组分别记录，不相加，不重跑无关全量回归。原 0.37.1 Python 与全量 Node 证据继续归原提交，未写成本补丁的新运行结果。

上述测试使用独立 TEMP/TMP，旧目录未清理、默认 200 ms 阈值未改，默认环境历史性能问题保留。没有真实维护提交或本补丁真实工程验收。

## 计划与两阶段复验

独立代码复核通过后，已从固定构建分别执行一次正式 evaluate 与 plan，未提交。新计划 `e9297c3b-d9b3-4d86-912a-f3dd9b4d5a50`，证据版本 `3edad265e30a6e3abdc7deb7609b9ffc0009c4a612212df333dfbcfb58f7ffdd`；两次读取版本相同，eligible=true、blockers=[]、canReleaseOtherProjects=true。旧受阻计划仍保留。

范围只包括上述操作、工程身份 `58cc8da6-294d-4ab5-af21-2e31e4236252` 及唯一工程路径。原计划 aliases 数组保留 source/working 两行同一文件角色，文件身份均为 `3318604606:281474980737811`，不是两份工程或新增别名。原服务 PID 48400、IDE PID 53896 观察为已退出；服务与来源锁 owner-pid-exited/stale，未删除或修改。stale 不等于原操作成功。31,938 项保全材料在正式评估前后无字节变化，原登记无增删。

隔离提交会新增正式隔离记录并改变后续派发范围，禁止再打开、激活或写入该目标及确认别名；不会恢复工程、回滚源码、改判 unknown 或删除原锁、IPC 和检查点。当前尚未授权或执行这一步。提交前须再次核对排他、范围、文件身份及证据版本；用户对具体计划的确认是提交授权，准备和离线补修不是提交授权。

拟使用两个新独立路径，当前只核对不存在、不复制或创建工程：

1. `D:\InoPro-NormalExit-Recheck-0372-20261124\readonly\AM610_NormalExit_ReadOnly.project`
2. `D:\InoPro-NormalExit-Recheck-0372-20261124\write\AM610_NormalExit_OneParameter.project`

来源候选为中性 AM610 样例：`D:\InoPro\deliveries\InoPro-review-20261109-132658.zip` 中 `projects/AM610_Minimal_MCP.project`，SHA-256 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。目前只读核对归档，没有提取工程。它不来自封存工程；归档中 PLC_PRG 普通 VAR 为空，不能虚构已有参数供复验。

后续具体授权应覆盖以下最小方案：

1. 正式隔离提交成功并完成保护核对后，从已核验种子准备只读测试文件。候选产品直接打开并进行必要只读查询；每次操作核对实际 normal-close 阶段、同 request/launch/PID 创建身份与退出码 0，无退出信号。记录主文件哈希和附属文件差异。不编译或保存。
2. 第一阶段通过后准备第二个独立测试文件。现读 MainTask 的身份、配置和 PLC_PRG 绑定。只把配置周期从实际确认的 20 ms 改为 25 ms，`task_config_update` 正式派发一次；保留任务其他字段、调用和源码，使用工具自身保存关闭重开证据，再对实际保存文件编译和必要读回。若另一次保存改变最终文件，才安排适用于该文件的必要复编。周期仅是离线配置。

所有真实步骤待具体计划和方案确认，当前均未执行。新 unknown、冲突、退出异常或证据缺失立即停止；running 仅查询本轮原操作，不重放、不回滚、不恢复性保存、不换目录绕过冻结。不会复用原 FB 封存工程，也不把 0.38 功能候选当作 0.37.2 受验产品。

固定构建为 `D:\InoPro-Fixed\0.37.2-a9d9a9a348a3`，来源 `a9d9a9a348a321893afe38595624748dd244771c`；实现提交 `fa84195`，后一提交仅补入被本地忽略规则阻挡的说明文件，未改产品。324 个来源文件与 git archive 字节一致，构建与类型检查通过。38 项输入输出 Schema 与原 0.37.1 固定版本一致；指令文件 64,404、裁剪后的服务正文 64,403、含客户端标题 64,431／65,536 字节。

固定构建独立于日常 0.37.0 和原 0.37.1 准备构建。仅做静态版本/契约/指纹检查，不启动工程服务或独立 stdio 连接；实际连接、正常退出和保存闭环都待后续授权复验。日常 DSH、Codex、历史隔离及租约保持。静态契约脚本首轮误用输入 schema 的输出转换口径，出现 required 差异；按客户端输入口径 `io:input` 修正取证脚本后全等，产品未改。该首败、一次错误导出名、一次封套读取错误均单独保留。

历史 unknown、旧账本、原崩溃根因、CmpLog、脚本信任、默认环境性能、Desktop 欢迎页和 PLC 运行未验证边界继续保留。
