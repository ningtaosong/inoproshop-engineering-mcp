// S4a source planning only. The service re-reads native text before planning;
// the bridge checks the same content, project and disk versions before writing.
import {normalize,codeHash,canonical} from './storage.js';
import {propertyEvidence} from './properties.js';
import {methodDeclarationMatches} from './contracts.js';
import {lexSt} from './st-lex.js';
import {parseDeclaration} from './variables.js';
import {parseInitializerMembers} from './initializer-members.js';

export type VariableType='BOOL'|'DINT'|'TIME';
export type VariableSection='VAR_INPUT'|'VAR_OUTPUT';
export type VariableEdit={action:'add'|'set-initializer'|'set-type'|'add-initializer';name:string;type?:VariableType;initializer:string;expectedOldInitializer?:string;expectedOldType?:VariableType;section?:VariableSection};
export type MemberInitializerEdit={action:'set-member-initializer'|'add-member-initializer';name:string;memberName:string;initializer:string;expectedOldInitializer?:string};
export const isMemberInitializerAction=(action:string)=>['set-member-initializer','add-member-initializer'].includes(action);
const ident=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
// CODESYS ST keywords and reserved IEC names are not plain variable identifiers.
// Match whole tokens only; a name such as IfEnabled remains a valid identifier.
// Backtick-escaped identifiers and vendor extensions are outside S4a.
const reserved=new Set(`
 ACTION END_ACTION PROGRAM END_PROGRAM FUNCTION END_FUNCTION FUNCTION_BLOCK END_FUNCTION_BLOCK
 METHOD PROPERTY GET SET INTERFACE NAMESPACE END_NAMESPACE EXTENDS IMPLEMENTS
 PUBLIC PRIVATE PROTECTED INTERNAL ABSTRACT FINAL OVERRIDE
 VAR END_VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_INOUT VAR_GLOBAL VAR_EXTERNAL VAR_ACCESS
 VAR_TEMP VAR_STAT VAR_INST VAR_CONFIG CONSTANT RETAIN PERSISTENT NON_RETAIN AT
 TYPE END_TYPE STRUCT END_STRUCT UNION END_UNION ARRAY OF ENUM
 IF THEN ELSIF ELSE END_IF CASE END_CASE FOR FROM TO BY DO END_FOR
 WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT CONTINUE RETURN WITH
 AND OR XOR NOT MOD DIV MUL AND_THEN OR_ELSE
 TRUE FALSE NULL THIS SUPER REF REFERENCE POINTER
 BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT ULINT
 REAL LREAL T TIME LTIME DATE LDATE TIME_OF_DAY TOD LTOD DATE_AND_TIME DT LDT
 STRING WSTRING CHAR WCHAR BIT
 ANY ANY_BIT ANY_INT ANY_NUM ANY_REAL ANY_STRING ANY_DATE ANY_DERIVED
 ANY_ELEMENTARY ANY_MAGNITUDE ANY_SIGNED ANY_DURATION ANY_CHARS
 CHAR_TO TO_CHAR WCHAR_TO TO_WCHAR ATAN2 USING CLASS
 READ_ONLY READ_WRITE PARAMS
`.trim().split(/\s+/));
// CODESYS Development System, Operators reference: implicit IEC/native
// operators are distinct from ordinary library functions (e.g. CONCAT).
// https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html
const nativeOperators=new Set(`
 ADD SUB MUL DIV MOD MOVE INDEXOF SIZEOF XSIZEOF
 AND OR XOR NOT AND_THEN OR_ELSE SHL SHR ROL ROR
 SEL MAX MIN LIMIT MUX GT LT LE GE EQ NE ADR BITADR CAL
 TRUNC TRUNC_INT ABS SQRT LN LOG EXP EXPT SIN ASIN COS ACOS TAN ATAN
 TEST_AND_SET INI
`.trim().split(/\s+/));
// The same reference defines typed SOURCE_TO_TARGET and overloaded TO_TARGET
// conversions. DATE_AND_TIME/TIME_OF_DAY are overloaded target aliases, not
// typed conversion commands. Vendor-only conversions are not inferred here.
const typedConversionTypes=new Set(`
 BIT BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT ULINT
 REAL LREAL TIME LTIME DATE LDATE TOD LTOD DT LDT STRING WSTRING
`.trim().split(/\s+/));
const overloadedConversionTypes=new Set([...typedConversionTypes,'DATE_AND_TIME','TIME_OF_DAY']);

