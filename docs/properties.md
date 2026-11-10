# 原生只读 Property/Get（S2b Get阶段）

0.20.0候选版、25项工具，新增property_create，尚未合并main。读取复用object_list/object_read，修改仅复用code_apply_change的显式property_get目标。原24项调用兼容，相关Schema增加对象类型、父链、属性返回分类及结构版本，不是逐字未变。

## 范围和原生依据

仅精确Application内用户自建普通ST FUNCTION_BLOCK下的PUBLIC、DINT、只有Get的原生Property。没有Set、继承、接口、重载、改名或通用删除；已有可写属性不会自动转换。Get局部声明只开放限定VAR块，表达式和实现仍由真实IDE编译，不冒称完整ST语义校验。

本机InoProShop1.9.1.6文档和独立探测确认`fb.create_property(name, 'DINT', ImplementationLanguages.st)`。Property原生类型为`5a3b8626-d3e9-4f37-98b5-66420063d91e`，Get/Set原生类型同为`792f2eb6-721e-4e64-ba20-bc98351056db`，不能仅凭类型或Get名称寻址。语言参数ST为`cc393387-a21c-4f68-a3e3-84c36951965d`，Get的ST嵌入类型为`3b83b776-fb25-43b8-99f2-3c507c9143fc`。

工厂默认同时生成Get和Set，空Set不等于只读。产品只清理本请求新创建的默认Set：创建前不存在的GUID、精确Property父关系、原生类型、默认声明`VAR\nEND_VAR\n`、空实现、ST和无子对象全部核实，记录清理前后，再使用已文档化的原生remove()。这不是通用删除工具；异常、身份不明或内容非默认时unknown冻结，不删除已有访问器、不改名重试、不自动回滚。独立访问级别或属性类型getter未取得；依据来自实际工厂、原生身份/结构、声明和编译，不虚构独立属性读取。

## 创建、读取和修改

Agent先查询工程/Application，读取父FB全文哈希，并从当前session或最新成功写响应取得工程快照/磁盘版本。用户只需路径、父FB名称和业务需求，不填内部GUID。创建示意：

```json
{
  "requestId": "<Agent生成>",
  "projectId": "<工程GUID>", "applicationId": "<Application GUID>",
  "parentId": "<父FB GUID>",
  "expectedParentHash": "<父FB全文哈希>",
  "expectedSnapshot": "<当前工程快照>", "expectedDiskHash": "<当前文件哈希>",
  "name": "CurrentState", "access": "PUBLIC", "propertyType": "DINT",
  "declaration": "PROPERTY PUBLIC CurrentState : DINT",
  "getDeclaration": "VAR\nEND_VAR",
  "getImplementation": "CurrentState := State;"
}
```

返回Property及getter，分别提供objectId、parentId/parentPath、fbId、propertyId/propertyPath、propertyContentHash和accessorVersion/accessorStructure。三层身份是FB→Property→Get；不同FB或Property下的Get不合并。只读结构要求唯一直接Get、原生类型/父关系/ST/无子对象均明确且无Set。

限定Get修改用code_apply_change：objectType=property_get，objectId=Get、parentId=Property、fbId=父FB；expectedHash校验Get全文，expectedPropertyHash校验属性声明，expectedAccessorVersion校验访问器结构，expectedSnapshot/expectedDiskHash绑定当前工程和磁盘；声明与实现完整提供。Property声明本身不开放写入，名称、PUBLIC、DINT和父关系/只读结构保持。Get实现内给`CurrentState`赋返回值是原生语法，不能以简单字符串过滤等同调用方可写属性。

错误父类型、跨应用、库树、同父重名、原生权限/只读文件或版本变化在写入前拒绝。沿用检查点、串行、去重、写后读回、保存关闭重开；部分创建、默认访问器处理或持久化不确定时保留原操作并冻结，不承诺跨对象原子事务或自动回滚。

## 查询、快照和编译证据

