import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setup,app,obj} from './helpers.mjs';
import {schemas} from '../dist/contracts.js';
import {planVariableEdit as plan} from '../dist/variable-edit.js';
import {EngineeringService} from '../dist/service.js';
import {FixtureAdapter} from '../dist/fixture-adapter.js';

const variants=[
 ['BOOL','TRUE','DINT','1'],['BOOL','FALSE','TIME','T#0ms'],
 ['DINT','5000','TIME','T#5s'],['DINT','-1','BOOL','TRUE'],
 ['TIME','T#8s','BOOL','FALSE'],['TIME','T#60000ms','DINT','60000']
];
const declarations=[
 ['st_pou','PROGRAM Demo'],['st_pou','FUNCTION Demo : BOOL'],
 ['function_block','FUNCTION_BLOCK Demo'],['gvl','']
];
const source=(header,typ,old)=>(header?header+'\n':'')+'VAR'+(header?'':'_GLOBAL')+
 '\n (* 😀 目标 : TIME := T#9s; *)\n Target : '+typ+' := '+old+'; // target note\n'+
 ' Other : BOOL := TRUE;\nEND_VAR';

test('set-type changes only type and explicit literal in supported POU and root GVL',()=>{
 for(const [kind,header] of declarations)for(const [oldType,oldValue,type,initializer] of variants){
  const original=source(header,oldType,oldValue);
  const result=plan(original,kind,'Demo',{action:'set-type',name:'Target',type,initializer,
   expectedOldType:oldType,expectedOldInitializer:oldValue});
  assert.equal(result.declaration,original.replace('Target : '+oldType+' := '+oldValue+';',
   'Target : '+type+' := '+initializer+';'));
  assert.equal(original.slice(result.typeRange.startOffset,result.typeRange.endOffset),oldType);
  assert.equal(original.slice(result.range.startOffset,result.range.endOffset),oldValue);
  assert.equal(result.beforeType,oldType);assert.equal(result.afterType,type);
 }
});

test('set-type rejects unsupported boundaries, old evidence and bad new literals',()=>{
 const base=source('PROGRAM Demo','DINT','5000');
 const edit={action:'set-type',name:'Target',type:'TIME',initializer:'T#5s',
  expectedOldType:'DINT',expectedOldInitializer:'5000'};
 const bad=[
  base.replace('5000','4999'),
  base.replace('Target : DINT := 5000','Target : DINT'),
  base.replace('Target : DINT','Target, Other2 : DINT'),
  base.replace('Target : DINT','Target AT %MW0 : DINT'),
  base.replace('VAR\n','VAR RETAIN\n'),
  base+'\nVAR RETAIN\nEND_VAR',
  base+'\nVAR\nEND_VAR',
  base.replace('END_VAR',''),
  base.replace('VAR\n','VAR_INPUT\n')
 ];
 for(const text of bad)assert.throws(()=>plan(text,'st_pou','Demo',edit),text);
 assert.throws(()=>plan(base,'st_pou','Demo',{...edit,expectedOldType:'BOOL'}),/old variable type/i);
 assert.throws(()=>plan(base,'st_pou','Demo',{...edit,expectedOldInitializer:'0'}),/old initializer/i);
 for(const value of ['5000','T#60001ms','T#5s; Evil : BOOL := TRUE','T#1.5s'])
  assert.throws(()=>plan(base,'st_pou','Demo',{...edit,initializer:value}),/literal/i);
 assert.throws(()=>plan(base,'st_pou','Demo',{...edit,section:'VAR_INPUT'}),/section|ordinary/i);
 assert.throws(()=>plan(base+'\nVAR_INPUT\n Target : BOOL := TRUE;\nEND_VAR','st_pou','Demo',edit),/ambiguous/i);
 const functionSource=source('FUNCTION Target : DINT','DINT','5000');
 assert.throws(()=>plan(functionSource,'st_pou','Target',edit),/ambiguous/i);
 const noOp=plan(base,'st_pou','Demo',{...edit,type:'DINT',initializer:'5000'});
 assert.equal(noOp.declaration,base);
 const lower=base.replace('Target : DINT','Target : dint');
 const lowerNoOp=plan(lower,'st_pou','Demo',{...edit,type:'DINT',initializer:'5000'});
 assert.equal(lowerNoOp.declaration,lower);
});

