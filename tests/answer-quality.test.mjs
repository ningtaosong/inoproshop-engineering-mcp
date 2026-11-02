// Tests only the diagnostic's privacy/scope properties; these do not grade model semantics.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const probe=createRequire(import.meta.url)('../scripts/probes/dsh-prompt-attestation.cjs');
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inopro-phase8-probe-'));
 const instructions=path.join(dir,'instructions.md'),output=path.join(dir,'attest.json');
 await fs.writeFile(instructions,'One authoritative rule.\n');
 const keys=['INOPRO_QA_ATTESTATION','INOPRO_QA_INSTRUCTIONS','INOPRO_QA_CWD'];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{INOPRO_QA_ATTESTATION:output,INOPRO_QA_INSTRUCTIONS:instructions,INOPRO_QA_CWD:dir});
 let hook;probe.apply({on:(event,fn)=>{assert.equal(event,'session/event');hook=fn;}});
 t.after(()=>{for(const k of keys)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];});
 return {dir,output,hook,session:{id:'own-test-session',header:{cwd:dir}}};
}
test('提示词探针只保存本轮系统消息的哈希及归属，不保存请求/凭据/其他会话/推理',async t=>{
 const c=await setup(t),privateMarker='synthetic-private-value-never-retained';
 c.hook(c.session,{type:'request/header',seq:1,data:{key:privateMarker}});
 c.hook({id:'other',header:{cwd:c.dir+'-other'}},{type:'system/message',seq:2,data:{message:{content:[{type:'text',text:privateMarker}]}}});
 const text='### MCP server: inoproshop\n\nOne authoritative rule.';
 c.hook(c.session,{type:'system/message',seq:3,time:10,data:{message:{content:[{type:'text',text},{type:'reasoning',text:privateMarker}]}}});
 c.hook(c.session,{type:'request/context',seq:4,data:{provider:'test',model:'test-model',apiKey:privateMarker}});
 const raw=await fs.readFile(c.output,'utf8'),r=JSON.parse(raw);
 assert.ok(!raw.includes(privateMarker));assert.equal(r.systemMessages.length,1);
 assert.equal(r.systemMessages[0].sha256,createHash('sha256').update(text).digest('hex'));
 assert.equal(r.systemMessages[0].authoritativeInstructionsPresent,true);assert.equal(r.fullRequestLogsCollected,false);assert.equal(r.credentialsRead,false);
 assert.deepEqual(r.contexts[0],{sessionId:'own-test-session',seq:4,provider:'test',model:'test-model'});
});
test('指令送达元数据不自动判定回答正确，也不保存或改写实际答案',async t=>{
 const c=await setup(t);
 c.hook(c.session,{type:'system/message',seq:5,data:{message:{content:[{type:'text',text:'### MCP server: inoproshop\n\nOne authoritative rule.'}]}}});
 c.hook(c.session,{type:'assistant/message',seq:6,data:{message:{content:[{type:'text',text:'Deliberately wrong answer.'}]}}});
 const raw=await fs.readFile(c.output,'utf8'),r=JSON.parse(raw);
 assert.equal(r.systemMessages[0].authoritativeInstructionsPresent,true);assert.equal(r.assistantCommits[0].seq,6);
 assert.equal(r.passed,undefined);assert.ok(!raw.includes('Deliberately wrong answer.'));
});
