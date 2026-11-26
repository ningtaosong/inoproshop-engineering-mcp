import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {buildConservation,buildSourceVersion,verifyResidentBuild,COMPILER_LIBRARY_ARTIFACTS} from '../dist/resident-build.js';
import {residentHash as hash,residentDependencies as deps} from '../dist/resident.js';
const archive=JSON.parse(await fs.readFile(new URL('./fixtures/resident-build-library-native.json',import.meta.url),'utf8'));
const aid=archive.before.state.applications[0],mid='5d558397-776b-478d-ab91-fa36aca5d60a',oid='76817b8e-cf3d-4b51-82a0-fb6e8bc7c778';
// Loaded assembly return is a substitute; historical native snapshots remain unaltered.
const support=()=>({scheme:'resident-compiler-library-support-v1',assemblies:Object.entries(COMPILER_LIBRARY_ARTIFACTS).sort().map(([name,sha256])=>({name,sha256,version:'1.9.1.6',path:name+'.dll'}))});
const refs=f=>f.after.state.nodes[mid].directLibraries;
const check=(f,s=support(),app=aid)=>buildConservation(f.before.state,f.after.state,f['build-context-before'],f.after.buildContext,app,s);
test('archived 17 to 18 reference delta passes only precise proof; historical unknown unchanged',()=>{
 const f=structuredClone(archive),p=check(f);assert.equal(p.directLibrariesUnchanged,false);assert.equal(p.originalDirectLibrariesUnchanged,true);assert.deepEqual(p.compilerAddedDirectLibraries[0].reference,refs(f).at(-1));assert.equal(p.compilerAddedDirectLibraries[0].index,17);assert.deepEqual(f,archive);assert.equal(f.origin.status,'unknown');
});
test('already present, unchanged dependency keeps old no-addition proof',()=>{const f=structuredClone(archive);f.before=structuredClone(f.after);f['build-context-before']=f.after.buildContext;const p=check(f,null);assert.equal(p.directLibrariesUnchanged,true);assert.equal(p.compilerAddedDirectLibraries,undefined);});
const mutations={
 'extra-reference':f=>refs(f).push(structuredClone(refs(f).at(-1))),
 'removed-original':f=>refs(f).shift(),
 'reordered-original':f=>refs(f).splice(0,2,...refs(f).slice(0,2).reverse()),
 'original-namespace':f=>refs(f)[0].namespace='changed',
 'original-unknown-field':f=>refs(f)[0].extra=null,
 'wrong-name':f=>refs(f).at(-1).name='#OtherSystemLibrary',
 'wrong-version':f=>refs(f).at(-1).effective_resolution='IecVarAccess, 9.0.0.0 (System)',
 'wrong-default':f=>refs(f).at(-1).default_resolution='wrong',
 'redirection-empty-text':f=>refs(f).at(-1).explicit_redirection='',
 'redirection-flag':f=>refs(f).at(-1).is_redirected=true,
 'system-flag-type':f=>refs(f).at(-1).system_library=1,
 'wrong-resolver':f=>refs(f).at(-1).resolver_guid=oid,
 'missing-field':f=>delete refs(f).at(-1).namespace,
 'unknown-field':f=>refs(f).at(-1).extra=false,
 'duplicate-id':f=>refs(f).at(-1).id=refs(f)[0].id,
 'null-id':f=>refs(f).at(-1).id=null,
 'manager-application':f=>f.after.state.nodes[mid].applicationId=oid,
 'manager-path':f=>f.after.state.nodes[mid].path.push('wrong'),
 'source-change':f=>f.after.state.nodes[oid].implementation='changed',
 'source-language':f=>f.after.state.nodes[oid].embeddedObjectTypes=[],
 'application-list':f=>f.after.state.applications.push(oid),
 'task-calls':f=>Object.values(f.after.state.nodes).find(r=>r.calls).calls.push(['Other','']),
 'device-version':f=>Object.values(f.after.buildContext.devices)[0].identity.version='other',
 'coverage-gap':f=>delete f.after.buildContext.children[mid],
};
for(const [name,mutate]of Object.entries(mutations))test('reject '+name,()=>{const f=structuredClone(archive);mutate(f);assert.throws(()=>check(f));});
for(const mutate of [s=>s.assemblies=[],s=>s.assemblies.push(s.assemblies[0]),s=>s.assemblies[0].version='1.9.1.7',s=>s.assemblies[0].sha256='0'.repeat(64),s=>s.assemblies[0].path='',s=>s.extra=true])test('missing/wrong implementation evidence rejects',()=>{const s=support();mutate(s);assert.throws(()=>check(archive,s));});
test('missing support or foreign build Application rejects',()=>{assert.throws(()=>check(archive,null));assert.throws(()=>check(archive,support(),oid));});

