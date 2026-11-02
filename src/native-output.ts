import {reply,type Reply} from './contracts.js';
import {digest} from './storage.js';

// Reserve space for the service's request ID and cached-page file evidence.
// The MCP wrapper duplicates JSON as structuredContent and escaped text.
export const NATIVE_REPLY_BYTES=16000;
const PAGE_BYTES=14000,VALUE_PREVIEW_UNITS=256;
export const jsonBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8');
export function stringEnd(text:string,start:number,limit:number) {
  let end=Math.min(text.length,start+limit);
  if(end>start&&end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  return end;
}
export function isStringBoundary(text:string,offset:number) {
  return !(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]));
}
function preview(row:any) {
  if(typeof row.value!=='string'||row.value.length<=VALUE_PREVIEW_UNITS)return row;
  return {...row,value:null,valuePreview:{text:row.value.slice(0,stringEnd(row.value,0,VALUE_PREVIEW_UNITS)),
    utf16Length:row.value.length,sha256:digest(row.value),complete:false}};
}
function tooLarge(source:Reply,index?:number):Reply {
  const d=source.data as any;
  return {...reply('unsupported','原始只读证据已保留，但本项元数据超过返回上限；未将未返回内容视为已读取',{
    projectId:d.projectId,version:d.version,readOrigin:d.readOrigin,responseOmitted:true,
    ...(index===undefined?{}:{itemIndex:index}),maxReplyBytes:NATIVE_REPLY_BYTES}),operationId:source.operationId,requestId:source.requestId,
    error:{code:'NATIVE_METADATA_TOO_LARGE',message:'元数据无法在响应上限内完整返回；缩短参数值或翻页不能解决该项元数据过大'}};
}

// Apply to current and historical native-query replies, including operation_status.
// Keep raw values in IPC and the inventory version; only the delivered page changes.
export function boundNativeReply(source:Reply):Reply {
  const d=source.data as any;
  if(source.status!=='succeeded'||!d?.version||!d.page||!d.scope||!d.readOrigin)return source;
  const field=Array.isArray(d.parameters)?'parameters':Array.isArray(d.nodes)?'nodes':null;
  if(!field)return source;
  if(d.delivery?.bounded===true&&jsonBytes(source)<=NATIVE_REPLY_BYTES)return source;
  const rows=field==='parameters'?d.parameters.map(preview):d.nodes;
  const make=(chosen:any[],valueDetail=d.valueDetail):Reply=>{
    const end=d.page.offset+chosen.length,hasMore=end<d.page.retained;
    return {...source,data:{...d,[field]:chosen,
      page:{...d.page,returned:chosen.length,hasMore,nextOffset:hasMore?end:null},
      ...(valueDetail?{valueDetail}:{}),
      delivery:{bounded:true,maxReplyBytes:NATIVE_REPLY_BYTES,pageReduced:chosen.length<rows.length||d.delivery?.pageReduced===true,
        valuePreviewCount:chosen.filter(x=>x.valuePreview).length,
        mode:valueDetail?'value-detail':'page',
        guidance:'页大小可能因体积缩小；按实际 nextOffset 续页。value=null 且带 valuePreview 表示仅预览，按 expectedVersion + valueRead 读取原值；采集截断、字段不可读与输出分页分别判断。'}}};
  };
  if(d.valueDetail) {
    // Value-detail chunks can contain heavily escaped characters. Shrink the text
    // without splitting a surrogate pair; nextOffset reports the actual boundary.
    const v=d.valueDetail;
    let low=0,high=v.text.length,best:Reply|undefined;
    while(low<=high){const middle=Math.floor((low+high)/2),end=stringEnd(v.text,0,middle),next=v.offset+end;
      const candidate=make(rows,{...v,text:v.text.slice(0,end),endOffset:next,nextOffset:next<v.totalLength?next:null,hasMore:next<v.totalLength});
      if(jsonBytes(candidate)<=PAGE_BYTES){best=candidate;low=middle+1;}else high=middle-1;
    }
    if(!best || (v.text.length>0&&(best.data as any).valueDetail.text.length===0))return tooLarge(source,rows[0]?.index);
    return best;
  }
  let chosen:any[]=[],result=make(chosen);
  if(jsonBytes(result)>PAGE_BYTES)return tooLarge(source);
  for(const row of rows){const next=make([...chosen,row]);if(jsonBytes(next)>PAGE_BYTES){if(!chosen.length)return tooLarge(source,row.index);break;}chosen.push(row);result=next;}
  return result;
}

export function toolOutput(result:Reply) {
  const bounded=boundNativeReply(result);
  return {structuredContent:{...bounded},content:[{type:'text' as const,text:bounded.summary+'\n'+JSON.stringify(bounded)}],
    isError:['failed','conflict','unsupported','unknown'].includes(bounded.status)};
}
