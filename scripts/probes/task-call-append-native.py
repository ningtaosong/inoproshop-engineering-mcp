# -*- coding: utf-8 -*-
"""Append exactly one PROGRAM call to MainTask in an owned AM610 fixture."""
import io
import json
import os
import re
import sys

from System import DateTime
from System.Diagnostics import Process
import scriptengine
from scriptengine import projects, system

TARGET = 'PRG_S8Append'
DECLARATION = u'PROGRAM PRG_S8Append\nVAR\n    ProbeValue : DINT;\nEND_VAR'
IMPLEMENTATION = u'ProbeValue := 1;'
DEVICE = (4102, '10f4 0002', '3.5.11.11')
ST_TYPE = '3b83b776-fb25-43b8-99f2-3c507c9143fc'
POU_TYPE = '6f9dac99-8de1-4efc-8465-68ac443b7d08'
TASK_FIELDS = ('kind_of_task', 'priority', 'interval', 'interval_unit', 'event_pou_guid',
               'event', 'external_event', 'core_binding', 'parent_synchron_task')
WATCHDOG_FIELDS = ('enabled', 'time', 'time_unit', 'sensitivity')
SEED = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
FILENAME = 'AM610_S8a_TaskCallAppend.project'


def expect(condition, message):
    if not condition:
        raise ValueError(message)


def append_once(calls, prefix, target, as_text, record_dispatch):
    """Use the live native order; rejection must precede the dispatch callback."""
    observed = [[as_text(field) for field in calls[i]] for i in range(len(calls))]
    expect(all(len(row) == 2 for row in observed), 'Incomplete native call tuple')
    expect(not any(row[0].lower() == target.lower() for row in observed), 'Target already in MainTask')
    expect(observed == prefix, 'Native call order or comments changed before dispatch')
    add = getattr(calls, 'add', None)
    expect(callable(add), 'Native add is unavailable')
    record_dispatch()
    add(target, '')


def load(path):
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


