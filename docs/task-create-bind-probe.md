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

## 复核边界

夹具来自已归档的 AM610 最小工程，单独提取到 D 盘新目录。添加 `PRG_S8Probe` 后先读回原有 `MainTask → PLC_PRG` 并编译基线，再创建 `ProbeTask` 和添加调用。保存后由第二个 IDE 进程独立打开、读回和离线编译，同一磁盘版本用 SHA-256 核对。50 ms 是配置周期，实际调度仍待运行观测。删除、替换和重排调用留给后续独立探测。

探测启动器取得既有服务与工程文件租约，并核对登记和隔离。意图与原生步骤分别写入独立记录，终态不确定时查询原启动和结果文件，不重放写入。无 DSH 模型任务或 PLC 操作。
