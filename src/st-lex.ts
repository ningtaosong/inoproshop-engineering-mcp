// Ordered read-only lexing over the original text, never preprocessing/deleting it.
// Declaration mode preserves the v2 parser's tokens. Strict identifier mode is
// a bounded lexical vocabulary, not an IEC grammar or symbol resolver.
export type Token={text:string,start:number,end:number,id?:boolean};
export const IDENTIFIER_LEXER_VERSION='st-identifier-v1';
const first=/[\p{L}_]/u,rest=/[\p{L}\p{N}_]/u;
export const singleIdentifier=(s:string)=>/^[\p{L}_][\p{L}\p{N}_]*$/u.test(s);
const numeric=/^(?:2#[01_]+|8#[0-7_]+|16#[0-9a-f_]+|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:e[+-]?[0-9][0-9_]*)?)/i;
const numberTypes=new Set(['BYTE','WORD','DWORD','LWORD','SINT','INT','DINT','LINT','USINT','UINT','UDINT','ULINT','REAL','LREAL']);
const stringTypes=new Set(['STRING','WSTRING','CHAR','WCHAR']);
const timeTypes=new Set(['T','TIME','LTIME']);
const dateTypes=new Set(['D','DATE','LDATE','TOD','TIME_OF_DAY','LTOD','DT','DATE_AND_TIME','LDT']);
export function lexSt(s:string,strictIdentifiers=false){
 const tokens:Token[]=[],comments:Token[]=[];let i=0,error:Token|undefined;
 const fail=(text:string,start:number)=>{error={text,start,end:s.length};};
 while(i<s.length){
  const start=i,c=String.fromCodePoint(s.codePointAt(i)!),p=s.slice(i,i+2);
  if(/\s/u.test(c)){i+=c.length;continue;}
  if(p==='//'){i+=2;while(i<s.length&&!/[\r\n]/.test(s[i]))i++;comments.push({text:s.slice(start,i),start,end:i});continue;}
  if(p==='(*'){
   i+=2;let depth=1;
   while(i<s.length&&depth){const p=s.slice(i,i+2);if(p==='(*'){depth++;i+=2;}else if(p==='*)'){depth--;i+=2;}else i++;}
   if(depth){fail('Unclosed block comment',start);break;}
   comments.push({text:s.slice(start,i),start,end:i});continue;
  }
  if(p==='*)'){fail('Stray block comment terminator',start);break;}
  if(c==="'"||c==='"'){
   i++;let closed=false;
   while(i<s.length){if(s[i]==='$'){i+=2;}else if(s[i]===c){if(s[i+1]===c)i+=2;else{i++;closed=true;break;}}else i++;}
   if(!closed){fail('Unclosed quoted string',start);break;}
  }else if(first.test(c)){
   i+=c.length;while(i<s.length){const c=String.fromCodePoint(s.codePointAt(i)!);if(!rest.test(c))break;i+=c.length;}
   if(strictIdentifiers&&s[i]==='#'){
    const kind=s.slice(start,i).toUpperCase();i++;const body=i,tail=s.slice(i);
    // Prefix + quoted literal is consumed by the same quote state above.
    if(stringTypes.has(kind)&&(s[i]==="'"||s[i]==='"'))continue;
    let literal:string|undefined;
    if(numberTypes.has(kind))literal=/^[+-]?/.exec(tail)![0]+(numeric.exec(tail.replace(/^[+-]/,''))?.[0]??'');
    else if(kind==='BOOL')literal=/^(?:TRUE|FALSE|0|1)/i.exec(tail)?.[0];
    else if(timeTypes.has(kind))literal=/^[+-]?(?:_?[0-9][0-9_]*(?:\.[0-9]+)?(?:ns|us|ms|s|m|h|d))+/i.exec(tail)?.[0];
    else if(dateTypes.has(kind))literal=/^[0-9][0-9_:.-]*/.exec(tail)?.[0];
    if(!literal||/^[+-]$/.test(literal)){fail('Unsupported or uncertain typed literal',start);break;}
    i=body+literal.length;
    if(i<s.length&&(rest.test(String.fromCodePoint(s.codePointAt(i)!))||s[i]==='#')){fail('Uncertain typed literal boundary',start);break;}
    tokens.push({text:s.slice(start,i),start,end:i});continue;
   }
   tokens.push({text:s.slice(start,i),start,end:i,id:true});continue;
  }else if(strictIdentifiers&&/[0-9]/.test(c)){
   const literal=numeric.exec(s.slice(i))![0];i+=literal.length;
   if(i<s.length&&(rest.test(String.fromCodePoint(s.codePointAt(i)!))||s[i]==='#')){fail('Uncertain numeric token boundary',start);break;}
  }else {
   if(strictIdentifiers&&!/^[;:,.()[\]{}#%+*/<>=&^|\-]$/.test(c)){
    // An unsupported adjacent character could have continued the preceding
    // word. Do not publish that word as a complete identifier.
    if(tokens.at(-1)?.id&&tokens.at(-1)!.end===start)tokens.pop();
    fail('Unsupported source character; remaining region not scanned',start);break;
   }
   i+=[':=','..'].includes(p)?2:c.length;
  }
  tokens.push({text:s.slice(start,i),start,end:i});
 }
 return {tokens,comments,error};
}
