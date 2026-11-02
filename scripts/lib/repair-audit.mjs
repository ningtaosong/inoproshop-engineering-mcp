// 限于本轮已知 AM610 夹具的离线证据检查；不生成补丁，不驱动模型，不是通用 ST 语义分析器。
import {codeHash,normalize} from '../../dist/storage.js';

export function stripComments(source){
 let out='',i=0,depth=0,quote=null;
 while(i<source.length){
  const c=source[i],n=source[i+1];
  if(depth){if(c==='('&&n==='*'){depth++;i+=2;}else if(c==='*'&&n===')'){depth--;i+=2;}else{i++;}continue;}
  if(quote){out+=c;if(c==='$'&&n){out+=n;i+=2;continue;}if(c===quote){if(n===quote){out+=n;i+=2;continue;}quote=null;}i++;continue;}
  if(c==='('&&n==='*'){depth=1;out+=' ';i+=2;continue;}
  if(c==='/'&&n==='/'){while(i<source.length&&!['\n','\r'].includes(source[i]))i++;out+=' ';continue;}
  if(c==="'"||c==='"')quote=c;
  out+=c;i++;
 }
 if(depth||quote)throw new Error('UNCLOSED_COMMENT_OR_STRING');
 return out;
}
const tokens=s=>stripComments(normalize(s)).replace(/\s+/g,'').toLowerCase();
const noPreset=s=>stripComments(s).replace(/\bDemoPreset\s*:\s*[^;]+;/ig,'');
function check(condition,code){if(!condition)throw new Error(code);}
function buildEvidence(op){
 const d=op?.response?.data;
 check(op?.status==='succeeded'&&d?.completed===true&&d.diagnosticsComplete===true&&typeof d.buildPassed==='boolean'&&Array.isArray(d.diagnostics),'BUILD_EVIDENCE_INCOMPLETE');
 check(d.buildPassed===!d.diagnostics.some(m=>['error','fatalerror'].includes(m.severity)),'BUILD_DIAGNOSTICS_INCONSISTENT');
 return d;
}

