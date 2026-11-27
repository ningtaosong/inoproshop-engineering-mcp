import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkNoEngineeringFinish,readBeforeNoEngineeringShutdown} from '../scripts/lib/resident-no-engineering-finish.mjs';
const names=['environment_inspect','session_status','project_list'];
function evidence(){
 const identity=pid=>({version:1,platform:'win32',host:'test',pid,startId:String(pid)}),plan={scheme:'sdk-global-query-only-finish-v1',ticket:'ticket',runId:'run',sessionId:'session',connection:'formal',driver:identity(1),sdk:identity(2),service:identity(3),projectHash:'hash',projectFileIdentity:'file'};
 const control={ticket:'ticket',runId:'run',sessionId:'session',phase:'awaiting-next-explicit-instruction',firstError:null,exitInfo:null,driverPid:1,sdkPid:2,formal:{pid:3,connection:'formal'}};
 const trace=[];for(const [id,method,tool] of [[0,'initialize'],[1,'tools/list'],...names.map((n,i)=>[i+2,'tools/call',n])]){
  const row={pid:3,connection:'formal',id,method,tool};trace.push({...row,event:'request'},{...row,event:'result',ok:true,isError:false,operationStatus:'succeeded'});
 }
 return {plan,control,round:{sessionId:'session',terminal:{type:'turn/end',data:{reason:{kind:'completed'}}},toolCalls:names.map(n=>({data:{name:'mcp__inoproshop__'+n,arguments:'{}'}}))},trace,
  observations:Object.fromEntries(['driver','sdk','service'].map(r=>[r,{state:'running',identity:plan[r]}])),activeOperations:0,nextRoundPresent:false,
  registryBefore:[{path:'registry',sha256:'a'}],registryNow:[{path:'registry',sha256:'a'}],engineeringBefore:[{path:'engineering',sha256:'b'}],engineeringNow:[{path:'engineering',sha256:'b'}],disk:{diskHash:'hash',fileIdentity:'file'}};
}
test('completed query-only SDK can finish without inventing a native launch',()=>{const e=evidence(),before=JSON.stringify(e),r=checkNoEngineeringFinish(e);assert.equal(r.mode,'no-native/no-engineering');assert.equal(r.launchId,undefined);assert.equal(r.nativeLaunches,0);assert.equal(JSON.stringify(e),before);});
for(const [name,mutate] of Object.entries({
 'native tool':e=>e.trace.find(r=>r.tool==='project_list').tool='project_open',
 'extra call':e=>e.trace.push({...e.trace[0],id:55}),
 'missing result':e=>e.trace.pop(),
 'result failure':e=>e.trace.at(-1).operationStatus='unknown',
 'wrong connection':e=>e.trace[0].connection='different',
 'wrong SDK instance':e=>e.observations.sdk={state:'running',identity:{...e.plan.sdk,startId:'999'}},
 'unconfirmed process':e=>e.observations.service={state:'unconfirmed'},
 'active operation':e=>e.activeOperations=1,
 'SDK pending turn':e=>e.control.phase='round-1',
 'new prompt queued':e=>e.nextRoundPresent=true,
 'new registry file':e=>e.registryNow.push({path:'new-operation',sha256:'c'}),
 'changed old record':e=>e.registryNow[0].sha256='changed',
 'changed file':e=>e.disk.diskHash='changed',
 'changed subsidiary':e=>e.engineeringNow[0].sha256='changed',
 'model extra tool':e=>e.round.toolCalls.push({data:{name:'mcp__inoproshop__object_read',arguments:'{}'}}),
 'failed turn':e=>e.round.terminal.data.reason.kind='failed',
 'prior error':e=>e.control.firstError={message:'failure'},
 'wrong ticket':e=>e.control.ticket='wrong'
}))test('no-engineering finish refuses '+name,()=>{const e=evidence();mutate(e);assert.throws(()=>checkNoEngineeringFinish(e));});
test('query-only wrapper rejects any supplied native launch before reading a plan',async()=>{await assert.rejects(readBeforeNoEngineeringShutdown({expectedLaunchId:'old-launch',authorization:'approved'}),/No native launch/);});
