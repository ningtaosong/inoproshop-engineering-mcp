// Read-only declaration parsing, not a compiler, native symbol table or runtime scan.
// Never used by the write guards. All ranges address the original LF-normalized text.
import {canonical,digest,normalize} from './storage.js';
import {reply,DomainError,type Reply} from './contracts.js';
import {searchResult} from './queries.js';
import {isStringBoundary,stringEnd,jsonBytes} from './native-output.js';

import {lexSt as lex,type Token} from './st-lex.js';
type Span={startOffset:number,endOffset:number,line:number,column:number,endLine:number,endColumn:number};
export const VARIABLE_PARSER_VERSION='declaration-variables-v2';
const sections=new Set(['VAR','VAR_INPUT','VAR_OUTPUT','VAR_IN_OUT','VAR_GLOBAL']);
// Exact declaration keywords, never an arbitrary VAR_ identifier prefix.
const allSections=new Set([...sections,'VAR_TEMP','VAR_EXTERNAL','VAR_ACCESS','VAR_CONFIG','VAR_STAT','VAR_INST']);
const compoundBoundaries=new Set(['STRUCT','END_STRUCT','UNION','END_UNION','TYPE','END_TYPE']);
const modifiers=new Set(['CONSTANT','RETAIN','NON_RETAIN','PERSISTENT']);
const upper=(t?:Token)=>t?.text.toUpperCase() ?? '';
export function declarationPosition(s:string,start:number,end:number):Span {
 const p=(i:number)=>{const prefix=s.slice(0,i);return {line:prefix.split('\n').length,column:i-prefix.lastIndexOf('\n')};};
 const b=p(start),e=p(end);return {startOffset:start,endOffset:end,...b,endLine:e.line,endColumn:e.column};
}
// Type syntax we can delimit without evaluating it. Named types/FBs are opaque;
// ARRAY bounds and STRING lengths are retained, never computed or expanded.
function typeSupported(ts:Token[]):boolean {
 let i=0;
 function group(open:string,close:string){if(ts[i]?.text!==open)return false;let depth=1;i++;const from=i;
  while(i<ts.length&&depth){if(ts[i].text===open)depth++;if(ts[i].text===close)depth--;i++;}
  return depth===0&&i>from+1;
 }
 function type():boolean {
  if(upper(ts[i])==='ARRAY'){i++;if(!group('[',']')||upper(ts[i++])!=='OF')return false;return type();}
  if(!ts[i]?.id||['STRUCT','UNION','POINTER','REFERENCE','TYPE','END_TYPE','END_VAR','AT'].includes(upper(ts[i])))return false;
  const name=upper(ts[i++]);while(ts[i]?.text==='.'){i++;if(!ts[i++]?.id)return false;}
  if(['STRING','WSTRING'].includes(name)&&['[','('].includes(ts[i]?.text))return group(ts[i].text,ts[i].text==='['?']':')');
  return true;
 }
 return type()&&i===ts.length;
}
export function parseDeclaration(source:string,kind:string,name:string){
 const s=normalize(source),rows:any[]=[],{tokens:t,comments,error}=lex(s);let i=0,complete=true;
 const pos=(a:number,b:number)=>declarationPosition(s,a,b);
 const gap=(a:number,b:number,reason:string,section:string|null=null)=>{complete=false;rows.push({category:'parse-gap',section,reason,position:pos(a,b),source:s.slice(a,b)});};
 const text=(ts:Token[])=>s.slice(ts[0].start,ts.at(-1)!.end);
 const isBlock=(x?:Token,previous?:Token)=>previous?.text!=='.'&&allSections.has(upper(x));
 if(s.length>1000000){gap(0,s.length,'Declaration exceeds 1000000 UTF-16 units; not parsed');return {rows,complete:false};}
 if(kind==='array'||kind==='enum')return {rows,complete:true,excluded:'Type definition, not variable instances or structure fields'};
 if(kind==='structure'){
  if(upper(t[0])!=='TYPE'||t[1]?.text.toLowerCase()!==name.toLowerCase()||t[2]?.text!==':'||upper(t[3])!=='STRUCT'){
   gap(0,s.length,'Unsupported structure header/attributes');return {rows,complete:false};
  }i=4;
 }else if(kind!=='gvl'){
  if(!['PROGRAM','FUNCTION_BLOCK','FUNCTION'].includes(upper(t[0]))||t[1]?.text.toLowerCase()!==name.toLowerCase()){
   gap(0,s.length,'Unsupported POU header/attributes');return {rows,complete:false};
  }
  i=2;
  if(upper(t[0])==='FUNCTION'){
   if(t[i]?.text!==':'){gap(t[0].start,s.length,'Function return declaration unavailable');return {rows,complete:false};}
   const from=++i;while(i<t.length&&!isBlock(t[i],t[i-1]))i++;
   if(from===i||!typeSupported(t.slice(from,i))){gap(t[from]?.start??s.length,t[i]?.start??s.length,'Unsupported function return type');}
   else rows.push({category:'function-return',name,section:null,typeRaw:text(t.slice(from,i)),typePosition:pos(t[from].start,t[i-1].end),position:pos(t[0].start,t[i-1].end),source:s.slice(t[0].start,t[i-1].end)});
  }
 }
 function statement(ts:Token[],end:Token,section:string,mods:Token[]){
  if(!ts.length)return;
  let colon=-1,assign=-1;const stack:string[]=[];
  for(let k=0;k<ts.length;k++){
   const v=ts[k].text;if(['[','('].includes(v))stack.push(v);
   else if([']',')'].includes(v)){const need=v===']'?'[':'(';if(stack.pop()!==need){gap(ts[0].start,end.end,'Mismatched declaration delimiters',section);return;}}
   else if(!stack.length){if(v===':'&&colon<0)colon=k;else if(v===':='&&assign<0)assign=k;}
  }
  const at=ts.findIndex((x,k)=>k<colon&&upper(x)==='AT'),names=ts.slice(0,at>=0?at:colon);
  if(colon<1||names.length%2!==1||names.some((x,k)=>k%2?x.text!==',':!x.id||sections.has(upper(x)))||at>=0&&(names.length!==1||at+1===colon)){
   gap(ts[0].start,end.end,'Unsupported variable names/address/declaration boundary',section);return;
  }
  const typ=ts.slice(colon+1,assign<0?undefined:assign),init=assign<0?[]:ts.slice(assign+1);
  if(!typ.length||!typeSupported(typ)||assign>=0&&!init.length){gap(ts[0].start,end.end,'Unsupported type or empty explicit initializer',section);return;}
  // A second declaration head at initializer depth zero signals an untrusted
  // boundary, not an expression to publish. Do not ban ':' or ':=' globally:
  // time literals and nested aggregate/named arguments retain their raw text.
  const declarationHead=(at:number)=>{
   if(!init[at]?.id)return false;
   let k=at+1;
   while(init[k]?.text===','&&init[k+1]?.id)k+=2;
   if(upper(init[k])==='AT'){k++;while(k<init.length&&![':',':='].includes(init[k].text))k++;}
   return init[k]?.text===':'&&!!init[k+1]?.id;
  };
  let depth=0;
  for(let k=0;k<init.length;k++){
   const v=init[k].text;
   if(!depth&&declarationHead(k)){
    gap(ts[0].start,s.length,'Possible declaration inside initializer; missing terminator or unsupported boundary, remaining object not parsed',section);return false;
   }
   if(['(','['].includes(v))depth++;else if([')',']'].includes(v))depth--;
  }
  const address=at<0?null:text(ts.slice(at+1,colon)),range=pos(ts[0].start,end.end);
  for(let k=0;k<names.length;k+=2)rows.push({category:kind==='structure'?'type-field':'variable',name:names[k].text,section,
   modifiers:mods.map(x=>x.text),modifierText:mods.length?text(mods):'',typeRaw:text(typ),typePosition:pos(typ[0].start,typ.at(-1)!.end),
   hasExplicitInitializer:assign>=0,initializerRaw:init.length?text(init):null,initializerPosition:init.length?pos(init[0].start,init.at(-1)!.end):null,
   addressRaw:address,addressPosition:at>=0?pos(ts[at+1].start,ts[colon-1].end):null,namePosition:pos(names[k].start,names[k].end),
   position:range,source:s.slice(range.startOffset,range.endOffset),commentAssociation:names.length===1?'single-name-declaration':'shared-declaration-no-exclusive-comment-owner'});
 }
 function block(section:string,endWord:string,mods:Token[]){
  let start=i,initializer=false;const stack:string[]=[];
  while(i<t.length){
   const x=t[i],v=x.text,keyword=t[i-1]?.text!=='.',newSection=!stack.length&&isBlock(x,t[i-1]);
   if(!stack.length&&keyword&&upper(x)===endWord){if(start<i)gap(t[start].start,x.start,'Missing statement terminator',section);i++;return true;}
   if(newSection||!initializer&&keyword&&compoundBoundaries.has(upper(x))){
    gap(t[start]?.start??x.start,s.length,newSection?'Missing '+endWord+' before declaration section '+upper(x)+'; remaining object not parsed':'Unsupported compound declaration boundary '+upper(x)+'; remaining object not parsed',section);
    i=t.length;return false;
   }
   if(!stack.length&&v===':=')initializer=true;
   if(['(','[','{'].includes(v))stack.push(v);
   else if([')',']','}'].includes(v)){if(stack.pop()!==({')':'(',']':'[','}':'{'} as any)[v]){gap(t[start]?.start??x.start,s.length,'Uncertain delimiter boundary; remaining object not parsed',section);i=t.length;return false;}}
   if(!stack.length&&v===';'){if(statement(t.slice(start,i),x,section,mods)===false){i=t.length;return false;}start=i+1;initializer=false;}
   i++;
  }
  gap(t[start]?.start??s.length,s.length,stack.length?'Unclosed declaration delimiter; remaining object not parsed':'Unclosed declaration section',section);return false;
 }
 if(kind==='structure'){
  if(block('STRUCT','END_STRUCT',[])){
   if(upper(t[i])==='END_TYPE')i++;
   else gap(t[i]?.start??s.length,s.length,'Missing END_TYPE');
   if(i<t.length)gap(t[i].start,s.length,'Trailing structure content');
  }
 }else while(i<t.length){
  const section=upper(t[i]),from=i;
  if(!sections.has(section)||kind==='gvl'&&section!=='VAR_GLOBAL'||kind!=='gvl'&&section==='VAR_GLOBAL'){
   // Unsupported section is a locatable gap. Do not mine its contents for names.
   if(allSections.has(section)){gap(t[from].start,s.length,'Unsupported declaration section; remaining object not parsed: '+section,section);i=t.length;break;}
   gap(t[i].start,s.length,'Unsupported top-level content/attributes; remaining object not parsed');i=t.length;break;
  }
  i++;const mods:Token[]=[];while(modifiers.has(upper(t[i])))mods.push(t[i++]);
  if(!block(section,'END_VAR',mods))break;
 }
 if(error)gap(error.start,error.end,error.text);
 for(const c of comments){
  const owner=rows.find(x=>['variable','type-field'].includes(x.category)&&x.commentAssociation==='single-name-declaration'&&c.start>=x.position.startOffset&&c.end<=x.position.endOffset);
  rows.push({category:'comment',section:owner?.section??null,position:pos(c.start,c.end),source:c.text,association:owner?'within-single-name-declaration':'unassociated',...(owner?{associatedName:owner.name}:{})});
 }
 return {rows:rows.sort((a,b)=>a.position.startOffset-b.position.startOffset||a.category.localeCompare(b.category)),complete};
}

