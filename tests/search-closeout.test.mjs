// Infrastructure checks only, not a semantic model grader.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const probe=createRequire(import.meta.url)('../scripts/probes/dsh-search-config-attestation.cjs');
test('only own-session selected resolved model settings survive; request payload/private fields and reasoning do not',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inopro-search-config-'));
 const output=path.join(dir,'attestation.json'),instructions=path.join(dir,'instructions.md');await fs.writeFile(instructions,'one authority\n');
 const env={INOPRO_QA_ATTESTATION:output,INOPRO_QA_INSTRUCTIONS:instructions,INOPRO_QA_CWD:dir};
 const prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const k of Object.keys(env)){if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];}});
 let hook;probe.apply({on:(name,fn)=>{assert.equal(name,'session/event');hook=fn;}});
 const session={id:'synthetic-own',header:{cwd:dir}},secret='synthetic-private-marker';
 hook({...session,header:{cwd:dir+'-other'}},{type:'request/header',seq:1,data:{header:{config:{model:secret}}}});
 hook(session,{type:'request/header',seq:2,data:{header:{config:{provider:'route',model:'model',reasoningEffort:'high',maxTokens:1000,apiKey:secret},tools:[secret]},messages:[secret]}});
 hook(session,{type:'system/message',seq:3,data:{message:{content:[{type:'text',text:'### MCP server: inoproshop\n\none authority'},{type:'reasoning',text:secret}]}}});
 hook(session,{type:'assistant/message',seq:4,data:{message:{content:[{type:'text',text:secret}]}}});
 const raw=await fs.readFile(output,'utf8'),r=JSON.parse(raw);
 assert.ok(!raw.includes(secret));assert.equal(r.resolvedSettings.length,1);
 assert.deepEqual(r.resolvedSettings[0],{sessionId:'synthetic-own',seq:2,provider:'route',model:'model',reasoningEffort:'high',maxTokens:1000});
 assert.equal(r.systemMessages[0].authoritativeInstructionsPresent,true);assert.equal(r.passed,undefined);assert.equal(r.fullRequestLogsCollected,false);
});
