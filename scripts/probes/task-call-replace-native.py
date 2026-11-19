# -*- coding: utf-8 -*-
"""Replace one ordered call from a dedicated offline AM610 fixture."""
import imp
import io
import json
import os
import re

from System import DateTime
from System.Diagnostics import Process
from System.IO import File
import scriptengine
from scriptengine import projects, system

TARGET = 'PRG_ReplaceMe'
NEW_TARGET = 'PRG_Replacement'
KEEP = 'PRG_Keep'
MAIN_COMMENT = u'original main call'
PREPARE = ((TARGET, u'第二条：保留此备注', 1), (NEW_TARGET, None, 2), (KEEP, u'keep this call', 3))
DEVICE = (4102, '10f4 0002', '3.5.11.11')
ST_TYPE = '3b83b776-fb25-43b8-99f2-3c507c9143fc'
POU_TYPE = '6f9dac99-8de1-4efc-8465-68ac443b7d08'
TASK_FIELDS = ('kind_of_task', 'priority', 'interval', 'interval_unit', 'event_pou_guid',
               'event', 'external_event', 'core_binding', 'parent_synchron_task')
WATCHDOG_FIELDS = ('enabled', 'time', 'time_unit', 'sensitivity')
SEED = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
FILENAME = 'AM610_S8a_TaskCallReplace.project'


def expect(condition, message):
    if not condition:
        raise ValueError(message)


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
    args = dict(applicationId=app_id, projectId='s8a-replace-fixture', targetKind='application')
    inventory = api['task_inventory'](project, args, api['task_append_call_row'])
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

    names_expected = ('PLC_PRG', TARGET, NEW_TARGET, KEEP) if target_required else ('PLC_PRG',)
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
    for name, comment, value in PREPARE:
        if target_required:
            declaration, implementation = source_for(name, value)
            expect(programs[name]['declaration'] == declaration and programs[name]['implementation'] == implementation,
                   'Target fixture source mismatch: ' + name)
        else:
            expect(not any(aid == app_id and names and names[-1].lower() == name.lower()
                           for item, names, aid in rows), 'Program name already exists in seed: ' + name)

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



def source_for(name, value):
    return (u'PROGRAM %s\nVAR\n    ProbeValue : DINT;\nEND_VAR' % name,
            u'ProbeValue := %d;' % value)


def assert_replacement(before, after):
    for key in ('projectPath', 'applicationId', 'applicationPath', 'device', 'taskConfiguration',
                'programs', 'sourceSnapshot'):
        expect(before[key] == after[key], 'Replacement changed ' + key)
    old_task, new_task = before['task'], after['task']
    for field in set(old_task) | set(new_task):
        if field not in ('rawCalls', 'resolvedCalls'):
            expect(old_task[field] == new_task[field], 'Task configuration changed: ' + field)
    original = old_task['rawCalls']
    expected = [[NEW_TARGET if name == TARGET else name, comment] for name, comment in original]
    expect([n for n, c in expected] == ['PLC_PRG', NEW_TARGET, KEEP], 'Invalid replacement fixture')
    expect(new_task['rawCalls'] == expected, 'Unexpected call order, name or comment')
    for i, row in enumerate(old_task['resolvedCalls']):
        binding = row
        if row['programName'] == TARGET:
            definition = before['programs'][NEW_TARGET]
            binding = dict(row, raw=expected[i], programName=NEW_TARGET,
                           objectId=definition['objectId'], path=definition['path'])
        expect(new_task['resolvedCalls'][i] == binding, 'Resolved PROGRAM changed unexpectedly')
    expect(before['taskConfigurationVersion'] != after['taskConfigurationVersion'], 'Task version unchanged')


