# -*- coding: utf-8 -*-
"""Disposable fixture only. Four distinct native processes; never a product entry."""
import os
import sys
try:
    _root = os.environ.get('INOPRO_TRACE_ROOT') or os.environ['INOPRO_CLEAR_ROOT']
    _mode = os.environ.get('INOPRO_TRACE_MODE') or os.environ['INOPRO_CLEAR_MODE']
    _fd = os.open(os.path.join(_root, _mode+'-bootstrap-entered.txt'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(_fd, 'wb') as _f:
        _f.write(('pid=%d\nname=%s\n'%(os.getpid(),__name__)).encode('ascii'));_f.flush();os.fsync(_f.fileno())
except Exception:
    import traceback
    sys.stderr.write('EARLIEST_ENTRY_FAILURE\n'+traceback.format_exc());sys.stderr.flush()
    raise
_trace = None
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import probe_startup_trace
    _trace = probe_startup_trace.bootstrap(globals())
    _trace.record('necessary-modules-start')
    import imp
    import io
    import json
    import hashlib
    from System import DateTime
    from System.Diagnostics import Process
    from System.IO import File
    from scriptengine import projects, system, librarymanager
    _trace.bind_process(Process.GetCurrentProcess())
    _trace.record('necessary-modules-complete')
except Exception as _error:
    if _trace is not None: _trace.fail('necessary-modules', _error)
    else:
        import traceback
        sys.stderr.write('RECORDER_IMPORT_FAILURE\n'+traceback.format_exc());sys.stderr.flush()
    raise


def load(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f: return json.load(f)


def run(root, fixed, mode, script_dir):
    intent = load(os.path.join(root, mode + '-intent.json'))
    _trace.record('project-helpers-start')
    helper_files = {'guardSha256':os.path.join(script_dir,'library_placeholder_clear_guard.py'),
                    'bridgeSha256':os.path.join(fixed,'bridge','worker.py'),
                    'libraryHelperSha256':os.path.join(fixed,'bridge','library_reference.py'),
                    'recorderSha256':os.path.join(script_dir,'probe_startup_trace.py')}
    actual_helpers = {}
    for key, helper_path in helper_files.items():
        with open(helper_path,'rb') as helper_file: actual_helpers[key] = hashlib.sha256(helper_file.read()).hexdigest()
        if actual_helpers[key] != intent[key]: raise ValueError('Helper fingerprint changed: '+key)
    guard = imp.load_source('placeholder_clear_guard', os.path.join(script_dir, 'library_placeholder_clear_guard.py'))
    _trace.record('guard-helper-loaded')
    api = dict(__file__=os.path.join(fixed, 'bridge', 'worker.py'), projects=projects, system=system, librarymanager=librarymanager)
    with io.open(api['__file__'], 'r', encoding='utf-8') as f: source = f.read()
    marker = '# Fixed helper code only; request text is never evaluated.'
    guard.require(source.count(marker) == 1, 'Fixed worker helper boundary changed')
    exec(compile(source.split(marker)[0], api['__file__'], 'exec'), api)
    _trace.record('worker-helpers-loaded')
    with io.open(os.path.join(fixed, 'bridge', 'library_reference.py'), 'r', encoding='utf-8') as f:
        exec(compile(f.read(), 'library_reference.py', 'exec'), api)
    _trace.record('project-helpers-complete', fingerprints=actual_helpers)
    publish, sha = api['publish'], api['file_hash']
    path = intent['project'];disk = intent['expectedDisk']
    proc = Process.GetCurrentProcess()
    result = dict(status='unknown', mode=mode, projectPath=path, operationId=intent['operationId'],
                  engine=dict(pid=proc.Id, creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),
                              version=unicode(proc.MainModule.FileVersionInfo.FileVersion)),
                  diskBefore=disk, clearDispatchCount=0, fixtureMutationCount=0, saveCount=0,
                  compileCount=0, compileCompletedCount=0, closed=False)
    handle, stage, seq = [None], ['start'], [0]
    placeholder = u'ClearProbeOwned'

    def emit(name, value): publish(os.path.join(root, mode + '-' + name + '.json'), value)
    def step(name, action):
        stage[0] = name;seq[0] += 1
        emit('step-%03d-start' % seq[0], dict(stage=name, utc=unicode(DateTime.UtcNow.ToString('o'))))
        value = action()
        emit('step-%03d-end' % seq[0], dict(stage=name, status='succeeded', utc=unicode(DateTime.UtcNow.ToString('o'))))
        return value

    def capture():
        p = handle[0];rows = list(api['walk'](p))
        apps = [(x,n,a) for x,n,a in rows if getattr(x,'is_application',False)]
        guard.require(len(apps)==1, 'Application not unique')
        app, app_path, aid = apps[0]
        managers = [(x,n) for x,n,a in rows if a==aid and getattr(x,'is_libman',False)]
        guard.require(len(managers)==1 and managers[0][1][:-1]==app_path, 'Application root manager not unique')
        manager, manager_path = managers[0]
        devices = [(x,n) for x,n,a in rows if getattr(x,'is_device',False) and n+['Plc Logic']==app_path[:-1]]
        guard.require(len(devices)==1,'Root device not unique')
        dev,dev_path = devices[0];identity = dev.get_device_identification()
        guard.require([int(identity.type),unicode(identity.id),unicode(identity.version)] == [4102,'10f4 0002','3.5.11.11'], 'AM610 identity mismatch')
        args = dict(projectId='independent-placeholder-clear-probe',applicationId=aid,targetKind='application',maxReferences=1000)
        libraries = api['library_inventory'](p,args)
        guard.require(api['complete_placeholder_inventory'](libraries),'Library inventory incomplete')
        task_raw = api['task_inventory'](p,args,api['task_append_call_row'])
        task_view = api['task_call_inventory_view'](task_raw)
        objects = sorted([api['read_object'](x,n,a) for x,n,a in rows if a==aid and api['st_object'](x)],key=lambda r:r['objectId'])
        refs = [x for x in manager.references if x.is_placeholder and unicode(x.placeholder_name).lower()==placeholder.lower()]
        guard.require(len(refs)<=1, 'Placeholder name ambiguous')
        value = refs[0].get_redirection() if refs else None
        native = dict(available=bool(refs),value=None if value is None else unicode(value),
                      nativeType='null' if value is None else unicode(type(value)))
        state = dict(projectPath=unicode(p.path),applicationId=aid,applicationPath=app_path,
                     device=dict(id=unicode(dev.guid).lower(),path=dev_path,type=int(identity.type),descriptionId=unicode(identity.id),version=unicode(identity.version)),
                     managerId=unicode(manager.guid).lower(),managerPath=manager_path,library=libraries,
                     tasks=task_view,sources=objects,sourceSnapshot=api['snapshot'](p),targetRedirection=native)
        return state, manager, refs, task_raw

    def collect(name):
        state,manager,refs,raw = capture();emit(name,state);emit(name+'-raw-task-inventory',raw)
        return state,manager,refs

    def build(name, state, persisted):
        before_hash = sha(path)
        result['compileCount'] += 1
        reply = step(name,lambda:api['compile_application'](handle[0],state['applicationId'],'application'))
        result['compileCompletedCount'] += 1
        emit(name,dict(reply=reply,diskAtBuild=before_hash,diskAfterBuild=sha(path),persistedInput=persisted,
                       libraryVersion=state['library']['configurationVersion'],sourceSnapshot=state['sourceSnapshot']))
        guard.require(reply['status']=='succeeded' and reply['data']['buildPassed'] is True and
                      reply['data']['diagnosticsComplete'] is True,'Compilation did not pass: '+name)
        guard.require(before_hash==sha(path),'Compilation changed main file')
        after,unused,refs = collect(name+'-readback')
        guard.equal(state,after,'Compilation changed checked library/source/task state')

    def save():
        guard.require(sha(path)==result.get('savedHash',disk),'Disk changed before save')
        result['saveCount'] += 1
        handle[0].save()
        result['savedHash'] = sha(path)

    def close():
        handle[0].close()
        guard.require(projects.primary is None,'Native project close not confirmed')
        handle[0] = None;result['closed'] = True;result['diskAfterClose'] = sha(path)

    def work():
        guard.require(projects.primary is None and sha(path)==disk,'Unowned handle or file changed')
        for suffix in ('.lock','.lck','.~lock','.~u'):
            guard.require(not os.path.lexists(path+suffix),'External occupancy marker exists')
        api['direct_exclusive_probe'](path)
        handle[0] = step('open-owned-fixture',lambda:projects.open(path))
        guard.require(os.path.normcase(unicode(handle[0].path))==os.path.normcase(path),'Wrong opened path')
        initial,manager,refs = step('initial-read',lambda:collect('initial'))
        if mode=='prepare':
            guard.require(not refs,'Fixture placeholder already exists')
            catalog,natives = api['installed_inventory']();emit('installed-catalog',catalog)
            guard.require(catalog['enumerationComplete'],'Installed library inventory incomplete')
            selected = []
            for version in ('3.5.11.0','3.5.7.0'):
                found=[x for x in catalog['entries'] if x['title']=='CAA Mathematics' and x['company']=='CAA Technical Workgroup' and x['version']==version]
                guard.require(len(found)==1 and len(natives[found[0]['identity']])==1,'Installed default/override identity not unique')
                selected.append(found[0])
            default,override = selected
            guard.require(default['defaultNamespace']==override['defaultNamespace'] and default['identity']!=override['identity'],'Installed identities/namespace mismatch')
            guard.require(not any(r['rawFields']['namespace'].lower()==default['defaultNamespace'].lower() for r in initial['library']['references']), 'Fixture namespace collision')
            emit('selected-libraries',dict(default=default,override=override))
            result['fixtureMutationCount'] += 1
            step('prepare-add-ordinary-placeholder',lambda:manager.add_placeholder(placeholder,natives[default['identity']][0]))
            created,manager,refs = collect('created')
            guard.require(len(refs)==1 and refs[0].system_library is False and refs[0].is_managed is False and
                          refs[0].get_redirection() is None and unicode(refs[0].default_resolution)==default['displayName'], 'Created default/ownership not confirmed')
            emit('native-method',dict(name='set_redirection',documentation=unicode(refs[0].set_redirection.__doc__),referenceId=unicode(refs[0].id)))
            result['fixtureMutationCount'] += 1
            step('prepare-explicit-override',lambda:refs[0].set_redirection(override['displayName']))
            prepared,manager,refs = collect('prepared')
            plan=dict(projectPath=path,applicationId=prepared['applicationId'],managerId=prepared['managerId'],
                      referenceId=unicode(refs[0].id),placeholderName=placeholder,namespace=default['defaultNamespace'],
                      defaultResolution=default['displayName'],explicitResolution=override['displayName'],
                      preparedByThisProbe=True,baselineSavedReopened=False,defaultInstalled=default,overrideInstalled=override)
            target=guard.target(prepared,plan)['rawFields']
            guard.require(target['explicit_redirection']==override['displayName'] and target['effective_resolution']==override['displayName'] and target['is_redirected'] is True,'Prepared override not confirmed')
            guard.equal(initial['sources'],prepared['sources'],'Preparation changed source')
            guard.equal(initial['tasks'],prepared['tasks'],'Preparation changed tasks')
            before_refs=initial['library']['references'];after_refs=prepared['library']['references']
            guard.equal(before_refs,after_refs[:len(before_refs)],'Preparation changed pre-existing library references')
            guard.require(len(after_refs)==len(before_refs)+1,'Preparation added an unexpected reference')
            step('save-prepared-fixture',save);plan['diskHash']=sha(path);emit('plan',plan)
            saved,_,_=collect('after-save');guard.equal(prepared,saved,'Preparation save changed checked state')
        elif mode=='baseline':
            plan=load(os.path.join(root,'prepare-plan.json'))
            guard.equal(load(os.path.join(root,'prepare-after-save.json')),initial,'Prepared baseline reopen mismatch')
            guard.target(initial,plan)
            build('baseline-build',initial,True)
            plan['baselineSavedReopened']=True
            emit('plan',plan)
        elif mode=='clear':
            plan=load(os.path.join(root,'baseline-plan.json'))
            baseline=load(os.path.join(root,'baseline-initial.json'))
            guard.preflight(baseline,initial,plan,sha(path))
            File.Copy(path,os.path.join(root,'checkpoint.project'),False)
            guard.require(sha(os.path.join(root,'checkpoint.project'))==sha(path)==plan['diskHash'],'Checkpoint mismatch')
            emit('checkpoint',dict(path=os.path.join(root,'checkpoint.project'),sha256=sha(path)))
            live,manager,refs=step('same-handle-recheck',lambda:collect('prewrite'))
            guard.require(len(refs)==1 and unicode(refs[0].id)==plan['referenceId'],'Native reference identity mismatch')
            def mark():
                emit('dispatch',dict(plan=plan,operationId=intent['operationId'],method='set_redirection',argument=None,utc=unicode(DateTime.UtcNow.ToString('o'))))
                result['clearDispatchCount']=1
            returned=step('clear-explicit-override',lambda:guard.clear_once(refs[0],initial,live,plan,sha(path),mark))
            result['nativeReturn']=None if returned is None else unicode(returned)
            after,_,_=collect('after-clear');guard.after_clear(initial,after,plan)
            build('after-clear-build',after,False)
            step('save-cleared-fixture',save)
            saved,_,_=collect('after-save');guard.equal(after,saved,'Clear save changed checked state')
        elif mode=='verify':
            plan=load(os.path.join(root,'baseline-plan.json'))
            guard.equal(load(os.path.join(root,'clear-after-save.json')),initial,'Saved independent readback differs')
            guard.after_clear(load(os.path.join(root,'baseline-initial.json')),initial,plan)
            build('saved-build',initial,True)
        else: raise ValueError('Unsupported mode')
        step('normal-close',close)
        guard.require(result['diskAfterClose']==result.get('savedHash',disk),'Close changed main file')
        result['status']='succeeded'

    def guarded():
        try: work()
        except Exception as error:
            _trace.fail(stage[0], error)
            result['primaryException']=dict(api['exception_evidence'](error),stage=stage[0])
            try: emit('first-failure',result['primaryException'])
            except Exception as cleanup: result['evidenceError']=api['exception_evidence'](cleanup)
            # No recovery save, no rollback, no retry. A read-only failure can close
            # its owned handle; any mutation uncertainty leaves the native scene.
            if result['fixtureMutationCount']==0 and result['clearDispatchCount']==0 and handle[0] is not None:
                try: step('close-read-only-stop',close);result['status']='failed'
                except Exception as cleanup: result['cleanupException']=api['exception_evidence'](cleanup)
    _trace.primary_call(system, guarded)
    _trace.publish_result(result, os.path.join(root,mode+'-result.json'))
    if result['closed'] or handle[0] is None: _trace.request_exit(system)


try:
    if __name__=='__main__':
        root=os.environ['INOPRO_CLEAR_ROOT'];mode=os.environ['INOPRO_CLEAR_MODE']
        if not os.path.basename(root).startswith('InoPro-PlaceholderClear-') or mode not in ('prepare','baseline','clear','verify'):
            raise ValueError('Dedicated probe required')
        run(root,os.environ['INOPRO_CLEAR_FIXED'],mode,os.path.dirname(os.path.abspath(__file__)))
    else:
        _trace.record('business-entry-not-selected', entryName=__name__)
except Exception as _error:
    _trace.fail('outer-startup-envelope', _error)
    raise