const preview=(s:string)=>({text:s.slice(0,stringEnd(s,0,256)),utf16Length:s.length,sha256:digest(s),complete:false});
function boundedEntry(row:any){
 const r={...row},previews:any={};
 for(const k of ['typeRaw','initializerRaw','addressRaw','modifierText','source'])if(typeof r[k]==='string'&&r[k].length>256){previews[k]=preview(r[k]);r[k]=null;}
 return {...r,...(Object.keys(previews).length?{previews}:{})};
}
function variableInventory(raw:Reply,a:any,origin:{kind:string,inventoryOperationId:string}):Reply {
 if(raw.status!=='succeeded')return raw;
 // Internal inventory identity stays at the existing v2 variable-table digest.
 // Public project_search modes must not invalidate another tool's stored pages.
 const validated=searchResult(raw,{...a,query:'\0variable-inventory-validation',areas:['name'],caseSensitive:true,offset:0,limit:1,maxResults:1},{legacy:true}).data as any;
 const d=raw.data as any,objects=[...d.corpus].map(o=>({...o,declaration:normalize(o.declaration)})).sort((x:any,y:any)=>canonical(x.path).localeCompare(canonical(y.path))||x.objectId.localeCompare(y.objectId));
 const selected=objects.filter(o=>!a.objectId||o.objectId===a.objectId),truncatedObjects=selected.length>a.maxObjects;
 const parsed=selected.slice(0,a.maxObjects).map(o=>({object:o,...parseDeclaration(o.declaration,o.objectType,o.path.at(-1))}));
 const matched=(name:string)=>!a.name||(a.caseSensitive?name.includes(a.name):name.toLowerCase().includes(a.name.toLowerCase()));
 const rows=parsed.flatMap(p=>p.rows.filter(row=>!['variable','type-field'].includes(row.category)||matched(row.name)).map(row=>({...row,objectId:p.object.objectId,path:p.object.path,objectType:p.object.objectType,contentHash:p.object.contentHash})));
 if(a.objectId&&!selected.length)rows.push({category:'parse-gap',objectId:a.objectId,path:[],objectType:null,contentHash:null,section:null,reason:'Requested object unavailable in supported read inventory; inspect source failures/skips, not proof of variable absence',position:null,source:''});
 rows.forEach((r,i)=>r.index=i);
 const uncovered=d.scope.skippedObjects.filter((x:any)=>(!a.objectId||a.objectId===x.objectId)&&['6f9dac99-8de1-4efc-8465-68ac443b7d08','ffbfa93a-b94d-45fc-a329-229860183b1d','2db5746d-d284-4425-9f7f-2663a34b0ebc'].includes(x.nativeTypeId));
 const readComplete=d.scope.coverageComplete&&uncovered.length===0,parseComplete=parsed.every(p=>p.complete)&&(!a.objectId||selected.length===1)&&!truncatedObjects;
 const coverage={objectEnumerationComplete:d.scope.treeComplete,sourceReadComplete:readComplete,declarationParseComplete:parseComplete,supportedScopeComplete:readComplete&&parseComplete,
  wholeApplicationVariableTable:false,readObjects:objects.length,selectedObjects:selected.length,parsedObjects:parsed.length,maxObjects:a.maxObjects,objectsTruncated:truncatedObjects,
  uncoveredDeclarationObjects:uncovered,excludedDefinitions:parsed.filter(p=>p.excluded).map(p=>({objectId:p.object.objectId,path:p.object.path,reason:p.excluded})),parseGapCount:rows.filter(r=>r.category==='parse-gap').length};
 const version=digest(canonical({parser:VARIABLE_PARSER_VERSION,sourceVersion:validated.version,objectId:a.objectId??null,name:a.name??null,caseSensitive:a.caseSensitive,maxObjects:a.maxObjects,maxEntries:a.maxEntries,coverage}));
 const reject=(code:string,message:string)=>({...reply('conflict',message),operationId:raw.operationId,error:{code,message}});
 if(a.expectedVersion&&version!==a.expectedVersion)return reject('NATIVE_VERSION_CHANGED','变量表内容、查询或覆盖版本已变化，请重新查询，未混合页面');
 const truncated=rows.length>a.maxEntries,retained=rows.slice(0,a.maxEntries);
 if(a.offset>retained.length)return reject('VARIABLE_PAGE_OUT_OF_RANGE','偏移超出原清单，请使用实际nextOffset');
 const counts=Object.fromEntries(['variable','type-field','comment','parse-gap','function-return'].map(c=>[c,rows.filter(r=>r.category===c).length]));
 const base={projectId:d.projectId,applicationId:d.applicationId,targetKind:'application',projectPath:d.projectPath,diskHash:d.diskHash,readOnlyEvidence:d.readOnlyEvidence,version,
  basis:'declaration-parsing',parserVersion:VARIABLE_PARSER_VERSION,positionConvention:'LF-normalized object_read declaration; zero-based UTF-16 offsets, end exclusive; one-based UTF-16 line/column',
  query:{objectId:a.objectId??null,name:a.name??null,caseSensitive:a.caseSensitive,nameMatch:'literal-substring'},scope:d.scope,coverage,counts,
  noMatchConclusion:counts.variable+counts['type-field']?'declarations-found':readComplete&&parseComplete?'no-matching-declarations-in-supported-scope':'coverage-incomplete-no-definitive-absence',
  readOrigin:origin,limits:'No runtime values, evaluated initial values, instance/array expansion, I/O mapping or semantic references. Read gaps/skips and parse gaps are independent. sourceRead retrieves original declaration, not implementation.'};
 let sourceDetail:any,entries:any[]=[],returned=0;
 if(a.sourceRead){
  const v=a.sourceRead,o=objects.find(o=>o.objectId===v.objectId&&(!a.objectId||o.objectId===a.objectId));
  if(!o)return reject('VARIABLE_SOURCE_NOT_FOUND','指定对象不在原清单及查询范围内');
  if(v.offset>o.declaration.length||!isStringBoundary(o.declaration,v.offset))return reject('VARIABLE_SOURCE_OFFSET','偏移越界或位于字符中间');
  const end=stringEnd(o.declaration,v.offset,v.limit);
  sourceDetail={objectId:o.objectId,contentHash:o.contentHash,offset:v.offset,endOffset:end,text:o.declaration.slice(v.offset,end),totalLength:o.declaration.length,sha256:digest(o.declaration),hasMore:end<o.declaration.length,nextOffset:end<o.declaration.length?end:null};
 }else{
  for(const row of retained.slice(a.offset,a.offset+a.limit)){
   const next=[...entries,boundedEntry(row)];if(jsonBytes({...base,entries:next})>12000)break;entries=next;returned++;
  }
 }
 const end=a.offset+returned,more=end<retained.length;
 const result={...raw,summary:'已按原始声明只读解析；请区分变量、类型字段、返回声明、注释及缺口',data:{...base,entries,...(sourceDetail?{sourceDetail}:{}),
  page:{offset:a.offset,limit:a.limit,returned,retained:retained.length,hasMore:!sourceDetail&&more,nextOffset:!sourceDetail&&more?end:null,truncated,total:readComplete&&parseComplete&&!truncated?rows.length:null},
  delivery:{previewsAreNotMissingValues:true,sourceReadRequiredForPreview:true,pageReduced:!sourceDetail&&returned<Math.min(a.limit,retained.length-a.offset)}}};
 if(jsonBytes(result)>14000||!sourceDetail&&retained.length>a.offset&&!returned)return {...reply('unsupported','元数据超过响应上限，完整原声明仍在原IPC；未宣称已返回完整表'),operationId:raw.operationId,error:{code:'VARIABLE_METADATA_TOO_LARGE',message:'不能通过默认值或静默裁剪补齐'}};
 return result;
}
export function variableResult(raw:Reply,a:any,origin={kind:'ide',inventoryOperationId:raw.operationId!}):Reply {
 try{return variableInventory(raw,a,origin);}
 catch(e:any){throw new DomainError('unknown','VARIABLE_EVIDENCE_INVALID','原始声明清单或解析结果无法核实，保持冻结；未重新派发：'+e.message);}
}
