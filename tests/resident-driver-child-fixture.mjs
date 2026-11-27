// Pure SDK fixture: no IDE, engineering service, registry or project opened.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'offline-sdk-fixture',version:'0.40.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'fixture_only',inputSchema:{type:'object'}}]}));
process.stdin.on('end',()=>{void server.close();});
await server.connect(new StdioServerTransport());
