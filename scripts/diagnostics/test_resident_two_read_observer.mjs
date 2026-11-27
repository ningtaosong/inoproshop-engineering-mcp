import test from 'node:test';
import assert from 'node:assert/strict';
import {request,verifyResponse,sameNativeContext,verifyInstalledFrame,verifyAcceptedResponse,exchangeTwo} from './resident_two_read_observer.mjs';
import fs from 'node:fs';
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
const archived=JSON.parse(fs.readFileSync(new URL('./resident_frame_case_fixture.json',import.meta.url),'utf8'));
test('archived result reproduces old production accept statement rejection',()=>{
 const oldCheck=new Function('state','intent',archived.legacyStatement);
 assert.throws(()=>oldCheck(archived.state,{frameIdentity:archived.expected}),/Installed frame identity differs/);
});
test('archived lowercase actual path passes new production ready and result verifier with installed bytes',()=>verifyInstalledFrame(archived.state,archived.expected));
test('actual archived full ready and result through production accept chain',()=>{
 verifyInstalledFrame(archived.ready.state,archived.expected);
 const actual=verifyAcceptedResponse(archived.response,archived.request,archived.processStart.start,archived.processStart.binding,archived.requestFileSha256,archived.ready.state,null,archived.expected);
 assert.deepEqual(actual,archived.response.state);
});
for(const [name,mutate] of [
 ['handle',r=>r.state.mainHandle='0'],['thread',r=>r.state.thread=99],['request',r=>r.request.requestId='changed'],
 ['pid',r=>r.binding.pid++],['creation',r=>r.binding.startId='changed'],['hash',r=>r.state.frameFileEvidence.actualSha256='0'.repeat(64)],
 ['project',r=>r.state.noProject.openProjectCount=1],['stack',r=>r.state.startupFramesPresent=true]
])test('full production accept rejects altered archived '+name,async()=>{
 const value=structuredClone(archived.response);mutate(value);const sent=[];
 await assert.rejects(exchangeTwo({requestIds:[archived.request.requestId,'second'],launchId:archived.request.launchId,scriptSha256:archived.request.scriptSha256},{
 ensure:async()=>{},send:async req=>sent.push(req.sequence),read:async()=>Buffer.from(JSON.stringify(value)),
 accept:async(req,bytes)=>verifyAcceptedResponse(JSON.parse(bytes),req,archived.processStart.start,archived.processStart.binding,archived.requestFileSha256,archived.ready.state,null,archived.expected)}));
 assert.deepEqual(sent,[1]);
});
for(const [name,mutate] of [
 ['directory',s=>s.frameIdentity.path=s.frameIdentity.path.replace('3.5.11.10','3.5.11.11')],
 ['filename',s=>s.frameIdentity.path=s.frameIdentity.path.replace('frame.plugin.dll','other.plugin.dll')],
 ['mvid',s=>s.frameIdentity.mvid='other'],['type',s=>s.frameIdentity.type='other'],
 ['relative path',s=>s.frameIdentity.path='frame.plugin.dll'],['missing proof',s=>delete s.frameFileEvidence],
 ['wrong raw path',s=>s.frameFileEvidence.actualPath='other'],['wrong expected raw',s=>s.frameFileEvidence.expectedPath='other'],
 ['different full path',s=>s.frameFileEvidence.actualFullPath='D:\\other.dll'],
 ['changed hash',s=>s.frameFileEvidence.actualSha256='b'.repeat(64)],['missing hash',s=>delete s.frameFileEvidence.expectedSha256],
 ['different installed hash',s=>s.frameFileEvidence.installedSha256='b'.repeat(64)],['comparison false',s=>s.frameFileEvidence.pathOrdinalIgnoreCaseEqual=false]
])test('production frame verifier rejects '+name,()=>{const s=structuredClone(archived.state);mutate(s);assert.throws(()=>verifyInstalledFrame(s,archived.expected));});
test('actual installed read failure stops',()=>assert.throws(()=>verifyInstalledFrame(archived.state,archived.expected,()=>{throw Error('file unavailable');}),/file unavailable/));
test('installed bytes changed after native read stops',()=>assert.throws(()=>verifyInstalledFrame(archived.state,archived.expected,()=>Buffer.from('different')),/bytes changed/));