def discover(api, project, project_path, target_required):
    rows = list(api['walk'](project))
    apps = [(item, names, aid) for item, names, aid in rows if getattr(item, 'is_application', False)]
    expect(len(apps) == 1, 'Fixture must contain one Application')
    app, app_path, app_id = apps[0]
    devices = [item for item, names, unused in rows
               if getattr(item, 'is_device', False) and app_path[:-1] == names + ['Plc Logic']]
    expect(len(devices) == 1, 'AM610 parent device is ambiguous')
    ident = devices[0].get_device_identification()
    expect((int(ident.type), unicode(ident.id), unicode(ident.version)) == DEVICE, 'AM610 fixture identity differs')
    configs = [(item, names) for item, names, aid in rows if aid == app_id and names[:-1] == app_path
               and getattr(item, 'is_task_configuration', False)]
    expect(len(configs) == 1, 'Root task configuration is ambiguous')
    config, config_path = configs[0]
    args = dict(applicationId=app_id, projectId='s8a-append-fixture', targetKind='application')
    inventory = api['task_inventory'](project, args)
    expect(inventory['coverageComplete'] and not inventory['enumerationFailures'] and
           not inventory['resolutionReadFailures'], 'Task/PROGRAM scan incomplete')
    expect(len(inventory['tasks']) == 1, 'Fixture must contain exactly one task')
    task = inventory['tasks'][0]
    expect(task['path'] == config_path + ['MainTask'] and task['callsComplete'] and
           not task['unavailableFields'] and set(task['rawFields']) == set(TASK_FIELDS) and
           set(task['watchdog']) == set(WATCHDOG_FIELDS) and task['rawFields']['kind_of_task'] == 'Cyclic',
           'MainTask identity, fields, or ordered calls incomplete')
    handles = [item for item, names, aid in rows if aid == app_id and names == task['path'] and
               getattr(item, 'is_task', False) and unicode(item.guid).lower() == task['taskId']]
    expect(len(handles) == 1, 'MainTask native handle is ambiguous')

    names_expected = ('PLC_PRG', TARGET) if target_required else ('PLC_PRG',)
    programs = {}
    for name in names_expected:
        # Call wrapper display names can match PROGRAM names. Count all native POU
        # definitions first, even when their language is not yet confirmed.
        matches = [(item, names) for item, names, aid in rows if aid == app_id and names and
                   names[-1].lower() == name.lower() and unicode(item.type).lower() == POU_TYPE]
        expect(len(matches) == 1 and matches[0][1] == app_path + [name],
               'PROGRAM does not uniquely resolve to the Application root: ' + name)
        item, names = matches[0]
        expect(api['st_object'](item), 'Unreadable native PROGRAM: ' + name)
        record = api['read_object'](item, names, app_id)
        expect(record.get('pouType') == 'program' and
               record.get('pouTypeSource') == 'native-pou-type-id-and-declaration-header',
               'Native PROGRAM type mismatch: ' + name)
        types = sorted(unicode(v).lower() for v in item.embedded_object_types)
        expect(ST_TYPE in types, 'Native ST implementation marker missing: ' + name)
        expect([p for p in inventory['programs'] if p['path'][-1].lower() == name.lower()] ==
               [dict(objectId=record['objectId'], path=names)], 'Native PROGRAM inventory differs: ' + name)
        programs[name] = dict(record, embeddedObjectTypes=types)
    if target_required:
        expect(programs[TARGET]['declaration'] == DECLARATION and
               programs[TARGET]['implementation'] == IMPLEMENTATION, 'Target fixture source mismatch')
    else:
        expect(not any(aid == app_id and names and names[-1].lower() == TARGET.lower()
                       for item, names, aid in rows), 'Target PROGRAM name already exists in seed')

    resolved = []
    for order, raw in enumerate(task['rawCalls']):
        expect(len(raw) == 2, 'Native call name/comment not completely readable')
        refs = [name for name in programs if name.lower() == raw[0].lower()]
        expect(len(refs) == 1, 'Call does not uniquely resolve to a fixture PROGRAM')
        definition = programs[refs[0]]
        resolved.append(dict(order=order, raw=raw, programName=refs[0], objectId=definition['objectId'],
                             applicationId=app_id, path=definition['path']))
    state = dict(projectPath=project_path, applicationId=app_id, applicationPath=app_path,
                 device=list(DEVICE), taskConfiguration=dict(id=unicode(config.guid).lower(), path=config_path),
                 task=dict(task, resolvedCalls=resolved), programs=programs,
                 sourceSnapshot=api['snapshot'](project),
                 taskConfigurationVersion=api['task_configuration_version'](inventory))
    return app, handles[0], state


def assert_append_only(before, after):
    for key in ('projectPath', 'applicationId', 'applicationPath', 'device',
                'taskConfiguration', 'programs', 'sourceSnapshot'):
        expect(after[key] == before[key], 'Append changed ' + key)
    prefix = before['task']['rawCalls']
    expect(len(prefix) == 1 and prefix[0][0] == 'PLC_PRG', 'Unexpected baseline order')
    expect(after['task']['rawCalls'] == prefix + [[TARGET, '']], 'Native append did not preserve prefix')
    unchanged = lambda task: {k: v for k, v in task.items() if k not in ('rawCalls', 'resolvedCalls')}
    expect(unchanged(after['task']) == unchanged(before['task']), 'Task fields or identity changed')
    resolved = after['task']['resolvedCalls']
    expect(resolved[:-1] == before['task']['resolvedCalls'] and
           sum(row['programName'] == TARGET for row in resolved) == 1 and
           resolved[-1]['objectId'] == after['programs'][TARGET]['objectId'] and
           resolved[-1]['applicationId'] == after['applicationId'] and resolved[-1]['order'] == 1,
           'Resolved append target or order differs')
    expect(after['taskConfigurationVersion'] != before['taskConfigurationVersion'],
           'Ordered task configuration version did not change')


