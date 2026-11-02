// Only isolated own-session metadata; never persist the request envelope, tools or body.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
exports.name='phase8-search-config-attestation';
exports.apply=ctx=>{
 const output=process.env.INOPRO_QA_ATTESTATION,instructionPath=process.env.INOPRO_QA_INSTRUCTIONS;
 const cwd=path.resolve(process.env.INOPRO_QA_CWD);
 if(!output||!instructionPath)throw Error('Isolated diagnostic paths missing');
 const expected=fs.readFileSync(instructionPath,'utf8').trimEnd(),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 const report={schemaVersion:1,mode:'own-session-scalar-metadata-only',expectedInstructionsSha256:sha(expected),
  systemMessages:[],contexts:[],resolvedSettings:[],assistantCommits:[],toolCalls:[],fullRequestLogsCollected:false,credentialsRead:false};
 const write=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');write();
 ctx.on('session/event',(session,event)=>{
  if(!session.header.cwd||path.resolve(session.header.cwd)!==cwd)return;
  const meta={sessionId:String(session.id),seq:Number(event.seq)};
  if(event.type==='system/message'){
   const content=event.data.message.content;
   const text=Array.isArray(content)?content.filter(x=>x.type==='text').map(x=>x.text).join(''):String(content??'');
   report.systemMessages.push({...meta,bytes:Buffer.byteLength(text),sha256:sha(text),mcpAttributionPresent:text.includes('### MCP server: inoproshop\n'),authoritativeInstructionsPresent:text.includes(expected)});
  }else if(event.type==='request/context'){
   report.contexts.push({...meta,provider:event.data.provider,model:event.data.model});
  }else if(event.type==='request/header'){
   const config=event.data?.header?.config;
   const selected={...meta};
   for(const key of ['provider','model','reasoningEffort','maxTokens']){
    const value=config?.[key];
    if(typeof value==='string'||typeof value==='number'||value===null)selected[key]=value;
   }
   report.resolvedSettings.push(selected);
  }else if(event.type==='assistant/message')report.assistantCommits.push(meta);
  else if(event.type==='tool/call')report.toolCalls.push({...meta,name:event.data.name});
  else return;
  write();
 });
};
