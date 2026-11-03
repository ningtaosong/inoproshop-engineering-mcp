import { z } from 'zod';

export const CONTRACT = '1.0.0';
export const VERSION = '0.9.0';
// Creation whitelist only. Read metadata below deliberately retains string return types.
export const FUNCTION_RETURN_TYPES = ['DINT','BOOL','INT','REAL','TIME'] as const;
export const stateSchema = z.enum(['running','succeeded','failed','conflict','unsupported','unknown']);
export type State = z.infer<typeof stateSchema>;
const id = z.string().min(1).max(160);
const uuid = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const target = { projectId: uuid, targetKind:z.enum(['application','pool']).default('application'), applicationId: uuid.nullable() };
const request = { requestId: id };
export const schemas = {
  environment_inspect: z.object({}).strict(),
  session_status: z.object({}).strict(),
  project_list: z.object({}).strict(),
  project_open_copy: z.object({ ...request, sourcePath: z.string().min(1).max(2048), applicationId: uuid.optional() }).strict(),
  project_activate: z.object({ ...request, projectId:uuid, applicationId:uuid.optional() }).strict(),
  object_list: z.object({ ...target, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  object_read: z.object({ ...target, objectId: uuid }).strict(),
  project_search:z.object({...target,query:z.string().min(1).max(256),caseSensitive:z.boolean().default(false),
    areas:z.array(z.enum(['name','declaration','implementation'])).min(1).max(3).default(['name','declaration','implementation']),
    offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(50),
    maxResults:z.number().int().min(1).max(1000).default(200),expectedVersion:hash.optional()}).strict(),
  task_inspect:z.object({projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid}).strict(),
  project_compare:z.object({projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    requestId:id.optional(),mode:z.enum(['capture','compare']),origin:z.enum(['working-copy','registered-source']).default('working-copy'),
    baselineOperationId:uuid.optional(),targetOperationId:uuid.optional(),expectedVersion:hash.optional(),
    offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(10),
    detail:z.object({itemIndex:z.number().int().min(0),changeIndex:z.number().int().min(0),side:z.enum(['before','after']),
      offset:z.number().int().min(0).default(0),limit:z.number().int().min(2).max(2048).default(1024)}).strict().optional()
  }).strict().refine(a=>a.mode==='capture'?(!a.baselineOperationId&&!a.targetOperationId&&!a.expectedVersion&&!a.detail&&a.offset===0):!!a.baselineOperationId&&!!a.targetOperationId,
    'capture 仅采集当前工程；compare 必须引用两项真实 capture 操作'),
  project_structure:z.object({projectId:uuid,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(100),
    maxNodes:z.number().int().min(1).max(20000).default(5000),expectedVersion:hash.optional()}).strict(),
  device_inspect:z.object({projectId:uuid,deviceId:uuid,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(100),
    maxParameters:z.number().int().min(1).max(20000).default(5000),expectedVersion:hash.optional(),
    valueRead:z.object({parameterIndex:z.number().int().min(0).max(19999),offset:z.number().int().min(0).default(0),
      limit:z.number().int().min(2).max(2048).default(1024)}).strict().optional()}).strict(),
  pou_create: z.object({ ...request, projectId:uuid, targetKind:z.literal('application').default('application'),
    applicationId:uuid, parentId:uuid, expectedSnapshot:hash,
    name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), pouType:z.enum(['function_block','program','function']),
    returnType:z.enum(FUNCTION_RETURN_TYPES).optional(),
    declaration:z.string().min(1).max(500000), implementation:z.string().max(500000) }).strict()
    .refine(a=>a.pouType==='function'?a.returnType!==undefined:a.returnType===undefined,
      'FUNCTION 必须显式指定 DINT/BOOL/INT/REAL/TIME；其他 POU 不接收 returnType'),
  declaration_create: z.object({ ...request, projectId:uuid, targetKind:z.literal('application').default('application'),
    applicationId:uuid, parentId:uuid, expectedSnapshot:hash,
    name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), objectType:z.enum(['gvl','structure']),
    declaration:z.string().min(1).max(500000) }).strict(),
  code_apply_change: z.object({ ...request, ...target, objectId: uuid, expectedHash: hash,
    declaration: z.string().max(500000), implementation: z.string().max(500000).optional(), objectType:z.enum(['gvl','structure']).optional() }).strict(),
  project_build: z.object({ ...request, ...target }).strict(),
  project_save: z.object({ ...request, ...target, expectedSnapshot: hash }).strict(),
  operation_status: z.object({ operationId: uuid.optional(), requestId: id.optional(), reconcile: z.boolean().default(false) })
    .strict().refine(x => !!x.operationId !== !!x.requestId, '必须且只能指定 operationId 或 requestId'),
};

