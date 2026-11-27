import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {residentHash} from '../dist/resident.js';
import {schemas,outputSchemas,VERSION} from '../dist/contracts.js';

test('saved baseline adds one tool while all 38 previous input/output contracts remain exact',async()=>{
 const prior=JSON.parse(await readFile('tests/fixtures/resident-pre-saved-0411-contracts.json','utf8'));
 assert.equal(prior.version,'0.41.1');assert.equal(prior.tools.length,38);
 for(const r of prior.tools){assert.equal(residentHash(z.toJSONSchema(schemas[r.name],{io:'input'})),r.inputHash,r.name+' input');assert.equal(residentHash(z.toJSONSchema(outputSchemas[r.name])),r.outputHash,r.name+' output');}
 assert.equal(VERSION,'0.42.0');assert.equal(Object.keys(schemas).length,39);assert.equal(Object.keys(outputSchemas).length,39);
});
test('saved baseline contract requires exact explicit confirmation and last successful version',()=>{
 const valid={requestId:'user-save-1',projectId:'10000000-0000-4000-8000-000000000001',applicationId:'10000000-0000-4000-8000-000000000002',expectedResidentVersion:'a'.repeat(64),userConfirmedSaved:true};
 assert.deepEqual(schemas.project_accept_saved_version.parse(valid),valid);
 for(const field of Object.keys(valid)){const v={...valid};delete v[field];assert.equal(schemas.project_accept_saved_version.safeParse(v).success,false,field);}
 for(const value of [false,'true',1,null])assert.equal(schemas.project_accept_saved_version.safeParse({...valid,userConfirmedSaved:value}).success,false);
 assert.equal(schemas.project_accept_saved_version.safeParse({...valid,save:true}).success,false);
});
test('saved baseline instructions do not require a verbatim passphrase or human hashes',async()=>{
 const text=await readFile('instructions/inoproshop-workflow.md','utf8');
 assert.match(text,/已保存，请继续/);assert.match(text,/不索要用户ID、哈希或二次确认/);assert.match(text,/不恢复unknown/);
 assert.match(text,/先project_accept_saved_version，再object_read/);
 assert.ok(Buffer.byteLength('### MCP server: inoproshop\n\n'+text.trimEnd())<65536);
});
