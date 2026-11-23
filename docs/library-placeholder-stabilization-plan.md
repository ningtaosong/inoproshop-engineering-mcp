# 占位符清除探测：目标创建前稳定准备补丁（仅离线复核）

2026-11-23，补丁基于 `7a4a929baf5536124437a9c8297bfdf0f1df2e5a`，留在 `codex/library-placeholder-clear-probe` 工作区供协调方复核，未提交、未推送。产品仍为 **0.36.0 / 37 项工具**；本轮没有启动 IDE、工程服务、DSH、模型任务，没有新建或打开工程，没有变更配置、登记、租约或锁。

## 原停止记录保持

现场：`D:\InoPro-PlaceholderClear-20261123-120000`，操作 `7c95b0e0-834b-446f-9f0b-ddce57964b69`。

- `prepare` 创建占位符及设置覆盖各一次，保存一次；独立 `baseline` 打开后与保存状态相同，真实编译完成，**0 错误 / 0 警告**，随后完整状态比较失败。
- `baseline-initial.json` 为 13 项引用；`baseline-baseline-build-readback.json` 为 19 项。原 13 项字段与顺序完整保留，追加六项系统占位符；源码、任务及其他采集状态保持。首个差异是库配置版本，不是未知的任务换序。
- 原生结果为 `failed`、`closed=true`；两次 IDE 的进程创建身份与外部退出对应，均 `code=0 / signal=null`。观察器仍为 `unknown`，`timedOut=false`。launcher 原错误文字含 timeout 是诊断误报，不能据此改写原记录。
- 正式清除、清除后保存、独立重开与保存版编译均未执行。当前磁盘 SHA-256 为 `7e8adffe31b12dae8812ec9069c8939ac0c7eff8a8b8a166c0ffcaa192fe63c7`，不能把它当作清除版文件。
- 原服务租约和源锁保留。owner 已消失/stale 不是正常释放，更不是可绕过派发保护的依据。本补丁不处理该保护条件，不提供重放、恢复或重新执行命令。

原 `baseline-result.json`、`baseline-observation-complete.json`、`probe-stopped.json`、检查点、失败及退出记录不覆盖。两个更早 prepare unknown 及历史 MCP unknown、隔离材料同样不动。

## 六阶段方案

[原生脚本](../scripts/probes/library-placeholder-clear-native.py)及[launcher](../scripts/probes/library-placeholder-clear-launch.mjs)使用以下固定序列。该序列尚未做真实工程验收。

| 阶段 | 目标与核对 | 占位符准备写入 | 正式清除 | 保存 | 编译 |
| --- | --- | ---: | ---: | ---: | ---: |
| `stabilize` | 已核实中性 AM610 种子，不含测试占位符；首次编译只允许下表六项精确新增；完整读回后保存，关闭 | 0 | 0 | 1 | 1 |
| `stable` | 独立 IDE 重开，与上阶段保存状态完整比较；复编后必须完全稳定，不套用新增例外；关闭 | 0 | 0 | 0 | 1 |
| `prepare` | 独立打开，与 stable 编译后状态完整比较；之后才创建普通测试占位符、设置覆盖并保存 | 2 | 0 | 1 | 0 |
| `baseline` | 独立打开准备版，目标、完整清单及保留项核对，编译后严格相等 | 0 | 0 | 0 | 1 |
| `clear` | 原同句柄守卫、检查点，唯一 `set_redirection(None)`；即时核对、编译，通过才保存 | 0 | 1 | 1 | 1 |
| `verify` | 独立重开清除版，完整读回及保存版编译；不再保存 | 0 | 0 | 0 | 1 |

计划成功路径共 **六个独立 IDE 进程、三次保存、五次编译**。前三次编译属于准备（含 baseline），后两次属于正式清除验证；本轮实际均为零。`stabilize` 是允许编译派生配置并保存的准备阶段，不能称为只读。

每个后继阶段绑定前一阶段 intent、result、退出观察和状态快照的实际 SHA-256；核对同一 operation / project、前后磁盘版本、独立进程创建身份、正常关闭与退出、计数，以及原生脚本、guard、固定辅助、记录器、观察器、launcher 和阶段定义的代码指纹。缺证、跳阶段、不同代码版本或非成功前序均在打开工程前拒绝。没有删除代码指纹校验以拼接旧操作。

## 六项例外的精确边界

