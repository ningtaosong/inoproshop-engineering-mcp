import test from 'node:test';
import assert from 'node:assert/strict';
import {planMemberInitializerEdit as plan} from '../dist/variable-edit.js';

const dut='TYPE ST_AlarmConfig : STRUCT\n  DelayTime : TIME := T#3s;\n  Enabled : BOOL := FALSE;\n  Count : DINT := 0;\nEND_STRUCT\nEND_TYPE';
const gvl='VAR_GLOBAL\n  Config : ST_AlarmConfig := (DelayTime := T#10s);\n  Config2 : ST_AlarmConfig := (DelayTime := T#5s, Enabled := TRUE, Count := 7);\nEND_VAR';
const edit={action:'set-member-initializer',name:'Config2',memberName:'DelayTime',initializer:'T#8s',expectedOldInitializer:'T#5s'};

test('member edit changes only the selected value after matching the local structure field',()=>{
  const r=plan(gvl,dut,'GVL_AlarmConfig','ST_AlarmConfig',edit);
  assert.equal(r.declaration,gvl.replace('Config2 : ST_AlarmConfig := (DelayTime := T#5s','Config2 : ST_AlarmConfig := (DelayTime := T#8s'));
  assert.equal(gvl.slice(r.range.startOffset,r.range.endOffset),'T#5s');
  assert.equal(r.before,'T#5s');assert.equal(r.after,'T#8s');
});

test('member edit preserves comments and UTF-16 offsets around the literal',()=>{
  const source='VAR_GLOBAL\r\n  (* 😀 DelayTime := T#99s *)\r\n  Config2 : ST_AlarmConfig := (DelayTime := (* 注 *) T#5s (* , := *), Enabled := TRUE);\r\nEND_VAR';
  const r=plan(source,dut,'GVL_AlarmConfig','ST_AlarmConfig',edit);
  const lf=source.replace(/\r\n/g,'\n');
  assert.equal(lf.slice(r.range.startOffset,r.range.endOffset),'T#5s');
  assert.equal(r.declaration,lf.replace('(* 注 *) T#5s (* , := *)','(* 注 *) T#8s (* , := *)'));
});

test('member edit rejects missing, duplicate, nested and unsupported aggregate members',()=>{
  for(const source of [
    gvl.replace('DelayTime := T#5s, ','') ,
    gvl.replace('Count := 7','DelayTime := T#6s'),
    gvl.replace('DelayTime := T#5s','DelayTime := MAX(T#5s,T#6s)'),
    gvl.replace('DelayTime := T#5s','DelayTime := (Inner := T#5s)'),
    gvl.replace('DelayTime := T#5s','T#5s'),
    gvl.replace('DelayTime := T#5s','DelayTime := T#5s Missing := 1')
  ])assert.throws(()=>plan(source,dut,'GVL_AlarmConfig','ST_AlarmConfig',edit));
});

test('member edit rejects type mismatch, missing field and unsupported parent declaration',()=>{
  assert.throws(()=>plan(gvl,dut.replace('DelayTime : TIME','DelayTime : BOOL'),'GVL_AlarmConfig','ST_AlarmConfig',edit));
  assert.throws(()=>plan(gvl,dut.replace('DelayTime : TIME := T#3s;',''),'GVL_AlarmConfig','ST_AlarmConfig',edit));
  assert.throws(()=>plan(gvl.replace('Config2 : ST_AlarmConfig','Config2 : Lib.ST_AlarmConfig'),dut,'GVL_AlarmConfig','ST_AlarmConfig',edit));
  assert.throws(()=>plan(gvl.replace('Config2 : ST_AlarmConfig','Config2, Other : ST_AlarmConfig'),dut,'GVL_AlarmConfig','ST_AlarmConfig',edit));
});

test('BOOL, DINT and TIME use the actual field type and bounded literal rules',()=>{
  const enabled=plan(gvl,dut,'GVL_AlarmConfig','ST_AlarmConfig',{
    action:'set-member-initializer',name:'Config2',memberName:'enabled',expectedOldInitializer:'TRUE',initializer:'FALSE'});
  assert.match(enabled.declaration,/Enabled := FALSE, Count := 7/);
  assert.equal(enabled.fieldType,'BOOL');
  const count=plan(gvl,dut,'GVL_AlarmConfig','ST_AlarmConfig',{
    action:'set-member-initializer',name:'Config2',memberName:'Count',expectedOldInitializer:'7',initializer:'-2147483648'});
  assert.match(count.declaration,/Count := -2147483648/);
  assert.equal(count.fieldType,'DINT');
  for(const [memberName,old,value] of [
    ['DelayTime','T#5s','T#61s'],['DelayTime','T#5s','T#5s; Evil := TRUE'],
    ['Enabled','TRUE','8'],['Count','7','2147483648'],['Count','7','ABS(3)']
  ])assert.throws(()=>plan(gvl,dut,'GVL_AlarmConfig','ST_AlarmConfig',{
    action:'set-member-initializer',name:'Config2',memberName,expectedOldInitializer:old,initializer:value}));
});

test('unclosed source, malformed type and wrong old literal never produce a patch',()=>{
  for(const [source,type] of [
    [gvl.replace('END_VAR','(* unclosed'),dut],
    [gvl,dut.replace('END_STRUCT','END_VAR')],
    [gvl.replace('DelayTime := T#5s','DelayTime := T#5s, DelayTime := T#6s'),dut],
    [gvl.replace('Config2 : ST_AlarmConfig','Config2 : ST_AlarmConfig AT %MW0'),dut]
  ])assert.throws(()=>plan(source,type,'GVL_AlarmConfig','ST_AlarmConfig',edit));
  assert.throws(()=>plan(gvl,dut,'GVL_AlarmConfig','ST_AlarmConfig',{...edit,expectedOldInitializer:'T#6s'}));
  assert.throws(()=>plan(gvl,dut,'GVL_AlarmConfig','ST_AlarmConfig',{...edit,memberName:'IF'}));
});
