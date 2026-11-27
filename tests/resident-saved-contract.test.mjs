import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {residentHash} from '../dist/resident.js';
import {schemas,outputSchemas,VERSION} from '../dist/contracts.js';

test('autosave withdraws unshipped tool and retains 38 validation contracts',async()=>{
 const prior=JSON.parse(await readFile('tests/fixtures/resident-pre-saved-0411-contracts.json','utf8'));
 assert.equal(prior.version,'0.41.1');assert.equal(prior.tools.length,38);
 for(const r of prior.tools){
  const schema=z.toJSONSchema(schemas[r.name],{io:'input'});
  if(r.name==='project_open')schema.properties.sessionMode.description='新推荐流程显式resident：同服务同IDE、默认不保存不关闭；省略或batch保留旧批处理语义。';
  assert.equal(residentHash(schema),r.inputHash,r.name+' input');assert.equal(residentHash(z.toJSONSchema(outputSchemas[r.name])),r.outputHash,r.name+' output');
 }
 assert.equal(VERSION,'0.42.0');assert.equal(Object.keys(schemas).length,38);assert.equal(Object.keys(outputSchemas).length,38);
 assert.equal(schemas.project_accept_saved_version,undefined);
});
test('autosave instructions describe all-project save, no-op and stopped boundaries',async()=>{
 const text=await readFile('instructions/inoproshop-workflow.md','utf8');
 assert.match(text,/实际修改.*自动保存原路径/);assert.match(text,/全部未保存内容/);assert.match(text,/相同内容不保存/);assert.match(text,/不恢复stopped\/unknown/);
 assert.doesNotMatch(text,/project_accept_saved_version/);
 assert.ok(Buffer.byteLength('### MCP server: inoproshop\n\n'+text.trimEnd())<65536);
});
