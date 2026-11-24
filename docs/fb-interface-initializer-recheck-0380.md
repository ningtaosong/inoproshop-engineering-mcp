# 0.38.0 FB接口初值：整合正常退出保护后的独立复验

本文记录独立复验当时的状态：在 `codex/fb-interface-initializer-add` 实现与验收，尚未合并或部署。后续正常合并与入口准备见[0.38.0收尾说明](fb-interface-initializer-0380-merge.md)，不改写本次实际验收归属。范围仍为普通原生 ST FUNCTION_BLOCK 的普通 VAR_INPUT／VAR_OUTPUT，给已有、唯一、无显式初值的 BOOL、DINT、TIME 单变量补写初值。显式指定 section，使用 `variable_edit / add-initializer`，保持38项工具。原 VAR／根GVL及其他动作语义不变，S4b尚未全部完成。

## 代码及证据归属

- main：`769b513b4ec8559228da3dbc78e70cc5fa7b2af5`，0.37.2／38工具。
- 原功能分支：`30260cf865db0e33d6353e218d4c003569ccb1bf`。
- 正常合并：`d01bf2392d649f744b1a1c9d39ae8623ce88b408`，保留双方历史及原失败。
- 本轮固定产品与补充用例：`da82ae09d2e7fa960fe080a0754367aea0b6bdf4`。该提交相对合并提交仅增加生产服务与adapter组合测试，产品一致。
- 固定入口：`D:\InoPro-FBInterfaceInit-Recheck-20261124\fixed\dist\server.js`。来源、全部源码与构建文件分别留有SHA-256清单。

0.37.2 的 `adapter`、隔离、正常关闭、进程退出和存储实现保持原内容；本轮将其与FB接口区补写及完整子树保全路径组合验证。JSON层38项输入、输出Schema均保持，新增能力体现为 `variable_edit` 对已有参数的限定组合接受规则。独立固定构建的初始化指令含客户端标题为64,547／65,536字节，未提高上限。

| 离线检查 | 本轮记录 |
| --- | --- |
| 构建、类型检查 | 工作区和独立固定构建均通过 |
| Node完整回归 | 1198/1198，四组互不重叠的测试文件，分别135/135、598/598、276/276、189/189 |
| Python完整回归 | 661/661，单独记录，不与Node相加 |
| 相关定向 | 190/190，不加入完整回归计数 |
| 实际IronPython | 本机2.7.7对完整固定worker仅解析编译通过，不执行业务 |

测试以da82ae0对应树为准。定向在该次测试提交前运行，产品和测试树一致。新增8项生产服务／adapter组合用例覆盖直接编辑和旧副本路径的正常、写前关闭失败、写后关闭失败及缺回执；写前零修改、写后unknown、首次异常、冻结、去重及重启核对均保留，不做恢复性保存。完整Node测试使用记录的独立TEMP／TMP目录，不修改200ms阈值，不覆盖默认环境历史性能问题。

## 独立工程及准备

两份工程均通过真实MCP `project_create` 原生新建，AM610描述 `4102 / 10f4 0002 / 3.5.11.11`；未复制封存工程。

- MCP：`D:\InoPro-FBInterfaceInit-Recheck-20261124\mcp-project\AM610_FBInterfaceInit.project`
- CLI：`D:\InoPro-FBInterfaceInit-Recheck-20261124\cli-project\AM610_FBInterfaceInit_CLI.project`

每份准备了FB_InitProbe、Method ReadCount、Property Value及Get／Set、PLC_PRG显式调用和原MainTask。输入区InputEnable／InputCount／DelayTime、输出区OutputAlarm／OutputCount／HoldTime起初均无显式初值；内部InternalCount为DINT := 9。PLC_PRG明确传入FALSE、11、T#20s，正式补写不得改变这些实参或Method调用。

准备阶段36次IDE请求均取得可信正常退出及非legacy正常关闭回执。两份工程各完成准备编译、保存关闭重开及保存版复编，各次均0错误／0警告。准备服务以EOF正常结束，code0、signal null。正式验收前另采集两份工程及附属文件指纹，未补造旧轮缺失的基线。