def run(root, repo, mode):
    project_path = os.path.join(root, 'engineering', FILENAME)
    guard = imp.load_source('task_call_replace_guard', os.path.join(repo, 'scripts', 'probes', 'task_call_replace_guard.py'))
    api = read_worker(repo)
    publish, sha = api['publish'], api['file_hash']
    origin = load(os.path.join(root, 'fixture-origin.json'))
    expect(origin['project'] == project_path and origin['seedSha256'] == SEED, 'Fixture origin mismatch')
    prior = load(os.path.join(root, 'replace-result.json')) if mode == 'verify' else None
    if prior:
        expect(prior['status'] == 'succeeded' and prior['closed'] and prior['saved'] and
               prior['replaceDispatchCount'] == 1, 'Saved replacement is unconfirmed')
    expected_hash = prior['diskAfterClose'] if prior else SEED
    result_path = os.path.join(root, mode + '-result.json')
    expect(not os.path.lexists(result_path), 'Completed pass cannot be replayed')
    proc = Process.GetCurrentProcess()
    result = dict(status='unknown', mode=mode, projectPath=project_path, diskBefore=expected_hash,
                  engine=dict(pid=proc.Id, creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),
                              executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion)),
                  fixtureWriteStarted=False, replaceDispatchCount=0, saved=False, closed=False)
    handle, stage, sequence = [None], ['before-open'], [0]

    def note(stage_name, status, **fields):
        sequence[0] += 1
        name = '%s-step-%03d.json' % (mode, sequence[0])
        publish(os.path.join(root, name), dict(fields, stage=stage_name, status=status,
                                               utc=unicode(DateTime.UtcNow.ToString('o'))))

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

    def compile_checked(project, state, name, disk_hash, persisted_input):
        expect(sha(project_path) == disk_hash, 'Disk changed before ' + name)
        compilation = step(name, lambda: api['compile_application'](project, state['applicationId'], 'application'))
        persist(name, dict(reply=compilation, diskAtBuild=disk_hash, diskAfterBuild=sha(project_path),
                           sourceSnapshot=state['sourceSnapshot'], taskVersion=state['taskConfigurationVersion'],
                           persistedInput=persisted_input))
        expect(compilation['status'] == 'succeeded' and compilation['data']['buildPassed'] is True and
               compilation['data']['diagnosticsComplete'] is True and
               compilation['data']['snapshot'] == state['sourceSnapshot'], 'Compile evidence failed: ' + name)
        expect(sha(project_path) == disk_hash and discover(api, project, project_path, True)[2] == state,
               'Compilation changed disk or readable task/source evidence')

    def close_project():
        handle[0].close()
        expect(projects.primary is None, 'Project close unconfirmed')
        handle[0] = None
        result['closed'] = True

    def seed_fixture(app, main):
        calls = main.pous
        read_row = api['task_append_call_row']
        expect([read_row(calls[i]) for i in range(len(calls))] == [['PLC_PRG', '']],
               'Unexpected original fixture call')
        step('prepare-baseline-comment-PLC_PRG', lambda: calls.replace(0, 'PLC_PRG', MAIN_COMMENT))
        rows = [read_row(calls[i]) for i in range(len(calls))]
        persist('prepare-commented-PLC_PRG', dict(index=0, rows=rows))
        expect(rows == [['PLC_PRG', MAIN_COMMENT]], 'Unconfirmed original fixture call comment')
        for name, comment, value in PREPARE:
            def create_definition():
                declaration, implementation = source_for(name, value)
                pou = app.create_pou(name, scriptengine.PouType.Program, scriptengine.ImplementationLanguages.st)
                pou.textual_declaration.replace(declaration)
                pou.textual_implementation.replace(implementation)
            step('prepare-' + name, create_definition)
            if comment is None:
                continue
            before = [read_row(calls[i]) for i in range(len(calls))]
            index = len(before)
            # This installed add overload ignores its comment argument. Set the
            # fixture annotation separately while retaining the verified name.
            step('prepare-baseline-call-' + name, lambda: calls.add(name, ''))
            added = [read_row(calls[i]) for i in range(len(calls))]
            persist('prepare-added-' + name, dict(index=index, rows=added))
            expect(added == before + [[name, '']], 'Unconfirmed new fixture call: ' + name)
            step('prepare-baseline-comment-' + name, lambda: calls.replace(index, name, comment))
            commented = [read_row(calls[i]) for i in range(len(calls))]
            persist('prepare-commented-' + name, dict(index=index, rows=commented))
            expect(commented == before + [[name, comment]], 'Unconfirmed fixture comment: ' + name)

    def checkpoint(disk_hash):
        destination = os.path.join(root, 'checkpoint.project')
        File.Copy(project_path, destination, False)
        expect(sha(destination) == disk_hash == sha(project_path), 'Checkpoint or live disk differs')
        persist('checkpoint', dict(file=destination, sha256=disk_hash))

    def work():
        step('open-fixture', open_project)
        project = handle[0]
        if mode == 'verify':
            expect(result['engine'] != prior['engine'], 'Independent IDE identity is required')
            reopened = step('read-saved-configuration', lambda: discover(api, project, project_path, True)[2])
            persist('reopened', reopened)
            expect(reopened == prior['afterReplace'], 'Saved readback differs from in-memory replacement')
            assert_replacement(prior['baseline'], reopened)
            compile_checked(project, reopened, 'savedBuild', expected_hash, True)
            final_read = step('final-read-after-saved-build', lambda: discover(api, project, project_path, True)[2])
            persist('finalRead', final_read)
            expect(final_read == reopened, 'Saved-version compilation changed final readback')
        else:
            app, main, seed = step('read-seed', lambda: discover(api, project, project_path, False))
            expect(seed['task']['rawCalls'] == [['PLC_PRG', '']], 'Unexpected seed calls')
            # Record the actual bound signature and first raw row on this IDE instance.
            calls = main.pous
            expect(callable(getattr(calls, 'replace', None)), 'Native collection has no replace method')
            persist('nativeSelector', dict(collectionType=unicode(type(calls)),
                    replaceDocumentation=unicode(getattr(calls.replace, '__doc__', '') or ''),
                    zeroIndexRead=api['task_append_call_row'](calls[0]), indexBase=0))
            result['fixtureWriteStarted'] = True
            seed_fixture(app, main)
            baseline = step('read-baseline', lambda: discover(api, project, project_path, True)[2])
            persist('baselineRead', baseline)
            expected_calls = [['PLC_PRG', MAIN_COMMENT]] + [[name, comment] for name, comment, value in PREPARE if comment is not None]
            expect(baseline['task']['rawCalls'] == expected_calls and
                   baseline['programs']['PLC_PRG'] == seed['programs']['PLC_PRG'] and
                   baseline['task']['taskId'] == seed['task']['taskId'] and
                   baseline['task']['rawFields'] == seed['task']['rawFields'] and
                   baseline['task']['watchdog'] == seed['task']['watchdog'], 'Baseline fixture differs')
            expect(sha(project_path) == expected_hash, 'Fixture file changed before baseline save')
            step('save-baseline', project.save)
            baseline_disk = sha(project_path)
            expect(baseline_disk != expected_hash and discover(api, project, project_path, True)[2] == baseline,
                   'Baseline save did not preserve readable evidence')
            persist('baseline', baseline)
            result['baselineDiskSha256'] = baseline_disk
            compile_checked(project, baseline, 'baselineBuild', baseline_disk, True)

            unused, main, live = step('same-handle-prewrite-check',
                                      lambda: discover(api, project, project_path, True))
            expect(live == baseline and sha(project_path) == baseline_disk,
                   'Pre-dispatch state changed')
            persist('prewrite', live)
            step('checkpoint', lambda: checkpoint(baseline_disk))

            def mark_dispatch(index, raw):
                expect(sha(project_path) == baseline_disk, 'Live disk guard changed before dispatch')
                note('native-replace', 'dispatched', index=index, raw=raw, taskId=live['task']['taskId'],
                     oldProgramId=live['programs'][TARGET]['objectId'],
                     newProgramId=live['programs'][NEW_TARGET]['objectId'],
                     applicationId=live['applicationId'], diskHash=baseline_disk,
                     taskConfigurationVersion=live['taskConfigurationVersion'])
                result['replaceDispatchCount'] = 1

            returned = step('native-replace', lambda: guard.replace_once(
                main.pous, baseline, live, TARGET, NEW_TARGET, api['task_append_call_row'], mark_dispatch))
            result['replaceReturned'] = None if returned is None else unicode(returned)
            after = step('read-actual-replacement', lambda: discover(api, project, project_path, True)[2])
            persist('afterReplace', after)
            assert_replacement(baseline, after)
            compile_checked(project, after, 'beforeSaveBuild', baseline_disk, False)
            step('save-replaced-fixture', project.save)
            result['saved'] = True
            result['diskAfterSave'] = sha(project_path)
            expect(result['diskAfterSave'] != baseline_disk, 'Save failed to publish a new revision')

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
            if not result['fixtureWriteStarted'] and not result['replaceDispatchCount'] and handle[0] is not None:
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
    root = os.path.abspath(os.environ['INOPRO_S8_REPLACE_ROOT'])
    repo = os.path.abspath(os.environ['INOPRO_S8_REPLACE_REPO'])
    mode = os.environ['INOPRO_S8_REPLACE_MODE']
    expect(re.match(r'^D:\\InoPro-S8a-TaskReplace-[0-9-]+$', root, re.I) and mode in ('replace', 'verify'),
           'Only a dedicated task-replace fixture is supported')
    run(root, repo, mode)