export interface Reply {
  contractVersion: string; status: State; summary: string;
  requestId?: string; operationId?: string; data?: Record<string, unknown>;
  error?: { code: string; message: string };
}
export const replySchema = z.object({
  contractVersion: z.literal(CONTRACT), status: stateSchema, summary: z.string(),
  requestId: z.string().optional(), operationId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.object({code:z.string(),message:z.string()}).optional()
}).strict();
const pouFields={pouType:z.enum(['function_block','program','function']).optional(),returnType:z.string().optional(),pouTypeSource:z.literal('native-pou-type-id-and-declaration-header').optional()};
const objectFields={objectId:uuid.optional(),applicationId:uuid.nullable().optional(),path:z.array(z.string()).optional(),language:z.literal('ST').optional(),objectType:z.enum(['st_pou','function_block','gvl','structure']).optional(),hasImplementation:z.boolean().optional(),nativeTypeId:uuid.optional(),declaration:z.string().optional(),implementation:z.string().optional(),contentHash:hash.optional(),...pouFields};
const snapshotFields={snapshot:hash.optional(),diskHash:hash.optional()};
const failureRow=z.object({objectId:uuid.optional(),nativeTypeId:uuid.optional(),path:z.array(z.string()),stage:z.string(),reason:z.string()});
export const readEvidenceSchema=z.object({beforeDiskHash:hash,afterCloseDiskHash:hash,postExitDiskHash:hash.optional(),unchanged:z.boolean()});
export const searchDataSchema=z.object({projectId:uuid,applicationId:uuid.nullable(),targetKind:z.enum(['application','pool']),projectPath:z.string(),diskHash:hash,readOnlyEvidence:readEvidenceSchema,
  version:hash,query:z.string(),caseSensitive:z.boolean(),areas:z.array(z.enum(['name','declaration','implementation'])),
  scope:z.object({description:z.string(),applicationPath:z.array(z.string()),treeComplete:z.boolean(),eligibleObjects:z.number().int(),readObjects:z.number().int(),
    coverageComplete:z.boolean(),skippedObjects:z.array(failureRow),readFailures:z.array(failureRow),enumerationFailures:z.array(failureRow)}),
  matches:z.array(z.object({objectId:uuid,path:z.array(z.string()),objectType:z.enum(['st_pou','function_block','gvl','structure']),contentHash:hash,...pouFields,
    region:z.enum(['name','declaration','implementation']),position:z.object({startOffset:z.number().int(),endOffset:z.number().int(),line:z.number().int(),column:z.number().int(),endLine:z.number().int(),endColumn:z.number().int()}).nullable(),
    nameOffset:z.number().int().optional(),matchedText:z.string(),context:z.object({text:z.string(),startOffset:z.number().int(),endOffset:z.number().int()}),candidateReference:z.boolean()})),
  page:z.object({offset:z.number().int(),limit:z.number().int(),returned:z.number().int(),hasMore:z.boolean(),nextOffset:z.number().int().nullable(),retainedMatches:z.number().int(),maxResults:z.number().int(),truncated:z.boolean(),totalMatches:z.number().int().nullable(),matchedAtLeast:z.number().int()}),
  noMatchConclusion:z.enum(['matches-found','no-match-in-covered-scope','coverage-incomplete-no-definitive-absence']),positionConvention:z.string(),referenceLimitations:z.string()}).passthrough();