## 正式验收结果

### 开发端MCP

正式六次 `variable_edit` 均成功：输入区InputEnable := TRUE、InputCount := 7、DelayTime := T#3s；输出区OutputAlarm := TRUE、OutputCount := 8、HoldTime := T#5s。逐次核对只在目标分号前插入授权片段，保留原有注释、其他声明、FB实现及四个子对象。工具内每次均完成保存关闭重开和子树读回。

最终再次显式保存重开，并核对所有六个源码对象与MainTask。PLC_PRG的FALSE、11、T#20s实参、Method调用、所有非目标对象的完整原文与身份、任务配置版本均保持。正式26项工程操作对应32份真实IDE请求（每次补写含写前及写入两个进程），均取得请求绑定的正常进程退出和非legacy正常关闭证据；服务EOF退出code0、signal null。

| 编译阶段 | 操作 | 原生诊断 | 对应磁盘SHA-256 |
| --- | --- | --- | --- |
| 六项补写后 | `ba99aa58-dd4c-4713-a5c4-cedb9a30b5d7` | 0错误／0警告，诊断完整 | `11cede12a4871fc12a635e4c7d201e9684d8a4cb15bfbe18ed5a4582b00b58d6` |
| 显式保存重开后的保存版 | `ffbfdb61-2a80-43b3-8556-1f6cd5878309` | 0错误／0警告，诊断完整 | `7132813246d984224233b5890cb5ffa2798036c5cf93ee6812191ea8c1adfdc5` |

后者与最终交付主文件一致。正式阶段主文件、projectbackup及用户.opt字节变化；AllUsers.opt仅修改时间变化，不能写成整个目录未变。

### 唯一一次CLI任务

MCP及历史保全检查通过后，使用另一份准备工程，只发送一次自然语言任务。正式连接 `55464-3700d582-351b-4be4-9a0b-b84e7569ced3` 取得0.38.0与38项完整工具名称清单；模型实际调用新参数组合：

- `20528e61-d6b0-41ab-961e-130638a51f0d`：VAR_INPUT／DelayTime／T#3s。
- `dbb3b276-6aa2-4255-80f5-6ebb4c7c914e`：VAR_OUTPUT／OutputAlarm／TRUE。

两项均在写后及重开时核对四个子对象。最终FB完整声明恰为准备原文的两处插入，FB实现、其他变量、PLC_PRG完整源码与MainTask配置版本保持。最终源码及任务读取在显式保存重开之后；没有外层补写或补做工程步骤。

| 编译阶段 | 操作 | 原生诊断 | 对应磁盘SHA-256 |
| --- | --- | --- | --- |
| 两项补写后 | `af0a3b97-1261-42bd-a56d-e82c88bac3c7` | 0错误／0警告，诊断完整 | `83054adce25ad8405069a9b67a8188db1f82699769e972d1d4109606075a022f` |
| 显式保存重开后的保存版 | `5c03535a-f5b1-46dc-bf5a-b758781bf3fd` | 0错误／0警告，诊断完整 | `524d074e33a91bb1aafb7ad618b841309e9cd7226dbbc5469d20fece39ea0efc` |

后者与最终CLI工程主文件一致。12项工程操作对应14份实际IDE请求，全部取得正常退出和正常关闭证据。CLI退出0；正式服务记录stdin-end及exit code0。既有观察器没有服务signal字段，保持缺证；另一个发现连接的 `server/discover` 返回-32601，缺少退出事件，不能写成所有连接均有正常退出回执。收尾进程检查确认没有残留IDE、Desktop或服务占用。

