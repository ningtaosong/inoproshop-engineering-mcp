# 安装与 DSH 接入

实测环境为 Windows、InoProShop 1.9.1.6、DSH 0.2.0-rc.2；Node.js要求22或以上。其他电脑和安装组合尚未取得部署验收，路径、设备描述和工程库依赖按实际环境核对。

## 获取与构建

仓库已公开，可直接克隆。0.8.0当前在功能分支codex/pou-create-program-function，main仍保留已验0.7.0；尚未因开发端验收通过而合并。以下假设检出到尚不存在的 `D:\InoPro`，已有目录不要覆盖：

```powershell
git clone https://github.com/ningtaosong/inoproshop-engineering-mcp.git D:\InoPro
cd D:\InoPro
git switch codex/pou-create-program-function
npm ci
npm run build
```

InoProShop、DSH、Node和厂商设备包/库自行安装，仓库不捆绑这些软件。`npm test` 运行自动化测试；其中原生API替身不代表真实IDE或PLC验收。`test:ide` 等维护脚本可能打开并修改独立测试工程，不属于安装步骤，不对业务工程随意运行。

## 接入 DSH

1. 备份DSH配置。实测桌面配置入口为 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，以所用DSH版本为准。
2. 参考 [配置模板](../config/dsh.example.patch.yml)，将条目加入已有顶层补丁数组。更改Node、仓库、IDE和Profile路径；保留客户端config层的 `maxInstructionBytes: 65536`，与serverName、transport同级，不放进env。不覆盖模型凭据或其他插件条目，不重复添加同名MCP。
3. 新安装可使用模板的独立数据目录；已有部署升级沿用原目录，保留登记、操作、检查点和隔离，不通过换目录或复制故障工程绕过unknown。
4. 空闲且没有活动任务/用户输入时正常重载MCP或重启DSH。新工具/Schema需要重载，普通新对话与工程切换不需要反复重载。
5. 新对话先让Agent查询环境、会话和工具集合。当前应为0.8.0和十八项工具；初始化返回instructions不单独证明模型正确遵循。

DSH通过stdio启动Node。不要在同一数据目录被DSH占用时另行运行 `npm start` 或第二个客户端；命令行直接启动MCP只会等待协议输入。

### 指令大小与连接失败

`maxInstructionBytes` 属于 **DSH MCP Client** 的配置，不是本MCP服务参数或INOPRO环境变量。本机DSH和 `@deepseek-ai/dsh-mcp-client` 均为0.2.0-rc.2，客户端Schema支持此正整数；默认32768字节。客户端将服务器instructions去掉末尾空白，添加 `### MCP server: inoproshop` 标题及两个换行，再按UTF-8字节计量；超限拒绝连接，不是工具执行超时，也不是静默截断。

2026-11-02本机实际指令文件35593字节，客户端计入标题后35619字节，超过默认上限。实际桌面配置提高到65536并正常重载后恢复十八工具，真实DSH任务完成了修改前基线、修改、保存版复编和最终比较。模板已同步这一设置；不通过缩短或截断已验工作规则掩盖问题。其他客户端版本以各自Schema为准，不能假定都支持同一字段。

修改指令或接入前可运行：

```powershell
npm run check:instructions
```

该静态检查按实际UTF-8字节核对模板的明确上限，同时检查客户端归属标题的开销；超限、字段缺失/错层或配置格式不明确时非零退出，不改文件、不启动服务/IDE。检查器只解析仓库内简单单客户端模板，不是通用YAML校验器或私人配置审计工具。未来指令增长仍需检查，不保证65536永久足够；超限时先停止接入并复核，不能静默截断。

初始化单独成功只证明服务提供指令和工具，不证明DSH客户端已接纳或模型遵循；桌面断连错误、已安装客户端Schema/实现、修复后实际系统指令及工程调用是本次接入复核的不同证据。不要因为独立握手成功就反复重启IDE或派发工程操作。已有正常DSH无需因阅读本说明再次重载。

## 首次试用

从已保存关闭的独立测试工程和只读任务开始。替换为自己的实际测试路径：

> 打开 `D:\PLC-Test\Example.project`，使用受管理工作副本。只读解释PLC_PRG及其调用的功能块，查询对应任务的类型、配置周期和优先级；不要修改、编译、保存或连接PLC。返回实际工作副本链接和完整地址。

