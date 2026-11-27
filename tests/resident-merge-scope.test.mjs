import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {schemas,outputSchemas,VERSION} from '../dist/contracts.js';

test('split candidate restores exact main variable_edit contract, including required initializer',async()=>{
 const main=JSON.parse(await readFile('tests/fixtures/resident-main-0380-contracts.json','utf8')).variableEdit;
 assert.deepEqual(z.toJSONSchema(schemas.variable_edit,{io:'input'}),main.inputSchema);
 assert.deepEqual(z.toJSONSchema(outputSchemas.variable_edit),main.outputSchema);
 const s=z.toJSONSchema(schemas.variable_edit,{io:'input'});
 assert.equal(VERSION,'0.42.0');assert.equal(Object.keys(schemas).length,38);
 assert.ok(s.required.includes('initializer'));assert.ok(!s.properties.action.enum.includes('add-struct-field'));
});
test('excluded field-add action is rejected even with otherwise valid legacy edit arguments',()=>{
 const request={requestId:'excluded-action',projectId:'10000000-0000-4000-8000-000000000001',applicationId:'10000000-0000-4000-8000-000000000002',objectId:'10000000-0000-4000-8000-000000000003',expectedHash:'a'.repeat(64),expectedSnapshot:'b'.repeat(64),expectedDiskHash:'c'.repeat(64),action:'add-struct-field',name:'Enable',type:'BOOL',initializer:'TRUE'};
 const result=schemas.variable_edit.safeParse(request);assert.equal(result.success,false);
 assert.ok(result.error.issues.some(x=>x.path.join('.')==='action'));
});
test('resident descriptions retain mode restrictions while field-add advertising is removed',async()=>{
 const server=await readFile('src/server.ts','utf8'),instructions=await readFile('instructions/inoproshop-workflow.md','utf8');
 assert.doesNotMatch(server,/add-struct-field/);assert.doesNotMatch(instructions,/add-struct-field/);
 for(const name of ['variable_usages','code_apply_change','project_build']){
  const line=server.split('\n').find(x=>x.startsWith('  '+name+':'));
  assert.match(line,/resident/);
 }
});
