import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkPlan,checkFixedVersion,checkConnection,observe} from '../scripts/diagnostics/resident_save_observation_client.mjs';
function plan(){const root=path.resolve('offline-only');return {approvedForLaunch:true,targetProject:path.join(root,'never-open.project'),serverPath:path.join(root,'dist/server.js'),workingDirectory:root,registry:root,observationDirectory:path.join(root,'events'),clientDirectory:path.join(root,'client'),env:{INOPRO_DATA_DIR:root},newResidentIntentRequired:true,reuseOldIntent:false,expectedServerVersion:'0.41.1',expectedProjectSha256:'a'.repeat(64),expectedToolNames:Array.from({length:38},(_,i)=>'offline-'+i)};}
test('prepared diagnostic has no launch permission',()=>{const p=plan();p.approvedForLaunch=false;assert.throws(()=>checkPlan(p),/Prepared only/);});
test('different registry or reuse of old intent is rejected',()=>{for(const mutate of [p=>p.env.INOPRO_DATA_DIR+='other',p=>p.reuseOldIntent=true,p=>p.newResidentIntentRequired=false]){const p=plan();mutate(p);assert.throws(()=>checkPlan(p));}});
test('missing concrete target and incomplete tool inventory are rejected',()=>{for(const mutate of [p=>p.targetProject=null,p=>p.expectedToolNames.pop(),p=>p.expectedToolNames[0]=p.expectedToolNames[1]]){const p=plan();mutate(p);assert.throws(()=>checkPlan(p));}});
test('concrete plan validates metadata without launching anything',()=>assert.doesNotThrow(()=>checkPlan(plan())));
test('unapproved observe stops before creating client or observation output',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'save-probe-plan-'));const p=plan();p.approvedForLaunch=false;p.clientDirectory=path.join(root,'client');p.observationDirectory=path.join(root,'events');const file=path.join(root,'plan.json');await fs.writeFile(file,JSON.stringify(p));await assert.rejects(observe(file),/Prepared only/);assert.deepEqual((await fs.readdir(root)).sort(),['plan.json']);});

const packageData=version=>Buffer.from(JSON.stringify({version}));
const packageManifest=(p,bytes)=>({fixed:p.workingDirectory,files:[{path:'package.json',sha256:createHash('sha256').update(bytes).digest('hex')}]});
test('fixed planned version matches package, manifest and connection without starting a service',()=>{
 const p=plan(),bytes=packageData('0.41.1');checkFixedVersion(p,packageManifest(p,bytes),bytes);checkConnection(p,{version:'0.41.1'},[...p.expectedToolNames].reverse());
});
test('missing or nonliteral expected version is refused',()=>{
 for(const v of [undefined,null,'','*','>=0.41.1','0.41']){const p=plan();p.expectedServerVersion=v;assert.throws(()=>checkPlan(p),/expected server version/);}
});
test('connection must match the exact planned version and complete tool names',()=>{
 const p=plan();for(const v of ['0.41.0','0.41.2',undefined])assert.throws(()=>checkConnection(p,{version:v},p.expectedToolNames),/version\/tools differ/);
 assert.throws(()=>checkConnection(p,{version:'0.41.1'},p.expectedToolNames.slice(1)),/version\/tools differ/);
});
test('package version cannot drift from the plan even with matching package digest',()=>{
 const p=plan(),bytes=packageData('0.41.0');assert.throws(()=>checkFixedVersion(p,packageManifest(p,bytes),bytes),/Fixed package/);
});
test('fixed package bytes and selection must remain bound to the manifest',()=>{
 const p=plan(),bytes=packageData('0.41.1');
 for(const edit of [m=>m.files=[],m=>m.files.push(m.files[0]),m=>m.files[0].sha256='0'.repeat(64),m=>m.fixed+='other']){
  const m=packageManifest(p,bytes);edit(m);assert.throws(()=>checkFixedVersion(p,m,bytes),/Fixed package/);
 }
 const other={...p,serverPath:path.join(p.workingDirectory,'other/server.js')};assert.throws(()=>checkFixedVersion(other,packageManifest(p,bytes),bytes),/Fixed package/);
});
