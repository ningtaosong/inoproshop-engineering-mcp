import {canonical,codeHash,digest,normalize,pathKey} from './storage.js';
import {lexSt} from './st-lex.js';
import {parseDeclaration} from './variables.js';
import {checkVariableName,checkedInitializer,type VariableType} from './variable-edit.js';
import {taskCallInventoryView} from './task-config.js';

export const STRUCT_NATIVE='2db5746d-d284-4425-9f7f-2663a34b0ebc';
const guid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const nativeId=(x:any)=>typeof x==='string'&&guid.test(x)&&x!=='00000000-0000-0000-0000-000000000000';
export function planStructField(declaration:string,name:string,edit:any){
  if(edit.action!=='add-struct-field'||!['BOOL','DINT','TIME'].includes(edit.type)||edit.initializer!==undefined||
    ['section','expectedOldInitializer','expectedOldType','memberName','typeObjectId','expectedTypeHash'].some(k=>edit[k]!==undefined))
    throw new Error('Struct field add requires only name and scalar type; no initializer or other edit');
  checkVariableName(edit.name);
  const source=normalize(declaration),scan=lexSt(source),parsed=parseDeclaration(source,'structure',name);
  const t=scan.tokens,fields=parsed.rows.filter((r:any)=>r.category==='type-field');
  if(scan.error||!parsed.complete||parsed.rows.some((r:any)=>r.category==='parse-gap')||!fields.length||
    t[0]?.text.toUpperCase()!=='TYPE'||t[1]?.text.toLowerCase()!==name.toLowerCase()||t[2]?.text!==':'||
    t[3]?.text.toUpperCase()!=='STRUCT'||t.at(-2)?.text.toUpperCase()!=='END_STRUCT'||t.at(-1)?.text.toUpperCase()!=='END_TYPE')
    throw new Error('Complete ordinary nonempty TYPE STRUCT declaration required');
  const seen=new Set<string>();
  for(const f of fields){
    checkVariableName(f.name);
    if(seen.has(f.name.toLowerCase())||f.modifiers?.length||f.addressRaw||!['BOOL','DINT','TIME'].includes(f.typeRaw.toUpperCase())||
      fields.filter((r:any)=>r.position.startOffset===f.position.startOffset).length!==1)
      throw new Error('Duplicate, shared, special or unsupported existing field');
    seen.add(f.name.toLowerCase());
    const parts=t.filter(x=>x.start>=f.position.startOffset&&x.end<=f.position.endOffset);
    if(parts[0]?.text!==f.name||parts[1]?.text!==':'||parts[2]?.text!==f.typeRaw||parts.at(-1)?.text!==';')
      throw new Error('Uncertain field boundary');
    if(f.hasExplicitInitializer){
      checkedInitializer(f.typeRaw.toUpperCase() as VariableType,f.initializerRaw);
      if(parts[3]?.text!==':='||!f.initializerPosition)throw new Error('Uncertain existing initializer');
    }else if(parts.length!==4||f.initializerRaw!==null)throw new Error('Incomplete scalar field');
  }
  if(seen.has(edit.name.toLowerCase())||edit.name.toLowerCase()===name.toLowerCase())throw new Error('Field name already exists or conflicts with DUT name');
  const close=t.at(-2)!,line=source.lastIndexOf('\n',close.start-1)+1;
  const ownLine=/^[ \t]*$/.test(source.slice(line,close.start));
  const at=ownLine?line:close.start;
  const first=fields[0].position.startOffset,start=source.lastIndexOf('\n',first-1)+1;
  const indent=/^[ \t]*$/.test(source.slice(start,first))?source.slice(start,first):'    ';
  const insertion=ownLine?`${indent}${edit.name} : ${edit.type};\n`:` ${edit.name} : ${edit.type}; `;
  return {declaration:source.slice(0,at)+insertion+source.slice(at),range:{startOffset:at,endOffset:at},before:'',after:insertion};
}

export function applyStructInsertion(raw:string,planned:string,guard:any){
  const source=normalize(raw),at=guard?.startOffset;
  if(!Number.isSafeInteger(at)||at<0||at!==guard.endOffset||at>source.length||typeof guard.text!=='string'||!guard.text||
    source.slice(0,at)+guard.text+source.slice(at)!==planned)throw new Error('Invalid struct insertion evidence');
  let offset=0,index=0;
  while(offset<at){if(raw.slice(index,index+2)==='\r\n')index+=2;else index++;offset++;}
  if(normalize(raw.slice(0,index))!==source.slice(0,at))throw new Error('Raw field insertion boundary changed');
  const endings=raw.slice(0,index).match(/\r\n|\r|\n/g),newline=endings?.at(-1)??'\n';
  const result=raw.slice(0,index)+guard.text.replace(/\n/g,newline)+raw.slice(index);
  if(normalize(result)!==planned)throw new Error('Raw field insertion did not preserve original text');
  return result;
}

