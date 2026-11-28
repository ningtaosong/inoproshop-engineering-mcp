> 历史方案：本页属于10febc56的手动接纳候选。随后用户改为每次实际修改自动保存；未交付的接纳工具已从后续候选撤出，见[新合同](resident-autosave.md)。以下计数及结论保留原时点，不代表当前工具清单。

# 用户确认保存后的同会话继续操作（0.42.0 候选）

路线对应 `agent.md` 第6项。本分支从 `7bcca8ed9e1ea5ed23c0cebaed8e21b87253400b` 继续，新增一个产品工具 `project_accept_saved_version`，共39项；此前38项输入、输出 Schema 原样保持。已实现并进行离线验证，尚未真实 MCP／DSH 验收，未合并、部署或关闭当前真实实例。main 仍为 `a536de33457ccec662bce7ab53e78d281f51ea80`，日常 DSH 仍为0.38.0。

## 使用合同

用户在上下文明确告知已保存当前工程并继续，例如“已保存，请继续把延时改为8秒”，即可表达本次授权；不要求逐字口令、再次确认、内部 GUID 或哈希。Agent 从本会话最近成功结果／`session_status` 取得工程、Application 和 `residentVersion`，先调用新工具，再读回并完成另行授权的修改。不能先用普通 `object_read` 跨过磁盘变化；那条旧路径仍会停止会话。没有明确保存声明时，不得自行填 `userConfirmedSaved=true`。

输入为 `requestId`、`projectId`、`applicationId`、`expectedResidentVersion`、`userConfirmedSaved:true`。仅适用于同一服务拥有的健康、空闲 resident 会话；不用于 batch、其他 IDE、重接、unknown 恢复或当前冻结实例。相同请求返回原操作；复用 requestId 改参数仍拒绝。

接纳是用户授权的基线更新，**不是已取得原生保存事件或整工程内存／磁盘等价证明**。回执明确 `basis=user-confirmed`、`nativeSaveProven=false`、`fullDiskMemoryEquivalenceProven=false`。工具不调用保存、编译、关闭、重开或退出。已有内存编译记录保留原归属，不能升级为保存文件编译通过。

## 核对及证据

1. 服务确认活动登记、Application、上次成功版本、排他状态和原路径锁。源锁绑定规范路径及服务身份，不绑定文件 ID；本轮保留并复查锁，不重写、释放重取或修改租约机制。
2. 通道绑定既有 launch、PID创建身份、原句柄及上次文件身份/哈希。新磁盘观察要求规范路径、普通单链接文件、稳定文件身份/大小/时间/哈希；外部替换、别名、其他登记项或采集期间变化均须核对。已完成保存导致同路径 fileId 改变只在此显式入口候选中允许；普通请求规则不变。
3. 同一主线程两次公开只读采集。每次原生句柄、`projects.primary/all` 归属验证及 `project.dirty` 前后均必须成立，dirty 必须是布尔 false。原始读数不改写。完整受支持状态用已有比较规则核对，保留源码、任务内调用、直接库和未知字段；只允许已验证的后台 library 打开容器变化，并分别核实归属。非库第二工程、句柄改变、覆盖缺口或读取异常均停止。
4. 独立发布 `saved-read-first/second.json`、`saved-candidate.json`、`saved-acceptance.json`；Node 再独立核对请求、快照、dirty、旧句柄和回执。通道在正常完成、原进程仍存活、磁盘再核对后发布 `saved-channel-accepted.json`。服务在返回后及登记提交前再次核对磁盘、登记、别名和锁，保留 `saved-registration-before/after/committed.json`。
5. 新 `baselineId` 进入 residentVersion。即使保存字节没变，也不能继续使用旧页、旧修改版本或旧编译适用性。后续读取、修改、内存编译沿用新代次。登记 `sourceHash` 仍是首次登记时的来源指纹；旧 intent、旧请求/结果、完成时间和检查点保持。

