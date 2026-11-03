# 普通枚举 DUT 创建（0.11.0候选）

在`codex/enum-dut-create`扩展现有`declaration_create`，仍十九项工具；main保留0.10.0，本候选未合并。旧结构体、GVL及POU调用兼容。独立初始化不代表DSH已接收或使用扩展Schema，桌面任务另行手动执行。

## 契约与窄范围

`declaration_create`沿用requestId、projectId、targetKind=application、applicationId、parentId=applicationId、当前expectedSnapshot、name、完整declaration；objectType从gvl/structure增加enum，不新增工具或members/baseType等参数。不得传implementation。

```iecst
TYPE E_DemoState :
(
    Idle := 0,
    Running := 1,
    Fault := 2
);
END_TYPE
```

类型与成员名为ASCII标识符（字母/下划线开头，后续字母/数字/下划线，最长63字符）；TYPE名称与请求名称按既有大小写规则核对。每项成员显式有符号十进制整数，接受范围-32768..32767；成员名称（忽略大小写）及数值各不重复。不接受隐式编号、表达式、类型化或进制文字、尾随逗号、属性、显式基类型、继承、别名、子范围、数组、联合体或其他复杂形式。类型边界校验不是完整ST编译器，保留真实编译诊断。支持的声明类修改沿用code_apply_change及同样窄范围，不将结构体转换为枚举。

## 原生依据与类型表达

已在InoProShop1.9.1.6独立探测副本确认签名`create_dut(name,type,baseType)`，枚举工厂实际调用`create_dut(name,DutType.Enumeration,"")`，不是Structure工厂或普通文本对象。工厂默认文本带qualified_only/strict及enum_member:=0；创建请求仍不开放属性，按请求完整声明替换。原始参数、工厂默认全文、新GUID、父节点及原生身份记录于操作IPC的factory.json；最终按请求全文、成员及保存重开后相同身份核对。

原生DUT类型GUID与结构体共用，不能仅靠该GUID区分枚举。object_list/object_read使用objectType=enum及实际同名枚举声明，hasImplementation=false、implementation为空串；结构体仍为structure。project_search覆盖声明和名称，project_compare按原有Application相对路径+objectType匹配，原结构体/GVL/POU历史匹配不改变，不猜重命名。完整机器定义见[Schema](tool-schemas.json)。

枚举识别也限定上述显式整数窄形式；其他枚举/DUT形式作为跳过对象报告，不能用支持范围一致宣称全工程完全一致。读取可保留工厂属性文本，创建和修改仍不接受属性。旧快照若明确跳过同路径原生DUT，新快照可读为enum，工具报告该枚举不可比较和覆盖缺口，不能推断新增/删除；原匹配键不变。日常修改仍须首写前重新采集当前工作副本基线。

未取得独立dut_type/base_type/members getter。空baseType选择IDE默认，**没有独立采集到可报告的基类型名称，不宣称DINT**。本机默认枚举在显式-32768及32767、限定成员名CASE并接入程序的探测中编译成功；另一预定探测把32767改为32768后出现-32768重复枚举警告及重复CASE错误，说明越界有回绕风险，故服务和桥接提前拒绝范围外值。证据支持本机有符号16位行为及首版窄范围，不把推断伪称独立类型属性，也不承诺其他IDE/显式基类型。

上述两次为独立能力探测，正向0错误/1条CmpLog警告，负向1错误/2警告，原文均保留；不是日常工程故障或最终MCP验收结果。不在真实日常工程制造负向情况。

## 工程闭环与限制

先完整读取对象及可读任务、核对无同名并固定授权范围；首次创建前capture当前working-copy作为本轮基线。先创建枚举，再创建使用枚举变量和限定成员名CASE的PROGRAM，按授权从PLC_PRG调用。PROGRAM不会自动加入任务，不修改任务配置，不把闲置对象当接入成功。

逐项读回身份、父路径、类型首部及全文；统一编译、保存关闭重开、必要保存版复编、最终全文/任务核对，再capture同副本最终版本并比较取完分页。结果必须来自真实证据；比较不替代编译或保存。设备/I/O、完整设备配置及其他非ST不在比较覆盖内，源码初始化和CASE/调用编译不代表实际状态切换、执行顺序或运行结果。

沿用登记、隔离、串行、检查点、版本校验、去重、同名拒绝、写后读回及未知冻结。不提供新的通用回滚承诺；running查询原操作，unknown/冲突/冻结停止后续写入，不重放、删锁或换目录绕过。

自动化替身、真实MCP与DSH桌面分别记录，以本轮本地复核包中的实际结果为准。历史11/12质量未通过、答复展示问题、辅助PowerShell失败、未确认的切换准备首败、原隔离unknown及旧锁不改变，CmpLog警告未消除。接入参见[入门说明](getting-started.md)，执行规则见[工作指令](../instructions/inoproshop-workflow.md)。

## 本轮开发验证

构建、类型检查及最后冻结版本的148/148完整回归通过；之前146/147首败、修正后的147/147及中间148/148另存，不叠加次数。首败是替身未按窄枚举形式过滤旧隐式枚举，被真实结果完整性校验拒绝；修正替身，没有放宽生产校验。另一个定向首败揭示旧快照跳过DUT的新增误判，现按覆盖缺口处理，并对改变结论的旧页版本明确冲突；结构体/GVL/POU的原路径+类型匹配键保持。

同一独立AM610工作副本一次真实MCP场景：29项成功工程操作、26次原生派发，首次写入前working-copy基线；创建E_DemoState和PRG_EnumDemo，后者有枚举初始化和限定成员名CASE；PLC_PRG仅追加PRG_EnumDemo()调用。统一编译及保存版复编各0错误/1条CmpLog警告，保存关闭重开、六对象全文、同一副本最终capture及3/3/1三页比较通过。新增2、修改1、未变3、删除0、不可比0；1个可读任务未变，设备/I/O不在比较覆盖。实际工厂参数与声明/身份均有原始IPC依据，无独立枚举getter。

最终比较覆盖防护完成后，仅从原真实capture重新比较3页，不重新采集、不启动IDE、不修改/编译/保存；结论与原正向场景相同，磁盘哈希与最后编译一致。来源样例及本轮独立源未变，附属.opt/projectbackup单独列出，未声称整个目录不变。源码初始化、CASE分支和程序接入是离线编译证据，不证明运行时状态/结果。

独立初始化实际返回0.11.0、十九工具、新Schema和完整指令；指令39508 UTF-8字节，计入本机客户端标题39535，低于原65536上限。解释语义与答复展示规则正文保持，不追加重复条款。尚未确认DSH窗口空闲/无未发送输入，不自动重载；另一份桌面源只复制未打开，用户手动任务待验。不能以开发端结果代替桌面接收或使用。
