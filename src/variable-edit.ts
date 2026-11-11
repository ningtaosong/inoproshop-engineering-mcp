// S4a source planning only. The service re-reads native text before planning;
// the bridge checks the same content, project and disk versions before writing.
import {normalize} from './storage.js';
import {lexSt} from './st-lex.js';
import {parseDeclaration} from './variables.js';

export type VariableType='BOOL'|'DINT'|'TIME';
export type VariableEdit={action:'add'|'set-initializer';name:string;type?:VariableType;initializer:string;expectedOldInitializer?:string};
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

export function planVariableEdit(declaration:string,kind:'gvl'|'st_pou'|'function_block',objectName:string,edit:VariableEdit){
  const source=normalize(declaration);
  checkVariableName(edit.name);
  const parsed=parseDeclaration(source,kind,objectName);
  if(!parsed.complete||parsed.rows.some((r:any)=>r.category==='parse-gap'))throw new Error('Declaration boundary incomplete');
  const section=kind==='gvl'?'VAR_GLOBAL':'VAR';
  const rows=parsed.rows.filter((r:any)=>r.category==='variable'&&r.section===section);
  const hits=rows.filter((r:any)=>r.name.toLowerCase()===edit.name.toLowerCase());
  const tokens=lexSt(source);
  if(tokens.error)throw new Error('Lexical boundary incomplete');
  const blocks=[] as {head:number;body:number;end:number}[];
  for(let i=0;i<tokens.tokens.length;i++){
    const t=tokens.tokens[i];if(t.text.toUpperCase()!==section)continue;
    // A modifier or attribute after the block head is outside S4a.
    if(['RETAIN','NON_RETAIN','PERSISTENT','CONSTANT','{'].includes(tokens.tokens[i+1]?.text.toUpperCase()??''))continue;
    const stop=tokens.tokens.find((v,j)=>j>i&&v.text.toUpperCase()==='END_VAR');
    if(stop)blocks.push({head:t.start,body:t.end,end:stop.start});
  }
  if(edit.action==='add'){
    if(!edit.type)throw new Error('Type required');
    const value=checkedInitializer(edit.type,edit.initializer);
    if(parsed.rows.some((r:any)=>r.name?.toLowerCase()===edit.name.toLowerCase()&&r.category!=='comment'))throw new Error('Variable name conflict');
    if(blocks.length!==1)throw new Error('Ambiguous or missing declaration block');
    const b=blocks[0];
    if(parsed.rows.some((r:any)=>r.category==='variable'&&r.section===section&&r.modifiers?.length))throw new Error('Special declarations in target block');
    const indent=/\n([ \t]+)[A-Za-z_]/.exec(source.slice(b.body,b.end))?.[1]??'    ';
    const insert=`${indent}${edit.name} : ${edit.type} := ${value};\n`;
    const at=source.lastIndexOf('\n',b.end-1)+1;
    if(!/^[ \t]*$/.test(source.slice(at,b.end)))throw new Error('Closing declaration boundary is not on its own line');
    return {declaration:source.slice(0,at)+insert+source.slice(at),range:{startOffset:at,endOffset:at},before:'',after:insert};
  }
  if(hits.length!==1)throw new Error('Target variable not unique');
  const row=hits[0];
  if(row.modifiers?.length||row.addressRaw||!row.hasExplicitInitializer||!row.initializerPosition)throw new Error('Unsupported existing declaration');
  if(parsed.rows.filter((r:any)=>r.category==='variable'&&r.position.startOffset===row.position.startOffset).length!==1)throw new Error('Shared declaration');
  if(!['BOOL','DINT','TIME'].includes(row.typeRaw.toUpperCase())||row.typeRaw!==row.typeRaw.trim())throw new Error('Unsupported variable type');
  const old=source.slice(row.initializerPosition.startOffset,row.initializerPosition.endOffset);
  checkedInitializer(row.typeRaw.toUpperCase() as VariableType,old);
  if(edit.expectedOldInitializer!==undefined&&old!==edit.expectedOldInitializer)throw new Error('Old initializer mismatch');
  const value=checkedInitializer(row.typeRaw.toUpperCase() as VariableType,edit.initializer);
  const start=row.initializerPosition.startOffset,end=row.initializerPosition.endOffset;
  return {declaration:source.slice(0,start)+value+source.slice(end),range:{startOffset:start,endOffset:end},before:old,after:value};
}
