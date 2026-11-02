// Passive diagnostic loaded ONLY in isolated Phase 8 CLI runs, never the desktop profile.
// No tools, request hooks, network capture, answer edits or DSH source modifications.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
exports.name='phase8-prompt-attestation';
exports.apply=(ctx)=>{
 const output=process.env.INOPRO_QA_ATTESTATION;
 const instructionPath=process.env.INOPRO_QA_INSTRUCTIONS;
 const cwd=path.resolve(process.env.INOPRO_QA_CWD);
 if(!output||!instructionPath)throw Error('Phase 8 isolated diagnostic paths missing');
 const expected=fs.readFileSync(instructionPath,'utf8').trimEnd();
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 const report={schemaVersion:1,mode:'passive-own-session-system-message-only',instructionPath,expectedInstructionsSha256:sha(expected),
  systemMessages:[],contexts:[],assistantCommits:[],toolCalls:[],fullRequestLogsCollected:false,credentialsRead:false};
 const write=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');write();
 ctx.on('session/event',(session,event)=>{
  if(!session.header.cwd||path.resolve(session.header.cwd)!==cwd)return;
  if(event.type==='system/message'){
   const content=event.data.message.content;
   const text=Array.isArray(content)?content.filter(x=>x.type==='text').map(x=>x.text).join(''):String(content??'');
   report.systemMessages.push({sessionId:String(session.id),seq:Number(event.seq),time:event.time,role:'system',bytes:Buffer.byteLength(text),sha256:sha(text),
    mcpAttributionPresent:text.includes('### MCP server: inoproshop\n'),authoritativeInstructionsPresent:text.includes(expected)});
  }else if(event.type==='request/context'){
   report.contexts.push({sessionId:String(session.id),seq:Number(event.seq),provider:event.data.provider,model:event.data.model});
  }else if(event.type==='assistant/message')report.assistantCommits.push({sessionId:String(session.id),seq:Number(event.seq),time:event.time});
  else if(event.type==='tool/call')report.toolCalls.push({name:event.data.name,seq:Number(event.seq)});
  else return;
  write();
 });
};
