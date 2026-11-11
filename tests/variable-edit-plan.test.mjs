import test from 'node:test';
import assert from 'node:assert/strict';
import {planVariableEdit as plan,checkedInitializer} from '../dist/variable-edit.js';

test('one value changes while comments, strings and implementation remain untouched',()=>{
  const source='PROGRAM Main\nVAR\n  Label : STRING := \'A := 5;\';\n  (* A := 99; *)\n  A : DINT := 5;\nEND_VAR\n';
  const r=plan(source,'st_pou','Main',{action:'set-initializer',name:'A',initializer:'7',expectedOldInitializer:'5'});
  assert.equal(r.declaration,source.replace('A : DINT := 5;','A : DINT := 7;'));
  assert.equal(source.slice(r.range.startOffset,r.range.endOffset),'5');
});
test('add exactly one variable in the only ordinary block',()=>{
  const source='PROGRAM Main\nVAR\n  A : BOOL := TRUE;\nEND_VAR\n';
  const r=plan(source,'st_pou','Main',{action:'add',name:'B',type:'TIME',initializer:'T#8s'});
  assert.match(r.declaration,/B : TIME := T#8s;\nEND_VAR/);
  assert.equal(r.declaration.replace(r.after,''),source);
});
test('insertion preserves the existing closing-line indentation and refuses a same-line boundary',()=>{
 const source='PROGRAM Main\nVAR\n  A : BOOL := TRUE;\n  END_VAR\n';
 const r=plan(source,'st_pou','Main',{action:'add',name:'B',type:'DINT',initializer:'0'});
 assert.equal(r.declaration,'PROGRAM Main\nVAR\n  A : BOOL := TRUE;\n  B : DINT := 0;\n  END_VAR\n');
 assert.equal(r.declaration.replace(r.after,''),source);
 assert.throws(()=>plan('PROGRAM Main\nVAR END_VAR','st_pou','Main',{action:'add',name:'B',type:'DINT',initializer:'0'}));
});
test('reject unsupported literal, shared declaration and ambiguous blocks',()=>{
  for(const value of ['1; X := 2','MAX(1,2)','2147483648','01'])assert.throws(()=>checkedInitializer('DINT',value));
  assert.throws(()=>plan('PROGRAM Main\nVAR\n A,B : DINT := 1;\nEND_VAR','st_pou','Main',{action:'set-initializer',name:'A',initializer:'2'}));
  assert.throws(()=>plan('PROGRAM Main\nVAR\nEND_VAR\nVAR\nEND_VAR','st_pou','Main',{action:'add',name:'A',type:'BOOL',initializer:'TRUE'}));
});
test('global edit preserves UTF-16 source offsets, comments and CRLF normalization',()=>{
 const source='VAR_GLOBAL\r\n (* 😀 注释 PrimaryDelay := T#9s; *)\r\n PrimaryDelay : TIME := T#5s;\r\nEND_VAR';
 const r=plan(source,'gvl','GVL_AlarmConfig',{action:'set-initializer',name:'PrimaryDelay',initializer:'T#7s'});
 const normalized=source.replace(/\r\n/g,'\n');
 assert.equal(normalized.slice(r.range.startOffset,r.range.endOffset),'T#5s');
 assert.equal(r.declaration,normalized.replace('PrimaryDelay : TIME := T#5s','PrimaryDelay : TIME := T#7s'));
});
test('missing initialization, special declarations, duplicate names and broken lexing stop',()=>{
 const edit={action:'set-initializer',name:'A',initializer:'TRUE'};
 for(const source of [
  'PROGRAM Main\nVAR\n A : BOOL;\nEND_VAR',
  'PROGRAM Main\nVAR RETAIN\n A : BOOL := TRUE;\nEND_VAR',
  'PROGRAM Main\nVAR\n A AT %IX0.0 : BOOL := TRUE;\nEND_VAR',
  'PROGRAM Main\nVAR\n A : BOOL := TRUE;\n a : BOOL := FALSE;\nEND_VAR',
  'PROGRAM Main\nVAR\n (* unclosed\n A : BOOL := TRUE;\nEND_VAR'])
   assert.throws(()=>plan(source,'st_pou','Main',edit));
});
test('function return name and special empty block cannot become a new ordinary local',()=>{
 const e={action:'add',name:'F',type:'DINT',initializer:'0'};
 assert.throws(()=>plan('FUNCTION F : DINT\nVAR\nEND_VAR','st_pou','F',e));
 for(const modifier of ['NON_RETAIN','PERSISTENT']){
  assert.throws(()=>plan(`PROGRAM Main\nVAR ${modifier}\nEND_VAR`,'st_pou','Main',{...e,name:'NewVar'}));
 }
});