function isNativeConversion(name:string):boolean {
  if(name.startsWith('TO_')&&overloadedConversionTypes.has(name.slice(3)))return true;
  for(const source of typedConversionTypes){
    if(name.startsWith(source+'_TO_')&&typedConversionTypes.has(name.slice(source.length+4)))return true;
  }
  return false;
}

function checkVariableName(name:string):void {
  if(!ident.test(name)||name.includes('__'))throw new Error('Invalid plain ST variable identifier');
  const upper=name.toUpperCase();
  if(reserved.has(upper)||nativeOperators.has(upper)||isNativeConversion(upper))
    throw new Error(`Reserved ST keyword cannot be a variable name: ${name}`);
}

export function checkedInitializer(type:VariableType,raw:string):string {
  if(type==='BOOL'&&/^(TRUE|FALSE)$/i.test(raw))return raw;
  if(type==='DINT'&&/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(raw)){
    const n=BigInt(raw);if(n>=-2147483648n&&n<=2147483647n)return raw;
  }
  // Deliberately narrow pending native range verification. Only syntax, not
  // a claim that the installed IDE accepts every number in this range.
  if(type==='TIME'&&/^T#(?:0|[1-9][0-9]*)(?:ms|s)$/i.test(raw)){
    const m=/^T#([0-9]+)(ms|s)$/i.exec(raw)!;
    const ms=BigInt(m[1])*(m[2].toLowerCase()==='s'?1000n:1n);
    if(ms<=60000n)return raw;
  }
  throw new Error('Unsupported or out-of-range literal');
}

