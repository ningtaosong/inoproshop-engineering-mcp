import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Config, type Adapter, ROOT } from './adapter.js';
import { Store, digest, canonical, alive, codeHash, pathKey, readJson, type Operation, type Session } from './storage.js';
import { CONTRACT, VERSION, DomainError, reply, replySchema, schemas, pouDeclarationMatches, declarationMatches,methodDeclarationMatches,propertyHeader,getterDeclarationMatches, searchDataSchema,taskDataSchema,structureDataSchema,deviceDataSchema,libraryDataSchema,variableDataSchema, type Reply } from './contracts.js';
import {propertyEvidence,propertyCreationEvidence,PROPERTY_NATIVE,ACCESSOR_NATIVE,PROPERTY_COVERAGE_VERSION} from './properties.js';
import {searchResult,taskResult,nativeInventoryResult,SEARCH_RESULT_VERSION} from './queries.js';
import {singleIdentifier,IDENTIFIER_LEXER_VERSION,LEGACY_IDENTIFIER_LEXER_VERSION} from './st-lex.js';
import {variableResult,VARIABLE_PARSER_VERSION} from './variables.js';
import {boundNativeReply} from './native-output.js';
import {captureReply,captureSnapshot,compareReply,type Snapshot} from './comparison.js';
import {isolationState,assertNotIsolated,maintenanceGuard} from './isolation.js';
import {bindDirect,guardDirect} from './direct-project.js';
import {reserveProject,guardNewPath,createdSession} from './project-create.js';
import {taskConfigurationVersion,validateTaskPatch,buildApplies,configuredIntervalMs,TASK_CONFIGURATION_SCHEME} from './task-config.js';

