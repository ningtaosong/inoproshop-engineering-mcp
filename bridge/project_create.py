# -*- coding: utf-8 -*-
"""Fixed OEM AM610 initialization only. No user script/template input."""
import os

DEVICE={'type':4102,'id':'10f4 0002','version':'3.5.11.11'}
DECLARATION=u'PROGRAM PLC_PRG\nVAR\nEND_VAR'
LIBRARY=u'InoParamsConfigLib, 1.0.0.0 (Inovance)'
WIZARD_SHA='7b1fbbf5316171a8ad883614000085b901016ee8abac60efd8524404339fd6ac'

def create_minimal(req,api):
    from System import Activator,Array,Object
    from System.Reflection import Assembly
    from System.IO import File
    text,publish=api['text'],api['publish']
    target=req['projectPath'];directory=os.path.dirname(req['resultPath'])
    staging=os.path.join(directory,'native-initialization');scratch=os.path.join(staging,os.path.basename(target))
    state=api['lifecycle_state'](project_path=scratch);events=[];started=False;published=False;response=None
    def stage(name,fn):
        event={'phase':name,'status':'started'};events.append(event)
        publish(os.path.join(directory,'creation-stage-%02d-start.json'%len(events)),dict(event))
        try:
            v=fn();event['status']='succeeded'
            publish(os.path.join(directory,'creation-stage-%02d-end.json'%len(events)),dict(event));return v
        except Exception as e:
            event['status']='failed';event['error']=api['exception_evidence'](e)
            publish(os.path.join(directory,'creation-stage-%02d-end.json'%len(events)),dict(event));raise
    def absent():
        if os.path.lexists(target):raise ValueError('Target already exists; no overwrite')
        for suffix in ('.lock','.lck','.~lock','.~u'):
            if os.path.lexists(target+suffix):raise ValueError('Target busy marker; no takeover')
    def verify(project):
        rows=list(api['walk'](project));devices=[(x,n) for x,n,a in rows if getattr(x,'is_device',False)]
        matches=[]
        for x,n in devices:
            ident=x.get_device_identification()
            if int(ident.type)==DEVICE['type'] and text(ident.id)==DEVICE['id'] and text(ident.version)==DEVICE['version']:matches.append((x,n))
        apps=[(x,n) for x,n,a in rows if getattr(x,'is_application',False)]
        if len(matches)!=1 or len(apps)!=1 or apps[0][1][:-1]!=matches[0][1]+['Plc Logic']:raise ValueError('Preset device/Application identity mismatch')
        app,names=apps[0];aid=text(app.guid).lower()
        pous=[(x,n) for x,n,a in rows if api['st_object'](x)]
        if len(pous)!=1 or pous[0][1]!=names+['PLC_PRG']:raise ValueError('Preset must contain exactly one root ST PLC_PRG')
        prg=api['read_object'](pous[0][0],pous[0][1],aid)
        if prg['declaration']!=DECLARATION or prg['implementation']!='' or prg.get('pouType')!='program':raise ValueError('Minimal PLC_PRG text/type differs')
        tasks=[(x,n,a) for x,n,a in rows if getattr(x,'is_task',False)]
        if len(tasks)!=1 or tasks[0][2]!=aid:raise ValueError('Preset cyclic task identity mismatch')
        task,path,_=tasks[0];calls=[[text(v) for v in task.pous[i]] for i in range(len(task.pous))]
        if text(task.kind_of_task)!='Cyclic' or text(task.interval).lower()!='t#20ms' or len(calls)!=1 or calls[0][0]!='PLC_PRG':raise ValueError('Preset task20ms/call mismatch')
        refs=[ref for x,n,a in rows if text(x.type).lower()=='adb5cb65-8e1d-4a00-b70a-375ea27582f3' for ref in x.references if ref.name=='#InoParamsConfigLib']
        if len(refs)!=1 or text(refs[0].effective_resolution)!=LIBRARY:raise ValueError('Preset initialization library resolution not confirmed')
        return {'device':dict(DEVICE),'deviceObjectId':text(matches[0][0].guid).lower(),'devicePath':matches[0][1],
          'applicationId':aid,'applicationPath':names,'plcPrg':prg,
          'task':{'objectId':text(task.guid).lower(),'path':path,'kind':text(task.kind_of_task),'interval':text(task.interval),'calls':calls},
          'libraryInitialization':{'placeholder':text(refs[0].name),'defaultResolution':text(refs[0].default_resolution),'effectiveResolution':text(refs[0].effective_resolution),'basis':'native-set_redirection-and-getter; not independent all-library-loaded proof'}}
    try:
        if req['args']!={'preset':'am610-minimal-v1'}:raise ValueError('Unsupported preset')
        if api['projects'].primary is not None:raise ValueError('Unowned open project; refusing takeover')
        absent()
        root=os.path.dirname(os.path.dirname(req['ideExecutable']))
        dll=os.path.join(root,'PlugIns','94d17eae-b0a1-4b4d-89d1-2e201347a885','1.9.1.6','InoProjectWizards.plugin.dll')
        if api['file_hash'](dll)!=WIZARD_SHA:raise ValueError('Native wizard differs from verified 1.9.1.6 build')
        installed=os.path.join(root,'Repository','Managed Libraries','Inovance','InoParamsConfigLib','1.0.0.0','InoParamsConfigLib.compiled-library-ge33')
        if not os.path.isfile(installed):raise ValueError('Required installed preset library unavailable; no download attempted')
        assembly=Assembly.LoadFrom(dll);env=assembly.GetType('Inovance.InoPro.InoProjectWizards.APEnvironment')
        repo=env.GetProperty('DeviceRepository').GetValue(None,None)
        desc=repo.GetDevice(repo.CreateDeviceIdentification(DEVICE['type'],DEVICE['id'],DEVICE['version']))
        if desc is None:raise ValueError('Exact installed AM610 description unavailable')
        factories=[f for f in env.GetMethod('CreateImplementationObjectFactories').Invoke(None,None) if f.GetType().FullName=='Inovance.InoPro.InoSTObject.STImplementationObjectFactory']
        if len(factories)!=1:raise ValueError('Exact installed ST factory unavailable')
        factory=factories[0];wizard=Activator.CreateInstance(assembly.GetType('Inovance.InoPro.InoProjectWizards.InovanceProjectWizard'))
        method=[m for m in wizard.GetType().GetMethods() if m.Name=='Execute' and len(m.GetParameters())==5]
        if len(method)!=1:raise ValueError('Verified native wizard overload unavailable')
        os.mkdir(staging)
        publish(os.path.join(directory,'native-factory.json'),{'method':text(method[0]),'name':os.path.basename(target),'location':staging,'device':DEVICE,
          'factoryType':text(factory.GetType().FullName),'factoryGuid':text(factory.Guid),'wizardSha256':WIZARD_SHA,'template':'none; native factory, not copied user engineering'})
        started=True
        native=stage('native-create',lambda:method[0].Invoke(wizard,Array[Object]([os.path.basename(target),staging,desc,factory.Guid,factory])))
        if native is None or os.path.normcase(text(native.Path))!=os.path.normcase(scratch):raise ValueError('Native new project path/result differs')
        project=api['projects'].get_by_path(scratch);state['project']=project
        if project is None:raise ValueError('Cannot acquire owned native project handle')
        tasks=[x for x,n,a in api['walk'](project) if getattr(x,'is_task',False)]
        if len(tasks)!=1:raise ValueError('Native task not unique')
        stage('initialize-cycle20ms',lambda:setattr(tasks[0],'interval','t#20ms'))
        refs=[ref for x,n,a in api['walk'](project) if text(x.type).lower()=='adb5cb65-8e1d-4a00-b70a-375ea27582f3' for ref in x.references if ref.name=='#InoParamsConfigLib']
        if len(refs)!=1:raise ValueError('Native initialization placeholder not unique')
        stage('initialize-installed-placeholder',lambda:refs[0].set_redirection(LIBRARY))
        before=stage('verify-native-preset',lambda:verify(project));before_snapshot=api['snapshot'](project)
        state['saveAttempts']+=1;stage('save-native-initialization',lambda:project.save())
        stage('close-native-initialization',lambda:api['lifecycle_close'](state,'initialization-close'))
        absent()
        # Never overwrite a race winner. This is the newly constructed native
        # initialization artifact, not a business working copy or user template.
        stage('publish-exclusive',lambda:File.Copy(scratch,target,False));published=True
        saved_hash=api['file_hash'](target)
        def guard_published():
            for suffix in ('.lock','.lck','.~lock','.~u'):
                if os.path.lexists(target+suffix):raise ValueError('Published target externally occupied; no takeover')
            api['direct_exclusive_probe'](target)
            if api['file_hash'](target)!=saved_hash:raise ValueError('Published target changed before reopen')
        stage('guard-published-target',guard_published)
        project=stage('reopen-specified-path',lambda:api['lifecycle_open'](state,target,'created-target-reopen'))
        after=stage('verify-reopened-preset',lambda:verify(project))
        if before!=after or api['snapshot'](project)!=before_snapshot:raise ValueError('Created identities/text/task changed after target reopen')
        stage('close-specified-path',lambda:api['lifecycle_close'](state,'created-target-close'))
        if api['file_hash'](target)!=saved_hash:raise ValueError('Created target changed during reopen/close')
        evidence=dict(after,preset='am610-minimal-v1',publishedExclusively=True,reopened=True,noBusinessCopy=True,
          savedDiskHash=saved_hash,initializationArtifact=scratch,stages=events)
        publish(os.path.join(directory,'creation-evidence.json'),evidence)
        response=api['success'](u'最小AM610原生工程已新建至指定路径并保存重开核对，按直接模式继续使用',
          {'projectPath':target,'editMode':'direct','applications':[{'applicationId':after['applicationId'],'path':after['applicationPath']}],
           'snapshot':before_snapshot,'diskHash':saved_hash,'created':True,'creationEvidence':evidence,'buildApplicable':False})
    except Exception as e:
        response=api['failure']('unknown' if started else 'failed','PROJECT_CREATE_INCOMPLETE',text(e),
          {'projectPath':target,'targetExists':os.path.lexists(target),'publishedConfirmed':published,'stages':events,'primaryException':api['exception_evidence'](e),'initializationArtifact':scratch})
    finally:
        try:api['lifecycle_close'](state,'creation-final-cleanup')
        except Exception as e:response=api['failure']('unknown','CREATE_CLOSE_FAILED',text(e),{'priorResult':response,'cleanupException':api['exception_evidence'](e)})
        if response is not None:response.setdefault('data',{})['lifecycle']=api['lifecycle_report'](state)
    return response