export function planVariableEdit(declaration:string,kind:'gvl'|'st_pou'|'function_block',objectName:string,edit:VariableEdit,directChildNames?:string[]){
  const source=normalize(declaration);
  checkVariableName(edit.name);
  if(edit.section&&(kind!=='function_block'||!['VAR_INPUT','VAR_OUTPUT'].includes(edit.section)))
    throw new Error('Interface section requires a plain ST FUNCTION_BLOCK');
  const parsed=parseDeclaration(source,kind,objectName);
  if(!parsed.complete||parsed.rows.some((r:any)=>r.category==='parse-gap'))throw new Error('Declaration boundary incomplete');
  const section=edit.section??(kind==='gvl'?'VAR_GLOBAL':'VAR');
  const rows=parsed.rows.filter((r:any)=>r.category==='variable'&&r.section===section);
  const hits=rows.filter((r:any)=>r.name.toLowerCase()===edit.name.toLowerCase());
  const tokens=lexSt(source);
  if(tokens.error)throw new Error('Lexical boundary incomplete');
  const blocks=[] as {head:number;body:number;end:number;unsupportedHeader:boolean}[];
  const blockHead=new Set(['VAR','VAR_INPUT','VAR_OUTPUT','VAR_IN_OUT','VAR_INOUT','VAR_GLOBAL','VAR_EXTERNAL',
    'VAR_ACCESS','VAR_TEMP','VAR_STAT','VAR_INST','VAR_CONFIG']);
  const unsupportedHeader=new Set(['RETAIN','NON_RETAIN','PERSISTENT','CONSTANT','{']);
  for(let i=0;i<tokens.tokens.length;i++){
    const t=tokens.tokens[i];if(t.text.toUpperCase()!==section)continue;
    const modified=unsupportedHeader.has(tokens.tokens[i+1]?.text.toUpperCase()??'');
    // An explicit interface section must count every matching block, including
    // empty and modified ones. Otherwise a later unsupported block can hide a
    // duplicate while the first ordinary block is still writable.
    if(!edit.section&&!['set-type','add-initializer'].includes(edit.action)&&modified)continue;
    const stop=tokens.tokens.find((v,j)=>j>i&&(v.text.toUpperCase()==='END_VAR'||blockHead.has(v.text.toUpperCase())));
    if(edit.section&&(!stop||stop.text.toUpperCase()!=='END_VAR'))throw new Error('Declaration block boundary incomplete');
    if(stop?.text.toUpperCase()==='END_VAR')blocks.push({head:t.start,body:t.end,end:stop.start,unsupportedHeader:modified});
  }
  if(edit.section&&blocks.length!==1)throw new Error('Ambiguous or missing declaration block');
  if(edit.section&&blocks[0].unsupportedHeader)throw new Error('Unsupported declaration block modifier or attribute');
  if(edit.action==='set-type'){
    if(edit.section||kind==='gvl'&&section!=='VAR_GLOBAL'||kind!=='gvl'&&section!=='VAR')
      throw new Error('Type edit requires an ordinary VAR or root VAR_GLOBAL');
    if(blocks.length!==1||blocks[0].unsupportedHeader)throw new Error('Ambiguous, modified or missing declaration block');
    if(!edit.type||!edit.expectedOldType||edit.expectedOldInitializer===undefined)
      throw new Error('Type edit requires target type, old type and old initializer');
  }
  if(edit.action==='add'){
    if(!edit.type)throw new Error('Type required');
    const value=checkedInitializer(edit.type,edit.initializer);
    if(parsed.rows.some((r:any)=>r.name?.toLowerCase()===edit.name.toLowerCase()&&r.category!=='comment'))throw new Error('Variable name conflict');
    if(edit.section){
      if(!directChildNames)throw new Error('Direct Method/Property inventory required');
      if(directChildNames.some(name=>name.toLowerCase()===edit.name.toLowerCase()))throw new Error('Direct Method/Property name conflict');
    }
    if(blocks.length!==1)throw new Error('Ambiguous or missing declaration block');
    const b=blocks[0];
    if(parsed.rows.some((r:any)=>r.category==='variable'&&r.section===section&&(r.modifiers?.length||r.addressRaw)))throw new Error('Special declarations in target block');
    const indent=/\n([ \t]+)[A-Za-z_]/.exec(source.slice(b.body,b.end))?.[1]??'    ';
    const insert=`${indent}${edit.name} : ${edit.type} := ${value};\n`;
    const at=source.lastIndexOf('\n',b.end-1)+1;
    if(!/^[ \t]*$/.test(source.slice(at,b.end)))throw new Error('Closing declaration boundary is not on its own line');
    return {declaration:source.slice(0,at)+insert+source.slice(at),range:{startOffset:at,endOffset:at},before:'',after:insert};
  }
  if(hits.length!==1)throw new Error('Target variable not unique');
  if(edit.section&&parsed.rows.some((r:any)=>r.category==='variable'&&r.section!==section&&r.name.toLowerCase()===edit.name.toLowerCase()))
    throw new Error('Variable name ambiguous across FB sections');
  const row=hits[0];
  if(['set-type','add-initializer'].includes(edit.action)&&parsed.rows.some((r:any)=>r!==row&&r.category!=='comment'&&
      r.name?.toLowerCase()===edit.name.toLowerCase()))
    throw new Error('Variable name ambiguous across declaration scopes or function return');
  if(edit.action==='add-initializer'){
    if(edit.type!==undefined||edit.expectedOldType!==undefined||edit.expectedOldInitializer!==undefined||
      blocks.length!==1||blocks[0].unsupportedHeader)
      throw new Error('Add initializer requires one ordinary supported declaration block and no type/old value');
    if(row.modifiers?.length||row.addressRaw||row.hasExplicitInitializer!==false||
      row.initializerRaw!==null||row.initializerPosition!==null)
      throw new Error('Explicit initializer already exists or declaration is special/uncertain');
    if(parsed.rows.filter((r:any)=>r.category==='variable'&&r.position.startOffset===row.position.startOffset).length!==1)
      throw new Error('Shared declaration');
    const parts=tokens.tokens.filter(t=>t.start>=row.position.startOffset&&t.end<=row.position.endOffset);
    if(parts.length!==4||parts[0].text!==row.name||parts[1].text!==':'||parts[2].text!==row.typeRaw||
      parts[3].text!==';'||parts[3].end!==row.position.endOffset||!['BOOL','DINT','TIME'].includes(row.typeRaw.toUpperCase())||
      row.position.startOffset<blocks[0].body||row.position.endOffset>blocks[0].end)
      throw new Error('No complete ordinary uninitialized scalar declaration');
    const value=checkedInitializer(row.typeRaw.toUpperCase() as VariableType,edit.initializer);
    const at=parts[3].start,insertion=' := '+value;
    return {declaration:source.slice(0,at)+insertion+source.slice(at),range:{startOffset:at,endOffset:at},before:'',after:insertion};
  }
  if(row.modifiers?.length||row.addressRaw||!row.hasExplicitInitializer||!row.initializerPosition)throw new Error('Unsupported existing declaration');
  if(parsed.rows.filter((r:any)=>r.category==='variable'&&r.position.startOffset===row.position.startOffset).length!==1)throw new Error('Shared declaration');
  if(!['BOOL','DINT','TIME'].includes(row.typeRaw.toUpperCase())||row.typeRaw!==row.typeRaw.trim())throw new Error('Unsupported variable type');
  const old=source.slice(row.initializerPosition.startOffset,row.initializerPosition.endOffset);
  checkedInitializer(row.typeRaw.toUpperCase() as VariableType,old);
  if(edit.expectedOldInitializer!==undefined&&old!==edit.expectedOldInitializer)throw new Error('Old initializer mismatch');
  if(edit.action==='set-type'){
    if(row.typeRaw.toUpperCase()!==edit.expectedOldType)throw new Error('Old variable type mismatch');
    if(old!==edit.expectedOldInitializer)throw new Error('Old initializer mismatch');
    const typeStart=row.typePosition.startOffset,typeEnd=row.typePosition.endOffset;
    const start=row.initializerPosition.startOffset,end=row.initializerPosition.endOffset;
    if(typeStart<row.position.startOffset||typeEnd>=start||end>row.position.endOffset)
      throw new Error('Type and initializer positions overlap or escape the declaration');
    const value=checkedInitializer(edit.type!,edit.initializer);
    const targetTypeText=row.typeRaw.toUpperCase()===edit.type?row.typeRaw:edit.type;
    return {declaration:source.slice(0,typeStart)+targetTypeText+source.slice(typeEnd,start)+value+source.slice(end),
      range:{startOffset:start,endOffset:end},typeRange:{startOffset:typeStart,endOffset:typeEnd},
      before:old,after:value,beforeType:row.typeRaw,afterType:targetTypeText};
  }
  const value=checkedInitializer(row.typeRaw.toUpperCase() as VariableType,edit.initializer);
  const start=row.initializerPosition.startOffset,end=row.initializerPosition.endOffset;
  return {declaration:source.slice(0,start)+value+source.slice(end),range:{startOffset:start,endOffset:end},before:old,after:value};
}

