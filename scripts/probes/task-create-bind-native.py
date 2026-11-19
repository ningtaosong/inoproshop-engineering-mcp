# -*- coding: utf-8 -*-
"""One native edit and one independent reopen of an offline AM610 fixture."""
import io
import json
import os
import re
import sys

from System import DateTime
from System.Diagnostics import Process
import scriptengine
from scriptengine import projects, system

PROGRAM = 'PRG_S8Probe'
TASK = 'ProbeTask'
DECLARATION = u'PROGRAM PRG_S8Probe\nVAR\n    ProbeValue : DINT;\nEND_VAR'
IMPLEMENTATION = u'ProbeValue := 1;'
DEVICE = (4102, '10f4 0002', '3.5.11.11')
SEED = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
FILENAME = 'AM610_S8a_TaskBinding.project'


def expect(condition, message):
    if not condition:
        raise ValueError(message)


def data(path):
    with io.open(path, 'r', encoding='utf-8-sig') as stream:
        return json.load(stream)


def read_worker(repo):
    path = os.path.join(repo, 'bridge', 'worker.py')
    marker = '# Fixed helper code only; request text is never evaluated.'
    with io.open(path, 'r', encoding='utf-8') as stream:
        source = stream.read()
    expect(source.count(marker) == 1, 'Worker helper boundary changed')
    public = dict(__file__=path, projects=projects, system=system)
    exec(compile(source.split(marker)[0], path, 'exec'), public)
    return public


def fingerprint(api, directory):
    return {name: dict(sha256=api['file_hash'](os.path.join(directory, name)),
                       bytes=os.path.getsize(os.path.join(directory, name)))
            for name in sorted(os.listdir(directory)) if os.path.isfile(os.path.join(directory, name))}


def discover(api, project, project_path, target_required):
    rows = list(api['walk'](project))
    apps = [(item, names, aid) for item, names, aid in rows if getattr(item, 'is_application', False)]
    expect(len(apps) == 1, 'Fixture must contain one Application')
    app, app_path, app_id = apps[0]
    devices = [(item, names) for item, names, unused in rows
               if getattr(item, 'is_device', False) and app_path[:-1] == names + ['Plc Logic']]
    expect(len(devices) == 1, 'AM610 parent device is ambiguous')
    ident = devices[0][0].get_device_identification()
    expect((int(ident.type), unicode(ident.id), unicode(ident.version)) == DEVICE, 'AM610 fixture identity differs')
    configs = [item for item, names, aid in rows if aid == app_id and names[:-1] == app_path
               and getattr(item, 'is_task_configuration', False)]
    expect(len(configs) == 1, 'Application task configuration is ambiguous')
    config = configs[0]
    prefix = app_path + [unicode(config.get_name())]
    expected_names = ('PLC_PRG', PROGRAM) if target_required else ('PLC_PRG',)
    programs = {}
    for name in expected_names:
        # A task-call child can have the same name as the underlying PROGRAM.
        matches = [(item, names) for item, names, aid in rows
                   if aid == app_id and names[-1].lower() == name.lower() and api['st_object'](item)]
        expect(len(matches) == 1 and matches[0][1] == app_path + [name], 'PROGRAM identity differs: ' + name)
        item, names = matches[0]
        record = api['read_object'](item, names, app_id)
        expect(record.get('pouType') == 'program' and
               record.get('pouTypeSource') == 'native-pou-type-id-and-declaration-header', 'Expected native ST PROGRAM')
        programs[name] = record
    if target_required:
        actual = programs[PROGRAM]
        expect(actual['declaration'] == DECLARATION and actual['implementation'] == IMPLEMENTATION,
               'Test PROGRAM text differs')
    else:
        expect(not any(aid == app_id and names[-1].lower() == PROGRAM.lower() for item, names, aid in rows),
               'Target PROGRAM already exists')
    args = dict(applicationId=app_id, projectId='s8a-disposable-fixture', targetKind='application')
    inventory = api['task_inventory'](project, args)
    expect(not inventory['enumerationFailures'] and not inventory['resolutionReadFailures'], 'Task/PROGRAM scan incomplete')
    handles = {unicode(item.guid).lower(): item for item, names, aid in rows
               if aid == app_id and getattr(item, 'is_task', False)}
    tasks = {}
    for row in inventory['tasks']:
        expect(row['path'][:-1] == prefix and row['callsComplete'], 'Unexpected task or incomplete call rows')
        name = row['path'][-1]
        expect(name not in tasks, 'Duplicate task')
        resolved = []
        for order, call in enumerate(row['rawCalls']):
            expect(1 <= len(call) <= 2 and (len(call) == 1 or not call[1]), 'Unknown native call metadata')
            keys = [p for p in programs if p.lower() == call[0].lower()]
            expect(len(keys) == 1, 'Call target does not resolve to one fixture PROGRAM')
            obj = programs[keys[0]]
            resolved.append(dict(order=order, raw=call, programName=keys[0], objectId=obj['objectId'],
                                 applicationId=app_id, path=obj['path']))
        tasks[name] = dict(row, resolvedCalls=resolved)
    expect('MainTask' in tasks and tasks['MainTask']['rawFields'].get('kind_of_task') == 'Cyclic'
           and [row['programName'] for row in tasks['MainTask']['resolvedCalls']] == ['PLC_PRG'],
           'MainTask baseline differs')
    snapshot = dict(projectPath=project_path, applicationId=app_id, applicationPath=app_path,
                    device=list(DEVICE), taskConfiguration=dict(id=unicode(config.guid).lower(), path=prefix),
                    tasks=tasks, programs=programs, taskConfigurationVersion=api['task_configuration_version'](inventory),
                    sourceSnapshot=api['snapshot'](project))
    return app, config, handles, snapshot


