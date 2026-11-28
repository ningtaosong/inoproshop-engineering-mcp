// Independent file-only review of a completed acceptance command. No MCP calls,
// IDE commands, operation reconciliation, lease changes or source writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const [root,resultName,outputName]=process.argv.slice(2);
if(!root||!resultName||!outputName)throw Error('Explicit root/result/output required');
const config=await read(path.join(root,'client-config.json'));
const fixed=config.cwd;
const {verifyResidentResult,residentDependencies}=await import(pathToFileURL(path.join(fixed,'dist/resident.js')));
const {probeProcess}=await import(pathToFileURL(path.join(fixed,'dist/lease-process.js')));
const {fileIdentity}=await import(pathToFileURL(path.join(fixed,'dist/isolation.js')));
const value=await read(path.join(root,'client/results',resultName)),r=value.result;
if(r.status!=='succeeded'||r.saveCalls!==1||r.compileCalls!==0||r.closeCalls!==0||r.ideKeptOpen!==true)throw Error('Round not completed with exactly one save');
const rows=[];
for(const response of [r.before,r.changed,r.after]){
 const dir=path.join(config.dataDir,'ipc',response.operationId),req=await read(path.join(dir,'request.json')),native=await read(path.join(dir,'result.json'));
 const check=await read(path.join(dir,'service-verification.json'));
 if(check.passed!==true||check.processState!=='running'||check.exitRequiredForRequest!==false)throw Error('Service verification not confirmed');
 await verifyResidentResult(req,native,dir,check.processIdentity);
 if(response.requestId!==req.requestId||response.data.diskHash!==native.data.diskHash||response.data.residentVersion!==native.data.residentVersion)throw Error('Protocol result differs from independent native review');
 rows.push({operationId:req.operationId,requestId:req.requestId,command:req.command,sequence:req.sequence,requestHash:check.requestHash,resultHash:check.resultHash,processIdentity:check.processIdentity,launchId:req.launchId,passed:true});
}
const d=r.after.data,identity=await probeProcess(d.residentEvidence.processIdentity.pid);
if(identity.state!=='running'||identity.identity.startId!==d.residentEvidence.processIdentity.startId)throw Error('Owned IDE not confirmed live');
const disk=await fileIdentity(d.projectPath);
if(disk.sha256!==d.diskHash||d.diskHash!==r.changed.data.saveReceipt.afterDiskHash||d.diskHash===r.before.data.diskHash)throw Error('Current saved file differs');
const commandDir=path.join(config.dataDir,'ipc',r.changed.operationId),before=await read(path.join(commandDir,'before.json')),after=await read(path.join(commandDir,'after.json'));
const x=residentDependencies(before.state),y=residentDependencies(after.state),expected=structuredClone(x);
expected.nodes[d.objectId].implementation=value.command.afterImplementation;
if(JSON.stringify(expected)!==JSON.stringify(y)){
 // JSON serialization order is not a semantic comparison; production verifier
 // already checks all fields. Compare canonical object keys only (arrays strict).
 const {residentHash}=await import(pathToFileURL(path.join(fixed,'dist/resident.js')));
 if(residentHash(expected)!==residentHash(y))throw Error('Additional dependency change');
}
if(d.implementation!==value.command.afterImplementation||r.before.data.implementation!==value.command.beforeImplementation||d.declaration!==r.before.data.declaration)throw Error('Source conservation differs');
const report={at:new Date().toISOString(),mode:'file-only independent review; no IDE/API actions',commandId:value.command.id,roundStatus:r.status,product:'eb746c827042c6593baabb5d4a363af7604ccbcf',entry:config.entry,entrySha256:sha(await fs.readFile(config.entry)),rows,saveCalls:1,compileCalls:0,closeCalls:0,projectHandle:d.projectHandle,liveIDE:identity,finalFile:disk,sourceBefore:r.before.data.implementation,sourceAfter:d.implementation,declarationPreserved:true,otherDependenciesPreserved:true,dependencyNodeCount:Object.keys(x.nodes).length,scope:'Same-handle public save and subsequent readback, not independent reopen or PLC execution'};
await fs.writeFile(path.join(root,outputName),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({file:outputName,passed:true,operation:r.changed.operationId,hash:disk.sha256,saveCalls:1,IDE:identity.identity.pid}));