// A member-table row is a locator, never a type assertion or a write offset.
// Resolve the actual root DUT field and the current aggregate again from the
// untouched LF source. Comments surrounding the single literal stay in place.
export function planMemberInitializerEdit(declaration:string,typeDeclaration:string,objectName:string,typeName:string,edit:MemberInitializerEdit){
  const source=normalize(declaration),typeSource=normalize(typeDeclaration);
  checkVariableName(edit.name);checkVariableName(edit.memberName);
  if(!ident.test(typeName))throw new Error('Qualified or uncertain structure type');
  const parsed=parseDeclaration(source,'gvl',objectName);
  if(!parsed.complete||parsed.rows.some((r:any)=>r.category==='parse-gap'))throw new Error('Parent declaration boundary incomplete');
  const parents=parsed.rows.filter((r:any)=>r.category==='variable'&&r.section==='VAR_GLOBAL'&&r.name.toLowerCase()===edit.name.toLowerCase());
  if(parents.length!==1)throw new Error('Parent variable not unique');
  const parent=parents[0];
  if(parent.modifiers?.length||parent.addressRaw||!parent.hasExplicitInitializer||!parent.initializerPosition||
     parsed.rows.filter((r:any)=>r.category==='variable'&&r.position.startOffset===parent.position.startOffset).length!==1)
    throw new Error('Unsupported shared or special parent declaration');
  if(parent.typeRaw.toLowerCase()!==typeName.toLowerCase()||!ident.test(parent.typeRaw))
    throw new Error('Parent type does not uniquely name the local structure');
  const fields=parseDeclaration(typeSource,'structure',typeName);
  if(!fields.complete||fields.rows.some((r:any)=>r.category==='parse-gap'))throw new Error('Structure declaration boundary incomplete');
  const matches=fields.rows.filter((r:any)=>r.category==='type-field'&&r.name.toLowerCase()===edit.memberName.toLowerCase());
  if(matches.length!==1)throw new Error('Structure member missing or ambiguous');
  const field=matches[0];
  if(field.modifiers?.length||field.addressRaw||fields.rows.filter((r:any)=>r.category==='type-field'&&r.position.startOffset===field.position.startOffset).length!==1||
     !['BOOL','DINT','TIME'].includes(field.typeRaw.toUpperCase()))throw new Error('Unsupported structure field declaration or type');
  const members=parseInitializerMembers(source,parent.initializerPosition.startOffset,parent.initializerPosition.endOffset,2000);
  if(members.status!=='parsed'||!members.complete||members.gaps.length)throw new Error('Named aggregate initializer boundary incomplete or unsupported');
  if(edit.action==='add-member-initializer'){
    // New action only: no implicit declaration/block/member creation or repair.
    const scan=lexSt(source),tokens=scan.tokens;
    if(scan.error||tokens[0]?.text.toUpperCase()!=='VAR_GLOBAL'||tokens.at(-1)?.text.toUpperCase()!=='END_VAR'||
      tokens.filter(t=>t.text.toUpperCase()==='VAR_GLOBAL').length!==1||
      tokens.filter(t=>t.text.toUpperCase()==='END_VAR').length!==1||
      parsed.rows.some((r:any)=>r.category==='variable'&&(r.section!=='VAR_GLOBAL'||r.modifiers?.length||r.addressRaw)))
      throw new Error('Add member requires a unique ordinary VAR_GLOBAL block');
    const declarations=fields.rows.filter((r:any)=>r.category==='type-field');
    if(new Set(declarations.map((r:any)=>r.name.toLowerCase())).size!==declarations.length)
      throw new Error('Duplicate structure field identity');
    for(const member of members.rows){
      const matches=declarations.filter((r:any)=>r.name.toLowerCase()===member.name.toLowerCase());
      const value=lexSt(member.valueRaw);
      if(matches.length!==1||value.error||value.tokens.some(t=>['(',')','[',']','{','}'].includes(t.text))||
        /^(ARRAY|POINTER|REFERENCE)\b/i.test(matches[0].typeRaw))
        throw new Error('Existing member has unknown, nested or array coverage');
    }
    if(members.rows.some((r:any)=>r.name.toLowerCase()===edit.memberName.toLowerCase()))
      throw new Error('Explicit member already exists; add never overwrites');
    if(edit.expectedOldInitializer!==undefined)throw new Error('Add member does not accept an old member value');
    const value=checkedInitializer(field.typeRaw.toUpperCase() as VariableType,edit.initializer);
    const init=lexSt(source.slice(parent.initializerPosition.startOffset,parent.initializerPosition.endOffset));
    const close=init.tokens.at(-1)!;
    if(init.error||close.text!==')'||!members.rows.length)throw new Error('Complete nonempty aggregate required');
    const at=parent.initializerPosition.startOffset+close.start;
    // One insertion immediately before the real outer close; comments and
    // whitespace (including a final line comment's newline) remain untouched.
    const insertion=', '+field.name+' := '+value;
    return {declaration:source.slice(0,at)+insertion+source.slice(at),range:{startOffset:at,endOffset:at},
      before:'',after:insertion,parentName:parent.name,memberName:field.name,
      fieldType:field.typeRaw.toUpperCase() as VariableType,typeName};
  }
  const hits=members.rows.filter((r:any)=>r.name.toLowerCase()===edit.memberName.toLowerCase());
  if(hits.length!==1)throw new Error('Explicit member initializer missing or ambiguous');
  const member=hits[0],raw=member.valueRaw as string,scan=lexSt(raw);
  if(scan.error||!scan.tokens.length)throw new Error('Member literal boundary incomplete');
  const start=member.valuePosition.startOffset+scan.tokens[0].start;
  const end=member.valuePosition.startOffset+scan.tokens.at(-1)!.end;
  const old=source.slice(start,end);
  checkedInitializer(field.typeRaw.toUpperCase() as VariableType,old);
  if(old!==edit.expectedOldInitializer)throw new Error('Old member initializer mismatch');
  const value=checkedInitializer(field.typeRaw.toUpperCase() as VariableType,edit.initializer);
  return {declaration:source.slice(0,start)+value+source.slice(end),range:{startOffset:start,endOffset:end},before:old,after:value,
    parentName:parent.name,memberName:member.name,fieldType:field.typeRaw.toUpperCase() as VariableType,typeName};
}

