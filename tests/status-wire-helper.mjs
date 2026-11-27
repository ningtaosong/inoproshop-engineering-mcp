// Offline transport only: real MCP SDK validation and production service/output paths.
// Native activity is supplied by each test's existing isolated fixture.
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {schemas,outputSchemas,reply,DomainError,VERSION} from '../dist/contracts.js';
import {toolOutput} from '../dist/native-output.js';
import {placeholderClearDelivery} from '../dist/placeholder-clear-delivery.js';

export async function statusWire(service,name='session_status') {
 assert.ok(['session_status','project_list'].includes(name));
 const server=new McpServer({name:'status-wire-offline',version:VERSION});
 let raw;
 server.registerTool(name,{inputSchema:schemas[name],outputSchema:outputSchemas[name]},async args=>{
  try{raw=await service.call(name,args);}
  catch(e){raw={...reply(e instanceof DomainError?e.status:'failed',e.message),error:{code:e.code||'TOOL_ERROR',message:e.message}};}
  return toolOutput(placeholderClearDelivery(raw,service.config.dataDir));
 });
 const client=new Client({name:'status-wire-offline',version:'1'}),[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 try {
  await server.connect(serverTransport);await client.connect(clientTransport);
  const tools=await client.listTools();assert.equal(tools.tools.length,1);assert.equal(tools.tools[0].name,name);
  const result=await client.callTool({name,arguments:{}});
  assert.deepEqual(result.structuredContent,raw,JSON.stringify(result));
  assert.equal(result.isError,['failed','conflict','unsupported','unknown'].includes(raw.status));
  // The SDK intentionally skips output validation for isError; validate our
  // advertised shape explicitly for conflict/unknown as well as success.
  const checked=outputSchemas[name].safeParse(result.structuredContent);
  assert.equal(checked.success,true,checked.success?'':JSON.stringify(checked.error.issues));
  if(raw.data?.session?.residentObservation)assert.deepEqual(checked.data.data.session.residentObservation,raw.data.session.residentObservation);
  return raw;
 }finally{await client.close();await server.close();}
}