def run(root, repo, mode):
    project_path = os.path.join(root, 'engineering', FILENAME)
    api = read_worker(repo)
    publish = api['publish']
    sha = api['file_hash']
    origin = load(os.path.join(root, 'fixture-origin.json'))
    expect(origin['project'] == project_path and origin['seedSha256'] == SEED, 'Fixture origin mismatch')
    prior = load(os.path.join(root, 'append-result.json')) if mode == 'verify' else None
    if prior:
        expect(prior['status'] == 'succeeded' and prior['closed'] and prior['saved'] and
               prior['appendDispatchCount'] == 1, 'Saved append is unconfirmed')
    expected_hash = prior['diskAfterClose'] if prior else SEED
    result_path = os.path.join(root, mode + '-result.json')
    expect(not os.path.lexists(result_path), 'Completed pass cannot be replayed')
    proc = Process.GetCurrentProcess()
    result = dict(status='unknown', mode=mode, projectPath=project_path, diskBefore=expected_hash,
                  engine=dict(pid=proc.Id, creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),
                              executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion)),
                  fixtureWriteStarted=False, appendDispatchCount=0, saved=False, closed=False)
    handle = [None]
    stage = ['before-open']
    sequence = [0]

    def note(stage_name, status, **fields):
        sequence[0] += 1
        publish(os.path.join(root, '%s-step-%03d.json' % (mode, sequence[0])),
                dict(fields, stage=stage_name, status=status, utc=unicode(DateTime.UtcNow.ToString('o'))))

    def step(name, action):
        stage[0] = name
        note(name, 'started')
        value = action()
        note(name, 'succeeded')
        return value

    def persist(name, data):
        result[name] = data
        publish(os.path.join(root, mode + '-' + name + '.json'), data)

    def open_project():
        expect(projects.primary is None, 'Unowned project already active')
        for suffix in ('.lock', '.lck', '.~lock', '.~u'):
            expect(not os.path.lexists(project_path + suffix), 'External occupancy marker exists')
        api['direct_exclusive_probe'](project_path)
        expect(sha(project_path) == expected_hash, 'Fixture hash changed before open')
        handle[0] = projects.open(project_path)
        expect(os.path.normcase(unicode(handle[0].path)) == os.path.normcase(project_path),
               'Unexpected native project path')

    def build(project, state, key):
        disk = sha(project_path)
        compiled = step(key, lambda: api['compile_application'](project, state['applicationId'], 'application'))
        persist(key, dict(reply=compiled, diskAtBuild=disk, diskAfterBuild=sha(project_path),
                          sourceSnapshot=state['sourceSnapshot'], taskVersion=state['taskConfigurationVersion'],
                          persistedInput=(mode == 'verify')))
        expect(compiled['status'] == 'succeeded' and compiled['data']['buildPassed'] is True and
               compiled['data']['diagnosticsComplete'] is True and compiled['data']['snapshot'] == state['sourceSnapshot'],
               'Offline build or diagnostic completeness failed: ' + key)
        expect(disk == expected_hash == sha(project_path), 'Build changed fixture file')
        expect(discover(api, project, project_path, True)[2] == state, 'Build changed readable evidence')

    def close_project():
        handle[0].close()
        expect(projects.primary is None, 'Project close unconfirmed')
        handle[0] = None
        result['closed'] = True

    def work():
        step('open-fixture', open_project)
        project = handle[0]
        if mode == 'verify':
            expect(result['engine'] != prior['engine'], 'Independent IDE identity is required')
            reopened = step('read-saved-configuration', lambda: discover(api, project, project_path, True)[2])
            persist('reopened', reopened)
            expect(reopened == prior['afterAppend'], 'Saved readback differs from in-memory append')
            assert_append_only(prior['baseline'], reopened)
            build(project, reopened, 'savedBuild')
        else:
            app, unused, seed = step('read-seed', lambda: discover(api, project, project_path, False))
            expect(len(seed['task']['rawCalls']) == 1 and seed['task']['rawCalls'][0][0] == 'PLC_PRG',
                   'Seed MainTask must only call PLC_PRG')
            result['fixtureWriteStarted'] = True
            pou = step('prepare-target-program', lambda: app.create_pou(
                TARGET, scriptengine.PouType.Program, scriptengine.ImplementationLanguages.st))
            step('prepare-target-declaration', lambda: pou.textual_declaration.replace(DECLARATION))
            step('prepare-target-implementation', lambda: pou.textual_implementation.replace(IMPLEMENTATION))

            baseline = step('read-pre-append-baseline', lambda: discover(api, project, project_path, True)[2])
            expect(baseline['task'] == seed['task'] and baseline['programs']['PLC_PRG'] == seed['programs']['PLC_PRG'],
                   'Fixture preparation changed MainTask or PLC_PRG')
            persist('baseline', baseline)
            build(project, baseline, 'baselineBuild')
            unused, main, live = step('same-handle-prewrite-check', lambda: discover(api, project, project_path, True))
            expect(live == baseline and sha(project_path) == expected_hash, 'Pre-append identity or disk changed')

            def mark_dispatch():
                note('native-append', 'dispatched', taskId=live['task']['taskId'],
                     programId=live['programs'][TARGET]['objectId'], programName=TARGET, comment='')
                result['appendDispatchCount'] = 1

            step('native-append', lambda: append_once(main.pous, baseline['task']['rawCalls'],
                                                       TARGET, api['text'], mark_dispatch))
            after = step('read-actual-append', lambda: discover(api, project, project_path, True)[2])
            persist('afterAppend', after)
            assert_append_only(baseline, after)
            build(project, after, 'beforeSaveBuild')
            expect(sha(project_path) == expected_hash, 'Fixture file changed before save')
            step('save-appended-fixture', project.save)
            result['saved'] = True
            result['diskAfterSave'] = sha(project_path)
            expect(result['diskAfterSave'] != expected_hash, 'Save failed to publish a new file revision')

        step('close-fixture', close_project)
        result['diskAfterClose'] = sha(project_path)
        expect(result['diskAfterClose'] == (result['diskAfterSave'] if result['saved'] else expected_hash),
               'Fixture file changed at close')
        result['status'] = 'succeeded'

    def guarded_work():
        try:
            work()
        except Exception as error:
            result['error'] = dict(api['exception_evidence'](error), stage=stage[0])
            note(stage[0], 'stopped', error=result['error'])
            if not result['fixtureWriteStarted'] and not result['appendDispatchCount'] and handle[0] is not None:
                try:
                    expect(os.path.normcase(unicode(handle[0].path)) == os.path.normcase(project_path),
                           'Read-only failure handle is not the owned fixture')
                    step('close-read-only-failure', close_project)
                    result['diskAfterClose'] = sha(project_path)
                    if result['diskAfterClose'] == expected_hash:
                        result['status'] = 'failed'
                except Exception as cleanup:
                    result['cleanupError'] = api['exception_evidence'](cleanup)

    system.execute_on_primary_thread(guarded_work)
    publish(result_path, result)
    if result['closed'] or handle[0] is None:
        system.exit()


if __name__ == '__main__':
    root = os.path.abspath(os.environ['INOPRO_S8_APPEND_ROOT'])
    repo = os.path.abspath(os.environ['INOPRO_S8_APPEND_REPO'])
    mode = os.environ['INOPRO_S8_APPEND_MODE']
    expect(re.match(r'^D:\\InoPro-S8a-TaskAppend-[0-9-]+$', root, re.I) and mode in ('append', 'verify'),
           'Only the dedicated task-append fixture is supported')
    run(root, repo, mode)
