"""Validate sequencing and fail-closed behavior without starting an IDE."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch


source = Path(__file__).with_name('device-add-visibility.py')
spec = importlib.util.spec_from_file_location('device_visibility', source)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Node:
    def __init__(self, name, children=(), identity=None, application=False):
        self.name = self.guid = name
        self.children = list(children)
        self.identity = identity
        self.is_device = identity is not None
        self.is_application = application
        self.type = 'native-' + name
        self.connectors = []

    def get_name(self):
        return self.name

    def get_children(self, recursive):
        assert not recursive
        return self.children

    def get_device_identification(self):
        return SimpleNamespace(type=self.identity['type'], id=self.identity['id'],
                               version=self.identity['deviceDescriptionVersion'])

    def allowed_interfaces_at(self, index):
        assert index == len(self.children)
        return ['mock verified interface']


class SequenceTests(unittest.TestCase):
    def setUp(self):
        work = TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.folder = Path(work.name)
        self.fixture = self.folder / 'engineering' / probe.PROJECT_NAME
        self.fixture.parent.mkdir()
        self.fixture.write_bytes(b'unresolved neutral fixture')
        self.seed = self.digest(self.fixture)
        (self.folder / 'fixture-origin.json').write_text(json.dumps(dict(
            initialProjectSha256=self.seed, project=str(self.fixture))), encoding='utf-8')
        self.root = Node('Device', [Node('Application', application=True)], probe.ROOT_IDENTITY)
        self.project = Node('project', [self.root])
        self.project.path = str(self.fixture)
        self.project.close = self.close
        self.projects = SimpleNamespace(primary=None, open=self.open)
        self.system = SimpleNamespace(execute_on_primary_thread=lambda work: work(), exit=lambda: self.calls.append('exit'))
        self.api = dict(file_hash=self.digest, direct_exclusive_probe=lambda _: None,
                        compile_application=self.compile, publish=self.publish)
        self.calls = []

    @staticmethod
    def digest(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    def close(self):
        self.calls.append('close')
        self.projects.primary = None

    def open(self, path):
        self.calls.append('open')
        self.projects.primary = self.project
        return self.project

    def compile(self, project, app_id, kind):
        self.calls.append('compile')
        self.assertIs(project, self.project)
        self.assertEqual((app_id, kind), ('application', 'application'))
        self.root.children.append(Node(probe.OBSERVED_NAME))
        return dict(data=dict(buildPassed=True))

    def publish(self, path, value):
        with Path(path).open('x', encoding='utf-8') as out:
            json.dump(value, out)
        if Path(path).stem in ('A', 'A2', 'B', 'C'):
            self.calls.append(Path(path).stem)

    def run_probe(self, mode):
        with patch.object(probe, 'SEED_SHA256', self.seed):
            probe.run_probe(str(self.folder), mode, self.api, self.projects, self.system, dict(pid=17),
                            lambda: 'utc', lambda: 'mock-open-handle')

    def read(self, member):
        return json.loads((self.folder / (member + '.json')).read_text(encoding='utf-8'))

    def test_same_handle_precontrol_and_one_compile(self):
        self.run_probe('first')
        self.assertEqual(self.calls, ['open', 'A', 'A2', 'compile', 'B', 'close', 'exit'])
        for name, size in (('A', 1), ('A2', 1), ('B', 2)):
            row = self.read(name)
            self.assertEqual((row['handleToken'], row['appendIndex']), ('mock-open-handle', size))
            self.assertEqual(row['allowedAtAppend']['value'], ['mock verified interface'])
        self.assertEqual(self.read('first-result')['status'], 'succeeded')

    def test_reopen_capture_only(self):
        self.run_probe('reopen')
        self.assertEqual(self.calls, ['open', 'C', 'close', 'exit'])
        self.assertEqual(self.read('C')['compileCallsInThisHandle'], 0)

    def test_disk_change_stops_before_compile(self):
        def mutate_after_read(path, value):
            self.publish(path, value)
            if Path(path).stem == 'A2':
                self.fixture.write_bytes(b'concurrent fixture change')
        self.api['publish'] = mutate_after_read
        self.run_probe('first')
        self.assertNotIn('compile', self.calls)
        self.assertEqual(self.read('first-result')['primaryFailure']['error']['code'], 'DISK_CHANGED')

    def test_unconfirmed_close_prevents_exit(self):
        self.project.close = lambda: self.calls.append('uncertain close')
        self.run_probe('first')
        self.assertNotIn('exit', self.calls)
        self.assertEqual(self.read('first-result')['cleanupError']['code'], 'PROJECT_STILL_OPEN_AFTER_CLOSE')

    def test_probe_has_no_mutation_or_refresh_calls(self):
        forbidden = {'insert', 'plug', 'update', 'remove', 'delete', 'save', 'save_as', 'refresh', 'login', 'download'}
        tree = ast.parse(source.read_text(encoding='utf-8'))
        calls = [ast.unparse(call.func) for call in ast.walk(tree) if isinstance(call, ast.Call)
                 and isinstance(call.func, ast.Attribute) and call.func.attr in forbidden
                 and ast.unparse(call.func.value) not in ('sys.path', 'holder', 'evidence', 'allowed')]
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
