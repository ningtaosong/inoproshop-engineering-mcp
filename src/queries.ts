// Engineering query computation from one native read. Raw input remains in the original IPC evidence.
// This is not a presentation filter, persistent index, call graph or semantic reference analyzer.
import {canonical,digest,codeHash,normalize} from './storage.js';
import {reply,declarationMatches,DomainError,type Reply} from './contracts.js';
import {lexSt,singleIdentifier,IDENTIFIER_LEXER_VERSION} from './st-lex.js';
import {libraryInventoryResult} from './libraries.js';
import {isStringBoundary,stringEnd} from './native-output.js';
const areas=['name','declaration','implementation'];
function cmp(a:string,b:string){return a<b?-1:a>b?1:0;}
function position(source:string,index:number){const prefix=source.slice(0,index),line=prefix.split('\n').length;return {line,column:index-(prefix.lastIndexOf('\n')+1)+1};}
export function* literalPositions(source:string,query:string,sensitive:boolean):Generator<number> {
  const text=sensitive?source:source.toLowerCase(),needle=sensitive?query:query.toLowerCase();
  if(text.length===source.length&&needle.length===query.length){let at=text.indexOf(needle);while(at>=0){yield at;at=text.indexOf(needle,at+1);}return;}
  // Preserve original UTF-16 positions even if Unicode lowercasing expands a character.
  for(let i=0;i+query.length<=source.length;i++)if(source.slice(i,i+query.length).toLowerCase()===needle)yield i;
}
function* literalRanges(source:string,query:string,sensitive:boolean){for(const start of literalPositions(source,query,sensitive))yield [start,start+query.length];}
export const SEARCH_RESULT_VERSION='source-search-v2';
export function searchResult(raw:Reply,a:any,options:{legacy?:boolean,origin?:{kind:string,inventoryOperationId:string}}={}):Reply {
  if(raw.status!=='succeeded')return raw;
  const mode=a.matchMode??'literal',legacy=options.legacy===true;
  if(mode==='identifier'&&(!singleIdentifier(a.query)||(a.areas??areas).includes('name')))
    throw new DomainError('failed','SEARCH_IDENTIFIER_QUERY','identifier只接受单个标识符，且必须明确指定declaration/implementation区域，不接受name或默认全区域');
  const {corpus,...base}=raw.data as any;
  if(!Array.isArray(corpus))throw Error('Search corpus missing');
  const objects=[...corpus].sort((x,y)=>cmp(x.objectId,y.objectId));
  if(new Set(objects.map(o=>o.objectId)).size!==objects.length)throw Error('Duplicate search object identity');
  if(!base.scope || base.scope.readObjects!==objects.length || base.scope.eligibleObjects<objects.length ||
    base.scope.treeComplete!==(base.scope.enumerationFailures.length===0) || base.scope.coverageComplete!==(base.scope.treeComplete&&base.scope.readFailures.length===0))throw Error('Search coverage evidence inconsistent');
  for(const o of objects){
    const prefix=base.scope.applicationPath,decl=['gvl','structure','enum','array'].includes(o.objectType);
    if(o.applicationId!==a.applicationId || canonical(o.path.slice(0,prefix.length))!==canonical(prefix) ||
      !['st_pou','function_block','gvl','structure','enum','array'].includes(o.objectType) || o.hasImplementation===decl ||
      decl&&(o.path.length!==prefix.length+1||o.implementation!==''||a.targetKind==='pool'))throw Error('Search corpus identity/type/scope mismatch');
    if(decl && !declarationMatches(o.objectType,o.path.at(-1),o.declaration))throw Error('Declaration corpus kind/header mismatch');
    if(codeHash(o.declaration,o.implementation)!==o.contentHash)throw Error('Search corpus content hash mismatch');
  }
  const selected=areas.filter(x=>(a.areas || areas).includes(x));
  const versionScope={...base.scope,skippedObjects:base.scope.skippedObjects.map((row:any)=>{
    // Known non-persistent task-call wrapper GUID changes when identical bytes are reopened.
    // Keep the real GUID in the returned scope; only its generated identity is excluded from the version.
    if(row.stage==='unsupported-type'&&row.nativeTypeId==='413e2a7d-adb1-4d2c-be29-6ae6e4fab820'){const {objectId,...stable}=row;return stable;}
    return row;
  }).sort((x:any,y:any)=>cmp(canonical(x),canonical(y)))};
  const version=digest(canonical({projectId:a.projectId,applicationId:a.applicationId,targetKind:a.targetKind || 'application',diskHash:base.diskHash,
    query:a.query,caseSensitive:a.caseSensitive || false,areas:selected,maxResults:a.maxResults,
    ...(legacy?{}:{matchMode:mode,searchVersion:SEARCH_RESULT_VERSION,lexerVersion:mode==='identifier'?IDENTIFIER_LEXER_VERSION:null}),
    scope:versionScope,objects:objects.map(o=>[o.objectId,o.path,o.objectType,o.contentHash])}));
  if(a.expectedVersion&&a.expectedVersion!==version)return {...reply('conflict','搜索版本或查询条件已改变，请从首个结果重新搜索',{...base,version}),operationId:raw.operationId,error:{code:'SEARCH_VERSION_CHANGED',message:'不能混合不同工程、内容、覆盖状态或查询条件的页'}};
  const scans=new Map<string,ReturnType<typeof lexSt>>(),gaps:any[]=[];let regionsScanned=0;
  if(mode==='identifier')for(const o of objects)for(const region of selected){
    if(region==='implementation'&&!o.hasImplementation)continue;
    const source=normalize(o[region]),scan=lexSt(source,true);scans.set(o.objectId+':'+region,scan);regionsScanned++;
    if(scan.error){const start=scan.error.start,end=scan.error.end,p=position(source,start),e=position(source,end);
      gaps.push({objectId:o.objectId,path:o.path,contentHash:o.contentHash,region,reason:scan.error.text,
        position:{startOffset:start,endOffset:end,...p,endLine:e.line,endColumn:e.column},context:{text:source.slice(start,stringEnd(source,start,120)),startOffset:start,endOffset:stringEnd(source,start,120)}});
    }
  }
  const lexicalCoverage=mode==='identifier'?{lexerVersion:IDENTIFIER_LEXER_VERSION,complete:gaps.length===0,regionsScanned,regionsComplete:regionsScanned-gaps.length,gaps}:undefined;
  const retained:any[]=[];let overflow=false;
  outer:for(const o of objects)for(const region of selected){
    if(region==='implementation'&&!o.hasImplementation)continue;
    const source=region==='name'?o.path.at(-1):mode==='identifier'?normalize(o[region]):o[region];
    const found=mode==='identifier'?scans.get(o.objectId+':'+region)!.tokens.filter(t=>t.id&&(a.caseSensitive?t.text===a.query:t.text.toLowerCase()===a.query.toLowerCase())).map(t=>[t.start,t.end]):
      literalRanges(source,a.query,a.caseSensitive);
    for(const [start,end] of found){
      if(retained.length===a.maxResults){overflow=true;break outer;}
      let from=Math.max(0,start-60),to=Math.min(source.length,end+60);
      if(from>0&&/[\uDC00-\uDFFF]/.test(source[from]))from--;if(to<source.length&&/[\uDC00-\uDFFF]/.test(source[to]))to++;
      const p=position(source,start),e=position(source,end);
      retained.push({objectId:o.objectId,path:o.path,objectType:o.objectType,contentHash:o.contentHash,region,
        ...(o.pouType?{pouType:o.pouType,pouTypeSource:o.pouTypeSource,...(o.returnType!==undefined?{returnType:o.returnType}:{})}:{}),
        position:region==='name'?null:{startOffset:start,endOffset:end,...p,endLine:e.line,endColumn:e.column},...(region==='name'?{nameOffset:start}:{}),
        matchedText:source.slice(start,end),context:{text:source.slice(from,to),startOffset:from,endOffset:to},candidateReference:region!=='name'});
    }
  }
  const matches=retained.slice(a.offset,a.offset+a.limit),hasMore=a.offset+matches.length<retained.length;
  const data={...base,version,query:a.query,caseSensitive:a.caseSensitive,areas:selected,matches,
    ...(legacy?{}:{matchMode:mode,searchVersion:SEARCH_RESULT_VERSION,lexerVersion:mode==='identifier'?IDENTIFIER_LEXER_VERSION:null,
      readOrigin:options.origin??{kind:'ide',inventoryOperationId:raw.operationId},...(lexicalCoverage?{lexicalCoverage}:{})}),
    page:{offset:a.offset,limit:a.limit,returned:matches.length,hasMore,nextOffset:hasMore?a.offset+matches.length:null,retainedMatches:retained.length,maxResults:a.maxResults,truncated:overflow,totalMatches:overflow||lexicalCoverage&&!lexicalCoverage.complete?null:retained.length,matchedAtLeast:retained.length+(overflow?1:0)},
    noMatchConclusion:retained.length?'matches-found':base.scope.coverageComplete&&(!lexicalCoverage||lexicalCoverage.complete)?'no-match-in-covered-scope':'coverage-incomplete-no-definitive-absence',
    positionConvention:'LF-normalized object_read text; UTF-16 offsets zero-based, end exclusive; line/column one-based UTF-16; name has no code line',
    referenceLimitations:mode==='identifier'?'Source identifier-token occurrences only, not resolved symbols, complete cross-references or read/write/unused/rename safety analysis':
      'Literal text hits are candidate references only; comments, strings, shadowed names and indirect access are not semantically resolved'};
  return {...raw,summary:mode==='identifier'?'标识符词元搜索完成；请分别检查读取覆盖、词法缺口、截断和分页':'字面量搜索完成；请分别检查覆盖范围、截断和分页',data};
}
export function taskResult(raw:Reply,a:any):Reply {
  if(raw.status!=='succeeded')return raw;
  const {programs,resolutionReadFailures,...base}=raw.data as any;
  if(!Array.isArray(programs)||!Array.isArray(base.tasks))throw Error('Task inventory missing');
  const tasks=[...base.tasks].sort((x,y)=>cmp(x.taskId,y.taskId)).map((task:any)=>{
    const kind=task.rawFields.kind_of_task ?? null;
    const calls=task.rawCalls.map((values:string[],order:number)=>{
      const name=values[0] ?? null;
      const candidates=programs.filter((p:any)=>name!==null&&[p.path.at(-1),p.path.slice(base.applicationPath.length).join('.')].some(n=>n.toLowerCase()===name.toLowerCase())).map((p:any)=>({objectId:p.objectId,path:p.path}));
      const safe=values.length<=2&&(values[1] ?? '')===''&&resolutionReadFailures.length===0&&base.enumerationFailures.length===0;
      const status=safe&&candidates.length===1?'resolved':candidates.length>1?'ambiguous':'unresolved';
      return {order,name,raw:values,resolution:{status,basis:status==='resolved'?'Unique native PROGRAM declaration in exact Application, matching configured IEC name or Application-relative path (case-insensitive)':!safe?'Program inventory incomplete or additional raw call value has unverified meaning':candidates.length>1?'Multiple PROGRAM identities match configured name':'No uniquely verified PROGRAM identity',candidates,...(status==='resolved'?{objectId:candidates[0].objectId}:{})}};
    });
    const {rawCalls,...t}=task;
    return {...t,taskType:kind,interval:{value:t.rawFields.interval ?? null,unit:t.rawFields.interval_unit ?? null,
      meaning:kind==='Cyclic'?'configured-cycle-period':['Event','ExternalEvent','External','Freewheeling','Status','ParentSynchron'].includes(kind)?'not-a-cycle-period':'unknown-task-type'},calls};
  });
  return {...raw,summary:'已读取任务配置；配置不代表实际运行观测',data:{...base,tasks,resolutionReadFailures,
    version:digest(canonical({projectId:a.projectId,applicationId:a.applicationId,diskHash:base.diskHash,tasks,resolutionReadFailures,enumerationFailures:base.enumerationFailures})),
    configurationOnly:true,runtimeObserved:false}};
}

