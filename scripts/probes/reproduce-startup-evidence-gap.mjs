// Offline replay of the actual original observer fragment. Never spawns an IDE.
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='dead85a49551c6c1313ab4cd8a10090c21efc9d5';
const source=execFileSync('git',['show',base+':scripts/probes/library-placeholder-clear-launch.mjs'],{encoding:'utf8'});
const fragment=source.slice(source.indexOf('    const exit=new Promise'),source.indexOf('    const result=await load'));
assert(fragment.includes('240000'));assert(fragment.includes('child.unref()'));
const child=new EventEmitter();child.pid=123;child.unref=()=>{};
const receipts=[];let failure;
const run=new (Object.getPrototypeOf(async function(){}).constructor)('child','probeProcess','publish','mode','operationId','now','setTimeout','clearTimeout',fragment);
try{await run(child,async()=>({state:'running',identity:{startId:'test'}}),async(n,v)=>receipts.push({name:n,value:v}),
  'prepare','offline-original-fragment',()=>new Date().toISOString(),(fn,ms)=>setTimeout(fn,ms===240000?1:ms),clearTimeout);}
catch(error){failure={name:error.name,message:error.message};}
child.emit('close',0,null);await Promise.resolve();
assert(failure);assert(receipts.some(x=>x.name==='prepare-unconfirmed.json'));assert(!receipts.some(x=>x.name==='prepare-exit.json'));
const report={kind:'offline-only',base,sourceSha256:createHash('sha256').update(source).digest('hex'),fragment,
  timerSubstitution:'240000 ms -> 1 ms in injected offline timer only; source fragment unchanged',failure,receipts,
  lateExitInjected:{code:0,signal:null},lateExitReceiptAbsent:true,originalUnknownNotReclassified:true};
await fs.writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('Original timeout fragment reproduced: unknown retained, later close event has no published receipt.');