export const taskDataSchema=z.object({projectId:uuid,applicationId:uuid,targetKind:z.literal('application'),projectPath:z.string(),diskHash:hash,readOnlyEvidence:readEvidenceSchema,version:hash,
  applicationPath:z.array(z.string()),coverageComplete:z.boolean(),enumerationFailures:z.array(failureRow),resolutionReadFailures:z.array(failureRow),
  tasks:z.array(z.object({taskId:uuid,path:z.array(z.string()),taskType:z.string().nullable(),rawFields:z.record(z.string(),z.string()),watchdog:z.record(z.string(),z.string()),
    interval:z.object({value:z.string().nullable(),unit:z.string().nullable(),meaning:z.enum(['configured-cycle-period','not-a-cycle-period','unknown-task-type'])}),
    unavailableFields:z.array(z.object({field:z.string(),reason:z.string()})),callsComplete:z.boolean(),
    calls:z.array(z.object({order:z.number().int(),name:z.string().nullable(),raw:z.array(z.string()),resolution:z.object({status:z.enum(['resolved','ambiguous','unresolved']),basis:z.string(),candidates:z.array(z.object({objectId:uuid,path:z.array(z.string())})),objectId:uuid.optional()})}))})),
  configurationOnly:z.literal(true),runtimeObserved:z.literal(false)}).passthrough();
const nativePath=z.array(z.string().nullable());
const fieldIssue=z.object({field:z.string(),reason:z.string()});
const nativeIssue=fieldIssue.extend({path:nativePath});
export const nativeNodeSchema=z.object({index:z.number().int().min(0),parentIndex:z.number().int().min(0).nullable(),objectId:uuid.nullable(),parentId:uuid.nullable(),
  name:z.string().nullable(),path:nativePath,pathComplete:z.boolean(),nativeTypeId:uuid.nullable(),kind:z.enum(['unknown','pou','gvl','dut','program-call','application','task','device']),
  typeBasis:z.string(),isDevice:z.boolean().nullable(),childrenRead:z.boolean(),unavailableFields:z.array(fieldIssue)});
const treeScopeSchema=z.object({description:z.string(),maxNodes:z.number().int(),capturedNodes:z.number().int(),treeComplete:z.boolean(),coverageComplete:z.boolean(),truncated:z.boolean(),
  enumerationFailures:z.array(z.object({path:nativePath,stage:z.string(),reason:z.string()}))});
const nativePageSchema=z.object({offset:z.number().int(),limit:z.number().int(),returned:z.number().int(),retained:z.number().int(),nextOffset:z.number().int().nullable(),hasMore:z.boolean(),truncated:z.boolean(),total:z.number().int().nullable()});
const nativeQueryFields={projectId:uuid,projectPath:z.string(),diskHash:hash,readOnlyEvidence:readEvidenceSchema,version:hash,page:nativePageSchema,
  delivery:z.object({bounded:z.literal(true),maxReplyBytes:z.literal(16000),pageReduced:z.boolean(),valuePreviewCount:z.number().int(),mode:z.enum(['page','value-detail']),guidance:z.string()}).optional(),
  readOrigin:z.object({kind:z.enum(['ide','recorded-inventory']),inventoryOperationId:uuid}),pageFileEvidence:z.object({beforeDiskHash:hash,afterDiskHash:hash}).optional()};
