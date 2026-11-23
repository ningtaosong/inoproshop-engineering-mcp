import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {observeProbe,closeProbeHandles} from './probe-exit-observer.mjs';

const binding={operationId:'op',launchId:'launch',scriptSha256:'script'};
const birth={state:'running',identity:{pid:42,startId:'123'}};
const value=()=>({status:'succeeded',traceBinding:{...binding,pid:42,creationUtcTicks:'123'}});
async function scenario({exitAt=10,resultAt=10,code=0,signal=null,payload=value(),born=birth,failRecord=null,readThrows=false}={}) {
  let clock=0,emitted=false;const child=new EventEmitter();child.pid=42;child.unref=()=>{child.unreferenced=true;};
  const events=[],fallback=[];
  const answer=await observeProbe(child,{binding,birth:Promise.resolve(born),resultFile:'result.json',businessMs:20,graceMs:30,pollMs:5,
    now:()=>clock,sleep:async ms=>{clock+=ms;if(!emitted&&exitAt!==null&&clock>=exitAt){emitted=true;child.emit('exit',code,signal);}},
    read:async()=>{if(readThrows)throw Error('result read unavailable');return clock>=resultAt?{exists:true,sha256:'result',value:payload}:{exists:false};},
    publish:async(name,v)=>{if(name===failRecord)throw Error('publication unavailable');events.push({name,v:structuredClone(v)});},fallback:s=>fallback.push(s)});
  return {answer,events,fallback,child,clock};
}
test('normal bound result and exit zero',async()=>{const x=await scenario();assert.equal(x.answer.status,'succeeded');assert(x.answer.identityMatches);assert(x.events.some(e=>e.name==='process-exit'));});
test('late normal exit remains unknown and keeps timeout',async()=>{const x=await scenario({exitAt:30,resultAt:30});assert.equal(x.answer.status,'unknown');assert(x.answer.timedOut);assert.equal(x.answer.exit.code,0);assert.equal(x.events.filter(e=>e.name==='business-timeout').length,1);assert(x.events.some(e=>e.name==='process-exit'&&e.v.late));assert(x.events.some(e=>e.name.startsWith('result-observed')&&e.v.late));});
test('nonzero native exit is not success',async()=>{const x=await scenario({code:0xC000041D});assert.equal(x.answer.status,'unknown');assert.equal(x.answer.normalExit,false);});
test('signal exit is not success',async()=>{const x=await scenario({code:null,signal:'SIGTERM'});assert.equal(x.answer.status,'unknown');});
test('result alone and no exit expires read-only observation',async()=>{const x=await scenario({exitAt:null,resultAt:10});assert.equal(x.answer.status,'unknown');assert.equal(x.clock,50);assert(x.events.some(e=>e.name==='exit-observation-expired'));assert(x.child.unreferenced);});
test('normal exit without result remains unknown',async()=>{const x=await scenario({resultAt:Infinity});assert.equal(x.answer.status,'unknown');assert.equal(x.answer.normalExit,true);});
test('late exit without result records expiry separately',async()=>{const x=await scenario({exitAt:30,resultAt:Infinity});assert.equal(x.answer.status,'unknown');assert.equal(x.answer.exit.code,0);assert(x.events.some(e=>e.name==='exit-observation-expired'&&e.v.exitObserved));});
test('PID mismatch',async()=>{const p=value();p.traceBinding.pid=99;assert.equal((await scenario({payload:p})).answer.status,'unknown');});
test('creation identity mismatch',async()=>{const p=value();p.traceBinding.creationUtcTicks='other';assert.equal((await scenario({payload:p})).answer.status,'unknown');});
test('launch identity mismatch',async()=>{const p=value();p.traceBinding.launchId='other';assert.equal((await scenario({payload:p})).answer.status,'unknown');});
test('script fingerprint mismatch',async()=>{const p=value();p.traceBinding.scriptSha256='other';assert.equal((await scenario({payload:p})).answer.status,'unknown');});
test('missing process creation evidence',async()=>assert.equal((await scenario({born:{state:'exited'}})).answer.status,'unknown'));
test('result publication error is retained',async()=>{const x=await scenario({failRecord:'result-observed-001'});assert.equal(x.answer.status,'unknown');assert.match(x.fallback.join(''),/publication unavailable/);});
test('exit receipt publication error cannot be accepted',async()=>assert.equal((await scenario({failRecord:'process-exit'})).answer.status,'unknown'));
test('final observation publication error cannot be accepted',async()=>assert.equal((await scenario({failRecord:'observation-complete'})).answer.status,'unknown'));
test('timeout remains primary if timeout recorder fails',async()=>{const x=await scenario({exitAt:30,resultAt:30,failRecord:'business-timeout'});assert.equal(x.answer.primaryException.name,'BusinessTimeout');assert.match(x.fallback.join(''),/publication unavailable/);});
test('result read exception is not converted to absence/success',async()=>{const x=await scenario({readThrows:true});assert.equal(x.answer.status,'unknown');assert.match(x.answer.primaryException.message,/unavailable/);});
test('cleanup failure preserves first error and attempts both handles',async()=>{let count=0;const logs=[];
  await closeProbeHandles([{close:async()=>{count++;throw Error('close failed');}},{close:async()=>{count++;}}],Error('original failure'),s=>logs.push(s));
  assert.equal(count,2);assert.match(logs.join(''),/original failure/);assert.match(logs.join(''),/close failed/);
});
test('cleanup failure without first error fails conservatively',async()=>assert.rejects(closeProbeHandles([{close:async()=>{throw Error('close failed');}}],null,()=>{}),/close failed/));

test('failed closed native result with exit zero remains unknown with accurate diagnosis',async()=>{
  const p={...value(),status:'failed',closed:true,primaryException:{message:'original compile comparison',stage:'baseline-build'}};
  const x=await scenario({payload:p});assert.equal(x.answer.status,'unknown');assert.equal(x.answer.timedOut,false);
  assert.equal(x.answer.diagnostic.kind,'native-failed-closed-exit-zero');
  assert.deepEqual(x.answer.diagnostic.nativePrimaryException,p.primaryException);
  assert.equal(x.events.filter(e=>e.name==='business-timeout').length,0);
});
test('failed native result logger failure still blocks trusted diagnostic',async()=>{
  const x=await scenario({payload:{...value(),status:'failed',closed:true},failRecord:'observation-complete'});
  assert.equal(x.answer.status,'unknown');assert.equal(x.answer.diagnostic.trustedNativeFailure,false);
});
