// Explicit fixture adapter only; it does not open a native engineering project.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {atomicJson,digest,canonical} from './storage.js';
import {reply} from './contracts.js';
import {clearTarget,clearResolution,clearStateDifference} from './library-placeholder-clear.js';
import {libraryConfigurationVersion,placeholderConfigurationVersion} from './libraries.js';

export async function fixturePlaceholderClear(p:any,req:any,dir:string,libraryInventory:()=>any,snapshot:()=>string){
  const a=req.args,checkpoint=path.join(dir,'checkpoint.project'),counts={clear:0,save:0};
  const sources=()=>structuredClone(p.objects).map((o:any)=>({objectId:o.objectId,applicationId:o.applicationId,path:o.path,
    nativeTypeId:o.nativeTypeId,declaration:o.declaration,implementation:o.implementation,
    ...(o.nativeTypeId==='6f9dac99-8de1-4efc-8465-68ac443b7d08'?{embeddedObjectTypes:o.embeddedObjectTypes}:{})})).sort((x:any,y:any)=>x.objectId.localeCompare(y.objectId));
  const capture=()=>{
    const tasks:any={};
    for(const app of p.applications){
      tasks[app.applicationId]={projectId:a.projectId,applicationId:app.applicationId,targetKind:'application',projectPath:req.projectPath,applicationPath:app.path,
        tasks:structuredClone((p.tasks??[]).filter((t:any)=>t.applicationId===app.applicationId)),
        programs:p.objects.filter((o:any)=>o.applicationId===app.applicationId&&o.pouType==='program').map((o:any)=>({objectId:o.objectId,path:o.path})),
        resolutionReadFailures:[],enumerationFailures:[],coverageComplete:true};
    }
    return {library:libraryInventory(),tasks,sources:sources(),snapshot:snapshot(),nativeScope:structuredClone(p.placeholderClearScope)};
  };
  let before:any,immediate:any,after:any;
  try{
    before=capture();await atomicJson(path.join(dir,'placeholder-clear-before.json'),before);
    const old=clearTarget(before.library,a,true);
    if(before.library.configurationVersion!==a.expectedReferenceVersion||before.library.placeholderConfigurationVersion!==a.expectedPlaceholderVersion||
      digest(await fs.readFile(req.projectPath))!==a.expectedDiskHash||snapshot()!==a.expectedSourceSnapshot)
      throw Error('Fixture source/configuration/disk changed');
    if(clearStateDifference(before,capture(),a))throw Error('Fixture pre-dispatch changed');
    await fs.copyFile(req.projectPath,checkpoint);
    await atomicJson(path.join(dir,'placeholder-clear-dispatched.json'),{method:'set_redirection',argument:null});counts.clear++;
    const manager=p.libraryManagers.find((m:any)=>m.managerId===a.managerId);
    const row=manager.references.find((r:any)=>r.rawFields.id===a.placeholderReferenceId);
    row.rawFields.explicit_redirection=null;row.rawFields.is_redirected=false;
    row.rawFields.effective_resolution=Object.hasOwn(p,'clearEffective')?p.clearEffective:row.rawFields.default_resolution;
    row.rawFields.resolution_info=Object.hasOwn(p,'clearInfo')?p.clearInfo:'设备解析';
    row.resolutionStatus=row.rawFields.effective_resolution?'effective-resolution-reported':'unknown';
    if(p.placeholderClearFault==='setter')throw Error('Injected setter uncertainty');
    immediate=capture();
    const fault=(s:any)=>{
      const f=s.library.references.find((r:any)=>r.rawFields.id===a.placeholderReferenceId).rawFields;
      if(p.placeholderClearFault==='missing')delete f.effective_resolution;
      if(p.placeholderClearFault==='extra')f.unexpected='new field';
      if(p.placeholderClearFault==='identity')f.id='other';
      if(p.placeholderClearFault==='source')s.sources[0].implementation+='\nchanged';
      if(p.placeholderClearFault==='task'&&Object.values<any>(s.tasks)[0].tasks[0])Object.values<any>(s.tasks)[0].tasks[0].rawCalls.reverse();
      if(p.placeholderClearFault==='coverage')s.library.scope.fieldReadComplete=false;
      s.library.configurationVersion=libraryConfigurationVersion(s.library);s.library.placeholderConfigurationVersion=placeholderConfigurationVersion(s.library);
    };
    fault(immediate);await atomicJson(path.join(dir,'placeholder-clear-immediate.json'),immediate);
    if(clearStateDifference(before,immediate,a,true))throw Error('Fixture immediate mismatch');
    if(p.placeholderClearFault==='publication')throw Error('Injected evidence publication failure');
    if(p.placeholderClearFault==='save')throw Error('Injected save failure');
    counts.save++;await atomicJson(req.projectPath,p);
    after=capture();
    if(p.placeholderClearFault==='reopen')after.library.references.find((r:any)=>r.rawFields.id===a.placeholderReferenceId).rawFields.explicit_redirection=a.expectedExplicitRedirection;
    await atomicJson(path.join(dir,'placeholder-clear-reopened.json'),after);
    if(clearStateDifference(before,after,a,true)||canonical(after)!==canonical(immediate))throw Error('Fixture reopen mismatch');
    const disk=digest(await fs.readFile(req.projectPath));
    return reply('succeeded','Fixture-only explicit override cleared',{projectId:a.projectId,applicationId:a.applicationId,managerId:a.managerId,
      placeholderReferenceId:a.placeholderReferenceId,before,immediate,after,targetBefore:old,
      targetImmediate:clearTarget(immediate.library,a,false),targetAfter:clearTarget(after.library,a,false),
      beforePlaceholderVersion:a.expectedPlaceholderVersion,placeholderVersion:after.library.placeholderConfigurationVersion,
      resolution:clearResolution(clearTarget(after.library,a,false)),changed:true,cleared:true,reopened:true,buildApplicable:false,
      checkpoint,persistedToWorkingCopy:true,snapshot:snapshot(),diskHash:disk,workerDiskHash:disk,postExitDiskHashObserved:true});
  }catch(e:any){
    return {...reply(counts.clear?'unknown':'conflict',e.message,{primaryException:{name:e.name,message:e.message},
      ...(before?{before}:{}),...(immediate?{immediate}:{}),...(after?{after}:{}),
      writeStarted:counts.clear>0,checkpoint,saveAttempts:counts.save,recovery:'not-attempted'}),
      error:{code:counts.clear?'PARTIAL_PLACEHOLDER_CLEAR':'PLACEHOLDER_CLEAR_PRECONDITION',message:e.message}};
  }finally{await atomicJson(path.join(dir,'placeholder-clear-counts.json'),counts);}
}
