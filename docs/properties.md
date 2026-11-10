# 原生 Property/Get/Set

main现为0.21.0候选版、25项工具；该功能分支基线为0.20.1。扩展property_create、object_list/object_read和code_apply_change，不新增工具。旧调用默认只读Get，可读写须显式选择；相关Schema为兼容扩展，不是逐字不变。下文旧Get验收保留原时间语境。

## 范围和原生依据

仅精确Application中用户普通ST FUNCTION_BLOCK下PUBLIC DINT原生属性。只读为唯一Get，可读写为一个Get和一个Set，均为ST。其他类型/访问级别、只写、继承、接口、重载、改名和通用删除不开放。不转换已有属性，不补建缺失Set。

已安装InoProShop1.9.1.6的原生工厂是`fb.create_property(name, 'DINT', ImplementationLanguages.st)`，默认生成Get/Set；Property类型`5a3b8626-d3e9-4f37-98b5-66420063d91e`，访问器同为`792f2eb6-721e-4e64-ba20-bc98351056db`，ST嵌入类型`3b83b776-fb25-43b8-99f2-3c507c9143fc`。两访问器共享类型，角色依据工厂默认Get/Set子节点、各自GUID、原生类型、唯一父Property及ST结构联合确认，没有独立角色/访问级别/返回类型getter的证据。不能只凭短名寻址。

独立原生探测确认：Get通过属性名赋返回值（`CurrentState := State;`），Set通过属性名读取传入值（`State := CurrentState;`）。调用方用`Demo.CurrentState := 12;`写入，用`Observed := Demo.CurrentState;`读取。没有名为value的已验隐式变量，也不是用普通方法或公开变量模拟属性。编译和源码核对不是运行观测。

## 创建、读取和修改

Agent取得实际工程、Application、父FB全文/哈希和当前工程/磁盘版本；用户不填内部GUID。旧调用或显式propertyMode=read-only保持原只读流程，工厂默认Set仅在本请求刚新建、GUID/父链/类型/ST/默认空源码已确认时清理。空Set不等于只读，不删除已有访问器。

可读写创建在原字段上明确增加：

```json
{
  "propertyMode": "read-write",
  "name": "CurrentState", "access": "PUBLIC", "propertyType": "DINT",
  "declaration": "PROPERTY PUBLIC CurrentState : DINT",
  "getDeclaration": "VAR\nEND_VAR",
  "getImplementation": "CurrentState := State;",
  "setDeclaration": "VAR\nEND_VAR",
  "setImplementation": "State := CurrentState;"
}
```

仍需携带requestId、projectId/applicationId、parentId=父FB、expectedParentHash、expectedSnapshot、expectedDiskHash。可写模式保留工厂生成的两个访问器并核对全部身份；如果只生成Get或结构不明，停止，不自行补建。返回Property和getter，可写时另返回setter；三层身份为FB→Property→Get/Set。

Get或Set修改分别使用code_apply_change的objectType=property_get或property_set、准确objectId、parentId=Property、fbId=父FB、expectedHash、expectedPropertyHash、expectedAccessorVersion、expectedSnapshot及expectedDiskHash，提供完整声明与实现。访问器局部声明仍仅限定VAR块；不通过源码修改Property名称/类型/访问级别或增加访问器。每次保存关闭重开后同时核对目标、另一侧、Property及父FB原文，响应保留relatedSourceEvidence。过期版本、身份不明、权限不足和只读文件拒绝；部分失败保留操作和检查点、unknown冻结，不承诺事务或自动回滚。

## 查询、快照和编译证据

Property是声明对象；Get、Set是独立源码对象，类型分别为property_get、property_set。检索保留原路径、父链、哈希与UTF-16原文位置。变量查询把property-return与访问器的真实局部声明分开，不把Set传入值编造为普通变量或源码初始化值，不是原生符号表或运行采集。