// Native text adapter mirror for fixture testing; offsets remain LF UTF-16.
// This is an insertion view, not a change to the public source-read contract.
export function applyMemberInitializerInsertion(raw:string,declaration:string,guard:any,delimiter=')'){
  if(!guard||!Number.isSafeInteger(guard.startOffset)||guard.startOffset<0||guard.endOffset!==guard.startOffset||
    typeof guard.text!=='string'||!guard.text||/[\r\n]/.test(guard.text))throw new Error('Invalid member insertion guard');
  const source=normalize(raw),at=guard.startOffset;
  if(source[at]!==delimiter||source.slice(0,at)+guard.text+source.slice(at)!==normalize(declaration))
    throw new Error('Member insertion source mismatch');
  let index=0,consumed=0;
  while(consumed<at){index+=raw.slice(index,index+2)==='\r\n'?2:1;consumed++;}
  if(normalize(raw.slice(0,index))!==source.slice(0,at))throw new Error('Raw member insertion boundary mismatch');
  return raw.slice(0,index)+guard.text+raw.slice(index);
}

// Native object identity and ST implementation evidence, separate from source syntax.
export function initializerTargetEvidence(before:any,appPath:string[],section?:VariableSection){
  const e=before?.initializerTargetEvidence;
  if(!e||e.source!=='native-object-application-and-embedded-types'||!Array.isArray(appPath)||
    e.objectId!==before.objectId||e.applicationId!==before.applicationId||
    JSON.stringify(e.path)!==JSON.stringify(before.path)||e.nativeTypeId!==before.nativeTypeId||
    typeof e.parentId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(e.parentId)||
    JSON.stringify(before.path?.slice(0,appPath.length))!==JSON.stringify(appPath))
    throw new Error('Native initializer target identity unavailable');
  if(before.objectType==='gvl'){
    if(e.nativeTypeId!=='ffbfa93a-b94d-45fc-a329-229860183b1d'||e.parentId!==before.applicationId||
      before.hasImplementation!==false||before.implementation!==''||before.path.length!==appPath.length+1||
      e.pouType!==null||e.embeddedObjectTypes!==null)throw new Error('Not a native Application root GVL');
  }else if(!['st_pou','function_block'].includes(before.objectType)||e.nativeTypeId!=='6f9dac99-8de1-4efc-8465-68ac443b7d08'||
    before.hasImplementation!==true||!['program','function','function_block'].includes(before.pouType)||
    before.pouTypeSource!=='native-pou-type-id-and-declaration-header'||e.pouType!==before.pouType||
    !Array.isArray(e.embeddedObjectTypes)||!e.embeddedObjectTypes.every((x:any)=>typeof x==='string')||
    !e.embeddedObjectTypes.includes('3b83b776-fb25-43b8-99f2-3c507c9143fc'))
    throw new Error('Ordinary native ST POU implementation not confirmed');
  if(section){
    if(before.objectType!=='function_block'||before.pouType!=='function_block')throw new Error('Interface initializer requires native ST FUNCTION_BLOCK');
    validateInitializerChildren(e.interfaceChildren,before);
  }
  return e;
}

