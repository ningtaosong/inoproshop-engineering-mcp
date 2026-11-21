import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {taskCallInventoryDifference,taskCreateInventoryView,taskCallDifference,taskConfigurationVersion} from '../dist/task-config.js';
const archived=JSON.parse(await readFile(new URL('./fixtures/task-program-inventory-order.json',import.meta.url),'utf8'));
test('actual saved preparation and MCP readback catalogs compare by unique native identities',()=>{
 const original=structuredClone(archived);
 assert.equal(taskCallInventoryDifference(archived.before,archived.after),undefined);
 assert.equal(taskCallDifference(taskCreateInventoryView(archived.before),taskCreateInventoryView(archived.after)),undefined);
 assert.equal(taskConfigurationVersion(archived.before),taskConfigurationVersion(archived.after));
 assert.deepEqual(archived,original);
});
for(const keys of [['tasks'],['programs'],['tasks','programs']])test('comparison view only aligns '+keys,()=>{
 const a=structuredClone(archived.before),b=structuredClone(a);
 for(const key of keys)b[key].reverse();
 const raw=structuredClone(b);
 assert.equal(taskCallInventoryDifference(a,b),undefined);assert.deepEqual(b,raw);
});
for(const [label,mutate] of [
 ['null vs empty',v=>v.programs[0].future=''],
 ['text None',v=>v.programs[0].future='None'],
 ['field absent',v=>delete v.programs[0].future],
 ['unknown nested order',v=>v.programs[0].extra.reverse()],
 ['internal call order',v=>v.tasks[0].rawCalls.reverse()],
 ['path order',v=>v.programs[0].path.reverse()],
]){
 test('unrelated order/type is still strict: '+label,()=>{
  const a=structuredClone(archived.before);a.programs[0].future=null;a.programs[0].extra=['A','B'];
  const b=structuredClone(a);mutate(b);assert(taskCallInventoryDifference(a,b));
 });
}
test('production bridge PROGRAM identity catalog and create/append/replace paths (offline)',async()=>{
 await promisify(execFile)('python',['-B','-X','utf8','tests/bridge_program_inventory_order_test.py'],{windowsHide:true,timeout:30000});
});

test('PROGRAM native GUID rejects trailing newline rather than JS dollar-anchor coercion',()=>{
 const v=structuredClone(archived.before);v.programs[0].objectId+='\n';
 assert.equal(taskCreateInventoryView(v),undefined);
 assert.equal(taskCallInventoryDifference(v,v).kind,'invalid-inventory');
});
