// 事后审计：输入只能是 Agent 已产生的记录。没有 MCP 调用、模型循环、定位建议或写入能力。
import {codeHash} from '../../dist/storage.js';
import {stripComments} from './repair-audit.mjs';
const canon=s=>s.replace(/\r\n?/g,'\n').replace(/\s+/g,'').toLowerCase();
const ensure=(ok,code)=>{if(!ok)throw new Error(code);};
const order=ops=>[...ops].sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
export function discoverReadEvidence(operations,callerName='PLC_PRG',blockName='FB_DelayAlarm'){
 const ops=order(operations),lists=ops.filter(o=>o.tool==='object_list'&&o.status==='succeeded');
 ensure(lists.some(o=>o.response.data.complete===true),'COMPLETE_DISCOVERY_REQUIRED');
 const listed=[...new Map(lists.flatMap(o=>o.response.data.objects).map(o=>[o.objectId,o])).values()];
 const objects=[];
 for(const name of [callerName,blockName]){
  const matches=listed.filter(o=>o.path.at(-1).toLowerCase()===name.toLowerCase());ensure(matches.length===1,'AMBIGUOUS_OR_MISSING_'+name);
  const candidate=matches[0];
  const read=ops.find(o=>o.tool==='object_read'&&o.args.objectId===candidate.objectId&&o.status==='succeeded');
  ensure(read,'OBJECT_NOT_READ_'+name);
  ensure(lists.some(o=>o.finishedAt<read.startedAt&&o.response.data.objects.some(item=>item.objectId===candidate.objectId)),'READ_BEFORE_NAME_DISCOVERY');
  const d=read.response.data;ensure(d.contentHash===codeHash(d.declaration,d.implementation),'READ_HASH');
  ensure(JSON.stringify(d.path)===JSON.stringify(candidate.path),'READ_PATH');objects.push(d);
 }
 return {caller:objects[0],block:objects[1],objects,discoveredFromAgentList:true};
}
export function auditExplanation({operations,sourceHash,workingHash,expectedSourceHash}){
 try{
  const ops=order(operations);ensure(ops.every(o=>o.status==='succeeded'),'UNFINISHED_OR_REJECTED_OPERATION');
  ensure(ops.every(o=>['project_open_copy','object_list','object_read'].includes(o.tool)),'EXPLANATION_HAS_ENGINEERING_ACTION');
  ensure(sourceHash===expectedSourceHash&&workingHash===expectedSourceHash,'READ_ONLY_BYTES_CHANGED');
  const evidence=discoverReadEvidence(ops);
  return {status:'evidence_passed',...evidence,checks:{sourceUnchanged:true,workingCopyUnchanged:true,noBusinessWrites:true,actualNameDiscovery:true,bothObjectsRead:true},
   answerVerified:false,note:'解释文字和必要追问须取得用户提供的实际答复后逐项核对；不能仅凭读取成功判为通过'};
 }catch(e){return {status:'failed',code:e.message,answerVerified:false};}
}

