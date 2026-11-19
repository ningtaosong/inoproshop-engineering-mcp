# S8a 第一项：原生任务创建及 PROGRAM 绑定

本分支以 main `919b0cffc8b5921a33e6e6e85180fc2b2858d16d` 为基线，在独立 AM610 夹具上验证普通周期任务与指定 ST `PROGRAM` 的配置关系。探测脚本位于 [scripts/probes](../scripts/probes)，产品保持 0.30.0、33 项工具。

## 接口依据

| 目标 | 已有代码或接口说明 | 实证方式 |
| --- | --- | --- |
| 创建任务 | 固定的 [AM610 工程创建](../bridge/project_create.py) 初始化预设已有的 MainTask。厂商说明列出任务配置对象的 `create_task(name)`。 | 检查精确 Application 根任务配置对象，记录可调用性、实际调用及返回的任务 GUID。 |
| 设置周期 | [task_config_update](task-config.md) 已验证已有 Cyclic 任务的原生字符串周期 setter。 | 用同 Application 中 MainTask 的 Cyclic 枚举值设置新任务，写入 `t#50ms`，读回类型、周期和单位。 |
| 添加 PROGRAM 调用 | 厂商说明列出 `task.pous.add(pou_name, comment)`，目标以名称传入。 | 在同一 Application 内确认唯一根 ST PROGRAM，再在新任务的原生调用集合添加一次。 |
| 读取目标和顺序 | [task_inspect](task-config.md) 保留 `len(task.pous)` 与 `task.pous[i]` 读到的顺序和原始记录，按同一 Application 的唯一 PROGRAM 解析。 | 保存原生调用元组，随后由新的 IDE 进程解析保存文件并核对目标、顺序、Application 和实际 PROGRAM GUID。该 GUID 来自 PROGRAM 对象读回。 |

本机 InoProShop 1.9.1.6 随附的 `ScriptEngine.chm` 提取了 1,618 个 HTML 页面，其中以 `ScriptPouObjectCollection`、`create_task(`、`kind_of_task` 检索未找到任务扩展说明。通用参考用来定位候选接口，本机可用性以真实夹具内的接口和调用记录为准。[CODESYS Scripting 任务配置参考](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptTaskConfigObject.html)

## 本机探测结果

2026-11-19 在 InoProShop 1.9.1.6、ScriptEngine 插件 3.5.11.10 完成。本机发现了 `create_task(self, name)`、`pous.add(self, pou_name, comment)` 和用于顺序读回的 `len(pous)`、`pous[index]`。

| 项目 | 结论 | 关键证据 |
| --- | --- | --- |
| 任务创建 | 通过 | `Task Configuration.create_task('ProbeTask')` 返回任务 `f0ea9209-5ee8-4a78-8773-fc55542a4d8c`。读回 `Cyclic`、`t#50ms`、单位 `ms`。 |
| PROGRAM 绑定 | 通过 | `pous.add('PRG_S8Probe', '')` 后原生顺序 0 为 `['PRG_S8Probe', '']`。它在 Application `e88ddc35-95de-4cd2-886e-100ccb300ecf` 内唯一对应 ST PROGRAM `4a920741-1478-4970-b0fb-5e0bd4beec90`。 |
| 保存、关闭、独立重开 | 通过 | 写入进程 60404 关闭后，由进程 6268 重新读取保存文件，任务字段、两个 PROGRAM 身份、原始调用顺序和配置版本一致。原 `MainTask → PLC_PRG` 的可读配置一致。 |
| 保存版编译 | 通过 | 基线、保存前、保存版三次编译均为 0 错误、0 警告。保存版编译对应 SHA-256 `feab3bea49b93e9786eec05027df45717896076933f318969a4b3babd9d4f70a`，关闭后复核一致。 |

首次尝试在准备阶段误把 `MainTask` 下的同名调用节点纳入 PROGRAM 身份查找，预检停止，未创建 PROGRAM 或任务、未添加调用、未保存。首次 IDE 正常关闭未确认，原夹具主文件保持种子哈希，证据和标记保留。确认相关进程已退出后修正查找条件，从原归档提取独立新夹具，再按既有租约机制执行首次原生创建及绑定。

## 复核边界

夹具来自已归档的 AM610 最小工程，单独提取到 D 盘新目录。添加 `PRG_S8Probe` 后先读回原有 `MainTask → PLC_PRG` 并编译基线，再创建 `ProbeTask` 和添加调用。保存后由第二个 IDE 进程独立打开、读回和离线编译，同一磁盘版本用 SHA-256 核对。50 ms 是配置周期，实际调度仍待运行观测。删除、替换和重排调用留给后续独立探测。

探测启动器取得既有服务与工程文件租约，并核对登记和隔离。意图与原生步骤分别写入独立记录，终态不确定时查询原启动和结果文件，不重放写入。无 DSH 模型任务或 PLC 操作。
