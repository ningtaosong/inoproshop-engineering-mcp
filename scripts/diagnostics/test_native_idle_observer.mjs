import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {Observation,durable,validateStartupReceipt,waitStartupReceipt} from './native_idle_observer.mjs';

function observer(){const events=[];return {events,state:new Observation((stage,value)=>events.push({stage,...value}),{launchId:'offline'})};}
test('normal code zero and close both retained',()=>{const {state,events}=observer();state.onExit(0,null);state.onClose(0,null);assert.equal(state.first,null);assert.equal(events.length,2);});
test('30 second timeout remains first after a late normal exit',()=>{const {state,events}=observer();state.businessExpired();state.onExit(0,null);state.onClose(0,null);assert.equal(state.first.code,'EXIT_DEADLINE');assert.equal(events[1].late,true);});
test('45 second bound preserves child and observer without writing a success',()=>{const {state,events}=observer();state.businessExpired();state.lateExpired();assert.equal(events.at(-1).preserveObserver,true);assert.equal(events.at(-1).preserveChild,true);assert.equal(state.exit,null);assert.equal(state.close,null);});
test('nonzero or signal is not a successful result',()=>{for(const [code,signal] of [[1,null],[-1073740771,null],[null,'SIGTERM']]){const {state}=observer();state.onExit(code,signal);assert.equal(state.first.code,'ABNORMAL_EXIT');}});
test('first exception preserved after later errors',()=>{const {state}=observer();state.fail('FIRST','original');state.businessExpired();state.onExit(5,null);assert.equal(state.first.code,'FIRST');});
test('durable Chinese, null, empty, literal data roundtrip and no overwrite',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'idle-observer-'));try{const file=path.join(root,'one.json'),value={text:'中文',nil:null,empty:'',literal:'None'};durable(file,value);assert.deepEqual(JSON.parse(fs.readFileSync(file)),value);assert.throws(()=>durable(file,{wrong:true}),{code:'EEXIST'});}finally{fs.rmSync(root,{recursive:true});}});
test('observer source installs callbacks synchronously before identity read',()=>{const text=fs.readFileSync(new URL('./native_idle_observer.mjs',import.meta.url),'utf8');const from=text.indexOf('child=spawn(intent.exe');const stop=text.indexOf('expectedStart=processState(child.pid)',from);const immediate=text.slice(from,stop).replace(/^\s*\/\/.*$/gm,'');assert(!immediate.includes('await'));for(const event of ['error','exit','close'])assert(immediate.includes(`child.on('${event}'`));});
test('only diagnostic preflight; no acquire, release of source lease, reconcile or force kill',()=>{const text=fs.readFileSync(new URL('./native_idle_observer.mjs',import.meta.url),'utf8');assert(!/\.(kill|reconcile|acquire|unlink)\(/.test(text.replace(/^\s*\/\/.*$/gm,'')));assert(text.includes('sourceLeaseRequested:false'));assert(text.includes('engineeringRemainsFrozen:true'));assert(text.includes('validateStartupReceipt(receipt,{...expectedReceipt,startId:self.startId})'));});
test('bound fixed deadline and stop marker precede spawn; no lifetime unref',()=>{const text=fs.readFileSync(new URL('./native_idle_observer.mjs',import.meta.url),'utf8');assert(text.indexOf("'native-admission.json'")<text.indexOf('child=spawn(intent.exe'));assert(!text.includes('.unref('));assert(text.includes('keepAlive=setInterval(()=>{},60000)'));assert(text.includes("stopAdmission('business timeout')"));});
test('result file alone never substitutes for normal exit receipts',()=>{const text=fs.readFileSync(new URL('./native_idle_observer.mjs',import.meta.url),'utf8');assert(text.includes("state.exit?.code!==0"));assert(text.includes("state.close?.code!==0"));assert(text.includes("result.binding.startId!==expectedStart.startId"));});
test('actual observer recorder survives primary, emergency and stop-file failure',()=>{
  const text=fs.readFileSync(new URL('./native_idle_observer.mjs',import.meta.url),'utf8');
  const definition=text.slice(text.indexOf('  function record(stage'),text.indexOf('  const stopAdmission='));
  const context={raw(){throw Error('primary publication');},observerError:null,fs:{writeSync(){throw Error('emergency publication');},fsyncSync(){throw Error('flush');}},emergency:1,durable(){throw Error('stop publication');},path,root:'test-root',binding:{launchId:'test'}};
  vm.createContext(context);vm.runInContext(definition+'; record("first"); record("second");',context);
  assert.equal(context.observerError.stage,'first');assert.equal(context.observerError.message,'primary publication');assert.equal(context.observerError.loggingError,'emergency publication');
});
const expected={intentPath:'intent',intentSha256:'i',observerPath:'observer',observerSha256:'o',nodePath:'node',nodeSha256:'n',launcherPath:'launcher',launcherSha256:'l',pid:123,startId:'456'};
const valid={...expected,launched:true,inJob:false,flags:'0x09000200'};
test('immutable external startup receipt accepts only the exact launch',()=>assert.equal(validateStartupReceipt(valid,expected),valid));
for(const key of Object.keys(expected))test('external receipt mismatch rejected: '+key,()=>assert.throws(()=>validateStartupReceipt({...valid,[key]:'wrong'},expected)));
for(const [key,value] of [['inJob',true],['inJob',null],['launched',false],['flags','other'],['error',{}],['startId',null]])test('missing startup independence rejects '+key+'='+String(value),()=>assert.throws(()=>validateStartupReceipt({...valid,[key]:value},expected)));
test('missing receipt stops before any native launch',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'idle-receipt-'));try{await assert.rejects(waitStartupReceipt(path.join(root,'absent.json'),expected,10));}finally{fs.rmSync(root,{recursive:true});}});
test('receipt is validated before the observer starts its first PowerShell helper',()=>{const text=fs.readFileSync(new URL('./native_idle_observer.mjs',import.meta.url),'utf8');assert(text.indexOf('const receipt=await waitStartupReceipt')<text.indexOf('const self=inJob()'));assert(!text.includes('if(self.inJob)throw'));});