export function structStateView(s:any):any{
  if(s?.scheme!=='struct-field-source-tasks-v1'||s.complete!==true||!Array.isArray(s.sources)||!s.sources.length||s.sources.length>5000||
    !s.target||!nativeId(s.target.objectId)||!nativeId(s.target.applicationId)||s.target.parentId!==s.target.applicationId||
    s.target.nativeTypeId!==STRUCT_NATIVE||s.target.kindEvidence!=='native-DUT-id-and-complete-STRUCT-source'||
    !Array.isArray(s.target.path)||s.target.path.length<2||s.target.path.some((x:any)=>typeof x!=='string'||!x))throw new Error('Incomplete native struct identity');
  const byId:Record<string,any>={};
  for(const r of s.sources){
    if(!nativeId(r.objectId)||byId[r.objectId.toLowerCase()]||!Array.isArray(r.path)||!r.path.length||r.path.some((v:any)=>typeof v!=='string'||!v)||
      !nativeId(r.nativeTypeId)||!Array.isArray(r.embeddedObjectTypes)||r.embeddedObjectTypes.some((x:any)=>!nativeId(x))||r.applicationId!==null&&!nativeId(r.applicationId)||
      typeof r.hasDeclaration!=='boolean'||typeof r.hasImplementation!=='boolean'||
      (r.hasDeclaration?typeof r.declaration!=='string':r.declaration!==null)||
      (r.hasImplementation?typeof r.implementation!=='string':r.implementation!==null))throw new Error('Duplicate or incomplete source identity');
    byId[r.objectId.toLowerCase()]=r;
  }
  const target=byId[s.target.objectId.toLowerCase()];
  if(!target||target.applicationId!==s.target.applicationId||target.nativeTypeId!==STRUCT_NATIVE||target.hasDeclaration!==true||
    target.hasImplementation!==false||canonical(target.path)!==canonical(s.target.path))throw new Error('Target outside native source inventory');
  const tasks=taskCallInventoryView(s.tasks);
  if(!tasks||s.tasks.applicationId!==s.target.applicationId)throw new Error('Task preservation coverage incomplete');
  return {...s,sources:byId,tasks};
}
export function structGuard(s:any){return {target:s.target,version:digest(canonical(structStateView(s)))};}
export function structTarget(before:any,appPath:string[],projectId:string,projectPath:string){
  const s=before.structFieldState;structStateView(s);
  if(s.tasks.projectId!==projectId||typeof s.tasks.projectPath!=='string'||pathKey(s.tasks.projectPath)!==pathKey(projectPath)||canonical(s.tasks.applicationPath)!==canonical(appPath)||before.objectType!=='structure'||before.nativeTypeId!==STRUCT_NATIVE||before.hasImplementation!==false||before.implementation!==''||
    before.objectId!==s.target.objectId||before.applicationId!==s.target.applicationId||canonical(before.path)!==canonical(s.target.path)||
    canonical(before.path.slice(0,-1))!==canonical(appPath)||
    codeHash(before.declaration,'')!==before.contentHash)throw new Error('Native root DUT target mismatch');
  return structGuard(s);
}
export function verifyStructReadback(before:any,d:any,plan:any){
  const e=d.structFieldEvidence,raw=d.structFieldInsertionEvidence;
  if(!e||!raw||canonical(structStateView(e.before))!==canonical(structStateView(before.structFieldState)))throw new Error('Missing original struct evidence');
  const expected=structuredClone(e.before),target=expected.sources.find((x:any)=>x.objectId===before.objectId);
  if(!target)throw new Error('Target source missing');
  target.declaration=applyStructInsertion(target.declaration,plan.declaration,{...plan.range,text:plan.after});
  const v=canonical(structStateView(expected));
  if(canonical(structStateView(e.immediate))!==v||canonical(structStateView(e.reopened))!==v)throw new Error('Struct write changed protected identities, source or tasks');
  if(raw.startOffset!==plan.range.startOffset||raw.endOffset!==plan.range.endOffset||raw.text!==plan.after||raw.preservedRawSurroundings!==true||
    raw.beforeRawHash!==digest(e.before.sources.find((x:any)=>x.objectId===before.objectId).declaration)||
    raw.afterRawHash!==digest(target.declaration)||raw.immediateRawHash!==raw.afterRawHash||raw.reopenedRawHash!==raw.afterRawHash)
    throw new Error('Raw insertion preservation evidence invalid');
}