只读结构保留fb-property-accessors-v1及原摘要语义；可写用fb-property-accessors-v2，结构必须有独立Get和Set。工程快照含两者全文及实际访问器结构，任一改变使旧编译失效。保存版本是否需复编按实际保存结果判断。

源码覆盖标记扩展至fb-properties-v2；旧只读结构可核实，合法旧清单若跳过现已支持的Property/Get/Set则要求重新首查，不自动派发或冻结；损坏证据仍unknown。按需project_compare分别报告完整应用相对路径/类型和父关系，旧快照覆盖不足报不可比较，不把未覆盖Set当新增或不存在。分页与长原文sourceRead机制不变。

默认[日常流程](getting-started.md#日常修改闭环)仍是必要读取、直接修改、编译、保存关闭重开、必要复编和目标读回，不自动增加比较基线、全工程审计或业务副本。

## 可读写阶段验证状态

原生独立探测已验证工厂双访问器、调用方赋值和读取、创建后一次Set有效修改及保存重开，两次编译各0错误0警告。辅助探测首轮IronPython作用域错误保留，未保存且主文件哈希不变。本分支最终自动化、MCP与CLI结果见下节；原准备和租约阻断记录不改写。

## 可读写分支验收（2026-11-10）

固定受验产品`22798f9a495586224857db8a5f5dac7f0b4f4686`，0.21.0候选、25工具；该次分支验收未合并main，后续收尾见末节。原25项调用兼容扩展，不是Schema逐字不变。可写必须显式propertyMode=read-write，旧参数省略模式仍创建唯一Get，旧请求指纹不因默认值注入而变化。四个租约/隔离源码及运行模块与最终0.20.1修复一致，登记仍v2。

- 自动化完整343/343新跑通过，包含本轮隔离测试；最终固定产品构建、类型检查及29/29定向通过。全量后仅去掉重复枚举源码、收敛拒绝文案，对应运行差异与25工具动态Schema深等已核对；29是子集，不相加。新Set Python7项与原只读14项分别计入Node聚合，不另叠加。原Schema不支持、换行预期、sourceRead上限用例和检查器首败均保留，没有削弱上限或断言。
- 独立真实MCP正向38项持久化操作成功：两个FB的同名可写属性分别定位，创建后Set改为`State := CurrentState + 1;`、Get改为`CurrentState := State + 2;`。修改一侧时另一侧、Property与父FB原文保持，旧编译失效，重复请求返回原操作。三次编译各0错误0警告，保存重开、九对象最终源码、可读任务配置与最终文件一致。声明查询只报告Set真实局部Note，不补造隐式CurrentState变量；标识符检索完整五页。明确安排的开发比较五页，仅Get和Set两对象修改，其余支持对象及任务一致；不是默认CLI流程。
- 另一独立只读负例8项操作成功取得预期编译拒绝：调用方赋值`Demo.CurrentState := 9;`为1错误0警告，Get-only结构保持，未补建Set。负例不是正向编译结果，也不是运行实验。
- 一次DSH CLI模型任务17项工程操作成功、51次MCP调用；模型在指定新路径创建FB、原生Property/Get/Set，并在PLC_PRG读取、赋值12、再次读取。两次编译各0错误0警告；保存返回编译不再适用后执行保存版复编，最终五对象及可读任务配置与该文件对应。没有比较或业务副本，State源码初值7、赋值常量12均未当作运行观测。
- CLI一次普通POU修改误带访问器版本参数而被拒绝，未写入；9次辅助调用包含2次pwsh退出3221225794及7次本轮IPC读取/枚举，辅助失败不计工程失败，根因未确认。核心工程闭环通过，参数/等待效率及简短展示未完全遵循，原答复和勘误分别保留，不为展示重跑。

同一候选CLI连接的stdio发送正文/25项工具，与持久化系统指令和模型请求输入Schema/说明逐项一致，实际显式可写调用可见；不证明远端完整上下文处理或全部指令遵循。结束后候选进程正常退出，通过原租约机制归档已退出拥有者并取得/释放本轮路径，未删锁、改历史终态或恢复隔离工程。原日常DSH最终0.20.1入口进程已恢复，恢复连接的握手及模型接收未另取证；Codex0.16不变，候选构建保留而不部署日常入口。

本机证据目录`D:\InoPro\.local\fb-property-set-resume-20261110`；独立CLI工程`D:\InoPro-S2bSet-CLI-20261110\AM610_PropertySet_DSH.project`。公开Git仅放实现、测试及必要说明，工程、配置及会话证据不提交。没有连接PLC、下载、运行或仿真；Linux/WSL实机、设备/I/O完整配置、桌面业务和链接点击未验证。原unknown、历史质量、CmpLog、脚本信任、辅助失败及旧证据保持；本轮零警告不消除历史警告。

## 验证记录与限制

本节及以下旧分支/合并记录属于0.20.0只读阶段，当时的“Set尚未实施”保留历史语境；本轮可读写结果单列于上节。

独立原生探测确认工厂默认双访问器、限定清理Set、PLC_PRG属性读取、两次0错误/0警告、保存重开后按GUID/父链/全文及唯一Get结构一致。替身自动化与真实MCP、DSH CLI结果在最终交付分别归属；不能用替身或工厂readOnly标记代替原生结构/编译。调用方赋只读属性的预期编译拒绝使用另一独立负例工程，不能混入成功工程编译结论或自动增加Set修复。

本机证据目录`D:\InoPro\.local\fb-property-edit-20261110`；最终任务、编译、文件哈希及完整分支提交见交付记录。配置和源码读回/编译均非运行观测。未连接PLC、下载、运行或仿真；桌面业务、链接点击和完整设备/I/O未验。原unknown、历史11/12质量、CmpLog、脚本信任及辅助失败保留；本轮新工程零警告不表示历史CmpLog已解决。Set尚未实现和验收。


## 分支验收（2026-11-10）

固定产品c7340548f5113eb6418b8eb17744f12dd70988d5。构建、类型检查、Method/Property定向28/28及最终Python替身14/14通过；Python计入Node聚合不叠加。最终非隔离278/278，另复用本轮未变隔离代码的15项通过记录，合计覆盖293项；完整首轮292/293的临时夹具持久化EPERM保留，不写成一次完整293项全绿运行。原24项调用兼容及无属性黄金结果、变量表v2、st-identifier-v2均核对。

独立真实MCP正向47项操作：两FB的同名属性分开定位、一次Get有效修改、旧编译失效、3次编译各0错误0警告、保存关闭重开、8对象最终源码及可读任务配置核对。显式开发比较兼容验证分别得到新增7对象/PLC_PRG修改1，以及仅Get修改1，分页完整。另一独立负例8项操作取得调用方写只读属性的预期1错误0警告，错误为“Demo.CurrentState是无效的赋值目标”；Get-only结构保持，不增加Set修复。

一次DSH CLI业务任务由模型实际调用MCP：20项工程操作成功、两次0错误0警告，5对象最终读回及Get-only结构与保存文件对应，无比较或业务副本。1次Get专用参数误传普通PLC_PRG修改的拒绝、35次辅助调用和其中1次pwsh异常保留，流程效率与简短展示未全部通过；原答复单独保留，路径重复反斜杠另列勘误。服务发送的初始化及25项输入Schema/说明与本会话持久化系统/模型请求一致，不证明远端完整上下文处理或所有指令均遵循。

CLI示例通过PLC_PRG依次读取`Demo.CurrentState`、调用`Demo.ResetState()`、再读取属性。State源码初值7、Reset赋值0，只是源码和编译依据，未运行。开发端MCP工程将Get最终改为`CurrentState := State + 1;`，专门验证修改持久化，不与CLI的`CurrentState := State;`混为同一版本。

验收后原DSH0.19固定入口进程恢复，恢复后的握手/模型接收未另取证；Codex0.16不升级，Set尚未实施。原unknown、历史质量、CmpLog及脚本信任限制保持。完整证据和工程位置见本机复核包；公开Git只提交实现、测试和必要文档。


## 只读Get合并收尾（2026-11-10）

候选5e627d463a377efc9097aa06c8f50ae215110e90及固定受验产品c7340548f5113eb6418b8eb17744f12dd70988d5的只读Property/Get子阶段已合并。保持PUBLIC DINT、唯一Get边界；既有可写属性不自动转换，不开放通用删除，可写Set尚未实现和验收，不将整个属性阶段标为完成。

本轮仅证据、静态、文档/Git及DSH固定入口加载检查，产品、桥接、解析器、Schema和初始化指令正文与已验版本一致；不重跑全量测试、模型或工程任务。原24项调用兼容扩展，不是Schema逐字不变。测试归属保持“278项新跑，另复用同版15项隔离结果，共覆盖293项”，不是一次完整293项全绿。原MCP正向3次、CLI2次0错误0警告分别保留；独立只读负例的1错误0警告是预期拒绝，不混入正向零错误结论。

DSH部署、各连接握手及观察器移除后的进程边界见本机D:\InoPro\.local\fb-property-merge-deploy-20261110；Git合并不等于客户端加载。原0.19构建和私人配置备份保留，Codex固定0.16不升级。本轮没有模型业务任务；握手不是模型上下文或遵循证明。原unknown、旧锁、历史质量、CmpLog、脚本信任、参数拒绝、辅助失败和原答复勘误保留；桌面业务、点击、实际运行和完整设备/I/O仍未验证。

## 描述与规划整合及合并（2026-11-10）

可读写Property/Get/Set阶段已正常合并；保持0.21.0候选、25项工具。本轮修正当前检索scope、未支持原因及相关比较/拒绝提示中的Get-only或遗漏Set措辞；只改说明常量与注释，没有更改判断、Schema、分页/缓存语义、写入保护或旧调用默认只读。修正后构建不同于旧固定22798f9，不能声称两者字节完全相同。

新增针对生产search_inventory的只读、可写和不支持结构三项替身检查，首轮按旧描述失败，修正后通过（一个Node聚合，数量不叠加）；构建、类型检查、Schema/指令一致性及文档链接检查完成。复用343完整回归和最终29定向及原MCP/DSH闭环，不重跑全量、模型或工程任务。原正向三次/两次0错误0警告、只读负例预期1错误0警告、失败和展示偏差保留各自归属。

S9规划以独立文档提交保全后整合，S9a只读在线、S9b限定运行参数写入、S9c Online Change均为后续未启动；普通下载、启停、复位、强制不自动纳入，不能从Online Change自动退化为完整下载。下一阶段S3未开始。用户已澄清旧工作区被忽略agent.md的指纹变化属于授权S9规划，不是Set任务擅改；前包原记录保留，本轮作此勘误，并保留两处规划各自历史。

DSH采用合并产品的独立固定构建；具体部署是否完成、各连接握手及后续重连边界，见本机D:\InoPro\.local\fb-property-set-merge-deploy-20261110复核入口。Git状态、固定文件、服务发送、客户端接收和模型遵循分别记账，本次没有模型业务任务。Codex0.16保持。原unknown、历史质量、CmpLog、信任/辅助失败、Linux/WSL实机、设备/I/O、桌面业务、点击及运行边界不变。

部署结果：DSH日常入口已切至合并70f47f8109e0ab4e2ef01113fa79d15704915ac4的独立固定0.21.0构建，旧0.20.1及候选固定构建保留。取证连接PID4744返回0.21.0、25工具，Schema和初始化正文与受验内容一致，客户端initialized确认可见；没有tools/call或模型业务任务。清理临时取证字段后正常自动重连为PID31564，仍为同一固定入口，但没有该新连接的独立握手，不拿4744证明31564。私人最终配置仅改变cwd和服务入口两个路径，数据目录、IDE及其余字段不变。初始化成功不代表取得工程租约或模型已经遵循全部指令；Codex0.16未动。
