# 安装与 DSH 接入

实测环境为 Windows、InoProShop 1.9.1.6、DSH 0.2.0-rc.2；Node.js要求22或以上。其他电脑和安装组合尚未取得部署验收，路径、设备描述和工程库依赖按实际环境核对。

## 获取与构建

仓库目前为私有，需具有访问权限。以下假设检出到尚不存在的 `D:\InoPro`，已有目录不要覆盖：

```powershell
git clone https://github.com/ningtaosong/inoproshop-engineering-mcp.git D:\InoPro
cd D:\InoPro
npm ci
npm run build
```

InoProShop、DSH、Node和厂商设备包/库自行安装，仓库不捆绑这些软件。`npm test` 运行自动化测试；其中原生API替身不代表真实IDE或PLC验收。`test:ide` 等维护脚本可能打开并修改独立测试工程，不属于安装步骤，不对业务工程随意运行。

## 接入 DSH

1. 备份DSH配置。实测桌面配置入口为 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，以所用DSH版本为准。
2. 参考 [配置模板](../config/dsh.example.patch.yml)，将条目加入已有顶层补丁数组。更改Node、仓库、IDE和Profile路径；不覆盖模型凭据或其他插件条目，不重复添加同名MCP。
3. 新安装可使用模板的独立数据目录；已有部署升级沿用原目录，保留登记、操作、检查点和隔离，不通过换目录或复制故障工程绕过unknown。
4. 空闲且没有活动任务/用户输入时正常重载MCP或重启DSH。新工具/Schema需要重载，普通新对话与工程切换不需要反复重载。
5. 新对话先让Agent查询环境、会话和工具集合。当前应为0.7.0和十八项工具；初始化返回instructions不单独证明模型正确遵循。

DSH通过stdio启动Node。不要在同一数据目录被DSH占用时另行运行 `npm start` 或第二个客户端；命令行直接启动MCP只会等待协议输入。

## 首次试用

从已保存关闭的独立测试工程和只读任务开始。替换为自己的实际测试路径：

> 打开 `D:\PLC-Test\Example.project`，使用受管理工作副本。只读解释PLC_PRG及其调用的功能块，查询对应任务的类型、配置周期和优先级；不要修改、编译、保存或连接PLC。返回实际工作副本链接和完整地址。

Application、对象身份、版本及工具顺序由Agent处理，用户不用填写GUID或哈希。修改限定对象与业务范围，保留编译、保存关闭重开、必要复编和最终全文核对。

比较登记源原文件与已改副本时，分别采集 `registered-source` 与 `working-copy`，再引用可信记录比较，不把两侧都复用成目标副本。只覆盖支持源码和实际可读任务配置，不含设备参数或I/O映射。

仍在执行时查询原操作；unknown或冻结时停止业务、保留现场、核对原操作，不换编号重放、删锁或手改记录。已隔离工程仍受阻，本地维护CLI不是模型自动解冻入口。
