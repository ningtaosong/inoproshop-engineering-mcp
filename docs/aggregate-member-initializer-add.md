# 已有聚合补写显式成员初始化（0.35.0 候选）

分支 codex/aggregate-member-initializer-add，37 项工具；未合并 main、未部署。产品及本轮离线、真实验收归属 **49c51727b5aa178fa45d27d411b0d4738352cebd**，基线 cda49335cac0790edf2b40e8a0cc87380411f724。后续提交只整理文档。

## 范围与实现

[variable_edit](variable-edit.md) 新增 add-member-initializer：同 Application 根 GVL 普通 VAR_GLOBAL 的已有唯一单变量，类型为同 Application 根、原生身份明确的 ST 结构体 DUT，父变量已有完整非空具名聚合。只补写尚未显式初始化的唯一直接 BOOL／DINT／TIME 字段；DUT 字段必须已经存在。旧 set-member-initializer 继续只修改已有显式成员。无初始化、空或不完整聚合、大小写重复、嵌套、数组、特殊声明、库类型或其他声明区拒绝。

服务在队列内完整重读 GVL、DUT 和对象清单，验证身份、路径、类型及工程／源码／磁盘版本，不用分页零命中证明不存在。规划为真实外层闭括号前的零宽插入；桥接将 LF／UTF-16 坐标映射回原生原文，复用已有文本 replace 接口，传入原串加该次插入后的内容，不重建或排序聚合。原成员、空白、注释、CRLF 和中文保持；写后及重开核对原文哈希、DUT 与授权结果。

检查点、去重、可信退出、unknown 冻结和首次异常保全沿用原机制；直接及旧副本模式均不反向修改或恢复性保存。不新建 DUT 字段，不代表 S4b 全部完成。

## 离线验证

| 组别 | 结果 | 环境 |
| --- | --- | --- |
| 新增 Node 定向 | 58/58 | 独立 TEMP；含生产服务及桥接替身包装 |
| Node 完整回归 | 860/860 | 独立 TEMP temp-full；原200ms阈值不变 |
| 新增 Python 定向 | 3/3 | 生产 dispatch 及原生 API 替身；方法内子例不另加 |
| Python 完整回归 | 619/619 | 本机默认 Python 环境，无 IDE |

各组不相加。构建、类型检查通过。其他36项输入输出 Schema 指纹不变；variable_edit 仅增加动作枚举，原动作语义和输出 Schema 保持。

保留首轮默认 TEMP 定向56/57、第二轮57/58：用例先读取了不支持的 DUT，并错误假定成功或在已冻结替身继续断言；修正测试准备后通过，未放宽产品拒绝。0.34.3规划器的缺失成员拒绝另有离线记录。历史默认环境200ms问题仍保留，独立目录通过不能覆盖它。

## 真实 MCP

两份夹具均由 project_create 原生创建，再用 declaration_create 准备 DUT／GVL，没有复制封存工程。准备阶段每份编译一次，均0错误／0警告，与正式业务分开。

MCP正式只派发三次新动作：
- Config2 增加 Enable := TRUE，原 DelayTime := T#5s、Count := 7 和注释保持。
- ConfigCount 增加 Count := -2147483648，多行、中文注释、原 Enable／DelayTime 保持。
- ConfigTime 增加 DelayTime := T#60000ms，原 Enable／Count 保持。

三次写后、保存重开及原文证据通过，DUT、PLC_PRG、MainTask可读配置及绑定保持。修改后编译0错误／0警告；明确保存关闭重开后文件哈希变化，故再作保存版编译，仍0错误／0警告；最终源码和任务读回通过。未调用 project_compare。

工程：D:\InoPro-AggregateMemberAdd-20261122-163032\mcp-fixture\engineering\AM610_Aggregate_mcp-fixture.project
最终 SHA-256：1b1f1823f224adcbaadde7286297c71c0d94dd3e4f8f13916142a7fe8c2318d3
保存版编译操作：5e9c5b0e-4654-419a-a102-a210c602ecc3，与最终文件哈希相同。

## 唯一一次 DSH CLI

复用已验安装版 CLI、账号依赖和临时 headless 配置，日常及 Codex 配置未改。同一正式连接初始化0.35.0，取得完整37项工具；原始 tools/list Schema 摘要与开发端一致。模型实际调用新动作一次，只给 Config2 增加 Enable := TRUE，其他成员、变量、DUT和任务保持。修改后和保存版各编译一次，均0错误／0警告；保存关闭重开、最终GVL／DUT和task_inspect读回通过。

工程：D:\InoPro-AggregateMemberAdd-20261122-163032\cli-fixture\engineering\AM610_Aggregate_cli-fixture.project
最终 SHA-256：65d4ac80259872c03c8c0cf43a5ce2f8bf5348a3db742c3aa2978539b960d9d8
保存版编译操作：3dfd9089-8746-4300-86ad-2ae8caaf7bf4，与最终文件哈希相同。

固定构建初始化指令含客户端标题为 **63,474／65,536字节**；CRLF开发工作区为63,774，固定Git归档为LF，两种口径分开。

工程与授权动作通过；流程效率与展示部分通过：50次工具调用含29次operation_status、6次session_status；project_list和一次variable_inspect的CLI展示被截断，保留原事件，没有当作完整文本。无参数拒绝、历史操作查询、冲突或新unknown。原答复基本准确但偏长；工程链接依据实际路径呈现，未点击验证。本次未触发停止条件，不能宣称任务级强制停止已验。

独立发现连接server/discover=-32601且缺少退出事件；正式服务及CLI退出0。观察器是元数据记录，不是完整CLI协议正文，也不证明指令全文进入模型上下文。首次离线汇总误将截断列为拒绝，并使用SDK解析后属性顺序计算Schema摘要；原汇总保留，随后按原始协议口径修正，没有重发任务。

## 保全与复核入口

开发端含准备39次、CLI业务16次真实IDE启动，55次均有绑定请求、launchId、PID创建身份、结果及正常退出证据。收尾无活动Desktop、IDE或工程服务，最终stale租约保留，未删锁。

主工程按授权变化。MCP个人opt、projectbackup字节变化，AllUsers.opt字节未变；CLI两个opt字节未变，projectbackup字节变化。修改时间另列，不宣称目录未变。

27,663项事前路径记录和346项原日常固定文件已核对；既有字节变化仅为登记正常新增／更新本轮工程，新账本和IPC单列。历史unknown、隔离、旧IPC／检查点和封存现场未改判或恢复；日常0.34.3固定入口、回退构建及Codex配置保持。

本地证据根：D:\InoPro-AggregateMemberAdd-20261122-163032。ZIP的INDEX.md进入差异、契约、首败与通过日志、MCP原协议、CLI唯一任务／调用／答复、退出证据、编译和文件指纹。

预检曾因离线回归短时替身服务停止，待其退出才开始真实MCP。固定指纹初检因Git LF与工作区CRLF差异停止，随后逐文件核对提交blob；指令预检按固定构建实测修正，均在CLI业务发送前。

未验证PLC运行值、计时／调度、完整设备／I/O、Desktop交互、日常握手及链接点击。历史CmpLog、脚本信任、默认性能、崩溃根因、欢迎页问题继续保留。未连接PLC、下载、运行、仿真、发布Release或更新文章。
