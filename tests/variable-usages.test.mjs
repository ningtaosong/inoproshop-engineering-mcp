import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {app,obj,setup,connect} from './helpers.mjs';
import {schemas} from '../dist/contracts.js';
import {codeHash} from '../dist/storage.js';
import {variableUsagesResult} from '../dist/variable-usages.js';

// Independent expectations from the S7 native probe at fba075e. Its project
// file and diagnostic scripts stay out of the product tests.
const probe=JSON.parse(await readFile(new URL('./fixtures/s7-probe-declarations.json',import.meta.url),'utf8'));
const prefix=['设备','应用一'];
const gvlId='20000000-0000-4000-8000-000000000030';
const structId='20000000-0000-4000-8000-000000000090';
const ids=[obj,gvlId,structId];
const fixture=(sources=probe.fixture,order=Object.keys(sources))=>order.map(name=>{
  const row=sources[name],i=Object.keys(sources).indexOf(name);
  return {objectId:ids[i],applicationId:app,path:[...prefix,name],objectType:row.kind,
    ...(row.kind==='st_pou'?{pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header'}:{}),
    declaration:row.declaration,implementation:row.implementation};
});

async function context(t,objects=fixture()) {
  const fixtureFile=await setup({objects});
  const client=await connect(fixtureFile.dataDir);t.after(()=>client.client.close());
  const opened=await client.done(await client.call('project_open',{requestId:'s7a-direct-fixture',projectPath:fixtureFile.source,applicationId:app}));
  assert.equal(opened.status,'succeeded',JSON.stringify(opened));
  const target={projectId:opened.data.session.projectId,applicationId:app};
  const lookup=async(objectId,name)=>{
    const result=await client.done(await client.call('variable_inspect',{...target,objectId,name}));
    assert.equal(result.status,'succeeded',JSON.stringify(result));
    const rows=result.data.entries.filter(r=>r.objectId===objectId&&r.name?.toLowerCase()===name.toLowerCase());
    assert.equal(rows.length,1);
    const {section,contentHash,namePosition}=rows[0];
    return {objectId,name:rows[0].name,section,contentHash,startOffset:namePosition.startOffset,endOffset:namePosition.endOffset};
  };
  const usage=(declaration,options={})=>client.call('variable_usages',{...target,declaration,...options}).then(client.done);
  return {...fixtureFile,client,target,lookup,usage};
}
const at=(rows)=>rows.map(r=>[r.path.at(-1),r.position.line,r.position.column,r.matchedText,r.rule]);

test('S7 source positions bind the exact local declaration, GVL and type field separately',async t=>{
  const ctx=await context(t);
  const before=await readFile(ctx.source);
  const list=(await ctx.client.client.listTools()).tools;
  assert.equal(list.length,35);assert.equal(list.find(tool=>tool.name==='variable_usages').annotations.readOnlyHint,true);
  const expected=[
    {target:obj,scope:'VAR',rule:'program-local',name:'PLC_PRG.DelayTime'},
    {target:gvlId,scope:'VAR_GLOBAL',rule:'explicit-root-gvl',name:'GVL_Config.DelayTime'},
    {target:structId,scope:'STRUCT',rule:'direct-structure-field',name:'ST_S7Config.DelayTime'}
  ];
  for(const {target,scope,rule,name} of expected) {
    const declaration=await ctx.lookup(target,'DelayTime');
    const response=await ctx.usage(declaration);
    assert.equal(response.status,'succeeded',JSON.stringify(response));
    const data=response.data;
    assert.equal(data.basis,'bounded-st-static-inference');
    assert.equal(data.targetDeclaration.objectId,target);
    assert.equal(data.targetDeclaration.section,scope);
    assert.equal(data.targetDeclaration.namePosition.startOffset,declaration.startOffset);
    assert.equal(data.targetDeclaration.contentHash,declaration.contentHash);
    assert.deepEqual(at(data.usages),probe.expected.filter(row=>row.staticExpected==='inferred'&&row.expected.split('（')[0]===name)
      .map(row=>[row.object,row.line,row.column,row.expression.split('.').at(-1),rule]));
    assert.deepEqual(at(data.unknown),[['PLC_PRG',5,20,'DelayTime',undefined]]);
    assert(data.coverage.exclusions.some(s=>s.includes('可视化')));
  }
  const empty=await ctx.usage(await ctx.lookup(obj,'NeverUsed'));
  assert.equal(empty.data.conclusion,'not-found-in-read-and-supported-scope');
  assert(empty.summary.includes('在已读且受支持的范围内未发现'));
  assert.deepEqual(await readFile(ctx.source),before);
});

test('renamed source, CRLF and reordered objects bind at their new positions',async t=>{
  const sources={
    DriveCycle:{kind:'st_pou',declaration:'PROGRAM DriveCycle\r\nVAR\r\n Hold : INT;\r\n Probe : Settings;\r\n Output : INT;\r\nEND_VAR',
      implementation:'// Hold\r\n\r\nOutput := Plant.hOLD;\r\nOutput := Probe.Hold;\r\n  hoLD := 8;\r\nOutput := HOLD;'},
    Plant:{kind:'gvl',declaration:'VAR_GLOBAL\r\n    Hold : INT;\r\nEND_VAR',implementation:''},
    Settings:{kind:'structure',declaration:'TYPE Settings :\r\nSTRUCT\r\n    Hold : INT;\r\nEND_STRUCT\r\nEND_TYPE',implementation:''}
  };
  const ctx=await context(t,fixture(sources,['Settings','DriveCycle','Plant']));
  const expectations=[
    [obj,[['DriveCycle',5,3,'hoLD','program-local'],['DriveCycle',6,11,'HOLD','program-local']]],
    [gvlId,[['DriveCycle',3,17,'hOLD','explicit-root-gvl']]],
    [structId,[['DriveCycle',4,17,'Hold','direct-structure-field']]]
  ];
  for(const [id,positions] of expectations){
    const declaration=await ctx.lookup(id,'Hold');
    const result=await ctx.usage(declaration);
    assert.equal(result.status,'succeeded',JSON.stringify(result));
    assert.deepEqual(at(result.data.usages),positions);assert.deepEqual(result.data.unknown,[]);
    assert.equal(result.data.targetDeclaration.objectId,id);
    assert.equal(result.data.targetDeclaration.namePosition.startOffset,declaration.startOffset);
  }
});

test('qualifier ambiguity and unsupported operands remain unknown at their own locations',async t=>{
  const modified=fixture();
  modified[0].declaration=modified[0].declaration.replace('END_VAR','    GVL_Config : ST_S7Config;\nEND_VAR');
  modified[0].implementation+='\nSeen := SomeCall(DelayTime);\nSeen := Config.Nested.DelayTime;\nSeen := DelayTime';
  const ctx=await context(t,modified);
  const gvl=await ctx.usage(await ctx.lookup(gvlId,'DelayTime'));
  assert.equal(gvl.status,'succeeded',JSON.stringify(gvl));
  assert.equal(gvl.data.targetDeclaration.objectId,gvlId);
  assert.deepEqual(gvl.data.usages,[]);
  assert.deepEqual(at(gvl.data.unknown),[
    ['PLC_PRG',3,20,'DelayTime',undefined],['PLC_PRG',5,20,'DelayTime',undefined],
    ['PLC_PRG',9,18,'DelayTime',undefined],['PLC_PRG',10,23,'DelayTime',undefined],['PLC_PRG',11,9,'DelayTime',undefined]
  ]);
  const local=await ctx.usage(await ctx.lookup(obj,'DelayTime'));
  assert.deepEqual(at(local.data.usages),[['PLC_PRG',1,1,'DelayTime','program-local'],['PLC_PRG',2,9,'dElAyTiMe','program-local']]);
  assert(local.data.coverage.gapCount>0);
});

test('page version binds the same declaration and protects old locations',async t=>{
  const ctx=await context(t);
  const declaration=await ctx.lookup(obj,'DelayTime');
  const first=await ctx.usage(declaration,{limit:1});
  assert.deepEqual(at(first.data.usages),[['PLC_PRG',1,1,'DelayTime','program-local']]);
  const otherDeclaration=await ctx.lookup(gvlId,'DelayTime');
  const different=await ctx.usage(otherDeclaration,{offset:1,expectedVersion:first.data.version});
  assert.equal(different.error.code,'USAGES_VERSION_CHANGED');
  const second=await ctx.usage(declaration,{offset:first.data.page.nextOffset,expectedVersion:first.data.version,limit:1});
  assert.deepEqual(at(second.data.usages),[['PLC_PRG',2,9,'dElAyTiMe','program-local']]);
  assert.equal(second.data.version,first.data.version);
  const third=await ctx.usage(declaration,{offset:second.data.page.nextOffset,expectedVersion:first.data.version,limit:1});
  assert.deepEqual(at(third.data.unknown),[['PLC_PRG',5,20,'DelayTime',undefined]]);assert.equal(third.data.page.nextOffset,null);
  for(const change of [{startOffset:declaration.startOffset+1},{contentHash:'a'.repeat(64)},{section:'VAR_GLOBAL'}]) {
    const stale=await ctx.usage({...declaration,...change});
    assert.equal(stale.error.code,'USAGE_DECLARATION_CHANGED');
  }
  assert(!schemas.variable_usages.safeParse({...ctx.target,declaration,offset:1}).success);
  // An external edit must not be smuggled into the earlier page sequence.
  const source=JSON.parse(await readFile(ctx.source,'utf8'));source.objects[0].implementation+='\nDelayTime := 9;';
  await writeFile(ctx.source,JSON.stringify(source));
  const after=await ctx.usage(declaration,{offset:1,expectedVersion:first.data.version});
  assert.equal(after.status,'conflict');
});

function fixtureInventory() {
  const objects=fixture().map(o=>({...o,hasImplementation:o.objectType==='st_pou',contentHash:codeHash(o.declaration,o.implementation)}));
  const diskHash='a'.repeat(64);
  return {status:'succeeded',operationId:obj,data:{projectId:obj,applicationId:app,targetKind:'application',projectPath:'x',diskHash,
    readOnlyEvidence:{beforeDiskHash:diskHash,afterCloseDiskHash:diskHash,postExitDiskHash:diskHash,unchanged:true},corpus:objects,
    scope:{applicationPath:prefix,description:'fixture',readObjects:3,eligibleObjects:3,treeComplete:true,coverageComplete:true,skippedObjects:[],enumerationFailures:[],readFailures:[]}}};
}

function fixtureQuery(raw,objectId,section) {
  const object=raw.data.corpus.find(o=>o.objectId===objectId);
  const name='DelayTime',startOffset=object.declaration.indexOf(name);
  return {projectId:obj,applicationId:app,declaration:{objectId,name,section,
    startOffset,endOffset:startOffset+name.length,contentHash:object.contentHash},offset:0,limit:1};
}

test('a new source snapshot invalidates pages even if the selected declaration is unchanged',()=>{
  const raw=fixtureInventory();
  const args=fixtureQuery(raw,obj,'VAR');
  const original=variableUsagesResult(raw,args);
  const objects=raw.data.corpus;
  objects[1].declaration=objects[1].declaration.replace('DINT','INT');
  objects[1].contentHash=codeHash(objects[1].declaration,'');
  assert.throws(()=>variableUsagesResult(raw,{...args,offset:1,expectedVersion:original.data.version}),
    error=>error.code==='USAGES_VERSION_CHANGED');
});

test('losing native PROGRAM evidence rejects the previous GVL usage page',()=>{
  const raw=fixtureInventory(),args=fixtureQuery(raw,gvlId,'VAR_GLOBAL');
  const first=variableUsagesResult(raw,args).data;
  assert.deepEqual(at(first.usages),[['PLC_PRG',3,20,'DelayTime','explicit-root-gvl']]);
  assert.deepEqual([first.page.totalUsages,first.page.totalUnknown],[1,1]);
  const next={...args,offset:first.page.nextOffset,expectedVersion:first.version};
  for(const fields of [['pouType'],['pouTypeSource'],['pouType','pouTypeSource']]) {
    const changed=structuredClone(raw);
    for(const field of fields)delete changed.data.corpus[0][field];
    assert.throws(()=>variableUsagesResult(changed,next),{status:'conflict',code:'USAGES_VERSION_CHANGED',message:/重新首查/});
    const fresh=variableUsagesResult(changed,args).data;
    assert.equal(fresh.sourceSnapshot,first.sourceSnapshot);
    assert.notEqual(fresh.version,first.version);
    assert.deepEqual([fresh.page.totalUsages,fresh.page.totalUnknown],[0,5]);
  }
});

test('losing PROGRAM evidence on the selected local declaration rejects its previous page',()=>{
  const raw=fixtureInventory(),args=fixtureQuery(raw,obj,'VAR');
  const first=variableUsagesResult(raw,args).data;
  delete raw.data.corpus[0].pouTypeSource;
  assert.throws(()=>variableUsagesResult(raw,{...args,offset:first.page.nextOffset,expectedVersion:first.version}),
    {status:'conflict',code:'USAGES_VERSION_CHANGED'});
});

test('identical evidence pages the GVL usage and unknown in order',()=>{
  const raw=fixtureInventory(),args=fixtureQuery(raw,gvlId,'VAR_GLOBAL');
  const first=variableUsagesResult(raw,args).data;
  assert.deepEqual(at(first.usages),[['PLC_PRG',3,20,'DelayTime','explicit-root-gvl']]);
  assert.deepEqual(first.unknown,[]);
  assert.equal(first.page.nextOffset,1);
  const second=variableUsagesResult(raw,{...args,declaration:{...args.declaration,name:'dELAYtIME'},
    offset:first.page.nextOffset,expectedVersion:first.version}).data;
  assert.equal(second.version,first.version);
  assert.deepEqual(second.usages,[]);
  assert.deepEqual(at(second.unknown),[['PLC_PRG',5,20,'DelayTime',undefined]]);
  assert.deepEqual([second.page.totalUsages,second.page.totalUnknown],[1,1]);
  assert.equal(second.page.nextOffset,null);
  assert.equal(second.page.hasMore,false);
});

test('object enumeration order does not affect usage pages or their version',()=>{
  const raw=fixtureInventory(),args=fixtureQuery(raw,gvlId,'VAR_GLOBAL');
  const first=variableUsagesResult(raw,args).data;
  const next={...args,offset:first.page.nextOffset,expectedVersion:first.version};
  const second=variableUsagesResult(raw,next).data;
  raw.data.corpus.reverse();
  assert.deepEqual(variableUsagesResult(raw,args).data,first);
  assert.deepEqual(variableUsagesResult(raw,next).data,second);
});
