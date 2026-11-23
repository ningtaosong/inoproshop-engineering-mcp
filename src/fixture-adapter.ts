// 仅供显式 INOPRO_TEST_MODE=fixture 的契约测试。它不解析真实工程、不编译 ST。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {fixtureOrganization,fixtureOrganize} from './fixture-organization.js';
import {fixturePlaceholderClear} from './fixture-placeholder-clear.js';
import { type Adapter, type BridgeRequest } from './adapter.js';
import { reply, DomainError, pouDeclarationMatches, declarationMatches,methodDeclarationMatches,propertyHeader,getterDeclarationMatches, type Reply } from './contracts.js';
import {propertyEvidence,PROPERTY_NATIVE,ACCESSOR_NATIVE} from './properties.js';
import { atomicJson, readJson, codeHash, digest, canonical, normalize } from './storage.js';
import {taskCallInventoryView,taskCreateInventoryView,taskConfigurationVersion,validateTaskPatch,configuredIntervalMs,isTaskAppendCall,validReplacement,TASK_CREATE_ST_IMPLEMENTATION_TYPE} from './task-config.js';
import {catalogVersion,libraryConfigurationVersion,placeholderConfigurationVersion,LIB_CATALOG_SCHEME,LIB_CONFIG_SCHEME,LIB_PLACEHOLDER_SCHEME} from './libraries.js';

import {isMemberInitializerAction,applyMemberInitializerInsertion,initializerTargetEvidence} from './variable-edit.js';