中性种子 SHA-256 固定为 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`，限定本机 1.9.1.6、AM610 `4102 / 10f4 0002 / 3.5.11.11`。`ClearProbeOwned` 和下列六项在首次编译前均不得存在。

| 新增顺序 | 原生占位符名称 | 命名空间 | 默认声明 | 有效解析 |
| --- | --- | --- | --- | --- |
| 1 | SM3_Basic | SM3_Basic | 4.2.2.0 | 同默认 |
| 2 | SM3_CNC | SM3_CNC | 4.2.1.1 | 同默认 |
| 3 | SM3_Robotics | SM3_Robotics | 4.2.2.0 | 同默认 |
| 4 | SM3_Robotics_Visu | SM3_Robotics_Visu | 4.2.0.0 | 同默认 |
| 5 | SM3_Transformation | TRAFO | 4.2.1.0 | 同默认 |
| 6 | IecVarAccess | IecVarAccessLibrary | 3.3.1.20 | **3.5.11.0** |

前五项厂商串为 `3S - Smart Software Solutions GmbH`，最后一项为 `System`。代码核对完整原生字符串，表格版本简写不用于实际判断。还严格核对 `system_library=true`、`is_managed=false`、`is_redirected=false`、`explicit_redirection=null`、qualified/optional 标志、resolver GUID、原生 resolution_info、字段覆盖、所属库管理器、路径和顺序。IecVarAccess 的默认与有效版本不同，不合并这两个字段。

新引用的数字 ID 从当前完整读回取得，要求合法且不与任何现有项重复，不硬编码旧工程 ID；除此之外，新增行按精确定义构建比较视图。原列表逐项保留，未知字段仍比较，新增字段不能静默通过。只更新已证明必变的列表计数及用固定原生采集算法重新计算的两个版本哈希；存储哈希也必须可重算。源码、任务、设备及其他状态无豁免。现有 target、preflight、after_clear、clear_once 的授权修改范围不变。

## 失败、关闭与诊断

可信原生 `failed + closed + exit 0` 的观察结果仍为 **unknown**，保留原生首错和阶段，诊断为 `native-failed-closed-exit-zero`。不会自动释放租约、改判旧结果、继续下一阶段或重试。超时、信号/非零退出、身份或记录器问题分别保留，不能凭结果文件或退出码单独判成功。

`stabilize` 一旦派发首次编译，就可能已有内存配置变化；失败时不套用原“只读失败关闭”分支。保存已派发也明确阻止该分支。离线反例覆盖：编译新增不符（保存 0）、保存后比较失败（保存恰 1）、保存后读取抛错及首错记录器再失败。均保留 unknown、首次异常及现场，无恢复性保存、回滚、后续派发。其余原来允许的无写只读失败关闭规则不扩张；launcher 对 failed 仍保留租约。

## 离线证据与归属

本轮记录目录：`D:\InoPro\deliveries\placeholder-clear-offline-20261123-130013`。

| 检查 | 结果与范围 |
| --- | --- |
| 修复前生产比较复现 | `before-failure.json`；旧两份真实快照通过原 guard.equal 得到 configurationVersion 差异。旧输入未改 |
| 新阶段 Python 检查 | **32/32**；真实快照反例、严格字段/身份/覆盖、版本与阶段链、提取实际 native run/work/build/guard/save/close 的替身分支 |
| 原清除 guard 回归 | **30/30**，单独计数 |
| 入口记录回归 | **12/12**，单独计数 |
| CPython 固定加载器 | **11/11**，单独计数 |
| Node 阶段调度 | **23/23**；六阶段顺序，每阶段失败停止，计数/磁盘/进程证据，真实 baseline 失败诊断 |
| Node 退出观察器 | **21/21**；包括迟到、非零、缺失、发布失败及首错保留 |
| 本机 IronPython 2.7.7.0 | **8/8** 完整脚本与必要模块解析编译通过，正文未执行；另 **11/11** 审阅过的合成加载器测试通过 |

各组不相加，不是产品全量回归或工程验收。IronPython DLL SHA-256 仍为 `dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`，原始 manifest / compiler report 留存。固定产品没有改动。

正例把真实新增六行投影到原 `prepare-initial` 的 12 项中性输入，重算位置与配置版本；**这是明确标注的合成中性首次编译结果，不能写成已实测的 12→18 保存记录**。真实 13→19 输入在新 first-stage 守卫下仍拒绝，因为测试占位符已存在。旧严格失败没有被“修好”为历史成功。

尚需后续单独授权并满足正式租约/隔离条件后，验证中性首次编译确实只出现上述六项、其保存及独立重开稳定性，再进入 prepare。若有额外变化、顺序变化、有效解析改变或缺证，方案仍停止。当前未证明编译插件回调的完整因果链，也未取得正式清除、清除后的解析回退、保存持久化或保存版编译正例。本补丁不授权重新打开 120000 或更早封存现场。

历史 unknown、默认性能、崩溃根因、CmpLog、脚本信任、Desktop、PLC 及运行边界保持。[此前 IronPython 修复](library-placeholder-ironpython-compatibility.md)仍属于原一次无工程加载验证，不被本轮离线检查重算。

## 后续归属

上文为13:00离线准备时点的原记录，后续执行、首败和[正常解析基线正例](library-placeholder-normal-baseline-probe.md)分别归档。现将本补丁和后续修正单独提交保全，不改写上文的当时结论。
