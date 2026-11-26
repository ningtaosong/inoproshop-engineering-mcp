# 常驻内存编译：IecVarAccess 直接引用的限定保全补修

最终产品提交 `8d4a694103b2127f430cf759aec295177d1cb5d6`（首个补修提交 `dbedee4e8f54010a8b46564ebc777cdf091e8239`），基于 `1668feb902679d3933c7017e53910a1d157ae2b9`。保持0.41.0候选、38项工具；只修改常驻编译的桥接与服务端独立核验，没有新增工具、自动添加库调用、保存或关闭操作。远端main仍为 `55bb58fc97b266215ad536b6b0f9d4f66c80670f`，未合并、未部署。

## 已定位的差异及证据

[原真实首轮](resident-memory-build-real-20261126.md)的操作 `bf310d71-3e21-421b-9c78-233f4a72dd17` 保持unknown。原生编译确已返回0错误／0警告；保全比较发现 Application 的库管理器直接引用17→18，停止了后续请求。原17项的身份、属性和相对顺序均保持，新末项是 `#IecVarAccess`。另外出现四个公开归类为后台库的工程句柄，二者分别取证，不能用后台库规则忽略直接引用变化。

使用原before、after、build-context-before及compiler-result构成的归档回归输入，在未修复的Python `build_conservation` 和Node `buildConservation` 上均重现 `Compiler changed existing node: 5d558397-776b-478d-ab91-fa36aca5d60a`。未重新打开工程，也未覆盖旧IPC。该比较缺陷已复现，不据此宣称解释全部原生异常或改判旧unknown。

本机安装件的静态CIL依据：

| 安装件／位置 | 可核对内容 |
| --- | --- |
| InoSymbolObject.plugin 1.9.1.6，SHA-256 `91e06b3aa1548a4076535cf68df3bb2f41c9445e7c196a553687c50b9d609c48` | `SymbolConfigNotification.OnLanguageModelMgr_BeforeCompile`，token `0x0600012c`，读取编译事件ApplicationGuid。没有SymbolConfig对象的分支调用 `0x0600012d`，以主工程handle、该Application、名称IecVarAccess、默认 `IecVarAccess, 3.3.1.20 (System)`、Guid.Empty、system=true调用LoadPlaceholderLibrary。 |
| InoLibManObject.plugin 1.9.1.6，SHA-256 `7fbdf3fd2728e19e737fa3b672da89d4ec9582efc3060ef896a5b44a62b111a6` | `LibraryLoader.LoadPlaceholderLibrary`，token `0x060002dd`，取得对应Application库管理器。已有可解析占位符时返回有效解析；不存在时创建、设置resolver/system/default、追加并加载，finally提交库管理器。 |
| 同一InoLibManObject，tokens `0x06000420`、`0x0600043c` | Guid.Empty映射到内建解析器 `b303f5ce-75ff-4668-a777-7da8debb449c`；解析链区分显式覆盖、设备、库配置文件及默认值。原快照实际返回“库配置文件解析”和 `IecVarAccess, 3.5.11.0 (System)`。 |

因此已证明本机存在编译前自动补库机制，原生前后差异与之吻合。未采集该次事件回调的运行时调用栈；不将静态链写成当次动态调用栈证明。REA完整成员分析遇到64 MiB表示预算限制，保留该缺口；随后用独立dnfile/dncil静态提取精确方法，无OEM执行、注入或修改。提取脚本、方法偏移、安装件指纹及警告来源在复核包中。

## 精确允许范围

仅当当前编译Application位于已验AM610根描述 `4102 / 10f4 0002 / 3.5.11.11` 下，且其唯一原生库管理器仍为该Application直接子节点时，允许追加一项上述精确引用。新引用ID必须为无前导零的非零十进制文本且与清单中其他ID唯一，不固定原数量17或ID；完整其他字段必须等于已验值，包括默认和有效版本、命名空间、解析器、解析来源、全部标志及原生null显式覆盖。

编译前后另读当前已加载的两份程序集名称、版本、Location及磁盘SHA-256，必须对应上述安装件且保持一致。只读取公开CLR程序集元数据及文件，不主动加载或调用插件。新侧证是新版本的采集要求；离线归档回归对此使用明确标记的替身，不向旧IPC补填加载状态，实际IDE加载侧证尚待新候选复验。

原清单必须逐项构成新清单的完整前缀，原属性、未知字段、顺序、身份和解析均保持。其他库管理器、原节点、源码／ST标识、任务及内部调用、Application、设备／连接器和磁盘仍按原规则核对。不因system_library=true或名称相似放行。已存在IecVarAccess时只允许清单原样保持；额外重复、新版本、显式覆盖、任何字段缺失或变化均停止。

成功证明如实返回 `directLibrariesUnchanged=false`、`originalDirectLibrariesUnchanged=true` 及 `compilerAddedDirectLibraries` 的库管理器、Application、末尾位置、完整原生行与侧证哈希。无新增时保留旧证明形状和true。实际编译后依赖进入新的residentVersion；后续请求必须用新版本，源码版本与编译输入版本仍分别记录。所有38项输入／输出Schema、初始化正文及工具说明与2eb3d5c固定版一致，输出扩展沿用原passthrough契约。

## 离线验证归属

