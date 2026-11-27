// Append-only facts for one observer. Never an operation result or lease transition.
import {promises as fs,writeSync} from 'node:fs';
import path from 'node:path';
import {canonical,digest} from './storage.js';
export function errorDetails(error:unknown):any {
  if(error instanceof Error)return {name:error.name,message:error.message,stack:error.stack,
    ...('code' in error?{code:error.code}:{}),...(error.cause!==undefined?{cause:String(error.cause)}:{})};
  return {name:'ThrownValue',message:String(error)};
}
export async function exclusiveJson(file:string,value:unknown) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const handle=await fs.open(file,'wx');let first:unknown;
  try {await handle.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await handle.sync();}
  catch(error){first=error;throw error;}
  finally {try {await handle.close();}catch(error){if(first===undefined)throw error;diagnosticStderr({kind:'evidence-close-error',first:errorDetails(first),cleanup:errorDetails(error)});}}
}
export function diagnosticStderr(value:unknown) {
  // This synchronous fallback must not write to MCP stdout or mask the first fault.
  try {writeSync(2,JSON.stringify(value)+'\n');return true;}catch{return false;}
}
export class ExitJournal {
  private tail:Promise<unknown>=Promise.resolve();
  private ordinal=0;
  readonly failures:unknown[]=[];
  constructor(readonly directory:string,private binding:Promise<unknown>|unknown,
    private write=exclusiveJson,private report:(value:unknown)=>unknown=diagnosticStderr) {}
  record(event:string,data:unknown={}) {
    const ordinal=++this.ordinal,observedAt=new Date().toISOString();
    const file=path.join(this.directory,String(ordinal).padStart(6,'0')+'-'+event+'.json');
    const pending=this.tail.then(async()=>{
      let value:unknown={ordinal,observedAt,event,data,bindingUnconfirmed:true};
      try {value={binding:await this.binding,ordinal,observedAt,event,data};
        await this.write(file,{schemaVersion:1,value,checksum:digest(canonical(value))});}
      catch(error){const failure={kind:'exit-journal-publication-failed',file,value,error:errorDetails(error)};
        this.failures.push(failure);try {this.report(failure);}catch(reportError){diagnosticStderr({...failure,reportError:errorDetails(reportError)});}throw error;}
    });
    this.tail=pending.catch(()=>{});return pending;
  }
  async settled(){await this.tail;if(this.failures.length)throw Object.assign(Error('Exit journal publication failed'),{failures:this.failures});}
}