export const structureDataSchema=z.object({...nativeQueryFields,nodes:z.array(nativeNodeSchema),scope:treeScopeSchema,identityLimitations:z.string()}).passthrough();
export const deviceDataSchema=z.object({...nativeQueryFields,device:nativeNodeSchema,
  identification:z.object({type:z.string().nullable(),id:z.string().nullable(),deviceDescriptionVersion:z.string().nullable()}),
  deviceInfo:z.object({name:z.string().nullable(),vendor:z.string().nullable(),description:z.string().nullable(),orderNumber:z.string().nullable()}),
  identificationSource:z.string(),modelSource:z.string(),firmwareVersion:z.null(),firmwareStatus:z.literal('not-provided-by-verified-offline-api'),unavailableFields:z.array(nativeIssue),
  connectors:z.array(z.object({id:z.string().nullable(),path:nativePath,interface:z.string().nullable(),interfaceName:z.string().nullable()})),
  parameters:z.array(z.object({index:z.number().int(),parentIndex:z.number().int().nullable(),source:z.string(),ownerPath:nativePath,identifier:z.string().nullable(),name:z.string().nullable(),path:nativePath,
    type:z.string().nullable(),value:z.string().nullable(),valueSource:z.string(),hasSubElements:z.boolean().nullable(),unavailableFields:z.array(fieldIssue),
    valuePreview:z.object({text:z.string(),utf16Length:z.number().int(),sha256:hash,complete:z.literal(false)}).optional()})),
  valueDetail:z.object({parameterIndex:z.number().int(),offset:z.number().int(),endOffset:z.number().int(),text:z.string(),totalLength:z.number().int(),
    sha256:hash,hasMore:z.boolean(),nextOffset:z.number().int().nullable(),positionConvention:z.literal('UTF-16 offsets; end exclusive; whole code points')}).optional(),
  parameterReadFailures:z.array(nativeIssue),scope:z.object({description:z.string(),maxParameters:z.number().int(),capturedParameters:z.number().int(),truncated:z.boolean(),treeScope:treeScopeSchema,parameterCoverageComplete:z.boolean()}),
  completeDeviceConfiguration:z.literal(false),runtimeObserved:z.literal(false),valueLimitations:z.string()}).passthrough();
export const comparisonSnapshotSchema=z.object({projectId:uuid,applicationId:uuid,applicationPath:z.array(z.string()),origin:z.enum(['working-copy','registered-source']),
  projectPath:z.string(),diskHash:hash,version:hash,evidence:z.object({kind:z.literal('managed-native-capture'),operationId:uuid}),
  coverage:z.object({supportedObjects:z.number().int(),objectEnumerationComplete:z.boolean(),objectCoverageComplete:z.boolean(),objectReadFailures:z.number().int(),
    skippedObjects:z.number().int(),enumerationFailures:z.number().int(),taskCount:z.number().int(),taskCoverageComplete:z.boolean(),taskEnumerationFailures:z.number().int(),taskResolutionReadFailures:z.number().int()}),excluded:z.array(z.string())});
const comparisonCounts=z.object({added:z.number().int(),deleted:z.number().int(),modified:z.number().int(),unchanged:z.number().int(),incomparable:z.number().int()});
export const comparisonDataSchema=z.object({mode:z.enum(['capture','compare']),snapshot:comparisonSnapshotSchema.optional(),version:hash.optional(),baseline:comparisonSnapshotSchema.optional(),target:comparisonSnapshotSchema.optional(),
  counts:z.object({object:comparisonCounts,task:comparisonCounts}).optional(),coverageComplete:z.boolean().optional(),
  items:z.array(z.object({index:z.number().int(),kind:z.enum(['object','task']),relativePath:z.array(z.string()),objectType:z.enum(['st_pou','function_block','gvl','structure','task']),...pouFields,
    beforeIdentity:z.array(z.object({objectId:uuid,path:z.array(z.string())})),afterIdentity:z.array(z.object({objectId:uuid,path:z.array(z.string())})),category:z.enum(['added','deleted','modified','unchanged','incomparable']),
    changes:z.array(z.record(z.string(),z.unknown())),reasons:z.array(z.string())}).passthrough()).optional(),
  page:z.object({offset:z.number().int(),limit:z.number().int(),returned:z.number().int(),total:z.number().int(),hasMore:z.boolean(),nextOffset:z.number().int().nullable(),pageReduced:z.boolean()}).optional(),
  detail:z.object({itemIndex:z.number().int(),changeIndex:z.number().int(),side:z.enum(['before','after']),offset:z.number().int(),limit:z.number().int(),text:z.string(),endOffset:z.number().int(),totalLength:z.number().int(),sha256:hash,hasMore:z.boolean(),nextOffset:z.number().int().nullable()}).optional(),excluded:z.array(z.string()).optional()}).passthrough();
