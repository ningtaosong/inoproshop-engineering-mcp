import {canonical,digest} from './storage.js';
import {reply,DomainError,type Reply} from './contracts.js';
import {isStringBoundary,stringEnd} from './native-output.js';

export const LIB_CONFIG_SCHEME='direct-library-references-v1';
export const LIB_CATALOG_SCHEME='installed-libraries-v1';
const LIB_FIELDS=['id','name','namespace','is_placeholder','is_managed','system_library','optional','qualified_only',
  'placeholder_name','default_resolution','effective_resolution','resolution_info','resolver_guid','is_redirected'];
export function libraryConfigurationVersion(d:any):string {
  const managers=[...d.managers].sort((a:any,b:any)=>a.managerId.localeCompare(b.managerId)).map((m:any)=>{
    const refs=d.references.filter((r:any)=>r.managerId===m.managerId).sort((a:any,b:any)=>a.order-b.order);
    return [m.managerId,m.path,m.nativeTypeId,refs.map((r:any)=>[r.order,...LIB_FIELDS.map(k=>r.rawFields[k]??null)])];
  });
  return digest(JSON.stringify([LIB_CONFIG_SCHEME,d.applicationId,managers,d.scope.truncated,d.scope.enumerationFailures]));
}
export function catalogVersion(d:any):string {
  return digest(JSON.stringify([LIB_CATALOG_SCHEME,d.entries.map((r:any)=>
    [r.identity,r.displayName,r.company,r.title,r.version,r.defaultNamespace,r.repositoryFile]),d.repositories,d.failures]));
}
export function catalogResult(raw:Reply,a:any):Reply {
  if(raw.status!=='succeeded')return raw;
  const d=raw.data as any;
  if(!d||d.identityScheme!==LIB_CATALOG_SCHEME||!Array.isArray(d.entries)||!Array.isArray(d.repositories)||!Array.isArray(d.failures)||
    d.total!==d.entries.length||d.catalogVersion!==catalogVersion(d)||
    new Set(d.entries.filter((r:any)=>r.identity).map((r:any)=>r.identity)).size!==d.entries.filter((r:any)=>r.identity).length)
    throw new DomainError('unknown','INSTALLED_CATALOG_UNCONFIRMED','原生已安装库目录证据不完整或已损坏，保持现场');
  const reject=(code:string,message:string):Reply=>({...reply('conflict',message),operationId:raw.operationId,error:{code,message}});
  if(a.expectedVersion&&a.expectedVersion!==d.catalogVersion)return reject('INSTALLED_CATALOG_CHANGED','本机库目录版本已变化，请从第一页重新读取');
  const truncated=d.total>a.maxEntries;
  if(a.detailIdentity){
    const found=d.entries.filter((r:any)=>r.identity===a.detailIdentity);
    if(found.length!==1)return reject('LIBRARY_IDENTITY_NOT_FOUND','指定原生库身份不存在或不唯一');
    return {...raw,data:{...d,entries:found,scope:{capturedEntries:d.total,truncated,enumerationComplete:d.enumerationComplete&&!truncated,
      failures:d.failures},page:{offset:0,limit:1,returned:1,total:d.total,hasMore:false,nextOffset:null},readOrigin:'native-installed-repository'}};
  }
  const bounded=d.entries.slice(0,a.maxEntries),term=a.query?.toLocaleLowerCase();
  const filtered=term?bounded.filter((r:any)=>[r.displayName,r.company,r.title,r.version,r.defaultNamespace]
    .some(v=>typeof v==='string'&&v.toLocaleLowerCase().includes(term))):bounded;
  if(a.offset>filtered.length)return reject('CATALOG_PAGE_OUT_OF_RANGE','已安装库分页超出实际过滤结果');
  const chosen=filtered.slice(a.offset,a.offset+a.limit);
  const deliver=(entries:any[])=>{const next=a.offset+entries.length;
    return {...raw,data:{...d,entries,scope:{capturedEntries:d.total,truncated,enumerationComplete:d.enumerationComplete&&!truncated,
      failures:d.failures,filteredEntries:filtered.length},page:{offset:a.offset,limit:a.limit,returned:entries.length,total:truncated?null:filtered.length,
      hasMore:next<filtered.length,nextOffset:next<filtered.length?next:null,query:a.query??null},readOrigin:'native-installed-repository'}};
  };
  let result=deliver(chosen);
  while(Buffer.byteLength(JSON.stringify(result),'utf8')>14000&&chosen.length>1){chosen.pop();result=deliver(chosen);}
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>16000)throw new DomainError('unknown','INSTALLED_CATALOG_UNCONFIRMED','单条原生库记录超过安全输出上限，保持现场');
  return result;
}