async function serviceFixture(t){
 const f=structuredClone(archive),directory=await fs.mkdtemp(path.join(os.tmpdir(),'resident-lib-proof-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const version=hash({dependencies:deps(f.before.state),diskHash:f.before.diskHash});
 const request={operationId:'offline-service',requestId:'offline-service',args:{applicationId:aid,expectedResidentVersion:version}},s=support(),proof=check(f,s),sourceVersion=buildSourceVersion(f.before.state,aid),compiler=f['compiler-result'];
 const rows={
 'build-context-before':f['build-context-before'],checkpoint:{request,state:f.before.state,diskHash:f.before.diskHash,residentVersion:version},
 predispatch:{...f.before,buildContext:f['build-context-before']},after:f.after,verification:proof,
 dispatch:{operationId:request.operationId,requestId:request.requestId,action:'build-application',applicationId:aid,inputResidentVersion:version,sourceVersion},
 'compiler-result':compiler,'diagnostics-cleared':{categories:compiler.categories.map(x=>x.category)},'build-call':{applicationId:aid},'build-returned':{applicationId:aid},
 'build-after-state':{state:f.after.state,diskHash:f.after.diskHash},'build-input':{...f.before,buildContext:f['build-context-before']},
 'compiler-library-support-before':s,'compiler-library-support-after':s};
 const data={buildConservation:proof,builtSourceVersion:sourceVersion,buildInputResidentVersion:version,buildEvidenceScope:'resident-memory',persistedToProject:false,persistedToWorkingCopy:false,compilerResultHash:hash(compiler),targetKind:'application',completed:true,diagnosticsComplete:true,diagnostics:compiler.diagnostics,errorCount:0,warningCount:0,buildPassed:true};
 const write=async()=>{for(const [name,value]of Object.entries(rows))await fs.writeFile(path.join(directory,name+'.json'),JSON.stringify(value));};
 return {f,rows,data,write,verify:()=>verifyResidentBuild(request,data,directory,f.before,version)};
}
test('service independent verifier accepts bound native delta and actual after state',async t=>{const f=await serviceFixture(t);await f.write();assert.deepEqual(await f.verify(),f.f.after.state);assert.notEqual(hash(deps(f.f.before.state)),hash(deps(f.f.after.state)));});
for(const [name,mutate]of Object.entries(mutations))test('service distrusts producer success for '+name,async t=>{const f=await serviceFixture(t);mutate(f.f);await f.write();await assert.rejects(f.verify());});
for(const fault of ['support-missing','support-changed','lying-unchanged','wrong-app','disk','diagnostics','stale-input','publication-gap'])test('service proof binding rejects '+fault,async t=>{
 const f=await serviceFixture(t);
 if(fault==='support-missing')delete f.rows['compiler-library-support-before'];
 if(fault==='support-changed')f.rows['compiler-library-support-after']={...support(),extra:true};
 if(fault==='lying-unchanged')f.data.buildConservation={...f.data.buildConservation,directLibrariesUnchanged:true};
 if(fault==='wrong-app')f.rows.dispatch.applicationId=oid;
 if(fault==='disk')f.rows.after.diskHash='0'.repeat(64);
 if(fault==='diagnostics')f.rows['compiler-result'].diagnosticsComplete=false;
 if(fault==='stale-input')f.rows['build-input'].state=structuredClone(f.f.after.state);
 if(fault==='publication-gap')delete f.rows.verification;
 await f.write();await assert.rejects(f.verify());
});