const payloads:Record<keyof typeof schemas,z.ZodType>={
  environment_inspect:z.object({serverVersion:z.string(),contractVersion:z.string(),node:z.string(),executable:z.string(),profile:z.string(),mode:z.string(),dataDir:z.string(),ideInstalled:z.boolean(),supportedVersion:z.string(),missingDependencies:z.array(z.string()),productionFallbackToFixture:z.literal(false)}).passthrough(),
  session_status:z.object({session:z.object({projectId:uuid,sessionId:uuid,sourcePath:z.string(),workingPath:z.string(),sourceHash:hash,applicationId:uuid.nullable().optional()}).passthrough().nullable(),pending:z.array(z.object({operationId:uuid,requestId:z.string(),tool:z.string(),status:stateSchema})),writeFrozen:z.boolean(),globalFrozen:z.boolean().optional(),availability:z.enum(['global-frozen','active-project-isolated','available']).optional(),isolatedProjects:z.array(z.record(z.string(),z.unknown())).optional()}),
  project_open_copy:z.object({applications:z.array(z.object({applicationId:uuid,path:z.array(z.string())}).passthrough()).optional(),poolBuildAvailable:z.boolean().optional(),session:z.object({projectId:uuid,sessionId:uuid,sourcePath:z.string(),workingPath:z.string(),sourceHash:hash,applicationId:uuid.nullable().optional()}).passthrough().optional(),...snapshotFields}).passthrough(),
  project_list:z.object({projects:z.array(z.object({projectId:uuid,sourcePath:z.string(),workingPath:z.string(),active:z.boolean()}).passthrough()),activeProjectId:uuid.nullable(),writeFrozen:z.boolean()}).passthrough(),
  project_activate:z.object({session:z.object({projectId:uuid,workingPath:z.string()}).passthrough().optional(),...snapshotFields}).passthrough(),
  object_list:z.object({objects:z.array(z.object(objectFields)).optional(),total:z.number().int().optional(),complete:z.boolean().optional(),nextOffset:z.number().int().nullable().optional()}).passthrough(),
  object_read:z.object(objectFields).passthrough(),
  project_search:searchDataSchema.partial().passthrough(),
  task_inspect:taskDataSchema.partial().passthrough(),
  project_compare:comparisonDataSchema.partial().passthrough(),
  project_structure:structureDataSchema.partial().passthrough(),
  device_inspect:deviceDataSchema.partial().passthrough(),
  declaration_create:z.object({...objectFields,...snapshotFields,name:z.string().optional(),parentId:uuid.optional(),
    created:z.boolean().optional(),beforeSnapshot:hash.optional(),checkpoint:z.string().optional(),persistedToWorkingCopy:z.boolean().optional(),reopened:z.boolean().optional(),
    recovery:z.object({status:stateSchema}).passthrough().optional()}).passthrough(),
  pou_create:z.object({...objectFields,...snapshotFields,name:z.string().optional(),parentId:uuid.optional(),
    created:z.boolean().optional(),beforeSnapshot:hash.optional(),checkpoint:z.string().optional(),persistedToWorkingCopy:z.boolean().optional(),reopened:z.boolean().optional(),
    recovery:z.object({status:stateSchema}).passthrough().optional()}).passthrough(),
  code_apply_change:z.object({...objectFields,...snapshotFields,checkpoint:z.string().optional(),persistedToWorkingCopy:z.boolean().optional(),reopened:z.boolean().optional(),recovery:z.object({status:stateSchema}).passthrough().optional()}).passthrough(),
  project_build:z.object({...snapshotFields,applicationId:uuid.nullable().optional(),targetKind:z.enum(['application','pool']).optional(),completed:z.boolean().optional(),diagnosticsComplete:z.boolean().optional(),diagnostics:z.array(z.object({severity:z.string(),text:z.string()}).passthrough()).optional(),buildPassed:z.boolean().nullable().optional()}).passthrough(),
  project_save:z.object({...snapshotFields,saved:z.boolean().optional(),reopened:z.boolean().optional(),buildApplicable:z.boolean().optional()}).passthrough(),
  operation_status:z.record(z.string(),z.unknown())
};
export const outputSchemas=Object.fromEntries(Object.entries(payloads).map(([name,data])=>[name,replySchema.extend({data:data.optional()})]));
// 只校验本工具所需的首部身份，不声称实现完整 ST 语法解析。
export function functionBlockName(declaration:string):string|undefined {
  const source=declaration.replace(/\(\*[\s\S]*?\*\)/g,' ').replace(/\/\/[^\r\n]*/g,' ');
  return /^\s*FUNCTION_BLOCK\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(source)?.[1];
}
// Header identity only; it is not a complete ST parser. Return type is read from the native declaration.
export function pouHeader(declaration:string):{pouType:string;name:string;returnType?:string}|undefined {
  const source=declaration.replace(/\(\*[\s\S]*?\*\)/g,' ').replace(/\/\/[^\r\n]*/g,' ');
  const m=/^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(source);
  if(!m)return;
  const pouType=m[1].toLowerCase();
  if(pouType!=='function')return {pouType,name:m[2]};
  const result=/^\s*:\s*([^\r\n]+)/.exec(source.slice(m[0].length));
  return result?{pouType,name:m[2],returnType:result[1].trim()}:undefined;
}
export function pouDeclarationMatches(kind:string,name:string,declaration:string,returnType?:string):boolean {
  const h=pouHeader(declaration);
  return !!h && h.pouType===kind && h.name.toLowerCase()===name.toLowerCase() &&
    (kind==='function'?(FUNCTION_RETURN_TYPES as readonly string[]).includes(returnType ?? '')&&h.returnType?.toUpperCase()===returnType:returnType===undefined);
}
// Narrow declaration kind guard, not an ST parser. Real syntax is checked by the IDE compiler.
export function declarationMatches(kind:string,name:string,declaration:string):boolean {
  const s=declaration.replace(/'(?:\$[\s\S]|''|[^'])*'/g,"'literal'").replace(/\(\*[\s\S]*?\*\)/g,' ').replace(/\/\/[^\r\n]*/g,' ').replace(/\{[^{}]*\}/g,' ').trim();
  if(kind==='gvl')return /^VAR_GLOBAL\b[\s\S]*\bEND_VAR\s*$/i.test(s) && !/\b(?:TYPE|END_TYPE|STRUCT|END_STRUCT|UNION|END_UNION|PROGRAM|FUNCTION_BLOCK|FUNCTION)\b/i.test(s);
  const m=/^TYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*STRUCT\b[\s\S]*\bEND_STRUCT\s*END_TYPE\s*$/i.exec(s);
  return kind==='structure' && m?.[1].toLowerCase()===name.toLowerCase() && !/\b(?:UNION|END_UNION|EXTENDS|VAR_GLOBAL)\b/i.test(s) && (s.match(/\bSTRUCT\b/gi)||[]).length===1;
}
export function reply(status: State, summary: string, data?: Record<string, unknown>): Reply {
  return { contractVersion: CONTRACT, status, summary, ...(data ? {data} : {}) };
}
export class DomainError extends Error {
  constructor(public status: State, public code: string, message: string) { super(message); }
}
