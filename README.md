# InoProShop Engineering MCP

通过 DeepSeek Harness（DSH）调用本地 InoProShop，完成受管理的离线工程读取、有限修改、编译、保存重开和版本对比。

**当前基线：0.7.0 离线试用版，十八项 MCP 工具，契约1.0.0。** 实测环境为 Windows、InoProShop 1.9.1.6 和 DSH 0.2.0-rc.2。源码仓库现已公开，可直接克隆；当前仍是离线试用版，不是正式v1.0。

## 开始使用

- [安装、构建、DSH接入和首次只读任务](docs/getting-started.md)
- [可调整路径的DSH配置模板](config/dsh.example.patch.yml)
- [实际工具输入/输出Schema](docs/tool-schemas.json)
- [Agent工作流程与停止规则](instructions/inoproshop-workflow.md)

```powershell
npm ci
npm run build
```

由DSH的stdio配置启动 dist/server.js。不要在同一数据目录启动多个服务；已有部署升级沿用原目录。厂商IDE、Node、DSH、工程设备包及库不包含在仓库中。

## 支持范围

| 类别 | 工具 |
| --- | --- |
| 环境、状态和操作证据 | environment_inspect、session_status、operation_status |
| 工程副本、登记和切换 | project_open_copy、project_list、project_activate |
| 源码定位与读取 | object_list、object_read、project_search |
| 原生结构、设备与任务只读 | project_structure、device_inspect、task_inspect |
| 限定创建和修改 | pou_create、declaration_create、code_apply_change |
| 离线工程闭环 | project_build、project_save |
| 可信工程快照对比 | project_compare |

源码范围为既有支持的ST POU声明/实现、Application根GVL声明和结构体DUT声明。创建只支持根节点功能块、GVL与结构体。对比覆盖这些源码及task_inspect实际可读字段和调用顺序，不包含设备参数、I/O映射及其他非ST内容。

保留单活动工程、串行队列、精确Application/对象定位、检查点、版本冲突校验、去重、写后读回和unknown冻结。源工程与工作副本分别保存，同名对象不静默覆盖。只读IDE可能写.opt等附属文件，工程哈希不变不代表目录所有文件不变。

## 验证状态与限制

0.7.0既有完整自动化回归126/126通过，真实MCP和DSH桌面只读对比流程已通过；实际确认第二路初始化设定5→8秒，其余三个支持ST对象及可读任务配置一致。桌面原答复有一处实现区语义勘误，工具结果正确；不宣称所有回答均正确。

历史修改/编译/保存重开和工程切换已有样例证据。建立仓库不重跑工程操作，也不把历史结果写成本次新测试。完整原始验收、工程和运行现场保留在维护者本地。

- 历史回答质量11/12未通过，模型仍可能解释错误或外露字段，需按实际源码和诊断核对。
- 保存曾发生unknown，清理缺陷已修复，原占用根因未确认；原工程受控隔离未恢复，不通过新编号、换目录或复制替代工程绕过。
- 保留真实CmpLog警告，不把零错误/一警告说成没有问题。
- 不支持设备/任务/I/O写入、PLC下载/在线控制、变量强制、仿真、其他DUT类型或并行工程执行。
- 固件、完整设备配置、实际运行/计时、跨机兼容性及链接点击不因离线流程通过而视为已验证。

源码初始化不是运行当前值；普通功能块实例调用省略输入不自动恢复初值；任务配置周期不是实测扫描耗时；字面量搜索不是完整语义引用分析。

## 仓库与发布

https://github.com/ningtaosong/inoproshop-engineering-mcp

源码仓库已公开，尚未添加LICENSE文件，不自动选择未经作者指定的开源许可证。下载ZIP、造物场文章和后续发布说明另行整理。仓库不收录个人凭据、DSH会话、.local工程现场、锁、验收日志或历史交付包。
