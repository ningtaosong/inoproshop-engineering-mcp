import {z} from 'zod';
import {DomainError, reply, schemas, searchDataSchema, type Reply} from './contracts.js';
import {jsonBytes, stringEnd} from './native-output.js';
import {searchResult} from './queries.js';
import {IDENTIFIER_LEXER_VERSION, lexSt, type Token} from './st-lex.js';
import {canonical, digest, normalize} from './storage.js';
import {declarationPosition, parseDeclaration, VARIABLE_PARSER_VERSION} from './variables.js';

export const VARIABLE_USAGES_VERSION='bounded-st-usages-v1';
type Args=z.infer<typeof schemas.variable_usages>;
type Source={objectId:string;path:string[];objectType:string;pouType?:string;pouTypeSource?:string;hasImplementation:boolean;
  declaration:string;implementation:string;contentHash:string};
type Row={category:string;name:string;section:string;typeRaw:string;addressRaw:string|null;modifiers:string[];
  commentAssociation:string;namePosition:ReturnType<typeof declarationPosition>};
type Rule='program-local'|'explicit-root-gvl'|'direct-structure-field';
type Binding={object:Source;row:Row;rule:Rule};
const fold=(name:string)=>name.toLowerCase();
const simpleType=/^(?:BOOL|BYTE|WORD|DWORD|LWORD|SINT|INT|DINT|LINT|USINT|UINT|UDINT|ULINT|REAL|LREAL|TIME|LTIME|DATE|TOD|DT|STRING|WSTRING)$/i;
const flow=new Set(['IF','THEN','ELSE','ELSIF','END_IF','CASE','END_CASE','FOR','END_FOR','WHILE','END_WHILE',
  'REPEAT','UNTIL','END_REPEAT','JMP','RETURN','EXIT','CONTINUE']);
const exclusions=['声明初始化、FB/方法/属性/函数及其他语言','可视化、编译库、任务调用、设备配置和 I/O 绑定',
  '数组下标、嵌套成员、指针/引用/类型别名、调用实参、控制流及非简单赋值'];

function sections(object:Source):Row[]|undefined {
  if(!['st_pou','gvl','structure'].includes(object.objectType))return;
  if(object.objectType==='st_pou'&&(object.pouType!=='program'||object.pouTypeSource!=='native-pou-type-id-and-declaration-header'))return;
  const declaration=normalize(object.declaration);
  const {tokens,error}=lexSt(declaration);
  if(error||tokens.some(t=>t.text==='{'||t.text==='}'))return;
  const parsed=parseDeclaration(declaration,object.objectType,object.path.at(-1)!);
  const section=object.objectType==='gvl'?'VAR_GLOBAL':object.objectType==='structure'?'STRUCT':'VAR';
  const rows=parsed.rows.filter(r=>r.category==='variable'||r.category==='type-field') as Row[];
  if(!parsed.complete||rows.some(r=>r.section!==section||r.addressRaw!==null||r.modifiers.length||r.commentAssociation!=='single-name-declaration')||
    new Set(rows.map(r=>fold(r.name))).size!==rows.length)return;
  return rows;
}

function statements(tokens:Token[]) {
  const result:{tokens:Token[];complete:boolean}[]=[];
  const closing:string[]=[];
  let start=0;
  for(const [i,t] of tokens.entries()) {
    if(t.text==='('||t.text==='[')closing.push(t.text==='('?')':']');
    if((t.text===')'||t.text===']')&&closing.pop()!==t.text)return [{tokens,complete:false}];
    if(t.text===';'&&closing.length===0){result.push({tokens:tokens.slice(start,i),complete:true});start=i+1;}
  }
  if(closing.length)return [{tokens,complete:false}];
  if(start<tokens.length)result.push({tokens:tokens.slice(start),complete:false});
  return result;
}

