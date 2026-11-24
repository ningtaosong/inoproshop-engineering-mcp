// OS process creation observation double, only for production-adapter unit tests.
export const processIdentity={version:1,platform:process.platform,host:'offline-double',pid:12345,startId:'123456789'};
export const processObservations={probe:async()=>({state:'running',identity:processIdentity})};
export const requestBinding={requestId:'unit-test',requestFingerprint:'f'.repeat(64)};
import path from 'node:path';
import fs from 'node:fs/promises';
import {readJson,atomicJson,digest} from '../dist/storage.js';
export async function normalCloseDouble(directory,identity=processIdentity) {
 const file=path.join(directory,'request.json'),r=await readJson(file);
 if(!r.normalClosePolicy)return;
 const binding={operationId:r.operationId,requestId:r.requestId,requestFingerprint:r.requestFingerprint,
  launchId:r.launchId,pid:identity.pid,startId:identity.startId,requestFileHash:digest(await fs.readFile(file))};
 const noProject={primaryIsNone:true,openProjectCount:0,uiPresent:true};
 const fields={preflight:{noProject,policy:r.normalClosePolicy},queue:{noProject,asyncRequested:true,callableKind:'python-callable'},
  queued:{},callback:{noProject},dispatch:{commandGuid:r.normalClosePolicy.commandGuid,arguments:[],dispatchOrdinal:1},returned:{dispatchCount:1}};
 for(const [stage,value] of Object.entries(fields))await atomicJson(path.join(directory,`normal-close-${stage}.json`),
  {schemaVersion:1,binding,stage,utc:new Date().toISOString(),...value});
}