export function classifyDelayChange(before,after,instanceName='DelayAlarm'){
 const safe=instanceName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const calls=[...stripComments(before.implementation).matchAll(new RegExp('\\b'+safe+'\\s*\\(([^)]*)\\)\\s*;','ig'))];
 ensure(calls.length===1,'INSTANCE_CALL_NOT_UNIQUE');
 const argument=/\bDelayTime\s*:=\s*([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(calls[0][1]);ensure(argument,'FIXTURE_PARAMETER_NOT_SIMPLE');
 const preset=argument[1];
 const declaration=new RegExp('\\b'+preset+'\\s*:\\s*TIME\\s*:=\\s*((?:T|TIME)#(?:3s|3000ms))\\s*;','i').exec(before.declaration);
 ensure(declaration,'INITIAL_PRESET_NOT_3_SECONDS');
 const uses=[...stripComments(before.implementation).matchAll(new RegExp('\\b'+preset+'\\b','ig'))].length;
 const values=['T#5s','TIME#5s','T#5000ms','TIME#5000ms'];
 const rawCalls=[...before.implementation.matchAll(new RegExp('\\b'+safe+'\\s*\\(([^)]*)\\)\\s*;','ig'))];
 ensure(rawCalls.length===1,'RAW_INSTANCE_CALL_NOT_UNIQUE');
 const call=rawCalls[0];
 const expectedImpl=values.map(value=>before.implementation.slice(0,call.index)+
  call[0].replace(new RegExp('(\\bDelayTime\\s*:=\\s*)'+preset+'\\b','i'),(_,prefix)=>prefix+value)+before.implementation.slice(call.index+call[0].length));
 const expectedDecl=values.map(value=>before.declaration.slice(0,declaration.index)+declaration[0].replace(declaration[1],value)+before.declaration.slice(declaration.index+declaration[0].length));
 const declSame=canon(before.declaration)===canon(after.declaration),implSame=canon(before.implementation)===canon(after.implementation);
 const decl5=expectedDecl.some(d=>canon(d)===canon(after.declaration));
 const call5=expectedImpl.some(i=>canon(i)===canon(after.implementation));
 ensure((declSame||decl5)&&(implSame||call5)&&(!declSame||!implSame),'UNRELATED_LOGIC_CHANGED_OR_NO_5_SECOND_CHANGE');
 if(decl5)ensure(uses===1,'SHARED_PRESET_WOULD_AFFECT_OTHERS');
 ensure((decl5&&implSame)||(declSame&&call5)||(decl5&&call5),'INSTANCE_DELAY_NOT_5_SECONDS');
 return {mode:decl5?(call5?'dedicated-preset-and-call':'dedicated-preset'):'instance-call-only',presetName:preset,originalPresetSeconds:3,newInstanceSeconds:5,sharedPresetUses:uses};
}
export function auditDelayTrial({operations,baseline,sourceHash,expectedSourceHash,workingHash,session}){
 const ops=order(operations);
 const halt=ops.find(o=>['unknown','failed','conflict','unsupported'].includes(o.status));
 if(halt)return {status:'blocked',code:halt.response?.error?.code || halt.status,operationId:halt.operationId};
 if(ops.some(o=>o.status==='running'))return {status:'in_progress'};
 const saved=ops.findLast(o=>o.tool==='project_save');if(!saved)return {status:'in_progress',stage:'awaiting_save'};
 const finalReads=ops.filter(o=>o.tool==='object_read'&&o.startedAt>saved.finishedAt);
 if(baseline.objects.some(o=>!finalReads.some(r=>r.args.objectId===o.objectId)))return {status:'in_progress',stage:'awaiting_full_reads'};
 try{
  ensure(sourceHash===expectedSourceHash,'ORIGINAL_SOURCE_CHANGED');
  const writes=ops.filter(o=>o.tool==='code_apply_change');ensure(writes.length===1,'EXPECTED_ONE_MINIMAL_CHANGE');
  ensure(!ops.some(o=>o.tool==='pou_create'),'OBJECT_CREATION_FORBIDDEN');
  const write=writes[0];ensure(write.args.objectId===baseline.caller.objectId,'WRONG_CALLER_WRITTEN');
  const beforeRead=ops.findLast(o=>o.tool==='object_read'&&o.args.objectId===baseline.caller.objectId&&o.finishedAt<write.startedAt);
  ensure(beforeRead?.response.data.contentHash===write.args.expectedHash,'CURRENT_HASH_NOT_READ');
  ensure(write.args.expectedHash===baseline.caller.contentHash,'INITIAL_CALLER_CHANGED');
  const builds=ops.filter(o=>o.tool==='project_build');const finalBuild=builds.at(-1);
  ensure(builds.some(o=>o.startedAt>write.finishedAt&&o.finishedAt<saved.startedAt),'NO_BUILD_BETWEEN_WRITE_AND_SAVE');
  for(const build of builds){const d=build.response.data;ensure(d.completed===true&&d.diagnosticsComplete===true&&d.buildPassed===true,'BUILD_NOT_PASSED');}
  ensure(saved.response.data.saved===true&&saved.response.data.reopened===true,'SAVE_REOPEN');
  ensure(finalBuild.response.data.snapshot===saved.response.data.snapshot&&write.response.data.snapshot===saved.response.data.snapshot,'SAVED_SNAPSHOT');
  if(saved.response.data.buildApplicable===false)ensure(finalBuild.startedAt>saved.finishedAt,'SAVED_VERSION_NOT_RECOMPILED');
  ensure(finalBuild.response.data.diskHash===workingHash&&session.lastBuild?.operationId===finalBuild.operationId,'FINAL_COMPILED_DISK');
  const finalObjects=[];
  for(const old of baseline.objects){
   const read=finalReads.findLast(o=>o.args.objectId===old.objectId),d=read.response.data;
   ensure(d.contentHash===codeHash(d.declaration,d.implementation)&&d.diskHash===workingHash,'FINAL_READ_HASH_OR_DISK');
   ensure(JSON.stringify(d.path)===JSON.stringify(old.path),'OBJECT_PATH_CHANGED');
   if(old.objectId!==baseline.caller.objectId)ensure(d.declaration===old.declaration&&d.implementation===old.implementation&&d.contentHash===old.contentHash,'BLOCK_DEFAULT_OR_UNRELATED_OBJECT_CHANGED');
   finalObjects.push(d);
  }
  const after=finalObjects.find(o=>o.objectId===baseline.caller.objectId);
  ensure(after.contentHash===write.response.data.contentHash&&after.contentHash===codeHash(write.args.declaration,write.args.implementation),'WRITE_VS_FINAL');
  const delta=classifyDelayChange(baseline.caller,after);
  for(const op of ops.filter(o=>o.tool!=='project_open_copy'))ensure(op.args.projectId===session.projectId&&op.args.applicationId===session.applicationId&&op.args.targetKind==='application','TARGET_IDENTITY');
  return {status:'passed',delta,finalObjects,writeOperationId:write.operationId,saveOperationId:saved.operationId,finalBuildOperationId:finalBuild.operationId,
   finalDiskHash:workingHash,finalSnapshot:finalBuild.response.data.snapshot,
   checks:{sourceUnchanged:true,actualNameDiscovery:baseline.discoveredFromAgentList===true,instanceOnlyDelayChanged:true,blockDefaultAndAllOtherSTUnchanged:true,
    currentHashUsed:true,compiledAndSavedReopened:true,finalFullReadback:true},behaviorVerified:false,taskConfiguration:'requires independent IDE audit'};
 }catch(e){return {status:'failed',code:e.message};}
}
