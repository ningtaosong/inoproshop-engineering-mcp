import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRepair,stripComments} from '../scripts/lib/repair-audit.mjs';
import {codeHash} from '../dist/storage.js';

function scenario(){
 const applicationId='app',allowedObjectId='plc';
 const clean={objectId:'plc',applicationId,path:['Device','Application','PLC_PRG'],
  declaration:'PROGRAM PLC_PRG\nVAR\nCounter : UDINT;\nDelayAlarm : FB_DelayAlarm;\nDemoPreset : TIME := T#3s;\nDemoAlarm : BOOL;\nEND_VAR',
  implementation:'Counter := Counter + UDINT#1;\nDelayAlarm(DelayTime := DemoPreset);\nDemoAlarm := DelayAlarm.Alarm;'};
 clean.contentHash=codeHash(clean.declaration,clean.implementation);
 const broken={...clean,declaration:clean.declaration.replace('DemoPreset : TIME','DemoPreset : STRING'),implementation:clean.implementation.replace('UDINT#1;','UDINT#1')};
 broken.contentHash=codeHash(broken.declaration,broken.implementation);
 const other={objectId:'fb',applicationId,path:['Device','Application','FB_DelayAlarm'],declaration:'FUNCTION_BLOCK FB_DelayAlarm',implementation:'// untouched'};
 other.contentHash=codeHash(other.declaration,other.implementation);
 const fixture={sourcePath:'C:\\test\\broken.project',sourceHash:'b'.repeat(64),applicationId,allowedObjectId,objects:[broken,other],cleanTarget:clean};
 const session={projectId:'project',applicationId,targetKind:'application',sourcePath:fixture.sourcePath,sourceHash:fixture.sourceHash};
 const target={projectId:session.projectId,applicationId,targetKind:'application'};
 let tick=0;const operations=[];
 const add=(tool,args,data)=>{const t=++tick*3;const op={tool,args:{...target,...args},operationId:'op'+tick,status:'succeeded',startedAt:String(t).padStart(4,'0'),finishedAt:String(t+1).padStart(4,'0'),response:{status:'succeeded',data}};operations.push(op);return op;};
 const finalDiskHash='f'.repeat(64),snapshot='a'.repeat(64);
 add('project_open_copy',{sourcePath:fixture.sourcePath},{});
 add('object_read',{objectId:'plc'},{...broken});add('object_read',{objectId:'fb'},{...other});
 const first=add('project_build',{}, {completed:true,diagnosticsComplete:true,buildPassed:false,diagnostics:[{severity:'error',text:'actual syntax/type diagnostic'}],snapshot:'c'.repeat(64)});
 add('object_read',{objectId:'plc'},{...broken});
 const write=add('code_apply_change',{objectId:'plc',expectedHash:broken.contentHash,declaration:clean.declaration,implementation:clean.implementation},
  {...clean,snapshot,persistedToWorkingCopy:true,reopened:true});
 const success={completed:true,diagnosticsComplete:true,buildPassed:true,diagnostics:[{severity:'warning',text:'CmpLog retained'}],snapshot,diskHash:finalDiskHash};
 add('project_build',{},structuredClone(success));
 const saved=add('project_save',{}, {saved:true,reopened:true,snapshot,buildApplicable:false});
 const lastBuild=add('project_build',{},structuredClone(success));session.lastBuild={operationId:lastBuild.operationId,...success};
 const finalPLC=add('object_read',{objectId:'plc'},{...clean,diskHash:finalDiskHash});
 const finalFB=add('object_read',{objectId:'fb'},{...other,diskHash:finalDiskHash});
 add('object_list',{}, {complete:true,total:2,objects:[{objectId:clean.objectId,path:clean.path},{objectId:other.objectId,path:other.path}]});
 return {operations,session,fixture,finalDiskHash,first,write,saved,lastBuild,finalPLC,finalFB};
}
function alterTarget(s,implementation){
 s.write.args.implementation=implementation;s.write.response.data.implementation=implementation;
 s.write.response.data.contentHash=codeHash(s.write.args.declaration,implementation);
 s.finalPLC.response.data.implementation=implementation;s.finalPLC.response.data.contentHash=s.write.response.data.contentHash;
}