const directName=(v:Token[])=>v.length===1&&v[0].id===true||v.length===3&&v[0].id===true&&v[1].text==='.'&&v[2].id===true;
const literal=(v:Token[])=>v.length===1&&(/^(?:true|false)$/i.test(v[0].text)||
  !v[0].id&&/^(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|['"])/i.test(v[0].text));

export function variableUsagesResult(raw:Reply,a:Args):Reply {
  if(raw.status!=='succeeded')return raw;
  // Reuse the search inventory's identity and content verification. Its literal
  // scan uses a fixed needle and keeps at most one row. Only the inventory
  // fingerprint is used, so it is independent of the target declaration.
  const checked=searchResult(raw,{...a,targetKind:'application',query:'\u0000',areas:['implementation'],
    caseSensitive:false,matchMode:'literal',offset:0,limit:1,maxResults:1,expectedVersion:undefined});
  const source=searchDataSchema.parse(checked.data);
  const objects=(raw.data!.corpus as Source[]).slice().sort((x,y)=>x.objectId.localeCompare(y.objectId));
  const isRoot=(path:string[])=>path.length===source.scope.applicationPath.length+1;
  const roots=objects.filter(o=>isRoot(o.path));
  const skippedRoots=source.scope.skippedObjects.filter(o=>isRoot(o.path));
  const rootNames=new Map<string, (Source|null)[]>();
  for(const o of [...roots,...skippedRoots]) {
    const name=fold(o.path.at(-1)!);
    const found=rootNames.get(name)??[];
    found.push('contentHash' in o?o:null);rootNames.set(name,found);
  }
  const parsed=new Map<string,Row[]|undefined>();
  for(const o of objects)parsed.set(o.objectId,sections(o));
  const find=(object:Source,name:string)=>parsed.get(object.objectId)?.find(row=>fold(row.name)===fold(name));
  const rootObject=(name:string,kind:string)=> {
    const found=rootNames.get(fold(name));
    return source.scope.coverageComplete&&found?.length===1&&found[0]?.objectType===kind?found[0]:undefined;
  };
  function plainType(row:Row) {
    const structure=rootObject(row.typeRaw,'structure');
    return simpleType.test(row.typeRaw)||/^W?STRING\s*\(\s*\d+\s*\)$/i.test(row.typeRaw)||
      (structure!==undefined&&parsed.get(structure.objectId)!==undefined);
  }
  const target=objects.find(o=>o.objectId===a.declaration.objectId);
  const stale=()=>new DomainError('conflict','USAGE_DECLARATION_CHANGED','声明对象、原文位置或内容版本不匹配；请重新读取 variable_inspect 的声明条目');
  if(!target||target.contentHash!==a.declaration.contentHash)throw stale();
  const targetRow=find(target,a.declaration.name);
  if(!targetRow) {
    if(!parsed.get(target.objectId))throw new DomainError('unsupported','USAGE_DECLARATION_SCOPE','目标声明区、类型或语法超出本次静态分析范围');
    throw stale();
  }
  if(targetRow.section!==a.declaration.section||targetRow.namePosition.startOffset!==a.declaration.startOffset||
    targetRow.namePosition.endOffset!==a.declaration.endOffset)throw stale();
  if(!plainType(targetRow)||target.objectType!=='st_pou'&&rootObject(target.path.at(-1)!,target.objectType)!==target)
    throw new DomainError('unsupported','USAGE_DECLARATION_SCOPE','目标类型或根声明归属无法在限定范围内唯一确认');

  const declaredName=fold(targetRow.name);
  const targetDeclaration={objectId:target.objectId,path:target.path,section:targetRow.section,name:targetRow.name,
    contentHash:target.contentHash,namePosition:targetRow.namePosition,typeRaw:targetRow.typeRaw};
  const version=digest(canonical({analysisVersion:VARIABLE_USAGES_VERSION,parser:VARIABLE_PARSER_VERSION,
    lexer:IDENTIFIER_LEXER_VERSION,sourceSnapshot:source.version,targetDeclaration}));
  const changed=()=>new DomainError('conflict','USAGES_VERSION_CHANGED','原声明、源码快照或分析规则已变化；请显式重新首查');
  if(a.expectedVersion&&a.expectedVersion!==version)throw changed();

  function resolve(program:Source,operand:Token[]):Binding|undefined {
    const owner=operand[0].text;
    const local=find(program,owner);
    if(operand.length===1)return local&&plainType(local)?{object:program,row:local,rule:'program-local'}:undefined;
    const member=operand[2].text;
    const sameName=rootNames.has(fold(owner));
    if(local&&sameName)return;
    if(!local) {
      const gvl=rootObject(owner,'gvl');const row=gvl&&find(gvl,member);
      return gvl&&row&&plainType(row)?{object:gvl,row,rule:'explicit-root-gvl'}:undefined;
    }
    const struct=rootObject(local.typeRaw,'structure');const row=struct&&find(struct,member);
    return struct&&row&&plainType(row)?{object:struct,row,rule:'direct-structure-field'}:undefined;
  }

  type Gap={objectId:string;path:string[];region:'declaration'|'implementation';reason:string};
  const gaps:Gap[]=[];let gapCount=0,totalUsages=0,totalUnknown=0;
  function gap(object:Source,region:Gap['region'],reason:string) {
    gapCount++;
    if(gaps.length<6)gaps.push({objectId:object.objectId,path:object.path,region,reason});
  }
  type Location={objectId:string;path:string[];contentHash:string;region:'implementation';position:ReturnType<typeof declarationPosition>;
    matchedText:string;context:{text:string;startOffset:number;endOffset:number}};
  const pageRows:(Location&({rule:Rule}|{reason:string}))[]=[];
  for(const object of objects) {
    if(!object.hasImplementation)continue;
    const text=normalize(object.implementation);
    const {tokens,error}=lexSt(text,true);
    const supported=object.objectType==='st_pou'&&object.pouType==='program'&&!!parsed.get(object.objectId);
    const bounded=supported&&!error&&!tokens.some(t=>flow.has(t.text.toUpperCase())||t.text==='{'||t.text==='}');
    if(!supported)gap(object,'declaration','非普通 PROGRAM，或声明作用域无法完整定位');
    if(!bounded)gap(object,'implementation',error?.text??'超出普通 PROGRAM 的无控制流简单赋值范围');
    for(const stmt of statements(tokens)) {
      const assignment=stmt.tokens.findIndex(t=>t.text===':=');
      const left=stmt.tokens.slice(0,assignment),right=stmt.tokens.slice(assignment+1);
      const admitted=bounded&&stmt.complete&&assignment>0&&directName(left)&&(directName(right)||literal(right));
      if(bounded&&!admitted&&stmt.tokens.length)gap(object,'implementation','非简单赋值或语句边界不完整');
      const candidates=stmt.tokens.filter(t=>t.id&&fold(t.text)===declaredName);
      const sides=admitted?[left,...(directName(right)?[right]:[])]:[];
      const bindings=new Map(sides.map(side=>[side.at(-1)!,resolve(object,side)]));
      for(const token of candidates) {
        const binding=bindings.get(token);
        if(binding&&(binding.object.objectId!==target.objectId||binding.row.namePosition.startOffset!==targetRow.namePosition.startOffset))continue;
        const index=totalUsages+totalUnknown;
        if(binding)totalUsages++;else totalUnknown++;
        if(index<a.offset||pageRows.length>=a.limit)continue;
        let start=Math.max(0,token.start-52);
        if(start>0&&/[\uDC00-\uDFFF]/.test(text[start])&&/[\uD800-\uDBFF]/.test(text[start-1]))start--;
        const end=stringEnd(text,start,160);
        pageRows.push({objectId:object.objectId,path:object.path,contentHash:object.contentHash,region:'implementation',
          position:declarationPosition(text,token.start,token.end),matchedText:token.text,
          context:{text:text.slice(start,end),startOffset:start,endOffset:end},
          ...(binding?{rule:binding.rule}:{reason:admitted?'限定名、类型、别名或作用域无法唯一绑定':'未覆盖的语句、对象或词法边界'})});
      }
    }
  }
  const total=totalUsages+totalUnknown;
  if(a.offset>total)throw changed();
  const summary=totalUsages?'已定位限定 ST 静态用法；未知候选及覆盖缺口分别报告':'在已读且受支持的范围内未发现目标声明用法；请核对未知候选与未覆盖范围';
  const result=(rows:typeof pageRows)=>({...reply('succeeded',summary,{projectId:source.projectId,applicationId:a.applicationId,
    projectPath:source.projectPath,applicationPath:source.scope.applicationPath,diskHash:source.diskHash,readOnlyEvidence:source.readOnlyEvidence,
    sourceSnapshot:source.version,version,analysisVersion:VARIABLE_USAGES_VERSION,basis:'bounded-st-static-inference',
    positionConvention:'LF 源码；UTF-16 偏移从 0 起、结束不含；行列从 1 起',targetDeclaration,
    usages:rows.filter(r=>'rule' in r),unknown:rows.filter(r=>'reason' in r),
    coverage:{treeComplete:source.scope.treeComplete,sourceReadComplete:source.scope.readFailures.length===0,
      sourceScopeComplete:source.scope.coverageComplete,readObjects:source.scope.readObjects,
      unsupportedObjects:source.scope.skippedObjects.length,gapCount,gaps,exclusions},
    page:{offset:a.offset,limit:a.limit,returned:rows.length,nextOffset:a.offset+rows.length<total?a.offset+rows.length:null,
      hasMore:a.offset+rows.length<total,totalUsages,totalUnknown},
    conclusion:totalUsages?'found-in-covered-st':'not-found-in-read-and-supported-scope'}),operationId:raw.operationId});
  let rows=pageRows;
  while(rows.length>1&&jsonBytes(result(rows))>14000)rows=rows.slice(0,Math.ceil(rows.length/2));
  const output=result(rows);
  if(jsonBytes(output)>14000)throw new DomainError('unsupported','USAGE_METADATA_TOO_LARGE','本页原文定位元数据超出返回上限；未据此判断无引用');
  return output;
}