export function auditRepair({operations,session,fixture,finalDiskHash}){
 const ops=[...operations].sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
 const unresolved=ops.find(o=>o.status==='unknown');
 if(unresolved)return {status:'blocked',code:'UNKNOWN_NO_REPLAY',operationId:unresolved.operationId,
  subsequentEngineeringOperations:ops.filter(o=>o.startedAt>unresolved.finishedAt).map(o=>o.operationId)};
 const rejected=ops.find(o=>['failed','conflict','unsupported'].includes(o.status));
 if(rejected)return {status:'blocked',code:rejected.response?.error?.code || rejected.status,operationId:rejected.operationId};
 if(ops.some(o=>o.status==='running'))return {status:'in_progress',pending:ops.filter(o=>o.status==='running').map(o=>o.operationId)};
 const saved=ops.findLast(o=>o.tool==='project_save');
 if(!saved)return {status:'in_progress',stage:'awaiting_save',operations:ops.length};
 const afterReads=ops.filter(o=>o.tool==='object_read'&&o.startedAt>saved.finishedAt);
 const finalList=ops.findLast(o=>o.tool==='object_list'&&o.startedAt>saved.finishedAt);
 if(!finalList||fixture.objects.some(o=>!afterReads.some(r=>r.args.objectId===o.objectId)))return {status:'in_progress',stage:'awaiting_final_inventory_or_reads'};
 try{
  const writes=ops.filter(o=>o.tool==='code_apply_change');
  check(writes.length>=1&&writes.length<=3,'REPAIR_ROUND_LIMIT');
  check(!ops.some(o=>o.tool==='pou_create'),'POU_CREATION_FORBIDDEN');
  check(session?.sourcePath===fixture.sourcePath&&session.sourceHash===fixture.sourceHash&&session.applicationId===fixture.applicationId&&session.targetKind==='application','SESSION_IDENTITY');
  for(const op of ops.filter(o=>o.tool!=='project_open_copy'))check(op.args.projectId===session.projectId&&op.args.applicationId===fixture.applicationId&&op.args.targetKind==='application','TARGET_IDENTITY');
  for(const op of writes)check(op.args.objectId===fixture.allowedObjectId,'OUT_OF_SCOPE_WRITE');
  const builds=ops.filter(o=>o.tool==='project_build');
  const initial=buildEvidence(builds[0]);
  check(initial.buildPassed===false,'FIRST_BUILD_MUST_FAIL');
  check(builds[0].finishedAt<writes[0].startedAt,'MODIFIED_BEFORE_DIAGNOSIS');
  const beforeReads=ops.filter(o=>o.tool==='object_read'&&o.startedAt<writes[0].startedAt);
  for(const expected of fixture.objects){
   const observed=beforeReads.find(o=>o.args.objectId===expected.objectId)?.response?.data;
   check(observed&&observed.contentHash===expected.contentHash&&JSON.stringify(observed.path)===JSON.stringify(expected.path),'INITIAL_OBJECT_BASELINE');
  }
  const rounds=[];
  for(const [i,write] of writes.entries()){
   const read=ops.findLast(o=>o.tool==='object_read'&&o.args.objectId===fixture.allowedObjectId&&o.finishedAt<write.startedAt);
   check(read?.response.data.contentHash===write.args.expectedHash,'ROUND_CURRENT_HASH_NOT_READ');
   const d=write.response.data;
   check(d?.contentHash===codeHash(write.args.declaration,write.args.implementation)&&d.reopened===true&&d.persistedToWorkingCopy===true,'WRITE_READBACK');
   const next=writes[i+1]?.startedAt || saved.startedAt;
   const compiled=builds.find(o=>o.startedAt>write.finishedAt&&o.finishedAt<next);
   check(compiled,'MISSING_COMPILE_BETWEEN_WRITES');
   const b=buildEvidence(compiled);check(b.snapshot===d.snapshot,'ROUND_SNAPSHOT');
   if(i<writes.length-1)check(b.buildPassed===false,'WRITE_AFTER_BUILD_PASSED');
   rounds.push({round:i+1,readOperationId:read.operationId,writeOperationId:write.operationId,buildOperationId:compiled.operationId,
    expectedHash:write.args.expectedHash,resultHash:d.contentHash,buildPassed:b.buildPassed,diagnostics:b.diagnostics});
  }
  check(rounds.at(-1).buildPassed===true,'LAST_REPAIR_BUILD_FAILED');
  const finalBuild=builds.at(-1);const final=buildEvidence(finalBuild);
  check(final.buildPassed===true&&final.diskHash===finalDiskHash,'FINAL_COMPILED_DISK');
  check(saved.response.data?.saved===true&&saved.response.data.reopened===true&&saved.response.data.snapshot===final.snapshot,'SAVE_REOPEN');
  if(saved.response.data.buildApplicable===false)check(finalBuild.startedAt>saved.finishedAt,'SAVED_FILE_NOT_RECOMPILED');
  check(session.lastBuild?.operationId===finalBuild.operationId,'SESSION_BUILD_EVIDENCE');
  const list=finalList.response.data;
  check(list.complete===true&&list.total===fixture.objects.length&&list.objects.length===fixture.objects.length,'FINAL_INVENTORY_INCOMPLETE');
  const finalObjects=[];
  for(const expected of fixture.objects){
   const item=list.objects.find(o=>o.objectId===expected.objectId);check(item&&JSON.stringify(item.path)===JSON.stringify(expected.path),'OBJECT_SET_CHANGED');
   const read=afterReads.findLast(o=>o.args.objectId===expected.objectId);const d=read.response.data;
   check(d.contentHash===codeHash(d.declaration,d.implementation)&&d.diskHash===finalDiskHash,'FINAL_FULL_READBACK');
   if(expected.objectId===fixture.allowedObjectId){
    check(d.contentHash===writes.at(-1).response.data.contentHash,'TARGET_WRITE_VS_FINAL');
    check(tokens(d.implementation)===tokens(fixture.cleanTarget.implementation),'REQUIRED_IMPLEMENTATION_CHANGED');
    check(tokens(noPreset(d.declaration))===tokens(noPreset(fixture.cleanTarget.declaration)),'UNRELATED_DECLARATIONS_CHANGED');
    const presets=[...stripComments(d.declaration).matchAll(/\bDemoPreset\s*:\s*([^;]+);/ig)];
    check(presets.length===1&&/^(?:T|TIME)#(?:3s|3000ms)$/i.test(presets[0][1].split(':=').at(-1).replace(/\s+/g,'')),'PRESET_DEFAULT_CHANGED');
   }else check(d.contentHash===expected.contentHash&&d.declaration===expected.declaration&&d.implementation===expected.implementation,'UNRELATED_OBJECT_CHANGED');
   finalObjects.push(d);
  }
  return {status:'passed',rounds,firstBuildOperationId:builds[0].operationId,firstDiagnostics:initial.diagnostics,
   finalBuildOperationId:finalBuild.operationId,saveOperationId:saved.operationId,finalSnapshot:final.snapshot,finalDiskHash,
   finalObjects,checks:{firstBuildFailed:true,actualRepair:true,atMostThreeRounds:true,onlyAllowedObjectWritten:true,
    compileAfterEveryRound:true,requiredLogicAndCallPreserved:true,unrelatedSTUnchanged:true,objectSetUnchanged:true,
    savedReopened:true,finalFullReadback:true,finalCompiledDiskMatches:true},
   behaviorVerified:false,taskConfiguration:'requires independent read-only IDE audit'};
 }catch(e){return {status:'failed',code:e.message};}
}
