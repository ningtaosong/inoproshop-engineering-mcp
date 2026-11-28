import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ResidentAutosaveAcceptanceRounds,validateReply} from '../scripts/lib/resident-autosave-acceptance-rounds.mjs';
const h=n=>String(n).repeat(64),pid=123,launchId=randomUUID(),file='D:\\test.project';
function reply(change=false){
 const data={residentEvidence:{requestCompleted:true,ideExitRequested:false,launchId,requestHash:h(7),sequence:2,processIdentity:{pid,startId:'999'}},projectHandle:0,projectPath:file,diskHash:change?h(2):h(1),residentVersion:h(3),closed:false,reopened:false,closeCalls:0,exitCalls:0,compileCalls:0,saved:change,saveCalls:change?1:0,memoryModified:change};
 if(change)Object.assign(data,{persistedToProject:true,persistedToWorkingCopy:false,saveReceipt:{scheme:'resident-confirmed-change-save-v1',beforeDiskHash:h(1),afterDiskHash:h(2),projectHandle:0,projectPath:file,reopened:false,requestHash:h(7),callHash:h(4),returnedHash:h(5),firstReadHash:h(6),secondReadHash:h(8)}});
 return {status:'succeeded',operationId:randomUUID(),requestId:randomUUID(),data};
}
const previous=()=>({sequence:1,diskHash:h(1),projectHandle:0,projectPath:file,identity:JSON.stringify([launchId,pid,'999'])});
test('acceptance distinguishes an observed save from a readonly result',()=>{
 assert.equal(validateReply(reply(),'object_read',previous()).diskHash,h(1));
 assert.equal(validateReply(reply(true),'code_apply_change',previous()).diskHash,h(2));
});
for(const [label,change] of Object.entries({missingReceipt:r=>delete r.data.saveReceipt,doubleSave:r=>r.data.saveCalls=2,unchangedFile:r=>r.data.diskHash=h(1),wrongRequest:r=>r.data.saveReceipt.requestHash=h(8),closed:r=>r.data.closed=true,compile:r=>r.data.compileCalls=1,newProcess:r=>r.data.residentEvidence.processIdentity.startId='1000',missingReturnedHash:r=>delete r.data.saveReceipt.returnedHash}))test('reject '+label,()=>{const r=reply(true);change(r);assert.throws(()=>validateReply(r,'code_apply_change',previous()));});
test('readonly never silently accepts a new disk',()=>{const r=reply();r.data.diskHash=h(2);assert.throws(()=>validateReply(r,'object_read',previous()));});
test('unknown remains stopped with original result; no continuation command',async()=>{
 const original={status:'unknown',operationId:randomUUID(),requestId:randomUUID(),error:{message:'first native failure'}},logs=[];
 const c=new ResidentAutosaveAcceptanceRounds({call:async()=>original,record:async(e,d)=>logs.push({e,d})});
 const command={id:original.requestId,ticket:c.ticket,kind:'open',authorization:'test authorization',projectPath:file,programName:'PLC_PRG'};
 const result=await c.submit(command);assert.equal(c.state,'frozen');assert.equal(result.originalResult,original);assert.deepEqual(c.control().allowed,['finish']);assert.equal((await c.submit(command)),result);
});
test('already completed ticket cannot authorize another operation',async()=>{
 const c=new ResidentAutosaveAcceptanceRounds({call:async()=>{throw Error('not used');},record:async()=>{}});
 await assert.rejects(c.submit({id:randomUUID(),ticket:'stale',kind:'open',authorization:'test',projectPath:file,programName:'PLC_PRG'}),/Stale/);
});
