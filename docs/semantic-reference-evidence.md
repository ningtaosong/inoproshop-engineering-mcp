# S7 语义引用证据表

行列从 1 起，位置指向被评估的 `DelayTime` 词形，区域内使用 LF 与 UTF-16。预期由夹具定义在 IDE 启动前独立列出。全表未取得原生使用位置绑定。

| 源对象与位置 | 表达式 | 预期声明 | 实际结果 | 证据来源 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `PLC_PRG` 声明 3:5 | `DelayTime` | PLC_PRG.DelayTime | `VAR` 声明定位，词元命中 | 原生读回源码、声明解析、标识符检索 | 声明位置 |
| `GVL_Config` 声明 2:5 | `DelayTime` | GVL_Config.DelayTime | `VAR_GLOBAL` 声明定位，词元命中 | 原生读回源码、声明解析、标识符检索 | 声明位置 |
| `ST_S7Config` 声明 3:5 | `DelayTime` | ST_S7Config.DelayTime | `STRUCT` 声明定位，词元命中 | 原生读回源码、声明解析、标识符检索 | 声明位置 |
| `PLC_PRG` 实现 1:1 | `DelayTime` | PLC_PRG.DelayTime | 静态指向 `PLC_PRG.DelayTime`，词元命中 | 原生读回源码、限定静态规则、标识符检索 | 静态推导 |
| `PLC_PRG` 实现 2:9 | `dElAyTiMe` | PLC_PRG.DelayTime | 静态指向 `PLC_PRG.DelayTime`，词元命中 | 原生读回源码、限定静态规则、标识符检索 | 静态推导 |
| `PLC_PRG` 实现 3:20 | `GVL_Config.DelayTime` | GVL_Config.DelayTime | 静态指向 `GVL_Config.DelayTime`，词元命中 | 原生读回源码、限定静态规则、标识符检索 | 静态推导 |
| `PLC_PRG` 实现 4:16 | `Config.DelayTime` | ST_S7Config.DelayTime（经 PLC_PRG.Config） | 静态指向 `ST_S7Config.DelayTime`，词元命中 | 原生读回源码、限定静态规则、标识符检索 | 静态推导 |
| `PLC_PRG` 实现 5:20 | `Configs[1].DelayTime` | ST_S7Config.DelayTime（经 PLC_PRG.Configs 的数组元素） | 数组元素成员超出规则，仅有词元命中 | 原生读回源码、标识符检索 | 绑定未知 |
| `PLC_PRG` 实现 6:13 | `'DelayTime'` | 无 | 仅字面命中，字符串字面量 | 原生读回源码、词法边界、字面检索 | 明确非引用 |
| `PLC_PRG` 实现 7:4 | `(* DelayTime *)` | 无 | 仅字面命中，注释 | 原生读回源码、词法边界、字面检索 | 明确非引用 |
| `PLC_PRG` 实现 8:15 | `// GVL_Config.DelayTime` | 无 | 仅字面命中，注释 | 原生读回源码、词法边界、字面检索 | 明确非引用 |

## 身份与版本

Application GUID `e88ddc35-95de-4cd2-886e-100ccb300ecf`，工程 SHA-256 `672cd61f8d443a67875ba91ab3363e5bf316f5cf8b8d27f0213f3e8b69d284bf`。
同次源码快照 `468c654201debaeb7ad3a99a8e2f595cbe00444299079cc36fd47128724afea9`。下表是原生工程对象身份和源码版本。变量和字段位置由声明解析定位。

| 对象 | 对象 GUID | 源码内容哈希 |
| --- | --- | --- |
| `GVL_Config` | `3a962650-36d5-4cc9-938e-ebde37d200e7` | `411185d3b0513e7a2f5b25029ee7e78273a0d55dc997cacf5aad8e48580a27ad` |
| `PLC_PRG` | `76817b8e-cf3d-4b51-82a0-fb6e8bc7c778` | `b17fa6c0d1758bae0b6fc4d207c7de4bcfc9e560ec6c62ad116ece9a512c2dd3` |
| `ST_S7Config` | `ff915d0c-3d9f-444a-a077-3cb77451485d` | `4f7c8c9bbd5001acf3dba43e4afe0c4b21b7806b2efea2a215defaa3a659f4fa` |

原始证据包含对象完整路径、逐行 UTF-16 偏移、推导规则和候选声明位置。参见[探测结论与覆盖边界](semantic-reference-probe.md)。
