# -*- coding: utf-8 -*-
"""One IronPython file-publication check; intentionally never opens a project."""
import datetime
import json
import os
import sys
import traceback

sys.path.insert(0, os.environ['NATIVE_PUBLISH_HELPER_DIR'])
from native_json_publish import publish_json

directory = os.environ['FIXTURE_PHASE_DIR']
target = os.environ['FIXTURE_TARGET']  # A seed JSON file, not a project.
result = os.environ['FIXTURE_RESULT']
payload = os.path.join(directory, 'chinese-payload.json')
counter = 0


def stage(name, status):
    global counter
    counter += 1
    marker = os.path.join(directory, 'native-phase-%06d.json' % counter)
    publish_json(marker, {
        'target': target, 'stage': name, 'status': status,
        'atUtc': datetime.datetime.utcnow().isoformat() + 'Z'})


try:
    stage('probe-start', 'succeeded')
    stage('json-write', 'started')
    value = {'message': u'中文文件发布探测', 'count': 1}
    publish_json(payload, value)
    stage('json-write', 'succeeded')
    stage('readback', 'started')
    with open(payload, 'rb') as stream:
        observed = json.loads(stream.read().decode('utf-8'))
    if observed != value:
        raise ValueError('UTF-8 JSON readback differs')
    stage('readback', 'succeeded')
    stage('stage-complete', 'succeeded')
    record = {
        'passed': True, 'target': target, 'engine': sys.version,
        'message': observed['message'], 'publisher': 'native_json_publish.publish_json',
        'stages': ['probe-start', 'json-write', 'readback', 'stage-complete']}
    stage('result-publish', 'started')
    publish_json(result, record)
    stage('result-publish', 'succeeded')
except Exception:
    sys.stderr.write('FILE_PUBLISH_PROBE_FAILED\n' + traceback.format_exc() + '\n')
    sys.stderr.flush()

system.exit()
