# Application 内原生文件夹与 ST POU 移动（S3）

0.22.0 候选分支扩展 `folder_create`、`object_move`，共27项工具。原25项输入保持兼容；结构查询输出增加 `folder` 类型、`organizationScheme` 和 `organizationVersions`，不是旧输出Schema逐字不变。登记仍为v2，租约身份及Linux异常分支补修不变。本分支尚未合并main，部署与Git状态分别核对。

## 支持范围

- 仅在精确Application直接根节点创建原生文件夹，名称为1..63字符的单个ASCII IEC标识符。
- 在该Application根节点与直接原生文件夹之间，原生移动ST PROGRAM、FUNCTION、FUNCTION_BLOCK。原生GUID保持，不复制删除，不改名。文件夹间直接移动首版拒绝，可由明确的两次根节点移动任务分别授权；不自动代拆请求。
- FB可以整体携带本工具已支持的PUBLIC ST void/DINT Method及PUBLIC DINT只读Property/Get、可读写Property/Get/Set。子对象随父FB移动，原GUID、相对父链、访问器结构和源码保持；不单独移动子对象。未知或不支持的子结构拒绝。
- 不移动GVL、DUT、设备、任务、库、系统节点、文件夹，不跨Application/工程，不新建嵌套文件夹。既有GVL/DUT读写根节点限制保持。

本机InoProShop 1.9.1.6原生接口为 `Application.create_folder(name)`（返回None，按新子节点差异核实GUID），`ScriptObject.move(new_parent, -1)`。原生folder类型为 `738bea1e-99bb-4f04-90bb-a7a567e74e3a`，同时核实 `is_folder`。PROGRAM/FUNCTION/FB及Method、可读写属性的整体移动、移回、保存重开和调用编译均有独立探测；产品验收证据与自动化替身另列，不推断设备或运行行为。

## 请求及结果

先调用 `project_structure`，取得目标工程的实际GUID、路径和父节点。页面 `version` 用于续页；`organizationVersions[applicationId]`（`application-organization-v1`）用于结构写入，不能混用。该结构版本绑定工程登记身份、Application、稳定原生节点的GUID/父链/名称/路径/类型及可读取源码哈希；系统非源码分支只保留根节点，原生任务调用包装节点不作为持久身份。可读任务配置另外在写前和保存重开后核对。版本采集失败时保留原生树及其原有缺口，另列 `organizationFailures`；缺少对应Application版本时不得用旧值写入，也不能推断对象不存在。结构版本与原生树枚举完整性分别判断。它不代表完整设备/I/O配置。

```json
{
  "requestId": "由Agent为本次业务生成并保留",
  "projectId": "实际工程GUID",
  "applicationId": "实际Application GUID",
  "parentId": "同一Application GUID",
  "name": "Alarms",
  "expectedStructureVersion": "project_structure返回的对应结构版本",
  "expectedDiskHash": "当前diskHash"
}
```

上例是说明字段关系的占位示例，GUID/哈希须由工具取得。`object_move` 改用 `objectId`、`sourceParentId`、`targetParentId`，以及相同版本字段，不接收名称或源码。创建后返回新folder的 `object.objectId/path` 和 `structureVersion`。每次操作后重新读取结构/版本，不拿旧定位或旧分页修改当前位置。

写入前核对精确身份、当前结构、磁盘、原生权限、同级重名，保存真实检查点；检查点后再次核对。移动到原位置返回 `changed=false/noOp=true`，不移动或保存。同一requestId返回原操作；不为重试换编号。成功须核对全部被采集稳定节点的唯一GUID及父链，除授权新增/路径变化外源码与结构保持，原位置消失、目标只有一个原对象，可读任务配置保留，并保存关闭重开。完整证据留在原IPC，工具返回已核验摘要及目标身份，不伪造ST文本变化。

移动前、原生调用后及保存重开后还独立核对ST语言标记、声明/实现是否存在，以及Property的实际访问器结构；空实现哈希相同不能代替这些元数据。完整子结构证据保存在操作IPC。部分完成、读回、保存或重开不确定时冻结并保留现场，不反向移动、不删除、不回滚。running查询原操作；unknown/冲突/冻结停止后续写入。结构事务和自动回滚没有新增保证。

## 日常流程及比较

必要读取定位 → 创建/移动 → 真实编译 → 保存关闭重开 → 按保存结果必要复编及目标读回。仍直接处理指定.project路径，不生成业务副本，不默认全工程通读或比较。结构操作内部的源代码/结构/任务保全核对属于写入保护，不是调用 `project_compare`。

移动后普通POU、Method及Property/Get/Set继续按GUID读取/编辑，工具返回实际新路径。变量/初始化成员及literal/identifier检索使用新路径和当前版本；旧磁盘版本页面应重新首查，不当成证据损坏。变量表v2、成员解析v1、st-identifier-v2词法语义保持。

明确请求比较时，`project_compare`仍按Application相对路径+对象类型匹配，移动可表现为旧路径删除、新路径新增，不宣称语义移动识别；是否原生移动以GUID/父链及结构证据为准。空文件夹不属于ST/任务比较覆盖，不能用源码比较证明其存在。结构或磁盘改变后旧编译不代表新文件通过，须新编译。

编译及保存核对不代表运行、实际调度或完整设备配置验证。原隔离unknown、旧锁归档、历史11/12质量结论、CmpLog和脚本信任限制不变。Codex0.16不升级，不宣称其支持此能力。

## 本轮验证记录

结果及提交归属见本轮交付复核入口；原生探测两项脚本首败、定向首败和修正均保留。工程闭环、DSH流程遵循、答复展示分别判断，不累加重复测试，不把初始化握手等同于模型遵循全部指令。
