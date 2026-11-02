import {z} from 'zod';
import {writeFile} from 'node:fs/promises';
import {schemas,outputSchemas,CONTRACT,VERSION} from '../dist/contracts.js';
const tools=Object.entries(schemas).map(([name,schema])=>({name,inputSchema:z.toJSONSchema(schema,{io:'input'}),outputSchema:z.toJSONSchema(outputSchemas[name])}));
await writeFile('docs/tool-schemas.json',JSON.stringify({serverVersion:VERSION,contractVersion:CONTRACT,toolCount:tools.length,tools},null,2));
