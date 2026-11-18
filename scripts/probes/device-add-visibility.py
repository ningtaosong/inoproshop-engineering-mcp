# -*- coding: utf-8 -*-
"""Measure native tree visibility on a dedicated fixture, with no device writes."""
import io
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from device_add_preflight import (Journal, ProbeRejected, check_equal, connector, file_available,
                                  load_fixed_helpers, native_snapshot, run_primary)

try:
    unicode
except NameError:
    unicode = str


SEED_SHA256 = '89b804a220e213c53ec09f4f38e87b6dd9b68f704c9d063c04535fdbea4a3173'
PROJECT_NAME = 'AM610_S6b_Visibility.project'
ROOT_IDENTITY = dict(type='4102', id='10f4 0002', deviceDescriptionVersion='3.5.11.11')
OBSERVED_NAME = 'HwConfiguratioinDevice'


def read_json(path):
    with io.open(path, 'r', encoding='utf-8-sig') as stream:
        return json.load(stream)


def fixture_files(api, directory):
    result = {}
    for folder, unused, files in os.walk(directory):
        for name in sorted(files):
            path = os.path.join(folder, name)
            key = os.path.relpath(path, directory).replace('\\', '/')
            try:
                result[key] = dict(size=os.path.getsize(path), sha256=api['file_hash'](path))
            except (IOError, OSError) as error:
                result[key] = dict(readError=unicode(error))
    return result


def read_connectors(node, item):
    if not (node['device'] or node['explicit']):
        return dict(status='not-a-device-or-connector')
    if node['explicit']:
        if 'connector' in node:
            return dict(status='read', rows=[node['connector']])
        return dict(status='unavailable', error=node.get('connectorReadError'))
    rows = []
    try:
        for value in item.connectors:
            rows.append(connector(value))
    except Exception as error:
        return dict(status='incomplete', rows=rows, error=unicode(error))
    return dict(status='read', rows=rows)


def observe(project):
    nodes, items = native_snapshot(project)
    roots = [row for row in nodes if row['path'] == ['Device'] and row['parentGuid'] is None]
    if len(roots) != 1 or not roots[0]['device']:
        raise ProbeRejected('ROOT_DEVICE_NOT_UNIQUE')
    root = roots[0]
    check_equal('ROOT_IDENTITY_CHANGED', ROOT_IDENTITY, root.get('identity'), '$.root.identity')
    children = [row for row in nodes if row['parentGuid'] == root['guid']]
    append_index = len(children)
    item = items[root['guid']]
    allowed = dict(method='allowed_interfaces_at', status='unavailable')
    method = getattr(item, 'allowed_interfaces_at', None)
    if not callable(method):
        method = getattr(item, 'allow_interfaces_at', None)
        if callable(method):
            allowed['method'] = 'allow_interfaces_at'
    if callable(method):
        try:
            raw = method(append_index)
            allowed.update(status='read' if raw is not None else 'no-native-value',
                           value=[unicode(value) for value in raw] if raw is not None else None)
        except Exception as error:
            allowed.update(status='incomplete', error=unicode(error))
    measured = [dict(node=row, connectors=read_connectors(row, items[row['guid']])) for row in [root] + children]
    evidence = dict(nodes=nodes, root=measured[0], directChildren=measured[1:], directChildCount=len(children),
                    appendIndex=append_index, allowedAtAppend=allowed,
                    hardwareNodes=[row for row in children if row['name'] == OBSERVED_NAME])
    return evidence, items


def build_once(api, project, items, target):
    apps = [key for key, item in items.items() if getattr(item, 'is_application', False)]
    if len(apps) != 1:
        raise ProbeRejected('APPLICATION_NOT_UNIQUE')
    before = api['file_hash'](target)
    result = api['compile_application'](project, apps[0], 'application')
    after = api['file_hash'](target)
    data = result.get('data', {})
    messages = data.get('diagnostics', [])
    return dict(result=result, beforeSha256=before, afterSha256=after,
                errors=sum(m['severity'] in ('error', 'fatalerror') for m in messages),
                warnings=sum(m['severity'] == 'warning' for m in messages))


