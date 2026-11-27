import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSavedVersion} from '../scripts/lib/resident-autosave-finish.mjs';
import {residentHash as hash} from '../dist/resident.js';
const policy='resident-confirmed-change-save-v1';
function saved(){
 const current={fileIdentity:'disk:before',diskHash:'a'.repeat(64)},after={fileIdentity:'disk:after',diskHash:'b'.repeat(64)};
 const session={projectId:'project',sessionId:'session',sourceHash:'original-source'};
 const request={fileIdentity:current.fileIdentity,diskHash:current.diskHash,initialDisk:current,operationId:'operation',requestId:'request',savePolicy:policy};
 const result={data:{saved:true,diskHash:after.diskHash,residentVersion:'new-version',saveReceipt:{scheme:policy}}};
 const accepted={scheme:policy,requestHash:hash(request),receiptHash:hash(result.data.saveReceipt),beforeDisk:current,afterDisk:after};
 const committed={operationId:'operation',requestId:'request',...session,diskHash:after.diskHash,residentVersion:'new-version',receiptHash:hash(result.data.saveReceipt),buildApplicable:false};
 return {request,result,accepted,committed,session,current,check:{diskHash:after.diskHash}};
}
test('save chain advances exact file/disk version; next readonly request cannot reuse original disk',()=>{
 const x=saved(),next=advanceSavedVersion(x,hash,policy);assert.deepEqual(next,x.accepted.afterDisk);assert.equal(x.request.diskHash,'a'.repeat(64));
 const read={current:next,request:{...next},result:{data:{saved:false,diskHash:next.diskHash}},check:{diskHash:next.diskHash}};
 assert.equal(advanceSavedVersion(read,hash,policy),next);
 assert.throws(()=>advanceSavedVersion({...read,request:{...x.current}},hash,policy));
});
for(const [name,change] of [
 ['missing accepted',x=>delete x.accepted],['missing commit',x=>delete x.committed],
 ['request hash',x=>x.accepted.requestHash='wrong'],['receipt hash',x=>x.accepted.receiptHash='wrong'],
 ['source identity',x=>x.committed.sourceHash='wrong'],['before file',x=>x.current={...x.current,fileIdentity:'other'}],
 ['before disk',x=>x.current={...x.current,diskHash:'other'}],['after disk',x=>x.accepted.afterDisk.diskHash='other'],
 ['missing file identity',x=>delete x.accepted.afterDisk.fileIdentity],['unknown field',x=>x.committed.extra=true],
 ['service verification',x=>x.check.diskHash='wrong'],['producer',x=>x.request.savePolicy='manual'],
 ['untyped saved flag',x=>x.result.data.saved='true'],['old source rewritten',x=>x.session.sourceHash='new-source']
])test('reject incomplete/different saved-chain evidence: '+name,()=>{const x=saved();change(x);assert.throws(()=>advanceSavedVersion(x,hash,policy));});