// Pagination reuses the original managed native inventory, not an index or a new IDE session.
// Retaining observed GUIDs avoids inventing persistent identities for generated metadata wrappers.
export function nativeInventoryResult(raw:Reply,a:any,tool:string,origin={kind:'ide',inventoryOperationId:raw.operationId!}):Reply {
  if(raw.status!=='succeeded')return raw;
  if(tool==='library_inspect')return libraryInventoryResult(raw,a,origin);
  const {lifecycle,readOnlyEvidence,workerDiskHash,postExitDiskHashObserved,...inventory}=raw.data as any;
  const field=tool==='project_structure'?'nodes':'parameters',rows=inventory[field];
  if(!Array.isArray(rows))throw Error('Native inventory missing');
  const version=digest(canonical({tool,inventory}));
  if(a.expectedVersion&&a.expectedVersion!==version)return {...reply('conflict','清单版本或范围已变化，请从第一页重新读取'),operationId:raw.operationId,error:{code:'NATIVE_VERSION_CHANGED',message:'未混合不同清单或磁盘版本'}};
  if(a.offset>rows.length)return {...reply('conflict','分页超出已捕获的清单'),operationId:raw.operationId,error:{code:'NATIVE_PAGE_OUT_OF_RANGE',message:'请使用结果实际返回的 nextOffset'}};
  const scope=inventory.scope,cap=tool==='project_structure'?scope.maxNodes:scope.maxParameters;
  if(cap!==(tool==='project_structure'?a.maxNodes:a.maxParameters))return {...reply('conflict','续页读取上限与原清单不一致'),operationId:raw.operationId,error:{code:'NATIVE_VERSION_CHANGED',message:'请从第一页重新查询'}};
  if(new Set(rows.map((r:any)=>r.index)).size!==rows.length||rows.some((r:any,i:number)=>r.index!==i||r.parentIndex!==null&&(!Number.isInteger(r.parentIndex)||r.parentIndex<0||r.parentIndex>=i)))throw Error('Invalid native inventory hierarchy');
  let page=rows.slice(a.offset,a.offset+a.limit),offset=a.offset,limit=a.limit,valueDetail;
  if(a.valueRead) {
    const v=a.valueRead,row=rows[v.parameterIndex];
    const reject=(code:string,message:string)=>({...reply('conflict',message),operationId:raw.operationId,error:{code,message}});
    if(tool!=='device_inspect'||!row)return reject('PARAMETER_INDEX_OUT_OF_RANGE','参数序号不在原清单内，未重新采集');
    if(typeof row.value!=='string')return {...reply('unsupported','原清单未提供可读取的参数值'),operationId:raw.operationId,error:{code:'PARAMETER_VALUE_UNAVAILABLE',message:'保留原读取缺口，不补默认值'}};
    if(v.offset>row.value.length||!isStringBoundary(row.value,v.offset))return reject('VALUE_OFFSET_INVALID','值偏移超出原值或位于字符中间，请使用返回的 nextOffset');
    const end=stringEnd(row.value,v.offset,v.limit);
    valueDetail={parameterIndex:v.parameterIndex,offset:v.offset,endOffset:end,text:row.value.slice(v.offset,end),totalLength:row.value.length,
      sha256:digest(row.value),hasMore:end<row.value.length,nextOffset:end<row.value.length?end:null,positionConvention:'UTF-16 offsets; end exclusive; whole code points'};
    page=[row];offset=v.parameterIndex;limit=1;
  }
  const end=offset+page.length,hasMore=end<rows.length;
  const complete=tool==='project_structure'?scope.treeComplete:scope.parameterCoverageComplete;
  return {...raw,data:{...raw.data,[field]:page,version,readOrigin:origin,...(valueDetail?{valueDetail}:{}),page:{offset,limit,returned:page.length,retained:rows.length,nextOffset:hasMore?end:null,hasMore,truncated:scope.truncated,total:complete&&!scope.truncated?rows.length:null}}};
}
