# 安装、接入与日常离线试用

适用于 **InoProShop MCP 0.35.0 候选版、37 项工具**。确认客户端实际加载版本后，给出工程路径和需求；内部身份、哈希和操作引用由 Agent 获取。

0.34.3 时已完成[一次 DSH CLI 最小模型接入](offline-trial-readiness-0343.md)：同一正式连接取得 37 项工具，模型实际调用一次 environment_inspect，返回 0.34.3。本次未打开工程，不代表 Desktop 握手、指令全文进入模型上下文、桌面交互或链接点击通过。已有工程闭环见 [0.34.2 双路报警](offline-alarm-acceptance-0342.md)与 [0.34.3 追加／替换复验](task-program-inventory-order.md)，各自保留原归属。

## 先确认环境

- Windows，安装 **InoProShop 1.9.1.6**、对应 Profile 和所需设备描述／库。已验 AM610 描述为 4102 / 10f4 0002 / 3.5.11.11，这是设备描述版本，不是现场固件。
- Node.js 22 或以上；0.34.3 接入时实读 24.15.0。仓库不附带厂商软件或设备包。
- 使用支持工具调用的 MCP 客户端。本机 DSH 文件版本为 0.2.1-rc.5；CLI 使用已有账号的 deepseek-account / deepseek-flash、headless 预设。
- 一个登记目录同一时刻只让一个工程服务占用。已有部署沿用原目录，不换空目录或复制故障工程绕过 unknown／隔离。
- 确需移交时先保留未发送内容，使用[正常移交步骤](startup-handoff.md#正常移交步骤与停止条件)。无法确认安全退出就停止，不强杀、不删锁、不修改执行策略。

0.34.3 接入的环境查询确认 IDE 和 Profile 存在，但能力审计仍返回“未验证：当前可执行文件/Profile 与已有证据未匹配”。安装存在不能证明工程能力已在本次重验，这项返回也不覆盖历史工程验收。

## 接入 DSH

1. 使用已核验的固定构建，确认 Node、dist/server.js 和工作目录存在，不指向正在变化的开发目录。
2. 备份现有配置，只调整 InoProShop 条目，不覆盖账号或其他插件。参考[普通 MCP 模板](../config/dsh.example.patch.yml)及[headless 增量模板](../config/dsh.headless-trial.example.patch.yml)。模板没有凭证。
3. maxInstructionBytes: 65536 放在 MCP 客户端 config 层，与 serverName、transport 同级。0.35.0 受验固定构建含标题为 **63,474 字节**；换构建须重新核对，不截断指令或盲目提高上限。
4. CLI 最终合成配置中 credentials、authorization、deepseek-account 必须启用，模型保持原账号配置；只启用一个目标 MCP 条目。Desktop 已登录不等于 headless 自动可用，不把凭证写入模板。
5. 从连接／会话记录确认实际版本和完整工具清单，再按需要进行一次只读查询。不要让模型凭记忆列举工具；启动成功或退出码 0 单独不算接通。

0.34.3 原入口（本次保留为回退）和沿用的登记目录：

~~~text
D:\InoPro-Fixed\0.34.3-0a927d857681\dist\server.js
D:\InoPro\.local\dsh-phase4-repair-20261028-A1
~~~

该次 0.34.3 临时 CLI 使用上述固定构建及登记目录，日常配置当时未改，0.34.2 回退保留。当前 0.35.0 新增已有聚合缺失成员初始化，见[范围与示例](variable-edit.md)及[真实 MCP／一次 CLI 验收](aggregate-member-initializer-add.md)。本次 main 合并后的入口和独立连接检查见[收尾说明](aggregate-member-0350-merge.md)及本地复核包，不把旧路径当作新版入口。Desktop 欢迎页未处理，最终日常握手仍未验证。其他电脑填写自己的已核实路径，不原样套用本机目录。

先准备并核对私有 patch，安装版 CLI 的一次标准输入调用格式如下；不要重复发送同一业务任务：

~~~powershell
$OutputEncoding = [Text.UTF8Encoding]::new($false)
Get-Content -Raw -Encoding UTF8 .\task.txt | & 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' --profile headless --patch .\headless-private.yml --json -
~~~

首次认证、初始化、清单获取或模型调用失败时，保留记录并停止，区分失败阶段，不连续试配置。

### 指令大小与连接失败

maxInstructionBytes 属于 DSH MCP 客户端。已验口径为：正文去尾空白，加“### MCP server: inoproshop”标题与空行，再计 UTF-8 字节。npm run check:instructions 是静态检查，不启动 IDE；仍须核对客户端合成配置。历史断连资料见[旧正文](getting-started-history.md#指令大小与连接失败)。

## Codex 与 DSH 分开核对

本机 codex-direct-edit-validation 的项目级配置仍启用历史 **0.16.0／21 工具**入口；旧 0.14.0、0.15.0 条目停用。当前全局 config.toml 没有 InoProShop 条目。本轮只读核对配置，没有启动或升级 Codex，未取得当前会话握手。DSH 的 37 项工具不能当作 Codex 已加载能力。见 [Codex 历史接入](codex-integration.md)。

## 工程与副本

默认指定哪个 .project，就直接修改并保存回哪个文件。原文件须正常且未隔离；新建须指定尚不存在的路径。内部检查点是保护证据，不是另一份业务交付文件，也不是自动回滚承诺。

默认只读取完成需求所需的对象，不通读全工程、不创建业务副本、不采集比较基线、不调用 project_compare。**用户明确要求比较时**才进入[比较流程](post-change-baseline-compare.md)。

## 日常修改闭环

1. 提供完整路径、对象或参数、目标值和保留项。
2. Agent 必要读取、定位唯一目标、核对原版本；条件不符即报告，不按名字猜。
3. 执行授权修改并读回；以真实编译诊断判断成功，不能只看工具状态或模型答复。
4. 保存、正常关闭重开并核对源码、配置和绑定；保存改变版本时取得必要的保存版编译证据。
5. 报告实际错误／警告、影响、最终路径和未验证部分。源码初值、任务周期都是离线配置，不是实测计时、调度或运行值。

只读任务不附加修改、编译或保存。running 查询原操作，不重复写入。

## 首次试用

下面三个示例**本轮没有执行**。先替换路径、对象名和原值；第一个只读，后两个明确授权写入。

**只读解释变量或初值：**

> 只读打开 D:\PLC\Alarm.project，解释 GVL_AlarmConfig.Delay1 的声明类型和源码显式初值，核对相关原文并说明是否读到了运行值。只读取必要对象，不修改、编译、保存或连接 PLC。

## 常用任务示例

**修改一个明确参数：**

> 直接处理 D:\PLC\Alarm.project，只把根 GVL_AlarmConfig 中 TIME 变量 Delay1 的显式初值从 T#7s 改为 T#9s；名称、类型或原值不符就停止。保留其他源码和任务，真实编译，保存回原路径、关闭重开并读回，必要时对保存版复编。不要创建业务副本或进行前后比较。出现 conflict、unknown 或冻结时停止后续写入，保留现场。

**新建最小 AM610 报警工程：**

> 在尚不存在的 D:\PLC\AM610_Alarm_Trial.project 原生新建最小 AM610 离线工程。创建一个使用自身 TON 计时器的延时报警功能块，延时输入源码初值 T#3s；PLC_PRG 用一个实例和全局 T#5s 参数调用它。故障持续到时后锁存报警，故障提前消失清零计时；复位或失能清除报警和计时，复位持续期间不计时。保留 MainTask 调用 PLC_PRG，周期 20 ms，不接实际 I/O。真实编译并保存到指定路径，关闭重开、必要保存版复编及最终读回。编译失败或出现 conflict、unknown、冻结时停止，不循环改写重试。不建立比较基线、不生成业务副本、不连接 PLC；只报告离线配置和实际编译结果。

### 只读检查库的使用情况

使用 library_inspect、project_search 和必要源码读回收集证据。命中先核对上下文；零命中报告覆盖缺口。词元检索不是编译器交叉引用，不能推出“可安全删除”。见[详细说明](library-reference-remove-probe.md)。

## 已提供与未提供的范围

| 已交付的限定能力 | 主要边界 |
| --- | --- |
| 原生最小 AM610 新建、直接打开、结构／源码读取、编译及保存重开 | 离线工程；不是任意设备或运行保证 |
| ST POU、GVL／DUT、Method、Property、文件夹及对象移动；变量编辑 | 以各工具说明为准；set-type 限普通 VAR／根 GVL VAR_GLOBAL 的 BOOL、DINT、TIME |
| 变量／初值查询、检索、variable_usages | 用法绑定为限定 ST 静态推导，不是全工程原生语义引用 |
| 本机库查询、精确直接引用添加、普通占位符显式覆盖 | 不安装库、不提供直接引用删除或覆盖清除 |
| 任务周期／优先级、新建任务并绑定、末尾追加、单条替换 | 已验 AM610、普通周期任务、唯一根级 ST PROGRAM；任务内部调用顺序严格保持 |
| 设备描述、工程设备读取、io_mapping_inspect | I/O 首版限已验 HIGH_SPEED_IO 连接器 2；首项 getter 与完整导出列表分开取证 |

**尚未提供**设备添加、离线设备参数写入、I/O 映射写入、PDO 查询／编辑、任务调用移除／重排、变量通用重命名／删除，以及 PLC 连接、在线值、下载、运行或仿真。原生探测成功不等于产品已交付。完整范围见 [README](../README.md#能力与验证边界)。

### 本机已安装设备描述

device_catalog 描述的是本机安装内容，device_inspect 描述工程实例；两者均不能证明现场固件。I/O 方向参照方、最终自动地址、声明原生绑定及运行值的缺口按实际结果保留。

## 停止与保全

- **running**：查询同一 operationId，不另发写入。
- **conflict**：停止后续写入，报告版本或目标差异，不自动改参数重试。
- **unknown／冻结／异常退出／结果不明**：保留工程、IPC、检查点、账本和锁；不回滚、不恢复性保存、不复制改名续试、不换登记目录。维护或隔离另行评估授权。
- **占用或未保存输入不明**：不启动第二服务、不强杀，无法正常移交就保留待办。
- **编译失败**：保留完整诊断并说明已发生的修改，不把 succeeded 当作 buildPassed=true。

历史 unknown／隔离、默认环境 200 ms 性能、IDE 崩溃根因、CmpLog、脚本信任、Desktop 欢迎页和实际运行未验证等限制继续保留。不为消除提示重放既有工程任务。

## 获取与构建

本机试用优先使用已核验固定构建。开发者另行构建时保留工作区和原登记，固定到明确提交后执行 npm ci、npm run build。安装核对不应运行 test:ide 或业务工程脚本；自动化通过不等于真实 IDE 或模型验收。

## 三路独立延时报警样例

[历史三路样例及原文](getting-started-history.md#三路独立延时报警样例)保留当时版本、比较流程和 CmpLog 警告，不作为当前默认流程。[0.34.2 双路报警](offline-alarm-acceptance-0342.md)仍为工程闭环通过、流程与展示部分通过。本页示例未在本轮执行。