Property为声明对象，Get为独立源码对象。检索含原路径/哈希/父链；变量查询将属性返回声明单列property-return，Get局部变量独立统计，既非变量实例展开也非原生符号表或运行值。未支持的属性/访问器/语法单列覆盖缺口。原变量表v2、标识符st-identifier-v2及无属性黄金结果保持。

工程文本快照在存在原生Property时增加`fb-property-accessors-v1`结构证据。仅文本哈希不能证明Set不存在；父FB或属性声明未变不能替代Get全文和结构核对。Get或访问器结构变化使旧编译不适用，保存重开同时核对身份、文本和结构；最终编译按实际保存结果绑定交付文件。

只在用户明确要求时做project_compare，按完整应用相对路径/类型及原生父链比较Property与Get，并表示访问器结构。旧清单/快照明确跳过同路径对象时报告覆盖缺口或正常升级冲突，不误判新增/删除或混页；损坏原文/身份/结果证据仍unknown。默认[日常流程](getting-started.md#日常修改闭环)不增加基线、比较或全工程审计。

## 验证记录与限制

独立原生探测确认工厂默认双访问器、限定清理Set、PLC_PRG属性读取、两次0错误/0警告、保存重开后按GUID/父链/全文及唯一Get结构一致。替身自动化与真实MCP、DSH CLI结果在最终交付分别归属；不能用替身或工厂readOnly标记代替原生结构/编译。调用方赋只读属性的预期编译拒绝使用另一独立负例工程，不能混入成功工程编译结论或自动增加Set修复。

本机证据目录`D:\InoPro\.local\fb-property-edit-20261110`；最终任务、编译、文件哈希及完整分支提交见交付记录。配置和源码读回/编译均非运行观测。未连接PLC、下载、运行或仿真；桌面业务、链接点击和完整设备/I/O未验。原unknown、历史11/12质量、CmpLog、脚本信任及辅助失败保留；本轮新工程零警告不表示历史CmpLog已解决。Set尚未实现和验收。


## 分支验收（2026-11-10）

固定产品c7340548f5113eb6418b8eb17744f12dd70988d5。构建、类型检查、Method/Property定向28/28及最终Python替身14/14通过；Python计入Node聚合不叠加。最终非隔离278/278，另复用本轮未变隔离代码的15项通过记录，合计覆盖293项；完整首轮292/293的临时夹具持久化EPERM保留，不写成一次完整293项全绿运行。原24项调用兼容及无属性黄金结果、变量表v2、st-identifier-v2均核对。

独立真实MCP正向47项操作：两FB的同名属性分开定位、一次Get有效修改、旧编译失效、3次编译各0错误0警告、保存关闭重开、8对象最终源码及可读任务配置核对。显式开发比较兼容验证分别得到新增7对象/PLC_PRG修改1，以及仅Get修改1，分页完整。另一独立负例8项操作取得调用方写只读属性的预期1错误0警告，错误为“Demo.CurrentState是无效的赋值目标”；Get-only结构保持，不增加Set修复。

一次DSH CLI业务任务由模型实际调用MCP：20项工程操作成功、两次0错误0警告，5对象最终读回及Get-only结构与保存文件对应，无比较或业务副本。1次Get专用参数误传普通PLC_PRG修改的拒绝、35次辅助调用和其中1次pwsh异常保留，流程效率与简短展示未全部通过；原答复单独保留，路径重复反斜杠另列勘误。服务发送的初始化及25项输入Schema/说明与本会话持久化系统/模型请求一致，不证明远端完整上下文处理或所有指令均遵循。

CLI示例通过PLC_PRG依次读取`Demo.CurrentState`、调用`Demo.ResetState()`、再读取属性。State源码初值7、Reset赋值0，只是源码和编译依据，未运行。开发端MCP工程将Get最终改为`CurrentState := State + 1;`，专门验证修改持久化，不与CLI的`CurrentState := State;`混为同一版本。

验收后原DSH0.19固定入口进程恢复，恢复后的握手/模型接收未另取证；Codex0.16不升级，Set尚未实施。原unknown、历史质量、CmpLog及脚本信任限制保持。完整证据和工程位置见本机复核包；公开Git只提交实现、测试和必要文档。
