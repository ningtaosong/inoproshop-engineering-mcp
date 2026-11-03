# 库依赖只读查询（0.10.0候选）

新增 `library_inspect`，共十九项工具，原十八项输入/输出契约保持。候选分支 `codex/library-inspect`，未合并main。DSH接收和桌面对话须独立验收，服务端初始化或开发端调用不代表桌面通过。

## 输入与范围

必填 `projectId`、`applicationId`；`targetKind`只能为`application`。工程必须已登记、当前活动、未隔离，按现有串行队列执行，不隐式切换。管理器按原生类型 `adb5cb65-8e1d-4a00-b70a-375ea27582f3` 加实际`is_libman`核实，不靠显示名称定位。应用树读取失败会标明范围不完整，不能以空结果断言未引用。

可选 `offset=0`、`limit=50`（1–200）、`maxReferences=2000`（1–10000，全应用所有管理器共同上限）、`expectedVersion`。只枚举各管理器的直接`references`，不调用递归依赖或本机已安装库列表。多个管理器分别返回实际GUID、原生类型、完整路径、枚举状态和条目数；不默认把不同管理器合并为一份完整依赖树。

`references`按管理器路径/GUID排序，再保留管理器原配置枚举顺序。每项有`managerId`、`managerPath`、`order`、清单`index`和`path`。条目路径最后的`references/序号`是读取接口位置，不伪称原生工程对象路径或对象GUID。原生引用`id`以字符串保留，身份/序号只在该工程和该清单版本内使用。

## 已核实的1.9.1.6接口

| 原生读取 | 返回与边界 |
| --- | --- |
| `manager.references` | 直接`IScriptLibraryReference`序列；不调用修改方法 |
| `id/name/namespace` | 原始字符串；普通库名称可能含版本和厂商规格，不拆造独立字段 |
| `is_placeholder/is_managed/system_library/optional/qualified_only` | 原生布尔值，不用作“已安装/已加载”证明 |
| 占位符`placeholder_name` | 与显示名称分别保留 |
| 占位符`default_resolution` | 默认声明/约束字符串，可能含通配符，与当前解析不同 |
| 占位符`effective_resolution` | 当前getter提供的解析字符串，原样保留实际版本/厂商规格；不是独立加载结果标志 |
| 占位符`resolution_info/resolver_guid/is_redirected` | 原生解析来源说明、解析器身份和重定向标记，不按文本猜测成功/缺失 |

`get_libraries(False)`只提供字符串，不是元数据对象；正式工具使用上表接口。未取得经过核实的独立版本/厂商、已加载/缺失状态getter，`unavailableMetadata`明确说明。普通非占位引用不尝试占位符专用getter。字段null和空字符串原样保留，异常在`unavailableFields`保留完整原因。`resolutionStatus=effective-resolution-reported`仅表示非空当前解析字符串；否则`unknown`，不能把空值/异常推断成缺库，也不把字符串存在断言为独立证实解析成功。`installedStatus=not-queried`，不查询安装仓库补事实。

## 分页、详情与证据

首次无版本查询在一次受管理IDE打开/关闭中采集。保存完整原始IPC后计算绑定工程、Application、路径、磁盘哈希、管理器、完整字段及缺口的`version`。续页必须使用返回的实际`nextOffset`、`expectedVersion`及原`maxReferences`；带版本的offset=0也复用原清单，不重新启动IDE。跨服务重启仍可读取原记录；文件变更拒绝，原证据损坏/归属无法确认继续冻结，不重新采集掩盖。

结果JSON上限16000 UTF-8字节，条数可能因体积降低。单字段超过256个UTF-16码元时，`rawFields`对应值为null，并有显式`fieldPreviews`（文本、原长度、SHA256、未完整标记）；不是字段缺失。可带`fieldRead:{referenceIndex,field,offset=0,limit=1024}`（2–2048），外层offset必须0、expectedVersion必填。field仅为id/name/namespace/placeholder_name/default_resolution/effective_resolution/resolution_info/resolver_guid。`fieldDetail`报告实际片段边界、原长度/摘要、hasMore/nextOffset；按实际文本游标继续，不拆Unicode代理对。全字段原文仍在原IPC，不为展示修改证据。超大路径/失败元数据无法装入响应时明确失败，不静默裁剪或声称该内容已送达。

`scope.enumerationComplete`、`fieldReadComplete`、`truncated`分别表达枚举、已尝试字段的读取与采集上限；不可取得的独立元数据另列。`page.hasMore=false`只说明原清单页面结束，不能替代完整覆盖；覆盖不完整时`page.total=null`。`readOnlyEvidence`保留打开前、关闭后、进程退出后工程文件哈希，分页另有前后文件核对。附属.opt等变化须另记，不宣称整个目录不变。

## 使用限制

不添加、移除、安装、下载、升级库，不调用主动解析/修复，不编译保存，不连接PLC。不递归完整传递依赖、不核对I/O或完整设备配置，不将库加入`project_compare`。已安装、工程已引用、当前IDE报告解析信息是三种事实。

CmpLog直接清单未出现，不能排除间接依赖或断言历史编译警告已解决。占位解析信息与编译诊断分别说明；引用历史编译时注明证据及适用版本，不为查询额外编译。配置与解析原文均不是运行观测。原unknown、隔离、旧锁及历史质量结论不因新增查询改变。

具体测试、真实只读验收和待验桌面任务以本轮本地复核ZIP为准；缺失库/字段故障等替身用例不得称为真实IDE故障实测。[接入与常用任务](getting-started.md)，[机器Schema](tool-schemas.json)，[工作指令](../instructions/inoproshop-workflow.md)。

## 本轮验证状态

构建、类型检查及最终完整回归141/141通过（含原生API替身，不叠加另算）。一份独立正常AM610受管理副本：9项真实工程操作成功、3次IDE派发（打开、结构、库清单）；结构67节点三页，库18项四页（5/5/5/3），另一次同清单字段详情，缓存步骤不启动IDE。独立脚本直接读取get_libraries(False)和references属性核对全部实得字段、管理器身份/路径，未导入服务汇总或worker函数。工程三阶段SHA256一致，.opt和projectbackup另列。

真实样例有1个管理器、18个占位符，均报告非空当前解析字符串，不等于独立证明所有依赖已加载。未取得普通非占位引用、实际缺失/未解析、多管理器、读取失败、截断及长字段的同类真实工程证据，这些仅由替身验证。没有CmpLog直接项，未查传递依赖或新编译，不据此消除历史警告。

首轮定向契约比较误混Schema方言；首次完整回归有未重建新校验和既有切换准备阶段失败，保留原日志，后者原因未确定；最终候选冻结后完整回归另存。真实工程初始验收脚本误断言大limit为单页，停在成功结构首查后；已保留首败并只续读原缓存页，没有重采/重开或重放业务。DSH实际加载/手动对话仍待验；未确认窗口草稿及活动状态，未自动重载。链接点击、固件、完整设备/I-O、运行及历史11/12回答质量不因本轮改变。