| 检查 | 结果／范围 |
| --- | --- |
| 新专项Node | 首轮66/66；最终受影响集合中本专项70/70，包含原生归档比较及服务端生产验证函数，篡改生产者成功证明也拒绝 |
| 新专项Python | 首轮33/33；补充程序集读取及非固定ID／数量后35/35；最终补齐规范ID／缺字段反例为37/37，包含生产ResidentSession替身 |
| 受影响Node回归 | 最终319/319；常驻读改编译、原去重／冻结、关闭证明、隔离观察和退出保护；独立长路径TEMP，无真实IDE |
| 受影响Python | 最终90/90；原常驻核心、编译及新增依赖。不是全产品回归 |
| 本机IronPython 2.7.7 | 完整模块解析、实际固定加载；原核心37/37、编译16/16、新专项37/37，分别记录，不累加 |
| 构建／类型／契约 | 开发与固定构建通过；38输入及38输出SDK转换Schema完全相同；正文65,135字节，含客户端标题65,162／65,536 |

最终结果属于8d4a694产品及对应测试文件指纹；首个补修dbedee4的315/315、88/88及IronPython新专项35/35单列保留，未累计，均为离线。原0.41全回归、原真实编译及之前0.39未完成验收各保留原提交归属，不混用。

首败分别保留：默认Windows TEMP短路径与完整realpath不一致，旧服务替身在打开阶段失败，尚未到编译；改用明确长路径的独立测试目录，未改变真实登记目录或200ms阈值。首次使用PowerShell 7启动IronPython在CreateEngine即报encoding 0，未执行模块；沿用已验证Windows PowerShell 5.1后通过，没有调整执行策略。所有原失败输出保留，不把这两项当作真实IDE故障。

## 新固定构建与待复验条件

新独立固定目录：`D:\InoPro-ResidentBuild-LibraryFix-20261126\fixed-8d4a694`，源为上述完整产品提交。105项产品文件指纹已保存；相对原真实受验2eb3d5c仅 `bridge/resident_core.py`、`dist/resident-build.js`及其map变化。未覆盖旧固定目录、没有启动候选服务或独立握手，也没有向当前IDE热加载。

当前原IDE66304、MCP67192及驱动66352继续保留。最后原生快照为内存7秒／FALSE，两条中文及声明保持；磁盘仍为原5秒／FALSE，SHA-256 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。接收器已经因unknown停止，不能继续工程请求。此次新build、编辑、保存、关闭和模型任务均为0。

原finish控制和 `verifyClosedResident` 明确只接受原succeeded/conflict请求；本轮包含unknown，不能直接重放finish或承诺能按成功会话重开。服务的 `assertReleaseReady` 同样保留failure拒绝。此次不放宽这些规则、不恢复账本、不删锁，也不新建夹具绕过。

下一步的具体维护方案须另获一次授权，本轮只准备：

1. 再核对IDE66304／创建身份 `639312986237949757`、服务67192／`639312985991677407`、驱动66352／`639312985988993186`。进程已变化就停止。
2. 对这一IDE实例执行正常关闭，在当前工程的保存提示明确选择不保存，放弃本次7秒／FALSE未保存状态；记录正常关闭与真实退出。现有命令行接收器已停止，不能替它派发close；之前已验的是经专门授权的窗口正常关闭和“不保存”选择，不属于当前命令行修复授权，也不能把它描述成无交互命令。没有相应维护授权就保留现场。
3. IDE正常退出后，失败驱动的旧finish仍会拒绝unknown，不尝试它。若要结束驱动，须授权仅终止上述驱动实例并记录非正常终止；观察服务因管道结束的真实结果，不能写成服务自动正常退出。服务因failure保留或无法结束时，不追加终止；若希望一次维护覆盖该条件，确认中须明确包含上述精确服务实例的有条件终止，不能含混写“清理占用”。源锁及原服务锁均保留，后续只由既有正式机制判断。

上述动作不恢复账本、不改变unknown。即使三进程均退出，也不能按成功会话重新打开原路径。原失败工程继续保全。本次只读指纹核对覆盖停止归档后的22,201项登记、账本、IPC、检查点、锁等文件，字节差异和新增文件均为0；三个进程的创建身份保持。

待确认的下一轮对象为 `D:\InoPro-ResidentBuild-Recheck-20261127\engineering\AM610_ResidentBuild.project`，本轮确认尚不存在且未创建。若用户明确允许新的独立验收准备，只能使用既有中性ZIP `D:\InoPro\deliveries\InoPro-review-20261109-132658.zip` 中 `projects/AM610_Minimal_MCP.project`，成员SHA-256 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`，不能复制当前unknown工程。还必须由原登记目录的正式准入确认旧操作仅影响原工程、没有全局阻断；若不允许新对象，停止并报告，不换登记目录或再换路径。新夹具准备、保存及基线编译须另列授权和计数，本轮均未执行。

上述维护与准入明确以后才可安排一轮新固定产品复验：同一实际工程读取→明确授权修改→使用最新版本编译→核对新增直接引用侧证和保全证明→独立读回；后续修改须另获明确指令，再核对旧编译证据失效。不得沿用旧脚本自动完成FALSE→TRUE。若库已经存在，记录“本次无新增”；不得删除它制造场景。任何新的缺证或额外变化仍停止，保存继续由用户决定。

没有真实复验、保存持久化或DSH模型编译结果。历史unknown、隔离、旧锁、默认性能、崩溃根因、CmpLog、脚本信任、Desktop及PLC运行限制均保持。
