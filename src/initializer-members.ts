// Syntactic ranges in an explicit initializer, not type resolution or evaluation.
// Read-only: deliberately independent of declaration/write validation and factories.
import {lexSt,type Token} from './st-lex.js';
export const INITIALIZER_MEMBER_PARSER_VERSION='named-initializer-members-v1';
const position=(s:string,startOffset:number,endOffset:number)=>{
 const p=(i:number)=>{const prefix=s.slice(0,i);return {line:prefix.split('\n').length,column:i-prefix.lastIndexOf('\n')};};
 const b=p(startOffset),e=p(endOffset);return {startOffset,endOffset,...b,endLine:e.line,endColumn:e.column};
};
export function parseInitializerMembers(source:string,start:number,end:number,maxMembers=200){
 const rows:any[]=[],gaps:any[]=[];
 const result=(status:'not-named'|'parsed'|'unsupported',truncated=false)=>({status,complete:gaps.length===0&&!truncated,truncated,rows,gaps});
 const gap=(a:number,b:number,reason:string)=>gaps.push({category:'initializer-member-gap',reason,position:position(source,a,b),source:source.slice(a,b)});
 const raw=source.slice(start,end),scan=lexSt(raw),ts=scan.tokens.map(t=>({...t,start:t.start+start,end:t.end+start}));
 if(scan.error){gap(start+scan.error.start,start+scan.error.end,scan.error.text);return result('unsupported');}
 if(ts[0]?.text!=='(')return result('not-named');
 // Delimit the *whole* outer expression before interpreting comma/assignment.
 const stack:string[]=[],segments:Token[][]=[];let from=1,rootEnd=-1;
 for(let i=0;i<ts.length;i++){
  const t=ts[i],v=t.text;
  if(v==='{'||v==='}'||v===';'){gap(t.start,end,'Unsupported initializer boundary');return result('unsupported');}
  if(v==='('||v==='[')stack.push(v);
  else if(v===')'||v===']'){
   if(stack.pop()!==(v===')'?'(':'[')){gap(t.start,end,'Mismatched initializer delimiter');return result('unsupported');}
   if(!stack.length){rootEnd=i;break;}
  }else if(v===','&&stack.length===1){segments.push(ts.slice(from,i));from=i+1;}
 }
 if(stack.length||rootEnd<0){gap(start,end,'Unclosed outer initializer');return result('unsupported');}
 if(rootEnd!==ts.length-1){
  // e.g. (A+B) * C is an ordinary expression, not an aggregate.
  if(!ts.some(t=>t.text===':='))return result('not-named');
  gap(ts[rootEnd].end,end,'Named aggregate does not cover the full initializer');return result('unsupported');
 }
 segments.push(ts.slice(from,rootEnd));
 const hasOuterAssignment=(part:Token[])=>{let d=0;return part.some(t=>{
  if(t.text==='('||t.text==='['){d++;return false;}
  if(t.text===')'||t.text===']'){d--;return false;}
  return d===0&&t.text===':=';
 });};
 if(segments.length===1&&segments[0].length&&!hasOuterAssignment(segments[0]))return result('not-named');
 const names=new Set<string>();
 for(let i=0;i<segments.length;i++){
  const part=segments[i],next=i+1<segments.length?segments[i+1][0]?.start:ts[rootEnd].start;
  if(!part[0]?.id||part[1]?.text!==':='){
   gap(part[0]?.start??start,next??end,'Expected a single unqualified Name := Expression; positional/mixed/empty lists are unsupported');return result('unsupported');
  }
  const name=part[0],assign=part[1],value=part.slice(2);
  if(!value.length){gap(name.start,assign.end,'Empty named member value');return result('unsupported');}
  if(hasOuterAssignment(value)){
   gap(value[0].start,value.at(-1)!.end,'Uncertain member boundary or missing comma before another assignment');return result('unsupported');
  }
  const key=name.text.toLowerCase();
  if(names.has(key)){gap(name.start,name.end,'Duplicate named initializer member');return result('unsupported');}
  names.add(key);
  if(rows.length>=maxMembers)return result('parsed',true);
  // Keep leading/trailing comments in the value's raw range. Delimiter offsets
  // come from tokens over the untouched source, never stripped/comment text.
  const delimiter=i+1<segments.length?ts.find(t=>t.text===','&&t.start>=value.at(-1)!.end&&t.end<=(segments[i+1][0]?.start??end))!:ts[rootEnd];
  let a=assign.end,b=delimiter.start;while(a<b&&/\s/u.test(source[a]))a++;while(b>a&&/\s/u.test(source[b-1]))b--;
  rows.push({category:'initializer-member',name:name.text,namePosition:position(source,name.start,name.end),
   valueRaw:source.slice(a,b),valuePosition:position(source,a,b),position:position(source,name.start,b),source:source.slice(name.start,b)});
 }
 return result('parsed');
}
