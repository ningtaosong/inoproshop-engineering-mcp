# 常驻诊断辅助模块 UTF-8 加载补修

2026-11-26，基于 `codex/struct-field-add` 的 `d4ac294b082620f22710b03e2ddd3ef8b8ab715c`，仅修独立诊断脚本的加载边界。当前分支产品仍为 0.39.0 候选版、38 项工具；main、产品、Schema、初始化指令、日常入口、其他 loader 和工程比较规则均未修改。

## 已确认问题与最小修改

[首轮真实失败](resident-round1-20261126.md)已在实际写后原文中留下中文乱码。本轮用当时固定脚本中的原 `load_fixed` 和同一纯辅助模块，在本机 IronPython **2.7.7.0** 重现：两个中文常量均被按 UTF-8 字节的 Latin-1 码点解释；中文拼接结果不符合授权文本。原失败与当前未保存现场不改判。

修复仅在 [`resident_project_probe.py`](../scripts/diagnostics/resident_project_probe.py) 的 `load_fixed` 内：

1. 以 `rb` 读取一次，SHA-256 校验同一字节缓冲区。
2. 对该缓冲区执行严格 UTF-8 解码，再以原始文件名编译。
3. 保留同一个全局／局部命名空间及原异常传播；指纹不符、非法 UTF-8 在辅助模块正文执行前拒绝。

没有英文替换、容错解码、中文比较豁免或工程守卫变更。也消除了原函数先校验再重新读取模块的时间窗口：读取后磁盘变化不会使未经校验的第二份字节进入编译。

运行时 `IronPython.dll`：`D:\InProShop\CODESYS\PlugIns\dc937c18-e9f0-434d-85b7-1b8f499e378a\3.5.11.10\IronPython.dll`；SHA-256 `dd1c117117dbd0cc7f036072855b1b9058a4930f6ef0a4bdedb8858c88a771bf`。原 loader 脚本 SHA-256 `28de084bdfdcff502df2ffb5388bf58c617be4d630c220dbb98676b750db14b2`；修复脚本 `2dcdcd50531e87f4856895bcf9cc12c9d4967909bed79a1a15fbb1b04364df19`。

## 离线验证归属

[`test_resident_fixed_loader.py`](../scripts/diagnostics/test_resident_fixed_loader.py)从实际脚本提取原 `sha`／`load_fixed` 定义并调用，没有另写等价 loader；完整脚本另做解析编译，不执行 `start()`。测试载入实际纯辅助模块；两个预期中文常量及拼接文本使用独立 Unicode 字面码点。还覆盖跨函数全局名称、CRLF、同一缓冲区、指纹／非法 UTF-8 拒绝且正文零执行、编译文件名、首个辅助异常及文件缺失。测试临时哨兵目录保留，不递归删除。

同版运行命令（仅离线测试）：

```powershell
powershell.exe -NoProfile -File scripts/diagnostics/check_resident_fixed_loader.ps1 -Probe <固定的resident_project_probe.py路径> -Module <同版本resident_project_session.py路径> -Output <不存在的结果文件路径>
```

结果分别记录，不合并计数：

| 检查 | 结果 | 归属及限制 |
|---|---|---|
| 原 loader，同版 IronPython | 11 项中 5 项按修复目标失败 | 中文常量、拼接、中文跨函数结果、重复读取、非法 UTF-8；`ironpython-before-v4.json` |
| 修复后的实际 loader，同版 IronPython | 11/11 | `ironpython-after-final.json`；不是仅以宿主 `ReadAllText` 代替被测加载路径 |
| 修复后的实际 loader，CPython | 11/11 | `cpython-loader-final.json`；不代替 IronPython 证据 |
| 既有会话离线回归，CPython | 94/94 | 本轮一次，`cpython-session.json` |
| 既有会话离线回归，IronPython | 95/95 | 本轮一次，另含 CLR 专用用例；四份完整脚本解析编译通过 |
| 既有 Node 观察器／提交器 | 31/31；11/11 | 各一次独立测试集，无实际工程请求 |

早期测试记录器自身的临时文件句柄和 JSON ASCII 编码错误保留在 `ironpython-before.json`、`-v2.json`、`-v3.json`，没有形成完整用例计数，不混算为原 loader 的五项失败。`-v4` 与首次修复后结果使用同一测试版本；之后只将合成临时目录改为保留，再复核实际 loader 的 11 项，旧结果不覆盖。具体脚本指纹见各结果的 `inputs`。

## 现场与下一步

本轮启动 IDE、工程请求、修改、编译、保存、关闭和退出均为 **0**。只读核对仍为原 IDE `58628`、观察器 `12208`、辅助进程 `61112`，创建身份与既有记录一致；没有请求重新运行、提交第二轮或清理租约。192 项历史保护文件及两份租约字节与原归档一致；工程主文件 SHA-256 仍为 `89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173`。这些是文件与进程观察，不冒充重新读取内存状态。

当前 IDE 仍保留上轮一次未保存修改；原第一轮失败、接收器停止、没有第三步和第二轮的事实不变。辅助文件另按采集时点记录，不能由主文件哈希推断整个目录不变。没有授权关闭或保存当前实例。

结论只到：**中文加载边界已离线修复；未进行新的真实工程复验，也未接入产品常驻会话。** 后续先明确如何正常处理当前未保存实例，再使用新固定脚本安排一次明确提交的真实轮次；不能让已停止接收器补跑、补判原成功或自动连续执行下一轮。

证据目录：`D:\InoPro-ResidentLoaderFix-20261126`。原始真实失败包：`D:\InoPro\deliveries\InoPro-review-20261126-095653.zip`（SHA-256 `bfa51f9e4534d9259a2750e7c4ddc8ece513781de13c214d68badf751d31be0f`）。本轮复核包入口含修改、运行时／源码指纹、首败、完整结果和文件保全；不重复打包工程或私人配置。历史 unknown、默认性能、崩溃根因、CmpLog、脚本信任、Desktop 和 PLC 运行限制继续保留。