export class FixtureAdapter implements Adapter {
  async reconcile(directory:string) { return readJson(path.join(directory,'result.json')); }
  async execute(req:BridgeRequest, dir:string, onStart:(pid:number)=>Promise<void>):Promise<Reply> {
    await fs.mkdir(dir,{recursive:true}); await atomicJson(path.join(dir,'request.json'),req);
    if(req.command==='new_project') {
      const aid=randomUUID(),pid=randomUUID(),tid=randomUUID(),appPath=['Device','Plc Logic','Application'];
      const declaration='PROGRAM PLC_PRG\nVAR\nEND_VAR',implementation='',objectId=randomUUID();
      const prg={objectId,applicationId:aid,path:[...appPath,'PLC_PRG'],objectType:'st_pou',pouType:'program',pouTypeSource:'native-pou-type-id-and-declaration-header',hasImplementation:true,
        nativeTypeId:'6f9dac99-8de1-4efc-8465-68ac443b7d08',declaration,implementation,contentHash:codeHash(declaration,implementation)};
      const applications=[{applicationId:aid,path:appPath}],task={applicationId:aid,taskId:tid,path:[...appPath,'Task Configuration','MainTask'],
        rawFields:{kind_of_task:'Cyclic',interval:'t#20ms',priority:'1',interval_unit:'ms',core_binding:'-2',event:'',external_event:'',parent_synchron_task:'',event_pou_guid:randomUUID()},watchdog:{enabled:'False',time:'',time_unit:'ms',sensitivity:'1'},unavailableFields:[],rawCalls:[['PLC_PRG','']],callsComplete:true};
      const p={testFixture:true,applications,objects:[prg],tasks:[task]};
      await fs.writeFile(req.projectPath,JSON.stringify(p),{flag:'wx'});
      const diskHash=digest(await fs.readFile(req.projectPath)),snapshot=digest(canonical([prg]));
      const result={...reply('succeeded','Fixture-only native new-project substitute',{projectPath:req.projectPath,editMode:'direct',applications,snapshot,diskHash,postExitDiskHashObserved:true,
        created:true,testMode:true,creationEvidence:{preset:'am610-minimal-v1',publishedExclusively:true,reopened:true,noBusinessCopy:true,savedDiskHash:diskHash,
          applicationId:aid,device:{type:4102,id:'10f4 0002',version:'3.5.11.11'},deviceObjectId:pid,plcPrg:prg,
          task:{objectId:tid,kind:'Cyclic',interval:'t#20ms',calls:[['PLC_PRG','']]}}}),operationId:req.operationId};
      await atomicJson(path.join(dir,'result.json'),result);return result;
    }
    if(req.command==='catalog') {
      const values=['Fixture Mathematics, 1.0.0 (Fixture Vendor)','Fixture Vendor','Fixture Mathematics','1.0.0','FMATH','fixture://installed/FixtureMath.library'];
      const entries=[{identity:digest(JSON.stringify(values)),displayName:values[0],company:values[1],title:values[2],version:values[3],defaultNamespace:values[4],repositoryFile:values[5]}];
      const data={identityScheme:LIB_CATALOG_SCHEME,entries,repositories:[],failures:[],enumerationComplete:true,total:entries.length};
      const result={...reply('succeeded','Fixture-only installed catalog',{...data,catalogVersion:catalogVersion(data)}),operationId:req.operationId};
      await atomicJson(path.join(dir,'result.json'),result);return result;
    }
    const p=await readJson(req.projectPath);
    if(!p?.testFixture) throw new DomainError('failed','FIXTURE_ONLY','测试模式只接受显式 testFixture JSON');
    if(p.delayMs) await new Promise(r=>setTimeout(r,p.delayMs));
    if(req.fileGuard && digest(await fs.readFile(req.projectPath))!==req.fileGuard.expectedDiskHash)
      throw new DomainError('conflict','PROJECT_FILE_CHANGED','夹具派发后文件变化');
    const a=req.args;
    const propertyShape=(prop:any)=>{const accessors=p.objects.filter((o:any)=>o.parentId===prop.objectId).map((o:any)=>({objectId:o.objectId,parentId:prop.objectId,nativeTypeId:o.nativeTypeId,name:o.path.at(-1),hasDeclaration:true,hasImplementation:o.hasImplementation,embeddedObjectTypes:o.embeddedObjectTypes??['3b83b776-fb25-43b8-99f2-3c507c9143fc'],childIds:p.objects.filter((c:any)=>c.parentId===o.objectId).map((c:any)=>c.objectId).sort()})).sort((a:any,b:any)=>a.objectId.localeCompare(b.objectId));const rw=accessors.length===2&&new Set(accessors.map((a:any)=>a.name)).size===2&&accessors.some((a:any)=>a.name==='Get')&&accessors.some((a:any)=>a.name==='Set');return {scheme:rw?'fb-property-accessors-v2':'fb-property-accessors-v1',propertyId:prop.objectId,accessors,readOnly:accessors.length===1&&accessors[0].name==='Get'};};
    const supported=(o:any)=>!o.objectType || ['st_pou','function_block'].includes(o.objectType) || ['property','property_get','property_set'].includes(o.objectType)&&propertyEvidence({...o,contentHash:codeHash(o.declaration,o.implementation)})&&p.objects.some((fb:any)=>fb.objectId===o.fbId&&fb.applicationId===o.applicationId&&/^\s*FUNCTION_BLOCK\s+[A-Za-z_][A-Za-z0-9_]*\s*(?=VAR(?:_INPUT|_OUTPUT|_IN_OUT)?\b|$)/i.test(fb.declaration))&&p.objects.some((prop:any)=>prop.objectId===o.propertyId&&prop.parentId===o.fbId&&prop.applicationId===o.applicationId&&canonical(propertyShape(prop))===canonical(o.accessorStructure)) || o.objectType==='method'&&o.language==='ST'&&methodDeclarationMatches(o.path.at(-1),o.declaration,o.methodReturnType,o.access)&&p.objects.some((x:any)=>x.objectId===o.parentId&&x.applicationId===o.applicationId&&/^\s*FUNCTION_BLOCK\b/.test(x.declaration)&&canonical(x.path)===canonical(o.parentPath)) || (['gvl','structure','enum','array'].includes(o.objectType) &&
      (!['enum','array'].includes(o.objectType)||declarationMatches(o.objectType,o.path.at(-1),o.declaration)) && o.path.length===(p.applications.find((x:any)=>x.applicationId===o.applicationId)?.path.length ?? -2)+1);
    const objects=p.objects.filter((o:any)=>o.applicationId===a.applicationId && supported(o));
    const snapshot=()=>digest(canonical(p.objects.map((o:any)=>({...o,declaration:normalize(o.declaration),implementation:normalize(o.implementation)}))));
    let result!:Reply;
    const object=objects.find((o:any)=>o.objectId===a.objectId);
    const taskInventory=()=>({projectId:a.projectId,applicationId:a.applicationId,targetKind:'application',projectPath:req.projectPath,
      applicationPath:p.applications.find((x:any)=>x.applicationId===a.applicationId)?.path||[],
      tasks:(p.tasks||[]).filter((t:any)=>t.applicationId===a.applicationId).map(({applicationId,...t}:any)=>structuredClone(t)),
      programs:objects.filter((o:any)=>!o.queryReadError&&/^\s*PROGRAM\b/i.test(o.declaration)).map((o:any)=>({objectId:o.objectId,path:o.path})),
      resolutionReadFailures:[],enumerationFailures:p.treeReadError?[{path:[],stage:'enumeration',reason:p.treeReadError}]:[],coverageComplete:!p.treeReadError});
    const libraryInventory=()=>{
      const managers=(p.libraryManagers || []).filter((m:any)=>m.applicationId===a.applicationId).map(({applicationId,references,...m}:any)=>({...m,enumerationComplete:true,capturedReferences:0}));
      const references:any[]=[];let truncated=false;
      for(const m of managers){const original=p.libraryManagers.find((x:any)=>x.managerId===m.managerId&&x.applicationId===a.applicationId);
        for(const r of original.references){if(references.length>=a.maxReferences){truncated=true;m.enumerationComplete=false;break;}references.push({...structuredClone(r),index:references.length});m.capturedReferences++;}
        if(original.enumerationError){m.enumerationComplete=false;m.unavailableFields.push({field:'references',reason:original.enumerationError});}
      }
      const failures=p.treeReadError?[{path:[],stage:'enumeration',reason:p.treeReadError}]:[];
      const data:any={projectId:a.projectId,applicationId:a.applicationId,targetKind:'application',projectPath:req.projectPath,
        applicationPath:p.applications.find((x:any)=>x.applicationId===a.applicationId).path,managers,references,
        scope:{description:'Fixture direct references; not installed repository or transitive dependencies',maxReferences:a.maxReferences,capturedReferences:references.length,truncated,
          enumerationComplete:!failures.length&&!truncated&&managers.every((m:any)=>m.enumerationComplete),fieldReadComplete:!managers.some((m:any)=>m.unavailableFields.length)&&!references.some(r=>r.unavailableFields.length),enumerationFailures:failures},
        unavailableMetadata:['Independent version/vendor getters not verified'],limitations:['No recursive dependencies; installed state not queried'],
        referenceVersionScheme:LIB_CONFIG_SCHEME,placeholderVersionScheme:LIB_PLACEHOLDER_SCHEME};
      data.configurationVersion=libraryConfigurationVersion(data);
      data.placeholderConfigurationVersion=placeholderConfigurationVersion(data);return data;
    };
    if(['create_folder','move_object'].includes(req.command))result=await fixtureOrganize(p,req,dir,snapshot,taskInventory);
    else if(req.command==='task_update') {
      validateTaskPatch(a);const before=taskInventory(),version=taskConfigurationVersion(before),rows=before.tasks.filter((t:any)=>t.taskId===a.taskId);
      if(version!==a.expectedTaskVersion)result={...reply('conflict','任务配置版本已变'),error:{code:'TASK_VERSION_CHANGED',message:'not written'}};
      else if(digest(await fs.readFile(req.projectPath))!==a.expectedDiskHash)result={...reply('conflict','任务磁盘版本已变'),error:{code:'TASK_DISK_CHANGED',message:'not written'}};
      else if(rows.length!==1)result={...reply('conflict','任务身份不唯一'),error:{code:'TASK_NOT_UNIQUE',message:'not written'}};
      else if(before.enumerationFailures.length||before.tasks.some((t:any)=>t.unavailableFields.length||!t.callsComplete))result={...reply('unsupported','字段不完整'),error:{code:'TASK_CONFIGURATION_INCOMPLETE',message:'not written'}};
      else if(rows[0].rawFields.kind_of_task!=='Cyclic')result={...reply('unsupported','非周期任务'),error:{code:'TASK_NOT_CYCLIC',message:'not written'}};
      else if(p.taskReadOnly)result={...reply('unsupported','只读工程'),error:{code:'TASK_PROJECT_READ_ONLY',message:'not written'}};
      else if(configuredIntervalMs(rows[0].rawFields)===undefined||!/^\d+$/.test(rows[0].rawFields.priority))result={...reply('unsupported','单位未知'),error:{code:'TASK_UNITS_UNCONFIRMED',message:'not written'}};
      else {
        const task=p.tasks.find((t:any)=>t.applicationId===a.applicationId&&t.taskId===a.taskId),actions:any[]=[];
        for(const [field,value,changed] of [['interval','t#'+a.intervalMs+'ms',a.intervalMs!==undefined&&configuredIntervalMs(task.rawFields)!==a.intervalMs],['priority',String(a.priority),a.priority!==undefined&&Number(task.rawFields.priority)!==a.priority]] as any[])if(changed)actions.push({field,nativeValue:value,status:'succeeded',readback:value});
        if(actions.length){await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));await atomicJson(path.join(dir,'task-before.json'),before);}
        for(const action of actions){task.rawFields[action.field]=action.nativeValue;if(p.failTaskField===action.field)break;}
        if(actions.length)await atomicJson(req.projectPath,p);
        const after=taskInventory(),version=taskConfigurationVersion(after);
        const evidence={projectId:a.projectId,applicationId:a.applicationId,taskId:a.taskId,before,after,changed:actions.length>0,noOp:actions.length===0,
          snapshot:snapshot(),configurationVersion:version,taskConfigurationVersion:version,configurationVersionScheme:'task-configuration-v1',actions,reopened:actions.length>0,
          ...(actions.length?{checkpoint:path.join(dir,'checkpoint.project'),persistedToWorkingCopy:true}:{}),testMode:true};
        result=p.failTaskField||p.failTaskLifecycle?{...reply('unknown','任务部分写入或保存重开失败，保留现场',{...evidence,...(p.failTaskLifecycle?{failedStage:p.failTaskLifecycle}:{}),automaticRollback:false}),error:{code:'TASK_WRITE_INCOMPLETE',message:'Injected failure'}}:reply('succeeded','任务配置替身读回',evidence);
        if(p.wrongTaskReadback)after.tasks[0].rawFields.core_binding='tampered';
      }
    }
    else if(req.command==='task_call_replace'){
      const before=taskInventory(),oldSnapshot=snapshot(),configPath=[...before.applicationPath,'Task Configuration'];
      const task=p.tasks.find((t:any)=>t.applicationId===a.applicationId&&t.taskId===a.taskId);
      const inspectProgram=(project:any,id:string,hash:string)=>{
        const found=project.objects.filter((o:any)=>o.objectId===id&&o.applicationId===a.applicationId);
        const o=found[0],types=o?.embeddedObjectTypes;
        if(found.length!==1||o.pouType!=='program'||o.pouTypeSource!=='native-pou-type-id-and-declaration-header'||
          o.nativeTypeId!=='6f9dac99-8de1-4efc-8465-68ac443b7d08'||canonical(o.path.slice(0,-1))!==canonical(before.applicationPath)||
          o.embeddedObjectTypesError||!Array.isArray(types)||!types.every((type:unknown)=>typeof type==='string')||
          !types.some((type:string)=>type.toLowerCase()===TASK_CREATE_ST_IMPLEMENTATION_TYPE)||
          codeHash(o.declaration,o.implementation)!==hash||
          project.objects.filter((x:any)=>x.applicationId===a.applicationId&&x.nativeTypeId===o.nativeTypeId&&
            x.path.at(-1).toLowerCase()===o.path.at(-1).toLowerCase()).length!==1)throw Error('PROGRAM identity, source or ST marker inconsistent');
        return {program:{objectId:id,applicationId:a.applicationId,path:o.path,contentHash:hash},types:types.map((v:string)=>v.toLowerCase()).sort()};
      };
      const identify=(project:any)=>{
        const old=inspectProgram(project,a.oldProgramId,a.expectedOldProgramHash),next=inspectProgram(project,a.programId,a.expectedProgramHash);
        return {oldProgram:old.program,program:next.program,oldProgramEmbeddedObjectTypes:old.types,programEmbeddedObjectTypes:next.types,
          taskConfigurationPath:configPath,controller:{type:4102,id:'10f4 0002',version:'3.5.11.11'}};
      };
      let dispatched=false;
      const checkpoint=path.join(dir,'checkpoint.project');
      try{
        const facts=identify(p);
        if(p.taskReadOnly||p.taskConfigurationId!==a.taskConfigurationId||canonical(task?.path.slice(0,-1))!==canonical(configPath)||
          taskConfigurationVersion(before)!==a.expectedTaskVersion||oldSnapshot!==a.expectedSourceSnapshot||
          digest(await fs.readFile(req.projectPath))!==a.expectedDiskHash||!taskCallInventoryView(before)||!validReplacement(before,a,facts.oldProgram,facts.program))
          throw Error('Task, selected call or disk version inconsistent');
        const raw=[facts.program.path.at(-1),a.expectedCall[1]],order=a.expectedCallOrder;
        const replacedCall={order,raw,previousRaw:a.expectedCall,oldProgramId:a.oldProgramId,programId:a.programId};
        const common={...facts,before,projectId:a.projectId,applicationId:a.applicationId,taskId:a.taskId,
          taskConfigurationId:a.taskConfigurationId,replacedCall,checkpoint,snapshot:oldSnapshot,configurationOnly:true,runtimeObserved:false,
          configurationVersionScheme:'task-configuration-v1'};
        await fs.copyFile(req.projectPath,checkpoint);await atomicJson(path.join(dir,'task-before.json'),common);
        await atomicJson(path.join(dir,'task-replace-dispatched.json'),replacedCall);dispatched=true;
        task.rawCalls[order]=raw;
        if(p.failTaskReplace==='name'||p.failTaskReplace==='comment')throw Error('Injected native '+p.failTaskReplace+' setter failure');
        const afterReplace=taskInventory(),immediate=identify(p);
        if(p.failTaskReplace==='readback')throw Error('Injected binding readback failure');
        await atomicJson(req.projectPath,p);
        const reopened=await readJson(req.projectPath),reopenedFacts=identify(reopened);
        if(p.failTaskReplace==='reopen'||canonical(reopened)!==canonical(p))throw Error('Reopened binding differs');
        const after=taskInventory(),version=taskConfigurationVersion(after),disk=digest(await fs.readFile(req.projectPath));
        result=reply('succeeded','夹具替换并读回',{...common,afterReplace,after,programReads:{afterReplace:immediate,reopened:reopenedFacts},
          reopened:true,persistedToWorkingCopy:true,configurationVersion:version,taskConfigurationVersion:version,
          savedDiskHash:disk,workerDiskHash:disk,postExitDiskHashObserved:true});
      }catch(error){
        const message=String(error);
        result={...reply(dispatched?'unknown':'conflict',message,{primaryException:{message},automaticRollback:false,...(dispatched?{checkpoint}:{})}),
          error:{code:dispatched?'TASK_REPLACE_INCOMPLETE':'TASK_REPLACE_PREFLIGHT',message}};
      }
    }
    else if(req.command==='task_call_append') {
      const before=taskInventory(),taskConfigurationPath=[...before.applicationPath,'Task Configuration'];
      const completeCalls=(inventory:typeof before)=>!!taskCallInventoryView(inventory);
      const readback=(stage:'afterAppend'|'reopen')=>{
        const inventory=taskInventory();
        if(p.nullTaskAppendCommentAt===stage)inventory.tasks.find((t:any)=>t.taskId===a.taskId).rawCalls[0][1]=null;
        return inventory;
      };
      const selected=before.tasks.filter((t:any)=>t.taskId===a.taskId),row=selected[0];
      const target=objects.find((o:any)=>o.objectId===a.programId),name=target?.path.at(-1);
      const program=target&&{objectId:target.objectId,applicationId:target.applicationId,path:target.path,contentHash:codeHash(target.declaration,target.implementation)};
      const programEmbeddedObjectTypes=Array.isArray(target?.embeddedObjectTypes)?
        target.embeddedObjectTypes.map((v:string)=>v.toLowerCase()).sort():[];
      const reject=(status:'conflict'|'unsupported',code:string)=>({...reply(status,'Fixture rejected append before writing'),error:{code,message:'Fixture preflight rejected'}});
      if(digest(await fs.readFile(req.projectPath))!==a.expectedDiskHash)result=reject('conflict','TASK_DISK_CHANGED');
      else if(!completeCalls(before))result=reject('conflict','TASK_APPEND_IDENTITY_OR_COVERAGE');
      else if(taskConfigurationVersion(before)!==a.expectedTaskVersion)result=reject('conflict','TASK_VERSION_CHANGED');
      else if(!before.coverageComplete||selected.length!==1||p.taskConfigurationId!==a.taskConfigurationId||
        before.tasks.some((t:any)=>!t.callsComplete||t.unavailableFields.length||
          canonical(t.path.slice(0,-1))!==canonical(taskConfigurationPath))||
        !program||program.contentHash!==a.expectedProgramHash||canonical(target.path.slice(0,-1))!==canonical(before.applicationPath)||
        target.embeddedObjectTypesError||!programEmbeddedObjectTypes.includes(TASK_CREATE_ST_IMPLEMENTATION_TYPE)||
        canonical(before.programs.filter((item:any)=>item.path.at(-1).toLowerCase()===name?.toLowerCase()))!==
          canonical([{objectId:a.programId,path:target.path}])||
        row.rawCalls.some(([v]:string[])=>!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v)))
        result=reject('conflict','TASK_APPEND_IDENTITY_OR_COVERAGE');
      else if(row.rawFields.kind_of_task!=='Cyclic')result=reject('unsupported','TASK_NOT_CYCLIC');
      else if(row.rawCalls.some(([v]:string[])=>v.split('.').at(-1)?.toLowerCase()===name.toLowerCase()))
        result=reject('conflict','TASK_CALL_EXISTS');
      else if(p.taskReadOnly)result=reject('unsupported','TASK_PROJECT_READ_ONLY');
      else {
        const checkpoint=path.join(dir,'checkpoint.project'),snapshotBefore=snapshot();
        const appendedCall={order:row.rawCalls.length,programId:a.programId,raw:[name,'']};
        const facts={projectId:a.projectId,applicationId:a.applicationId,taskId:a.taskId,taskConfigurationId:a.taskConfigurationId,
          taskConfigurationPath,controller:{type:4102,id:'10f4 0002',version:'3.5.11.11'},program,programEmbeddedObjectTypes,
          snapshot:snapshotBefore,before,checkpoint,configurationOnly:true,runtimeObserved:false,configurationVersionScheme:'task-configuration-v1',testMode:true};
        await fs.copyFile(req.projectPath,checkpoint);
        await atomicJson(path.join(dir,'task-before.json'),facts);
        await atomicJson(path.join(dir,'task-append-dispatched.json'),{...appendedCall,taskId:a.taskId});
        p.tasks.find((t:any)=>t.applicationId===a.applicationId&&t.taskId===a.taskId).rawCalls.push(appendedCall.raw);
        const afterAppend=readback('afterAppend');
        const uncertain=(message:string,partial=afterAppend)=>({...reply('unknown',message,{...facts,partial,
          primaryException:{message},automaticRollback:false}),error:{code:'TASK_APPEND_INCOMPLETE',message}});
        if(p.failTaskCallAppend)result=uncertain('Injected append error');
        else if(!completeCalls(afterAppend))result=uncertain('Invalid call record after append');
        else {
          await atomicJson(req.projectPath,p);
          const disk=digest(await fs.readFile(req.projectPath)),after=readback('reopen'),version=taskConfigurationVersion(after);
          result=p.failTaskAppendReopen?uncertain('Injected append reopen error',after):
            !completeCalls(after)?uncertain('Invalid call record after reopen',after):
            reply('succeeded','任务末尾追加替身读回',{...facts,afterAppend,after,appendedCall,reopened:true,persistedToWorkingCopy:true,
              configurationVersion:version,taskConfigurationVersion:version,savedDiskHash:disk,workerDiskHash:disk,postExitDiskHashObserved:true});
        }
      }
    }
    else if(req.command==='task_create') {
      const before=taskInventory(),configPath=[...before.applicationPath,'Task Configuration'];
      const reject=(status:'conflict'|'unsupported',code:string)=>({...reply(status,'Fixture refused task creation before writing'),error:{code,message:'Fixture preflight rejected'}});
      const target=objects.find((o:any)=>o.objectId===a.programId);
      const name=target?.path.at(-1);
      const program=target&&{objectId:target.objectId,applicationId:target.applicationId,path:target.path,contentHash:codeHash(target.declaration,target.implementation)};
      const programEmbeddedObjectTypes=Array.isArray(target?.embeddedObjectTypes)?
        target.embeddedObjectTypes.map((entry:string)=>entry.toLowerCase()).sort():[];
      if(digest(await fs.readFile(req.projectPath))!==a.expectedDiskHash)result=reject('conflict','TASK_DISK_CHANGED');
      else if(taskConfigurationVersion(before)!==a.expectedTaskVersion)result=reject('conflict','TASK_VERSION_CHANGED');
      else if(before.tasks.some((t:any)=>t.path.at(-1).toLowerCase()===a.name.toLowerCase()))result=reject('conflict','TASK_NAME_EXISTS');
      else if(p.taskReadOnly)result=reject('unsupported','TASK_PROJECT_READ_ONLY');
      else if(!before.tasks.some((t:any)=>t.rawFields.kind_of_task==='Cyclic'))result=reject('unsupported','TASK_CREATE_NATIVE_API');
      else if(!taskCreateInventoryView(before)||before.tasks.some((t:any)=>!t.callsComplete||t.unavailableFields.length||
          canonical(t.path.slice(0,-1))!==canonical(configPath))||p.taskConfigurationId!==a.taskConfigurationId||
          !program||program.contentHash!==a.expectedProgramHash||canonical(target.path.slice(0,-1))!==canonical(before.applicationPath)||
          canonical(before.programs.filter((row:any)=>row.path.at(-1).toLowerCase()===name?.toLowerCase()))!==
            canonical([{objectId:a.programId,path:target.path}]))result=reject('conflict','TASK_CREATE_IDENTITY_OR_COVERAGE');
      else if(target.embeddedObjectTypesError||!programEmbeddedObjectTypes.includes(TASK_CREATE_ST_IMPLEMENTATION_TYPE)) {
        const message=target.embeddedObjectTypesError||'目标 PROGRAM 缺少原生 ST 实现标识';
        result={...reply('conflict',message,{primaryException:{message}}),error:{code:'TASK_CREATE_IDENTITY_OR_COVERAGE',message}};
      }
      else {
        const checkpoint=path.join(dir,'checkpoint.project'),taskId=randomUUID();
        await fs.copyFile(req.projectPath,checkpoint);
        const actions=[{stage:'create',status:'succeeded'},{stage:'period',status:'succeeded'},
          {stage:'bind',status:p.failNewTaskBinding?'started':'succeeded'}];
        const base=before.tasks.find((t:any)=>t.rawFields.kind_of_task==='Cyclic');
        const task={...structuredClone(base),taskId,path:[...configPath,a.name],
          rawFields:{...base.rawFields,interval:'t#'+a.intervalMs+'ms'},rawCalls:p.failNewTaskBinding?[]:[[name,'']]};
        const common={taskId,projectId:a.projectId,applicationId:a.applicationId,taskConfigurationId:a.taskConfigurationId,
          intervalMs:a.intervalMs,taskConfigurationPath:configPath,controller:{type:4102,id:'10f4 0002',version:'3.5.11.11'},
          program,programEmbeddedObjectTypes,actions,checkpoint,before,snapshot:snapshot(),configurationOnly:true,runtimeObserved:false,
          configurationVersionScheme:'task-configuration-v1',testMode:true};
        await atomicJson(path.join(dir,'task-before.json'),before);
        p.tasks.push({...task,applicationId:a.applicationId});
        const after=taskInventory(),version=taskConfigurationVersion(after);
        const uncertain=(message:string)=>({...reply('unknown',message,
          {...common,partial:after,primaryException:{message},automaticRollback:false}),
          error:{code:'TASK_CREATE_INCOMPLETE',message}});
        if(p.failNewTaskBinding)result=uncertain('Injected native bind error');
        else if(p.loseTaskProgramLanguageAfterBind)result=uncertain('目标 PROGRAM 缺少原生 ST 实现标识');
        else {
          await atomicJson(req.projectPath,p);
          const disk=digest(await fs.readFile(req.projectPath));
          if(p.taskCreateReopenOrder)after.tasks.reverse();
          result=p.taskProgramLanguageReopenError?uncertain(p.taskProgramLanguageReopenError):
            reply('succeeded','任务创建及绑定替身读回',{...common,after,task,
            calls:[{order:0,applicationId:a.applicationId,programId:a.programId,raw:[name,'']}],
            created:true,reopened:true,configurationVersion:version,taskConfigurationVersion:version,
            savedDiskHash:disk,workerDiskHash:disk,postExitDiskHashObserved:true,persistedToWorkingCopy:true});
        }
      }
    }
    else if(req.command==='inspect') result=reply('succeeded','测试工程副本已打开',{applications:p.applications,poolBuildAvailable:p.applications.length===0&&p.objects.length>0,projectPath:req.projectPath,snapshot:snapshot(),testMode:true});
    else if(req.command==='libraries') {
      result=reply('succeeded','库引用替身，非真实 IDE',libraryInventory());
      if(p.readMutatesFile)await fs.appendFile(req.projectPath,' ');
      const after=digest(await fs.readFile(req.projectPath));
      result.data!.readOnlyEvidence={beforeDiskHash:a.readDiskHash,afterCloseDiskHash:after,postExitDiskHash:after,unchanged:after===a.readDiskHash};
      if(after!==a.readDiskHash)result={...reply('unknown','测试只读工程文件变化',{priorResult:result}),error:{code:'READ_ONLY_FILE_CHANGED',message:'File changed'}};
    }
    else if(req.command==='clear_placeholder')result=await fixturePlaceholderClear(p,req,dir,libraryInventory,snapshot);
    else if(req.command==='resolve_placeholder') {
      const before=libraryInventory(),values=['Fixture Mathematics, 1.0.0 (Fixture Vendor)','Fixture Vendor','Fixture Mathematics','1.0.0','FMATH','fixture://installed/FixtureMath.library'];
      const identity=digest(JSON.stringify(values)),manager=p.libraryManagers?.find((m:any)=>m.applicationId===a.applicationId&&m.managerId===a.managerId);
      const old=before.references.filter((r:any)=>r.managerId===a.managerId&&r.rawFields.id===a.placeholderReferenceId);
      if(!manager||before.configurationVersion!==a.expectedReferenceVersion||before.placeholderConfigurationVersion!==a.expectedPlaceholderVersion||
        !before.scope.enumerationComplete||!before.scope.fieldReadComplete||old.length!==1||
        old[0].rawFields.is_placeholder!==true||old[0].rawFields.system_library!==false||
        old[0].rawFields.explicit_redirection!==a.expectedExplicitRedirection||a.installedIdentity!==identity||
        old[0].rawFields.namespace!=='FMATH')
        result={...reply('conflict','Fixture placeholder evidence mismatch'),error:{code:'PLACEHOLDER_REFERENCE_EVIDENCE',message:'not written'}};
      else {
        const changed=old[0].rawFields.explicit_redirection!==values[0];
        if(changed){
          await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));
          const target=manager.references.find((r:any)=>r.rawFields.id===a.placeholderReferenceId);
          target.rawFields.explicit_redirection=values[0];target.rawFields.is_redirected=true;
          target.rawFields.effective_resolution=values[0];target.rawFields.resolution_info='Native application override';
          target.resolutionStatus='effective-resolution-reported';
          await atomicJson(req.projectPath,p);
        }
        const after=libraryInventory(),next=after.references.find((r:any)=>r.rawFields.id===a.placeholderReferenceId);
        if(changed&&p.placeholderEvidenceFault){
          if(p.placeholderEvidenceFault==='reopen-enumeration'){
            after.scope.enumerationComplete=false;after.scope.enumerationFailures.push({stage:'enumeration',reason:'Injected failure'});
          }else if(p.placeholderEvidenceFault==='reopen-field'){
            next.unavailableFields.push({field:'explicit_redirection',reason:'Injected getter failure'});
            after.scope.fieldReadComplete=false;
          }else if(p.placeholderEvidenceFault==='reopen-truncated'){
            after.scope.truncated=true;after.scope.enumerationComplete=false;
          }else if(p.placeholderEvidenceFault==='reopen-missing'){
            delete next.rawFields.explicit_redirection;
          }
        }
        result=p.failPlaceholderResolve&&changed?{...reply('unknown','Fixture injected partial placeholder setting',{checkpoint:path.join(dir,'checkpoint.project')}),error:{code:'PARTIAL_PLACEHOLDER_RESOLVE',message:'No automatic recovery'}}:
          reply('succeeded','Fixture-only native placeholder override',{projectId:a.projectId,applicationId:a.applicationId,managerId:a.managerId,
            placeholderReferenceId:a.placeholderReferenceId,installedIdentity:identity,
            installed:{identity,displayName:values[0],company:values[1],title:values[2],version:values[3],defaultNamespace:values[4],repositoryFile:values[5]},
            catalogVersion:a.expectedCatalogVersion,before,after,targetBefore:old[0],targetAfter:next,
            beforePlaceholderVersion:before.placeholderConfigurationVersion,placeholderVersion:after.placeholderConfigurationVersion,
            changed,noOp:!changed,reopened:changed,
            ...(changed?{checkpoint:path.join(dir,'checkpoint.project'),persistedToWorkingCopy:true}:{}),snapshot:snapshot(),testMode:true});
      }
    }
    else if(req.command==='add_library') {
      const before=libraryInventory(),catalogValues=['Fixture Mathematics, 1.0.0 (Fixture Vendor)','Fixture Vendor','Fixture Mathematics','1.0.0','FMATH','fixture://installed/FixtureMath.library'];
      const identity=digest(JSON.stringify(catalogValues)),manager=p.libraryManagers?.find((m:any)=>m.applicationId===a.applicationId&&m.managerId===a.managerId);
      if(before.configurationVersion!==a.expectedReferenceVersion||!before.scope.enumerationComplete||!before.scope.fieldReadComplete||!manager)
        result={...reply('conflict','Fixture reference version or manager mismatch'),error:{code:'LIBRARY_REFERENCES_CHANGED',message:'not written'}};
      else if(a.installedIdentity!==identity||a.expectedNamespace!=='FMATH')
        result={...reply('conflict','Fixture installed identity mismatch'),error:{code:'INSTALLED_LIBRARY_AMBIGUOUS',message:'not written'}};
      else {
        const existing=before.references.find((r:any)=>r.rawFields.name===catalogValues[0]),changed=!existing;
        if(changed){
          await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));
          const order=manager.references.length,rawFields={id:String(order+1),name:catalogValues[0],namespace:'FMATH',is_placeholder:false,is_managed:true,system_library:false,optional:false,qualified_only:false};
          manager.references.push({index:order,parentIndex:null,managerId:a.managerId,managerPath:manager.path,order,path:[...manager.path,'references',String(order)],rawFields,unavailableFields:[],resolutionStatus:'unknown',resolutionBasis:'Native effective_resolution string only',installedStatus:'not-queried'});
          await atomicJson(req.projectPath,p);
        }
        const after=libraryInventory(),addedReference=after.references.find((r:any)=>r.rawFields.name===catalogValues[0]);
        // Deliberately false success evidence from a native bridge double.
        if(changed&&p.libraryAddEvidenceFault){
          switch(p.libraryAddEvidenceFault){
            case 'reopen-enumeration':
              after.scope.enumerationComplete=false;
              after.scope.enumerationFailures.push({path:[],stage:'enumeration',reason:'Injected post-reopen failure'});
              break;
            case 'reopen-truncated':after.scope.truncated=true;after.scope.enumerationComplete=false;break;
            case 'reopen-field':
              after.references[0].unavailableFields.push({field:'name',reason:'Injected native field failure'});
              after.scope.fieldReadComplete=false;break;
            case 'reopen-missing-field':delete after.references[0].rawFields.name;break;
            case 'reopen-contradiction':
              after.scope.enumerationFailures.push({path:[],stage:'enumeration',reason:'Contradicts true completion flag'});break;
            case 'reopen-missing-coverage':delete after.scope.enumerationComplete;break;
          }
          after.configurationVersion=libraryConfigurationVersion(after);
        }
        result=p.failLibraryAdd&&changed?{...reply('unknown','Fixture injected partial library add',{checkpoint:path.join(dir,'checkpoint.project'),writeStarted:true}),error:{code:'PARTIAL_LIBRARY_ADD',message:'Injected failure; no automatic recovery'}}:
          reply('succeeded','Fixture-only precise direct reference',{projectId:a.projectId,applicationId:a.applicationId,managerId:a.managerId,installedIdentity:identity,
            installed:{identity,displayName:catalogValues[0],company:catalogValues[1],title:catalogValues[2],version:catalogValues[3],defaultNamespace:'FMATH',repositoryFile:catalogValues[5]},
            ...(changed?{nativeBeforeSave:{displayName:catalogValues[0],company:catalogValues[1],title:catalogValues[2],version:catalogValues[3],defaultNamespace:'FMATH',repositoryFile:catalogValues[5]},
              nativeAfterReopen:{displayName:catalogValues[0],company:catalogValues[1],title:catalogValues[2],version:catalogValues[3],defaultNamespace:'FMATH',repositoryFile:catalogValues[5]}}:{}),
            addedReference,before,after,beforeReferenceVersion:before.configurationVersion,referenceVersion:after.configurationVersion,catalogVersion:a.expectedCatalogVersion,
            changed,noOp:!changed,reopened:changed,...(changed?{checkpoint:path.join(dir,'checkpoint.project'),persistedToWorkingCopy:true}:{}),snapshot:snapshot(),diskHash:digest(await fs.readFile(req.projectPath)),testMode:true});
      }
    }
    else if(['structure','device','io_mapping'].includes(req.command)) {
      const all=p.nativeNodes || [],cap=req.command==='structure'?a.maxNodes:20000,nodes=all.slice(0,cap);
      const treeScope={description:'fixture native tree, not real IDE',maxNodes:cap,capturedNodes:nodes.length,treeComplete:!p.treeReadError&&nodes.length===all.length,
        coverageComplete:!p.treeReadError&&nodes.length===all.length&&!nodes.some((n:any)=>n.unavailableFields.length),truncated:nodes.length<all.length,
        enumerationFailures:p.treeReadError?[{path:[],stage:'children-enumeration',reason:p.treeReadError}]:[]};
      if(req.command==='structure')result=reply('succeeded','测试原生结构替身',{projectId:a.projectId,projectPath:req.projectPath,nodes,scope:treeScope,identityLimitations:'fixture observed native GUIDs',organizationScheme:'application-organization-v1',organizationVersions:Object.fromEntries(p.applications.map((app:any)=>[app.applicationId,fixtureOrganization(p,app.applicationId,a.projectId).version]))});
      else if(req.command==='io_mapping'){
        result=p.ioInventory?reply('succeeded','测试通道清单',{...p.ioInventory,projectId:a.projectId,projectPath:req.projectPath}):
          {...reply('unsupported','测试夹具缺少 I/O 采集'),error:{code:'IO_DEVICE_SCOPE',message:'No fixture inventory'}};
      }
      else {
        const found=nodes.filter((n:any)=>n.objectId===a.deviceId);
        if(found.length!==1)result={...reply('conflict','测试设备目标不唯一'),error:{code:'DEVICE_ID_NOT_UNIQUE',message:'No unique native device'}};
        else if(found[0].isDevice!==true)result={...reply('unsupported','测试非设备目标'),error:{code:'NOT_DEVICE',message:'Not a confirmed device'}};
        else {
          const dev=(p.nativeDevices || []).find((d:any)=>d.device.objectId===a.deviceId);
          if(!dev)throw Error('Explicit fixture device inventory required');
          const parameters=dev.parameters.slice(0,a.maxParameters);
          result=reply('succeeded','测试离线设备信息替身',{...dev,projectId:a.projectId,projectPath:req.projectPath,parameters,
            scope:{...dev.scope,treeScope,maxParameters:a.maxParameters,capturedParameters:parameters.length,truncated:parameters.length<dev.parameters.length,
              parameterCoverageComplete:parameters.length===dev.parameters.length&&!dev.parameterReadFailures.length&&!parameters.some((p:any)=>p.unavailableFields.length)}});
        }
      }
      if(p.readMutatesFile)await fs.appendFile(req.projectPath,' ');
      const after=digest(await fs.readFile(req.projectPath));
      if(result.data)result.data.readOnlyEvidence={beforeDiskHash:a.readDiskHash,afterCloseDiskHash:after,postExitDiskHash:after,unchanged:after===a.readDiskHash};
      if(after!==a.readDiskHash)result={...reply('unknown','测试只读工程文件变化',{priorResult:result}),error:{code:'READ_ONLY_FILE_CHANGED',message:'File changed'}};
    }
    else if(req.command==='search'||req.command==='tasks'||req.command==='compare_capture') {
      const appPath=p.applications.find((x:any)=>x.applicationId===a.applicationId)?.path || [];
      const failures=objects.filter((o:any)=>o.queryReadError).map((o:any)=>({objectId:o.objectId,path:o.path,stage:'object-read',reason:o.queryReadError}));
      const enumerationFailures=p.treeReadError?[{path:appPath,stage:'enumeration',reason:p.treeReadError}]:[];
      let sourceInventory:any,taskInventory:any;
      if(req.command!=='tasks') {
        const native:Record<string,string>={property:PROPERTY_NATIVE,property_get:ACCESSOR_NATIVE,property_set:ACCESSOR_NATIVE,method:'f8a58466-d7f6-439f-bbb8-d4600e41d099',gvl:'ffbfa93a-b94d-45fc-a329-229860183b1d',structure:'2db5746d-d284-4425-9f7f-2663a34b0ebc',enum:'2db5746d-d284-4425-9f7f-2663a34b0ebc',array:'2db5746d-d284-4425-9f7f-2663a34b0ebc'};
        const corpus=objects.filter((o:any)=>!o.queryReadError).map((o:any)=>({...o,language:'ST',objectType:o.objectType || (/^FUNCTION_BLOCK\b/.test(o.declaration)?'function_block':'st_pou'),nativeTypeId:native[o.objectType] || '6f9dac99-8de1-4efc-8465-68ac443b7d08',hasImplementation:!['gvl','structure','enum','array','property'].includes(o.objectType),declaration:normalize(o.declaration),implementation:normalize(o.implementation),contentHash:codeHash(o.declaration,o.implementation)}));
        result=reply('succeeded','测试一次读取搜索范围',{projectId:a.projectId,applicationId:a.applicationId,targetKind:a.targetKind,projectPath:req.projectPath,corpus,
          scope:{description:'fixture supported ST only; not real IDE',applicationPath:appPath,treeComplete:!p.treeReadError,eligibleObjects:objects.length,readObjects:corpus.length,coverageComplete:!failures.length&&!enumerationFailures.length,
            skippedObjects:p.objects.filter((o:any)=>o.applicationId===a.applicationId&&!supported(o)).map((o:any)=>({objectId:o.objectId,path:o.path,stage:'unsupported-type',reason:'Fixture unsupported kind/location'})),readFailures:failures,enumerationFailures},testMode:true});
        const methods=p.objects.filter((o:any)=>o.applicationId===a.applicationId&&(o.objectType==='method'||o.nativeTypeId==='f8a58466-d7f6-439f-bbb8-d4600e41d099'));
        if(methods.length){const scope=result.data!.scope as any;scope.methodCoverageVersion='fb-methods-v1';const gaps=methods.filter((o:any)=>!supported(o)).map((o:any)=>({objectId:o.objectId,path:o.path,nativeTypeId:'f8a58466-d7f6-439f-bbb8-d4600e41d099',stage:'unsupported-method',reason:'Fixture unsupported Method header/parent'}));if(gaps.length){scope.unsupportedChildren=gaps;scope.coverageComplete=false;scope.skippedObjects=scope.skippedObjects.map((r:any)=>gaps.find((g:any)=>g.objectId===r.objectId)||r);}}
        const properties=p.objects.filter((o:any)=>o.applicationId===a.applicationId&&(['property','property_get','property_set','property_set'].includes(o.objectType)||[PROPERTY_NATIVE,ACCESSOR_NATIVE].includes(o.nativeTypeId)));
        if(properties.length){const scope=result.data!.scope as any;scope.propertyCoverageVersion='fb-properties-v2';const gaps=properties.filter((o:any)=>!supported(o)).map((o:any)=>({objectId:o.objectId,path:o.path,nativeTypeId:o.nativeTypeId,stage:'unsupported-property',reason:'Fixture unsupported Property/accessor structure'}));if(gaps.length){scope.unsupportedChildren=[...(scope.unsupportedChildren??[]),...gaps];scope.coverageComplete=false;scope.skippedObjects=scope.skippedObjects.map((r:any)=>gaps.find((g:any)=>g.objectId===r.objectId)||r);}}
        sourceInventory=result.data;
      }
      if(req.command!=='search') {
        const programs=objects.filter((o:any)=>!o.queryReadError&&/^\s*PROGRAM\b/i.test(o.declaration)).map((o:any)=>({objectId:o.objectId,path:o.path}));
        const tasks=(p.tasks || []).filter((t:any)=>t.applicationId===a.applicationId).map(({applicationId,...t}:any)=>t);
        result=reply('succeeded','测试任务配置替身',{projectId:a.projectId,applicationId:a.applicationId,targetKind:'application',projectPath:req.projectPath,applicationPath:appPath,tasks,programs,resolutionReadFailures:failures,enumerationFailures,
          coverageComplete:!enumerationFailures.length&&!failures.length&&!tasks.some((t:any)=>t.unavailableFields.length),testMode:true});
      }
      if(req.command==='compare_capture'){taskInventory=result!.data;result=reply('succeeded','测试单次读取源码和任务快照',{projectId:a.projectId,applicationId:a.applicationId,targetKind:'application',projectPath:req.projectPath,sourceInventory,taskInventory});}
      if(p.readMutatesFile)await fs.appendFile(req.projectPath,' ');
      const after=digest(await fs.readFile(req.projectPath));
      result!.data!.readOnlyEvidence={beforeDiskHash:a.readDiskHash,afterCloseDiskHash:after,postExitDiskHash:after,unchanged:after===a.readDiskHash};
      if(after!==a.readDiskHash)result={...reply('unknown','测试只读文件意外变化',{priorResult:result}),error:{code:'READ_ONLY_FILE_CHANGED',message:'测试注入文件变化，冻结'}};
    }
    else if(req.command==='list') result=reply('succeeded','测试对象列表',{objects:objects.slice(a.offset,a.offset+a.limit).map(({declaration,implementation,...o}:any)=>o),total:objects.length,complete:a.offset+a.limit>=objects.length,nextOffset:a.offset+a.limit<objects.length?a.offset+a.limit:null,testMode:true});
    else if(req.command==='read') {
      if(!object) throw new DomainError('failed','OBJECT_NOT_FOUND','未找到精确对象');
      const data={...object,contentHash:codeHash(object.declaration,object.implementation),testMode:true};
      if(a.initializerTarget){
        try {data.initializerTargetEvidence=fixtureInitializerTarget(object,p.applications,a.initializerSection,p.objects);}
        catch(e:any){return reply('unsupported',e.message);}
      }
      result=reply('succeeded','测试对象已读取',data);
    } else if(req.command==='create_method'){
      const parent=objects.find((o:any)=>o.objectId===a.parentId),beforeSnapshot=snapshot();
      if(!parent||!/^\s*FUNCTION_BLOCK\s+[A-Za-z_][A-Za-z0-9_]*\s*(?=VAR(?:_INPUT|_OUTPUT|_IN_OUT)?\b|$)/i.test(parent.declaration))result={...reply('unsupported','测试非FB父对象'),error:{code:'METHOD_PARENT_OR_PERMISSION',message:'Not exact user FB'}};
      else if(parent.readOnly||p.methodPermissionDenied)result={...reply('unsupported','测试只读/权限拒绝'),error:{code:'METHOD_PARENT_OR_PERMISSION',message:'Permission denied'}};
      else if(!methodDeclarationMatches(a.name,a.declaration,a.returnType,a.access))result={...reply('failed','测试Method声明不匹配'),error:{code:'INVALID_METHOD_DECLARATION',message:'Header mismatch'}};
      else if(a.expectedSnapshot!==beforeSnapshot||a.expectedParentHash!==codeHash(parent.declaration,parent.implementation))result={...reply('conflict','测试父/子版本过期'),error:{code:'METHOD_PARENT_VERSION_CHANGED',message:'Parent or children changed'}};
      else if(p.objects.some((o:any)=>o.parentId===a.parentId&&o.path.at(-1).toLowerCase()===a.name.toLowerCase()))result={...reply('conflict','测试同父重名'),error:{code:'METHOD_EXISTS',message:'No overwrite'}};
      else{
        const checkpoint=path.join(dir,'checkpoint.project');await fs.copyFile(req.projectPath,checkpoint);await atomicJson(path.join(dir,'before.json'),{parentId:a.parentId,parentHash:a.expectedParentHash,snapshot:beforeSnapshot,expectedAbsent:true});
        const created={objectId:randomUUID(),applicationId:a.applicationId,path:[...parent.path,a.name],parentId:a.parentId,parentPath:parent.path,objectType:'method',nativeTypeId:'f8a58466-d7f6-439f-bbb8-d4600e41d099',hasImplementation:true,language:'ST',access:'PUBLIC',methodReturnType:a.returnType,methodMetadataSource:'native-method-type-parent-and-declaration-header',declaration:normalize(a.declaration),implementation:normalize(a.implementation)};
        p.objects.push(created);await atomicJson(req.projectPath,p);
        const factory={factory:'create_method',arguments:[a.name,a.returnType==='void'?'':a.returnType,'cc393387-a21c-4f68-a3e3-84c36951965d'],objectId:created.objectId,parentId:a.parentId,nativeTypeId:created.nativeTypeId,defaultDeclaration:'METHOD '+a.name+(a.returnType==='DINT'?' : DINT':'')+'\nVAR_INPUT\nEND_VAR\n',defaultImplementation:'',embeddedObjectTypes:['3b83b776-fb25-43b8-99f2-3c507c9143fc']};await atomicJson(path.join(dir,'factory.json'),factory);
        result=p.failMethodSave||p.failMethodReopen||p.failMethodReadback?{...reply('unknown','测试Method保存/重开/读回不确定',{createdObjectId:created.objectId,checkpoint,actions:['native-method-factory-returned','declaration-replaced','implementation-replaced']}),error:{code:'PARTIAL_METHOD_CREATE',message:'Injected uncertainty, no rollback'}}:
          reply('succeeded','Method创建替身，非原生证据',{...created,name:a.name,created:true,beforeParentHash:a.expectedParentHash,beforeSnapshot,snapshot:snapshot(),checkpoint,contentHash:codeHash(created.declaration,created.implementation),persistedToWorkingCopy:true,reopened:true,creationMethod:'create_method(name, return_type, ImplementationLanguages.st)',factoryEvidence:factory});
      }
    } else if(req.command==='create_property'){
      const parent=objects.find((o:any)=>o.objectId===a.parentId),beforeSnapshot=snapshot(),h=propertyHeader(a.declaration,true);
      if(!parent||!/^\s*FUNCTION_BLOCK\s+[A-Za-z_][A-Za-z0-9_]*\s*(?=VAR(?:_INPUT|_OUTPUT|_IN_OUT)?\b|$)/i.test(parent.declaration)||parent.readOnly||p.propertyPermissionDenied)result={...reply('unsupported','替身属性父类型或权限拒绝'),error:{code:'PROPERTY_PARENT_OR_PERMISSION',message:'Not writable plain user FB'}};
      else if(!h||h.name.toLowerCase()!==a.name.toLowerCase()||(!getterDeclarationMatches(a.getDeclaration)||a.propertyMode==='read-write'&&!getterDeclarationMatches(a.setDeclaration)))result={...reply('failed','替身属性声明拒绝'),error:{code:'INVALID_PROPERTY_DECLARATION',message:'Header mismatch'}};
      else if(a.expectedSnapshot!==beforeSnapshot||a.expectedParentHash!==codeHash(parent.declaration,parent.implementation))result={...reply('conflict','替身属性版本冲突'),error:{code:'PROPERTY_PARENT_VERSION_CHANGED',message:'Parent/children changed'}};
      else if(p.objects.some((o:any)=>o.parentId===a.parentId&&o.path.at(-1).toLowerCase()===a.name.toLowerCase()))result={...reply('conflict','替身同父重名'),error:{code:'PROPERTY_EXISTS',message:'No overwrite'}};
      else{
        const checkpoint=path.join(dir,'checkpoint.project');await fs.copyFile(req.projectPath,checkpoint);await atomicJson(path.join(dir,'before.json'),{parentId:a.parentId,parentHash:a.expectedParentHash,snapshot:beforeSnapshot,expectedAbsent:true});
        const propertyId=randomUUID(),getId=randomUUID(),setId=randomUUID(),propertyPath=[...parent.path,a.name];
        const identity=(id:string,name:string)=>({objectId:id,parentId:propertyId,nativeTypeId:ACCESSOR_NATIVE,name,hasDeclaration:true,hasImplementation:true,embeddedObjectTypes:['3b83b776-fb25-43b8-99f2-3c507c9143fc'],childIds:[]});
        const writable=a.propertyMode==='read-write',structure={scheme:writable?'fb-property-accessors-v2':'fb-property-accessors-v1',propertyId,readOnly:!writable,accessors:[identity(getId,'Get'),...(writable?[identity(setId,'Set')]:[])].sort((a,b)=>a.objectId.localeCompare(b.objectId))};
        const meta={fbId:a.parentId,propertyId,propertyPath,propertyName:a.name,propertyType:'DINT',access:'PUBLIC',readOnly:!writable,accessorStructure:structure,accessorVersion:digest(canonical(structure)),propertyContentHash:codeHash(a.declaration,''),propertyMetadataSource:'native-property-accessor-tree-and-declaration'};
        const prop={...meta,objectId:propertyId,applicationId:a.applicationId,path:propertyPath,parentId:a.parentId,parentPath:parent.path,objectType:'property',nativeTypeId:PROPERTY_NATIVE,hasImplementation:false,language:'ST',declaration:normalize(a.declaration),implementation:'',contentHash:codeHash(a.declaration,'')};
        const getter={...meta,objectId:getId,applicationId:a.applicationId,path:[...propertyPath,'Get'],parentId:propertyId,parentPath:propertyPath,objectType:'property_get',nativeTypeId:ACCESSOR_NATIVE,hasImplementation:true,language:'ST',declaration:normalize(a.getDeclaration),implementation:normalize(a.getImplementation),contentHash:codeHash(a.getDeclaration,a.getImplementation)};
        const setter={...getter,objectId:setId,path:[...propertyPath,'Set'],objectType:'property_set',declaration:normalize(a.setDeclaration??''),implementation:normalize(a.setImplementation??''),contentHash:codeHash(a.setDeclaration??'',a.setImplementation??'')};
        const defaults=[identity(getId,'Get'),identity(setId,'Set')].sort((a,b)=>a.objectId.localeCompare(b.objectId));const before={...structure,readOnly:false,accessors:defaults};
        const factory={factory:'create_property',arguments:[a.name,'DINT','cc393387-a21c-4f68-a3e3-84c36951965d'],objectId:propertyId,parentId:a.parentId,nativeTypeId:PROPERTY_NATIVE,defaultDeclaration:'PROPERTY '+a.name+' : DINT',defaultAccessors:before};const cleanup={before,after:structure,removedSetId:writable?null:setId,removalStatus:writable?'retained':'confirmed-absent',defaults:defaults.map(identity=>({identity,declaration:'VAR\nEND_VAR\n',implementation:''}))};
        p.objects.push(prop,getter,...(writable?[setter]:[]));await atomicJson(req.projectPath,p);await atomicJson(path.join(dir,'factory.json'),factory);await atomicJson(path.join(dir,'accessor-cleanup.json'),cleanup);
        result=p.failPropertyStage?{...reply('unknown','替身属性部分创建/保存不确定，保留现场',{createdObjectId:propertyId,checkpoint,stage:p.failPropertyStage}),error:{code:'PARTIAL_PROPERTY_CREATE',message:'No rollback or recreation'}}:reply('succeeded','替身只读属性创建，非真实IDE',{...prop,name:a.name,created:true,getter,...(writable?{setter}:{}),beforeParentHash:a.expectedParentHash,beforeSnapshot,snapshot:snapshot(),checkpoint,persistedToWorkingCopy:true,reopened:true,creationMethod:writable?'create_property(name, DINT, ImplementationLanguages.st); retain native Get and Set':'create_property(name, DINT, ImplementationLanguages.st); remove only new empty default Set',factoryEvidence:factory,accessorCleanup:cleanup});
      }
    } else if(req.command==='create'||req.command==='create_declaration') {
      const kind=req.command==='create'?a.pouType:a.objectType,isPou=req.command==='create';
      const parent=p.applications.find((x:any)=>x.applicationId===a.applicationId);
      if(!parent || a.parentId!==a.applicationId) result={...reply('conflict','测试父节点不匹配'),error:{code:'PARENT_MISMATCH',message:'父节点不在选定 Application'}};
      else if(isPou?!pouDeclarationMatches(kind,a.name,a.declaration,a.returnType):!declarationMatches(kind,a.name,a.declaration,true)) result={...reply('failed','测试声明首部不一致'),error:{code:'INVALID_DECLARATION',message:'声明首部不一致'}};
      else if(snapshot()!==a.expectedSnapshot) result={...reply('conflict','测试快照已改变',{snapshot:snapshot()}),error:{code:'SNAPSHOT_CONFLICT',message:'创建前快照冲突'}};
      else {
        const collisions=p.objects.filter((o:any)=>o.objectType!=='method'&&(o.applicationId===a.applicationId||o.applicationId===null)&&o.path.at(-1).toLowerCase()===a.name.toLowerCase());
        if(collisions.length) result={...reply('conflict','测试同名对象存在',{collisions}),error:{code:'OBJECT_EXISTS',message:'不覆盖同名对象'}};
        else {
          const beforeSnapshot=snapshot(); const checkpoint=path.join(dir,'checkpoint.project');
          await fs.copyFile(req.projectPath,checkpoint);
          await atomicJson(path.join(dir,'before.json'),{expectedAbsent:true,parentId:a.parentId,name:a.name,snapshot:beforeSnapshot});
          const native:Record<string,string>={method:'f8a58466-d7f6-439f-bbb8-d4600e41d099',gvl:'ffbfa93a-b94d-45fc-a329-229860183b1d',structure:'2db5746d-d284-4425-9f7f-2663a34b0ebc',enum:'2db5746d-d284-4425-9f7f-2663a34b0ebc',array:'2db5746d-d284-4425-9f7f-2663a34b0ebc'};
          const created={objectId:randomUUID(),applicationId:a.applicationId,path:[...parent.path,a.name],language:'ST',objectType:isPou?(kind==='function_block'?kind:'st_pou'):kind,hasImplementation:isPou,nativeTypeId:native[kind] || '6f9dac99-8de1-4efc-8465-68ac443b7d08',
            ...(isPou?{pouType:kind,pouTypeSource:'native-pou-type-id-and-declaration-header',...(a.returnType?{returnType:a.returnType}:{})}:{}),declaration:normalize(a.declaration),implementation:''};
          p.objects.push(created);
          await atomicJson(path.join(dir,'created.json'),{objectId:created.objectId,parentId:a.parentId,name:a.name});
          if(p.failCreateImplementation) {
            const partial={...created}; if(!p.failCreateRecovery)p.objects.splice(p.objects.indexOf(created),1);
            await atomicJson(req.projectPath,p);
            result={...reply(p.failCreateRecovery?'unknown':'failed','测试部分创建失败',{createdObjectId:created.objectId,partialContent:partial,checkpoint,
              recovery:{status:p.failCreateRecovery?'unknown':'succeeded',...(p.failCreateRecovery?{}:{snapshot:beforeSnapshot,absentAfterReopen:true,removedObjectId:created.objectId})},testMode:true}),error:{code:'PARTIAL_CREATE',message:'测试注入的实现写入失败'}};
          } else {
            created.implementation=normalize(a.implementation ?? ''); await atomicJson(req.projectPath,p);
            const persisted=await readJson(req.projectPath);const observed=persisted.objects.find((o:any)=>o.objectId===created.objectId);
            result=reply('succeeded','测试功能块已创建并重新读取',{...observed,name:a.name,parentId:a.parentId,created:true,beforeSnapshot,snapshot:snapshot(),checkpoint,
              contentHash:codeHash(observed.declaration,observed.implementation),persistedToWorkingCopy:true,reopened:true,...(kind==='array'?{creationMethod:"create_dut / DutType.Alias / ARRAY baseType ref: factory.json"}:{}),...(kind==='enum'?{creationMethod:"create_dut / DutType.Enumeration / baseType='' ref: factory.json"}:{}),testMode:true});
          }
        }
      }
    } else if(req.command==='change') {
      if(!object) throw new DomainError('failed','OBJECT_NOT_FOUND','对象不在选定 Application');
      const old={...object};
      const guard=a.variableTypeGuard;
      let insertionRaw:string|undefined,insertionEvidence:any,insertionError:unknown;
      if(a.action==='add-member-initializer')try {
        insertionRaw=applyMemberInitializerInsertion(old.declaration,a.declaration,a.memberInsertion);
        insertionEvidence={...a.memberInsertion,beforeRawHash:digest(old.declaration),afterRawHash:digest(insertionRaw),preservedRawSurroundings:true};
      }catch(e){insertionError=e;}

      let initializerEvidence:any;
      if(a.action==='add-initializer')try {
        const native=fixtureInitializerTarget(old,p.applications,a.section,p.objects);
        if(canonical(native)!==canonical(a.initializerTargetGuard))throw new Error('Initializer native identity changed');
        insertionRaw=applyMemberInitializerInsertion(old.declaration,a.declaration,a.initializerInsertion,';');
        insertionEvidence={...a.initializerInsertion,beforeRawHash:digest(old.declaration),afterRawHash:digest(insertionRaw),preservedRawSurroundings:true,
          beforeImplementationRawHash:digest(old.implementation),immediateImplementationRawHash:digest(old.implementation),reopenedImplementationRawHash:digest(old.implementation)};
        initializerEvidence={before:native,immediate:native,reopened:native};
      }catch(e){insertionError=e;}
      const childGuard=a.variableChildGuard;
      const directChildren=()=>p.objects.filter((o:any)=>o.parentId===object.objectId).map((o:any)=>({objectId:o.objectId,name:o.path.at(-1),nativeTypeId:o.nativeTypeId})).sort((x:any,y:any)=>x.objectId.localeCompare(y.objectId));
      const childValid=!!childGuard&&childGuard.fbId===object.objectId&&object.objectType==='function_block'&&
        canonical(directChildren())===canonical(childGuard.children)&&p.objects.filter((o:any)=>o.parentId===object.objectId).every((o:any)=>['method','property'].includes(o.objectType));
      const typeObject=guard?p.objects.find((o:any)=>o.objectId===guard.objectId&&o.applicationId===a.applicationId):undefined;
      const typeValid=!!typeObject&&typeObject.objectType==='structure'&&typeObject.nativeTypeId==='2db5746d-d284-4425-9f7f-2663a34b0ebc'&&
        typeObject.hasImplementation===false&&canonical(typeObject.path)===canonical(guard.path)&&
        codeHash(typeObject.declaration,typeObject.implementation??'')===guard.contentHash;
      const relatedIds=['property_get','property_set'].includes(object.objectType)?[object.fbId,object.propertyId,...object.accessorStructure.accessors.filter((o:any)=>o.objectId!==object.objectId).map((o:any)=>o.objectId)]:[];
      const related=(rows:any[])=>structuredClone(rows.filter((o:any)=>relatedIds.includes(o.objectId)).map((o:any)=>({...o,contentHash:codeHash(o.declaration,o.implementation)})).sort((a:any,b:any)=>a.objectId.localeCompare(b.objectId)));const relatedBefore=related(p.objects);
      const decl=['gvl','structure','enum','array'].includes(object.objectType);
      if(object.objectType==='property'||['property_get','property_set'].includes(object.objectType)&&(a.objectType!==object.objectType||a.parentId!==object.propertyId||a.fbId!==object.fbId||!getterDeclarationMatches(a.declaration))||(a.objectType && a.objectType!==object.objectType) || (decl && (a.implementation ?? '')!=='') || (decl && !declarationMatches(object.objectType,object.path.at(-1),a.declaration,true)) || (!decl && a.implementation===undefined)||object.objectType==='method'&&(a.objectType!=='method'||a.parentId!==object.parentId||!methodDeclarationMatches(object.path.at(-1),a.declaration,object.methodReturnType,object.access)))
        result={...reply('unsupported','测试对象类型不匹配'),error:{code:'OBJECT_TYPE_MISMATCH',message:'未写入'}};
      else if(object.objectType==='method'&&(object.readOnly||p.methodPermissionDenied))result={...reply('unsupported','Method权限拒绝'),error:{code:'METHOD_PERMISSION',message:'Read-only'}};
      else if(['property_get','property_set'].includes(object.objectType)&&(p.propertyPermissionDenied||object.fileReadOnly))result={...reply('unsupported','Get权限拒绝'),error:{code:'PROPERTY_PERMISSION',message:'Permission denied'}};
      else if(['property_get','property_set'].includes(object.objectType)&&(a.expectedPropertyHash!==object.propertyContentHash||a.expectedAccessorVersion!==object.accessorVersion||a.expectedSnapshot!==snapshot()))result={...reply('conflict','Get结构或内容版本冲突'),error:{code:'PROPERTY_VERSION_CHANGED',message:'Not written'}};
      else if(codeHash(old.declaration,old.implementation)!==a.expectedHash) result=reply('conflict','旧哈希不一致',{actualHash:codeHash(old.declaration,old.implementation)});
      else if(a.variableEdit&&(a.expectedSnapshot!==snapshot()||a.expectedDiskHash!==digest(await fs.readFile(req.projectPath))))result={...reply('conflict','变量工程或磁盘版本变化'),error:{code:'VARIABLE_VERSION_CHANGED',message:'Not written'}};
      else if(isMemberInitializerAction(a.action)&&!guard||guard&&!typeValid)result={...reply('conflict','结构体版本变化'),error:{code:'MEMBER_TYPE_CHANGED',message:'Not written'}};
      else if(insertionError)result={...reply('conflict','插入位置或原文变化'),error:{code:'MEMBER_INSERTION_CHANGED',message:'Not written'}};
      else if(a.section&&(object.objectType!=='function_block'||a.action==='add'&&!childGuard))result={...reply('unsupported','输入输出区对象不支持'),error:{code:'VARIABLE_INTERFACE_SCOPE',message:'Not written'}};
      else if(childGuard&&!childValid)result={...reply('conflict','子对象结构变化'),error:{code:'VARIABLE_CHILD_CHANGED',message:'Not written'}};
      else {
        await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));
        await atomicJson(path.join(dir,'before.json'),old);
        object.declaration=insertionRaw??normalize(a.declaration);
        if(p.failImplementation && (req.fileGuard||isMemberInitializerAction(a.action)||['set-type','add-initializer'].includes(a.action)||['method','property_get','property_set'].includes(object.objectType))) {
          await atomicJson(req.projectPath,p);
          result={...reply('unknown',a.action==='set-type'?'变量类型修改部分失败，未自动回滚':'直接编辑部分失败，未自动回滚',{checkpoint:path.join(dir,'checkpoint.project')}),error:{code:'PARTIAL_WRITE',message:'Injected failure; preserve state'}};
        } else if(p.failImplementation) {
          const observed={...object}; Object.assign(object,old);
          await atomicJson(req.projectPath,p);
          result=reply('failed','实现写入失败，已读回恢复',{partialContent:observed,recovery:{status:'succeeded',contentHash:codeHash(object.declaration,object.implementation)}});
        } else {
          if(a.action!=='add-initializer')object.implementation=normalize(a.implementation ?? ''); await atomicJson(req.projectPath,p);
          const persisted=await readJson(req.projectPath);
          const observed=persisted.objects.find((o:any)=>o.objectId===a.objectId);
          result=reply('succeeded','测试写后读回一致',{...observed,declaration:['add-member-initializer','add-initializer'].includes(a.action)?normalize(observed.declaration):observed.declaration,
            ...(insertionEvidence?{[a.action==='add-initializer'?'initializerInsertionEvidence':'memberInsertionEvidence']:{...insertionEvidence,immediateRawHash:digest(object.declaration),reopenedRawHash:digest(observed.declaration)}}:{}),
            ...(initializerEvidence?{initializerTargetReadback:initializerEvidence}:{}),contentHash:codeHash(observed.declaration,observed.implementation),snapshot:snapshot(),checkpoint:path.join(dir,'checkpoint.project'),persistedToWorkingCopy:true,reopened:true,
            ...(guard?{variableTypeEvidence:{objectId:guard.objectId,applicationId:guard.applicationId,path:guard.path,contentHash:guard.contentHash,beforeContentHash:guard.contentHash,afterContentHash:guard.contentHash}}:{}),
            ...(childGuard?{variableChildEvidence:{before:childGuard,after:childGuard}}:{}),
            ...(relatedIds.length?{relatedSourceEvidence:{before:relatedBefore,after:related(persisted.objects)}}:{}),testMode:true});
        }
      }
    } else if(req.command==='build') {
      const diagnostics=objects.filter((o:any)=>o.implementation.includes('SYNTAX_ERROR')).map((o:any)=>({severity:'error',text:'测试诊断标记（非 ST 编译器）',objectId:o.objectId}));
      result=reply(p.incompleteDiagnostics?'unknown':'succeeded','测试编译替身结果',{completed:true,diagnosticsComplete:!p.incompleteDiagnostics,diagnostics,buildPassed:p.incompleteDiagnostics?null:diagnostics.length===0,snapshot:snapshot(),applicationId:a.applicationId,targetKind:a.targetKind || 'application',testMode:true});
      if(a.targetKind!=='pool')result.data!.taskConfigurationVersion=taskConfigurationVersion(taskInventory());
    } else if(req.command==='save') {
      if(snapshot()!==a.expectedSnapshot) result=reply('conflict','保存快照已过期',{snapshot:snapshot()});
      else {
        if(req.fileGuard)await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));
        await atomicJson(req.projectPath,p); const reopened=await readJson(req.projectPath);
        result=reply('succeeded','测试文件已重新读取',{saved:true,reopened:true,snapshot:snapshot(),diskHash:digest(await fs.readFile(req.projectPath)),objectCount:reopened.objects.length,testMode:true});
        if(a.targetKind!=='pool')result.data!.taskConfigurationVersion=taskConfigurationVersion(taskInventory());
      }
    } else throw new DomainError('unsupported','COMMAND_UNSUPPORTED','未支持的桥接操作');
    if(req.fileGuard&&result.data) {
      result.data.directFileEvidence={projectPath:req.projectPath,expectedDiskHash:req.fileGuard.expectedDiskHash,beforeDiskHash:req.fileGuard.expectedDiskHash,exclusiveProbe:true,testDouble:true};
      result.data.projectPath=req.projectPath;result.data.editMode='direct';
      if(result.data.persistedToWorkingCopy){delete result.data.persistedToWorkingCopy;result.data.persistedToProject=true;}
      if(['inspect','list','read'].includes(req.command)) {
        const after=digest(await fs.readFile(req.projectPath));
        result.data.readOnlyEvidence={beforeDiskHash:req.fileGuard.expectedDiskHash,afterCloseDiskHash:after,postExitDiskHash:after,unchanged:after===req.fileGuard.expectedDiskHash};
      }
    }
    result.operationId=req.operationId;
    if(result.data) result.data.diskHash=digest(await fs.readFile(req.projectPath));
    await atomicJson(path.join(dir,'result.json'),result);
    if(['search','structure','device','io_mapping','libraries','compare_capture'].includes(req.command))await atomicJson(path.join(dir,'observed-after-exit.json'),result);
    return result;
  }
}

