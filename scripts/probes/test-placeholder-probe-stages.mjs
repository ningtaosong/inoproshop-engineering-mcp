import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {phases,runStageSequence} from './placeholder-probe-stages.mjs';
import {completionDiagnosis,completionError} from './probe-exit-observer.mjs';

const seed='a'.repeat(64);
function response(phase,disk,index){return {status:'succeeded',mode:phase.mode,closed:true,diskBefore:disk,
  diskAfterClose:phase.save?String(index+1).repeat(64):disk,saveCount:phase.save,fixtureMutationCount:phase.fixture,
  clearDispatchCount:phase.clear,compileCount:phase.compile,compileCompletedCount:phase.compile,
  publicLoadCount:phase.load,
  engine:{creationUtcTicks:String(index+1)}};}
async function fakeSequence(change){
  const called=[],confirmed=[];
  try{const result=await runStageSequence(seed,async(mode,disk,previous)=>{
    const index=called.length;called.push({mode,disk,previous:previous?.mode??null});
    const value=response(phases[index],disk,index);if(change)change(value,index);return value;
  },p=>confirmed.push(p.mode));return {result,called,confirmed};}
  catch(error){return {error,called,confirmed};}
}
test('eight stages gate override on persisted normal baseline',async()=>{
  const x=await fakeSequence();assert.equal(x.error,undefined);
  assert.deepEqual(x.called.map(c=>c.mode),['stabilize','stable','declare','normal','prepare','baseline','clear','verify']);
  assert.deepEqual(x.called.map(c=>c.previous),[null,'stabilize','stable','declare','normal','prepare','baseline','clear']);
  assert.equal(x.result.completed.reduce((n,r)=>n+r.saveCount,0),4);
  assert.equal(x.result.completed.reduce((n,r)=>n+r.compileCount,0),7);
  assert.equal(x.result.completed.reduce((n,r)=>n+r.publicLoadCount,0),2);
  assert.equal(x.result.completed.reduce((n,r)=>n+r.clearDispatchCount,0),1);
});
for(let failed=0;failed<phases.length;failed++){
  test(`failed ${phases[failed].mode} stops later dispatch and confirmation`,async()=>{
    const x=await fakeSequence((r,i)=>{if(i===failed)r.status='failed';});
    assert(x.error);assert.equal(x.called.length,failed+1);assert.equal(x.confirmed.length,failed);
  });
  test(`exception in ${phases[failed].mode} retained without retries`,async()=>{
    const original=Error('original native failure');const x=await fakeSequence((r,i)=>{if(i===failed)throw original;});
    assert.equal(x.error,original);assert.equal(x.called.length,failed+1);assert.equal(x.confirmed.length,failed);
  });
}
for(const key of ['saveCount','fixtureMutationCount','clearDispatchCount','compileCount','compileCompletedCount','publicLoadCount']){
  test(`wrong ${key} after closed result retains dispatch hold`,async()=>{
    const x=await fakeSequence((r,i)=>{if(i===0)r[key]++;});assert(x.error);assert.equal(x.confirmed.length,0);assert.equal(x.called.length,1);
  });
}
test('unknown, incomplete close, disk change and duplicate process stop',async()=>{
  for(const edit of [r=>r.status='unknown',r=>r.closed=false,r=>r.diskBefore='b'.repeat(64),
    r=>r.diskAfterClose='invalid',r=>delete r.engine.creationUtcTicks]){
    const x=await fakeSequence((r,i)=>{if(i===0)edit(r);});assert(x.error);assert.equal(x.called.length,1);
  }
  const x=await fakeSequence((r,i)=>{if(i===1)r.engine.creationUtcTicks='1';});assert(x.error);assert.equal(x.called.length,2);
});
test('read-only stable stage cannot change disk',async()=>{
  const x=await fakeSequence((r,i)=>{if(i===1)r.diskAfterClose='f'.repeat(64);});assert(x.error);assert.equal(x.called.length,2);
});
test('120000 native failure retains cause and unknown without invented timeout',async()=>{
  const raw=await readFile('D:/InoPro-PlaceholderClear-20261123-120000/baseline-observation-complete.json');
  const observation=JSON.parse(raw);const before=createHash('sha256').update(raw).digest('hex');
  const diagnostic=completionDiagnosis(observation),error=completionError(observation);
  assert.equal(observation.status,'unknown');assert.equal(observation.timedOut,false);
  assert.equal(diagnostic.kind,'native-failed-closed-exit-zero');assert.equal(diagnostic.trustedNativeFailure,true);
  assert.deepEqual(error.nativePrimaryException,observation.result.value.primaryException);
  assert.match(error.message,/configurationVersion/);assert.doesNotMatch(error.message,/timeout/i);
  const x=await fakeSequence((r,i)=>{if(i===1)throw error;});assert.equal(x.error,error);assert.equal(x.called.length,2);
  assert.equal(createHash('sha256').update(await readFile('D:/InoPro-PlaceholderClear-20261123-120000/baseline-observation-complete.json')).digest('hex'),before);
});
test('untrusted native failure never described as trusted closed failure',()=>{
  const original={timedOut:false,normalExit:true,identityMatches:true,primaryException:null,loggerErrors:[],
    result:{value:{status:'failed',closed:true,primaryException:{message:'original'}}}};
  for(const edit of [o=>o.timedOut=true,o=>o.normalExit=false,o=>o.identityMatches=false,
      o=>o.primaryException={message:'logger'},o=>o.loggerErrors.push({message:'write'}),
      o=>o.result.value.closed=false]){
    const o=structuredClone(original);edit(o);assert.equal(completionDiagnosis(o).trustedNativeFailure,false);
    assert.deepEqual(completionError(o).nativePrimaryException,{message:'original'});
  }
});
test('launcher cannot release a failed native result through the old dead branch',async()=>{
  const s=await readFile(new URL('./library-placeholder-clear-launch.mjs',import.meta.url),'utf8');
  assert.match(s,/if\(observed.status!=='succeeded'\)throw completionError\(observed\)/);
  assert.doesNotMatch(s,/result.status==='failed'/);
  const body=s.slice(s.indexOf('async function nativePass'),s.indexOf('\nawait checkHandoff();'));
  assert.doesNotMatch(body,/dispatched=false/);
  assert.match(s,/runStageSequence\(seed,nativePass,\(\)=>\{dispatched=false;\}\)/);
});
