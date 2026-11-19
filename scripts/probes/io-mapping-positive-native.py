# -*- coding: utf-8 -*-
"""One qualified mapping in a newly prepared offline AM610 test. Standalone IronPython."""
import imp
import io
import json
import os
import re
import sys
from System import DateTime
from System.IO import File
from System.Diagnostics import Process
from scriptengine import projects, system


def load(path):
    with io.open(path, 'r', encoding='utf-8-sig') as stream:
        return json.load(stream)


def run():
    env = os.environ
    root, repo, mode = env['INOPRO_S8B_ROOT'], env['INOPRO_S8B_REPO'], env['INOPRO_S8B_PASS']
    expected, operation = env['INOPRO_S8B_EXPECTED_SHA256'], env['INOPRO_S8B_OPERATION']
    fixture_root = env.get('INOPRO_S8B_FIXTURE_ROOT',root)
    assert root in (fixture_root,os.path.join(fixture_root,'confirmed-preflight-followup'))
    assert re.match(r'^D:\\InoPro-S8b-Positive-\d{8}-\d{6}$',fixture_root,re.I) and mode in ('prepare','map','verify')
    origin = load(os.path.join(root,'fixture-origin.json'))
    path = os.path.join(fixture_root,'engineering','AM610_IO_Positive.project')
    assert origin['operationId']==operation and origin['project']==path
    folder = os.path.join(repo,'scripts','probes')
    sys.path.insert(0,folder)
    import io_mapping_read as read
    import io_mapping_positive_guard as guard
    import io_mapping_export_guard as xml
    api = imp.load_source('io_read_entry',os.path.join(folder,'io-mapping-native.py')).read_worker(repo)
    sha, pub = api['file_hash'], api['publish']
    unique, expect = guard.unique, guard.require
    proc = Process.GetCurrentProcess()
    h, current_stage, counter = [None], ['initialize'], [0]
    result = dict(status='unknown',passName=mode,operationId=operation,projectPath=path,opened=False,closed=False,
                  diskBefore=None,diskAfterClose=None,saveCalls=0,compileCalls=0,setterDispatchCount=0,fixtureWriteStarted=False,
                  engine=dict(pid=proc.Id,creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),
                              executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion)))

    def file(name):
        return os.path.join(root,mode+'-'+name)

    def record(name,data):
        pub(file(name+'.json'),data)
        return data

    def stage(label):
        current_stage[0]=label
        counter[0]+=1
        record('stage-%02d'%counter[0],dict(stage=label,utc=unicode(DateTime.UtcNow.ToString('o')),operationId=operation))

    def inventory(project):
        nodes=list(api['walk'](project))
        applications = [(obj, names, scope) for obj, names, scope in nodes if getattr(obj, 'is_application', False)]
        app, names, aid = unique(applications, 'Application not unique')
        ancestor = app
        for _ in range(len(names) - 1):
            ancestor = ancestor.parent
            if getattr(ancestor, 'is_device', False):
                break
        expect(getattr(ancestor, 'is_device', False), 'Application owning device not identified')
        app_record = dict(guid=unicode(app.guid).lower(), name=unicode(app.get_name()), path=names,
                          isApplication=bool(app.is_application), typeGuid=unicode(app.type).lower(),
                          deviceGuid=unicode(ancestor.guid).lower())
        sources=[]
        for obj,n,scope in nodes:
            decl=api['normalize'](unicode(obj.textual_declaration.text)) if getattr(obj,'has_textual_declaration',False) else None
            impl=api['normalize'](unicode(obj.textual_implementation.text)) if getattr(obj,'has_textual_implementation',False) else None
            if decl is not None or impl is not None:
                sources.append(dict(guid=unicode(obj.guid).lower(),typeGuid=unicode(obj.type).lower(),path=n,
                                    app=scope,declaration=decl,implementation=impl))
        sources.sort(key=lambda r:r['guid'])
        tasks=api['task_inventory'](project,dict(projectId='s8b-positive-fixture',applicationId=aid,targetKind='application'),
                                    api['task_append_call_row'])
        expect(tasks['coverageComplete'] and not tasks['enumerationFailures'] and not tasks['resolutionReadFailures']
               and all(t['callsComplete'] for t in tasks['tasks']), 'Task inventory not complete')
        return nodes, [app_record], aid, sources, tasks

    def gather(project,label,needs_gvl=True):
        stage(label)
        nodes,applications,aid,sources,tasks=inventory(project)
        matches=[(obj,n) for obj,n,scope in nodes if scope==aid and n[-1].lower()==guard.GVL_NAME.lower()]
        decl=None
        if needs_gvl:
            obj,n=unique(matches,'GVL_IOProbe missing or ambiguous in Application')
            expect(unicode(obj.parent.guid).lower()==aid,'GVL is not at the Application root')
            decl=dict(name=unicode(obj.get_name()),path=n,guid=unicode(obj.guid).lower(),parentGuid=unicode(obj.parent.guid).lower(),
                      typeGuid=unicode(obj.type).lower(),text=api['normalize'](unicode(obj.textual_declaration.text)))
        else:
            expect(not matches,'Fixture already has the target GVL')
        snap=read.snapshot(project)
        record(label+'-getter',snap)
        devices=[obj for obj,n,scope in nodes if getattr(obj,'is_device',False)]
        idx=xml.export_index(project,devices,file(label+'.export'))
        st=dict(snapshot=snap,export=idx,applicationId=aid,applications=applications,declaration=decl,sources=sources,tasks=tasks,
                sourceSnapshot=api['snapshot'](project))
        record(label+'-state',st)
        return st

    def target_wrapper(project, key):
        dev=unique((obj for obj,n,scope in api['walk'](project) if getattr(obj,'is_device',False)
                    and unicode(obj.guid).lower()==key[0]), 'Live device handle differs')
        con=unique((c for c in dev.connectors if c.connector_id==key[1] and
                    unicode(c.get_device_object().guid).lower()==key[0]),'Live connector handle differs')
        param=unique((p for p in con.host_parameters if int(p.id)==key[2] and
                      unicode(p.get_device_object().guid).lower()==key[0]),'Live parameter handle differs')
        element=param
        for ident in key[3]:
            element=unique((e for e in element if unicode(e.identifier)==ident), 'Live member no longer unique')
        expect(element.is_mappable_io and unicode(element.base_type)=='BOOL' and int(element.bit_size)==1,
               'Live mapping wrapper lost BOOL identity')
        m=element.io_mapping
        expect(m is not None and int(m.Id)==-1 and m.variable is None and m.default_variable is None and not m.mapping_creates_variable
               and m.maps_to_existing_variable,'Native mapping changed before dispatch')
        return m

    def check_build(project,state,label,disk,persisted):
        stage(label)
        expect(sha(path)==disk,'Disk changed before build')
        result['compileCalls']+=1
        reply=api['compile_application'](project,state['applicationId'],'application')
        record(label,dict(reply=reply,diskBefore=disk,diskAfter=sha(path),persistedInput=persisted,
                          sourceSnapshot=state['sourceSnapshot'],inputMappingIndex=state['export']['exportSha256']))
        expect(reply['status']=='succeeded' and reply['data']['buildPassed'] is True and
               reply['data']['diagnosticsComplete'] is True and reply['data']['snapshot']==state['sourceSnapshot']
               and sha(path)==disk,'Build or evidence failed; see diagnostics')

    def save(project,label):
        stage(label)
        result['saveCalls']+=1
        project.save()
        return sha(path)

    def close():
        stage('close')
        h[0].close()
        expect(projects.primary is None,'Closure is unconfirmed')
        h[0]=None
        result['closed']=True
        result['diskAfterClose']=sha(path)

    def work():
        expect(projects.primary is None and result['engine']['executableVersion']=='1.9.1.6','Unexpected IDE context')
        expect(not any(os.path.lexists(path+s) for s in ('.~u','.lock','.lck','.~lock')),'External occupation')
        api['direct_exclusive_probe'](path)
        result['diskBefore']=sha(path)
        expect(result['diskBefore']==expected,'Disk hash mismatch')
        stage('open')
        project=projects.open(path)
        h[0]=project
        result['opened']=True
        expect(os.path.normcase(unicode(project.path))==os.path.normcase(path),'Opened another file')
        if mode=='prepare':
            seed=gather(project,'seed',False)
            expect(seed['snapshot']['coverage']['enumerationComplete'] and
                   set(guard.index(seed['snapshot']['channels'],guard.rowkey))==set(guard.index(seed['export']['rows'],guard.xmlkey)) and
                   all(not row['rawMappings'] for row in seed['export']['rows']), 'Seed has incomplete or nonempty mapped rows')
            app=api['application'](project,seed['applicationId'])
            stage('fixture-create-root-gvl')
            result['fixtureWriteStarted']=True
            obj=app.create_gvl(guard.GVL_NAME)
            obj.textual_declaration.replace(guard.DECL)
            baseline=gather(project,'prepared')
            guard.validate_state(baseline,False)
            expect(seed['tasks']==baseline['tasks'] and seed['sources']==[r for r in baseline['sources']
                   if r['guid']!=baseline['declaration']['guid']], 'Fixture preparation changed other task or source')
            disk=save(project,'save-prepared-fixture')
            expect(disk!=expected,'Fixture preparation did not change the project')
            check_build(project,baseline,'baseline-build',disk,True)
        elif mode=='map':
            prior=load(os.path.join(fixture_root,'prepare-prepared-state.json'))
            original=gather(project,'before')
            key=guard.validate_state(original,False)
            expect(prior['export']['exportSha256']==original['export']['exportSha256'] and
                   guard.invariant(prior,key,True)==guard.invariant(original,key,True),'Prepared fixture evidence differs at reopen')
            live=gather(project,'same-handle-prewrite')
            expect(key==guard.validate_state(live,False) and guard.invariant(live,key)==guard.invariant(original,key)
                   and sha(path)==expected,'Same-handle precheck changed')
            m=target_wrapper(project,key)
            expression=guard.mapping_expression(live,guard.mapping_expression(prior))
            checkpoint=os.path.join(root,'checkpoint.project')
            File.Copy(path,checkpoint,False)
            expect(sha(checkpoint)==expected==sha(path),'Checkpoint mismatch')
            record('checkpoint',dict(path=checkpoint,sha256=expected))
            stage('setter-dispatch')
            record('dispatch',dict(operationId=operation,owner=key[0],connector=key[1],parameter=key[2],element=key[3],
                                   application=live['applications'][0],targetGVL=live['declaration'],expression=expression,disk=expected,
                                   fullMappingEvidence=live['export']['exportSha256']))
            result['setterDispatchCount']=1
            m.variable=expression
            stage('setter-returned')
            after=gather(project,'after-setter')
            guard.change_only(live,after,xml.mapping_matches)
            check_build(project,after,'mapped-build',expected,False)
            # Compilation can create IDE-only tree nodes. Recheck readable channels, sources and tasks before saving.
            presave=gather(project,'before-save')
            guard.change_only(live,presave,xml.mapping_matches)
            disk=save(project,'save-mapped-fixture')
            expect(disk!=expected,'Mapping save did not publish a new disk version')
        else:
            prior=load(os.path.join(root,'map-same-handle-prewrite-state.json'))
            after=load(os.path.join(root,'map-before-save-state.json'))
            check=gather(project,'saved-reopen')
            guard.change_only(prior,check,xml.mapping_matches,True)
            key=guard.validate_state(check,True,xml.mapping_matches)
            expect(guard.invariant(after,key,True)==guard.invariant(check,key,True),'Saved-version preservation mismatch')
            check_build(project,check,'saved-build',expected,True)
            final=gather(project,'final')
            guard.change_only(prior,final,xml.mapping_matches,True)
            disk=expected
        expect(sha(path)==disk,'Unexpected disk change')
        close()
        expect(result['diskAfterClose']==disk,'Disk changed at close')
        result['status']='succeeded'

    def guarded():
        try:
            work()
        except Exception as exc:
            result['primaryError']=dict(api['exception_evidence'](exc),stage=current_stage[0])
            # After a possibly effective write, keep all evidence and the handle. No cleanup write.
            if h[0] is not None and not result['fixtureWriteStarted'] and result['setterDispatchCount']==0 and result['saveCalls']==0:
                try:
                    close()
                    if result['diskAfterClose']==expected:
                        result['status']='failed'
                except Exception as cleanup:
                    result['cleanupError']=api['exception_evidence'](cleanup)
    try:
        system.execute_on_primary_thread(guarded)
    except Exception as exc:
        result['callbackError']=api['exception_evidence'](exc)
    record('result',result)
    if result['closed'] or (h[0] is None and projects.primary is None):
        system.exit()


if __name__=='__main__':
    run()
