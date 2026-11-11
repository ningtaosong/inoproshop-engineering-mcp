// S4a source planning only. The service re-reads native text before planning;
// the bridge checks the same content, project and disk versions before writing.
import {normalize} from './storage.js';
import {lexSt} from './st-lex.js';
import {parseDeclaration} from './variables.js';

export type VariableType='BOOL'|'DINT'|'TIME';
export type VariableEdit={action:'add'|'set-initializer';name:string;type?:VariableType;initializer:string;expectedOldInitializer?:string};
const ident=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const reserved=new Set(['VAR','END_VAR','VAR_GLOBAL','PROGRAM','FUNCTION','FUNCTION_BLOCK','TRUE','FALSE','AT','RETAIN','PERSISTENT','CONSTANT']);

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
  if(!ident.test(edit.name)||reserved.has(edit.name.toUpperCase()))throw new Error('Unsupported variable name');
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
