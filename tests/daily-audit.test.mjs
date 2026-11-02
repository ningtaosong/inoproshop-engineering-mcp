import test from 'node:test';
import assert from 'node:assert/strict';
import {codeHash} from '../dist/storage.js';
import {auditExplanation,discoverReadEvidence,classifyDelayChange,auditDelayTrial} from '../scripts/lib/daily-audit.mjs';

function trial(){
 const hash='a'.repeat(64),workingHash='f'.repeat(64),snapshot='b'.repeat(64);
 const caller={objectId:'caller',path:['Device','Application','PLC_PRG'],declaration:'PROGRAM PLC_PRG\nVAR\nDelayAlarm : FB_DelayAlarm;\nDemoPreset : TIME := T#3s;\nCounter : UDINT;\nEND_VAR',
  implementation:'Counter := Counter + 1;\nDelayAlarm(Enable := TRUE, DelayTime := DemoPreset);\nDemoAlarm := DelayAlarm.Alarm;'};
 const block={objectId:'block',path:['Device','Application','FB_DelayAlarm'],declaration:'FUNCTION_BLOCK FB_DelayAlarm\nVAR_INPUT\nDelayTime : TIME := T#3s;\nEND_VAR',implementation:'// original alarm logic'};
 for(const o of [caller,block])o.contentHash=codeHash(o.declaration,o.implementation);
 const session={projectId:'project',applicationId:'app'},target={...session,targetKind:'application'};
 let tick=0;const operations=[];
 const add=(tool,args,data)=>{const n=++tick*3;const op={tool,args:{...target,...args},status:'succeeded',operationId:'op'+tick,startedAt:String(n).padStart(4,'0'),finishedAt:String(n+1).padStart(4,'0'),response:{data}};operations.push(op);return op;};
 add('project_open_copy',{sourcePath:'input.project'},{});
 const list=add('object_list',{}, {complete:true,total:2,objects:[caller,block].map(o=>({objectId:o.objectId,path:o.path}))});
 add('object_read',{objectId:caller.objectId},{...caller,diskHash:hash});add('object_read',{objectId:block.objectId},{...block,diskHash:hash});
 const initial=operations.map(o=>structuredClone(o));const baseline=discoverReadEvidence(initial);
 const after={...caller,declaration:caller.declaration.replace('T#3s','T#5s')};after.contentHash=codeHash(after.declaration,after.implementation);
 add('object_read',{objectId:caller.objectId},{...caller,diskHash:hash});
 const write=add('code_apply_change',{objectId:caller.objectId,expectedHash:caller.contentHash,declaration:after.declaration,implementation:after.implementation},
  {...after,snapshot,reopened:true,persistedToWorkingCopy:true});
 const build={completed:true,diagnosticsComplete:true,buildPassed:true,diagnostics:[{severity:'warning',text:'CmpLog'}],snapshot,diskHash:workingHash};
 add('project_build',{},structuredClone(build));
 add('project_save',{}, {saved:true,reopened:true,buildApplicable:false,snapshot});
 const finalBuild=add('project_build',{},structuredClone(build));session.lastBuild={operationId:finalBuild.operationId,...build};
 const finalCaller=add('object_read',{objectId:caller.objectId},{...after,diskHash:workingHash});
 const finalBlock=add('object_read',{objectId:block.objectId},{...block,diskHash:workingHash});
 return {caller,block,initial,list,baseline,operations,sourceHash:hash,expectedSourceHash:hash,workingHash,session,write,finalCaller,finalBlock};
}
test('只读解释证据不冒充文字解释正确；名称由 Agent 已产生的完整列表验证',()=>{
 const t=trial();const r=auditExplanation({operations:t.initial,sourceHash:t.sourceHash,workingHash:t.sourceHash,expectedSourceHash:t.sourceHash});
 assert.equal(r.status,'evidence_passed');assert.equal(r.discoveredFromAgentList,true);assert.equal(r.answerVerified,false);
 const early=structuredClone(t.initial);early[1].finishedAt='9999';assert.throws(()=>discoverReadEvidence(early),/READ_BEFORE_NAME_DISCOVERY/);
});
test('解释请求中的业务写入、编译或磁盘变化均不能当作只读通过',()=>{
 const t=trial();for(const tool of ['code_apply_change','pou_create','project_build','project_save']){
  const r=auditExplanation({operations:[...t.initial,{tool,status:'succeeded',startedAt:'9999'}],sourceHash:t.sourceHash,workingHash:t.sourceHash,expectedSourceHash:t.sourceHash});
  assert.equal(r.code,'EXPLANATION_HAS_ENGINEERING_ACTION');
 }
 assert.equal(auditExplanation({operations:t.initial,sourceHash:t.sourceHash,workingHash:'changed',expectedSourceHash:t.sourceHash}).code,'READ_ONLY_BYTES_CHANGED');
});
test('同名候选不能静默选第一个，事后审计拒绝未消除的歧义',()=>{
 const t=trial(),ops=structuredClone(t.initial);ops[1].response.data.objects.push({objectId:'other',path:['Other','PLC_PRG']});
 assert.throws(()=>discoverReadEvidence(ops),/AMBIGUOUS_OR_MISSING_PLC_PRG/);
});
test('单实例 5 秒允许专用设定或仅改调用，拒绝影响共享设定和其他逻辑',()=>{
 const t=trial();assert.equal(classifyDelayChange(t.caller,t.finalCaller.response.data).mode,'dedicated-preset');
 const literal={...t.caller,implementation:t.caller.implementation.replace('DelayTime := DemoPreset','DelayTime := T#5s')};
 assert.equal(classifyDelayChange(t.caller,literal).mode,'instance-call-only');
 const shared={...t.caller,implementation:t.caller.implementation+'\nOtherAlarm(DelayTime := DemoPreset);'};
 assert.throws(()=>classifyDelayChange(shared,{...shared,declaration:shared.declaration.replace('T#3s','T#5s')}),/SHARED_PRESET/);
 assert.equal(classifyDelayChange(shared,{...shared,implementation:shared.implementation.replace('DelayTime := DemoPreset','DelayTime := T#5s')}).mode,'instance-call-only');
 assert.throws(()=>classifyDelayChange(t.caller,{...t.finalCaller.response.data,implementation:t.caller.implementation.replace('Counter + 1','Counter + 2')}),/UNRELATED_LOGIC/);
});
test('5 秒修改须保留块默认值、只写调用者并绑定编译/保存/最终全文证据',()=>{
 const t=trial();assert.equal(auditDelayTrial(t).status,'passed');
 const bad=trial();bad.finalBlock.response.data.declaration=bad.block.declaration.replace('T#3s','T#5s');
 bad.finalBlock.response.data.contentHash=codeHash(bad.finalBlock.response.data.declaration,bad.block.implementation);
 assert.equal(auditDelayTrial(bad).code,'BLOCK_DEFAULT_OR_UNRELATED_OBJECT_CHANGED');
 const wrong=trial();wrong.write.args.objectId='block';assert.equal(auditDelayTrial(wrong).code,'WRONG_CALLER_WRITTEN');
 const disk=trial();disk.workingHash='0'.repeat(64);assert.equal(auditDelayTrial(disk).code,'FINAL_COMPILED_DISK');
});
test('未完成全文核对、unknown 或冲突不能误记为日常修改成功',()=>{
 const t=trial();t.operations=t.operations.filter(o=>o!==t.finalBlock);assert.equal(auditDelayTrial(t).status,'in_progress');
 for(const status of ['unknown','conflict']){const u=trial();u.write.status=status;u.write.response.error={code:status==='unknown'?'IDE_TIMEOUT':'HASH_CONFLICT'};assert.equal(auditDelayTrial(u).status,'blocked');}
});
