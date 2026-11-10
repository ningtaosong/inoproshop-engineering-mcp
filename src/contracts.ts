import { z } from 'zod';
import {singleIdentifier} from './st-lex.js';

export const CONTRACT = '1.0.0';
export const VERSION = '0.20.1';
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
  project_create:z.object({...request,projectPath:z.string().min(1).max(2048)}).strict(),
  project_open: z.object({ ...request, projectPath: z.string().min(1).max(2048), applicationId: uuid.optional() }).strict(),
  project_open_copy: z.object({ ...request, sourcePath: z.string().min(1).max(2048), applicationId: uuid.optional() }).strict(),
  project_activate: z.object({ ...request, projectId:uuid, applicationId:uuid.optional() }).strict(),
  object_list: z.object({ ...target, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  object_read: z.object({ ...target, objectId: uuid }).strict(),
  project_search:z.object({...target,query:z.string().min(1).max(256),caseSensitive:z.boolean().default(false),matchMode:z.enum(['literal','identifier']).default('literal'),
    areas:z.array(z.enum(['name','declaration','implementation'])).min(1).max(3).default(['name','declaration','implementation']),
    offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(50),
    maxResults:z.number().int().min(1).max(1000).default(200),expectedVersion:hash.optional()}).strict()
    .refine(a=>a.matchMode==='literal'||singleIdentifier(a.query)&&!a.areas.includes('name'),
      'identifier只接受单个标识符且须明确指定declaration/implementation区域；不接受name或默认全区域'),
  variable_inspect:z.object({projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    objectId:uuid.optional(),name:z.string().min(1).max(256).optional(),caseSensitive:z.boolean().default(false),
    includeInitializerMembers:z.boolean().optional(),maxInitializerMembers:z.number().int().min(1).max(2000).optional(),
    offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(30),
    maxObjects:z.number().int().min(1).max(2000).default(200),maxEntries:z.number().int().min(1).max(10000).default(2000),expectedVersion:hash.optional(),
    sourceRead:z.object({objectId:uuid,offset:z.number().int().min(0).default(0),limit:z.number().int().min(2).max(1024).default(512)}).strict().optional()}).strict()
    .refine(a=>a.maxInitializerMembers===undefined||a.includeInitializerMembers===true,'maxInitializerMembers仅适用于显式includeInitializerMembers=true'),
  library_inspect:z.object({projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(50),
    maxReferences:z.number().int().min(1).max(10000).default(2000),expectedVersion:hash.optional(),
    fieldRead:z.object({referenceIndex:z.number().int().min(0).max(9999),field:z.enum(['id','name','namespace','placeholder_name','default_resolution','effective_resolution','resolution_info','resolver_guid']),
      offset:z.number().int().min(0).default(0),limit:z.number().int().min(2).max(2048).default(1024)}).strict().optional()}).strict(),
  task_inspect:z.object({projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid}).strict(),
  task_config_update:z.object({...request,projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    taskId:uuid,expectedTaskVersion:hash,expectedDiskHash:hash,
    intervalMs:z.number().int().min(1).max(60000).optional(),priority:z.number().int().min(0).max(31).optional()}).strict()
    .refine(a=>a.intervalMs!==undefined||a.priority!==undefined,'至少提供 intervalMs 或 priority；未提供的字段保持原值'),
  project_compare:z.object({projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    requestId:id.optional(),mode:z.enum(['capture','compare']),origin:z.enum(['current-project','working-copy','registered-source']).default('working-copy'),
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
    name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/), objectType:z.enum(['gvl','structure','enum','array']),
    declaration:z.string().min(1).max(500000) }).strict(),
  method_create:z.object({...request,projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    parentId:uuid,expectedParentHash:hash,expectedSnapshot:hash,expectedDiskHash:hash,
    name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),access:z.literal('PUBLIC'),returnType:z.enum(['void','DINT']),
    declaration:z.string().min(1).max(500000),implementation:z.string().max(500000)}).strict(),
  property_create:z.object({...request,projectId:uuid,targetKind:z.literal('application').default('application'),applicationId:uuid,
    parentId:uuid,expectedParentHash:hash,expectedSnapshot:hash,expectedDiskHash:hash,
    name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),access:z.literal('PUBLIC'),propertyType:z.literal('DINT'),
    declaration:z.string().min(1).max(500000),getDeclaration:z.string().max(500000),getImplementation:z.string().max(500000)}).strict(),
  code_apply_change: z.object({ ...request, ...target, objectId: uuid, expectedHash: hash,
    declaration: z.string().max(500000), implementation: z.string().max(500000).optional(), objectType:z.enum(['gvl','structure','enum','array','method','property_get']).optional(),parentId:uuid.optional(),
    fbId:uuid.optional(),expectedPropertyHash:hash.optional(),expectedAccessorVersion:hash.optional(),expectedSnapshot:hash.optional(),expectedDiskHash:hash.optional() }).strict()
    .refine(a=>['method','property_get'].includes(a.objectType??'')?a.parentId!==undefined:a.parentId===undefined,'子对象修改须显式类型和精确parentId')
    .refine(a=>a.objectType==='property_get'?[a.fbId,a.expectedPropertyHash,a.expectedAccessorVersion,a.expectedSnapshot,a.expectedDiskHash,a.implementation].every(x=>x!==undefined):[a.fbId,a.expectedPropertyHash,a.expectedAccessorVersion,a.expectedSnapshot,a.expectedDiskHash].every(x=>x===undefined),'Get修改须绑定FB、Property声明、访问器结构、工程和磁盘版本；其他类型不接收Get专用参数'),
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
const methodFields={parentId:uuid.optional(),parentPath:z.array(z.string()).optional(),access:z.literal('PUBLIC').optional(),methodReturnType:z.enum(['void','DINT']).optional(),methodMetadataSource:z.literal('native-method-type-parent-and-declaration-header').optional()};
const accessorStructureSchema=z.object({scheme:z.literal('fb-property-accessors-v1'),propertyId:uuid,readOnly:z.boolean(),accessors:z.array(z.object({objectId:uuid,parentId:uuid,nativeTypeId:uuid,name:z.string(),hasDeclaration:z.boolean(),hasImplementation:z.boolean(),embeddedObjectTypes:z.array(uuid),childIds:z.array(uuid)}))});
const propertyFields={fbId:uuid.optional(),propertyId:uuid.optional(),propertyPath:z.array(z.string()).optional(),propertyName:z.string().optional(),propertyType:z.literal('DINT').optional(),readOnly:z.literal(true).optional(),accessorVersion:hash.optional(),accessorStructure:accessorStructureSchema.optional(),propertyContentHash:hash.optional(),propertyMetadataSource:z.literal('native-property-accessor-tree-and-declaration').optional()};
const objectFields={objectId:uuid.optional(),applicationId:uuid.nullable().optional(),path:z.array(z.string()).optional(),language:z.literal('ST').optional(),objectType:z.enum(['st_pou','function_block','gvl','structure','enum','array','method','property','property_get']).optional(),hasImplementation:z.boolean().optional(),nativeTypeId:uuid.optional(),declaration:z.string().optional(),implementation:z.string().optional(),contentHash:hash.optional(),...pouFields,...methodFields,...propertyFields};
const snapshotFields={snapshot:hash.optional(),diskHash:hash.optional()};
const failureRow=z.object({objectId:uuid.optional(),nativeTypeId:uuid.optional(),path:z.array(z.string()),stage:z.string(),reason:z.string()});
export const readEvidenceSchema=z.object({beforeDiskHash:hash,afterCloseDiskHash:hash,postExitDiskHash:hash.optional(),unchanged:z.boolean()});
export const searchDataSchema=z.object({projectId:uuid,applicationId:uuid.nullable(),targetKind:z.enum(['application','pool']),projectPath:z.string(),diskHash:hash,readOnlyEvidence:readEvidenceSchema,
  version:hash,query:z.string(),caseSensitive:z.boolean(),areas:z.array(z.enum(['name','declaration','implementation'])),
  matchMode:z.enum(['literal','identifier']).optional(),searchVersion:z.string().optional(),lexerVersion:z.string().nullable().optional(),
  readOrigin:z.object({kind:z.enum(['ide','recorded-inventory']),inventoryOperationId:uuid}).optional(),pageFileEvidence:z.object({beforeDiskHash:hash,afterDiskHash:hash}).optional(),
  lexicalCoverage:z.object({lexerVersion:z.string(),complete:z.boolean(),regionsScanned:z.number().int(),regionsComplete:z.number().int(),
    gaps:z.array(z.object({objectId:uuid,path:z.array(z.string()),contentHash:hash,region:z.enum(['declaration','implementation']),reason:z.string(),
      position:z.object({startOffset:z.number().int(),endOffset:z.number().int(),line:z.number().int(),column:z.number().int(),endLine:z.number().int(),endColumn:z.number().int()}),
      context:z.object({text:z.string(),startOffset:z.number().int(),endOffset:z.number().int()})}))}).optional(),
  scope:z.object({description:z.string(),applicationPath:z.array(z.string()),treeComplete:z.boolean(),eligibleObjects:z.number().int(),readObjects:z.number().int(),
    coverageComplete:z.boolean(),skippedObjects:z.array(failureRow),readFailures:z.array(failureRow),enumerationFailures:z.array(failureRow),unsupportedChildren:z.array(failureRow).optional(),methodCoverageVersion:z.literal('fb-methods-v1').optional(),propertyCoverageVersion:z.literal('fb-properties-v1').optional()}),
  matches:z.array(z.object({objectId:uuid,path:z.array(z.string()),objectType:z.enum(['st_pou','function_block','gvl','structure','enum','array','method','property','property_get']),contentHash:hash,...pouFields,...methodFields,...propertyFields,
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
// Library metadata is native raw getter output; version/vendor are not parsed out of display strings.
export const libraryDataSchema=z.object({...nativeQueryFields,applicationId:uuid,targetKind:z.literal('application'),applicationPath:z.array(z.string()),
  managers:z.array(z.object({managerId:uuid,path:z.array(z.string()),nativeTypeId:uuid,enumerationComplete:z.boolean(),capturedReferences:z.number().int(),unavailableFields:z.array(fieldIssue)})),
  references:z.array(z.object({index:z.number().int(),parentIndex:z.null(),managerId:uuid,managerPath:z.array(z.string()),order:z.number().int(),path:z.array(z.string()),
    rawFields:z.record(z.string(),z.union([z.string(),z.boolean(),z.null()])),unavailableFields:z.array(fieldIssue),
    resolutionStatus:z.enum(['effective-resolution-reported','unknown']),resolutionBasis:z.string(),installedStatus:z.literal('not-queried'),
    fieldPreviews:z.record(z.string(),z.object({text:z.string(),utf16Length:z.number().int(),sha256:hash,complete:z.literal(false)})).optional()})),
  scope:z.object({description:z.string(),maxReferences:z.number().int(),capturedReferences:z.number().int(),enumerationComplete:z.boolean(),fieldReadComplete:z.boolean(),truncated:z.boolean(),enumerationFailures:z.array(failureRow)}),
  unavailableMetadata:z.array(z.string()),limitations:z.array(z.string()),
  fieldDetail:z.object({referenceIndex:z.number().int(),field:z.string(),offset:z.number().int(),endOffset:z.number().int(),text:z.string(),totalLength:z.number().int(),sha256:hash,hasMore:z.boolean(),nextOffset:z.number().int().nullable(),positionConvention:z.string()}).optional()
}).passthrough();
const declarationPositionSchema=z.object({startOffset:z.number().int().min(0),endOffset:z.number().int().min(0),line:z.number().int().min(1),column:z.number().int().min(1),endLine:z.number().int().min(1),endColumn:z.number().int().min(1)});
export const variableDataSchema=z.object({...nativeQueryFields,applicationId:uuid,targetKind:z.literal('application'),basis:z.literal('declaration-parsing'),parserVersion:z.string().optional(),positionConvention:z.string(),
  query:z.object({objectId:uuid.nullable(),name:z.string().nullable(),caseSensitive:z.boolean(),nameMatch:z.literal('literal-substring'),includeInitializerMembers:z.literal(true).optional(),maxInitializerMembers:z.number().int().optional()}),
  entries:z.array(z.object({index:z.number().int(),objectId:uuid,path:z.array(z.string()),objectType:z.enum(['st_pou','function_block','gvl','structure','enum','array','method','property','property_get']).nullable(),contentHash:hash.nullable(),...methodFields,...propertyFields,
    category:z.enum(['variable','type-field','comment','parse-gap','function-return','method-return','property-return','initializer-member','initializer-member-gap']),section:z.string().nullable(),name:z.string().optional(),
    position:declarationPositionSchema.nullable(),source:z.string().nullable(),namePosition:declarationPositionSchema.optional(),typeRaw:z.string().nullable().optional(),typePosition:declarationPositionSchema.optional(),
    modifiers:z.array(z.string()).optional(),modifierText:z.string().nullable().optional(),hasExplicitInitializer:z.boolean().optional(),initializerRaw:z.string().nullable().optional(),initializerPosition:declarationPositionSchema.nullable().optional(),
    addressRaw:z.string().nullable().optional(),addressPosition:declarationPositionSchema.nullable().optional(),reason:z.string().optional(),association:z.string().optional(),associatedName:z.string().optional(),commentAssociation:z.string().optional(),
    parentName:z.string().optional(),parentCategory:z.enum(['variable','type-field']).optional(),parentNamePosition:declarationPositionSchema.optional(),parentDeclarationPosition:declarationPositionSchema.optional(),parentInitializerPosition:declarationPositionSchema.optional(),
    valueRaw:z.string().nullable().optional(),valuePosition:declarationPositionSchema.optional(),
    previews:z.record(z.string(),z.object({text:z.string(),utf16Length:z.number().int(),sha256:hash,complete:z.literal(false)})).optional()})),
  counts:z.record(z.string(),z.number().int()),scope:searchDataSchema.shape.scope,
  memberExtraction:z.object({enabled:z.literal(true),parserVersion:z.string(),basis:z.literal('outermost-named-initializer-syntax'),nameFilter:z.literal('parent-name-literal-substring'),
    selectedParents:z.number().int(),explicitInitializers:z.number().int(),absentInitializers:z.number().int(),ordinaryExpressions:z.number().int(),parsedLists:z.number().int(),unsupportedInitializers:z.number().int(),
    parsedMembers:z.number().int(),gapCount:z.number().int(),maxInitializerMembers:z.number().int(),membersTruncated:z.boolean(),completeInParsedParents:z.boolean()}).optional(),
  coverage:z.object({objectEnumerationComplete:z.boolean(),sourceReadComplete:z.boolean(),declarationParseComplete:z.boolean(),supportedScopeComplete:z.boolean(),wholeApplicationVariableTable:z.literal(false),
    readObjects:z.number().int(),selectedObjects:z.number().int(),parsedObjects:z.number().int(),maxObjects:z.number().int(),objectsTruncated:z.boolean(),parseGapCount:z.number().int(),uncoveredDeclarationObjects:z.array(failureRow),excludedDefinitions:z.array(z.object({objectId:uuid,path:z.array(z.string()),reason:z.string()}))}),
  delivery:z.object({previewsAreNotMissingValues:z.literal(true),sourceReadRequiredForPreview:z.literal(true),pageReduced:z.boolean()}),
  noMatchConclusion:z.enum(['declarations-found','no-matching-declarations-in-supported-scope','coverage-incomplete-no-definitive-absence']),limits:z.string(),
  sourceDetail:z.object({objectId:uuid,contentHash:hash,offset:z.number().int(),endOffset:z.number().int(),text:z.string(),totalLength:z.number().int(),sha256:hash,hasMore:z.boolean(),nextOffset:z.number().int().nullable()}).optional()
}).passthrough();
export const comparisonSnapshotSchema=z.object({projectId:uuid,applicationId:uuid,applicationPath:z.array(z.string()),origin:z.enum(['current-project','working-copy','registered-source']),
  projectPath:z.string(),diskHash:hash,version:hash,evidence:z.object({kind:z.literal('managed-native-capture'),operationId:uuid}),
  coverage:z.object({supportedObjects:z.number().int(),objectEnumerationComplete:z.boolean(),objectCoverageComplete:z.boolean(),objectReadFailures:z.number().int(),
    skippedObjects:z.number().int(),enumerationFailures:z.number().int(),taskCount:z.number().int(),taskCoverageComplete:z.boolean(),taskEnumerationFailures:z.number().int(),taskResolutionReadFailures:z.number().int()}),excluded:z.array(z.string())});
const comparisonCounts=z.object({added:z.number().int(),deleted:z.number().int(),modified:z.number().int(),unchanged:z.number().int(),incomparable:z.number().int()});
export const comparisonDataSchema=z.object({mode:z.enum(['capture','compare']),snapshot:comparisonSnapshotSchema.optional(),version:hash.optional(),baseline:comparisonSnapshotSchema.optional(),target:comparisonSnapshotSchema.optional(),
  counts:z.object({object:comparisonCounts,task:comparisonCounts}).optional(),coverageComplete:z.boolean().optional(),
  items:z.array(z.object({index:z.number().int(),kind:z.enum(['object','task']),relativePath:z.array(z.string()),objectType:z.enum(['st_pou','function_block','gvl','structure','enum','array','method','property','property_get','task']),...pouFields,...methodFields,...propertyFields,
    beforeIdentity:z.array(z.object({objectId:uuid,path:z.array(z.string())})),afterIdentity:z.array(z.object({objectId:uuid,path:z.array(z.string())})),category:z.enum(['added','deleted','modified','unchanged','incomparable']),
    changes:z.array(z.record(z.string(),z.unknown())),reasons:z.array(z.string())}).passthrough()).optional(),
  page:z.object({offset:z.number().int(),limit:z.number().int(),returned:z.number().int(),total:z.number().int(),hasMore:z.boolean(),nextOffset:z.number().int().nullable(),pageReduced:z.boolean()}).optional(),
  detail:z.object({itemIndex:z.number().int(),changeIndex:z.number().int(),side:z.enum(['before','after']),offset:z.number().int(),limit:z.number().int(),text:z.string(),endOffset:z.number().int(),totalLength:z.number().int(),sha256:hash,hasMore:z.boolean(),nextOffset:z.number().int().nullable()}).optional(),excluded:z.array(z.string()).optional()}).passthrough();
const payloads:Record<keyof typeof schemas,z.ZodType>={
  environment_inspect:z.object({serverVersion:z.string(),contractVersion:z.string(),node:z.string(),executable:z.string(),profile:z.string(),mode:z.string(),dataDir:z.string(),ideInstalled:z.boolean(),supportedVersion:z.string(),missingDependencies:z.array(z.string()),productionFallbackToFixture:z.literal(false)}).passthrough(),
  session_status:z.object({session:z.object({projectId:uuid,sessionId:uuid,sourcePath:z.string(),workingPath:z.string(),sourceHash:hash,applicationId:uuid.nullable().optional()}).passthrough().nullable(),pending:z.array(z.object({operationId:uuid,requestId:z.string(),tool:z.string(),status:stateSchema})),writeFrozen:z.boolean(),globalFrozen:z.boolean().optional(),availability:z.enum(['global-frozen','active-project-isolated','available']).optional(),isolatedProjects:z.array(z.record(z.string(),z.unknown())).optional()}),
  project_create:z.object({projectPath:z.string().optional(),editMode:z.literal('direct').optional(),creationEvidence:z.object({preset:z.literal('am610-minimal-v1'),publishedExclusively:z.literal(true),reopened:z.literal(true),noBusinessCopy:z.literal(true)}).passthrough().optional(),session:z.object({projectId:uuid,workingPath:z.string(),editMode:z.literal('direct')}).passthrough().optional(),...snapshotFields}).passthrough(),
  project_open:z.object({projectPath:z.string().optional(),editMode:z.literal('direct').optional(),session:z.object({projectId:uuid,workingPath:z.string(),editMode:z.literal('direct')}).passthrough().optional(),...snapshotFields}).passthrough(),
  project_open_copy:z.object({applications:z.array(z.object({applicationId:uuid,path:z.array(z.string())}).passthrough()).optional(),poolBuildAvailable:z.boolean().optional(),session:z.object({projectId:uuid,sessionId:uuid,sourcePath:z.string(),workingPath:z.string(),sourceHash:hash,applicationId:uuid.nullable().optional()}).passthrough().optional(),...snapshotFields}).passthrough(),
  project_list:z.object({projects:z.array(z.object({projectId:uuid,sourcePath:z.string(),workingPath:z.string(),active:z.boolean()}).passthrough()),activeProjectId:uuid.nullable(),writeFrozen:z.boolean()}).passthrough(),
  project_activate:z.object({session:z.object({projectId:uuid,workingPath:z.string()}).passthrough().optional(),...snapshotFields}).passthrough(),
  object_list:z.object({objects:z.array(z.object(objectFields)).optional(),total:z.number().int().optional(),complete:z.boolean().optional(),nextOffset:z.number().int().nullable().optional()}).passthrough(),
  object_read:z.object(objectFields).passthrough(),
  project_search:searchDataSchema.partial().passthrough(),
  variable_inspect:variableDataSchema.partial().passthrough(),
  task_inspect:taskDataSchema.partial().passthrough(),
  task_config_update:z.object({projectId:uuid.optional(),applicationId:uuid.optional(),taskId:uuid.optional(),
    changed:z.boolean().optional(),reopened:z.boolean().optional(),configurationVersion:hash.optional(),taskConfigurationVersion:hash.optional(),
    before:z.record(z.string(),z.unknown()).optional(),after:z.record(z.string(),z.unknown()).optional(),
    checkpoint:z.string().optional(),...snapshotFields}).passthrough(),
  library_inspect:libraryDataSchema.partial().passthrough(),
  project_compare:comparisonDataSchema.partial().passthrough(),
  project_structure:structureDataSchema.partial().passthrough(),
  device_inspect:deviceDataSchema.partial().passthrough(),
  declaration_create:z.object({...objectFields,...snapshotFields,name:z.string().optional(),parentId:uuid.optional(),
    created:z.boolean().optional(),beforeSnapshot:hash.optional(),checkpoint:z.string().optional(),persistedToWorkingCopy:z.boolean().optional(),reopened:z.boolean().optional(),
    recovery:z.object({status:stateSchema}).passthrough().optional()}).passthrough(),
  pou_create:z.object({...objectFields,...snapshotFields,name:z.string().optional(),parentId:uuid.optional(),
    created:z.boolean().optional(),beforeSnapshot:hash.optional(),checkpoint:z.string().optional(),persistedToWorkingCopy:z.boolean().optional(),reopened:z.boolean().optional(),
    recovery:z.object({status:stateSchema}).passthrough().optional()}).passthrough(),
  method_create:z.object({...objectFields,...snapshotFields,name:z.string().optional(),created:z.boolean().optional(),beforeSnapshot:hash.optional(),checkpoint:z.string().optional(),reopened:z.boolean().optional(),creationMethod:z.string().optional()}).passthrough(),
  property_create:z.object({...objectFields,...snapshotFields,getter:z.object({...objectFields}).passthrough().optional(),name:z.string().optional(),created:z.boolean().optional(),beforeSnapshot:hash.optional(),checkpoint:z.string().optional(),reopened:z.boolean().optional(),creationMethod:z.string().optional()}).passthrough(),
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
// Narrow PUBLIC ST Method header, not an ST compiler or independent access getter.
// The native factory omits PUBLIC in its default text. Writes require it explicitly.
export function methodHeader(declaration:string,explicit=false) {
  const s=declarationCode(declaration);if(s===undefined)return;
  const m=/^\s*METHOD\s+(?:(PUBLIC)\s+)?([A-Za-z_][A-Za-z0-9_]{0,62})\s*(?::\s*(DINT)\b)?\s*([\s\S]*)$/i.exec(s);
  if(!m||explicit&&!m[1]||['PUBLIC','PRIVATE','PROTECTED','INTERNAL','FINAL','ABSTRACT','OVERRIDE'].includes(m[2].toUpperCase()))return;
  if(!/^(?:\s*VAR(?:_INPUT|_OUTPUT|_IN_OUT)?\b(?:(?!\b(?:VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_EXTERNAL|VAR_ACCESS|VAR_CONFIG|VAR_STAT|VAR_INST|METHOD|PROPERTY|FUNCTION_BLOCK|FUNCTION|PROGRAM|END_VAR)\b)[\s\S])*\bEND_VAR\b\s*)*$/i.test(m[4]))return;
  return {name:m[2],access:'PUBLIC' as const,returnType:m[3]?'DINT' as const:'void' as const};
}
export function methodDeclarationMatches(name:string,declaration:string,returnType:string,access:string) {
  const h=methodHeader(declaration,true);return !!h&&h.name.toLowerCase()===name.toLowerCase()&&h.returnType===returnType&&h.access===access;
}

export function propertyHeader(declaration:string,explicit=false){
  const code=declarationCode(declaration);if(code===undefined)return;
  const m=/^\s*PROPERTY\s+(?:(PUBLIC)\s+)?([A-Za-z_][A-Za-z0-9_]{0,62})\s*:\s*DINT\s*$/i.exec(code);
  if(!m||explicit&&!m[1]||['PUBLIC','PRIVATE','PROTECTED','INTERNAL','FINAL','ABSTRACT','OVERRIDE'].includes(m[2].toUpperCase()))return;
  return {name:m[2],access:'PUBLIC' as const,type:'DINT' as const};
}
export function getterDeclarationMatches(declaration:string){
  const code=declarationCode(declaration);return code!==undefined&&/^(?:\s*VAR\b(?:(?!\b(?:VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_EXTERNAL|VAR_ACCESS|VAR_CONFIG|VAR_STAT|VAR_INST|METHOD|PROPERTY|FUNCTION_BLOCK|FUNCTION|PROGRAM|END_VAR)\b)[\s\S])*\bEND_VAR\b\s*)*$/i.test(code);
}
// Ordered lexical masking only, not an ST compiler. Quotes inside comments are
// inert; comment delimiters inside strings are inert. Balanced nested block
// comments are supported. Unclosed comments/strings and stray block ends fail
// closed. Keep string tokens opaque (not whitespace) so extra literals cannot
// disappear into an otherwise valid array/enum declaration. Mirror in worker.py.
export function declarationCode(source:string):string|undefined {
  const out:string[]=[];
  let i=0;
  while(i<source.length){
    const pair=source.slice(i,i+2),char=source[i];
    if(pair==='//'){
      i+=2;while(i<source.length && source[i]!=='\r' && source[i]!=='\n')i++;
      out.push(' ');
    }else if(pair==='(*'){
      let depth=1;i+=2;
      while(i<source.length && depth){
        const nested=source.slice(i,i+2);
        if(nested==='(*'){depth++;i+=2;}
        else if(nested==='*)'){depth--;i+=2;}
        else i++;
      }
      if(depth)return;
      out.push(' ');
    }else if(pair==='*)')return;
    else if(char==="'" || char==='"'){
      const quote=char;let closed=false;i++;
      while(i<source.length){
        if(source[i]==='$'){if(i+1>=source.length)return;i+=2;}
        else if(source[i]===quote){
          if(source[i+1]===quote)i+=2;
          else{i++;closed=true;break;}
        }else i++;
      }
      if(!closed)return;
      out.push(quote+'literal'+quote);
    }else{out.push(char);i++;}
  }
  return out.join('');
}
// Array evidence is declaration-derived, not an independent native property getter.
export function arrayBounds(name:string,declaration:string):{lower:number,upper:number}|undefined {
  const code=declarationCode(declaration);if(code===undefined)return;
  const s=code.trim();
  const m=/^TYPE\s+([A-Za-z_][A-Za-z0-9_]{0,62})\s*:\s*ARRAY\s*\[\s*([+-]?[0-9]+)\s*\.\.\s*([+-]?[0-9]+)\s*\]\s+OF\s+DINT\s*;\s*END_TYPE\s*$/i.exec(s);
  if(!m||m[1].toLowerCase()!==name.toLowerCase())return;
  const lower=Number(m[2]),upper=Number(m[3]);
  if(Number.isInteger(lower)&&Number.isInteger(upper)&&0<=lower&&lower<=upper&&upper<=255&&upper-lower+1<=256)return {lower,upper};
}
// Narrow declaration kind guard, not an ST parser. Real syntax is checked by the IDE compiler.
export function declarationMatches(kind:string,name:string,declaration:string,writing=false):boolean {
  const comments=declarationCode(declaration);if(comments===undefined)return false;
  // Enum writes are intentionally narrower than factory declaration recognition.
  if((kind==='array'||kind==='enum' && writing) && /[{}]/.test(comments))return false;
  const s=comments.replace(/\{[^{}]*\}/g,' ').trim();
  if(kind==='gvl')return /^VAR_GLOBAL\b[\s\S]*\bEND_VAR\s*$/i.test(s) && !/\b(?:TYPE|END_TYPE|STRUCT|END_STRUCT|UNION|END_UNION|PROGRAM|FUNCTION_BLOCK|FUNCTION)\b/i.test(s);
  if(kind==='array')return arrayBounds(name,declaration)!==undefined;
  if(kind==='enum'){
    const m=/^TYPE\s+([A-Za-z_][A-Za-z0-9_]{0,62})\s*:\s*\(([\s\S]*)\)\s*;\s*END_TYPE\s*$/i.exec(s);
    if(!m || m[1].toLowerCase()!==name.toLowerCase())return false;
    const names=new Set<string>(),values=new Set<number>();
    for(const part of m[2].split(',')){
      const member=/^\s*([A-Za-z_][A-Za-z0-9_]{0,62})\s*:=\s*([+-]?\d+)\s*$/.exec(part);
      if(!member)return false;
      const value=Number(member[2]),key=member[1].toLowerCase();
      if(!Number.isInteger(value)||value< -32768||value>32767||names.has(key)||values.has(value))return false;
      names.add(key);values.add(value);
    }
    return names.size>0;
  }
  const m=/^TYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*STRUCT\b[\s\S]*\bEND_STRUCT\s*END_TYPE\s*$/i.exec(s);
  return kind==='structure' && m?.[1].toLowerCase()===name.toLowerCase() && !/\b(?:UNION|END_UNION|EXTENDS|VAR_GLOBAL)\b/i.test(s) && (s.match(/\bSTRUCT\b/gi)||[]).length===1;
}
export function reply(status: State, summary: string, data?: Record<string, unknown>): Reply {
  return { contractVersion: CONTRACT, status, summary, ...(data ? {data} : {}) };
}
export class DomainError extends Error {
  constructor(public status: State, public code: string, message: string) { super(message); }
}
