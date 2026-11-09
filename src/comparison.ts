// Only immutable evidence from managed native reads is accepted. No caller-supplied source text.
import {canonical,codeHash,digest,normalize,pathKey,type Session} from './storage.js';
import {DomainError,reply,searchDataSchema,taskDataSchema,type Reply} from './contracts.js';
import {searchResult,taskResult} from './queries.js';
import {stringEnd,isStringBoundary} from './native-output.js';

export const excluded=['Device parameters','I/O mapping','Other unsupported/non-ST contents','Runtime behaviour'];
const fail=(message:string):never=>{throw new DomainError('unknown','COMPARE_EVIDENCE_INVALID',message);};
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function captureSnapshot(raw:Reply,a:any,s:Session,operationId:string) {
  if(raw.status!=='succeeded'||raw.operationId!==operationId)fail('快照原结果不是可确认的成功读取');
  const d=raw.data as any,origin=s.editMode==='direct'&&(!a.origin||a.origin==='working-copy')?'current-project':a.origin || 'working-copy',projectPath=origin==='registered-source'?s.sourcePath:s.workingPath;
  if(s.storageMode==='direct'&&origin==='registered-source')fail('直接工程没有独立不变的登记源文件');
  const diskHash=origin==='registered-source'?s.sourceHash:s.diskHash,e=d?.readOnlyEvidence;
  if(!d||d.projectId!==s.projectId||d.applicationId!==a.applicationId||d.targetKind!=='application'||
    pathKey(d.projectPath)!==pathKey(projectPath)||d.diskHash!==diskHash||!e||!e.unchanged||
    e.beforeDiskHash!==diskHash||e.afterCloseDiskHash!==diskHash||e.postExitDiskHash!==diskHash)fail('快照工程/应用/版本或只读文件证据不一致');
  const common={projectId:d.projectId,applicationId:d.applicationId,targetKind:d.targetKind,projectPath:d.projectPath,diskHash:d.diskHash,readOnlyEvidence:e};
  const source=searchResult({...raw,data:{...common,...d.sourceInventory}}, {...a,query:'unused',areas:['name'],caseSensitive:true,offset:0,limit:1,maxResults:1}).data as any;
  const tasks=taskResult({...raw,data:{...common,...d.taskInventory}},a).data as any;
  if(!searchDataSchema.safeParse(source).success||!taskDataSchema.safeParse(tasks).success)fail('源码或任务快照契约不完整');
  for(const inventory of [source,tasks])if(inventory.projectId!==s.projectId||inventory.applicationId!==a.applicationId||inventory.targetKind!=='application'||
    inventory.diskHash!==d.diskHash||pathKey(inventory.projectPath)!==pathKey(projectPath))fail('嵌套读取证据的工程归属或磁盘版本不一致');
  const prefix=source.scope.applicationPath,registered=s.applications?.find(x=>x.applicationId===a.applicationId)?.path;
  if(!registered||canonical(prefix)!==canonical(registered)||canonical(prefix)!==canonical(tasks.applicationPath))fail('快照不属于登记的精确 Application');
  const corpus=d.sourceInventory.corpus.map((o:any)=>({...o,declaration:normalize(o.declaration),implementation:normalize(o.implementation)})).sort((x:any,y:any)=>cmp(canonical(x.path),canonical(y.path))||cmp(x.objectId,y.objectId));
  if(source.scope.coverageComplete&&(source.scope.readObjects!==source.scope.eligibleObjects))fail('完整覆盖与对象数量不一致');
  for(const t of tasks.tasks)if(canonical(t.path.slice(0,prefix.length))!==canonical(prefix)||t.path.length<=prefix.length)fail('任务越过 Application 边界');
  const identity={projectId:s.projectId,applicationId:a.applicationId,applicationPath:prefix,origin,projectPath,diskHash,
    evidence:{kind:'managed-native-capture',operationId}};
  const contents={identity,objects:corpus,scope:source.scope,tasks:tasks.tasks,taskCoverage:{complete:tasks.coverageComplete,enumerationFailures:tasks.enumerationFailures,resolutionReadFailures:tasks.resolutionReadFailures}};
  return {...contents,version:digest(canonical(contents))};
}
export type Snapshot=ReturnType<typeof captureSnapshot>;
export function snapshotSummary(s:Snapshot) {
  return {...s.identity,version:s.version,coverage:{supportedObjects:s.objects.length,objectEnumerationComplete:s.scope.treeComplete,
    objectCoverageComplete:s.scope.coverageComplete,objectReadFailures:s.scope.readFailures.length,skippedObjects:s.scope.skippedObjects.length,
    enumerationFailures:s.scope.enumerationFailures.length,taskCount:s.tasks.length,taskCoverageComplete:s.taskCoverage.complete,
    taskEnumerationFailures:s.taskCoverage.enumerationFailures.length,taskResolutionReadFailures:s.taskCoverage.resolutionReadFailures.length},excluded};
}
export function captureReply(raw:Reply,a:any,s:Session):Reply {
  if(raw.status!=='succeeded')return raw;
  const snap=captureSnapshot(raw,a,s,raw.operationId!);
  return {...raw,summary:'已取得只读源码与任务快照；请检查覆盖范围，不含设备/I/O 配置',data:{mode:'capture',snapshot:snapshotSummary(snap)}};
}
const categories=['added','deleted','modified','unchanged','incomparable'] as const;
function relative(p:string[],app:string[]) {return p.slice(app.length);}
function groups(rows:any[],app:string[],objects:boolean) {
  const m=new Map<string,any[]>();
  for(const r of rows){const key=canonical([relative(r.path,app),objects?r.objectType:'task']);m.set(key,[...(m.get(key)||[]),r]);}
  return m;
}
// One enclosing changed line range, not a claim of a minimal edit script. Every whitespace/comment difference counts.
export function textChange(before:string,after:string) {
  before=normalize(before);after=normalize(after);if(before===after)return null;
  const b=before.split('\n'),t=after.split('\n');let start=0,end=0;
  while(start<Math.min(b.length,t.length)&&b[start]===t[start])start++;
  while(end<Math.min(b.length-start,t.length-start)&&b[b.length-end-1]===t[t.length-end-1])end++;
  const range=(lines:string[])=>({startLine:start+1,endLineExclusive:lines.length-end+1,
    contextStartLine:Math.max(0,start-2)+1,contextEndLineExclusive:Math.min(lines.length,lines.length-end+2)+1,
    text:lines.slice(Math.max(0,start-2),Math.min(lines.length,lines.length-end+2)).join('\n')});
  return {kind:'enclosing-changed-line-range',before:range(b),after:range(t)};
}
function taskFields(t:any):Record<string,any> {
  return {...Object.fromEntries(Object.entries(t.rawFields).map(([k,v])=>['rawFields.'+k,v])),
    ...Object.fromEntries(Object.entries(t.watchdog).map(([k,v])=>['watchdog.'+k,v])),
    calls:t.calls.map((c:any)=>({order:c.order,raw:c.raw}))};
}
export function comparisonItems(b:Snapshot,t:Snapshot) {
  const items:any[]=[];
  for(const kind of ['object','task']) {
    const isObject=kind==='object',bg=groups(isObject?b.objects:b.tasks,b.identity.applicationPath,isObject),tg=groups(isObject?t.objects:t.tasks,t.identity.applicationPath,isObject);
    for(const key of [...new Set([...bg.keys(),...tg.keys()])].sort(cmp)){
      const left=bg.get(key)||[],right=tg.get(key)||[],before=left[0],after=right[0],row=before||after;
      const item:any={kind,relativePath:JSON.parse(key)[0],objectType:isObject?row.objectType:'task',
        ...(isObject&&row.pouType?{pouType:row.pouType,pouTypeSource:row.pouTypeSource,...(row.returnType!==undefined?{returnType:row.returnType}:{})}:{}),
        beforeIdentity:left.map((o:any)=>({objectId:o.objectId||o.taskId,path:o.path})),afterIdentity:right.map((o:any)=>({objectId:o.objectId||o.taskId,path:o.path})),category:'unchanged',changes:[],reasons:[]};
      const complete=isObject?b.scope.coverageComplete&&t.scope.coverageComplete:b.taskCoverage.complete&&t.taskCoverage.complete;
      if(left.length>1||right.length>1){item.category='incomparable';item.reasons.push('Ambiguous Application-relative path and object type; no name/GUID/rename guessing');}
      else if(!before||!after){
        // An older reader may have explicitly skipped a DUT now recognised as enum.
        // Keep the path+type match key unchanged; skipped text is not absence evidence.
        const missing=before?t:b;
        const skippedEnum=isObject&&['enum','array'].includes(row.objectType)&&missing.scope.skippedObjects.some((o:any)=>
          o.nativeTypeId==='2db5746d-d284-4425-9f7f-2663a34b0ebc'&&canonical(relative(o.path,missing.identity.applicationPath))===canonical(JSON.parse(key)[0]));
        item.category=complete&&!skippedEnum?before?'deleted':'added':'incomparable';
        if(skippedEnum){
          item.coverageGap={path:JSON.parse(key)[0],stage:row.objectType+'-coverage',side:before?'target':'baseline',reason:'Known same-path DUT was skipped; '+row.objectType+' addition/deletion cannot be established'};
          item.reasons.push(item.coverageGap.reason);
        }
        else if(!complete)item.reasons.push('Incomplete coverage: absence cannot establish addition/deletion');
        else if(isObject)for(const region of ['declaration','implementation']){
          const change=textChange(before?.[region]||'',after?.[region]||'');if(change)item.changes.push({region,...change});
        }
        else item.changes.push({field:'task',before:before?taskFields(before):null,after:after?taskFields(after):null});
      }
      else if(isObject){
        for(const region of ['declaration','implementation']){
          const change=textChange(before[region],after[region]);if(change)item.changes.push({region,...change});
        }
        if(before.hasImplementation!==after.hasImplementation){item.category='incomparable';item.reasons.push('Inconsistent supported region kind');}
        else if(item.changes.length)item.category='modified';
      } else {
        const bf=taskFields(before),tf=taskFields(after);
        for(const field of [...new Set([...Object.keys(bf),...Object.keys(tf)])].sort(cmp)){
          if(!(field in bf)||!(field in tf)){item.reasons.push('Unavailable field: '+field);continue;}
          if(canonical(bf[field])!==canonical(tf[field]))item.changes.push({field,before:bf[field],after:tf[field]});
        }
        if(before.unavailableFields.length||after.unavailableFields.length||!before.callsComplete||!after.callsComplete){
          item.reasons.push('Task fields/call order incomplete; no defaults filled');
          item.unavailableFields={before:before.unavailableFields,after:after.unavailableFields};
        }
        if(item.reasons.length)item.category='incomparable';else if(item.changes.length)item.category='modified';
      }
      items.push(item);
    }
  }
  return items.map((item,index)=>({...item,index}));
}
function preview(value:any):any {
  if(typeof value==='string'&&value.length>600)return {preview:value.slice(0,stringEnd(value,0,600)),utf16Length:value.length,sha256:digest(value),complete:false};
  if(Array.isArray(value))return value.map(preview);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,preview(v)]));
  return value;
}
export function compareReply(b:Snapshot,t:Snapshot,a:any):Reply {
  const items=comparisonItems(b,t),enumGaps=items.filter(i=>i.coverageGap).map(i=>i.coverageGap);
  // Only changed enum-coverage conclusions invalidate an older comparison page token.
  const version=digest(canonical(enumGaps.length?[b.version,t.version,enumGaps.some(g=>g.stage==='array-coverage')?'array-coverage-v1':'enum-coverage-v1']:[b.version,t.version]));
  if(a.expectedVersion&&a.expectedVersion!==version)throw new DomainError('conflict','COMPARE_VERSION_CHANGED','对比版本已变化，未混合页面');
  if((a.offset>0||a.detail)&&!a.expectedVersion)throw new DomainError('conflict','COMPARE_VERSION_REQUIRED','续页/详情必须携带本次对比版本');
  const counts=Object.fromEntries(['object','task'].map(kind=>[kind,Object.fromEntries(categories.map(c=>[c,items.filter(i=>i.kind===kind&&i.category===c).length]))]));
  const issues=[...b.scope.readFailures,...b.scope.enumerationFailures,...t.scope.readFailures,...t.scope.enumerationFailures,
    ...b.taskCoverage.enumerationFailures,...b.taskCoverage.resolutionReadFailures,...t.taskCoverage.enumerationFailures,...t.taskCoverage.resolutionReadFailures,
    ...enumGaps];
  const base={mode:'compare',version,baseline:snapshotSummary(b),target:snapshotSummary(t),counts,
    coverageComplete:b.scope.coverageComplete&&t.scope.coverageComplete&&b.taskCoverage.complete&&t.taskCoverage.complete&&!enumGaps.length,
    gaps:{count:issues.length,entries:preview(issues.slice(0,8)),entriesTruncated:issues.length>8,fullEvidence:'Original capture IPC sourceInventory/taskInventory'},
    excluded,matching:'Exact case-sensitive Application-relative path + supported type; GUIDs are evidence only; no rename inference',
    normalization:'CRLF/CR -> LF only; all other whitespace/comments preserved',taskMeaning:'Configuration fields and call order only, not measured scan time'};
  let data:any;
  if(a.detail){
    const v=a.detail,item=items[v.itemIndex],region=item?.changes[v.changeIndex],value=region?.[v.side];
    if(!item||!region||value===undefined)throw new DomainError('conflict','COMPARE_DETAIL_NOT_FOUND','变更序号不在原对比内');
    const text=typeof value?.text==='string'?value.text:canonical(value),end=stringEnd(text,v.offset,v.limit);
    if(value===undefined||v.offset>text.length||!isStringBoundary(text,v.offset))throw new DomainError('conflict','COMPARE_DETAIL_OFFSET','详情缺失或偏移无效');
    data={...base,detail:{...v,text:text.slice(v.offset,end),endOffset:end,totalLength:text.length,sha256:digest(text),hasMore:end<text.length,nextOffset:end<text.length?end:null},items:[]};
  }else{
    if(a.offset>items.length)throw new DomainError('conflict','COMPARE_PAGE_OFFSET','偏移超出原对比列表');
    let page=items.slice(a.offset,a.offset+a.limit).map(item=>({...item,changes:preview(item.changes),...(item.unavailableFields?{unavailableFields:preview(item.unavailableFields)}:{})}));
    while(page.length>1&&Buffer.byteLength(JSON.stringify({...base,items:page}))>13500)page.pop();
    const next=a.offset+page.length;
    data={...base,items:page,page:{offset:a.offset,limit:a.limit,returned:page.length,total:items.length,hasMore:next<items.length,nextOffset:next<items.length?next:null,pageReduced:page.length<Math.min(a.limit,items.length-a.offset)}};
  }
  if(Buffer.byteLength(JSON.stringify(data))>15000)throw new DomainError('unsupported','COMPARE_METADATA_TOO_LARGE','对比元数据超出输出上限；完整原证据保留，未宣称已返回全文');
  return reply('succeeded','已比较可信工程快照；结论仅覆盖支持的源码与实际可读任务配置',data);
}