export class EngineeringService {
  readonly store: Store;
  private queue: Promise<unknown> = Promise.resolve();
  private admission: Promise<unknown> = Promise.resolve();
  private persistencePoison?: string;
  constructor(readonly config: Config, readonly adapter: Adapter) { this.store=new Store(config.dataDir); }
  async environment():Promise<Reply> {
    const exists=await fs.access(this.config.executable).then(()=>true,()=>false);
    const evidence=await fs.readFile(path.join(ROOT,'docs','evidence','capabilities.json'),'utf8').then(JSON.parse,()=>null);
    const profilePath=path.resolve(path.dirname(this.config.executable),'..','Profiles',this.config.profile+'.profile');
    const profileExists=await fs.access(profilePath).then(()=>true,()=>false);
    const localReport=await fs.readFile(path.join(ROOT,'docs','evidence','environment.json'),'utf8').then(JSON.parse,()=>null);
    const clients=await Promise.all((localReport?.applications || []).filter((a:any)=>a.DisplayName?.startsWith('DeepSeek Harness')).map(async(a:any)=>({name:a.DisplayName,version:a.DisplayVersion,installPath:a.InstallLocation,evidenceAt:localReport.executedAt,executablePresent:await fs.access(path.join(a.InstallLocation,'DeepSeek Harness.exe')).then(()=>true,()=>false)})));
    const executableHash=exists?digest(await fs.readFile(this.config.executable)):undefined;
    const evidenceMatches=profileExists && evidence?.software?.sha256===executableHash && evidence?.software?.profile===this.config.profile;
    return reply('succeeded','本地环境及证据状态',{serverVersion:VERSION,contractVersion:CONTRACT,
      node:process.version,executable:this.config.executable,profile:this.config.profile,
      profilePath,profileExists,clients,
      mode:this.config.testMode?'fixture-test-only':this.config.noUI?'batch-noUI':'batch-managed-UI',
      dataDir:this.config.dataDir,ideInstalled:exists,supportedVersion:'1.9.1.6',
      software:evidenceMatches?evidence.software:{name:'InoProShop',fileVersion:'unverified',profile:this.config.profile,sha256:executableHash},
      capabilities:this.config.testMode?{testMode:true,realIde:false}:evidenceMatches?evidence:{scriptLaunch:'unverified',projectRead:'unverified',projectWrite:'unverified',build:'unverified',saveReopen:'unverified',reason:'当前可执行文件/Profile 与已有证据未匹配'},
      missingDependencies:[...(!exists?['InoProShop']:[]),...(!profileExists?['InoProShop Profile']:[])],productionFallbackToFixture:false});
  }
  async status():Promise<Reply> {
    try {
      const registry=await this.store.registry();
      const pending=(await this.store.operations()).filter(o=>o.status==='running'||o.status==='unknown');
      const isolation=await isolationState(this.store);
      const isolatedIds=new Set(isolation.own.flatMap(e=>e.plan.operationIds));
      const isolatedProjects=new Set(isolation.own.map(e=>e.plan.projectId));
      const globalFrozen=!!this.persistencePoison||pending.some(o=>!isolatedIds.has(o.operationId)&&(o.status==='unknown'||!alive(o.ownerPid)));
      await maintenanceGuard();
      return reply('succeeded','会话状态',{session:registry.projects.find(s=>s.projectId===registry.activeProjectId) || null,
        pending:pending.map(o=>({operationId:o.operationId,requestId:o.requestId,tool:o.tool,status:o.status==='running'&&(!alive(o.ownerPid)||!!this.persistencePoison)?'unknown':o.status})),
        writeFrozen:globalFrozen||isolatedProjects.has(registry.activeProjectId),globalFrozen,
        availability:globalFrozen?'global-frozen':isolatedProjects.has(registry.activeProjectId)?'active-project-isolated':'available',
        isolatedProjects:isolation.own.map(e=>({projectId:e.plan.projectId,operationIds:e.plan.operationIds,planId:e.plan.planId,committedAt:e.committedAt,sourcePath:e.plan.bindings[0].sourcePath,workingPath:e.plan.bindings[0].workingPath}))});
    } catch(e:any) {
      return {...reply('unknown','持久化记录或维护状态无法确认，工程派发已全局冻结',{session:null,pending:[],writeFrozen:true,globalFrozen:true,availability:'global-frozen'}),error:{code:e.code || 'CORRUPT_RECORD',message:e.message}};
    }
  }
  async projects():Promise<Reply> {
    const r=await this.store.registry();const status=await this.status();
    if(status.status!=='succeeded')return status;
    const isolated=(status.data!.isolatedProjects as any[]);
    return reply('succeeded','已登记工程（只读，不打开 IDE）',{projects:r.projects.map(s=>({...s,projectPath:s.workingPath,name:path.basename(s.workingPath),active:s.projectId===r.activeProjectId,
      availability:status.data!.globalFrozen?'global-frozen':isolated.some(e=>e.projectId===s.projectId)?'isolated':'available'})),
      activeProjectId:r.activeProjectId,writeFrozen:status.data!.writeFrozen,globalFrozen:status.data!.globalFrozen,isolatedProjects:isolated});
  }
  private async originalProject(op:Operation):Promise<Session> {
    if(op.project) {
      if(op.args.projectId && op.project.projectId!==op.args.projectId)throw new DomainError('unknown','OPERATION_PROJECT_MISMATCH','原操作工程绑定不一致');
      return op.project;
    }
    // 兼容旧请求；按原 projectId / 原源路径查登记，不能拿当前活动项猜归属。
    const r=await this.store.registry();
    const s=op.args.projectId?r.projects.find(p=>p.projectId===op.args.projectId):
      op.tool==='project_open'&&op.args.projectPath?r.projects.find(p=>pathKey(p.workingPath)===pathKey(op.args.projectPath)):
      op.tool==='project_open_copy'&&op.args.sourcePath?r.projects.find(p=>pathKey(p.sourcePath)===pathKey(op.args.sourcePath)):undefined;
    if(!s)throw new DomainError('unknown','OPERATION_PROJECT_MISSING','缺少可确认的原操作工程身份，保持冻结');
    return s;
  }
  async operation(args:any):Promise<Reply> {
    const op=args.operationId?await this.store.operation(args.operationId):(await this.store.operations()).find(o=>o.requestId===args.requestId);
    if(!op) throw new DomainError('failed','OPERATION_NOT_FOUND','未找到原操作');
    if(args.reconcile && (op.status==='running'||op.status==='unknown')) {
      if(op.status==='running' && alive(op.ownerPid) && !this.persistencePoison) return this.operationReply(op,'running','原服务仍在执行，查询不会中断或重放');
      await this.store.acquire();
      if(op.tool==='project_create') {
        if(!op.creation) return this.operationReply(op,'unknown','缺少原新建路径预留证据，保留现场，不能重放');
        await this.store.acquire(op.creation.projectPath);
        if(op.bridge?.pid&&alive(op.bridge.pid))return this.operationReply(op,'unknown','原新建进程仍存在，保持冻结，不重新创建');
        if(op.bridge) {
          const observed=await this.adapter.reconcile(op.bridge.directory);
          if(observed){await this.finish(op,replySchema.parse(observed));return op.response!;}
        }
        return this.operationReply(op,'unknown','原新建操作缺少可核对终态，保留文件，不覆盖重试');
      }
      const project=await this.originalProject(op);
      op.project=project;
      await this.store.acquire(project.sourcePath);
      if(op.bridge?.pid && alive(op.bridge.pid)) return this.operationReply(op,'unknown','原 IDE 进程仍存在，不能确认其已退出；继续冻结后续工程操作');
      if(op.bridge) {
        const observed=await this.adapter.reconcile(op.bridge.directory);
        if(observed) {
          this.validateDirect(observed,op.tool==='project_compare'&&op.args.origin==='registered-source'?{...project,workingPath:project.sourcePath,diskHash:project.sourceHash}:project);
          const parsed=this.prepareResult(op,replySchema.parse(observed));
          this.validateEvidence(op,parsed,project);
          if(parsed.status==='succeeded' && op.tool!=='project_compare' && parsed.data?.diskHash && parsed.data.diskHash!==digest(await fs.readFile(project.workingPath)))
            throw new DomainError('unknown','RESULT_DISK_CHANGED','原操作结果与其工作副本当前磁盘内容不一致，保持冻结');
          await this.finish(op,boundNativeReply(parsed));
          if(!(await this.store.operations()).some(o=>o.status==='running'||o.status==='unknown')) {await this.store.registry();this.persistencePoison=undefined;}
          return op.response!;
        }
      }
      return this.operationReply(op,'unknown','原操作缺少可核对结果；保留现场，不能重放或解除冻结');
    }
    if(op.response && op.status!=='running') return op.response;
    return this.operationReply(op,alive(op.ownerPid)&&!this.persistencePoison?op.status:'unknown','原请求状态；查询不会重新执行');
  }
  private operationReply(op:Operation,status:Reply['status'],summary:string):Reply {
    return {...reply(status,summary,{tool:op.tool,startedAt:op.startedAt,evidence:op.bridge?.directory}),requestId:op.requestId,operationId:op.operationId};
  }
  async call(tool:string,args:any):Promise<Reply> {
    if(tool==='environment_inspect') return this.environment();
    if(tool==='session_status') return this.status();
    if(tool==='project_list') return this.projects();
    if(tool==='operation_status') {
      if(!args.reconcile)return this.operation(args);
      // 普通状态查询仍立即响应；真正核对并提交原结果时，与受理及队列提交串行。
      const reconciled=this.admission.then(async()=>{
        const observed=await this.operation({...args,reconcile:false});
        if(observed.status!=='unknown')return observed;
        await this.queue;
        return this.operation(args);
      });
      this.admission=reconciled.catch(()=>{});return reconciled;
    }
    const accepted=this.admission.then(()=>this.accept(tool,args));
    this.admission=accepted.catch(()=>{});
    return accepted;
  }
  private async accept(tool:string,args:any):Promise<Reply> {
    if(this.persistencePoison) throw new DomainError('unknown','PERSISTENCE_ERROR','上次结果持久化失败，工程派发已冻结；请核对原操作');
    await this.store.acquire();
    const ops=await this.store.operations();
    const isolation=await isolationState(this.store);
    const isolatedIds=new Set(isolation.own.flatMap(e=>e.plan.operationIds));
    const requestId=args.requestId || 'read-'+randomUUID();
    const fingerprint=digest(canonical({tool,args}));
    const old=ops.find(o=>o.requestId===requestId);
    if(old) {
      if(old.fingerprint!==fingerprint) throw new DomainError('conflict','REQUEST_ID_REUSED','业务 requestId 已用于不同工具或参数');
      return this.operation({operationId:old.operationId});
    }
    if(ops.some(o=>!isolatedIds.has(o.operationId)&&(o.status==='unknown'||(o.status==='running'&&!alive(o.ownerPid)))))
      throw new DomainError('unknown','PENDING_UNKNOWN','存在未决操作；请先查询并核对 operation_status，禁止派发后续工程操作');
    const switching=['project_create','project_open','project_open_copy','project_activate'].includes(tool);
    if(switching && ops.some(o=>o.status==='running'&&!isolatedIds.has(o.operationId)))throw new DomainError('conflict','PENDING_OPERATION','存在运行中或排队操作，不能切换；请先查询原操作');
    let registry;
    try {registry=await this.store.ensureRegistry();}
    catch(e:any) {this.persistencePoison=e.message;throw new DomainError('unknown','REGISTRY_UNAVAILABLE','登记无法确认，保持冻结：'+e.message);}
    const current=registry.projects.find(s=>s.projectId===registry.activeProjectId);
    await assertNotIsolated(this.store,args.projectId,[args.sourcePath,args.projectPath].filter(Boolean));
    if(!switching && (!current || current.projectId!==args.projectId))
      throw new DomainError('conflict','PROJECT_NOT_ACTIVE','请求工程不是活动工程；请先明确激活目标，再使用其真实身份');
    const op:Operation={schemaVersion:1,registryVersion:1,operationId:randomUUID(),requestId,tool,args,fingerprint,status:'running',ownerPid:process.pid,startedAt:new Date().toISOString(),
      ...(switching?{activation:{previousActiveProjectId:registry.activeProjectId,revision:registry.revision}}:{project:current})};
    try {await this.store.saveOp(op);} // 持久化先于队列派发和工程修改。
    catch(e:any) {
      this.persistencePoison=e.message || String(e);
      return {...this.operationReply(op,'unknown','原请求登记无法可靠发布，未派发，后续工程操作已冻结'),error:{code:'PERSISTENCE_ERROR',message:this.persistencePoison!}};
    }
    const execution=this.queue.then(async()=> {
      let result:Reply;
      try {
        if(this.persistencePoison) throw new DomainError('failed','NOT_DISPATCHED','前一结果持久化失败，本排队操作未派发');
        const scope=await isolationState(this.store),covered=new Set(scope.own.flatMap(e=>e.plan.operationIds));
        const unresolved=(await this.store.operations()).some(o=>o.operationId!==op.operationId&&!covered.has(o.operationId)&&(o.status==='unknown'||(o.status==='running'&&!alive(o.ownerPid))));
        if(unresolved) throw new DomainError('unknown','PENDING_UNKNOWN','队列中前一操作结果未知，未派发本操作');
        result=await this.execute(op);
      } catch(e:any) {
        result={...reply(e instanceof DomainError?e.status:(op.bridge?'unknown':'failed'),e.message || String(e)),error:{code:e.code || 'EXECUTION_ERROR',message:e.message || String(e)}};
      }
      // 提交失败不可改写为一次“执行失败”；保留原桥接结果，重启后只核对原操作。
      await this.finish(op,result);
      return op.response!;
    }).catch((e:any)=> {
      this.persistencePoison=e.message || String(e);
      console.error('操作记录发布失败，保持冻结：',this.persistencePoison);
      return {...this.operationReply(op,'unknown','操作结果无法可靠持久化，已冻结后续派发'),error:{code:'PERSISTENCE_ERROR',message:this.persistencePoison!}};
    });
    this.queue=execution;
    return Promise.race([execution,new Promise<Reply>(resolve=> {
      const timer=setTimeout(()=>resolve(this.operationReply(op,'running','请求已持久化，正在执行；请查询原 operationId')),this.config.responseWaitMs);
      execution.finally(()=>clearTimeout(timer)).catch(()=>{});
    })]);
  }
  private async finish(op:Operation,result:Reply) {
    const switching=['project_create','project_open','project_open_copy','project_activate'].includes(op.tool);
    if(op.tool==='project_create'&&result.status==='succeeded') {
      op.project=await createdSession(this.store,op,result);
      await this.store.saveOp(op);
    }
    if(switching && result.status==='succeeded') {
      const session={...await this.originalProject(op)};
      session.applications=result.data?.applications as any[];
      const chosen=op.args.applicationId || session.applicationId || (session.applications?.length===1?session.applications[0].applicationId:undefined);
      if(!chosen && session.applications?.length===0 && result.data?.poolBuildAvailable===true) {
        session.applicationId=null; session.targetKind='pool';
      } else if(chosen && !session.applications?.some(x=>x.applicationId===chosen)) {
        result={...reply('conflict','指定 Application 不存在；原活动工程保留',{applications:session.applications,workingPath:session.workingPath}),error:{code:'APPLICATION_NOT_FOUND',message:'指定 Application 不存在'}};
      } else if(!chosen) {
        result={...reply('conflict','存在多个或没有 Application；请根据真实候选选择，原活动工程保留',{applications:session.applications,workingPath:session.workingPath}),error:{code:'APPLICATION_SELECTION_REQUIRED',message:'需要选择精确 Application'}};
      } else {
        session.applicationId=chosen;
        session.targetKind='application';
      }
      if(result.status==='succeeded') {
        // 旧格式 open 的恢复仅允许指向原已登记项，不推断新工程。
        if(!op.activation) {const r=await this.store.registry();op.activation={previousActiveProjectId:r.activeProjectId,revision:r.revision};}
        session.snapshot=result.data?.snapshot as string;session.diskHash=result.data?.diskHash as string;
        if(session.lastBuild && !buildApplies(session,session))delete session.lastBuild;
        session.buildApplicable=!!session.lastBuild;session.lastStateOperationId=op.operationId;
        const committed=await this.store.activate(session,op);
        result={...result,data:{...result.data,projectPath:committed.workingPath,editMode:committed.editMode||'copy',session:committed,
          reused:op.tool==='project_activate'||(await this.store.operations()).some(o=>o.operationId!==op.operationId&&o.status==='succeeded'&&o.project?.projectId===committed.projectId)}};
      }
    }
    if(!switching && op.tool!=='project_compare' && result.status==='succeeded' && op.project) {
      await this.store.ensureRegistry();
      const r=await this.store.registry();const s=r.projects.find(p=>p.projectId===op.project!.projectId);
      if(!s)throw new DomainError('unknown','PROJECT_RECORD_MISSING','无法提交原工程结果');
      if(s.lastStateOperationId!==op.operationId) {
        if(op.tool==='project_build')s.lastBuild={operationId:op.operationId,...result.data};
        if(result.data?.snapshot)s.snapshot=result.data.snapshot as string;
        if(result.data?.diskHash)s.diskHash=result.data.diskHash as string;
        if(result.data?.taskConfigurationVersion)s.taskConfigurationVersion=result.data.taskConfigurationVersion as string;
        s.buildApplicable=buildApplies(s,s);
        s.lastStateOperationId=op.operationId;await this.store.saveSession(s);
      }
    }
    op.status=result.status; op.finishedAt=new Date().toISOString();
    op.response={...result,operationId:op.operationId,requestId:op.requestId};
    await this.store.saveOp(op);
    // 失败的新目标只释放自己的临时源锁；不释放服务锁或已登记工程的锁。unknown 原锁保留。
    if(switching && !['succeeded','unknown'].includes(result.status) && op.project &&
      !(await this.store.registry()).projects.some(s=>pathKey(s.sourcePath)===pathKey(op.project!.sourcePath)))
      await this.store.releaseSource(op.project.sourcePath);
    if(op.tool==='project_create'&&op.creation&&!['succeeded','unknown'].includes(result.status)&&
      !(await this.store.registry()).projects.some(s=>pathKey(s.workingPath)===pathKey(op.creation!.projectPath)))
      await this.store.releaseSource(op.creation.projectPath);
  }
  private async bridge(op:Operation,command:string,session:Session,args:any):Promise<Reply> {
    await maintenanceGuard();await assertNotIsolated(this.store,session.projectId,[session.sourcePath,session.workingPath]);
    const direct=session.editMode==='direct';
    if(direct)await guardDirect(this.store,session);
    op.bridge={directory:this.store.file('ipc/'+op.operationId)};
    await this.store.saveOp(op);
    const result=await this.adapter.execute({operationId:op.operationId,command,projectPath:session.workingPath,args,
      ...(direct?{fileGuard:{expectedDiskHash:session.diskHash!,mode:'direct' as const}}:{})},op.bridge.directory,async pid=> {
      op.bridge!.pid=pid; await this.store.saveOp(op);
    });
    this.validateDirect(result,session);
    const parsed=this.prepareResult(op,replySchema.parse(result));
    this.validateEvidence(op,parsed,session);
    return boundNativeReply(parsed);
  }
  private validateDirect(result:Reply,session:Session) {
    if(session.editMode!=='direct'||result.status!=='succeeded')return;
    const e=result.data?.directFileEvidence as any;
    if(!e||e.expectedDiskHash!==session.diskHash||e.beforeDiskHash!==session.diskHash||e.exclusiveProbe!==true||pathKey(e.projectPath||'')!==pathKey(session.workingPath))
      throw new DomainError('unknown','DIRECT_EVIDENCE_INVALID','直接工程的版本/原生占用检查证据无法确认，保持冻结');
  }
  private prepareResult(op:Operation,result:Reply):Reply {
    if(op.tool==='variable_inspect')return variableResult(result,op.args);
    if(op.tool==='project_compare')return captureReply(result,op.args,op.project!);
    return op.tool==='project_search'?searchResult(result,op.args):op.tool==='task_inspect'?taskResult(result,op.args):
      ['project_structure','device_inspect','library_inspect'].includes(op.tool)?nativeInventoryResult(result,op.args,op.tool):result;
  }
  private validateEvidence(op:Operation,parsed:Reply,session?:Session) {
    const args=op.args;
    const command=({project_search:'search',variable_inspect:'variables',task_inspect:'tasks',task_config_update:'task_update',library_inspect:'libraries',project_structure:'structure',device_inspect:'device',object_read:'read',pou_create:'create',method_create:'create_method',property_create:'create_property',declaration_create:'create_declaration',code_apply_change:'change',project_build:'build',project_save:'save',object_list:'list',project_open:'inspect',project_open_copy:'inspect',project_activate:'inspect'} as Record<string,string>)[op.tool];
    if(parsed.operationId!==op.operationId) throw new DomainError('unknown','RESULT_ID_MISMATCH','结果编号不一致');
    if(parsed.status==='succeeded') {
      const d=parsed.data;
      const isHash=(v:unknown)=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
      const invalid=()=> { throw new DomainError('unknown','RESULT_CONTRACT_MISMATCH','桥接结果缺少完整证据或与指定对象不匹配'); };
      const persisted=()=>session?.editMode==='direct'?d!.persistedToProject===true:d!.persistedToWorkingCopy===true;
      const declared=(v:any)=> {
        const native:Record<string,string>={gvl:'ffbfa93a-b94d-45fc-a329-229860183b1d',structure:'2db5746d-d284-4425-9f7f-2663a34b0ebc',enum:'2db5746d-d284-4425-9f7f-2663a34b0ebc',array:'2db5746d-d284-4425-9f7f-2663a34b0ebc'};
        const appPath=session?.applications?.find(x=>x.applicationId===args.applicationId)?.path;
        return !!v && v.hasImplementation===false && native[v.objectType]===v.nativeTypeId && v.implementation==='' &&
          args.targetKind!=='pool' && !!appPath && canonical(v.path?.slice(0,-1))===canonical(appPath) &&
          declarationMatches(v.objectType,v.path?.at(-1) || '',v.declaration);
      };
      if(!d) invalid();
      if(op.tool==='project_compare') {
        if(args.mode!=='capture'||!session||d!.mode!=='capture'||(d!.snapshot as any)?.evidence?.operationId!==op.operationId)invalid();
        return;
      }
      if(['search','variables','tasks','structure','device','libraries'].includes(command)) {
        const wide=command==='structure'||command==='device';
        const schema=command==='variables'?variableDataSchema:command==='search'?searchDataSchema:command==='tasks'?taskDataSchema:command==='structure'?structureDataSchema:command==='libraries'?libraryDataSchema:deviceDataSchema;
        if(!schema.safeParse(d).success || d!.projectId!==args.projectId || (!wide&&(d!.applicationId!==args.applicationId || d!.targetKind!==(args.targetKind || 'application'))) ||
          !session || pathKey(d!.projectPath as string)!==pathKey(session.workingPath))invalid();
        const e=d!.readOnlyEvidence as any;
        if(e?.unchanged!==true || e.beforeDiskHash!==session!.diskHash || e.afterCloseDiskHash!==e.beforeDiskHash || e.postExitDiskHash!==e.beforeDiskHash || d!.diskHash!==e.beforeDiskHash)invalid();
        if(command==='search'&&(d!.query!==args.query || d!.caseSensitive!==args.caseSensitive ||
          d!.matchMode!==undefined&&d!.matchMode!==(args.matchMode??'literal') || (args.expectedVersion&&d!.version!==args.expectedVersion) ||
          (d!.readOrigin as any)?.kind==='recorded-inventory'&&((d!.pageFileEvidence as any)?.beforeDiskHash!==e.beforeDiskHash||(d!.pageFileEvidence as any)?.afterDiskHash!==e.beforeDiskHash)))invalid();
        if((wide||command==='libraries'||command==='variables') && (args.expectedVersion&&d!.version!==args.expectedVersion || command==='device'&&(d!.device as any)?.objectId!==args.deviceId ||
          (d!.readOrigin as any)?.kind==='recorded-inventory'&&((d!.pageFileEvidence as any)?.beforeDiskHash!==e.beforeDiskHash||(d!.pageFileEvidence as any)?.afterDiskHash!==e.beforeDiskHash)))invalid();
      }
      if(command==='inspect' && (!Array.isArray(d!.applications) || !isHash(d!.snapshot) || !isHash(d!.diskHash) ||
        typeof d!.projectPath!=='string' || !session || pathKey(d!.projectPath as string)!==pathKey(session.workingPath))) invalid();
      if(command==='list' && (!Array.isArray(d!.objects) || typeof d!.complete!=='boolean' || typeof d!.total!=='number')) invalid();
      if(command==='read'||command==='change') {
        if(d!.objectId!==args.objectId || d!.applicationId!==args.applicationId || typeof d!.declaration!=='string' || typeof d!.implementation!=='string' || codeHash(d!.declaration as string,d!.implementation as string)!==d!.contentHash) invalid();
        if((d!.hasImplementation===false || ['gvl','structure','enum','array'].includes(d!.objectType as string)) && !declared(d)&&!(d!.objectType==='property'&&propertyEvidence(d)))invalid();
        if(command==='change' && ((args.objectType && d!.objectType!==args.objectType) || (args.implementation===undefined && !declared(d)) ||
          d!.contentHash!==codeHash(args.declaration,args.implementation ?? '') || !isHash(d!.snapshot) || !isHash(d!.diskHash) || !persisted() || d!.reopened!==true)) invalid();
        if(d!.objectType==='method'&&(d!.nativeTypeId!=='f8a58466-d7f6-439f-bbb8-d4600e41d099'||d!.hasImplementation!==true||typeof d!.parentId!=='string'||canonical(d!.parentPath)!==canonical((d!.path as string[])?.slice(0,-1))||d!.methodMetadataSource!=='native-method-type-parent-and-declaration-header'||!methodDeclarationMatches((d!.path as string[])?.at(-1)??'',d!.declaration as string,d!.methodReturnType as string,d!.access as string)||command==='change'&&(args.objectType!=='method'||args.parentId!==d!.parentId)))invalid();
        if(['property','property_get'].includes(d!.objectType as string)&&(!propertyEvidence(d)||command==='change'&&(d!.objectType!=='property_get'||args.objectType!=='property_get'||args.parentId!==d!.propertyId||args.fbId!==d!.fbId||args.expectedPropertyHash!==d!.propertyContentHash||args.expectedAccessorVersion!==d!.accessorVersion)))invalid();
      }
      if(command==='create_method'){
        const path_=d!.path as string[],factory=d!.factoryEvidence as any;
        if(d!.objectType!=='method'||d!.nativeTypeId!=='f8a58466-d7f6-439f-bbb8-d4600e41d099'||d!.hasImplementation!==true||d!.applicationId!==args.applicationId||d!.parentId!==args.parentId||d!.beforeParentHash!==args.expectedParentHash||d!.name!==args.name||d!.created!==true||typeof d!.objectId!=='string'||d!.objectId===args.parentId||path_?.at(-1)!==args.name||canonical(path_?.slice(0,-1))!==canonical(d!.parentPath)||!isHash(d!.snapshot)||d!.beforeSnapshot!==args.expectedSnapshot||d!.snapshot===args.expectedSnapshot||!isHash(d!.diskHash)||!persisted()||d!.reopened!==true||d!.checkpoint!==path.join(op.bridge!.directory,'checkpoint.project')||d!.methodMetadataSource!=='native-method-type-parent-and-declaration-header'||!methodDeclarationMatches(args.name,d!.declaration as string,args.returnType,args.access)||d!.methodReturnType!==args.returnType||d!.access!==args.access||d!.contentHash!==codeHash(args.declaration,args.implementation)||codeHash(d!.declaration as string,d!.implementation as string)!==d!.contentHash||d!.creationMethod!=='create_method(name, return_type, ImplementationLanguages.st)'||factory?.parentId!==args.parentId||factory?.objectId!==d!.objectId||factory?.nativeTypeId!==d!.nativeTypeId||!Array.isArray(factory?.embeddedObjectTypes)||!factory.embeddedObjectTypes.includes('3b83b776-fb25-43b8-99f2-3c507c9143fc')||canonical(factory?.arguments)!==canonical([args.name,args.returnType==='void'?'':args.returnType,'cc393387-a21c-4f68-a3e3-84c36951965d']))invalid();
      }
      if(command==='create_property'){
        if(!propertyCreationEvidence(d,args)||d!.applicationId!==args.applicationId||(d!.getter as any)?.applicationId!==args.applicationId||d!.created!==true||d!.beforeParentHash!==args.expectedParentHash||d!.beforeSnapshot!==args.expectedSnapshot||!isHash(d!.snapshot)||d!.snapshot===args.expectedSnapshot||!isHash(d!.diskHash)||!persisted()||d!.reopened!==true||d!.checkpoint!==path.join(op.bridge!.directory,'checkpoint.project')||d!.creationMethod!=='create_property(name, DINT, ImplementationLanguages.st); remove only new empty default Set')invalid();
      }
      if(command==='create_declaration') {
        const expectedPath=[...(session?.applications?.find(x=>x.applicationId===args.applicationId)?.path || []),args.name];
        if(args.objectType==='array' && d!.creationMethod!=="create_dut / DutType.Alias / ARRAY baseType ref: factory.json")invalid();
        if(args.objectType==='enum' && d!.creationMethod!=="create_dut / DutType.Enumeration / baseType='' ref: factory.json")invalid();
        if(!declared(d) || d!.objectType!==args.objectType || d!.applicationId!==args.applicationId || d!.parentId!==args.applicationId || d!.parentId!==args.parentId || d!.name!==args.name ||
          d!.created!==true || typeof d!.objectId!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(d!.objectId) || d!.objectId===args.parentId ||
          canonical(d!.path)!==canonical(expectedPath) || d!.contentHash!==codeHash(args.declaration,'') || codeHash(d!.declaration as string,'')!==d!.contentHash ||
          d!.beforeSnapshot!==args.expectedSnapshot || !isHash(d!.snapshot) || d!.snapshot===d!.beforeSnapshot || !isHash(d!.diskHash) ||
          d!.checkpoint!==path.join(op.bridge!.directory,'checkpoint.project') || !persisted() || d!.reopened!==true) invalid();
      }
      if(command==='create') {
        const expectedPath=[...(session?.applications?.find(x=>x.applicationId===args.applicationId)?.path || []),args.name];
        if(d!.applicationId!==args.applicationId || d!.parentId!==args.parentId || d!.parentId!==args.applicationId || d!.name!==args.name ||
          d!.objectType!==(args.pouType==='function_block'?'function_block':'st_pou') || d!.language!=='ST' ||
          (d!.hasImplementation!==true&&(args.pouType!=='function_block'||d!.hasImplementation!==undefined)) || d!.created!==true || typeof d!.objectId!=='string' ||
          !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(d!.objectId) || d!.objectId===args.parentId ||
          canonical(d!.path)!==canonical(expectedPath) || typeof d!.declaration!=='string' || typeof d!.implementation!=='string' ||
          !pouDeclarationMatches(args.pouType,args.name,d!.declaration as string,args.returnType) ||
          (d!.pouType!==undefined?d!.pouType!==args.pouType:args.pouType!=='function_block') ||
          (args.pouType==='function'?d!.returnType?.toString().toUpperCase()!==args.returnType:d!.returnType!==undefined) ||
          codeHash(d!.declaration as string,d!.implementation as string)!==d!.contentHash || d!.contentHash!==codeHash(args.declaration,args.implementation) ||
          d!.beforeSnapshot!==args.expectedSnapshot || !isHash(d!.snapshot) || d!.snapshot===d!.beforeSnapshot || !isHash(d!.diskHash) ||
          d!.checkpoint!==path.join(op.bridge!.directory,'checkpoint.project') || !persisted() || d!.reopened!==true) invalid();
      }
      if(command==='build') {
        if(d!.applicationId!==args.applicationId || d!.targetKind!==(args.targetKind || 'application') || d!.completed!==true || d!.diagnosticsComplete!==true || typeof d!.buildPassed!=='boolean' || !Array.isArray(d!.diagnostics) || !isHash(d!.snapshot) || !isHash(d!.diskHash)) invalid();
        const diagnostics=d!.diagnostics as any[];
        if(diagnostics.some(m=>typeof m.text!=='string'||!['fatalerror','error','warning','information','info','text'].includes(m.severity)) || d!.buildPassed!==!diagnostics.some(m=>['fatalerror','error'].includes(m.severity))) invalid();
      }
      if(command==='task_update') {
        const before=d!.before as any,after=d!.after as any;
        if(!before||!after||d!.projectId!==args.projectId||d!.applicationId!==args.applicationId||d!.taskId!==args.taskId||
          d!.configurationVersionScheme!==TASK_CONFIGURATION_SCHEME||!isHash(d!.snapshot)||!isHash(d!.diskHash)||
          before.projectId!==args.projectId||after.projectId!==args.projectId||before.applicationId!==args.applicationId||after.applicationId!==args.applicationId||
          before.projectPath!==after.projectPath||pathKey(before.projectPath)!==pathKey(session!.workingPath)||
          !Array.isArray(before.tasks)||!Array.isArray(after.tasks)||before.enumerationFailures?.length!==0||after.enumerationFailures?.length!==0||
          before.tasks.some((t:any)=>t.unavailableFields?.length!==0||t.callsComplete!==true)||
          taskConfigurationVersion(before)!==args.expectedTaskVersion||taskConfigurationVersion(after)!==d!.configurationVersion||d!.taskConfigurationVersion!==d!.configurationVersion)invalid();
        const expected=structuredClone(before),rows=expected.tasks.filter((t:any)=>t.taskId===args.taskId);
        if(rows.length!==1||rows[0].rawFields.kind_of_task!=='Cyclic'||rows[0].rawFields.interval_unit!=='ms')invalid();
        const actions:any[]=[];
        if(args.intervalMs!==undefined&&configuredIntervalMs(rows[0].rawFields)!==args.intervalMs){rows[0].rawFields.interval='t#'+args.intervalMs+'ms';actions.push({field:'interval',nativeValue:'t#'+args.intervalMs+'ms'});}
        if(args.priority!==undefined&&Number(rows[0].rawFields.priority)!==args.priority){rows[0].rawFields.priority=String(args.priority);actions.push({field:'priority',nativeValue:String(args.priority)});}
        if(taskConfigurationVersion(expected)!==taskConfigurationVersion(after)||d!.changed!==(actions.length>0)||
          canonical((d!.actions as any[])?.map(({field,nativeValue,status,readback}:any)=>({field,nativeValue,status,readback})))!==canonical(actions.map(a=>({...a,status:'succeeded',readback:a.nativeValue}))))invalid();
        if(d!.changed===true&&(d!.reopened!==true||!persisted()||d!.checkpoint!==path.join(op.bridge!.directory,'checkpoint.project')))invalid();
        if(d!.changed===false&&(d!.noOp!==true||d!.reopened!==false||d!.diskHash!==args.expectedDiskHash))invalid();
        d!.buildApplicable=d!.changed===true?false:buildApplies(session,d);
      }
      if(command==='save') {
        if(d!.saved!==true || d!.reopened!==true || d!.snapshot!==args.expectedSnapshot || !isHash(d!.diskHash)) invalid();
        d!.buildApplicable=buildApplies(session,d);
      }
    }
  }
  private async execute(op:Operation):Promise<Reply> {
    const a=op.args;
    if(op.activation) {
      const registry=await this.store.registry();
      if(registry.activeProjectId!==op.activation.previousActiveProjectId || registry.revision!==op.activation.revision)
        throw new DomainError('conflict','ACTIVE_CHANGED','受理后活动工程或登记状态改变，未切换');
      if(op.tool==='project_create') {
        const target=await reserveProject(this.store,op,registry);
        await guardNewPath(target);await maintenanceGuard();
        op.bridge={directory:this.store.file('ipc/'+op.operationId)};await this.store.saveOp(op);
        const result=replySchema.parse(await this.adapter.execute({operationId:op.operationId,command:'new_project',projectPath:target,args:{preset:op.creation!.preset}},
          op.bridge.directory,async pid=>{op.bridge!.pid=pid;await this.store.saveOp(op);}));
        await createdSession(this.store,op,result);
        // Validation/registration occurs in finish only after final file evidence.
        return result;
      }
      let session:Session|undefined;
      if(op.tool==='project_activate') {
        session=registry.projects.find(s=>s.projectId===a.projectId);
        if(!session)throw new DomainError('failed','PROJECT_NOT_FOUND','未找到已登记工程');
      } else if(op.tool==='project_open') {
        session=await bindDirect(this.store,op,registry,this.config.testMode);
      } else {
        if(!path.isAbsolute(a.sourcePath)) throw new DomainError('failed','ABSOLUTE_PATH_REQUIRED','源工程必须使用绝对路径');
        // 已登记路径即使源文件不在，也可使用仍完整的原工作副本；新路径必须实际解析。
        session=registry.projects.find(s=>s.storageMode!=='direct'&&[s.sourcePath,s.workingPath].some(p=>pathKey(p)===pathKey(a.sourcePath)));
        if(!session) {
          const source=await fs.realpath(a.sourcePath);
          session=registry.projects.find(s=>s.storageMode!=='direct'&&[s.sourcePath,s.workingPath].some(p=>pathKey(p)===pathKey(source)));
          if(!session) {
            // 首次多应用选择失败的副本保留在原操作中；再次精确选择时复用它，避免重复复制。
            const candidate=(await this.store.operations()).find(o=>o.operationId!==op.operationId && o.tool==='project_open_copy' &&
              ['APPLICATION_SELECTION_REQUIRED','APPLICATION_NOT_FOUND'].includes(o.response?.error?.code || '') && o.project && pathKey(o.project.sourcePath)===pathKey(source));
            session=candidate?.project;
            if(!session)session=await this.copySource(op,source);
          }
        }
      }
      await assertNotIsolated(this.store,session.projectId,[session.sourcePath,session.workingPath]);
      op.project={...session};await this.store.saveOp(op);
      await this.store.acquire(session.sourcePath);
      const diskHash=digest(await fs.readFile(session.workingPath));
      if(session.diskHash && session.diskHash!==diskHash)
        throw new DomainError('conflict','WORKING_COPY_CHANGED','已登记副本在外部发生变化，原活动工程保留；需先核对原副本与证据');
      return this.bridge(op,'inspect',session,a);
    }
    const s=await this.store.session();
    if(!s || !op.project || s.projectId!==op.project.projectId || s.projectId!==a.projectId)
      throw new DomainError('conflict','PROJECT_NOT_ACTIVE','排队请求的原工程已非活动工程，未派发');
    const nativeQuery=['project_structure','device_inspect'].includes(op.tool);
    if(!nativeQuery&&(s.applicationId!==a.applicationId || (s.targetKind || 'application')!==(a.targetKind || 'application') ||
      (a.targetKind==='pool'?a.applicationId!==null:typeof a.applicationId!=='string')))
      throw new DomainError('conflict','TARGET_MISMATCH','projectId / applicationId 与受管理会话不匹配');
    await this.store.acquire(s.sourcePath);
    // 身份已在受理和执行前双重核对；记录执行当时的编译证据，供晚到结果独立核对。
    op.project={...s};await this.store.saveOp(op);
    if(op.tool==='task_config_update') {
      validateTaskPatch(a);
      if(a.expectedDiskHash!==s.diskHash||digest(await fs.readFile(s.workingPath))!==a.expectedDiskHash)
        throw new DomainError('conflict','TASK_DISK_CHANGED','任务写入前磁盘版本与登记/请求不一致；未派发IDE');
      return this.bridge(op,'task_update',s,a);
    }
    if(op.tool==='project_compare') {
      if(a.mode==='compare')return this.compareRecorded(op,s);
      if(s.storageMode==='direct'&&a.origin==='registered-source')throw new DomainError('unsupported','NO_REGISTERED_SOURCE','直接工程没有不变的来源文件；请使用 current-project 和写入前真实采集的历史快照');
      const original=a.origin==='registered-source',projectPath=original?s.sourcePath:s.workingPath,expected=original?s.sourceHash:s.diskHash;
      const currentHash=digest(await fs.readFile(projectPath));
      if(currentHash!==expected)throw new DomainError('conflict','COMPARE_DISK_CHANGED','采集前文件与登记版本不一致；未启动 IDE 或保存');
      return this.bridge(op,'compare_capture',{...s,workingPath:projectPath,diskHash:expected,...(s.editMode==='direct'?{directPath:await fs.realpath(projectPath)}:{})},{...a,readDiskHash:currentHash});
    }
    if(['project_search','variable_inspect','task_inspect','project_structure','device_inspect','library_inspect'].includes(op.tool)) {
      if(op.tool==='project_search' && (a.offset>0&&!a.expectedVersion || new Set(a.areas).size!==a.areas.length))
        throw new DomainError('failed','SEARCH_PAGE_VERSION_REQUIRED','续页必须携带首个结果版本，搜索区域不能重复');
      if(op.tool==='project_search'&&a.matchMode==='identifier'&&(!singleIdentifier(a.query)||a.areas.includes('name')))
        throw new DomainError('failed','SEARCH_IDENTIFIER_QUERY','identifier只接受单个标识符且明确指定源码区域；未派发IDE');
      const currentHash=digest(await fs.readFile(s.workingPath));
      if(currentHash!==s.diskHash)throw new DomainError('conflict','READ_DISK_CHANGED','正式读取前工作副本与登记版本不一致；未启动 IDE 或保存');
      if(op.tool==='project_search'&&a.expectedVersion)return this.searchPage(op,s,currentHash);
      if((a.valueRead||a.fieldRead||a.sourceRead)&&a.offset!==0)throw new DomainError('conflict','VALUE_PAGE_OFFSET','原文详情读取时外层offset必须为0');
      if((nativeQuery||op.tool==='library_inspect'||op.tool==='variable_inspect')&&(a.offset>0||a.expectedVersion||a.valueRead||a.fieldRead||a.sourceRead))return this.nativePage(op,s,currentHash);
      return this.bridge(op,({project_search:'search',variable_inspect:'search',task_inspect:'tasks',library_inspect:'libraries',project_structure:'structure',device_inspect:'device'} as Record<string,string>)[op.tool],s,{...a,readDiskHash:currentHash});
    }
    if(op.tool==='declaration_create') {
      if(s.targetKind==='pool' || a.parentId!==s.applicationId)throw new DomainError('conflict','PARENT_MISMATCH','仅允许选定 Application 根节点');
      if(!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(a.name) || !declarationMatches(a.objectType,a.name,a.declaration,true))
        throw new DomainError('failed','INVALID_DECLARATION','仅支持完整 GVL、同名 STRUCT 或普通枚举；枚举成员显式十进制整数-32768..32767、名称和值不重复，无属性/显式基类型/表达式；数组仅同名一维ARRAY[十进制下界..上界] OF DINT，0<=下界<=上界<=255，无初始化或其他别名');
    }
    if(op.tool==='pou_create') {
      if(s.targetKind==='pool' || a.parentId!==s.applicationId)
        throw new DomainError('conflict','PARENT_MISMATCH','仅允许在选定 Application GUID 根节点创建 ST POU');
      if(!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(a.name) || !pouDeclarationMatches(a.pouType,a.name,a.declaration,a.returnType))
        throw new DomainError('failed','INVALID_POU_DECLARATION','ST POU 声明类型/名称必须匹配；FUNCTION 必须显式声明与参数一致的 DINT/BOOL/INT/REAL/TIME 返回类型');
    }
    if(op.tool==='method_create'){
      if(!methodDeclarationMatches(a.name,a.declaration,a.returnType,a.access))throw new DomainError('failed','INVALID_METHOD_DECLARATION','Method同名完整首部须匹配显式PUBLIC及void/DINT返回类型；未派发IDE');
      if(a.expectedDiskHash!==s.diskHash||digest(await fs.readFile(s.workingPath))!==a.expectedDiskHash)throw new DomainError('conflict','METHOD_DISK_CHANGED','Method创建前磁盘版本不匹配；未派发IDE');
    }
    if(op.tool==='property_create'){
      const h=propertyHeader(a.declaration,true);
      if(!h||h.name.toLowerCase()!==a.name.toLowerCase()||!getterDeclarationMatches(a.getDeclaration))throw new DomainError('failed','INVALID_PROPERTY_DECLARATION','只接受完整同名PUBLIC DINT属性和限定Get局部声明；未派发IDE');
      if(a.expectedDiskHash!==s.diskHash||digest(await fs.readFile(s.workingPath))!==a.expectedDiskHash)throw new DomainError('conflict','PROPERTY_DISK_CHANGED','属性创建前磁盘版本不匹配；未派发IDE');
    }
    if(op.tool==='code_apply_change'&&a.objectType==='property_get'){
      if(!getterDeclarationMatches(a.declaration))throw new DomainError('failed','INVALID_GET_DECLARATION','Get只允许限定VAR局部声明；未派发IDE');
      if(a.expectedDiskHash!==s.diskHash||a.expectedSnapshot!==s.snapshot||digest(await fs.readFile(s.workingPath))!==a.expectedDiskHash)throw new DomainError('conflict','PROPERTY_VERSION_CHANGED','Get修改前工程或磁盘版本不匹配；未派发IDE');
    }
    const commands:Record<string,string>={object_list:'list',object_read:'read',pou_create:'create',method_create:'create_method',property_create:'create_property',declaration_create:'create_declaration',code_apply_change:'change',project_build:'build',project_save:'save'};
    const command=commands[op.tool];
    if(!command) throw new DomainError('unsupported','TOOL_UNSUPPORTED','不支持此工程操作');
    if(command==='save' && s.lastBuild?.snapshot===a.expectedSnapshot && s.lastBuild?.diskHash && digest(await fs.readFile(s.workingPath))!==s.lastBuild.diskHash)
      throw new DomainError('conflict','BUILD_SNAPSHOT_STALE','编译后磁盘工程内容发生变化，需要重新读取并编译');
    return this.bridge(op,command,s,a);
  }
  private async searchPage(op:Operation,s:Session,currentHash:string):Promise<Reply> {
    const a=op.args;
    const source=(await this.store.operations()).find(o=>o.status==='succeeded'&&o.tool==='project_search'&&o.args.projectId===a.projectId&&
      o.args.applicationId===a.applicationId&&(o.args.targetKind??'application')===(a.targetKind??'application')&&o.args.offset===0&&!o.args.expectedVersion&&o.response?.data?.version===a.expectedVersion);
    const conflict=()=>{throw new DomainError('conflict','SEARCH_VERSION_CHANGED','搜索工程、查询、模式、范围或文件版本不匹配，请从首个查询重新开始；未派发IDE');};
    if(!source)conflict();
    const original=source!,sa=original.args;
    const invalid=()=>{throw new DomainError('unknown','SEARCH_EVIDENCE_INVALID','原搜索归属、结果或原始证据无法确认，保持冻结；未重新采集');};
    if(!schemas.project_search.safeParse(sa).success||!Array.isArray(sa.areas)||original.response!.status!=='succeeded'||original.response!.operationId!==original.operationId||original.response!.requestId!==original.requestId)invalid();
    if(typeof original.project?.workingPath!=='string'||typeof original.project?.sourcePath!=='string'||!path.isAbsolute(original.project.workingPath)||!path.isAbsolute(original.project.sourcePath))invalid();
    if(!original.project||original.project.projectId!==s.projectId||pathKey(original.project.workingPath)!==pathKey(s.workingPath)||
      pathKey(original.project.sourcePath)!==pathKey(s.sourcePath)||original.project.applicationId!==sa.applicationId||
      !original.bridge||original.bridge.directory!==this.store.file('ipc/'+original.operationId))invalid();
    let raw:Reply;
    try {raw=replySchema.parse(await readJson(path.join(original.bridge!.directory,'observed-after-exit.json')));}catch {return invalid();}
    if(raw.operationId!==original.operationId||raw.status!=='succeeded')invalid();
    const old=original.response!.data!.searchVersion===undefined&&original.response!.data!.matchMode===undefined&&sa.matchMode===undefined;
    const oldIdentifier=original.response!.data!.searchVersion===SEARCH_RESULT_VERSION&&sa.matchMode==='identifier'&&original.response!.data!.lexerVersion===LEGACY_IDENTIFIER_LEXER_VERSION;
    let verified:Reply;
    try {
      verified=searchResult(raw,sa,{legacy:old,identifierVersion:oldIdentifier?LEGACY_IDENTIFIER_LEXER_VERSION:undefined});
      this.validateEvidence(original,verified,original.project);
      if(canonical(verified.data)!==canonical(original.response!.data))invalid();
    } catch {return invalid();}
    if((raw.data?.scope as any)?.propertyCoverageVersion!==PROPERTY_COVERAGE_VERSION&&(raw.data?.scope as any)?.skippedObjects?.some((o:any)=>[PROPERTY_NATIVE,ACCESSOR_NATIVE].includes(o.nativeTypeId)))
      throw new DomainError('conflict','PROPERTY_COVERAGE_UPGRADE','合法旧检索清单跳过了Property/Get；请重新首查，未派发IDE或冻结');
    if((raw.data?.scope as any)?.methodCoverageVersion===undefined&&(raw.data?.scope as any)?.skippedObjects?.some((o:any)=>o.nativeTypeId==='f8a58466-d7f6-439f-bbb8-d4600e41d099'))
      throw new DomainError('conflict','METHOD_COVERAGE_UPGRADE','合法旧检索清单跳过了Method，覆盖范围已扩展；请重新首查，未派发IDE或冻结');
    if(original.response!.data!.diskHash!==currentHash||sa.query!==a.query||sa.caseSensitive!==a.caseSensitive||
      canonical([...sa.areas].sort())!==canonical([...a.areas].sort())||sa.maxResults!==a.maxResults||(sa.matchMode??'literal')!==(a.matchMode??'literal')||
      a.offset>(original.response!.data!.page as any).retainedMatches)conflict();
    if(old)throw new DomainError('conflict','SEARCH_SCANNER_VERSION_CHANGED','合法旧字面清单已核实，但检索版本已升级；请显式从第一页重新搜索，未冻结或派发IDE');
    if(oldIdentifier)throw new DomainError('conflict','SEARCH_LEXER_VERSION_CHANGED','合法旧标识符清单已按原词法核实，直接地址边界已修正；请显式重新首查，未冻结或派发IDE');
    if(original.response!.data!.searchVersion!==SEARCH_RESULT_VERSION||original.response!.data!.lexerVersion!==((sa.matchMode??'literal')==='identifier'?IDENTIFIER_LEXER_VERSION:null))invalid();
    const result=searchResult({...raw,operationId:op.operationId},a,{origin:{kind:'recorded-inventory',inventoryOperationId:original.operationId}});
    if(result.status!=='succeeded')invalid();
    const after=digest(await fs.readFile(s.workingPath));if(after!==currentHash)throw new DomainError('unknown','READ_ONLY_FILE_CHANGED','搜索续页期间文件变化，保持冻结；未启动IDE');
    if(result.data)result.data.pageFileEvidence={beforeDiskHash:currentHash,afterDiskHash:after};
    this.validateEvidence(op,result,s);return result;
  }
  private async nativePage(op:Operation,s:Session,currentHash:string):Promise<Reply> {
    const a=op.args;
    if(!a.expectedVersion)throw new DomainError('conflict','NATIVE_PAGE_VERSION_REQUIRED','续页必须使用原清单版本，未启动 IDE');
    const source=(await this.store.operations()).find(o=>o.status==='succeeded'&&o.tool===op.tool&&o.args.projectId===a.projectId&&o.args.deviceId===a.deviceId&&o.args.applicationId===a.applicationId&&o.args.targetKind===a.targetKind&&
      o.args.offset===0&&!o.args.valueRead&&!o.args.fieldRead&&!o.args.sourceRead&&(o.response?.data?.readOrigin as any)?.kind==='ide'&&o.response?.data?.version===a.expectedVersion);
    if(!source || source.response!.data!.diskHash!==currentHash || source.args.maxNodes!==a.maxNodes || source.args.maxParameters!==a.maxParameters || source.args.maxReferences!==a.maxReferences ||
      op.tool==='variable_inspect'&&(source.args.objectId!==a.objectId||source.args.name!==a.name||source.args.caseSensitive!==a.caseSensitive||source.args.maxObjects!==a.maxObjects||source.args.maxEntries!==a.maxEntries||
        (source.args.includeInitializerMembers===true)!==(a.includeInitializerMembers===true)||a.includeInitializerMembers===true&&(source.args.maxInitializerMembers??200)!==(a.maxInitializerMembers??200)))
      throw new DomainError('conflict','NATIVE_VERSION_CHANGED','未找到同一工程/设备/范围/磁盘版本的原清单，请从第一页重新查询');
    if(!source.project||pathKey(source.project.workingPath)!==pathKey(s.workingPath)||!source.bridge)
      throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','原清单归属或证据目录无法确认，保持冻结');
    let raw:Reply;
    try {raw=replySchema.parse(await readJson(path.join(source.bridge.directory,'observed-after-exit.json')));}
    catch {throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','原清单记录缺失或损坏，保持冻结，不重新派发');}
    if(raw.operationId!==source.operationId || raw.status!=='succeeded')throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','原清单证据无法确认，未重新读取或派发');
    if(op.tool==='variable_inspect'&&a.includeInitializerMembers===true){
      // Only the explicit new mode is recomputed here. Legacy v2 table results
      // and identities retain their existing path; do not silently reparse pages.
      const invalid=()=>{throw new DomainError('unknown','VARIABLE_MEMBER_EVIDENCE_INVALID','原成员清单身份、原文或已发布结果无法核实，保持冻结；未派发IDE');};
      if(!schemas.variable_inspect.safeParse(source.args).success||source.response!.operationId!==source.operationId||source.response!.requestId!==source.requestId||
        source.project.projectId!==s.projectId||source.project.applicationId!==a.applicationId||pathKey(source.project.sourcePath)!==pathKey(s.sourcePath)||source.bridge.directory!==this.store.file('ipc/'+source.operationId))invalid();
      try{
        const verified=variableResult(raw,source.args);
        this.validateEvidence(source,verified,source.project);
        if(canonical(verified.data)!==canonical(source.response!.data))invalid();
      }catch{return invalid();}
    }
    if(op.tool==='variable_inspect'&&(raw.data?.scope as any)?.propertyCoverageVersion!==PROPERTY_COVERAGE_VERSION&&(raw.data?.scope as any)?.skippedObjects?.some((o:any)=>[PROPERTY_NATIVE,ACCESSOR_NATIVE].includes(o.nativeTypeId))){
      try{const verified=variableResult(raw,source.args);this.validateEvidence(source,verified,source.project);if(canonical(verified.data)!==canonical(source.response!.data))throw Error('Old published table differs');}
      catch{throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','旧属性覆盖清单证据无法核实，保持冻结');}
      throw new DomainError('conflict','PROPERTY_COVERAGE_UPGRADE','合法旧变量清单跳过了Property/Get；请重新首查，未派发IDE或冻结');
    }
    if(op.tool==='variable_inspect'&&(raw.data?.scope as any)?.methodCoverageVersion===undefined&&(raw.data?.scope as any)?.skippedObjects?.some((o:any)=>o.nativeTypeId==='f8a58466-d7f6-439f-bbb8-d4600e41d099')){
      try{const verified=variableResult(raw,source.args);this.validateEvidence(source,verified,source.project);if(canonical(verified.data)!==canonical(source.response!.data))throw Error('Old published table differs');}
      catch{throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','旧变量清单证据无法核实，保持冻结');}
      throw new DomainError('conflict','METHOD_COVERAGE_UPGRADE','合法旧变量清单跳过了Method；请重新首查，未重新采集或冻结');
    }
    if(op.tool==='variable_inspect'&&source.response!.data!.parserVersion!==VARIABLE_PARSER_VERSION){
      // Verify the old native inventory before distinguishing a normal parser
      // upgrade from corrupt evidence. No old table is silently reinterpreted.
      const verified=variableResult({...raw,operationId:op.operationId},{...a,offset:0,expectedVersion:undefined,sourceRead:undefined});
      this.validateEvidence({...op,args:{...a,expectedVersion:undefined}},verified,s);
      const previous=source.response!.data!.parserVersion;
      if(previous===undefined||previous==='declaration-variables-v1')
        throw new DomainError('conflict','VARIABLE_PARSER_VERSION_CHANGED','声明解析器已升级，原版本不能续页或读详情；请显式从首个查询重新开始，未冻结、未派发IDE');
      throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','原变量表解析器版本记录无法确认，保持冻结');
    }
    const result=op.tool==='variable_inspect'?variableResult({...raw,operationId:op.operationId},a,{kind:'recorded-inventory',inventoryOperationId:source.operationId}):nativeInventoryResult({...raw,operationId:op.operationId},a,op.tool,{kind:'recorded-inventory',inventoryOperationId:source.operationId});
    if(result.status==='conflict'&&result.error?.code==='NATIVE_VERSION_CHANGED')throw new DomainError('unknown','NATIVE_INVENTORY_UNCONFIRMED','原清单证据与已记录版本不一致，保持冻结');
    const after=digest(await fs.readFile(s.workingPath));
    if(after!==currentHash)throw new DomainError('unknown','READ_ONLY_FILE_CHANGED','分页读取期间文件变化，未启动 IDE，保持冻结');
    if(result.data)result.data.pageFileEvidence={beforeDiskHash:currentHash,afterDiskHash:after};
    this.validateEvidence(op,result,s);return boundNativeReply(result);
  }
  private async recordedComparisonSnapshot(id:string):Promise<Snapshot> {
    const source=await this.store.operation(id);
    if(!source)throw new DomainError('failed','COMPARE_BASELINE_MISSING','缺少指定快照记录，无法比较；未推断对象不存在');
    if(source.tool!=='project_compare'||source.args.mode!=='capture'||source.status!=='succeeded')
      throw new DomainError('conflict','COMPARE_CAPTURE_REQUIRED','只能比较本工具已成功采集的原始工程记录');
    const original=source.project,registered=(await this.store.registry()).projects.find(s=>s.projectId===original?.projectId);
    if(!original||!registered||!source.bridge||source.bridge.directory!==this.store.file('ipc/'+source.operationId)||
      pathKey(registered.sourcePath)!==pathKey(original.sourcePath)||pathKey(registered.workingPath)!==pathKey(original.workingPath))
      throw new DomainError('unknown','COMPARE_EVIDENCE_INVALID','快照工程归属或原证据目录无法确认，保持冻结');
    await assertNotIsolated(this.store,original.projectId,[original.sourcePath,original.workingPath]);
    await this.store.acquire(original.sourcePath);
    let snapshot:Snapshot;
    try {
      const raw=replySchema.parse(await readJson(path.join(source.bridge.directory,'observed-after-exit.json')));
      snapshot=captureSnapshot(raw,source.args,original,source.operationId);
    } catch(e:any) {throw new DomainError('unknown','COMPARE_EVIDENCE_INVALID','原生快照证据缺失/损坏，未重新采集：'+e.message);}
    if((source.response?.data?.snapshot as any)?.version!==snapshot.version)
      throw new DomainError('unknown','COMPARE_EVIDENCE_INVALID','原始快照与已发布版本不一致，保持冻结');
    return snapshot;
  }
  private async compareRecorded(op:Operation,s:Session):Promise<Reply> {
    await maintenanceGuard();await assertNotIsolated(this.store,s.projectId,[s.sourcePath,s.workingPath]);
    const a=op.args,currentHash=digest(await fs.readFile(s.workingPath));
    if(currentHash!==s.diskHash)throw new DomainError('conflict','COMPARE_DISK_CHANGED','目标副本已在外部变化；未混合当前文件和旧快照');
    const baseline=await this.recordedComparisonSnapshot(a.baselineOperationId),target=await this.recordedComparisonSnapshot(a.targetOperationId);
    if(target.identity.projectId!==s.projectId||target.identity.applicationId!==a.applicationId)
      throw new DomainError('conflict','COMPARE_TARGET_MISMATCH','目标快照不属于当前指定工程/应用');
    const expectedPath=target.identity.origin==='registered-source'?s.sourcePath:s.workingPath;
    if(digest(await fs.readFile(expectedPath))!==target.identity.diskHash)
      throw new DomainError('conflict','COMPARE_VERSION_CHANGED','目标文件版本已不再对应快照；未混合版本');
    const result=compareReply(baseline,target,a);
    if(digest(await fs.readFile(s.workingPath))!==currentHash||digest(await fs.readFile(expectedPath))!==target.identity.diskHash)
      throw new DomainError('unknown','READ_ONLY_FILE_CHANGED','对比期间文件变化，结果未确认，保持冻结');
    return result;
  }
  private async copySource(op:Operation,source:string):Promise<Session> {
      await assertNotIsolated(this.store,undefined,[source]);
      if(!this.config.testMode && path.extname(source).toLowerCase()!=='.project')
        throw new DomainError('unsupported','PROJECT_FORMAT','仅接受 .project 工程');
      const projectId=randomUUID();const directory=this.store.file('projects/'+projectId);
      const workingPath=path.join(directory,path.basename(source));
      const sourceHash=digest(await fs.readFile(source));
      const session:Session={projectId,sessionId:randomUUID(),sourcePath:source,workingPath,sourceHash};
      // 首先固定候选身份。复制/发布中断时保留这份原记录，不能另造工程或重放。
      op.project=session;await this.store.saveOp(op);
      await this.store.acquire(source);
        await fs.mkdir(directory,{recursive:true});
        if(this.config.testMode) await fs.copyFile(source,workingPath,1);
        else {
          // 辅助程序只复制被排他打开的磁盘工程。锁文件和打开失败都明确拒绝。
          const locks=[source+'.lock',source+'.lck',source+'.~lock'];
          if((await Promise.all(locks.map(f=>fs.access(f).then(()=>true,()=>false)))).some(Boolean))
            throw new DomainError('conflict','SOURCE_BUSY','源工程存在 IDE 锁；请先保存并关闭该测试样本');
          try { await promisify(execFile)('powershell.exe',['-NoProfile','-File',path.join(ROOT,'scripts','copy-closed-project.ps1'),'-SourcePath',source,'-DestinationPath',workingPath],{windowsHide:true,timeout:15000}); }
          catch { throw new DomainError('conflict','SOURCE_BUSY','无法排他读取源工程；请保存并关闭样本，检查访问权限'); }
        }
        if(sourceHash!==digest(await fs.readFile(source)) || sourceHash!==digest(await fs.readFile(workingPath)))
          throw new DomainError('conflict','SOURCE_CHANGED','复制期间源工程发生变化，未打开副本');
      return session;
  }
}
