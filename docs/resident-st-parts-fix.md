# 根 ST PROGRAM 的原生组成标识补修（2026-11-26）

继续 `codex/resident-mcp-session`，0.40.0 候选／38 工具。main、日常固定入口和正在运行的旧固定构建均未修改。本记录承接[驱动及正常收尾补修](resident-driver-lifecycle-fix.md)，不改写先前首查版本冲突。

## 实际失败与代码依据

固定产品 `db647f4f6514ca95127ea908b5d0105a1298e9ab` 显式重新打开同一正常关闭且磁盘未变的准备文件成功。独立命令的首查不再携带打开时旧版本：操作 `d1259d71-9459-4121-b56c-adc0e7a627fd` 完整返回，但把真实根 `PLC_PRG` 排除为 `Native ST POU evidence missing`。驱动据此在写前结束该轮，`writeAttempted=false`；没有对象修改、保存、编译或关闭。原 `result.json`、`before.json` 和驱动拒绝原文均保留。

该对象原生 ID 为 `76817b8e-cf3d-4b51-82a0-fb6e8bc7c778`，POU 类型 `6f9dac99-8de1-4efc-8465-68ac443b7d08`，组成标识原序为：

1. `a9ed5b7e-75c5-4651-af16-d2c27e98cb94`：变量声明对象。
2. `3b83b776-fb25-43b8-99f2-3c507c9143fc`：已有产品确认的 ST 实现对象。

第一项来自本机 `VarDeclObject.plugin.dll`（安装目录版本 3.5.11.0；SHA-256 `fd8d90735d0a5253a351e0521883213599d132f8a632d674323c03d5b7ace1e6`）。只读元数据确认 `_3S.CoDeSys.VarDeclObject.VarDeclObject` 的 TypeDef `0x02000005`，其 `TypeGuidAttribute` 为 `0x0c000013`。对应 43 字节属性 blob 位于文件偏移 30663，值为上述大写带括号 GUID，blob SHA-256 `55804e6103df0b6f11a3c5ce7b154b5a7d50c1ca155f5c885fbc2ba0cf35ab47`，与属性表证据一致。没有加载或执行安装件；不会把未知实现标识一律当成声明区。

桥接 `object_data` 与服务 `residentObject` 原先都要求组成数组恰好只有 ST。两端现在仅允许唯一 ST，或唯一声明对象加唯一 ST 的两种排列。原数组不改写，仍参与版本和写前／写后完整依赖核对。缺 ST、重复、非文本、未知或其他混合标识仍拒绝。根归属、POU 类型、声明名称、无子对象、源码及其他保护均保留；不扩展到 Method、Property 或其他实现语言。

## 离线归属

- 使用[已归档真实快照投影](../tests/fixtures/resident-first-list-20261126.json)分别复现生产桥接 conflict 和服务端拒绝，各 1 项失败；不再打开工程复现。
- 补修后 Node 定向 **141/141**，涵盖 resident、驱动、退出及观察路径；CPython **37/37**，本机 IronPython **37/37** 分别记录，不相加、不称全量回归。
- IronPython 为 2.7.7.0，DLL SHA-256 `dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`。实际固定 UTF-8 加载器编译／加载产品模块后运行；首次归档测试在后续 engine.Execute 改变 `__file__` 时误定位 fixtures，首败保留。测试改为模块加载时固定归档路径后通过，产品不受该测试修正影响。
- 正例通过完整 list/read/change 替身路径，并逐项核对原文与全部依赖；允许的元数据在已读之后改变仍冲突，写后改变仍 unknown／冻结。服务端独立校验也检测返回元数据不符。没有真实 IDE 新写入。
- 构建、类型检查通过。Schema、版本、工具数量和初始化正文未变；静态含客户端标题口径 65,143／65,536 字节。默认环境性能问题未修。

## 本次保留实例与后续边界

IDE 64528／创建身份 `639312688397788536`，服务 70268／`639312687973855539`，驱动 56920／`639312687971300206`，launch `a74cb029-f545-44b5-89e2-8cc76513df36`。工程仍为 `D:\InoPro-ResidentMCP-Acceptance-20261126\engineering\AM610_ResidentMCP.project`，主文件 SHA-256 `8260c5bb670fa918830db8107e55207662ea496bbf14e31b2e6d88737f46286c`。最后原生快照仍是 T#5s、FALSE 及两条中文注释。产品没有写入，不据磁盘哈希宣称当前 IDE 没有后台未保存变化。

新实例的保存／关闭没有新增授权，保持打开；没有热替换运行代码或重发首轮。后续经明确正常移交，先核对创建身份并正常关闭 IDE，再以该固定驱动的 `finish DIRECTORY REFERENCE` 控制发送 EOF，分别观察 IDE、服务、驱动退出及租约结果。该命令不保存或关闭工程；迟到退出只追加观察，不自动改判。

本补修是可审查的离线结果，第一轮 T#5s→T#7s 的正式产品闭环仍未完成，第二轮、DSH、保存及编译均未执行。历史 unknown、隔离、账本、锁、原失败、CmpLog、脚本信任、未定位崩溃根因、Desktop及PLC运行边界继续保留。
