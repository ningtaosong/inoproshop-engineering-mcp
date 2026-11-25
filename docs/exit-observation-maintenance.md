# 0.39.0 候选：退出观察及命令行收尾补修

本轮对应 S4b 真实验收前的退出可靠性维护，基于 `720e189fab0bbe94dcbecbbd80281a36f87b8a05` 和[只读诊断](struct-field-save-exit-diagnosis.md)。候选维持0.39.0／38工具；业务Schema、初始化业务指令和main不变。不启动真实IDE、工程服务、DSH或模型；受控Node替身不代表真实工程验收。

## 最小设计

1. 新验收辅助模块及时记录服务error/exit/close，绑定本轮runId、PID和创建身份；记录EOF、观察截止和清理失败。业务首错与清理错误分别保留。原验收脚本只读。
2. 产品收到stdin end/close或正常退出信号时先同步停止受理，再等待已进入的调用、admission、queue，以及adapter超时后仍在运行的观察链和落盘。不得把EOF当成工程成功，不能以只等待tool handler代替等待队列。等待期间保持观察者存活；不kill、不延长业务超时。unknown继续按原规则保留租约；有隔离unknown时也不顺带改变原释放条件。重复收尾共享同一过程。
3. adapter对退出回执发布失败另存绑定原请求、launch及创建身份的错误记录；错误记录失败向stderr保留首错及记录错误。正常回执与诊断分开，不覆盖旧回执。超时后的新事实不自动改写原unknown。

本轮只做离线故障验证。原操作 `1a422703-1f36-492a-9789-c6bb649c7d64`、工程、IPC、检查点、登记、隔离、租约、旧包及私人配置不改，不查询或reconcile。IDE最初未退出的OEM原因尚未确认。

## 实现边界

- `EngineeringService.stopAdmission/drain` 区分已进入call、admission和queue；已返回running不等于队列结束。`IdeAdapter.waitForObservations`另外等待业务超时后的子进程观察和回执发布。EOF／stdin close／stdin error及原信号路径共用收尾，不调用process.exit或kill。观察未结束时有显式保活句柄；业务超时仍120秒默认值，未延长。
- `ServiceLifecycle`重复事件共享一次收尾。全部观察结束后按原status条件决定是否release；unknown、隔离unknown、状态不完整或收尾错误均不放宽原释放条件。服务自身正常退出不表示工程操作成功。
- 新回执用排他新建保留原文件。已知runtime错误同时进入内存、独立诊断及正常退出回执的内部`observerFailure`字段；即使独立诊断失败，重启也不能把退出码0当作成功。已持久化`EXIT_OBSERVER_FAILED`保持unknown，显式核对也不能用正常回执抹去首错。其他未隔离迟到结果仍按原规则核对；没有修改历史记录或统一禁止unknown核对。
- 诊断写入失败报告首错和记录异常到stderr；若所有可用介质均失败，不承诺能够恢复不存在的记录，但不会补造退出码。原始结果、派发及阶段记录不覆盖。旧无新增字段的历史回执读取兼容。
- `scripts/lib/observed-stdio.mjs`在等待启动／握手之前附加服务error/exit/close观察，记录runId、创建身份及入口指纹；退出后才取得的身份明确拒绝。关闭只发送一次EOF并作有界观察，超时追加截止事实，`observeLate`仅追加迟到事实，不把原失败改为成功。`preservePrimary`保持业务首错与清理错误分开。
- SDK 1.32.2自身仍不监听stdin EOF；补齐的是本产品生命周期。正常Node替身不代表IDE根因已解决。没有改OEM、桥接、提示处理、安装件、业务Schema或初始化正文。

## 后续最小真实复验前提（本轮未执行）

先复核本补修和原unknown的正式保护条件。如需隔离，须针对精确操作／工程生成只读计划并取得具体授权，不能换目录绕过。确认排他后，另行安排一次不改工程的正常真实IDE操作：验证原请求／进程创建身份、公开正常关闭、process-exit及服务EOF收尾；未取得任何一环即停止，不重试FileExit。该最小复验通过后才另行安排结构体新增的正式MCP和一次CLI，不把本轮离线证据替代它们。

本轮测试、首次失败和保全记录以交付包归属表为准，定向、Node全量与Python计数分别记录，不相加。默认环境历史性能问题、历史unknown／隔离、CmpLog、脚本信任、Desktop最终握手与PLC运行限制保持。
