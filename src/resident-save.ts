import path from 'node:path';
import {readJson,codeHash} from './storage.js';
import {residentHash,residentDependencies,residentVersion,residentObject} from './resident.js';
import {buildStateView} from './resident-build.js';

export const SAVE_POLICY='resident-confirmed-change-save-v1';
const equal=(a:unknown,b:unknown)=>residentHash(a)===residentHash(b);
export const saveReady=(request:any,state:any)=>({scheme:SAVE_POLICY,requestHash:residentHash(request),beforeDisk:request.initialDisk,
 projectPath:state.projectPath,projectHandle:state.projectHandle,stateHash:residentHash(buildStateView(state))});
export const saveAuthorization=(request:any,ready:any,image:any)=>({scheme:SAVE_POLICY,requestHash:residentHash(request),readyHash:residentHash(ready),beforeDisk:image});

// Independent verification before authorizing public save. Only the specified
// implementation may change; no background-tree exception is added here.
export async function verifyWrittenState(request:any,directory:string) {
 const [before,checkpoint,pre,dispatch,after,check]=await Promise.all(['before','checkpoint','predispatch','dispatch','after','verification'].map(n=>readJson(path.join(directory,n+'.json'))));
 const deps=residentDependencies(before?.state),version=residentVersion(deps,before.diskHash),a=request.args;
 const object=residentObject(before.state,a.objectId,a.applicationId);
 if(request.command!=='change'||request.savePolicy!==SAVE_POLICY||request.initialDisk?.diskHash!==request.diskHash||request.initialDisk?.fileIdentity!==request.fileIdentity||before.diskHash!==request.diskHash||a.expectedResidentVersion!==version||a.expectedHash!==object.contentHash||a.declaration!==object.declaration||typeof a.implementation!=='string'||a.implementation===object.implementation)throw Error('Save write request/baseline differs');
 if(!equal(checkpoint,{request,state:before.state,diskHash:before.diskHash,residentVersion:version})||!equal(residentDependencies(pre?.state),deps)||pre.diskHash!==before.diskHash||!equal(dispatch,{operationId:request.operationId,requestId:request.requestId,action:'replace-implementation'}))throw Error('Save checkpoint/predispatch differs');
 const expected=structuredClone(deps);expected.nodes[a.objectId].implementation=a.implementation;
 const actual=residentDependencies(after?.state);
 if(after.diskHash!==before.diskHash||!equal(expected,actual)||!equal(check,{equal:true,expected,actual}))throw Error('Written state cannot authorize save');
 return after.state;
}

export async function verifyAutomaticSave(request:any,data:any,directory:string) {
 const written=await verifyWrittenState(request,directory);
 const [ready,authorization,call,returned,first,second,receipt]=await Promise.all(['save-ready','save-authorization','save-call','save-returned','save-read-first','save-read-second','save-receipt'].map(n=>readJson(path.join(directory,n+'.json'))));
 if(!equal(ready,saveReady(request,written))||!equal(authorization,saveAuthorization(request,ready,request.initialDisk))||
  !equal(call,{requestHash:residentHash(request),authorizationHash:residentHash(authorization),projectHandle:written.projectHandle,projectPath:written.projectPath,method:'ScriptProject.save',attempt:1})||
  !equal(returned,{requestHash:residentHash(request),callHash:residentHash(call),returned:true}))throw Error('Public save dispatch/return evidence differs');
 const stateView=buildStateView(written);
 for(const value of [first,second]) {
  if(value?.dirtyBefore!==false||value?.dirtyAfter!==false||typeof value.diskHash!=='string'||!/^[0-9a-f]{64}$/.test(value.diskHash)||value.diskHash===request.diskHash||!equal(buildStateView(value.state),stateView))throw Error('Saved current readback/dirty/file evidence differs');
  residentDependencies(value.state);
 }
 if(first.diskHash!==second.diskHash)throw Error('Saved file version unstable');
 const expected={scheme:SAVE_POLICY,requestHash:residentHash(request),callHash:residentHash(call),returnedHash:residentHash(returned),firstReadHash:residentHash(first),secondReadHash:residentHash(second),
  beforeDiskHash:request.diskHash,afterDiskHash:second.diskHash,projectHandle:written.projectHandle,projectPath:written.projectPath,snapshot:residentHash(residentDependencies(second.state)),
  scope:'all current unsaved project contents',reopened:false};
 if(!equal(receipt,expected)||!equal(data.saveReceipt,receipt)||data.saved!==true||data.saveCalls!==1||data.memoryModified!==true||data.persistedToProject!==true||data.persistedToWorkingCopy!==false)throw Error('Automatic save receipt/result differs');
 return {state:second.state,diskHash:second.diskHash,receipt};
}

export function verifyRegistrationPreserved(before:any,after:any,finalImage:any){
 if(!before||!after||!equal({...before,image:null},{...after,image:null})||!equal(after.image,finalImage))throw Error('Registry, alias, lease or saved file changed');
}
