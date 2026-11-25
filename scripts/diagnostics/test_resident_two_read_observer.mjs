import test from 'node:test';
import assert from 'node:assert/strict';
import {request,verifyResponse,sameNativeContext,exchangeTwo} from './resident_two_read_observer.mjs';
import {sha} from './native_idle_observer.mjs';
const intent={requestIds:['one','two'],launchId:'launch',scriptSha256:'s'.repeat(64)};
const binding={operationId:'op',requestId:'bootstrap',launchId:'launch',requestFingerprint:'fingerprint',scriptSha256:intent.scriptSha256};
const start={pid:123,startId:'created'};
const first=request(intent,1,null);
const state={thread:1,mainHandle:'9',mainEnabled:true,frameIdentity:{path:'frame',mvid:'m',type:'main'},startupFramesPresent:false,
 noProject:{primaryIsNone:true,openProjectCount:0,uiPresent:true},forms:[{type:'main',visible:true,modal:false},{type:'aux',visible:false,modal:false}],stack:[{assembly:'public',type:'thread',method:'callback'}]};
const response=()=>({binding:{...binding,...start},request:{...first},requestSha256:'hash',state:structuredClone(state),status:'read-returned',message:'已只读确认当前无工程；未关闭IDE',engineeringCalls:0,closeCalls:0,exitCalls:0});
test('fixed request identities and prior-result requirement',()=>{
 assert.equal(first.requestId,'one');assert.equal(request(intent,2,'a'.repeat(64)).requestId,'two');
 assert.throws(()=>request({...intent,requestIds:['same','same']},1,null));assert.throws(()=>request(intent,2,null));assert.throws(()=>request(intent,3,null));
});
test('read returned while owned instance lives; no single-form-count requirement',()=>assert.deepEqual(verifyResponse(response(),first,start,binding,'hash'),state));
for(const [name,mutate] of [
 ['wrong pid',r=>r.binding.pid++],['wrong creation',r=>r.binding.startId='other'],['wrong request',r=>r.request.requestId='other'],
 ['request hash',r=>r.requestSha256='other'],['project open',r=>r.state.noProject.primaryIsNone=false],
 ['startup present',r=>r.state.startupFramesPresent=true],['contradictory startup stack',r=>r.state.stack.push({assembly:'Frame.plugin',type:'_3S.CoDeSys.Frame.MainForm',method:'OnLoad'})],
 ['visible modal',r=>r.state.forms.push({visible:true,modal:true})],['main disabled',r=>r.state.mainEnabled=false],
 ['missing stack',r=>r.state.stack=[]],['exit was requested',r=>r.exitCalls=1],['engineering call',r=>r.engineeringCalls=1],
 ['missing message',r=>delete r.message]
])test('reject '+name,()=>{const r=response();mutate(r);assert.throws(()=>verifyResponse(r,first,start,binding,'hash'));});
test('context object key order has no identity meaning',()=>sameNativeContext(state,{...state,frameIdentity:{type:'main',mvid:'m',path:'frame'}}));
for(const key of ['thread','mainHandle','frameIdentity'])test('changed context '+key,()=>assert.throws(()=>sameNativeContext(state,{...state,[key]:null})));
test('second sent only after first accepted; exact preceding bytes bound',async()=>{
 const events=[],bytes=Buffer.from('{"message":"中文一"}');
 await exchangeTwo(intent,{ensure:async()=>events.push('guard'),send:async req=>{events.push('send'+req.sequence);if(req.sequence===2)assert.equal(req.previousResultSha256,sha(bytes));},read:async n=>{events.push('read'+n);return bytes;},accept:async req=>events.push('accept'+req.sequence)});
 assert.deepEqual(events,['guard','send1','read1','accept1','guard','send2','read2','accept2']);
});
for(const failAt of ['ensure','send','read','accept'])test('first failure stops second request at '+failAt,async()=>{
 const sent=[];const io={ensure:async()=>{},send:async req=>sent.push(req.sequence),read:async()=>Buffer.from('{}'),accept:async()=>{}};
 io[failAt]=async()=>{throw Error('first failure');};await assert.rejects(exchangeTwo(intent,io),/first failure/);assert.ok(!sent.includes(2));
});