拒绝、两次读取之间变化、回执/登记发布失败、进程异常及缺证分别保留首次错误。无法确认时冻结后续派发，不自动保存、关闭、回滚或换实例。拒绝前已正常用户保存的事实不会被写成“文件没有变化”。受支持快照仍不覆盖完整设备/I/O配置、磁盘保存者身份或运行行为。

## 离线验证与首败

均为替身或独立运行时测试，不启动 IDE、模型或工程请求。详细日志随复核包保留，测试组不相加。

- Node 常驻/独立验证/历史证明回归：初轮380/380；补齐旧句柄锚点及准备阻断用例后的最终记录为381/381。
- Node 隔离/退出/未决结果回归：初轮153/154；失败是工具总数断言仍写38，改为新增后39，原行为断言保留，最终154/154。
- CPython 相关集合150项，146通过、4跳过；新增接纳20项单独通过。
- 同版 IronPython 2.7.7.0：DLL SHA-256 `dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`，完整源码编译及实际固定加载器通过；core37、build16、library37、scalar9、saved20分别通过。安装版旧unittest的默认 `runTest` 构造首败保留，测试夹具已显式指定真实方法后执行20项，未略过或改写 passed。首次在 PowerShell7/.NET宿主出现 encoding0 异常；最终使用既有 Windows PowerShell/.NET Framework 入口，无 Bypass 或策略修改。
- 新增服务定向首轮27/28：故意篡改替身源锁后，收尾正确拒绝释放，原测试未期待该拒绝；修正测试保留锁，不调整产品锁规则。
- 默认 TEMP 原始回归只完成首个新增场景（约119.6秒）后正常中断测试，未取得完整集结果。最终离线集使用独立 TEMP，未清理真实历史目录或改200ms阈值；默认环境历史性能问题不改判。
- 开发中曾有新增工具缺少输出 payload 定义的 TypeScript首败（工具返回TS2741，完整stdout未单独归档，不能以修补后的build-first日志充当该次首败），已补定义后构建/类型检查通过。原38项契约通过固定旧产品 `cee47d9` 的逐项输入/输出哈希核对；夹具注明 `dist/contracts.js` 及固定构建来源，其 SHA-256 为 `a02f040d926b2420c5f643f0f417341b196a7172d79628922f64c5435037d7a5`，并非Git的 `src/contracts.ts` 文件哈希。

## 明确保留的阻断与下一步

当前 `1fdf17a7-699b-4f08-a65e-854c18aa0505` 仍为 unknown，原IDE、服务、控制器保持；本工具不能在它上面热加载、恢复或继续。旧 `21483495-6efb-44ba-af19-2c1865548a9c` 及更早记录不变。

两个边界已做只读代码核对和离线拒绝用例：

- `verifyClosedResident` 仍要求旧 intent 及全部历史请求对应同一原文件身份/哈希。新接纳改变文件后，同会话可继续，但正常关闭后跨服务新打开仍被拒绝；本轮不改旧文件、旧 intent 或历史证明规则。
- 再次首读失败所带的 `resident-new-open-precheck.json` 构成第8项证据，当前 early-proof 路径精确覆盖检查仍拒绝。离线用例仅证明该阻断，不把模拟 precheck 当作真实前驱链。真实复验前须独立核实当前 precheck 和合法前驱链；不能删文件、任意放行额外证据或换目录绕过。

本轮提交离线实现供复核。真实阶段须先明确当前实例的正常移交授权、保护条件及上述阻断，不能把“问题修好”解释为对旧unknown强制接管。随后在获准的健康自有会话中验证：读取→限定修改→用户实际保存并明确告知→接纳一次→重新读取→下一项明确修改，保持同一PID/创建身份/句柄，0工具保存/关闭；单独记录真实保存前后文件及附属变化。模型流程另行限定一次任务，不能用离线结果替代。

历史 unknown、隔离、锁、旧账本、默认性能、崩溃根因、CmpLog、脚本信任、Desktop及PLC运行限制继续保留。

返回 [README](../README.md) · [路线](../agent.md) · [既有宿主失败](resident-save-host-policy.md) · [原连续会话说明](resident-mcp-session.md)。
