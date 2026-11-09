# 已有周期任务的周期与优先级（S1）

0.18.0 候选版新增 `task_config_update`，共二十三项工具；原二十二项输入保持兼容、登记仍为 v2。本功能分支尚未合并 main。只编辑明确定位的已有 Cyclic 任务，不创建或删除任务，不改变类型、程序调用、看门狗或 CPU 绑定。新建工程的固定 MainTask 初始化仍由 [project_create](project-create.md) 负责。

## 调用与单位

用户说明工程路径、任务名称及修改目标即可，例如“将现有 MainTask 改为10毫秒、优先级12，保留其他配置”。Agent 在内部查询工程、Application 和 taskId；不要求用户填写内部身份或版本。

1. 直接打开指定文件，用只读 `task_inspect` 读取实际任务及字段。原 `version` 含义不变；兼容新增 `configurationVersion`，方案 `task-configuration-v1`，绑定工程、应用、原生任务身份/路径、原始字段、顺序调用和读取缺口。它与 ST 文本 snapshot、磁盘 diskHash 是不同证据。
2. `task_config_update` 需要 requestId、projectId、applicationId、taskId、expectedTaskVersion（上述 configurationVersion）、expectedDiskHash（上述 diskHash）。targetKind 仅 application。至少指定 intervalMs、priority 之一，省略字段保持原值；不接收其他配置字段。
3. intervalMs 是整数毫秒，首版 1..60000；priority 为整数 0..31，0 是实际值。服务显式生成原生字符串 `t#10ms`、`12`，不会将10毫秒作为10微秒。只支持原配置也在此范围、周期文本为显式十进制整数或 `t#整数ms`、且 interval_unit 明确为 ms 的任务。范围是本版经验证的产品边界，不是 IDE 或 PLC 的能力极限。
4. 校验实际任务配置版本及磁盘版本后，保留检查点，按 interval、priority 顺序仅设置改变的授权字段，逐项记录、读回、保存关闭重开。原值请求返回 noOp，不执行 setter、保存或重开。部分失败保留已尝试/完成动作和实际可读状态，unknown 停止后续写入，不承诺跨字段原子事务或自动回滚。
5. 任务变化使旧编译失效，即使 ST snapshot 不变。真实新编译同时绑定任务配置版本与磁盘版本；后续 project_save 核对保存重开后的任务版本，buildApplicable 只在最终版本仍相符时为 true，否则需正常复编。最终再 task_inspect 读回目标及实际可读保留字段。

参数形状（内部引用由 Agent 查询，示例不是可直接提交的真实请求）：

```json
{
  "requestId": "unique-business-request",
  "projectId": "<实际工程GUID>",
  "applicationId": "<实际Application GUID>",
  "taskId": "<实际任务GUID>",
  "expectedTaskVersion": "<configurationVersion>",
  "expectedDiskHash": "<diskHash>",
  "intervalMs": 10,
  "priority": 12
}
```

## 原生依据和保护

本机 InoProShop 1.9.1.6 的已有任务对象 `.interval` 和 `.priority` 实际接受字符串；整数 priority setter 被原生拒绝，首败保留。独立探测核对原文20毫秒/优先级1，设置10毫秒/12后保存重开一致，真实编译0错误/0警告；1毫秒/0与60000毫秒/31组合也编译通过。原生 setter 本身接受了 `-1`、`32` 字符串，不能据此认定有效，因此服务在原生写入前明确拒绝。正常旧样例实际返回 interval=`20`、interval_unit=`ms`，新建预设返回`t#20ms`/`ms`；两种原文分开保留，其他单位或表达式不猜测。没有取得独立只读 getter；原生打开默认不允许只读，并在 setter 前检查文件只读属性及写权限，不修改权限或执行策略。

检查点、去重、排他锁、直接文件保护、持久化操作及隔离规则沿用原机制；running 只查询原操作。旧版本、身份歧义、非周期、单位未知、字段/调用列表不完整、只读、磁盘变化均拒绝。unknown、冲突或冻结时保留现场，不删锁、不换目录、不重放或自动恢复隔离工程。正常旧请求返回原操作；只读 `task_inspect`、[按需比较](post-change-baseline-compare.md)的任务匹配及比较范围保持。

默认依照 [日常修改流程](getting-started.md#日常修改闭环)，不采集比较基线或自动调用 project_compare。内部任务读回及完整性保护不是新增全工程比较。

## 验证归属

原生探测、自动化替身、真实 MCP 与 DSH CLI 分别记录；完整结果在本轮收尾后填入此节。自动化异常不会注入日常工程；DSH CLI 需在开发端通过后，加载固定候选构建并由模型完成一次新工程任务。旧固定 DSH/Codex 入口不会自动获得新工具，单客户端正常移交规则保持。

本能力不证明任务实际调度、扫描耗时、报警计时、PLC运行、设备/I/O完整配置、桌面交互或链接点击。历史 unknown、11/12回答质量、CmpLog及脚本信任限制保留；新的零警告探测不消除旧警告。
