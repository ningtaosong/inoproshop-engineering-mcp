# -*- coding: utf-8 -*-
"""Read the dedicated sample with the installed IDE. No project mutations."""
import imp
import io
import json
import os
import sys
from System import DateTime
from System.Diagnostics import Process
from scriptengine import projects, system


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_worker(repo):
    path = os.path.join(repo, 'bridge', 'worker.py')
    with io.open(path, 'r', encoding='utf-8') as stream:
        source = stream.read()
    boundary = '# Fixed helper code only; request text is never evaluated.'
    require(source.count(boundary) == 1, 'Bridge helper boundary changed')
    api = dict(__file__=path, projects=projects, system=system)
    exec(compile(source.split(boundary)[0], path, 'exec'), api)
    return api


def main():
    root = os.environ['INOPRO_S8B_ROOT']
    fixture_root = os.environ['INOPRO_S8B_FIXTURE_ROOT']
    repo = os.environ['INOPRO_S8B_REPO']
    mode = os.environ['INOPRO_S8B_PASS']
    require(mode in ('first', 'reopen', 'followup'), 'Unexpected pass')
    require(root == (os.path.join(fixture_root, 'scalar-followup') if mode == 'followup' else fixture_root),
            'Unexpected evidence root')
    with io.open(os.path.join(root, 'fixture-origin.json'), 'r', encoding='utf8') as stream:
        origin = json.load(stream)
    project_path = origin['project']
    require(os.path.dirname(project_path) == os.path.join(fixture_root, 'engineering'), 'Unexpected fixture path')
    require(origin['operationId'] == os.environ['INOPRO_S8B_OPERATION'], 'Unbound operation')
    api = read_worker(repo)
    sha, publish = api['file_hash'], api['publish']
    proc = Process.GetCurrentProcess()
    result = dict(status='unknown', passName=mode, operationId=origin['operationId'], projectPath=project_path,
                  opened=False, closed=False, requestedScansReturned=False, saveCalls=0, compileCalls=0,
                  engine=dict(pid=proc.Id, creationUtcTicks=unicode(proc.StartTime.ToUniversalTime().Ticks),
                              executableVersion=unicode(proc.MainModule.FileVersionInfo.FileVersion)))
    events = [0]
    stage = ['preflight']
    handle = [None]
    def note(label, state):
        events[0] += 1
        filename = '%s-stage-%02d.json' % (mode, events[0])
        publish(os.path.join(root, filename), dict(stage=label, state=state, engine=result['engine'],
                operationId=origin['operationId'], utc=unicode(DateTime.UtcNow.ToString('o'))))
    def begin(label):
        stage[0] = label
        note(label, 'started')
    def work():
        try:
            begin('preflight')
            require(projects.primary is None, 'Existing project at startup')
            require(result['engine']['executableVersion'] == '1.9.1.6', 'Unexpected native IDE version')
            require(all(not os.path.lexists(project_path+s) for s in ('.~u', '.lock', '.lck', '.~lock')),
                    'External project occupancy marker found')
            api['direct_exclusive_probe'](project_path)
            result['diskBefore'] = sha(project_path)
            require(result['diskBefore'] == origin['sha256'], 'Fixture hash changed')
            # Load only the checked-in data collector, before opening a document.
            probe_dir = os.path.join(repo, 'scripts', 'probes')
            sys.path.insert(0, probe_dir)
            reader = imp.load_source('io_mapping_read', os.path.join(probe_dir, 'io_mapping_read.py'))
            note(stage[0], 'succeeded')
            begin('open')
            handle[0] = projects.open(project_path)
            require(os.path.normcase(unicode(handle[0].path)) == os.path.normcase(project_path), 'Wrong native file')
            result['opened'] = True
            note(stage[0], 'succeeded')
            for label in (('C',) if mode == 'reopen' else ('A', 'A2')):
                begin('read-'+label)
                state = reader.snapshot(handle[0])
                require(isinstance(state, dict), 'Collector returned no report')
                publish(os.path.join(root, mode+'-'+label+'.json'), state)
                note(stage[0], 'succeeded')
            result['requestedScansReturned'] = True
        except Exception as err:
            result['error'] = dict(api['exception_evidence'](err), stage=stage[0])
        if result['opened']:
            try:
                begin('close-without-save')
                handle[0].close()
                require(projects.primary is None, 'Close not confirmed')
                handle[0] = None
                result['closed'] = True
                note(stage[0], 'succeeded')
                result['diskAfterClose'] = sha(project_path)
                require(result['diskAfterClose'] == origin['sha256'], 'Main file changed')
                result['status'] = 'succeeded' if result['requestedScansReturned'] else 'failed'
            except Exception as err:
                result['closeOrVerificationError'] = dict(api['exception_evidence'](err), stage=stage[0])

    try:
        system.execute_on_primary_thread(work)
    except Exception as err:
        result['callbackError'] = api['exception_evidence'](err)
        result['status'] = 'unknown'
    publish(os.path.join(root, mode+'-result.json'), result)
    if result['closed'] or (not result['opened'] and projects.primary is None):
        system.exit()


if __name__ == '__main__':
    main()
