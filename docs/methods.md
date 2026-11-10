# 功能块原生 ST Method（S2a）

0.19.0候选版新增 `method_create`，共24项工具。读取、修改复用object_list、object_read、code_apply_change；不增加通用脚本执行通道。原23项调用继续兼容，相关输出增加Method元数据，code_apply_change增加显式method目标及parentId。登记仍为v2。

## 支持范围

精确Application内、当前用户工程树中ST FUNCTION_BLOCK的直接原生子方法。首版只开放显式PUBLIC及无返回值（returnType=void）或DINT；普通局部、输入、输出和输入输出声明沿用限定ST读取范围。Property/Get/Set、继承、接口、重载、改名和删除未开放；带继承或接口首部的父 FB 拒绝作为本轮写目标。修改现有Method保持原名称、访问级别、返回类型和父关系，不以普通FUNCTION或父FB文本拼接代替Method。

本机InoProShop1.9.1.6实际接口为 `fb.create_method(name, return_type, ImplementationLanguages.st)`。无返回值传空字符串，DINT传原字符串；工厂无访问级别参数，默认声明省略PUBLIC，随后写入明确的METHOD PUBLIC原生声明并实际编译。方法原生类型标识为f8a58466-d7f6-439f-bbb8-d4600e41d099，父FB为原POU类型。没有取得独立访问级别、返回类型getter；证据来自工厂参数、原生类型/父GUID和声明全文，不冒称独立属性读取。

## 创建和修改

先用object_list/object_read确定真实父FB和Application，用object_read读取父FB当前全文/contentHash，snapshot、diskHash从当前session_status会话或最新成功写响应取得并核对磁盘，不假定object_read包含snapshot。method_create提交：

```json
{
  "requestId": "<Agent生成的唯一请求>",
  "projectId": "<实际工程GUID>",
  "applicationId": "<实际Application GUID>",
  "parentId": "<实际父FB GUID>",
  "expectedParentHash": "<当前父FB contentHash>",
  "expectedSnapshot": "<当前含子方法的工程文本快照>",
  "expectedDiskHash": "<当前磁盘哈希>",
  "name": "ReadState",
  "access": "PUBLIC",
  "returnType": "DINT",
  "declaration": "METHOD PUBLIC ReadState : DINT\nVAR_INPUT\nEND_VAR",
  "implementation": "ReadState := State;"
}
```

无返回值示例首部为METHOD PUBLIC ResetState，returnType显式void，不写冒号或返回类型。名称、访问和返回声明不符、额外Method/不支持声明区会拒绝；完整ST语法仍需真实编译。用户只需工程路径、父FB名称及需求，Agent内部查询GUID、版本和操作引用。

code_apply_change修改Method时显式objectType=method、parentId、objectId、expectedHash及完整声明/实现。同父同名子对象拒绝创建，不覆盖；不同FB同名方法按父GUID和完整路径区分。父内容/相关子对象快照或磁盘变化、跨Application、错误父类型、库树及原生对象权限拒绝均停止。创建前验证父对象Modify/AddRemoveChildren权限，修改前检查目标及父Modify权限；check_permission(False)不弹登录/权限提示、不修改权限。工程文件只读/写ACL也检查。

沿用原串行队列、持久化请求去重、检查点、写后全文读回和保存关闭重开。Method部分创建或写入、保存、关闭或重开不确定时报告实际阶段与已做动作，冻结后续写入；不自动删除新对象、覆盖回滚、改名重试或换目录。running查询原操作；unknown/冲突/冻结保留现场。

## 查询、快照和编译

Method以objectType=method返回，含parentId、parentPath、access和methodReturnType。检索及声明查询保留对象身份；Method返回声明单列method-return，不算变量实例。原变量表v2及初始化成员查询、literal/identifier和st-identifier-v2保持；没有Method的历史黄金结果和分页身份不变。已知旧清单跳过Method时，核实原证据后明确升级冲突、要求重新首查，不自动派发；损坏证据仍unknown。

内部工程文本快照递归包含Method的GUID、完整父路径、声明及实现。父FB文本未变不代表子方法未变；方法变化使旧编译不再适用于新版本。保存关闭重开仍核对全工程文本快照，另对目标方法按身份和全文读回。

只有用户明确要求时调用project_compare。方法按Application相对完整父路径和类型匹配，并核对原生父身份；同名不同FB不合并。旧快照明确跳过同路径Method时标不可比较/覆盖缺口，不误报新增或删除。其他对象原匹配规则保持。未支持子对象或Method声明会明确列出；不把部分查询称为完整工程符号表。

