// 仅供显式 INOPRO_TEST_MODE=fixture 的契约测试。它不解析真实工程、不编译 ST。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Adapter, type BridgeRequest } from './adapter.js';
import { reply, DomainError, pouDeclarationMatches, declarationMatches, type Reply } from './contracts.js';
import { atomicJson, readJson, codeHash, digest, canonical, normalize } from './storage.js';

export class FixtureAdapter implements Adapter {
  async reconcile(directory:string) { return readJson(path.join(directory,'result.json')); }
  async execute(req:BridgeRequest, dir:string, onStart:(pid:number)=>Promise<void>):Promise<Reply> {
    await fs.mkdir(dir,{recursive:true}); await atomicJson(path.join(dir,'request.json'),req);
    const p=await readJson(req.projectPath);
    if(!p?.testFixture) throw new DomainError('failed','FIXTURE_ONLY','测试模式只接受显式 testFixture JSON');
    if(p.delayMs) await new Promise(r=>setTimeout(r,p.delayMs));
    const a=req.args;
    const supported=(o:any)=>!o.objectType || ['st_pou','function_block'].includes(o.objectType) || (['gvl','structure'].includes(o.objectType) && o.path.length===(p.applications.find((x:any)=>x.applicationId===o.applicationId)?.path.length ?? -2)+1);
    const objects=p.objects.filter((o:any)=>o.applicationId===a.applicationId && supported(o));
    const snapshot=()=>digest(canonical(p.objects.map((o:any)=>({...o,declaration:normalize(o.declaration),implementation:normalize(o.implementation)}))));
    let result!:Reply;
    const object=objects.find((o:any)=>o.objectId===a.objectId);
    if(req.command==='inspect') result=reply('succeeded','测试工程副本已打开',{applications:p.applications,poolBuildAvailable:p.applications.length===0&&p.objects.length>0,projectPath:req.projectPath,snapshot:snapshot(),testMode:true});
    else if(req.command==='structure'||req.command==='device') {
      const all=p.nativeNodes || [],cap=req.command==='structure'?a.maxNodes:20000,nodes=all.slice(0,cap);
      const treeScope={description:'fixture native tree, not real IDE',maxNodes:cap,capturedNodes:nodes.length,treeComplete:!p.treeReadError&&nodes.length===all.length,
        coverageComplete:!p.treeReadError&&nodes.length===all.length&&!nodes.some((n:any)=>n.unavailableFields.length),truncated:nodes.length<all.length,
        enumerationFailures:p.treeReadError?[{path:[],stage:'children-enumeration',reason:p.treeReadError}]:[]};
      if(req.command==='structure')result=reply('succeeded','测试原生结构替身',{projectId:a.projectId,projectPath:req.projectPath,nodes,scope:treeScope,identityLimitations:'fixture observed native GUIDs'});
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
        const native:Record<string,string>={gvl:'ffbfa93a-b94d-45fc-a329-229860183b1d',structure:'2db5746d-d284-4425-9f7f-2663a34b0ebc'};
        const corpus=objects.filter((o:any)=>!o.queryReadError).map((o:any)=>({...o,language:'ST',objectType:o.objectType || (/^FUNCTION_BLOCK\b/.test(o.declaration)?'function_block':'st_pou'),nativeTypeId:native[o.objectType] || '6f9dac99-8de1-4efc-8465-68ac443b7d08',hasImplementation:!['gvl','structure'].includes(o.objectType),declaration:normalize(o.declaration),implementation:normalize(o.implementation),contentHash:codeHash(o.declaration,o.implementation)}));
        result=reply('succeeded','测试一次读取搜索范围',{projectId:a.projectId,applicationId:a.applicationId,targetKind:a.targetKind,projectPath:req.projectPath,corpus,
          scope:{description:'fixture supported ST only; not real IDE',applicationPath:appPath,treeComplete:!p.treeReadError,eligibleObjects:objects.length,readObjects:corpus.length,coverageComplete:!failures.length&&!enumerationFailures.length,
            skippedObjects:p.objects.filter((o:any)=>o.applicationId===a.applicationId&&!supported(o)).map((o:any)=>({objectId:o.objectId,path:o.path,stage:'unsupported-type',reason:'Fixture unsupported kind/location'})),readFailures:failures,enumerationFailures},testMode:true});
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
      result=reply('succeeded','测试对象已读取',{...object,contentHash:codeHash(object.declaration,object.implementation),testMode:true});
    } else if(req.command==='create'||req.command==='create_declaration') {
      const kind=req.command==='create'?a.pouType:a.objectType,isPou=req.command==='create';
      const parent=p.applications.find((x:any)=>x.applicationId===a.applicationId);
      if(!parent || a.parentId!==a.applicationId) result={...reply('conflict','测试父节点不匹配'),error:{code:'PARENT_MISMATCH',message:'父节点不在选定 Application'}};
      else if(isPou?!pouDeclarationMatches(kind,a.name,a.declaration,a.returnType):!declarationMatches(kind,a.name,a.declaration)) result={...reply('failed','测试声明首部不一致'),error:{code:'INVALID_DECLARATION',message:'声明首部不一致'}};
      else if(snapshot()!==a.expectedSnapshot) result={...reply('conflict','测试快照已改变',{snapshot:snapshot()}),error:{code:'SNAPSHOT_CONFLICT',message:'创建前快照冲突'}};
      else {
        const collisions=p.objects.filter((o:any)=>(o.applicationId===a.applicationId||o.applicationId===null)&&o.path.at(-1).toLowerCase()===a.name.toLowerCase());
        if(collisions.length) result={...reply('conflict','测试同名对象存在',{collisions}),error:{code:'OBJECT_EXISTS',message:'不覆盖同名对象'}};
        else {
          const beforeSnapshot=snapshot(); const checkpoint=path.join(dir,'checkpoint.project');
          await fs.copyFile(req.projectPath,checkpoint);
          await atomicJson(path.join(dir,'before.json'),{expectedAbsent:true,parentId:a.parentId,name:a.name,snapshot:beforeSnapshot});
          const native:Record<string,string>={gvl:'ffbfa93a-b94d-45fc-a329-229860183b1d',structure:'2db5746d-d284-4425-9f7f-2663a34b0ebc'};
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
              contentHash:codeHash(observed.declaration,observed.implementation),persistedToWorkingCopy:true,reopened:true,testMode:true});
          }
        }
      }
    } else if(req.command==='change') {
      if(!object) throw new DomainError('failed','OBJECT_NOT_FOUND','对象不在选定 Application');
      const old={...object};
      const decl=['gvl','structure'].includes(object.objectType);
      if((a.objectType && a.objectType!==object.objectType) || (decl && (a.implementation ?? '')!=='') || (decl && !declarationMatches(object.objectType,object.path.at(-1),a.declaration)) || (!decl && a.implementation===undefined))
        result={...reply('unsupported','测试对象类型不匹配'),error:{code:'OBJECT_TYPE_MISMATCH',message:'未写入'}};
      else if(codeHash(old.declaration,old.implementation)!==a.expectedHash) result=reply('conflict','旧哈希不一致',{actualHash:codeHash(old.declaration,old.implementation)});
      else {
        await fs.copyFile(req.projectPath,path.join(dir,'checkpoint.project'));
        await atomicJson(path.join(dir,'before.json'),old);
        object.declaration=normalize(a.declaration);
        if(p.failImplementation) {
          const observed={...object}; Object.assign(object,old);
          await atomicJson(req.projectPath,p);
          result=reply('failed','实现写入失败，已读回恢复',{partialContent:observed,recovery:{status:'succeeded',contentHash:codeHash(object.declaration,object.implementation)}});
        } else {
          object.implementation=normalize(a.implementation ?? ''); await atomicJson(req.projectPath,p);
          const persisted=await readJson(req.projectPath);
          const observed=persisted.objects.find((o:any)=>o.objectId===a.objectId);
          result=reply('succeeded','测试写后读回一致',{...observed,contentHash:codeHash(observed.declaration,observed.implementation),snapshot:snapshot(),checkpoint:path.join(dir,'checkpoint.project'),persistedToWorkingCopy:true,reopened:true,testMode:true});
        }
      }
    } else if(req.command==='build') {
      const diagnostics=objects.filter((o:any)=>o.implementation.includes('SYNTAX_ERROR')).map((o:any)=>({severity:'error',text:'测试诊断标记（非 ST 编译器）',objectId:o.objectId}));
      result=reply(p.incompleteDiagnostics?'unknown':'succeeded','测试编译替身结果',{completed:true,diagnosticsComplete:!p.incompleteDiagnostics,diagnostics,buildPassed:p.incompleteDiagnostics?null:diagnostics.length===0,snapshot:snapshot(),applicationId:a.applicationId,targetKind:a.targetKind || 'application',testMode:true});
    } else if(req.command==='save') {
      if(snapshot()!==a.expectedSnapshot) result=reply('conflict','保存快照已过期',{snapshot:snapshot()});
      else {
        await atomicJson(req.projectPath,p); const reopened=await readJson(req.projectPath);
        result=reply('succeeded','测试文件已重新读取',{saved:true,reopened:true,snapshot:snapshot(),diskHash:digest(await fs.readFile(req.projectPath)),objectCount:reopened.objects.length,testMode:true});
      }
    } else throw new DomainError('unsupported','COMMAND_UNSUPPORTED','未支持的桥接操作');
    result.operationId=req.operationId;
    if(result.data) result.data.diskHash=digest(await fs.readFile(req.projectPath));
    await atomicJson(path.join(dir,'result.json'),result);
    if(['structure','device','compare_capture'].includes(req.command))await atomicJson(path.join(dir,'observed-after-exit.json'),result);
    return result;
  }
}
