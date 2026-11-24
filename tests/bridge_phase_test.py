"""Offline phase evidence tests with native API substitutes; never opens the IDE."""
import ast
import datetime
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace


SOURCE = Path('bridge/worker.py')
TREE = ast.parse(SOURCE.read_text(encoding='utf-8'))
FUNCTIONS = ast.Module(body=[n for n in TREE.body if isinstance(n, ast.FunctionDef)], type_ignores=[])
ENTRY = ast.Module(body=[n for n in TREE.body if n.lineno >= next(
    n.lineno for n in TREE.body if isinstance(n, ast.Assign) and
    any(isinstance(t, ast.Name) and t.id == 'request_path' for t in n.targets))], type_ignores=[])


class PhaseEvidence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.project = self.dir / 'fixture.project'
        self.project.write_bytes(b'fixture project')
        self.result = self.dir / 'result.json'
        self.request = self.dir / 'request.json'
        self.operation_id = 'phase-fixture-operation'
        self.request.write_text(json.dumps({
            'operationId': self.operation_id, 'command': 'inspect',
            'projectPath': str(self.project), 'args': {}, 'resultPath': str(self.result)
        }), encoding='utf-8')
        self.open_entered = threading.Event()
        self.open_release = threading.Event()
        self.prompt_error = False
        self.fail_result_publish = False
        self.fail_phase_publish = False
        self.fail_close = False
        self.opens = self.closes = self.exits = 0
        self.stderr = io.StringIO()
        self.env = dict(os=os, io=io, json=json, datetime=datetime, hashlib=hashlib, CONTRACT='1.0.0',
                        sys=SimpleNamespace(argv=[], version=sys.version, stderr=self.stderr),
                        traceback=__import__('traceback'), unicode=str, text=str)
        exec(compile(FUNCTIONS, str(SOURCE), 'exec'), self.env)

        def publish(target, value):
            if self.fail_result_publish and target == str(self.result):
                raise IOError('result publication failed')
            if self.fail_phase_publish and Path(target).name.startswith('phase-'):
                raise IOError('phase evidence disk unavailable')
            Path(target).write_text(json.dumps(value), encoding='utf-8')

        def native_open(path, primary):
            self.opens += 1
            self.open_entered.set()
            self.open_release.wait(2)
            if self.prompt_error:
                raise RuntimeError('unrecognized native prompt')
            return SimpleNamespace(path=path, close=self.native_close)

        def dispatch(req):
            state = self.env['lifecycle_state'](project_path=req['projectPath'])
            self.env['lifecycle_open'](state, req['projectPath'])
            self.env['lifecycle_call'](state, 'inspect-metadata', lambda: {'known': True})
            self.env['lifecycle_close'](state, 'final-cleanup')
            return {'status': 'succeeded', 'data': {'lifecycle': self.env['lifecycle_report'](state)}}

        self.env.update(publish=publish, dispatch=dispatch,
                        prepare_native_exit=lambda *args: SimpleNamespace(preflight=lambda: None,
                            queue=lambda: setattr(self, 'exits', self.exits + 1), fail=lambda *args: None),
                        projects=SimpleNamespace(open=native_open),
                        system=SimpleNamespace(execute_on_primary_thread=lambda action: action(),
                                               exit=lambda: setattr(self, 'exits', self.exits + 1)))
        self.env['os'].environ['INOPRO_BRIDGE_REQUEST'] = str(self.request)
        self.addCleanup(self.env['os'].environ.pop, 'INOPRO_BRIDGE_REQUEST', None)

    def native_close(self):
        self.closes += 1
        if self.fail_close:
            raise RuntimeError('native close uncertain')

    def run_entry(self):
        exec(compile(ENTRY, str(SOURCE), 'exec'), self.env)

    def stages(self):
        return [json.loads(p.read_text(encoding='utf-8')) for p in sorted(self.dir.glob('phase-*.json'))]

    def test_normal_open_records_distinct_open_metadata_close_and_result_phases(self):
        self.open_release.set()
        self.run_entry()
        self.assertEqual(json.loads(self.result.read_text())['status'], 'succeeded')
        self.assertEqual((self.opens, self.closes, self.exits), (1, 1, 1))
        stages = [(x['stage'], x['status']) for x in self.stages()]
        for expected in [('primary-thread', 'entered'), ('initial-open', 'started'),
                         ('initial-open', 'succeeded'), ('inspect-metadata', 'succeeded'),
                         ('final-cleanup', 'succeeded'), ('result-publish', 'succeeded')]:
            self.assertIn(expected, stages)
        self.assertTrue(all(x['operationId'] == self.operation_id for x in self.stages()))

    def test_pending_library_prompt_has_no_completed_open_or_result(self):
        errors = []
        thread = threading.Thread(target=lambda: self._capture(errors))
        thread.start()
        self.assertTrue(self.open_entered.wait(2))
        self.assertIn(('initial-open', 'started'), [(x['stage'], x['status']) for x in self.stages()])
        self.assertFalse(self.result.exists())
        self.assertTrue((self.dir / 'dispatched.json').exists())
        self.open_release.set()
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])

    def test_unrecognized_prompt_is_not_automatically_confirmed(self):
        self.open_release.set()
        self.prompt_error = True
        self.run_entry()
        self.assertEqual(self.opens, 1)
        self.assertEqual(self.closes, 0)
        self.assertEqual(json.loads(self.result.read_text())['status'], 'unknown')
        self.assertIn(('initial-open', 'failed'), [(x['stage'], x['status']) for x in self.stages()])

    def test_result_publish_failure_leaves_dispatched_without_result(self):
        self.open_release.set()
        self.fail_result_publish = True
        self.run_entry()  # First publication exception is recorded, not thrown into UI.
        self.assertEqual((self.opens, self.closes), (1, 1))
        self.assertFalse(self.result.exists())
        self.assertTrue((self.dir / 'dispatched.json').exists())
        self.assertEqual(self.stages()[-1]['stage'], 'result-publish')
        self.assertEqual(self.stages()[-1]['status'], 'started')
        self.assertRaises(ValueError, self.run_entry)
        self.assertEqual(self.opens, 1)

    def test_close_failure_is_distinct_from_open_and_never_reports_success(self):
        self.open_release.set()
        self.fail_close = True
        self.run_entry()
        self.assertEqual(json.loads(self.result.read_text())['status'], 'unknown')
        stages = [(x['stage'], x['status']) for x in self.stages()]
        self.assertIn(('initial-open', 'succeeded'), stages)
        self.assertIn(('final-cleanup', 'failed'), stages)
        self.assertNotIn(('final-cleanup', 'succeeded'), stages)
        self.assertEqual((self.opens, self.closes), (1, 1))

    def test_phase_write_failure_does_not_change_native_result(self):
        self.open_release.set()
        self.fail_phase_publish = True
        self.run_entry()
        self.assertEqual(json.loads(self.result.read_text())['status'], 'succeeded')
        self.assertEqual(self.stages(), [])
        self.assertIn('phase evidence unavailable', self.stderr.getvalue())

    def _capture(self, errors):
        try:
            self.run_entry()
        except Exception as error:
            errors.append(error)


if __name__ == '__main__':
    unittest.main()