test('set-type schema requires both old values and rejects unrelated action fields',()=>{
 const common={requestId:randomUUID(),projectId:randomUUID(),applicationId:app,objectId:obj,
  expectedHash:'0'.repeat(64),expectedSnapshot:'0'.repeat(64),expectedDiskHash:'0'.repeat(64),
  action:'set-type',name:'Target',type:'TIME',initializer:'T#5s',
  expectedOldType:'DINT',expectedOldInitializer:'5000'};
 assert.equal(schemas.variable_edit.safeParse(common).success,true);
 for(const mutation of [{expectedOldType:undefined},{expectedOldInitializer:undefined},{type:undefined},
  {section:'VAR_INPUT'},{memberName:'Delay'},{typeObjectId:randomUUID()}])
  assert.equal(schemas.variable_edit.safeParse({...common,...mutation}).success,false,JSON.stringify(mutation));
 for(const action of ['add','set-initializer','set-member-initializer'])
  assert.equal(schemas.variable_edit.safeParse({...common,action}).success,false,action);
});

test('service rejects stale and invalid edits before change, then writes once and no-ops',async t=>{
 const declaration=source('PROGRAM Demo','DINT','5000');
 const e=await setup({objects:[{objectId:obj,applicationId:app,path:['设备','应用一','Demo'],
  objectType:'st_pou',nativeTypeId:'6f9dac99-8de1-4efc-8465-68ac443b7d08',
  pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header',
  hasImplementation:true,declaration,implementation:'// Target remains in text\n'}]});
 const adapter=new FixtureAdapter(),commands=[];
 const service=new EngineeringService({dataDir:e.dataDir,executable:'fixture',profile:'fixture',
  testMode:true,noUI:false,timeoutMs:1000,responseWaitMs:1000},
  {execute:(...args)=>{commands.push(args[0].command);return adapter.execute(...args)},reconcile:d=>adapter.reconcile(d)});
 t.after(()=>service.store.release());
 const call=async(name,args)=>{let r=await service.call(name,schemas[name].parse(args));
  while(r.status==='running')r=await service.call('operation_status',{operationId:r.operationId});return r;};
 const opened=await call('project_open_copy',{requestId:randomUUID(),sourcePath:e.source,applicationId:app});
 assert.equal(opened.status,'succeeded');
 const s=opened.data.session;
 const read=await call('object_read',{projectId:s.projectId,applicationId:app,objectId:obj});
 const common={projectId:s.projectId,applicationId:app,objectId:obj,expectedHash:read.data.contentHash,
  expectedSnapshot:s.snapshot,expectedDiskHash:s.diskHash,action:'set-type',name:'Target',
  type:'TIME',initializer:'T#5s',expectedOldType:'DINT',expectedOldInitializer:'5000'};
 const hash=async()=>createHash('sha256').update(await readFile(s.workingPath)).digest('hex');
 const initialHash=await hash(),start=commands.length;
 const rejected=await call('variable_edit',{...common,requestId:randomUUID(),initializer:'T#60001ms'});
 assert.equal(rejected.status,'unsupported',JSON.stringify(rejected));
 assert.equal(commands.slice(start).includes('change'),false);
 assert.equal(commands.slice(start).includes('save'),false);
 assert.equal(await hash(),initialHash);
 const stale=await call('variable_edit',{...common,requestId:randomUUID(),expectedOldType:'BOOL'});
 assert.equal(stale.status,'unsupported');assert.equal(await hash(),initialHash);
 const request={...common,requestId:randomUUID()};
 const first=await call('variable_edit',request);
 assert.equal(first.status,'succeeded',JSON.stringify(first));
 assert.match(first.data.declaration,/Target : TIME := T#5s;/);
 assert.equal(first.data.implementation,'// Target remains in text\n');
 assert.equal(first.data.editEvidence.beforeType,'DINT');
 assert.equal(first.data.editEvidence.afterType,'TIME');
 const count=commands.length;
 assert.deepEqual(await call('variable_edit',request),first);
 assert.equal(commands.length,count);
 const noOp=await call('variable_edit',{...common,requestId:randomUUID(),
  expectedHash:first.data.contentHash,expectedSnapshot:first.data.snapshot,
  expectedDiskHash:first.data.diskHash,type:'TIME',expectedOldType:'TIME',expectedOldInitializer:'T#5s'});
 assert.equal(noOp.status,'succeeded');assert.equal(noOp.data.noOp,true);
 assert.equal(commands.slice(count).includes('change'),false);
 assert.equal(commands.slice(count).includes('save'),false);
 assert.equal(JSON.parse(await readFile(s.workingPath)).objects[0].declaration,first.data.declaration);
});
