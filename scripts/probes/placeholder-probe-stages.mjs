// Independent probe orchestration only. Imports never acquire a lease or launch.
export const phases = Object.freeze([
  {mode:'stabilize', save:1, fixture:0, clear:0, compile:1, load:0, state:'after-save'},
  {mode:'stable', save:0, fixture:0, clear:0, compile:1, load:0, state:'stable-build-readback'},
  {mode:'declare', save:1, fixture:1, clear:0, compile:1, load:1, state:'after-save'},
  {mode:'normal', save:0, fixture:0, clear:0, compile:1, load:0, state:'normal-build-readback'},
  {mode:'prepare', save:1, fixture:1, clear:0, compile:0, load:0, state:'after-save'},
  {mode:'baseline', save:0, fixture:0, clear:0, compile:1, load:0, state:'initial'},
  {mode:'clear', save:1, fixture:0, clear:1, compile:1, load:1, state:'after-save'},
  {mode:'verify', save:0, fixture:0, clear:0, compile:1, load:0, state:null}
].map(Object.freeze));

export async function runStageSequence(seed, nativePass, onConfirmed=()=>{}) {
  const completed=[];let disk=seed;
  for (const phase of phases) {
    // nativePass must not release its dispatch hold until this validation returns.
    const result=await nativePass(phase.mode,disk,completed.length?phases[completed.length-1]:null);
    if(result.status!=='succeeded'||result.closed!==true||result.mode!==phase.mode||
       result.diskBefore!==disk||!/^[0-9a-f]{64}$/.test(result.diskAfterClose)||
       result.saveCount!==phase.save||result.fixtureMutationCount!==phase.fixture||
       result.clearDispatchCount!==phase.clear||result.compileCount!==phase.compile||
       result.compileCompletedCount!==phase.compile||result.publicLoadCount!==phase.load||(!phase.save&&result.diskAfterClose!==disk))
      throw Error('Stage counts/closed disk version unconfirmed: '+phase.mode);
    if(!result.engine?.creationUtcTicks||completed.some(r=>r.engine.creationUtcTicks===result.engine.creationUtcTicks))
      throw Error('Independent native process unconfirmed: '+phase.mode);
    completed.push(result);disk=result.diskAfterClose;
    await onConfirmed(phase,result);
  }
  return {completed,disk};
}
