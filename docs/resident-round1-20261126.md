# 独立第一轮实测：中文常量加载失败后停止

2026-11-26，受验诊断提交 `089a1344a8dce87f4c28667ff61afc9b67befb93`，分支 `codex/struct-field-add`。本轮按[两轮明确提交方案](resident-explicit-rounds.md)只授权第一轮。产品仍为功能分支0.39.0候选／38工具，main 0.38.0及日常入口未变。本轮没有修改诊断守卫或产品，也没有发送MCP工程请求、DSH模型任务。

**第一轮未通过。** 已实际执行一次源码替换和即时读回，但中文注释成为乱码。Python端的自洽核对通过，不能代表符合授权内容；Node独立核对正确停止。第三步读回及第二轮均未派发，没有第一轮完成回执，也没有`awaiting-round-2.json`。

## 正常维护与唯一真实轮次

用户明确允许不保存关闭旧测试实例，再只测试第一轮。旧IDE38180／创建身份639312084024821814，观察器3108／639312083885347863及辅助进程18024／639312083959015255均重新核对一致。使用原生退出及“否(N)”保存提示正常关闭。09:43:42取得旧观察器的process-exit、process-close，code=0、signal=null；随后记录正式租约释放及只读助手code=0。未强杀、删锁或手工释放。旧失败结果未改判，stdout仅追加正常关闭的空工程切换行，原前缀字节保持。

继续使用同一正常测试文件，没有复制工程：

`D:\InoPro-ResidentMemory-20261125\engineering\AM610_ResidentMemory.project`

fileId：`3318604606:281474980984855`。主文件读取前后SHA-256均为：

`89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`

新固定目录：`D:\InoPro-ResidentRound1-20261126\fixed-089a1344a8dc`。通过构建和类型检查，使用独立源快照、原登记目录及新intent；正式准入未发现本工程相关阻断。启动唯一新IDE后先取得ready和awaiting-round-1，并独立记录请求文件为零，再只提交一次round1。

|阶段|实际结果|
|---|---|
|旧实例维护|不保存正常关闭，旧IDE退出码0，租约由观察器正常释放|
|新实例就绪|IDE58628／639312544404426714，主线程就绪，提交前无工程请求|
|步骤1|打开指定工程，原生读取成功；同一primary handle 0|
|步骤2|写前版本及检查点通过；一次replace，三次该步骤内读取；已发布原生即时读回及完成回执|
|外部核对|09:48:19报`Memory preservation differs`，拒绝业务轮成功|
|后续|停止标记生效，接收器completed=2；步骤3、4、5和round2均未派发|

本轮新实例计数：open=1、read=5、replace=1、save=0、compile=0、close=0、exit=0。旧实例维护关闭／退出各一次另列，不混入新轮次。未编译，不填写错误或警告数。内存已有一次未保存修改，不能报告“没有写入”。

新实例保持打开；观察器12208／639312544265403346、只读助手61112／639312544337802441仍保留，服务与源文件租约仍由该观察器持有。接收器已停止，不能向旧运行目录补第三步或第二轮。本轮没有新实例保存、关闭或再次写入的授权；没有退出回执是保留现场的当前状态，不能写成新实例已经正常退出。

## 实际差异与可复现的编码链

原始`request-2-before.json`中的实现为原单行注释；预期只追加：

```iecst
(* 未保存连续请求：第一处注释 *)
```

原始`request-2-after.json`和`result-2.json`实际读回的追加内容以`(* æ`开头。按现有`editingView`完整复算，授权预期与实际结果的唯一依赖差异是目标PLC_PRG的implementation文本。写前后台库及非源码节点观察变化已经通过既有依赖规则，**不是本次停止原因**。

`resident_project_probe.py`中的`load_fixed`在指纹校验后执行`compile(f.read(), path, 'exec')`，输入来自`rb`字节。此前`check_native_idle_ironpython.ps1`使用`ReadAllText(..., UTF8)`再`CreateScriptSourceFromString`，没有覆盖真实loader的字节路径。

本轮停止后仅在本机IronPython2.7.7.0中加载已固定纯辅助模块并核对常量码点，没有执行native入口、工程正文或新的工程调用。结果：

- 按固定脚本中原`load_fixed`加载的COMMENTS与实际乱码读回完全相符。
- 它与预期中文不符，等于“预期文字的UTF-8字节被按Latin-1解释”的码点序列。
- 显式UTF-8解码后再编译的对照与预期中文相符。
- 固定模块指纹未变；没有用英文替代中文或放宽比较。

运行时IronPython.dll SHA-256：`dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`。因此已定位本次乱码的辅助模块加载路径；尚未修复并真实复验，不扩大为所有历史异常的唯一根因。

## 首败、派生说明及保全

保留维护阶段活跃日志共享读取限制、UI用户输入保护／缓存元素不可用、按键未关闭提示，以及准备脚本将正常stdout追加误当历史改写的首次停止。后续只读核对原stdout前缀及唯一正常关闭追加行后才继续；原准备脚本未覆盖。

`ready-before-submission.json`的PowerShell空属性投影显示`[null]`，随后同次提交前用真实目录枚举发布独立记录，证实两个请求数组均为空；旧记录保持。原派生分析将合成预期比较误标为`writeBeforeToAfter`，v2明确分开`actualPrewriteToActualPostwrite`及`expectedFromActualPrewriteToActualPostwrite`，不改原始快照或旧派生文件。协调端一次只读Python检查缺少显式UTF-8而失败亦仅属分析环境，不是工程失败。

192项保护材料在后核对时字节保持；原登记目录既有文件无内容／时间变化，仅新增本轮服务租约。工程目录在该采集时点有一项修改时间变化及新增源占用文件，逐项指纹单列；不据主文件哈希相同声称整个目录未变。新IDE继续持有现场，未来附属文件变化另行记录。

原始运行与后续只读分析根目录：`D:\InoPro-ResidentRound1-20261126`。关键入口包括`run-01`、`post-stop-analysis-v2.json`、`loader-encoding-result.json`、`maintenance-result.json`、`preservation-after.json`；先前两轮离线包仍为`D:\InoPro\deliveries\InoPro-review-20261126-092556.zip`。

下一步只建议对辅助加载边界作最小UTF-8修复，离线测试必须经过同一loader并独立检查中文码点；是否再次真实测试及如何正常处理当前未保存实例，另行明确。本轮不修guard、不继续工程、不宣称正式MCP连续问答已交付。历史unknown、默认性能、崩溃根因、CmpLog、脚本信任、Desktop和PLC运行限制继续保留。