// A version binds the complete original inventory, including missing fields and
// manager ownership. Pages/details never reconstruct metadata from display text.
export function libraryInventoryResult(raw:Reply,a:any,origin:any):Reply {
  const {lifecycle,readOnlyEvidence,workerDiskHash,postExitDiskHashObserved,...inventory}=raw.data as any;
  const {references:rows,managers,scope}=inventory;
  if(!Array.isArray(rows)||!Array.isArray(managers)||!scope || rows.length!==scope.capturedReferences ||
    new Set(managers.map((m:any)=>m.managerId)).size!==managers.length)throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','原生库引用清单不完整，保持现场');
  if(managers.some((m:any)=>m.nativeTypeId!=='adb5cb65-8e1d-4a00-b70a-375ea27582f3'||m.path.length<=inventory.applicationPath.length||
    canonical(m.path.slice(0,inventory.applicationPath.length))!==canonical(inventory.applicationPath)))throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','库管理器原生身份或归属无法确认，保持现场');
  for(const [i,r] of rows.entries()) {
    const manager=managers.find((m:any)=>m.managerId===r.managerId);
    if(r.index!==i||r.parentIndex!==null||!manager||canonical(manager.path)!==canonical(r.managerPath)||
      canonical(r.path)!==canonical([...manager.path,'references',String(r.order)])||
      canonical(manager.path.slice(0,inventory.applicationPath.length))!==canonical(inventory.applicationPath)||
      r.resolutionStatus!==(r.rawFields.effective_resolution?'effective-resolution-reported':'unknown')||r.installedStatus!=='not-queried')throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','库引用归属或字段证据不一致，保持现场');
  }
  if(managers.some((m:any)=>m.capturedReferences!==rows.filter((r:any)=>r.managerId===m.managerId).length)||
    scope.enumerationComplete!==(!scope.truncated&&!scope.enumerationFailures.length&&managers.every((m:any)=>m.enumerationComplete))||
    scope.fieldReadComplete!==(!managers.some((m:any)=>m.unavailableFields.length)&&!rows.some((r:any)=>r.unavailableFields.length)))throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','库引用覆盖证据不一致，保持现场');
  if(inventory.referenceVersionScheme!==LIB_CONFIG_SCHEME||inventory.configurationVersion!==libraryConfigurationVersion(inventory))
    throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','库引用配置版本无法从完整原生清单复核，保持现场');
  const version=digest(canonical({tool:'library_inspect',inventory}));
  const reject=(code:string,message:string)=>({...reply('conflict',message),operationId:raw.operationId,error:{code,message}});
  if(a.maxReferences!==scope.maxReferences||a.expectedVersion&&a.expectedVersion!==version)return reject('NATIVE_VERSION_CHANGED','库清单版本或范围已改变，未混合页面');
  if(a.offset>rows.length)return reject('NATIVE_PAGE_OUT_OF_RANGE','分页超出已捕获的库清单');
  let chosen=rows.slice(a.offset,a.offset+a.limit),offset=a.offset,limit=a.limit,fieldDetail;
  if(a.fieldRead) {
    const v=a.fieldRead,r=rows[v.referenceIndex];
    if(!r)return reject('LIBRARY_REFERENCE_INDEX_INVALID','引用序号不在原清单内');
    const value=r.rawFields[v.field];
    if(typeof value!=='string')return {...reply('unsupported','原清单未提供该字符串字段；不补默认值'),operationId:raw.operationId,error:{code:'LIBRARY_FIELD_UNAVAILABLE',message:'保留字段缺口，未重新采集'}};
    if(v.offset>value.length||!isStringBoundary(value,v.offset))return reject('VALUE_OFFSET_INVALID','字段偏移越界或位于字符中间，请使用实际 nextOffset');
    const end=stringEnd(value,v.offset,v.limit);
    fieldDetail={referenceIndex:v.referenceIndex,field:v.field,offset:v.offset,endOffset:end,text:value.slice(v.offset,end),totalLength:value.length,
      sha256:digest(value),hasMore:end<value.length,nextOffset:end<value.length?end:null,positionConvention:'UTF-16 offsets; end exclusive; whole code points'};
    chosen=[r];offset=v.referenceIndex;limit=1;
  }
  const end=offset+chosen.length,hasMore=end<rows.length;
  return {...raw,summary:'已读取直接库引用；解析原文、字段缺口和覆盖范围分别说明',data:{...raw.data,references:chosen,version,readOrigin:origin,...(fieldDetail?{fieldDetail}:{}),
    page:{offset,limit,returned:chosen.length,retained:rows.length,nextOffset:hasMore?end:null,hasMore,truncated:scope.truncated,total:scope.enumerationComplete?rows.length:null}}};
}
