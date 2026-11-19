# 替换周期任务中的一条 PROGRAM 调用

> 打开指定 AM610 工程，把 MainTask 中调用 PRG_ReplaceMe 的那一条改为调用已有的 PRG_Replacement。保留该行备注和其他调用顺序，编译并保存重开核对。

0.33.0 候选版已交付 `task_call_replace`。支持 InoProShop 1.9.1.6 和 AM610 设备描述 `4102 / 10f4 0002 / 3.5.11.11` 的普通周期任务。新旧目标须为同一 Application 下已有、唯一的根级 ST PROGRAM。原调用须唯一且无前缀，新目标尚未出现在该任务中。带限定前缀的同名行也会阻止替换。

Agent 从 `task_inspect` 取目标任务、零基位置与原始名称和备注、配置版本及磁盘哈希，从 `project_structure` 取任务父配置节点，从 `object_read` 取新旧 PROGRAM 定义的身份与源码哈希。用户只需给出工程、任务、旧程序和新程序名。桥接在写入句柄内重新检查原生 ST 标识、完整有序列表、支持的源码快照和磁盘版本。空备注、中文和字面文本 “None” 均按原文保留。

当 task_inspect 因非空备注将绑定列为 unresolved 时，保留该读数。仅当 coverageComplete、callsComplete 均为 true、枚举和解析读取失败为空，而且完整 raw 行名称唯一匹配、唯一候选的身份与同一 Application 根级 PROGRAM 的 object_read 一致时，可交由 task_call_replace 在原生句柄内精确复核。最终核对同时使用重开后的 programReads、原始行和对应定义；歧义或其他证据缺失时停止。

写前保留检查点，只派发一次公开的 `replace(index, name, comment)`。写后及保存关闭重开后均通过原生调用名称与唯一根级定义核实绑定，并检查原定义仍存在，其余调用、可读任务配置及受支持源码相同。返回 `before`、`replacedCall`、`afterReplace`、`after`、两阶段的 PROGRAM 证据及保存文件哈希。旧编译失效，新的编译结果须对应保存文件的磁盘哈希和任务配置版本。

版本或原始行冲突即停止。运行中查询原操作；已派发且结果无法确认时保留检查点并冻结后续写入。配置顺序和周期只反映离线工程。本机单条移除仍受原生接口缺陷阻断。重排所需的公开行级移动入口尚未找到，实际调度也未观测。[重排探测](task-call-reorder-probe.md)

[原生替换探测](task-call-replace-probe.md) · [单条移除的限制](task-call-remove-diagnosis.md) · [真实工程与测试归属](task-call-replace-acceptance.md)