function fixtureInitializerTarget(o:any,apps:any[],section?:'VAR_INPUT'|'VAR_OUTPUT',objects:any[]=[] ){
  if(o.embeddedObjectTypesError)throw new Error(o.embeddedObjectTypesError);
  const appPath=apps.find(x=>x.applicationId===o.applicationId)?.path;
  const e:any={source:'native-object-application-and-embedded-types',objectId:o.objectId,applicationId:o.applicationId,path:o.path,
    parentId:o.parentId??(o.path?.length===appPath?.length+1?o.applicationId:undefined),nativeTypeId:o.nativeTypeId,
    pouType:o.objectType==='gvl'?null:o.pouType,embeddedObjectTypes:o.objectType==='gvl'?null:o.embeddedObjectTypes};
  if(section){
    const rows=objects.filter(x=>x.objectId!==o.objectId&&canonical(x.path?.slice(0,o.path.length))===canonical(o.path)).map(x=>({...x,
      declaration:normalize(x.declaration),implementation:normalize(x.implementation),contentHash:codeHash(x.declaration,x.implementation),
      declarationRawHash:digest(x.declaration),implementationRawHash:digest(x.implementation),embeddedObjectTypes:x.embeddedObjectTypes??[]})).sort((x,y)=>x.objectId.localeCompare(y.objectId));
    e.interfaceChildren={source:'native-fb-subtree-raw-source',complete:true,rows};
  }
  return initializerTargetEvidence({...o,initializerTargetEvidence:e},appPath,section);
}
