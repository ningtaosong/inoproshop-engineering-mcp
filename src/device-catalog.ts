import {z} from 'zod';
import {deviceCatalogEntry,deviceDescriptionFields,deviceCatalogScope,DomainError,reply,type Reply,type schemas} from './contracts.js';
import {jsonBytes} from './native-output.js';
import {canonical,digest} from './storage.js';

const rawCatalog=z.object({
  entries:z.array(deviceCatalogEntry).max(10000),
  scope:deviceCatalogScope,
  detailLookup:z.discriminatedUnion('status',[
    z.object({status:z.literal('returned'),fields:deviceDescriptionFields}),
    z.object({status:z.enum(['not-requested','coverage-incomplete','ambiguous','not-found','lookup-unavailable'])})
  ]),
  projectOpened:z.literal(false)
});
const identityFields=['type','id','deviceDescriptionVersion'] as const;
const textFields=['id','name','type','vendor','deviceDescriptionVersion'] as const;

export function deviceCatalogResult(raw:Reply,args:z.infer<typeof schemas.device_catalog>):Reply {
  if(raw.status!=='succeeded')return raw;
  const observed=rawCatalog.safeParse(raw.data);
  if(!observed.success)throw new DomainError('unknown','DEVICE_CATALOG_EVIDENCE_INVALID','缺少可信的原生目录或未打开工程证据');
  const {entries,scope:observedScope,detailLookup,projectOpened}=observed.data;
  for(const entry of entries) {
    const missing=[...textFields.filter(k=>entry[k]===null),...(['isInternal','name'] as const)
      .filter(k=>entry.source[k]===null).map(k=>'source.'+k)].sort();
    if(canonical(missing)!==canonical([...entry.unavailableFields].sort()))
      throw new DomainError('unknown','DEVICE_CATALOG_EVIDENCE_INVALID','设备字段和读取缺口不一致');
  }
  const ordered=entries.map(entry=>({entry,key:canonical(entry)}))
    .sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(value=>value.entry);
  const version=digest(canonical({scheme:'device-repository-v1',entries:ordered,scope:observedScope}));
  const enumerationComplete=!observedScope.truncated&&observedScope.enumerationFailures.length===0;
  const fieldReadComplete=entries.every(row=>row.unavailableFields.length===0);
  const term=args.query?.toLowerCase();
  const field=args.field??'name';
  const searchable=(row:z.infer<typeof deviceCatalogEntry>)=>field==='source'?row.source.name:row[field];
  const matches=term?ordered.filter(row=>searchable(row)?.toLowerCase().includes(term)):ordered;
  const matchCoverageComplete=enumerationComplete&&(!term||entries.every(row=>searchable(row)!==null));
  const scope={...observedScope,enumerationComplete,fieldReadComplete,matchCoverageComplete,
    capturedEntries:entries.length,observedMatches:matches.length};
  const base={version,scope,readOrigin:'native-device-repository',projectOpened,firmwareStatus:'not-read'};
  const reject=(code:string,message:string,status:'conflict'|'unsupported'='conflict'):Reply=>
    ({...reply(status,message,base),operationId:raw.operationId,error:{code,message}});
  if(args.expectedVersion&&args.expectedVersion!==version)
    return reject('DEVICE_CATALOG_CHANGED','设备目录已变化，请从第一页重新读取');
  if(args.detail) {
    if(!enumerationComplete||entries.some(row=>identityFields.some(k=>row[k]===null)))
      return reject('DEVICE_CATALOG_INCOMPLETE','目录覆盖不足，无法确认精确设备身份');
    const detail=args.detail;
    const found=entries.filter(row=>identityFields.every(k=>row[k]===detail[k]));
    if(found.length!==1)return reject(found.length?'DEVICE_IDENTITY_AMBIGUOUS':'DEVICE_IDENTITY_NOT_FOUND',
      found.length?'精确身份出现在多条仓库记录中，未选择第一条':'本次完整枚举未发现精确设备描述');
    const sameNative=detailLookup.status==='returned'&&textFields.every(k=>detailLookup.fields[k]===found[0][k]);
    if(!sameNative)return reject('DEVICE_NATIVE_LOOKUP_UNCONFIRMED','原生精确读回不可得或与目录条目不符');
    return {...raw,summary:'已按原生类型、ID 和设备描述版本确认同一条记录；现场固件未读取',
      data:{...base,entries:found,detailVerified:true}};
  }
  if(args.offset>matches.length)return reject('DEVICE_CATALOG_PAGE_OUT_OF_RANGE','分页超出本次观察到的匹配范围');
  const chosen=matches.slice(args.offset,args.offset+args.limit);
  const deliver=():Reply=>{
    const next=args.offset+chosen.length;
    const hasMore=next<matches.length;
    return {...raw,summary:matchCoverageComplete?'已查询本机已安装设备描述；现场固件未读取':
      '仅报告实际读取的本机设备描述；匹配覆盖不完整，现场固件未读取',
      data:{...base,entries:chosen,page:{offset:args.offset,limit:args.limit,returned:chosen.length,
        total:matchCoverageComplete?matches.length:null,hasMore,nextOffset:hasMore?next:null,query:args.query??null,field:term?field:null}}};
  };
  let result=deliver();
  while(jsonBytes(result)>14000&&chosen.length>1){chosen.pop();result=deliver();}
  return jsonBytes(result)>14000?reject('DEVICE_CATALOG_REPLY_TOO_LARGE','设备目录元数据超过返回上限','unsupported'):result;
}