Application、对象身份、版本及工具顺序由Agent处理，用户不用填写GUID、哈希或操作引用。对当前支持的Application修改，Agent在首次写入前采集当前工作副本，固定“本轮修改前基线”；工具缺失、采集失败或无法取得可信基线时先说明并停止，不在写完后补造。

完整日常流程为：读取确认 → 采集修改前基线 → 原有版本校验/检查点/读回机制修改 → 真实编译 → 保存关闭重开 → 必要的保存版本复编 → 最终源码核对 → 采集同一工作副本最终快照 → 使用project_compare引用前后记录比较。比较不能替代编译、保存重开或读回，创建/修改工具本身会持久化，基线须在这些首次写入之前取得。

前后两侧都使用 `origin=working-copy`。只有用户明确要与原交付工程比较时，才另采 `registered-source`，并把两类比较分开；已接受的历史改动不应混入本轮。只读解释不追加修改流程；对象池等不适用时如实说明，用户明确要求当前不支持的比较则在写入前停止。

按实际分页取完比较结果，长变更按需读同版本详情。核对实际源码变化、对象增删及可读任务配置是否属于本次授权，只有已核对的一致内容才能说未变。设备参数、I/O等不在对比覆盖内；有读取缺口/无法比较不能说全部通过。发现额外变化时，说明已完成写入和比较异常，停止后续自动写入、保留现场，不自动回滚或用后续修改掩盖。

答复简述改动、真实编译错误/警告、保存重开、本轮比较及覆盖限制，并同时提供实际副本打开链接和完整绝对路径。操作引用/版本/完整差异留在内部。详见[流程、实现核对和验收边界](post-change-baseline-compare.md)。这是Agent约束，不是新增的服务端强制事务或自动回滚；本轮修改前基线与交付后比较的DSH桌面工程流程已通过事后复核，不代表设备/I/O、运行、链接点击或所有回答质量通过。

仍在执行时查询原操作；unknown或冻结时停止业务、保留现场、核对原操作，不换编号重放、删锁或手改记录。已隔离工程仍受阻，本地维护CLI不是模型自动解冻入口。

## 创建 ST POU

pou_create仍是一项工具，限定精确Application直接根节点，三类均提供requestId、projectId、applicationId、parentId=applicationId、当前expectedSnapshot、name、完整declaration及implementation。用户只提业务需求，内部身份由Agent查询。 expectedSnapshot取最近打开/创建/修改/编译返回的工程文本snapshot，不取project_compare的内容版本snapshot.version；每次创建后使用新返回的工程值。

| pouType | 声明首部与返回参数 | 范围 |
| --- | --- | --- |
| function_block | FUNCTION_BLOCK 同名对象；不传returnType | 保留原调用兼容性 |
| program | PROGRAM 同名对象；不传returnType | 声明和实现；不会自动加入周期任务 |
| function | FUNCTION 同名对象 : DINT，类型后换行；必须显式returnType=DINT | 首版仅DINT，缺失、INT/BOOL/结构体等其他类型均拒绝，不自动改类型 |

object_list/object_read保留原objectType分类：功能块为function_block，PROGRAM/FUNCTION为st_pou，由可选pouType细分。returnType来自实际声明首部；本机原生对象没有已核实的独立pou_type/return_type getter，pouTypeSource明确采用原生POU类型身份和声明首部，不伪装独立属性采集。完整原文、版本、创建工厂枚举和真实编译用于核对。

例如：在独立正常样例中创建DINT函数F_AddOne、创建程序PRG_Demo调用该函数，再在已有PLC_PRG中按授权添加PRG_Demo()调用；先读实际代码和任务、核对重名并固定范围，首写前捕获工作副本基线。接入后真实编译、保存重开、必要复编、全文读回，捕获同一副本最终快照并比较。不能把两个闲置对象创建成功说成接入通过，也不修改任务来绕过调用。

同名对象不覆盖或静默改名，过期版本先停止；创建/读回失败如实区分failed和unknown，unknown查询原操作，不重放、删锁或换目录。仅沿用已实现的已知新GUID局部失败处理，不承诺通用自动回滚。设备、任务和I/O写入、文件夹、方法/属性/接口及其他语言不扩展。离线编译不证明函数输出、程序调用次数或报警计时在运行中正确。

新增Schema和指令需要DSH在确认空闲、无未发送输入及当前执行操作后正常重载一次；历史已受控隔离unknown不等于仍在执行。无法确认则保持待办。开发端验证与桌面对话分开记录，不自动发送任务。
