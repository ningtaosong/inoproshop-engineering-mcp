# 创建周期任务并绑定一个已有 PROGRAM

0.31.0 候选版新增 `task_create`，总计 34 项工具。原生接口依据为探测提交 `dec0d2e5ebbde4df8aa61a8f90ec4c55be80f937`，其中验证了 AM610 任务工厂、50 ms 设置、实际原生调用以及独立进程保存重开读回。

> 在指定 AM610 工程中新建一个 50 ms 周期任务 `ProbeTask`，让它调用已有程序 `PRG_S8Probe`，编译并保存重开核对。

## 用法与边界

1. 用户提供工程路径、任务名、整数毫秒周期及已有程序名称。Agent 用 `project_open` 确认活动工程及 Application，用 `task_inspect` 取得 `configurationVersion` 和 `diskHash`。通过 `project_structure` 读取已有原生 task 的父配置节点 GUID，遇到分页时按返回的 `nextOffset` 及同一 `version` 继续。再用 `object_list`／`object_read` 定位同一 Application 的根级 ST PROGRAM 定义。任务下的同名调用节点属于不同原生类型。
2. `task_create` 接收 `requestId`、`projectId`、`applicationId`、`taskConfigurationId`、`name`、`intervalMs`、`programId`、`expectedProgramHash`、`expectedTaskVersion` 和 `expectedDiskHash`。版本分别取 PROGRAM 的 `contentHash` 和 `task_inspect` 的 `configurationVersion`／`diskHash`。内部标识由 Agent 查取。
3. 首版限设备描述 4102／10f4 0002／3.5.11.11 的 AM610 Application、一个普通 Cyclic 任务、一个已存在且唯一的根级 ST PROGRAM。任务名称为 1–63 字符的普通 ASCII 标识符，周期为 1..60000 整数毫秒。新任务的优先级及看门狗等由原生工厂取默认值，结果保留可读配置。已有周期任务的周期及优先级仍用 [task_config_update](task-config.md)。
4. 成功后运行 `project_build`，按 `project_save` 的保存重开结果判断已编译文件是否适用，必要时复编，再用 `task_inspect` 读回新任务和原调用顺序。50 ms 是配置周期，实际调度待运行观测。这个流程无需 `project_compare` 或连接 PLC。

## 核对与故障处理

原生句柄内复核设备、任务配置节点及 PROGRAM GUID、类型、源码版本、可读字段和调用清单。创建前复制检查点。按任务工厂、周期设置和添加调用分别记录进度，保留原任务。原生调用行包含名称与注释，绑定结果的 PROGRAM GUID 来自同一 Application 内实际且唯一的 PROGRAM 定义。

创建、配置及添加调用后读回，成功才执行保存关闭重开，再核对写后配置、实际磁盘哈希和退出后的文件。旧编译结果随任务配置版本失效。新增任务不修改任何既有任务调用。删除、替换及重排不在本轮范围。

重名、证据不完整或变更前版本冲突时停止。调用已派发且结果未确认时保留阶段记录、检查点及原异常，服务按 `unknown` 冻结后续写入。查询原操作；同一 `requestId` 返回原结果。部分失败不会触发删除、重做或恢复性保存。

## 候选版验收

受验产品为 `7d915e66f54172e42013c39ce247408bce526c14`。2026-11-19 在两份独立 AM610 工程中，先准备已有 ST PROGRAM `PRG_S8Probe`，核对保留 `MainTask → PLC_PRG`。

| 验收入口 | 实际结果 |
| --- | --- |
| 开发端真实 MCP | `task_create` 创建 `ProbeTask`，50 ms，原生调用顺序 0 指向同一 Application 的 `PRG_S8Probe`。保存重开、原任务配置和顺序一致。真实编译及保存版复编均为 0 错误、0 警告。 |
| 一次 DSH CLI 自然语言任务 | 实际获取 34 项工具并调用 `task_create` 一次。创建及保存重开通过，两次真实编译均为 0 错误、0 警告。CLI 退出后另行只读打开，确认绑定、原任务及保存版编译哈希一致。 |
| 自动化 | 构建、类型、指令大小、原 33 项 Schema 对照通过。Node 定向 44/44，完整回归 476/476；Python 完整回归 218/218。绑定未确认、重复请求及写前冲突由替身验证。 |

真实驱动首轮在未翻完整结构清单时停止。补齐翻页后，桥接在打开前拒绝了未列入原生提示范围的命令，两个失败均未执行创建或绑定；修齐固定阶段白名单后通过。复核包保留原始停止记录和后续结果。日常 0.30.0 固定入口保留，桌面进程已恢复；恢复后的服务子进程、握手和工具接收未取证。