def assert_new_binding(state, baseline, task_id):
    expect(state['applicationId'] == baseline['applicationId'] and
           state['taskConfiguration'] == baseline['taskConfiguration'], 'Application/task configuration changed')
    expect(state['programs'] == baseline['programs'] and state['sourceSnapshot'] == baseline['sourceSnapshot'],
           'Task edit changed fixture PROGRAMs')
    expect(set(state['tasks']) == {'MainTask', TASK}, 'Unexpected task count or name')
    expect(state['tasks']['MainTask'] == baseline['tasks']['MainTask'], 'Readable MainTask evidence changed')
    row = state['tasks'][TASK]
    expect(row['taskId'] == task_id and row['rawFields'].get('kind_of_task') == 'Cyclic', 'Native task identity/type mismatch')
    expect(row['rawFields'].get('interval', '').lower() in ('50', 't#50ms') and
           row['rawFields'].get('interval_unit') == 'ms', 'Native interval is not 50 ms')
    expect([(c['order'], c['objectId'], c['applicationId']) for c in row['resolvedCalls']] ==
           [(0, state['programs'][PROGRAM]['objectId'], state['applicationId'])], 'Native task call does not bind expected PROGRAM')


def run(root, repo, mode):
    project_path = os.path.join(root, 'engineering', FILENAME)
    api = read_worker(repo)
    publish = api['publish']
    origin = data(os.path.join(root, 'fixture-origin.json'))
    expect(origin['project'] == project_path and origin['seedSha256'] == SEED, 'Fixture origin mismatch')
    prior = data(os.path.join(root, 'write-result.json')) if mode == 'verify' else None
    if prior:
        expect(prior['status'] == 'succeeded' and prior['closed'] and prior['saved'], 'Saved fixture is unconfirmed')
    expected_hash = prior['diskAfterClose'] if prior else SEED
    result_path = os.path.join(root, mode + '-result.json')
    expect(not os.path.lexists(result_path), 'Completed pass cannot be replayed')
    proc = Process.GetCurrentProcess()
    result = dict(mode=mode, status='unknown', engine=dict(pid=proc.Id, python=sys.version,
                  executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion),
                  creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks)),
                  projectPath=project_path, diskBefore=expected_hash, closed=False, saved=False, writeStarted=False)
    stage = ['before-open']
    sequence = [0]
    handle = [None]

    def note(name, status, **fields):
        sequence[0] += 1
        publish(os.path.join(root, '%s-step-%03d.json' % (mode, sequence[0])),
                dict(fields, stage=name, status=status, utc=unicode(DateTime.UtcNow.ToString('o'))))

    def step(name, action):
        stage[0] = name
        note(name, 'started')
        value = action()
        note(name, 'succeeded')
        return value

    def persist(name, value):
        result[name] = value
        publish(os.path.join(root, mode + '-' + name + '.json'), value)

    def open_project():
        expect(projects.primary is None, 'Unowned project is active')
        for suffix in ('.lock', '.lck', '.~lock', '.~u'):
            expect(not os.path.lexists(project_path + suffix), 'External occupancy marker exists')
        api['direct_exclusive_probe'](project_path)
        expect(api['file_hash'](project_path) == expected_hash, 'Fixture file hash changed')
        handle[0] = projects.open(project_path)
        expect(os.path.normcase(unicode(handle[0].path)) == os.path.normcase(project_path), 'Unexpected open path')

    def build(project, state, key):
        compiled = step(key, lambda: api['compile_application'](project, state['applicationId'], 'application'))
        persist(key, dict(reply=compiled, observedDiskSha256=api['file_hash'](project_path),
                         sourceSnapshot=state['sourceSnapshot'], taskConfigurationVersion=state['taskConfigurationVersion']))
        expect(compiled['status'] == 'succeeded' and compiled['data']['buildPassed'] is True, 'Offline build did not pass')
        expect(compiled['data']['snapshot'] == state['sourceSnapshot'], 'Build source snapshot differs')
        expect(state == discover(api, project, project_path, True)[3], 'Readable task or source data changed during build')

    def work():
        result['beforeFiles'] = fingerprint(api, os.path.dirname(project_path))
        step('open-fixture', open_project)
        project = handle[0]
        if mode == 'verify':
            unused_app, unused_config, unused_tasks, reopened = step('read-saved-configuration',
                lambda: discover(api, project, project_path, True))
            persist('reopened', reopened)
            expect(reopened == prior['afterBinding'], 'Reopened task identity, order, fields or PROGRAM differ')
            assert_new_binding(reopened, prior['baseline'], prior['createdTaskId'])
            build(project, reopened, 'savedBuild')
        else:
            app, config, tasks, seed = step('read-seed-configuration', lambda: discover(api, project, project_path, False))
            persist('seed', seed)
            expect(set(seed['tasks']) == {'MainTask'}, 'Fixture already contains another task')
            main = tasks[seed['tasks']['MainTask']['taskId']]
            add = getattr(main.pous, 'add', None)
            create = getattr(config, 'create_task', None)
            persist('interfaceDiscovery', dict(createTask=callable(create), addCall=callable(add),
                createTaskDoc=unicode(getattr(create, '__doc__', '') or '')[:1500],
                addCallDoc=unicode(getattr(add, '__doc__', '') or '')[:1500],
                indexedCallRead=True, sampleCall=seed['tasks']['MainTask']['rawCalls']))
            expect(callable(create) and callable(add), 'Required native task API missing')
            result['writeStarted'] = True
            pou = step('create-fixture-program', lambda: app.create_pou(PROGRAM, scriptengine.PouType.Program,
                                                                        scriptengine.ImplementationLanguages.st))
            step('write-fixture-declaration', lambda: pou.textual_declaration.replace(DECLARATION))
            step('write-fixture-implementation', lambda: pou.textual_implementation.replace(IMPLEMENTATION))
            baseline = discover(api, project, project_path, True)[3]
            expect(seed['tasks'] == baseline['tasks'] and seed['programs']['PLC_PRG'] == baseline['programs']['PLC_PRG'],
                   'Fixture preparation changed MainTask or PLC_PRG')
            persist('baseline', baseline)
            build(project, baseline, 'baselineBuild')
            expect(api['file_hash'](project_path) == SEED, 'Fixture disk changed before task dispatch')
            created = step('create-native-task', lambda: create(TASK))
            task_id = unicode(created.guid).lower()
            result['createdTaskId'] = task_id
            expect(getattr(created, 'is_task', False) and unicode(created.get_name()) == TASK
                   and unicode(created.parent.guid).lower() == unicode(config.guid).lower(), 'Native factory returned unexpected task')
            expect(len(created.pous) == 0, 'New task unexpectedly contains calls')
            step('set-cyclic-type', lambda: setattr(created, 'kind_of_task', main.kind_of_task))
            step('set-period', lambda: setattr(created, 'interval', 't#50ms'))
            step('add-native-program-call', lambda: created.pous.add(PROGRAM, ''))
            after = step('read-in-memory-binding', lambda: discover(api, project, project_path, True)[3])
            persist('afterBinding', after)
            assert_new_binding(after, baseline, task_id)
            build(project, after, 'beforeSaveBuild')
            expect(api['file_hash'](project_path) == SEED, 'Fixture changed externally before save')
            step('save-bound-fixture', project.save)
            result['saved'] = True
            result['diskAfterSave'] = api['file_hash'](project_path)
            expect(result['diskAfterSave'] != SEED, 'Save did not publish a new file revision')

        def close():
            project.close()
            expect(projects.primary is None, 'Project close unconfirmed')
            handle[0] = None
            result['closed'] = True
        step('close-fixture', close)
        result['diskAfterClose'] = api['file_hash'](project_path)
        result['afterFiles'] = fingerprint(api, os.path.dirname(project_path))
        expect(result['diskAfterClose'] == (expected_hash if mode == 'verify' else result['diskAfterSave']),
               'File changed at close')
        result['status'] = 'succeeded'

    def guarded_work():
        try:
            work()
        except Exception as error:
            result['error'] = dict(api['exception_evidence'](error), stage=stage[0])
            note(stage[0], 'stopped', error=result['error'])
            if not result['writeStarted'] and handle[0] is not None:
                try:
                    project = handle[0]
                    expect(os.path.normcase(unicode(project.path)) == os.path.normcase(project_path), 'Unexpected project to close')
                    project.close()
                    expect(projects.primary is None, 'Read-only failure close unconfirmed')
                    result['closed'] = True
                    result['diskAfterClose'] = api['file_hash'](project_path)
                    note('close-read-only-failure', 'succeeded')
                    if result['diskAfterClose'] == expected_hash:
                        result['status'] = 'failed'
                except Exception as cleanup:
                    result['cleanupError'] = api['exception_evidence'](cleanup)
                    note('close-read-only-failure', 'stopped', error=result['cleanupError'])

    system.execute_on_primary_thread(guarded_work)
    publish(result_path, result)
    if result['closed'] or handle[0] is None:
        system.exit()


if __name__ == '__main__':
    root = os.path.abspath(os.environ['INOPRO_S8A_ROOT'])
    repo = os.path.abspath(os.environ['INOPRO_S8A_REPO'])
    mode = os.environ['INOPRO_S8A_MODE']
    expect(re.match(r'^D:\\InoPro-S8a-TaskBind-[0-9-]+$', root, re.I) and mode in ('write', 'verify'),
           'Only the dedicated S8a probe fixture is supported')
    run(root, repo, mode)
