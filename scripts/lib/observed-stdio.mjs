// Acceptance transport for the pinned SDK. No kill, operation recovery or lease mutation.
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ExitJournal,errorDetails,diagnosticStderr} from '../../dist/exit-journal.js';
import {probeProcess} from '../../dist/lease-process.js';

export class ObservedStdioTransport extends StdioClientTransport {
  constructor(server,{directory,entryFile=server.args?.[0],closeTimeoutMs=15000,probe=probeProcess,write,report=diagnosticStderr}={}) {
    super(server);this.runId=randomUUID();this.closeTimeoutMs=closeTimeoutMs;this.probe=probe;this.report=report;
    this.processEvents=[];this.exitSeen=null;this.closeSeen=null;this.journalErrors=[];
    this.binding=new Promise(resolve=>this.bind=resolve);
    this.entryFile=entryFile;
    this.journal=new ExitJournal(directory,this.binding,write,report);
    this.closed=new Promise(resolve=>this.onObservedClose=resolve);
  }
  record(event,value={}) {
    const promise=this.journal.record(event,value);
    // Event callbacks must not create unhandled rejections; the caller still
    // receives the error, and close/settled refuses a successful observation.
    promise.catch(error=>this.journalErrors.push(error));return promise;
  }
  async start() {
    const starting=super.start();starting.catch(()=>{});this.child=this._process;
    const child=this.child;
    if(!child){this.bind({runId:this.runId,pid:null,process:{state:'unconfirmed',reason:'no-child'}});return starting;}
    const event=(kind,data)=>{
      const observedAt=new Date().toISOString();this.processEvents.push({kind,observedAt,...data});
      return this.record('service-'+kind,{observedAt,...data});
    };
    // Attach before awaiting spawn, initialize or any business request.
    child.once('error',error=>{this.firstServiceError??=error;void event('error',{error:errorDetails(error)});});
    child.once('exit',(code,signal)=>{this.exitSeen={code,signal:signal??null};void event('exit',this.exitSeen);});
    child.once('close',(code,signal)=>{
      this.closeSeen={code,signal:signal??null};void event('close',this.closeSeen);this.onObservedClose(this.closeSeen);
    });
    child.stdin?.on('error',error=>{this.firstServiceError??=error;void event('stdin-error',{error:errorDetails(error)});});
    let identity,entryFingerprint=null,entryError;
    try {identity=child.pid?await this.probe(child.pid):{state:'unconfirmed',reason:'no-pid'};}
    catch(error){identity={state:'unconfirmed',reason:'process-identity-failed',error:errorDetails(error)};}
    if(this.exitSeen||this.closeSeen)identity={state:'unconfirmed',reason:'exit-before-creation-identity-confirmed',returnedObservation:identity};
    try {if(!this.entryFile||!path.isAbsolute(this.entryFile))throw Error('Explicit absolute entry file required');
      entryFingerprint={path:this.entryFile,sha256:createHash('sha256').update(await fs.readFile(this.entryFile)).digest('hex')};}
    catch(error){entryError=error;}
    this.bind({runId:this.runId,pid:child.pid??null,process:identity,
      command:this._serverParams.command,args:this._serverParams.args??[],cwd:this._serverParams.cwd??null,entryFingerprint});
    await this.record('service-start',{identityConfirmed:identity.state==='running'});
    try {await starting;}catch(error){await this.record('start-failed',{error:errorDetails(error)}).catch(()=>{});throw error;}
    if(entryError){await this.record('entry-fingerprint-failed',{error:errorDetails(entryError)});throw entryError;}
    if(identity.state!=='running')throw Error('Service process creation identity unconfirmed');
  }
  close() {return this.closing??=this.closeObserved();}
  async closeObserved() {
    const child=this.child;if(!child)return;
    try {
      if(!this.closeSeen) {
        if(!this.exitSeen){await this.record('eof-requested',{pid:child.pid??null});
          if(!child.stdin||child.stdin.destroyed)throw Error('EOF stdin unavailable; no kill');
          child.stdin.end();await this.record('eof-sent',{pid:child.pid??null});}
        let timer;
        const result=await Promise.race([this.closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),this.closeTimeoutMs);})]);
        clearTimeout(timer);
        if(!result){await this.record('close-observation-deadline',{timeoutMs:this.closeTimeoutMs,exit:this.exitSeen});
          throw Error('EOF exit unconfirmed; no kill');}
      }
      await this.journal.settled();
      if(this.firstServiceError)throw this.firstServiceError;
      if(!this.exitSeen||this.exitSeen.code!==0||this.exitSeen.signal!==null)throw Error('Service normal exit unconfirmed');
      this._readBuffer.clear();
      return {...this.exitSeen,runId:this.runId};
    } catch(error) {await this.record('cleanup-error',{error:errorDetails(error)}).catch(()=>{});throw error;}
  }
  // After close timeout, observe bounded late facts without changing that failure.
  async observeLate(timeoutMs=15000) {
    let timer;await this.record('late-observation-started',{timeoutMs});
    const result=await Promise.race([this.closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
    clearTimeout(timer);await this.record('late-observation-ended',{deadlineReached:!result,exit:this.exitSeen,close:this.closeSeen});
    await this.journal.settled();return result;
  }
}

export async function preservePrimary(run,cleanup,record=async()=>{}) {
  let value,primary,cleanupError,hasPrimary=false,hasCleanup=false;
  try {value=await run();}catch(error){primary=error;hasPrimary=true;
    try {await record('business-error',{error:errorDetails(error)});}catch(recordError){diagnosticStderr({kind:'business-error-record-failed',error:errorDetails(error),recordError:errorDetails(recordError)});}}
  try {await cleanup();}catch(error){cleanupError=error;hasCleanup=true;
    try {await record('cleanup-error',{error:errorDetails(error),primary:primary===undefined?null:errorDetails(primary)});}catch(recordError){diagnosticStderr({kind:'cleanup-error-record-failed',error:errorDetails(error),recordError:errorDetails(recordError)});}}
  if(hasPrimary)throw primary;
  if(hasCleanup)throw cleanupError;
  return value;
}
