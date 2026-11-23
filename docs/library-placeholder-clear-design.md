# 普通占位符应用级显式覆盖清除：限定设计

当前为产品化设计与离线实现阶段，尚无新工具验收结论。基线 main 为 `da87ac1d553a3a009a5bdb170b47a370924a0d3a`；独立原生探测归档提交为 `7c700dc77783354816570a129b631a3b785227c2`。预计独立新增 `library_placeholder_clear`，0.37.0 候选版、38 项工具；原 37 项工具的输入、输出契约及 `library_placeholder_resolve` 设置语义保持。

## 业务承诺和前置缺口

仅移除用户明确指定的应用级显式覆盖，保留同一占位符及其余已读配置，并报告即时、保存重开后的实际解析。默认声明、显式覆盖、有效解析和解析来源分别记录。当前公开读取没有提供忽略现有覆盖后完整解析链的可靠预览；安装 device.xml 不能代表当前工程的 TargetSettings、父设备提供方或 profile。因此不承诺恢复 default_resolution 或任何历史版本，不要求也不伪造用户工程的未覆盖历史基线。

首版限定本机 InoProShop 1.9.1.6、AM610 `4102 / 10f4 0002 / 3.5.11.11`、Application 根库管理器中普通非托管且非系统的 `CAA Mathematics`，默认声明为 `CAA Mathematics, 3.5.11.0 (CAA Technical Workgroup)`，现有显式覆盖为 `CAA Mathematics, 3.5.7.0 (CAA Technical Workgroup)`，命名空间 MATH。该白名单表示实际验证范围，不预测清除后的解析。

## 输入及输出

用户提供工程和占位符名称；Agent 从实际 `library_inspect` 成功目标页取得 projectId、applicationId、managerId、placeholderReferenceId、expectedDiskHash、expectedReferenceVersion（configurationVersion）、expectedPlaceholderVersion、expectedExplicitRedirection、referenceOperationId，并生成 requestId。分页 version 不能替代配置版本，不增加“预期回退库”输入。

内部完整保留 before、immediate、after 库记录、目标三阶段原文、原生设备/应用范围证据、源码及可读任务保全证据。客户端返回明确范围的摘要、检查点、完整证据入口、最终文件哈希与配置版本。成功须 changed=true、cleared=true、reopened=true；无覆盖写前拒绝，不伪称执行清除。effective_resolution 和 resolution_info 保留 null、空串、字面文本 `None` 和其他文本的区别，并独立给出 resolutionStatus；缺失或读取失败是缺证。明确未解析仍可表示覆盖已清除，不能称已加载或可编译，buildApplicable=false。配置改变使旧编译证据失效，编译由后续正式工具另行执行。若用户另有指定解析要求而实际不符，应报告并停止后续写入，不恢复覆盖。

## 写前、写后与异常守卫

服务在队列中绑定同一工程、目标页及原磁盘版本；原生端在实际句柄中重新读取完整清单和对象身份，核对版本、唯一名称/原生 ID、根 Application/管理器归属、普通来源、确有明确覆盖及限定设备版本。原生空值不是缺失字段。原始快照保持采集顺序；仅已有明确无顺序语义的任务集合和 PROGRAM 目录按唯一身份比较，内部调用严格有序。

检查点和同句柄最终复查后，只调用一次公开 `set_redirection(None)`，不调用加载、自动修复、删除重建或设置其他覆盖。即时读回必须为原生 null 和 is_redirected=false，原 ID、默认声明、命名空间、其余引用、支持范围源码与可读任务保持；仅目标覆盖状态、有效解析和来源可改变。即时核对通过才保存关闭重开，再严格核对保存后状态。桥接和服务端各自验证。核对前发布实际快照及差异；证据发布失败也保守停止。

直接编辑和旧副本模式沿用身份/磁盘版本、去重、检查点、退出证据、unknown 冻结。已派发异常保留首错及清理异常；不反向设置、不恢复性保存、不自动重试。正式隔离只观察及旧终态幂等规则保持。历史 unknown、隔离和封存工程不操作。

## 预计修改文件及验证

- `src/contracts.ts`、`src/server.ts`、`src/library-guidance.ts`：新增独立契约与精简说明；旧契约不变。
- `src/service.ts`、新 `src/library-placeholder-clear.ts`、`src/fixture-adapter.ts`：证据授权、独立结果守卫与替身。
- `bridge/worker.py`、新 `bridge/library_placeholder_clear.py`：固定分派及限定原生流程，复用现有生命周期。
- `src/isolation.ts`：新工具检查点/命令的维护识别；不调整历史记录或隔离语义。
- 独立 Node/Python 测试、IronPython 编译检查、旧契约核对、版本文件、README/agent/工作指令与验收说明。

离线覆盖错误/重名/系统/托管/空覆盖、分页/磁盘/配置版本不符、缺字段、明确未解析、其他引用或源码任务变化、即时/重开失配、证据发布失败、部分派发、异常退出、去重及冻结。原 200ms 默认环境性能问题保留，不调阈值。

离线通过后提出两份新独立夹具及固定候选的具体计划，复核通过才执行真实 IDE。准备只复用已验中性种子和分阶段脚本，正常解析保存重开后设置覆盖；先真实 MCP、再一次 DSH CLI。各正式 clear 至多一次，原始输出、编译、保存版哈希和可信退出分别归档。日常入口与实际登记目录保持，旧工程不重开。

## 客户端投递

服务验证、IPC 与持久化操作结果始终保留完整三阶段快照。新工具的 MCP 投递单独给出紧凑摘要：目标三阶段原文、实际解析、保存重开、版本和哈希、完整证据路径及摘要。不会把完整源码和所有库行重复发送给模型。重复请求与 operation_status 采用同一投影，旧37项工具不变。原生19引用归档的三状态已超过66KB，摘要预算16,000字节；这是本工具预算，不能冒称已实测所有客户端阈值。异常超长元数据明确标记预览和缺失原文，不能当作null或完整解析。
