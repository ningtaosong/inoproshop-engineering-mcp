export const libraryVersionExample = '例：version=aaaa…，configurationVersion=bbbb…；续页 expectedVersion=aaaa…，写入 expectedReferenceVersion=bbbb…。完整值原样传递。';

export const libraryInspectDescription = '只读精确 Application 的各原生库管理器直接引用。保留名称/命名空间、占位符默认与当前解析原文、解析来源及读取缺口；不把已安装/已引用/已解析混为一谈，不递归、不主动解析/修复/下载。独立版本/厂商或加载状态不可取得时明确说明，不从显示串猜字段。续页用实际 nextOffset、结果 version → expectedVersion 和原 maxReferences。占位符写入则用包含目标的成功页：configurationVersion → expectedReferenceVersion、该页 operationId → referenceOperationId。'+libraryVersionExample+' 长字符串仅预览，带 expectedVersion + fieldRead:{referenceIndex,field,offset,limit} 分段读原清单（外层 offset=0，不启动 IDE）。CmpLog直接未出现不证明间接依赖不存在或历史警告已解决。';

export const libraryPlaceholderResolveDescription = '仅对精确Application库管理器中已有且归属可确认的普通占位符，设置本机已安装精确库的原生应用级显式覆盖。先完整 library_inspect 和 library_catalog。仅从实际包含目标占位符的成功查询页取 configurationVersion 作为 expectedReferenceVersion，取同一页 operationId 作为 referenceOperationId；version 仅用于续页。'+libraryVersionExample+' 另提交占位符原生ID、占位符配置版本、磁盘哈希与目标库身份。系统或设备管理的占位符拒绝；有效解析不同于显式覆盖。写后及保存重开核对原对象和其他引用，部分结果不确定冻结。不安装、删除、恢复或调整直接引用；库配置变化后重新编译。返回 conflict 时停止本任务的后续写入和保存，报告冲突，不重试。';

export const placeholderReferenceConflict = '缺少同一工程完整且当前的直接引用查询证据，未派发IDE。expectedReferenceVersion 应取自包含目标占位符的成功 library_inspect 页的 configurationVersion，referenceOperationId 取该页 operationId；version 仅用于续页。冲突：停止本任务的后续写入和保存，报告并保留现场，不重试。';
