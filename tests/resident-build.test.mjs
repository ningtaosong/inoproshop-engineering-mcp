import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {buildConservation,checkedDiagnostics,buildStateView} from '../dist/resident-build.js';
const native=JSON.parse(await readFile(new URL('./fixtures/resident-build-derived-native.json',import.meta.url),'utf8'));
const derived='04d1db87-e030-46c5-9073-df66a1b4f522',root='bae96937-5e0e-48a6-8b2a-2ca00576a271';
test('historical native tree permits only evidenced compiler-generated device, raw evidence unchanged',()=>{
 const copy=structuredClone(native);assert.deepEqual(buildConservation(native.before.state,native.after.state,native.before.context,native.after.context).addedDeviceIds,[derived]);assert.deepEqual(native,copy);
});
const cases={
 'wrong-parent':(s,c)=>s.nodes[derived].parentId=null,
 'wrong-description':(s,c)=>c.devices[derived].identity.version='wrong',
 'wrong-kind':(s,c)=>s.nodes[derived].nativeTypeId=s.nodes[root].objectId,
 'wrong-connector-role':(s,c)=>c.devices[derived].connectors[0].role='Parent',
 'wrong-host':(s,c)=>c.devices[derived].connectors[0].hostPath=0,
 'extra-connector':(s,c)=>c.devices[derived].connectors.push({...c.devices[derived].connectors[0]}),
 'siblings-reordered':(s,c)=>c.children[root].reverse(),
 'duplicate-node':(s,c)=>c.children[root].push(derived),
 'missing-device':(s,c)=>delete c.devices[root],
 'existing-unknown-field':(s,c)=>s.nodes[root].extra=true,
 'extra-context-field':(s,c)=>c.extra=true,
 'extra-node':(s,c)=>s.nodes['10000000-0000-4000-8000-000000000001']={...s.nodes[derived],objectId:'10000000-0000-4000-8000-000000000001'},
 'extra-subtree':(s,c)=>c.children[derived].push(root),
 'device-removed':(s,c)=>delete s.nodes[root],
 'foreign-project':(s,c)=>s.openedProjects['9']={handle:9,path:'other.project',primary:false,library:false},
};
for(const [name,change]of Object.entries(cases))test('compiler preservation rejects '+name,()=>{const b=structuredClone(native.after);change(b.state,b.context);assert.throws(()=>buildConservation(native.before.state,b.state,native.before.context,b.context));});
test('background native library may appear, existing owned project must remain',()=>{const a=structuredClone(native.before.state),b=structuredClone(a);b.openedProjects['9']={handle:9,path:'some.library',primary:false,library:true};assert.deepEqual(buildStateView(a),buildStateView(b));b.openedProjects['0'].primary=false;assert.throws(()=>buildStateView(b));});
const diag={applicationId:root,completed:true,diagnosticsComplete:true,categories:[{category:'compiler',count:1,endObserved:true}],diagnostics:[{severity:'error',text:'compile failed',category:'compiler'}]};
test('complete compiler errors are not invocation failures',()=>assert.deepEqual(checkedDiagnostics(diag,root),{errorCount:1,warningCount:0,buildPassed:false}));
for(const mutate of [d=>d.completed=false,d=>d.diagnosticsComplete=false,d=>d.categories=[],d=>d.categories[0].count=0,d=>d.categories[0].endObserved=false,d=>d.categories.push(d.categories[0]),d=>d.diagnostics[0].severity='unknown',d=>d.diagnostics[0].text=null,d=>d.applicationId=derived])test('diagnostic coverage failure cannot pass',()=>{const d=structuredClone(diag);mutate(d);assert.throws(()=>checkedDiagnostics(d,root));});