// Only the explicit FB interface insertion requests this complete native subtree.
// Child object order is not execution order; source and parent identity stay exact.
export function validateInitializerChildren(e:any,owner:any){
  const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, hash=/^[0-9a-f]{64}$/;
  if(e?.source!=='native-fb-subtree-raw-source'||e.complete!==true||!Array.isArray(e.rows)||e.rows.length>1000)
    throw new Error('Incomplete FB child preservation evidence');
  const ids=new Set<string>(),byId=new Map<string,any>([[owner.objectId,owner]]);
  for(const r of e.rows){
    if(typeof r.objectId!=='string'||!uuid.test(r.objectId)||ids.has(r.objectId.toLowerCase())||r.objectId.toLowerCase()===owner.objectId.toLowerCase()||
      r.applicationId!==owner.applicationId||typeof r.parentId!=='string'||!uuid.test(r.parentId)||
      !['method','property','property_get','property_set'].includes(r.objectType)||typeof r.nativeTypeId!=='string'||!uuid.test(r.nativeTypeId)||
      !Array.isArray(r.path)||!r.path.every((x:any)=>typeof x==='string'&&x.length>0)||
      JSON.stringify(r.path.slice(0,owner.path.length))!==JSON.stringify(owner.path)||r.path.length<=owner.path.length||
      typeof r.declaration!=='string'||typeof r.implementation!=='string'||typeof r.hasImplementation!=='boolean'||
      !hash.test(r.declarationRawHash)||!hash.test(r.implementationRawHash)||
      !Array.isArray(r.embeddedObjectTypes)||!r.embeddedObjectTypes.every((x:any)=>typeof x==='string'&&uuid.test(x)))
      throw new Error('Invalid or duplicate FB child identity/source');
    ids.add(r.objectId.toLowerCase());byId.set(r.objectId,r);
  }
  for(const r of e.rows){const p=byId.get(r.parentId);
    if(!p||JSON.stringify(r.path.slice(0,-1))!==JSON.stringify(p.path))throw new Error('FB child parent coverage missing');
    if(r.contentHash!==codeHash(r.declaration,r.implementation))throw new Error('FB child source hash mismatch');
    const children=e.rows.filter((x:any)=>x.parentId===r.objectId);
    if(r.objectType==='method'){
      if(r.parentId!==owner.objectId||r.nativeTypeId!=='f8a58466-d7f6-439f-bbb8-d4600e41d099'||
        r.methodMetadataSource!=='native-method-type-parent-and-declaration-header'||r.hasImplementation!==true||
        !r.embeddedObjectTypes.includes('3b83b776-fb25-43b8-99f2-3c507c9143fc')||children.length||
        canonical(r.parentPath)!==canonical(owner.path)||!methodDeclarationMatches(r.path.at(-1),r.declaration,r.methodReturnType,r.access))
        throw new Error('Unsupported native Method subtree');
    }else{
      if(!propertyEvidence(r)||r.fbId!==owner.objectId)throw new Error('Unsupported Property metadata');
      if(r.objectType==='property'){
        if(r.parentId!==owner.objectId||canonical(children.map((x:any)=>x.objectId).sort())!==canonical(r.accessorStructure.accessors.map((x:any)=>x.objectId).sort()))
          throw new Error('Property accessor coverage mismatch');
      }else if(p.objectType!=='property'||r.propertyId!==p.objectId||children.length||
        canonical(r.accessorStructure)!==canonical(p.accessorStructure)||r.propertyContentHash!==p.contentHash)
        throw new Error('Accessor parent or source metadata mismatch');
    }
  }
}