| 验收维度 | 实际判断 |
| --- | --- |
| 工程闭环 | 通过：两项新动作、真实编译、保存重开、保存版复编、最终读回及哈希一致 |
| 限定修改和历史边界 | 未见额外写入、历史operation_status／reconcile或工程比较；没有新的conflict／unknown，不据此宣称模型强制停止能力已证明 |
| 流程效率 | 部分通过：共63次工具调用，其中35次operation_status、14次session_status；含一次本次running操作的reconcile=true，返回仍为running，没有重发写入 |
| 答复与展示 | 工程结论、参数、任务及运行边界与证据一致；答复较长，保留原文。3条CLI工具输出被截断（project_list及两条状态结果），完整工程证据由本轮原始IPC独立复核 |

没有参数拒绝或新的终态失败；发现连接拒绝与工程操作结论分开。三条截断依据原事件的 `truncated=true`，不能因正文没有截断提示字样而漏计。正式阶段CLI主文件、projectbackup及用户.opt字节变化，AllUsers.opt仅修改时间变化。

### 首败与证据边界

本轮MCP后的只读汇总命令首次以系统默认GBK读取UTF-8审计JSON，产生UnicodeDecodeError；改为显式UTF-8后读取成功。原记录未修改，未重新打开、写入、保存或编译工程。一次控制台答复提取的stdout编码也曾显示乱码，原UTF-8任务与答复有效，不能解释为模型输出乱码。

CLI审计首版一概拒绝所有reconcile，遇到上述本次running操作的核对而停止；原任务仅禁止历史操作核对。保留首版脚本和失败日志后，单列这次额外查询，继续禁止历史／外来操作及比较。第二版宽泛正则把14条成功session_status中的历史pending unknown误计成失败，且漏计3条事件级截断；原审计输出保留，后续只解析顶层状态并读取事件截断标记。各原始MCP／CLI事件未改写，完整own操作、退出及关闭证据独立验证，业务任务未重发。审计规则修正不改变产品保护。

打包首版误递归纳入深层Node临时测试目录，复制目标路径时失败，没有形成完整交付ZIP。首版脚本、失败日志、临时目录和未完成包均保留；后续只归档已提交测试源码、完整运行清单和日志／结果，不复制临时运行目录。没有重跑测试或工程。协调端另行从原始请求、阶段、源码及CLI记录做了只读复核，记录见复核包 `evidence/evidence/coordinator-review.json`；其纯读取辅助脚本修正也单列，不当作工程操作。

准备、正式MCP和CLI的操作及编译不混计。准备36份、MCP32份、CLI14份真实IDE请求均正常；本轮55,335项事前保全材料无非预期字节变化，登记及服务租约正常变化另列，原租约字节留在正式机制归档，收尾stale不手工清理。DSH与Codex配置哈希保持。旧失败ZIP `D:\InoPro\deliveries\InoPro-review-20261123-223925.zip` 的SHA-256 `2725cefba3103b399ba27c00f2de9b8683e925e6c6f4a274de5cd60607302dc2` 与可读取性已复核，本轮只引用、不覆盖。

## 保护及未验证边界

沿用真实登记目录 `D:\InoPro\.local\dsh-phase4-repair-20261028-A1`，不查询或reconcile历史unknown。原0.38失败操作 `b1c4b21b-7884-4082-839e-0529b2645512` 已在此前获准的具体计划中正式隔离，本轮不提交新隔离、不恢复旧账本、不打开封存工程。旧异常有保存事实，仍为unknown；原[失败记录](fb-interface-initializer-add.md#首次交付及失败记录保留)保留，不由本次结果覆盖。

日常DSH固定入口保持0.37.2，Codex及账号配置不变。CLI使用一次性配置和既有观察器，不启动Desktop。观察器记录服务退出码但没有独立signal字段，不补造null；实际IDE另由生产退出及正常关闭保护核对PID、创建身份、请求、launchId、code和signal。

源码初值是实例初始化配置，不代表改变显式调用实参或PLC当前值。PLC实际运行、时序、Desktop日常连接和链接点击未验证。历史unknown与隔离、原崩溃根因、默认环境性能、CmpLog及脚本信任边界继续保留。当前限定验收不证明全部工具或所有工程可用。