def run_probe(root, mode, api, projects, system, engine, utc_now, next_handle_token):
    directory = os.path.join(root, 'engineering')
    target = os.path.join(directory, PROJECT_NAME)
    origin = read_json(os.path.join(root, 'fixture-origin.json'))
    check_equal('ORIGIN_CHANGED', SEED_SHA256, origin['initialProjectSha256'], '$.origin.sha256')
    check_equal('FIXTURE_PATH_CHANGED', os.path.normcase(target), os.path.normcase(origin['project']), '$.origin.project')
    holder = dict(handle=None, token=None, projectClosed=False)
    stages = []
    def publish(name, value):
        api['publish'](os.path.join(root, name + '.json'), value)
    def sink(number, row):
        row['utc'] = utc_now()
        publish('%s-step-%03d' % (mode, number), row)
    journal = Journal(sink)

    def take(stage, project, compile_count):
        if project is not holder['handle']:
            raise ProbeRejected('OPEN_HANDLE_CHANGED')
        observed_path = unicode(project.path)
        check_equal('PROJECT_PATH_CHANGED', os.path.normcase(target), os.path.normcase(observed_path), '$.stage.projectPath')
        started = utc_now()
        evidence, items = observe(project)
        evidence.update(stage=stage, utcStart=started, utcEnd=utc_now(), engine=engine, handleToken=holder['token'],
                        projectPath=observed_path, compileCallsInThisHandle=compile_count,
                        files=fixture_files(api, directory))
        evidence['mainSha256'] = api['file_hash'](target)
        publish(stage, evidence)
        stages.append(stage)
        check_equal('DISK_CHANGED', SEED_SHA256, evidence['mainSha256'], '$.stage.mainSha256')
        return items

    def work():
        if projects.primary is not None:
            raise ProbeRejected('UNOWNED_PROJECT')
        journal.step('disk-and-occupancy-before-open', lambda: file_available(api, target, SEED_SHA256))
        publish(mode + '-files-before-open', fixture_files(api, directory))
        project = journal.step('native-open', lambda: projects.open(target), lambda unused: dict(returned=True))
        holder.update(handle=project, token=next_handle_token())
        if mode == 'first':
            journal.step('capture-A', lambda: take('A', project, 0), lambda unused: 'A.json')
            items = journal.step('capture-A2', lambda: take('A2', project, 0), lambda unused: 'A2.json')
            if journal.loggingErrors:
                raise ProbeRejected('EVIDENCE_INCOMPLETE_BEFORE_COMPILE')
            check_equal('DISK_CHANGED', SEED_SHA256, api['file_hash'](target), '$.compile.beforeSha256')
            result = journal.step('offline-compile-once', lambda: build_once(api, project, items, target))
            publish('compile', result)
            check_equal('COMPILE_CHANGED_DISK', SEED_SHA256, result['afterSha256'], '$.compile.afterSha256')
            journal.step('capture-B', lambda: take('B', project, 1), lambda unused: 'B.json')
            if result['result'].get('data', {}).get('buildPassed') is None:
                raise ProbeRejected('COMPILE_COMPLETION_UNCONFIRMED')
        else:
            journal.step('capture-C', lambda: take('C', project, 0), lambda unused: 'C.json')

    def close_without_saving():
        project = holder['handle']
        if project is None:
            return dict(projectClosed=False)
        if os.path.normcase(unicode(project.path)) != os.path.normcase(target):
            raise ProbeRejected('CLOSE_PATH_UNCONFIRMED')
        project.close()
        if projects.primary is not None:
            raise ProbeRejected('PROJECT_STILL_OPEN_AFTER_CLOSE')
        holder.update(handle=None, projectClosed=True)
        return dict(projectClosed=True)

    run_primary(system.execute_on_primary_thread, work, close_without_saving, journal)
    if holder['projectClosed']:
        try:
            journal.step('files-after-close', lambda: publish(mode + '-files-after-close', fixture_files(api, directory)))
            journal.step('disk-and-occupancy-after-close', lambda: file_available(api, target, SEED_SHA256))
        except Exception:
            pass  # Journal retains the failure and the launcher will not run the next pass.
    succeeded = holder['projectClosed'] and not any((journal.primaryFailure, journal.cleanupError,
                                                    journal.wrapperError, journal.loggingErrors))
    publish(mode + '-result', dict(status='succeeded' if succeeded else 'stopped', stages=stages,
                                   projectPath=target, handleToken=holder['token'], engine=engine,
                                   projectClosed=holder['projectClosed'], utc=utc_now(),
                                   primaryFailure=journal.primaryFailure, cleanupError=journal.cleanupError,
                                   wrapperError=journal.wrapperError, loggingErrors=journal.loggingErrors))
    if holder['projectClosed']:
        system.exit()


if __name__ == '__main__':
    from System import DateTime, Guid
    from System.Diagnostics import Process
    from scriptengine import device_repository, projects, system

    root = os.path.abspath(os.environ['INOPRO_S6B_VISIBILITY_ROOT'])
    repo = os.path.abspath(os.environ['INOPRO_S6B_VISIBILITY_REPO'])
    mode = os.environ['INOPRO_S6B_VISIBILITY_MODE']
    if not re.match(r'^D:\\InoPro-S6b-DeviceVisibility-[0-9-]+$', root, re.I) or mode not in ('first', 'reopen'):
        raise ValueError('Dedicated visibility fixture required')
    for stage in (('A', 'A2', 'B') if mode == 'first' else ('C',)):
        if os.path.exists(os.path.join(root, stage + '.json')):
            raise ValueError('A measurement already exists; no replay')
    proc = Process.GetCurrentProcess()
    utc_now = lambda: unicode(DateTime.UtcNow.ToString('o'))
    engine = dict(pid=proc.Id, creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),
                  executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion), ironPython=sys.version)
    api = load_fixed_helpers(repo, projects, system, device_repository)
    api['publish'](os.path.join(root, mode + '-engine.json'), engine)
    run_probe(root, mode, api, projects, system, engine, utc_now, lambda: unicode(Guid.NewGuid()))
