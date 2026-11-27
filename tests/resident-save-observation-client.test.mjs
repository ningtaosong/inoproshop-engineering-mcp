import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkPlan,observe} from '../scripts/diagnostics/resident_save_observation_client.mjs';
function plan(){const root=path.resolve('offline-only');return {approvedForLaunch:true,targetProject:path.join(root,'never-open.project'),serverPath:path.join(root,'never-start.mjs'),workingDirectory:root,registry:root,observationDirectory:path.join(root,'events'),clientDirectory:path.join(root,'client'),env:{INOPRO_DATA_DIR:root},newResidentIntentRequired:true,reuseOldIntent:false,expectedProjectSha256:'a'.repeat(64),expectedToolNames:Array.from({length:38},(_,i)=>'offline-'+i)};}
test('prepared diagnostic has no launch permission',()=>{const p=plan();p.approvedForLaunch=false;assert.throws(()=>checkPlan(p),/Prepared only/);});
test('different registry or reuse of old intent is rejected',()=>{for(const mutate of [p=>p.env.INOPRO_DATA_DIR+='other',p=>p.reuseOldIntent=true,p=>p.newResidentIntentRequired=false]){const p=plan();mutate(p);assert.throws(()=>checkPlan(p));}});
test('missing concrete target and incomplete tool inventory are rejected',()=>{for(const mutate of [p=>p.targetProject=null,p=>p.expectedToolNames.pop(),p=>p.expectedToolNames[0]=p.expectedToolNames[1]]){const p=plan();mutate(p);assert.throws(()=>checkPlan(p));}});
test('concrete plan validates metadata without launching anything',()=>assert.doesNotThrow(()=>checkPlan(plan())));
test('unapproved observe stops before creating client or observation output',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'save-probe-plan-'));const p=plan();p.approvedForLaunch=false;p.clientDirectory=path.join(root,'client');p.observationDirectory=path.join(root,'events');const file=path.join(root,'plan.json');await fs.writeFile(file,JSON.stringify(p));await assert.rejects(observe(file),/Prepared only/);assert.deepEqual((await fs.readdir(root)).sort(),['plan.json']);});