## 日常使用及验证边界

遵循[日常流程](getting-started.md#日常修改闭环)：指定路径、必要读取、创建/修改、真实编译、保存关闭重开、必要复编及目标读回。PROGRAM/方法创建不会自动增加任务调用；从FB实例实际调用方法，并接入已被任务调用的程序后编译。不默认采集基线、比较或全工程审计。

独立原生探测已验证PUBLIC void/DINT方法、FB实例调用、保存重开后按GUID/父关系/全文相同，以及两次0错误/0警告编译。首轮选择同名任务调用包装节点失败；后续按枚举顺序比对误报，逐身份离线核对确认只改变顺序，保留原失败，未重放创建。保存版补证只读取已有探测文件并编译。开发端MCP、DSH CLI和自动化结果在本轮最终交付记录分别归属，不由原生探测代替。

配置、源码和编译不是运行观测；State初始7、ResetState赋0不能写成已观察到运行输出。没有PLC连接、下载、运行或仿真，没有桌面业务或链接点击验收，也不包含完整设备/I/O核对。原隔离unknown、历史质量、CmpLog、脚本信任及辅助失败记录保留。S2b未开始。


ST 身份取自公开的 `embedded_object_types`：已核对嵌入类型 `3b83b776-fb25-43b8-99f2-3c507c9143fc` 与本机 ST 实现类的 `TypeGuidAttribute` 一致。父 FB 和 Method 均须具有该标识，无法读取或非 ST 时不纳入支持；不能仅凭“有文本实现”推断为 ST。这里没有声称存在独立的访问级别或返回类型 getter，访问级别与返回声明仍由原生 Method 类型、工厂参数及全文首部核对。

能力探测中的 PLCopen XML 导出在本机 OEM 组件构造阶段失败，原异常保留；产品没有使用该失败入口。原生保存重开探测另有一次断言仅因子对象枚举顺序改变而失败，按 GUID 逐项核对全文与父关系一致后，独立只读重开及保存版编译通过。替身测试不计作 IDE 验收。

旧Schema客户端须正常加载新定义；原调用参数保持兼容，不等于旧客户端已能识别新增Method对象类型。


## 本轮验收归属（2026-11-10）

构建、类型检查及最终分组278/278通过（修正后263项；复用本轮未改15项隔离，不是一轮278项全绿；Python桥接13项计入聚合）。真实MCP验证3个原生方法、同名不同父FB、一次有效方法修改、任务调用接入、旧编译失效、保存重开及完整按需比较；3次编译均0错误0警告。独立DSH CLI一次模型任务完成19项工程操作，两次0错误0警告，保存版复编和最终四对象/可读任务核对一致，不比较、不建业务副本。

真实MCP发现桥接白名单和比较输出Schema两个漏项，已修正并补入口/真正stdio输出测试。缺参、过期比较目标拒绝及首败保留；保存后的成功工程步骤没有重做。分阶段记录明确区分原生探测、替身回归、开发端MCP和模型CLI，不把旧结果改记为后续修正版本实测。

DSH CLI工程结果通过，流程与展示未完全通过：7次辅助调用，3次pwsh失败，含不必要的等待；原答复偏长且末行路径写成双反斜线。原始答复和勘误保留，不为美化展示重跑业务。初始化指令及24工具在客户端持久化记录中对应，实际方法调用已验证；远端全部上下文处理不可据此宣称。

验收后恢复原DSH0.18固定入口进程，恢复握手/模型接收未另验；Codex0.16入口不升级。使用本能力须在空闲时正常加载固定0.19候选构建及新Schema，沿用原数据目录；旧入口不能据文档自动视为已加载。原unknown、历史质量、CmpLog、脚本信任、桌面/点击和运行限制继续保留。本轮没有消除历史警告或确认辅助pwsh崩溃根因。


## 合并收尾（2026-11-10）

本能力已合入main，保持0.19.0候选版、24项工具。原23项调用兼容，Schema包含新增Method类型、父关系和方法修改参数；旧客户端须正常加载新定义，不能据此认为已支持Method。本轮没有改变产品、桥接、解析器、Schema或已验工作指令，没有重跑回归、模型或工程任务。

复用上节分阶段证据：263项新跑，另复用同版15项隔离结果，合计覆盖278项，不是一轮278项全绿。CLI流程/答复和辅助失败、原unknown及历史限制保持。上节恢复0.18的描述是当时状态；本次固定0.19部署及实际各连接握手单列于本机复核记录，不把服务发送当作模型已遵循全文。Codex仍是原0.16入口。S2b尚未开始，后续先做只读属性Get。