test('修复审计接受真实诊断先失败、一轮修改、编译、保存重开和双对象全文核对链',()=>{
 const s=scenario(),r=auditRepair(s);assert.equal(r.status,'passed');assert.equal(r.rounds.length,1);
 assert.equal(r.behaviorVerified,false);assert.equal(r.checks.unrelatedSTUnchanged,true);
});
test('修复审计拒绝没有首次失败或修改前没有诊断的伪闭环',()=>{
 const s=scenario();s.first.response.data.buildPassed=true;s.first.response.data.diagnostics=[];
 assert.equal(auditRepair(s).code,'FIRST_BUILD_MUST_FAIL');
 const early=scenario();early.write.startedAt='0000';assert.equal(auditRepair(early).code,'MODIFIED_BEFORE_DIAGNOSIS');
});
test('三轮上限与逐轮编译不能通过改编号、连续写入绕过',()=>{
 const s=scenario();for(let i=0;i<3;i++)s.operations.push({...structuredClone(s.write),operationId:'extra'+i});
 assert.equal(auditRepair(s).code,'REPAIR_ROUND_LIMIT');
 const missing=scenario();missing.operations.push({...structuredClone(missing.write),operationId:'second-write',startedAt:'0019',finishedAt:'0020'});
 assert.equal(auditRepair(missing).code,'MISSING_COMPILE_BETWEEN_WRITES');
});
test('只可写白名单；不接受创建替身对象或无关对象改变',()=>{
 const s=scenario();s.write.args.objectId='fb';assert.equal(auditRepair(s).code,'OUT_OF_SCOPE_WRITE');
 const create=scenario();create.operations.push({...structuredClone(create.write),tool:'pou_create'});assert.equal(auditRepair(create).code,'POU_CREATION_FORBIDDEN');
 const changed=scenario();changed.finalFB.response.data.implementation='// changed';changed.finalFB.response.data.contentHash=codeHash(changed.finalFB.response.data.declaration,'// changed');
 assert.equal(auditRepair(changed).code,'UNRELATED_OBJECT_CHANGED');
});
test('不能通过取消调用、恒假掩盖、常量输出或改变默认时间通过验收',()=>{
 for(const implementation of ['Counter := Counter + UDINT#1;','IF FALSE THEN\n'+scenario().fixture.cleanTarget.implementation+'\nEND_IF;',scenario().fixture.cleanTarget.implementation.replace('DemoAlarm := DelayAlarm.Alarm;','DemoAlarm := FALSE;')]){
  const s=scenario();alterTarget(s,implementation);assert.equal(auditRepair(s).code,'REQUIRED_IMPLEMENTATION_CHANGED');
 }
 const preset=scenario();preset.write.args.declaration=preset.write.args.declaration.replace('T#3s','T#1s');
 preset.write.response.data.declaration=preset.write.args.declaration;preset.write.response.data.contentHash=codeHash(preset.write.args.declaration,preset.write.args.implementation);
 preset.finalPLC.response.data.declaration=preset.write.args.declaration;preset.finalPLC.response.data.contentHash=preset.write.response.data.contentHash;
 assert.equal(auditRepair(preset).code,'PRESET_DEFAULT_CHANGED');
});
test('unknown、冲突和诊断不完整准确阻断，不能记为成功',()=>{
 const unknown=scenario();unknown.write.status='unknown';const u=auditRepair(unknown);assert.equal(u.status,'blocked');assert.equal(u.code,'UNKNOWN_NO_REPLAY');assert.ok(u.subsequentEngineeringOperations.length);
 const conflict=scenario();conflict.write.status='conflict';conflict.write.response.error={code:'HASH_CONFLICT'};assert.equal(auditRepair(conflict).code,'HASH_CONFLICT');
 const incomplete=scenario();incomplete.first.response.data.diagnosticsComplete=false;assert.equal(auditRepair(incomplete).code,'BUILD_EVIDENCE_INCOMPLETE');
});
test('保存后的文件与编译/全文证据必须匹配，不完整时保持待验收',()=>{
 const disk=scenario();disk.finalDiskHash='0'.repeat(64);assert.equal(auditRepair(disk).code,'FINAL_COMPILED_DISK');
 const saved=scenario();saved.operations=saved.operations.filter(o=>o!==saved.lastBuild);saved.session.lastBuild={operationId:saved.operations.find(o=>o.tool==='project_build'&&o.response.data.buildPassed).operationId};
 assert.equal(auditRepair(saved).code,'SAVED_FILE_NOT_RECOMPILED');
 const noRead=scenario();noRead.operations=noRead.operations.filter(o=>o!==noRead.finalFB);assert.equal(auditRepair(noRead).status,'in_progress');
});
test('限定夹具的注释处理保留字符串内容并支持嵌套块注释',()=>{
 assert.equal(stripComments("a := '//literal'; (* outer (* nested *) x *) // line\nb := '$'x';"),"a := '//literal';    \nb := '$'x';");
 assert.throws(()=>stripComments('(* unclosed'),/UNCLOSED/);
});
