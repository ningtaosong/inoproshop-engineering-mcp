import {canonical,digest} from './storage.js';
import {reply,type Reply} from './contracts.js';
import {isStringBoundary,stringEnd} from './native-output.js';

// A version binds the complete original inventory, including missing fields and
// manager ownership. Pages/details never reconstruct metadata from display text.
export function libraryInventoryResult(raw:Reply,a:any,origin:any):Reply {
  const {lifecycle,readOnlyEvidence,workerDiskHash,postExitDiskHashObserved,...inventory}=raw.data as any;
  const {references:rows,managers,scope}=inventory;
  if(!Array.isArray(rows)||!Array.isArray(managers)||!scope || rows.length!==scope.capturedReferences ||
    new Set(managers.map((m:any)=>m.managerId)).size!==managers.length)throw Error('Invalid library manager inventory');
  if(managers.some((m:any)=>m.nativeTypeId!=='adb5cb65-8e1d-4a00-b70a-375ea27582f3'||m.path.length<=inventory.applicationPath.length||
    canonical(m.path.slice(0,inventory.applicationPath.length))!==canonical(inventory.applicationPath)))throw Error('Library manager outside exact Application or wrong native type');
  for(const [i,r] of rows.entries()) {
    const manager=managers.find((m:any)=>m.managerId===r.managerId);
    if(r.index!==i||r.parentIndex!==null||!manager||canonical(manager.path)!==canonical(r.managerPath)||
      canonical(r.path)!==canonical([...manager.path,'references',String(r.order)])||
      canonical(manager.path.slice(0,inventory.applicationPath.length))!==canonical(inventory.applicationPath)||
      r.resolutionStatus!==(r.rawFields.effective_resolution?'effective-resolution-reported':'unknown')||r.installedStatus!=='not-queried')throw Error('Library reference ownership/field evidence mismatch');
  }
  if(managers.some((m:any)=>m.capturedReferences!==rows.filter((r:any)=>r.managerId===m.managerId).length)||
    scope.enumerationComplete!==(!scope.truncated&&!scope.enumerationFailures.length&&managers.every((m:any)=>m.enumerationComplete))||
    scope.fieldReadComplete!==(!managers.some((m:any)=>m.unavailableFields.length)&&!rows.some((r:any)=>r.unavailableFields.length)))throw Error('Library coverage evidence inconsistent');
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
